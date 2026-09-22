'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { LibraryLeague, LibraryView } from '@/lib/accounts/contracts';
import { LEAGUE_SITES } from '@/lib/leagues';
import styles from './account.module.css';

export type AccountMutation = (path: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body: unknown) => Promise<boolean>;

export function leagueRelationship(league: LibraryLeague): 'Participating' | 'Last-known participation' | 'Following' | 'Linked league' | 'Available' {
  if (league.teams.length) return league.teams.some(team => team.freshness === 'current') ? 'Participating' : 'Last-known participation';
  if (league.saved) return 'Following';
  if (league.linkedFromLeagueIds.length) return 'Linked league';
  return 'Available';
}

export function AccountLibrary({ library, mutate, busy }: { library: LibraryView; mutate: AccountMutation; busy: boolean }) {
  const groups = [
    { title: 'Your leagues', leagues: library.leagues.filter(league => league.teams.length || league.saved) },
    { title: 'Linked leagues', leagues: library.leagues.filter(league => !league.teams.length && !league.saved && league.linkedFromLeagueIds.length) },
    { title: 'Available leagues', leagues: library.leagues.filter(league => !league.teams.length && !league.saved && !league.linkedFromLeagueIds.length) },
  ];
  return <>{groups.filter(group => group.leagues.length).map(group => <section key={group.title} className={styles.section}>
    <h2>{group.title}</h2><div className={styles.grid}>{group.leagues.map(league => {
      const site = LEAGUE_SITES[league.key];
      const relationship = leagueRelationship(league);
      const saved = league.saved;
      const save = (favorite: boolean) => mutate(`/api/me/leagues/${encodeURIComponent(league.id)}`, 'PUT', {
        favorite, sortPosition: saved?.sortPosition ?? library.leagues.length,
        preferredSeasonTeamId: saved?.preferredSeasonTeamId ?? null, revision: saved?.revision ?? null,
      });
      return <article className={styles.card} key={league.id}>
        <span className={`${styles.badge} ${league.teams.length ? styles.participating : ''}`}>{relationship}</span>
        <div className={styles.cardHeader}><Image src={site.logo} alt="" width={42} height={42} /><h3>{league.name}</h3></div>
        {league.season !== null && <p>{league.season} season</p>}
        {league.teams.length > 0 && <p>Matches your associated Sleeper account{league.teams.some(team => team.roles.includes('co_owner')) ? ' as an owner or co-owner' : ''}. This association is user supplied.</p>}
        {league.linkedFromLeagueIds.length > 0 && <p>Linked to {library.leagues.filter(source => league.linkedFromLeagueIds.includes(source.id)).map(source => source.name).join(', ') || 'a related league'}. This does not mean you manage a team here.</p>}
        {league.sourceState === 'stale' && <p>{league.teams.length > 0 ? 'Participation is last known. Fresh league evidence is not available yet.' : 'League roster information is waiting for a fresh update.'}</p>}
        {league.sourceState === 'unavailable' && <p>Participation is temporarily unavailable. Saved follows remain available.</p>}
        <div className={styles.actions}>
          <Link className={styles.button} href={`${site.prefix}/matchups`} prefetch={false}>Open league</Link>
          <button className={styles.secondary} type="button" disabled={busy} onClick={() => { void save(saved ? !saved.favorite : false); }}>
            {saved?.favorite ? 'Remove favorite' : saved ? 'Favorite' : 'Save league'}
          </button>
          {saved && <button className={styles.secondary} type="button" disabled={busy} onClick={() => { void mutate(`/api/me/leagues/${encodeURIComponent(league.id)}`, 'DELETE', { revision: saved.revision }); }}>Unfollow</button>}
        </div>
      </article>;
    })}</div>
  </section>)}
    {!library.leagues.some(league => league.teams.length || league.saved) && <p className={styles.hint}>Save a league below, or associate your Sleeper account in <Link href="/account" prefetch={false}>Account</Link> to find your participation.</p>}
  </>;
}
