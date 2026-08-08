# Orders & Settlements

Tracks customer orders and the payments and refunds recorded against them, deriving
each order's status from its ledger rather than storing it. Built as a take-home:
Next.js (App Router) and TypeScript on top of MongoDB, no ORM.

**Live:** https://orders-and-settlements-ivory.vercel.app
**Demo login:** `demo@example.com` / `demo-password-123` (created by `npm run seed`)

## Running it locally

Prerequisites: Node 20+, and a MongoDB cluster — either a free Atlas cluster or a
local replica set (a plain standalone `mongod` also works; nothing here uses
transactions, which is the whole point of the concurrency section below).

```bash
cp .env.example .env.local
```

`.env.local` needs three variables:

| Variable | Meaning |
|---|---|
| `MONGODB_URI` | Connection string for a `readWrite` user scoped to one database. |
| `MONGODB_DB` | Database name (`orders_settlements` in the example). |
| `AUTH_SECRET` | Session-signing secret for Auth.js. Generate one with `openssl rand -base64 32`; do not reuse the placeholder. |

Then:

```bash
npm install
npm run seed   # creates demo@example.com and a handful of orders in various states
npm run dev    # http://localhost:3000
npm test       # 212 tests: pure domain logic + integration tests against a real
               # in-memory MongoDB (mongodb-memory-server), no mocks of the driver
```

## API overview

Every route requires a session cookie except `POST /api/auth/register`. All request
and response bodies are JSON; money fields are integer minor units (see below).

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/register` | Create an account (email + password). |
| `GET` | `/api/orders` | List the caller's orders. Query: `status`, `page`, `pageSize`. |
| `POST` | `/api/orders` | Create an order (`customer`, `dueDate`, `lines[]`). |
| `GET` | `/api/orders/[id]` | One order plus its ledger entries. |
| `PATCH` | `/api/orders/[id]` | Update `customer` / `dueDate`. Rejected once any settlement exists. |
| `DELETE` | `/api/orders/[id]` | Soft-delete. Rejected once any settlement exists. |
| `POST` | `/api/orders/[id]/payments` | Record a payment. Honours `Idempotency-Key`. |
| `POST` | `/api/orders/[id]/refunds` | Record a refund. Honours `Idempotency-Key`. |
| `GET` | `/api/orders/[id]/audit` | Merged ledger + audit-log timeline for one order. |
| `GET` | `/api/orders/export` | CSV of orders matching `status`/`from`/`to`. |

Errors share one envelope:

```json
{ "error": { "code": "OVERPAYMENT", "message": "...", "details": { "maxAllowedMinor": 60000 } } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Malformed input; `details.fields` maps field path → message. |
| `UNAUTHENTICATED` | 401 | No session. |
| `NOT_FOUND` | 404 | Missing, or owned by another user — the two are indistinguishable on purpose. |
| `ORDER_LOCKED` | 409 | Order has settlements; metadata can no longer change. |
| `OVERPAYMENT` | 409 | Payment would exceed the order total. `details.maxAllowedMinor` names the ceiling. |
| `EXCESS_REFUND` | 409 | Refund would exceed what has actually been paid. |
| `CONCURRENT_UPDATE` | 409 | Lost every retry against a racing writer; safe to resubmit. |
| `IDEMPOTENCY_KEY_REUSED` | 409 | The key was already used for a different order, kind, or amount. |
| `INTERNAL_ERROR` | 500 | Anything unexpected; logged server-side, not detailed to the client. |

## Money representation

Every amount is an integer count of minor units (cents) — `totalMinor`, `paidMinor`,
`amountMinor`, and so on carry the suffix everywhere they appear, in both the domain
types and the wire format, so a value is never ambiguous about its scale by the time
it reaches a comparison. Conversion happens at exactly two boundaries: `parseMinor`
turns a decimal string like `"1000.00"` into `100000` when a request arrives, and
`formatMinor` turns it back into a string for the CSV and initial page render (the UI
otherwise works with the integer directly).

The reason is `0.1 + 0.2 !== 0.3`: IEEE-754 floats cannot represent most decimal
fractions exactly, and summing dollar amounts as floats accumulates that error
silently. It doesn't announce itself on obviously-round numbers — the assignment's
own sample order (two line items at $500.00, payments of $400.00 then $600.00) looks
like it would add up cleanly in floating point too, right up until it doesn't on some
other input, and by then the ledger has already committed a value that is off by a
fraction of a cent in a comparison that is supposed to be exact (`amountMinor > ceiling`
in `src/domain/ledger.ts`). Integers under addition and comparison have no such
failure mode, so the domain layer never touches a float.

## Status derivation

`OrderStatus` is never stored. It's computed on every read from `totalMinor`, the
ledger's current balance, and the current clock, in `deriveStatus` (`src/domain/status.ts`):

1. `netPaid >= totalMinor` → `paid`
2. else `now > endOfDayUtc(dueDate)` → `overdue`
3. else `netPaid > 0` → `partially_paid`
4. else → `pending`

Storing status was rejected outright: `overdue` is a function of `now`, not of any
write that happened to the order, so a stored value would need updating by
something running on a schedule just to stay honest — and would already be wrong
the instant it did. Deriving it means the same order can report `overdue` on one
request and, after nothing more happens than the clock moving, still be correctly
`overdue` on the next, with no batch job in between. It also settles the brief's
own edge case directly: an order that goes overdue and is then paid in full reports
`paid`, because rule 1 is checked first — status is a priority list, not a
timeline. Refunds fall out of the same rule set for free: a refund lowers `netPaid`,
which can move an order backward from `paid` to `partially_paid`, so status is not
monotonic over an order's life and nothing in the code assumes it is.

Due dates are inclusive through end of day UTC — `endOfDayUtc` (same file) rounds a
due date up to `23:59:59.999` UTC before comparing against `now`, so an order due
"today" is not overdue until tomorrow, uniformly, regardless of which timezone the
due date was entered in. The UI's relative-due caption ("due in 3 days" / "3 days
overdue") is computed from that same boundary with `Math.floor` — not `Math.ceil`,
which was tried first and overcounted by a day, because a due date at
`23:59:59.999` makes a nominal 7-day gap measure `7.99999` days — so the caption and
the status badge can never disagree about which side of the line an order is on.

## Concurrency

**The invariant: payments may never exceed the order total, and it must hold under
concurrent requests.**

Read-then-validate-then-write is the obvious first attempt and it fails: two
requests both read a balance of $0 against a $1,000 total, both validate a $700
payment as within the ceiling, and both write — $1,400 recorded against $1,000
owed.

The next instinct is to wrap the read and the write in a transaction, and that
**also fails**, for a reason that's easy to miss. MongoDB's transactions give
snapshot isolation, which prevents write-write conflicts on the *same* document —
two transactions racing to update one order would correctly serialize. But the two
payments above don't update the same document; each *inserts a new ledger entry*.
Snapshot isolation has nothing to say about two transactions that read identical
state and each insert a *different* document — that's write skew, it is explicitly
permitted, and both transactions commit cleanly. A transaction here would pass
every test that doesn't specifically try to break it, and still let $1,400 through
on $1,000 owed.

The fix is to force the two writers through one shared conflict point instead of
trusting them to agree on one. Every ledger entry carries a per-order `seq`
(1, 2, 3, ...) under a unique index, `order_seq_unique` on `{orderId, seq}`. Two
concurrent appends against the same order both compute `seq = N` from the same
last-seen entry; one insert succeeds, the other raises a duplicate-key error. The
loser doesn't retry blindly — it re-reads the balance (now larger, because the
winner's payment is in it), re-validates the new request against the new ceiling,
and either succeeds at `seq = N+1` or is correctly rejected as an overpayment. See
`appendEntry` in `src/server/settlements.ts`.

Because every state change — a payment, a refund, a rejection's audit trail — is a
single-document insert, **the application uses no transactions anywhere**. That's a
stronger answer than reaching for a transaction would have been: a transaction here
would have been actively wrong (it doesn't close the write-skew hole), and the
unique-index approach is cheaper — one indexed insert plus, on collision, one
re-read — with no session, no two-phase commit overhead, and no cross-shard
transaction limitations to worry about if this ever needed to shard by order.

**On the evidence** — this claim survived a review that found the first version of
its own proof wasn't proving what it claimed to prove, which is worth stating
precisely rather than just asserting "there are tests":

- `tests/integration/settlements.test.ts`, `"lets exactly one of two racing payments
  through when only one fits"`, is the headline test — two payments fired
  concurrently at an order where only one can fit. It initially passed even against
  a build with the retry loop deleted, because it was the first concurrent burst in
  the file: both calls queued on a single lazily-opened connection in a cold pool
  and never actually overlapped in time. The harness now warms the pool before this
  test runs, which turns it into a real race — it fails 10/10 against the broken
  build and passes cleanly against the correct one.
- The test that specifically proves `order_seq_unique` is the conflict point is
  `"lets both through and orders them when both fit"`. With that index made
  non-unique, this is the test that fails — not the mocked retry tests, not the
  ten-way burst test with bounds-only assertions. If a reviewer wants the single
  strongest piece of evidence that the index is load-bearing, this is it.
- `tests/integration/settlements-retry.test.ts` mocks the collision and proves the
  retry *handler* — that a `seq` collision re-reads and retries, that an
  idempotency-key collision returns the original entry instead of retrying, that
  the loop gives up after `MAX_ATTEMPTS` — deterministically, without depending on
  real timing. It does not, on its own, prove the index causes real collisions
  under real concurrency; the two tests above do that.
- `tests/integration/refunds.test.ts` carries the same pattern one level further:
  the brief's own suggested race ("two concurrent full refunds") doesn't actually
  discriminate a working retry from a broken one, because at most one full refund
  can ever succeed regardless of whether the loser retries or just dies on its
  first collision. The real test there is three concurrent *partial* refunds where
  exactly two fit — that fails under a broken retry and passes under a correct one.

## Idempotency

Both settlement endpoints accept an `Idempotency-Key` header. A request that
carries one, seen again, does not insert a second ledger entry — it returns the
entry from the first successful call, with `replayed: true` in the response.

The key is enforced by a partial unique index, `user_idem_unique` on
`{userId, idempotencyKey}`, scoped **per user**, not per order — a key is a
property of "this specific request I already told you about," not of the order it
happened to target. The index is partial (`idempotencyKey: { $type: 'string' }`) so
the many settlements that don't send a key at all — `idempotencyKey: null` — never
collide with each other.

A `seq` collision and a key collision are handled by opposite branches of the same
catch block in `appendEntry`, deliberately: a `seq` collision means *someone else
won a race you were both trying to win*, so the correct response is to retry with
fresh data. A key collision means *this exact request was already handled*, so the
correct response is the opposite of a retry — return what was already recorded and
insert nothing new. Conflating them would either double-process a legitimate retry
or infinite-loop on a key that will never stop colliding.

That distinction has a sharp edge, found in review: a key is scoped to
`{userId, idempotencyKey}` only, not to an order, kind, or amount, so a found row
is not automatically a replay of *this* request. Replaying a key that was
previously used against a *different* order returned that other order's entry with
a 201 and recorded nothing new — silently answering a completely different request
with someone else's settlement. `IDEMPOTENCY_KEY_REUSED` closes that: the existing
row's `orderId`, `kind`, and `amountMinor` are compared against the incoming
request, and any mismatch is refused with 409 rather than served.

The UI mints a fresh key (`crypto.randomUUID()`) on every form submission, not once
when the dialog opens. That protects a single logical request against being resent
at the transport level (a proxy or browser retrying an in-flight fetch) — it does
**not** deduplicate a manual retry after a visible failure, which is intentionally
left to the submit button's disabled/busy state instead. A key stable per dialog
open would cover that gap too, but it was deliberately not built that way: it would
collide with `IDEMPOTENCY_KEY_REUSED` the moment a user edits the amount and
resubmits under the same key, which is a worse failure mode than the one it would
fix. See the comment above the fetch call in
`src/app/(app)/orders/[id]/settlement-actions.tsx`.

## Data model and indexing

Four collections. No ORM — the MongoDB driver directly, with document types
(`OrderDoc`, `LedgerEntryDoc`, `AuditDoc`, `CounterDoc`) in `src/server/db.ts`.

- **`orders`** — one document per order. Line items are embedded, not a separate
  collection, because they have no independent identity or lifecycle outside their
  order: they are never queried, paged, or referenced on their own, and embedding
  means loading an order is one document read rather than a document plus a join.
- **`ledgerEntries`** — append-only. A payment or refund is inserted once and never
  updated or deleted; the running balance lives on the newest entry
  (`balanceAfter`), so "current balance" is one indexed seek rather than a sum
  over every entry for the order.
- **`users`** — email + bcrypt hash.
- **`counters`** — one document per user, holding the next order-reference number
  (`ORD-1001`, `ORD-1002`, ...). `$inc` on a single document is atomic, so two
  concurrent order creations can never be issued the same reference — the same
  reasoning as the ledger's `seq`, one level up the stack.
- **`auditLog`** — see the next section.

| Index | Collection | Serves |
|---|---|---|
| `email_unique` | `users` | Enforces one account per email. |
| `user_created` | `orders` | `{userId, createdAt: -1}` — the default dashboard sort. |
| `user_due` | `orders` | `{userId, dueDate: 1}` — due-date range queries (export, overdue sorting). |
| `order_seq_unique` | `ledgerEntries` | `{orderId, seq: -1}`, unique. Two jobs: the uniqueness constraint *is* the concurrency guard (above), and the same compound key serves the "latest entry for this order" lookup that every read needs. |
| `user_idem_unique` | `ledgerEntries` | `{userId, idempotencyKey}`, unique, partial. The idempotency guard above. |
| `user_order_at` | `auditLog` | `{userId, orderId, at: -1}` — the per-order audit timeline. |

## Editability and deletion

An order can be edited (`customer`, `dueDate`) freely — until the first settlement
is recorded against it, at which point it freezes entirely, metadata included, not
just line items. The reason is the same invariant as the concurrency section:
overpayment is validated against `totalMinor`, so if the total (or, transitively,
anything an already-accepted payment was checked against) could still move after
money had been accepted, every prior acceptance would be retroactively invalid.
Freezing the whole order is the only way to keep "this payment was valid when
accepted" true forever. This is a deliberate departure from the supplied mockup,
whose locked-banner copy describes only line items as locked — the mockup's
wording was written before the whole-order rule was decided, so the banner text
was reworded rather than left to describe a narrower lock than actually exists.

Deletion is soft (`deletedAt`), and the reason is not the usual "keep history for
undo" one. The natural-sounding hard-delete check — *count the ledger entries for
this order, and if there are none, delete the order* — reads `ledgerEntries` and
writes `orders`. Those are two different documents, so a payment landing between
the read and the write conflicts with nothing: the count reads zero, the delete
proceeds, and the payment that was accepted a moment later points at an order that
no longer exists. A transaction does not close this, for the identical write-skew
reason a transaction doesn't fix the payment race — the count-then-delete pair
would still be reading one document and writing another, and snapshot isolation
permits exactly this shape of conflict. Soft deletion doesn't close the race
either; it makes it benign. The worst case becomes an order flagged `deletedAt`
that still has one payment attached to it — recoverable, and the ledger entry
itself is untouched — instead of an orphaned payment pointing at nothing.

## Status filtering and scale

The four status rules are encoded twice: once in TypeScript (`deriveStatus`, used
by every single-order read) and once as a MongoDB `$switch` (`statusExpression` in
`src/server/dashboard.ts`, used by the list, the summary bar, and the CSV export).
That's verbatim duplication of a logic block, which a review checklist would
normally flag on sight — it's deliberate, and the reason is that the alternative
isn't simpler, it's wrong. Deriving status in application code only works if
filtering also happens in application code, and filtering after paging returns the
wrong page (an `overdue` filter applied to page 2 of unfiltered results is not page
2 of overdue orders), while filtering before paging means loading every order for
the user on every request just to throw most of them away — a correctness bug in
the first case, and a scale ceiling with no headroom in the second, the moment a
user has enough orders that pagination matters at all. Encoding the same rule in
`$switch` lets MongoDB filter and paginate correctly at the same time.

The risk that duplication creates — the two encodings drifting apart silently — is
what `tests/integration/dashboard.test.ts` exists to catch: it runs a fixture
matrix of orders through both `deriveStatus` and a live aggregation against
`statusExpression` and asserts they agree on every row. It was mutation-tested
against three independent ways the `$switch` could go subtly wrong (branch-order
swap, `$gt` vs `$gte` on the day comparison, moving the status filter to the wrong
pipeline stage) and caught all three.

The `$lookup` that fetches each order's latest ledger entry is one indexed seek
per order via `order_seq_unique` — fine for a dashboard page, and fine well past
what a single user would accumulate by hand. The next step, when it stops being
fine, is a read-model collection — one document per order carrying its current
balance and status, written alongside each ledger append — so the dashboard reads
one collection instead of joining two. Worth building once a user's order count
reaches the low thousands and the `$lookup` join shows up in profiling; not before,
because it adds a second write path that has to stay consistent with the ledger,
which is exactly the kind of extra moving part this project has otherwise avoided.

## Following the design

The UI is built from the supplied design mockup — its color and spacing tokens and
Tailwind configuration are used verbatim in `src/app/globals.css`, not
approximated, and screen layout follows it closely enough that no screen invents a
control the mockup doesn't already use somewhere else (the segmented control, the
card, the pill).

Three deliberate departures:

- **The locked banner's copy.** Covered above — the mockup describes line items as
  locked; the actual rule locks the whole order, so the banner was reworded to say
  that, keeping the same icon and placement.
- **Refunds get their own secondary action and a dedicated dialog.** The mockup
  only covers recording payments; refunds aren't in it at all. The refund UI reuses
  the payment dialog's shape (same field layout, same inline-error convention) so
  it reads as part of the same system rather than a bolted-on addition.
- **Two mockup elements are omitted outright**: the "Design tokens" screen, which
  is a handoff artifact for a design system, not a product screen a user would ever
  reach, and the "Send reminder" button, which has no backing feature — building
  either would be UI for a capability that doesn't exist.

Separately, the sign-up form captures a full-name field but never sends it to the
server — only email and password reach `/api/auth/register`, matching the brief,
which specifies those two fields and nothing else. The field stays in the form
because the mockup has it and removing it would be a visible design change for no
functional reason; it simply has no column to land in.

## Assumptions and tradeoffs

**Single currency, and `totalMinor === subtotalMinor`.** There's no per-order
currency field and no tax or discount line — `computeTotals` documents the latter
as a placeholder (`totalMinor` is kept as a field distinct from `subtotalMinor`
specifically so a future tax/discount step has somewhere to write its result
without changing every call site that reads `totalMinor`), but nothing currently
populates it differently. Multi-currency is discussed as a non-goal below.

**`bcryptjs` over argon2(id).** argon2 is the stronger algorithm by current
guidance, but the reference implementations ship as native bindings, and a native
binding is the single most common way a Node app builds cleanly on a laptop and
fails on Vercel's build image. `bcryptjs` is pure JavaScript, slower per hash than
a native argon2 binding, and for a take-home whose entire user base is one
reviewer's browser, that tradeoff is the right one — it would be revisited before
this handled real signup volume.

**Passwords are bounded at 72 bytes, not characters.** bcrypt silently truncates
its input at 72 bytes; anything past that is simply not part of what gets hashed.
Left unbounded, two different long passwords that happen to share the first 72
bytes would hash identically and authenticate the same account — a real, silent
security bug, not a hypothetical one. Registration rejects a password whose
`TextEncoder`-encoded byte length exceeds 72 rather than truncating it, and the
bound is bytes rather than characters because multibyte characters (accented
letters, emoji) can exceed 72 bytes well before 72 characters.

**Order references come from a per-user counter, not a UUID or timestamp.**
`$inc` on a single `counters` document is atomic, so two orders created in the same
millisecond for the same user still get distinct, sequential, human-readable
references (`ORD-1001`, `ORD-1002`) — the same one-document-atomic-write pattern
used everywhere else in this project in place of a transaction.

**Atlas network access is open (`0.0.0.0/0`) rather than IP-restricted**, because
Vercel's serverless functions egress from a dynamic, unpublished range of
addresses that an IP allowlist can't pin down in advance. The connection is still
authenticated (a scoped `readWrite` user, not the cluster admin) and encrypted in
transit; this is a stated tradeoff, not an oversight. The production-correct answer
is an Atlas Private Endpoint (or VPC peering, on platforms that support it) so the
database is simply unreachable from the public internet regardless of credentials
— named here rather than left for a reviewer to wonder whether it was considered.

## What I deliberately did not build

**Read-model projections.** The dashboard currently joins `orders` to each order's
latest `ledgerEntries` row per request. That's the right amount of engineering for
the data volume a take-home reviewer will ever generate, and adding a
denormalized, ledger-synced projection collection now would be complexity with no
one to benefit from it. The trigger to build one is concrete and stated above: a
user's order count reaching the low thousands, where the join shows up in
profiling rather than in theory.

**Multi-currency.** Every amount is an integer in one implicit currency with no
currency field anywhere in the schema. Supporting more than one currency isn't a
formatting change — it changes what "the order total" means (you can't sum a USD
line and an AED line into one `totalMinor`), which changes the ceiling comparison
at the center of the concurrency section. The trigger is a real second currency
being needed for a real customer, not before, because the change touches the
domain layer's core invariant, not just the UI.

**A void/reissue flow.** Refunds handle "money should come back"; nothing handles
"this order should never have existed" as a distinct action — today that's a
soft-delete on an order with no settlements, or a refund down to zero on one that
has them. A dedicated void state (as opposed to zero balance) would matter once
reporting needs to distinguish "this customer paid and was refunded in full" from
"this order was a mistake and never should have been billed" — those tell different
stories in a financial report even though they can end at the same balance, and
that's the trigger for building it.

**Rate limiting on auth.** `POST /api/auth/register` and the credentials sign-in
route have no throttling beyond bcrypt's own cost factor slowing down brute-force
attempts. That's an acceptable gap for a take-home behind a URL nobody is
scanning; it stops being acceptable the moment this sits at a public,
discoverable URL with real accounts behind it, which is the trigger — at that
point it's a per-IP-and-per-account limiter in front of both routes, not a
change to either route itself.

## What I'd improve before production

Every shortcut below is deliberate and grep-able (`grep -rn "ponytail:" src/
scripts/`); each is a documented ceiling, not a silent gap.

- **`src/server/settlements.ts`** — the retry loop in `appendEntry` uses a fixed
  bound (`MAX_ATTEMPTS = 5`) with no backoff between attempts. That's fine because
  contention here is realistically two browser tabs open on the same order, not a
  thundering herd. **Trigger:** this ever fronts something with real concurrent
  load, like a payment processor's webhook retries. **Upgrade:** add jitter or
  exponential backoff between attempts so a genuine burst spreads out instead of
  hammering the same index in lockstep.
- **`src/server/orders.ts`** — the audit row written alongside `order.created` is
  best-effort: if it fails, the order creation still succeeds and the failure is
  only logged, not surfaced or retried. **Trigger:** audit completeness becomes a
  hard compliance requirement rather than a debugging aid. **Upgrade:** an outbox
  row written in the same insert as the order, drained by a separate worker — not
  a transaction, which wouldn't survive the append-only ledger model this project
  is built around.
- **`src/server/dashboard.ts`** (latest-balance lookup) — one indexed `$lookup`
  seek per order on every dashboard page load, discussed above under "Status
  filtering and scale." **Trigger:** a user's order count reaches the low
  thousands and the join is visible in profiling. **Upgrade:** the read-model
  projection collection named in that section.
- **`src/server/dashboard.ts`** (`exportOrders`) — the CSV export loads every
  matching row into memory before writing the response; there's no pagination or
  streaming. **Trigger:** an export large enough that buffering it becomes a real
  memory concern — thousands of orders, not the dozens a take-home reviewer will
  generate. **Upgrade:** stream the aggregation cursor directly into the response
  body instead of materializing an array first.
- **`src/app/(app)/orders/[id]/settlement-actions.tsx`** — the idempotency key is
  minted fresh per form submission, not once per dialog open, so it protects
  against a resent request at the transport level but not against a user manually
  retrying after a visible failure. Covered in full under "Idempotency" above.
  **Trigger:** none identified that doesn't also make the failure mode worse —
  this one is closer to "correctly decided against" than "deferred," and is
  recorded here for completeness rather than as a plan to change it.

A few smaller, individually-verified-safe items surfaced during review are worth
naming rather than hiding: the CSV export's formula-injection guard (a leading
apostrophe before `=`, `+`, `-`, `@`) is the standard mitigation and is lossy for a
customer genuinely named `-Acme` if the file is later read by something other than
a spreadsheet application — a bare `-Acme` and an escaped `'-Acme` are not the same
string. Re-running `npm run seed` clears `orders` and `counters` but leaves
`ledgerEntries` and `auditLog` behind, so repeated local seeding accumulates
orphaned rows — harmless (still scoped to the demo user and unreachable once the
parent order is gone) but not tidy. Both are accepted trade-offs of tools built
for this project's actual scale, not defects hiding as trade-offs.
