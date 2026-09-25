'use client';

import Link from 'next/link';
import Image from 'next/image';
import { SITE_LOGO } from '@/lib/leagues';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import styles from './account.module.css';

export function AccountShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div className={styles.shell}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className={styles.header}>
      <Link className={styles.brand} href="/my-fantasy" prefetch={false}><Image src={SITE_LOGO} width={42} height={42} alt="" />LEAGUE ONE<span className="brand-period">.</span></Link>
      <nav className={styles.nav} aria-label="Account navigation">
        {([['/my-fantasy', 'My Fantasy'], ['/my-leagues', 'My leagues'], ['/account', 'Account'], ['/sign-in', 'Sign in']] as const).map(([href, label]) =>
          <Link key={href} href={href} prefetch={false} aria-current={pathname === href ? 'page' : undefined}>{label}</Link>)}
      </nav>
    </header>
    <main id="main-content" className={styles.main} tabIndex={-1}>{children}</main>
  </div>;
}
