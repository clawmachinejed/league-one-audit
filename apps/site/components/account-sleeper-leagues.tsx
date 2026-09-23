'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AccountLink, SleeperLeagueDiscovery } from '@/lib/accounts/contracts';
import type { CapabilityStatus, LeagueCapabilityReport } from '@/lib/league-capability-contracts';
import { readSleeperLeagues, type SleeperLeagueRead } from './account-client';
import styles from './account.module.css';

type DiscoveryState = SleeperLeagueRead | { status: 'loading' };

const capabilityLabels: Record<CapabilityStatus, string> = {
  supported: 'Supported', limited: 'Limited', unsupported: 'Unsupported', unverified: 'Unverified',
};

function LeagueCompatibility({ report }: { report: LeagueCapabilityReport | undefined }) {
  const status = report?.status ?? 'unverified';
  return <details className={styles.compatibility}>
    <summary>Website compatibility <span className={styles.compatibilityStatus} data-status={status}>{capabilityLabels[status]}</span></summary>
    <p>Settings check only. This does not enable website pages for additional leagues.</p>
    {report ? <ul className={styles.capabilityList} aria-label="Feature compatibility">{report.features.map(feature => <li key={feature.id}>
      <div className={styles.capabilityTitle}><strong>{feature.label}</strong>
        <span className={styles.compatibilityStatus} data-status={feature.status}>{capabilityLabels[feature.status]}</span></div>
      <ul className={styles.capabilityReasons}>{feature.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
      {Boolean(feature.ruleKeys?.length) && <p>Settings: {feature.ruleKeys?.join(', ')}</p>}
    </li>)}</ul> : <p>We could not check these league settings. Reload My leagues to try again.</p>}
  </details>;
}

export function SleeperLeagueResults({ data }: { data: SleeperLeagueDiscovery }) {
  const missing = data.profiles.filter(profile => profile.status === 'unavailable').map(profile => profile.displayName);
  return <>
    {data.season && <p className={styles.hint}>{data.season} NFL season · {data.profiles.map(profile => profile.displayName).join(', ')}</p>}
    {data.status === 'unavailable' && <p className={`${styles.message} ${styles.error}`} role="status">Sleeper leagues are temporarily unavailable.</p>}
    {data.status === 'partial' && <p className={`${styles.message} ${styles.error}`} role="status">Could not load leagues for {missing.join(', ')}. Available results are shown below.</p>}
    {data.status === 'complete' && !data.leagues.length && <p className={styles.hint}>
      {data.profiles.length ? `No NFL leagues found for your associated Sleeper ${data.profiles.length === 1 ? 'account' : 'accounts'} in ${data.season}.`
        : 'No Sleeper account is currently associated. Manage your associations in Account.'}
    </p>}
    {data.leagues.length > 0 && <div className={`${styles.grid} ${styles.discoveryGrid}`}>{data.leagues.map(league => <article className={styles.card} key={league.id}>
      <h3>{league.name}</h3>
      <p>{data.profiles.filter(profile => league.sourceManagerAccountIds.includes(profile.sourceManagerAccountId)).map(profile => profile.displayName).join(', ')}</p>
      <LeagueCompatibility report={league.capabilities} />
      <div className={styles.actions}><a className={styles.secondary} href={`https://sleeper.com/leagues/${league.id}`}>Open in Sleeper</a></div>
    </article>)}</div>}
  </>;
}

function SleeperLeagueRequest({ accountId }: { accountId: string }) {
  const [state, setState] = useState<DiscoveryState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void readSleeperLeagues(accountId, controller.signal).then(result => {
      if (!controller.signal.aborted) setState(result);
    }).catch(() => {
      if (!controller.signal.aborted) setState({ status: 'unavailable' });
    });
    return () => controller.abort();
  }, [accountId, attempt]);

  const retry = state.status === 'unavailable' || state.status === 'ready' && state.data.status !== 'complete';
  return <>
    {state.status === 'loading' ? <p className={styles.hint} role="status">Loading Sleeper leagues…</p>
      : state.status === 'unavailable' ? <p className={`${styles.message} ${styles.error}`} role="status">Sleeper leagues are temporarily unavailable.</p>
        : <SleeperLeagueResults data={state.data} />}
    {retry && <div className={styles.actions}><button className={styles.secondary} type="button" onClick={() => {
      setState({ status: 'loading' });
      setAttempt(value => value + 1);
    }}>Try again</button></div>}
  </>;
}

export function AccountSleeperLeagues({ accountId, links }: { accountId: string; links: AccountLink[] }) {
  const scope = JSON.stringify([accountId, links.map(link => [link.id, link.sourceManagerAccountId, link.revision])]);
  return <section className={styles.section} aria-labelledby="sleeper-leagues-heading">
    <h2 id="sleeper-leagues-heading">Sleeper leagues</h2>
    {links.length ? <SleeperLeagueRequest key={scope} accountId={accountId} />
      : <p className={styles.hint}>Associate a Sleeper account in <Link href="/account" prefetch={false}>Account</Link> to see its leagues.</p>}
  </section>;
}
