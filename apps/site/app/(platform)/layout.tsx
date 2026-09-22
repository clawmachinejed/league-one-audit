import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AccountShell } from '@/components/account-shell';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
