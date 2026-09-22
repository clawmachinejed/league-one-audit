import type { Metadata } from 'next';
import { AccountSignIn } from '@/components/account-sign-in';
import { getAccountAuthAvailability } from '@/lib/accounts/auth';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default function SignInPage() {
  const availability = getAccountAuthAvailability();
  return <AccountSignIn key={availability} availability={availability} />;
}
