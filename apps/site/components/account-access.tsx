import Image from 'next/image';
import Link from 'next/link';
import { LEAGUE_SITES } from '@/lib/leagues';
import styles from './account.module.css';

export type AccountAvailability = 'disabled' | 'unavailable' | 'available';
export type AccountAccessState = 'disabled' | 'unavailable' | 'guest' | 'denied';

export function AccountPublicLeagues() {
  return <section className={styles.section} aria-labelledby="public-leagues-heading">
    <h2 id="public-leagues-heading">Browse the leagues</h2>
    <div className={styles.grid}>{Object.values(LEAGUE_SITES).map(site => <article className={styles.card} key={site.key}>
      <div className={styles.cardHeader}><Image src={site.logo} alt="" width={42} height={42} /><h3>{site.name}</h3></div>
      <p>Matchups, standings and managers are available without an account.</p>
      <div className={styles.actions}><Link className={styles.secondary} href={`${site.prefix}/matchups`} prefetch={false}>View {site.name}</Link></div>
    </article>)}</div>
  </section>;
}

export function AccountAccessNotice({ state, retry }: { state: AccountAccessState; retry?: () => void }) {
  const message = state === 'disabled' ? 'Accounts are being prepared. You can continue browsing all three leagues.'
    : state === 'guest' ? 'Sign in to save your leagues and account preferences across devices.'
      : state === 'denied' ? 'Accounts are currently available to invited members with a verified email address. Public league browsing is still available.'
        : 'Accounts are temporarily unavailable. Your league pages are still available.';
  return <>
    <section className={styles.card}><p>{message}</p>
      <div className={styles.actions}>
        {(state === 'guest' || state === 'denied') && <Link href="/sign-in" className={styles.button} prefetch={false}>{state === 'denied' ? 'Return to sign in' : 'Sign in'}</Link>}
        {state === 'unavailable' && retry && <button type="button" className={styles.secondary} onClick={retry}>Try again</button>}
      </div>
    </section>
    <AccountPublicLeagues />
  </>;
}
