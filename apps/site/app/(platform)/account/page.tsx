import type { Metadata } from 'next';
import { AccountWorkspace } from '@/components/account-workspace';
import { getAccountAuthAvailability } from '@/lib/accounts/auth';

export const metadata: Metadata = { title: 'Account' };
export const dynamic = 'force-dynamic';

export default function AccountPage() {
  const availability = getAccountAuthAvailability();
  return <AccountWorkspace key={availability} availability={availability} view="account" />;
}
