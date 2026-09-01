'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from './icon';

export function ErrorView({ message, retry }: { message?: string; retry?: () => void }) {
  const router = useRouter();
  return <div className="error-view"><p className="eyebrow">A QUICK TIMEOUT</p><h1>We couldn’t load the league.</h1><p>{message || 'Sleeper may be taking a moment. League One and your saved team selection are still here.'}</p><button className="primary-button" type="button" onClick={retry || (() => router.refresh())}><Icon name="refresh" />Try again</button><Link href="/matchups" className="text-button">Back to matchups</Link></div>;
}
