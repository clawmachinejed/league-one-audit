import type { Metadata } from 'next';
import { AccountWorkspace } from '@/components/account-workspace';
import { getAccountAuthAvailability } from '@/lib/accounts/auth';

export const metadata: Metadata = { title: 'My leagues' };
export const dynamic = 'force-dynamic';

export default function MyLeaguesPage() {
  const availability = getAccountAuthAvailability();
  return <AccountWorkspace key={availability} availability={availability} view="library" />;
}
