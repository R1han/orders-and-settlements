import { formatMinor } from '../src/domain/money';
import { closeDb, counters, ensureIndexes, orders, users } from '../src/server/db';
import { createOrder } from '../src/server/orders';
import { appendEntry } from '../src/server/settlements';
import { registerUser } from '../src/server/users';
import { DomainError } from '../src/domain/errors';

const EMAIL = 'demo@example.com';
const PASSWORD = 'demo-password-123';

function step(label: string, detail: string) {
  console.log(`  ${label.padEnd(34)} ${detail}`);
}

async function main() {
  await ensureIndexes();

  const existing = await (await users()).findOne({ email: EMAIL });
  const userId = existing?._id ?? (await registerUser(EMAIL, PASSWORD));
  if (existing) {
    // Reset the demo user's orders and their reference sequence so a second run
    // reproduces the same output rather than drifting to ORD-1002, ORD-1003…
    await (await orders()).deleteMany({ userId });
    await (await counters()).deleteOne({ _id: userId });
  }

  console.log(`\nDemo account: ${EMAIL} / ${PASSWORD}\n`);
  console.log('Replaying the sample scenario:\n');

  const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const order = await createOrder(userId, {
    customer: 'Acme FZ-LLC',
    dueDate,
    lines: [{ description: 'Consulting retainer', quantity: 2, unitPriceMinor: 50_000 }],
  });
  step('1. Create 2 x 500.00', `${order.ref}, total ${formatMinor(order.totalMinor)}, status ${order.status}`);

  const now = new Date();
  const first = await appendEntry(userId, order.id, {
    kind: 'payment', amountMinor: 40_000, occurredAt: now,
  }, now);
  step('2. Pay 400.00', `status ${first.view.status}, due ${formatMinor(first.view.dueMinor)}`);

  const second = await appendEntry(userId, order.id, {
    kind: 'payment', amountMinor: 60_000, occurredAt: now,
  }, now);
  step('3. Pay 600.00', `status ${second.view.status}, due ${formatMinor(second.view.dueMinor)}`);

  try {
    await appendEntry(userId, order.id, { kind: 'payment', amountMinor: 100, occurredAt: now }, now);
    step('4. Pay 1.00', 'ACCEPTED — this is a bug, the invariant did not hold');
    process.exitCode = 1;
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    const max = Number(error.details.maxAllowedMinor ?? 0);
    step('4. Pay 1.00', `REJECTED ${error.code}, max allowed ${formatMinor(max)}`);
  }

  console.log(`\nOrder: /orders/${order.id}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
