'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Image from 'next/image';
import type { AccountView, SleeperLinkPreview } from '@/lib/accounts/contracts';
import type { AccountMutation } from './account-library';
import { readSleeperLinkPreview } from './account-client';
import styles from './account.module.css';

export function AccountProfile({ data, mutate, busy }: { data: AccountView; mutate: AccountMutation; busy: boolean }) {
  const [displayName, setDisplayName] = useState(data.profile.displayName);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [preview, setPreview] = useState<SleeperLinkPreview | null>(null);
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'loading' | 'unavailable'>('idle');
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [profileConfirmed, setProfileConfirmed] = useState(false);
  const [teamIndex, setTeamIndex] = useState(0);
  const available = data.library.availableProviderAccounts.filter(account => !data.links.some(link => link.sourceManagerAccountId === account.id));
  const availableIds = available.map(account => account.id).join('|');
  useEffect(() => {
    if (!selectedAccount || !availableIds.split('|').includes(selectedAccount)) return;
    const controller = new AbortController();
    void readSleeperLinkPreview(data.profile.id, selectedAccount, controller.signal).then(result => {
      if (!controller.signal.aborted) { setPreview(result); setPreviewStatus('idle'); }
    }).catch(() => {
      if (!controller.signal.aborted) { setPreview(null); setPreviewStatus('unavailable'); }
    });
    return () => controller.abort();
  // The account ID and selected source are the request's identity boundary; changing either discards the old preview.
  }, [data.profile.id, availableIds, selectedAccount, previewAttempt]);
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate('/api/me/profile', 'PATCH', { displayName: displayName.trim(), revision: data.profile.revision });
  }
  function selectAccount(id: string) {
    setSelectedAccount(id);
    setPreview(null);
    setPreviewStatus(id ? 'loading' : 'idle');
    setProfileConfirmed(false);
    setTeamIndex(0);
  }
  async function confirmTeam() {
    if (!preview || preview.sourceManagerAccountId !== selectedAccount || !availableIds.split('|').includes(selectedAccount)
      || !profileConfirmed || !preview.teams[teamIndex]) return;
    if (await mutate('/api/me/provider-links', 'POST', { sourceManagerAccountId: selectedAccount })) selectAccount('');
  }
  return <>
    <section className={styles.section} aria-labelledby="profile-heading"><h2 id="profile-heading">Your profile</h2>
      <form className={`${styles.card} ${styles.form}`} onSubmit={saveProfile}>
        <label className={styles.field}>Website display name<input name="displayName" autoComplete="nickname" value={displayName} onChange={event => setDisplayName(event.target.value)} required maxLength={100} disabled={busy} /></label>
        <p className={styles.hint}>This name is separate from your Sleeper username.</p>
        <div className={styles.actions}><button className={styles.button} type="submit" disabled={busy || !displayName.trim() || displayName.trim() === data.profile.displayName}>Save name</button></div>
      </form>
    </section>
    <section className={styles.section} aria-labelledby="provider-heading"><h2 id="provider-heading">Sleeper associations</h2>
      <div className={styles.card}>
        <p>Associate an existing Sleeper profile to personalize your league list. This is a user-supplied association, not verification that you control the Sleeper account. It grants no administrative access.</p>
        {data.links.length > 0 ? <ul className={styles.links}>{data.links.map(link => <li key={link.id} className={styles.linkRow}>
          <div><strong>{link.displayName}</strong><p>Sleeper · User confirmed; ownership not verified</p></div>
          <button className={styles.secondary} type="button" disabled={busy} onClick={() => { void mutate(`/api/me/provider-links/${encodeURIComponent(link.id)}`, 'DELETE', { revision: link.revision }); }}>Remove association</button>
        </li>)}</ul> : <p>No Sleeper profile is associated with this website account.</p>}
        {available.length > 0 && <div className={styles.form}>
          <label className={styles.field}>Choose a Sleeper profile<select value={selectedAccount} disabled={busy} onChange={event => selectAccount(event.target.value)}>
            <option value="">Select a profile</option>{available.map(account => <option key={account.id} value={account.id}>{account.displayName}{account.username ? ` (@${account.username})` : ''}</option>)}
          </select></label>
          {selectedAccount && previewStatus === 'loading' && <p className={styles.hint} role="status">Finding Sleeper account and teams…</p>}
          {selectedAccount && previewStatus === 'unavailable' && <div>
            <p className={`${styles.message} ${styles.error}`} role="status">We could not confirm this Sleeper profile right now. No association was made.</p>
            <button className={styles.secondary} type="button" onClick={() => { setPreviewStatus('loading'); setPreviewAttempt(value => value + 1); }}>Try again</button>
          </div>}
          {preview?.sourceManagerAccountId === selectedAccount && <div className={styles.confirmation}>
            <div className={styles.profileIdentity}>
              {preview.avatarUrl && <Image src={preview.avatarUrl} alt="" width={44} height={44} unoptimized />}
              <div><strong>{preview.displayName}</strong><span>@{preview.username}</span></div>
            </div>
            {!profileConfirmed ? <>
              <h3>Is this your Sleeper account?</h3>
              <p>{preview.season} NFL leagues</p>
              {preview.leagues.length ? <ul className={styles.previewLeagues}>{preview.leagues.map(league => <li key={league.id}>{league.name}</li>)}</ul>
                : <p>No leagues found for this season. Choose another profile or try again later.</p>}
              <div className={styles.actions}>
                <button className={styles.button} type="button" disabled={busy || !preview.leagues.length} onClick={() => setProfileConfirmed(true)}>Yes, this is my account</button>
                <button className={styles.secondary} type="button" disabled={busy} onClick={() => selectAccount('')}>Wrong account</button>
              </div>
            </> : <>
              <h3>Is this your team?</h3>
              {preview.teams[teamIndex] ? <>
                <p><strong>{preview.teams[teamIndex].teamName}</strong> · {preview.teams[teamIndex].leagueName}</p>
                {preview.teams[teamIndex].players.length > 0 && <p>Current roster: {preview.teams[teamIndex].players.join(' · ')}</p>}
                <div className={styles.actions}>
                  <button className={styles.button} type="button" disabled={busy} onClick={() => { void confirmTeam(); }}>Yes, this is my team</button>
                  <button className={styles.secondary} type="button" disabled={busy || preview.teams.length < 2} onClick={() => setTeamIndex(index => (index + 1) % preview.teams.length)}>Wrong team</button>
                  <button className={styles.secondary} type="button" disabled={busy} onClick={() => selectAccount('')}>Wrong account</button>
                </div>
                {preview.teams.length < 2 && <p>Only one team could be matched to this profile. Choose Wrong account if it is not yours.</p>}
              </> : <p>We could not find a current team to confirm for this profile. Try another profile or try again later.</p>}
            </>}
          </div>}
        </div>}
        <p>Profiles come from the three supported leagues. Your Sleeper password is never needed.</p>
      </div>
    </section>
  </>;
}
