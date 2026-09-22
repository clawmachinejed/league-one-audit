'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AccountAccessNotice, type AccountAvailability } from './account-access';
import { AccountLibrary, type AccountMutation } from './account-library';
import { AccountProfile } from './account-profile';
import { ACCOUNT_SESSION_EVENT, accountResponseState, announceAccountSessionChange, readAccount, type AccountRead } from './account-client';
import styles from './account.module.css';

type WorkspaceState = AccountRead | { status: 'loading' };

export function AccountWorkspace({ availability, view }: { availability: AccountAvailability; view: 'library' | 'account' }) {
  const [state, setState] = useState<WorkspaceState>(() => availability === 'available' ? { status: 'loading' } : { status: availability });
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);

  const reload = useCallback(() => {
    generation.current += 1;
    request.current?.abort();
    setState({ status: 'loading' });
    setBusy(false);
    setRefresh(value => value + 1);
  }, []);

  useEffect(() => {
    if (availability !== 'available') return;
    const scope = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    void readAccount(controller.signal).then(result => {
      if (generation.current === scope && !controller.signal.aborted) setState(result);
    }).catch(() => {
      if (generation.current === scope && !controller.signal.aborted) setState({ status: 'unavailable' });
    });
    return () => { generation.current += 1; controller.abort(); };
  }, [availability, refresh]);

  useEffect(() => {
    if (availability !== 'available') return;
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    const onRestore = (event: PageTransitionEvent) => { if (event.persisted) reload(); };
    let channel: BroadcastChannel | null = null;
    try { if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(ACCOUNT_SESSION_EVENT); }
    catch { /* Visibility and focus checks remain available when cross-tab messaging is blocked. */ }
    if (channel) channel.onmessage = reload;
    window.addEventListener(ACCOUNT_SESSION_EVENT, reload);
    window.addEventListener('focus', reload);
    window.addEventListener('pageshow', onRestore);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      channel?.close();
      window.removeEventListener(ACCOUNT_SESSION_EVENT, reload);
      window.removeEventListener('focus', reload);
      window.removeEventListener('pageshow', onRestore);
      document.removeEventListener('visibilitychange', onVisible);
      request.current?.abort();
    };
  }, [availability, reload]);

  const mutate: AccountMutation = async (path, method, body) => {
    if (busy || state.status !== 'ready') return false;
    request.current?.abort();
    const scope = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch(path, { method, body: JSON.stringify(body), signal: controller.signal,
        cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json',
          'X-Expected-Account-ID': state.data.profile.id } });
      if (generation.current !== scope || controller.signal.aborted) return false;
      if (response.status === 409) {
        const conflict: unknown = await response.json().catch(() => null);
        if (generation.current !== scope || controller.signal.aborted) return false;
        const accountChanged = conflict && typeof conflict === 'object' && 'error' in conflict && conflict.error === 'account_changed';
        setNotice(accountChanged ? 'The signed-in account changed. We reloaded it; review your settings before trying again.'
          : 'Your settings changed in another tab or device. We reloaded them; please try your change again.');
        reload();
        return false;
      }
      if (response.status === 400) {
        setNotice('That change could not be saved. Check your selection and try again.');
        return false;
      }
      if (response.status === 429) {
        setNotice('Too many changes. Wait a minute before trying again.');
        return false;
      }
      const access = await accountResponseState(response);
      if (generation.current !== scope || controller.signal.aborted) return false;
      if (access) { setState({ status: access }); return false; }
      setNotice('Saved.');
      reload();
      return true;
    } catch {
      if (generation.current === scope && !controller.signal.aborted) {
        setState({ status: 'unavailable' });
        setNotice('We could not confirm that the change was saved. Reload your account before trying again.');
      }
      return false;
    } finally {
      if (generation.current === scope) setBusy(false);
    }
  };

  async function signOut() {
    request.current?.abort();
    const scope = ++generation.current;
    setState({ status: 'loading' });
    setBusy(true);
    setNotice('');
    try {
      const { accountAuthClient } = await import('@/lib/accounts/auth-client');
      if (generation.current !== scope) return;
      const result = await accountAuthClient.signOut();
      if (generation.current !== scope) return;
      if (result.error) throw new Error('Sign out failed');
      announceAccountSessionChange();
      window.location.replace('/sign-in');
    } catch {
      if (generation.current === scope) {
        setState({ status: 'unavailable' });
        setNotice('Sign out could not be completed. Please try again.');
        setBusy(false);
      }
    }
  }

  return <>
    <div className={styles.intro}><h1>{view === 'library' ? 'My leagues' : 'Your account'}</h1>
      <p>{view === 'library' ? 'Your participation, saved follows and linked leagues in one place.' : 'Manage your website profile and the Sleeper accounts that personalize your experience.'}</p>
    </div>
    {notice && <p className={styles.message} role="status">{notice}</p>}
    {availability === 'available' && state.status !== 'guest' && <div className={styles.sectionHeader}>
      {state.status === 'ready' && <p className={styles.hint}>Signed in as {state.data.profile.displayName}</p>}
      <button className={styles.secondary} disabled={busy} type="button" onClick={() => { void signOut(); }}>Sign out</button>
    </div>}
    {state.status === 'loading' ? <p className={styles.hint} role="status">Loading your account…</p>
      : state.status !== 'ready' ? <AccountAccessNotice state={state.status} retry={availability === 'available' ? reload : undefined} />
        : <>
          {view === 'library' ? <AccountLibrary library={state.data.library} mutate={mutate} busy={busy} />
            : <AccountProfile key={`${state.data.profile.id}:${state.data.profile.revision}`} data={state.data} mutate={mutate} busy={busy} />}
        </>}
  </>;
}
