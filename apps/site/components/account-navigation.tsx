'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ACCOUNT_SESSION_EVENT, readAccount, type AccountRead } from './account-client';

type NavigationAccount = AccountRead | { status: 'loading' };
const Context = createContext<NavigationAccount>({ status: 'disabled' });
export function useNavigationAccount() { return useContext(Context); }

/** One in-memory private account read shared by the ribbon and My Fantasy.
 * Focus, logout, account switching and BFCache invalidate it without local storage. */
export function AccountNavigationProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<NavigationAccount>({ status: enabled ? 'loading' : 'disabled' });
  useEffect(() => {
    if (!enabled) return;
    let generation = 0;
    let controller: AbortController | null = null;
    const reload = () => {
      const scope = ++generation;
      controller?.abort(); controller = new AbortController();
      setState({ status: 'loading' });
      const signal = controller.signal;
      void readAccount(signal).then(result => { if (!signal.aborted && scope === generation) setState(result); })
        .catch(() => { if (!signal.aborted && scope === generation) setState({ status: 'unavailable' }); });
    };
    const visible = () => { if (document.visibilityState === 'visible') reload(); };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) reload(); };
    let channel: BroadcastChannel | null = null;
    try { channel = new BroadcastChannel(ACCOUNT_SESSION_EVENT); channel.onmessage = reload; } catch { /* Focus remains available. */ }
    window.addEventListener(ACCOUNT_SESSION_EVENT, reload);
    window.addEventListener('focus', reload);
    window.addEventListener('pageshow', restore);
    document.addEventListener('visibilitychange', visible);
    reload();
    return () => {
      generation++; controller?.abort(); channel?.close();
      window.removeEventListener(ACCOUNT_SESSION_EVENT, reload); window.removeEventListener('focus', reload);
      window.removeEventListener('pageshow', restore); document.removeEventListener('visibilitychange', visible);
    };
  }, [enabled, pathname]);
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
