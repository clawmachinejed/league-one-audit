'use client';

import { useLeagueSite } from './league-context';

export function LoadingView() {
  const site = useLeagueSite();
  return <div className="loading-view" aria-busy="true" role="status"><span className="eyebrow">{site.brand}</span><h1>Loading the league<span className="loading-dots">…</span></h1><p className="page-description">Getting the latest from Sleeper.</p><div className="loading-skeleton"><span /><span /><span /></div><span className="sr-only">{site.name} data is loading.</span></div>;
}
