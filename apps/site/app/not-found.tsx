'use client';

import Link from 'next/link';
import { useLeagueSite } from '@/components/league-context';

export default function NotFound() {
  const site = useLeagueSite();
  return <section className="empty-state"><p className="eyebrow">OFF THE FIELD</p><h1>Page not found</h1><p>This owner or page isn’t part of {site.name}.</p><Link href={`${site.prefix}/owners`} className="text-button not-found-link">Back to owners</Link></section>;
}
