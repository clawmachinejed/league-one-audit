'use client';

import { useState, type FormEvent } from 'react';
import type { AccountView } from '@/lib/accounts/contracts';
import type { AccountMutation } from './account-library';
import styles from './account.module.css';

export function AccountProfile({ data, mutate, busy }: { data: AccountView; mutate: AccountMutation; busy: boolean }) {
  const [displayName, setDisplayName] = useState(data.profile.displayName);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const available = data.library.availableProviderAccounts.filter(account => !data.links.some(link => link.sourceManagerAccountId === account.id));
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate('/api/me/profile', 'PATCH', { displayName: displayName.trim(), revision: data.profile.revision });
  }
  async function linkAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount || !confirmed) return;
    await mutate('/api/me/provider-links', 'POST', { sourceManagerAccountId: selectedAccount });
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
          <div><strong>{link.displayName}</strong><p>Sleeper · User supplied</p></div>
          <button className={styles.secondary} type="button" disabled={busy} onClick={() => { void mutate(`/api/me/provider-links/${encodeURIComponent(link.id)}`, 'DELETE', { revision: link.revision }); }}>Remove association</button>
        </li>)}</ul> : <p>No Sleeper profile is associated with this website account.</p>}
        {available.length > 0 && <form className={styles.form} onSubmit={linkAccount}>
          <label className={styles.field}>Choose a Sleeper profile<select value={selectedAccount} required disabled={busy} onChange={event => { setSelectedAccount(event.target.value); setConfirmed(false); }}>
            <option value="">Select a profile</option>{available.map(account => <option key={account.id} value={account.id}>{account.displayName}{account.username ? ` (@${account.username})` : ''}</option>)}
          </select></label>
          <label className={styles.hint}><input type="checkbox" checked={confirmed} disabled={busy || !selectedAccount} onChange={event => setConfirmed(event.target.checked)} /> I want this public Sleeper profile to personalize my account.</label>
          <div className={styles.actions}><button className={styles.button} type="submit" disabled={busy || !selectedAccount || !confirmed}>Associate profile</button></div>
        </form>}
        <p>Profiles come from the three supported leagues. Your Sleeper password is never needed.</p>
      </div>
    </section>
  </>;
}
