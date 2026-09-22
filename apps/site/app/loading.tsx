export default function Loading() {
  return <main id="main-content" className="main-content" tabIndex={-1}>
    <div className="loading-view" aria-busy="true" role="status"><h1>Loading<span className="loading-dots">…</span></h1></div>
  </main>;
}
