import Link from 'next/link';
import styles from './account.module.css';

export function AccountNotFound() {
  return <section className={styles.card}><h1>Page not found</h1><p>This account page could not be found.</p>
    <div className={styles.actions}><Link className={styles.button} href="/my-leagues" prefetch={false}>Back to my leagues</Link></div>
  </section>;
}
