'use client';

import Link from 'next/link';

export default function ErrorPage({ retry }: { retry: () => void }) {
  return <main id="main-content" className="main-content" tabIndex={-1}>
    <div className="error-view"><p className="eyebrow">A QUICK TIMEOUT</p><h1>We couldn’t load this page.</h1>
      <p>Please try again.</p><button className="primary-button" type="button" onClick={retry}>Try again</button>
      <Link href="/" className="text-button">Back to home</Link>
    </div>
  </main>;
}
