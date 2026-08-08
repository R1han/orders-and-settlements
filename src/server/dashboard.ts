import type { Document, ObjectId } from 'mongodb';
import type { OrderStatus } from '@/domain/types';
import { orders, type OrderDoc } from './db';
import type { OrderView } from './orders';

export interface ListParams {
  status?: OrderStatus;
  page: number;
  pageSize: number;
  from?: Date;
  to?: Date;
}

export interface ListResult {
  orders: OrderView[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Mirrors deriveStatus() in src/domain/status.ts. These are two encodings of one
 * rule and will drift unless watched — tests/integration/dashboard.test.ts asserts
 * they agree across a fixture matrix.
 *
 * The overdue comparison uses $dateTrunc on both sides rather than reconstructing
 * end-of-day: now > endOfDayUtc(due) is true exactly when now falls on a later UTC
 * day than due, which is what truncating both to day and comparing says directly.
 */
export function statusExpression(now: Date): Document {
  const nowDay = { $dateTrunc: { date: now, unit: 'day' as const } };
  const dueDay = { $dateTrunc: { date: '$dueDate', unit: 'day' as const } };
  return {
    $switch: {
      branches: [
        { case: { $gte: ['$netPaidMinor', '$totalMinor'] }, then: 'paid' },
        { case: { $gt: [nowDay, dueDay] }, then: 'overdue' },
        { case: { $gt: ['$netPaidMinor', 0] }, then: 'partially_paid' },
      ],
      default: 'pending',
    },
  };
}

/**
 * Everything up to and including status derivation, shared by the list, the summary
 * bar and the CSV export. One definition means the headline totals can never be
 * computed by different rules than the rows beneath them.
 */
function derivationStages(
  userId: ObjectId,
  params: { status?: OrderStatus; from?: Date; to?: Date },
  now: Date,
): Document[] {
  const match: Document = { userId, deletedAt: null };
  if (params.from || params.to) {
    match.dueDate = {
      ...(params.from ? { $gte: params.from } : {}),
      ...(params.to ? { $lte: params.to } : {}),
    };
  }

  return [
    { $match: match },
    {
      // ponytail: one indexed seek per order via order_seq_unique — fine for a
      // dashboard page. Past a few thousand orders per user, maintain a read-model
      // collection written alongside each ledger entry.
      $lookup: {
        from: 'ledgerEntries',
        let: { oid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$orderId', '$$oid'] } } },
          { $sort: { seq: -1 } },
          { $limit: 1 },
          { $project: { _id: 0, balanceAfter: 1 } },
        ],
        as: 'latest',
      },
    },
    {
      $addFields: {
        paidMinor: { $ifNull: [{ $first: '$latest.balanceAfter.paidMinor' }, 0] },
        refundedMinor: { $ifNull: [{ $first: '$latest.balanceAfter.refundedMinor' }, 0] },
      },
    },
    { $addFields: { netPaidMinor: { $subtract: ['$paidMinor', '$refundedMinor'] } } },
    {
      $addFields: {
        status: statusExpression(now),
        dueMinor: { $max: [0, { $subtract: ['$totalMinor', '$netPaidMinor'] }] },
      },
    },
    ...(params.status ? [{ $match: { status: params.status } }] : []),
    { $sort: { createdAt: -1, _id: -1 } },
  ];
}

const MAX_PAGE = 10_000;

export async function listOrders(userId: ObjectId, params: ListParams, now: Date): Promise<ListResult> {
  // Number() parses "Infinity" and "1e21", and an unclamped value reaches $skip,
  // which rejects anything it cannot hold in 64 bits — surfacing as a 500 rather
  // than an empty page. Clamp both ends and reject non-finite input explicitly
  // rather than relying on Math.min/Math.max happening to absorb it.
  const requestedPage = Math.trunc(params.page);
  const page = Number.isFinite(requestedPage) ? Math.min(MAX_PAGE, Math.max(1, requestedPage || 1)) : 1;
  const requestedPageSize = Math.trunc(params.pageSize);
  const pageSize = Number.isFinite(requestedPageSize)
    ? Math.min(100, Math.max(1, requestedPageSize || 20))
    : 20;

  const [result] = await (await orders())
    .aggregate<{ rows: Row[]; count: { value: number }[] }>([
      ...derivationStages(userId, params, now),
      {
        $facet: {
          rows: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }],
          count: [{ $count: 'value' }],
        },
      },
    ])
    .toArray();

  return {
    orders: (result?.rows ?? []).map(rowToView),
    total: result?.count[0]?.value ?? 0,
    page,
    pageSize,
  };
}

export interface DashboardSummary {
  outstandingMinor: number;
  overdueMinor: number;
  openCount: number;
  totalCount: number;
}

/** The three figures in the dashboard's summary bar, by the same rules as the rows. */
export async function dashboardSummary(userId: ObjectId, now: Date): Promise<DashboardSummary> {
  const rows = await (await orders()).aggregate<{ status: OrderStatus; dueMinor: number }>([
    ...derivationStages(userId, {}, now),
    { $project: { _id: 0, status: 1, dueMinor: 1 } },
  ]).toArray();

  const open = rows.filter((row) => row.status !== 'paid');
  return {
    outstandingMinor: open.reduce((total, row) => total + row.dueMinor, 0),
    overdueMinor: rows.filter((row) => row.status === 'overdue')
      .reduce((total, row) => total + row.dueMinor, 0),
    openCount: open.length,
    totalCount: rows.length,
  };
}

/** An order document with the derived fields the pipeline adds. */
export type Row = OrderDoc & {
  paidMinor: number;
  refundedMinor: number;
  netPaidMinor: number;
  dueMinor: number;
  status: OrderStatus;
};

export function rowToView(row: Row): OrderView {
  return {
    id: row._id.toHexString(),
    ref: row.ref,
    customer: row.customer,
    dueDate: row.dueDate.toISOString(),
    lines: row.lines,
    subtotalMinor: row.subtotalMinor,
    totalMinor: row.totalMinor,
    paidMinor: row.paidMinor,
    refundedMinor: row.refundedMinor,
    netPaidMinor: row.netPaidMinor,
    dueMinor: row.dueMinor,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}
