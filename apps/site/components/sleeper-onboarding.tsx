'use client';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { OnboardingPreview } from '@/lib/accounts/onboarding';
import { announceAccountSessionChange } from './account-client';
import styles from './account.module.css';

export function SleeperOnboarding({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [preview, setPreview] = useState<OnboardingPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [accountId]);
  async function request(body: unknown, signal: AbortSignal) {
    const response = await fetch('/api/me/sleeper-onboarding', { method: 'POST', signal,
      credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json',
        'X-Expected-Account-ID': accountId }, body: JSON.stringify(body) });
    if (!response.ok) {
      const error: unknown = await response.json().catch(() => null);
      throw new Error(response.status === 409 ? 'Your account changed. Reload this page.'
        : response.status === 400 && error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
          ? error.message : 'The import could not be completed. Your saved leagues are safe; try again.');
    }
    return response.json();
  }
  async function search(event: FormEvent) {
    event.preventDefault();
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    setBusy(true); setMessage(''); setPreview(null); setConfirmed(false);
    try {
      const result = await request({ action: 'preview', username: username.trim().replace(/^@/u, '') }, active.signal) as OnboardingPreview;
      if (active.signal.aborted) return;
      setPreview(result); setSelected(result.teams.filter(team => team.status === 'ready').map(team => team.leagueId));
    } catch (error) { if (!active.signal.aborted) setMessage(error instanceof Error ? error.message : 'Search unavailable.'); }
    finally { if (!active.signal.aborted) setBusy(false); }
  }
  async function confirm() {
    if (!preview || !confirmed || busy) return;
    const active = new AbortController(); controller.current = active;
    setBusy(true);
    let saved = 0;
    try {
      for (const team of preview.teams.filter(team => selected.includes(team.leagueId) && team.status === 'ready')) {
        setMessage(`Adding ${team.leagueName}…`);
        await request({ action: 'confirm', userId: preview.userId, leagueId: team.leagueId, rosterId: team.rosterId }, active.signal);
        if (active.signal.aborted) return;
        saved++;
      }
      announceAccountSessionChange();
      router.push('/my-fantasy');
    } catch (error) {
      if (!active.signal.aborted) setMessage(`${saved ? `${saved} league(s) saved. ` : ''}${error instanceof Error ? error.message : 'Import unavailable.'}`);
    } finally { if (!active.signal.aborted) setBusy(false); }
  }
  return <section className={styles.section} aria-labelledby="connect-sleeper">
    <h2 id="connect-sleeper">Connect Sleeper</h2>
    <div className={styles.card}>
      <p>Find your teams, confirm them, and bring your leagues into My Fantasy.</p>
      <form className={styles.form} onSubmit={search}>
        <label className={styles.field}>Sleeper username<input value={username} onChange={event => setUsername(event.target.value)}
          autoComplete="off" maxLength={100} required disabled={busy} placeholder="Your Sleeper username" /></label>
        <button className={styles.button} type="submit" disabled={busy || !username.trim()}>Find my teams</button>
      </form>
      {message && <p role="status" className={styles.message}>{message}</p>}
      {busy && !message && <p role="status">Finding your Sleeper leagues…</p>}
      {preview && <div className={styles.confirmation}>
        <div className={styles.profileIdentity}>
          {preview.avatarUrl && <Image src={preview.avatarUrl} width={44} height={44} alt="" unoptimized />}
          <div><strong>{preview.displayName}</strong><span>@{preview.username}</span></div>
        </div>
        {!confirmed ? <>
          <h3>Is this your Sleeper account?</h3><p>{preview.season} NFL leagues</p>
          <ul className={styles.previewLeagues}>{preview.teams.map(team => <li key={team.leagueId}>{team.leagueName}</li>)}</ul>
          {!preview.teams.length && <p>No leagues were found for this season.</p>}
          <button className={styles.button} type="button" disabled={busy || !preview.teams.length} onClick={() => setConfirmed(true)}>Yes, this is my account</button>
        </> : <>
          <h3>Confirm your teams</h3>
          <p>Choose leagues to add. Your current teams from this Sleeper account will appear automatically in My Fantasy.</p>
          <ul className={styles.links}>{preview.teams.map(team => <li key={team.leagueId} className={styles.linkRow}>
            <label className={styles.onboardingTeam}>
              <input type="checkbox" checked={selected.includes(team.leagueId)} disabled={busy || team.status !== 'ready'}
                onChange={event => setSelected(current => event.target.checked ? [...current, team.leagueId] : current.filter(id => id !== team.leagueId))} />
              <Image src={team.logo ?? '/league-placeholder.svg'} width={40} height={40} alt="" unoptimized />
              <span><strong>{team.leagueName}</strong><span>{team.teamName ?? 'Team unavailable'}</span>{team.reason && <span>{team.reason}</span>}</span>
            </label>
          </li>)}</ul>
          <button className={styles.button} type="button" disabled={busy || !selected.length} onClick={() => { void confirm(); }}>Confirm teams and open My Fantasy</button>
        </>}
        <button className={styles.secondary} type="button" disabled={busy} onClick={() => { setPreview(null); setConfirmed(false); }}>Wrong account</button>
        <p className={styles.hint}>Your Sleeper password is never needed. This confirms your selection and grants no commissioner access.</p>
      </div>}
    </div>
  </section>;
}
