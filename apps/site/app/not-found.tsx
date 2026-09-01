import Link from 'next/link';
export default function NotFound() {
  return <section className="empty-state"><p className="eyebrow">OFF THE FIELD</p><h1>Page not found</h1><p>This owner or page isn’t part of the current league.</p><Link href="/owners" className="text-button not-found-link">Back to owners</Link></section>;
}
