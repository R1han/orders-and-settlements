/** An integer number of minor currency units (fils/cents). Never fractional. */
export type Minor = number;

export type OrderStatus = 'pending' | 'partially_paid' | 'paid' | 'overdue';
export type LedgerKind = 'payment' | 'refund';

export interface LineItemInput {
  description: string;
  quantity: number;
  unitPriceMinor: Minor;
}

export interface LineItem extends LineItemInput {
  lineTotalMinor: Minor;
}

export interface OrderTotals {
  lines: LineItem[];
  subtotalMinor: Minor;
  totalMinor: Minor;
}

export interface Balance {
  paidMinor: Minor;
  refundedMinor: Minor;
  netPaidMinor: Minor;
}

export const ZERO_BALANCE: Balance = { paidMinor: 0, refundedMinor: 0, netPaidMinor: 0 };
