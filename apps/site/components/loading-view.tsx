export function LoadingView() {
  return <div className="loading-view" aria-busy="true" role="status"><span className="eyebrow">LEAGUE ONE</span><h1>Loading the league<span className="loading-dots">…</span></h1><p className="page-description">Getting the latest from Sleeper.</p><div className="loading-skeleton"><span /><span /><span /></div><span className="sr-only">League data is loading.</span></div>;
}
