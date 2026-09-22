import Link from 'next/link';

export default function NotFound() {
  return <section className="empty-state"><p className="eyebrow">OFF THE FIELD</p><h1>Page not found</h1><p>This manager or page isn’t part of League Two.</p><Link href="/league2/managers" className="text-button not-found-link">Back to managers</Link></section>;
}
