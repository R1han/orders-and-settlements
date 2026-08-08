import Link from 'next/link';
import { OrderForm } from './order-form';

export default function NewOrderPage() {
  return (
    <div className="max-w-[880px] px-8 pb-12 pt-[22px]">
      <Link href="/" className="mb-4 flex items-center gap-1.5 text-[12.5px] text-fg-muted">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Orders
      </Link>
      <h1 className="mb-5 text-title">New order</h1>
      <OrderForm />
    </div>
  );
}
