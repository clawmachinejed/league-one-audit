import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AccountShell } from '@/components/account-shell';
import { SITE_LOGO } from '@/lib/leagues';

export const metadata: Metadata = { robots: { index: false, follow: false }, icons: { icon: SITE_LOGO, apple: SITE_LOGO } };

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
