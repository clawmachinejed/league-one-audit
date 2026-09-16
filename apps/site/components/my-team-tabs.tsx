'use client';

import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLeagueSite } from './league-context';
import styles from './my-team-schedule.module.css';

type View = 'my-team' | 'schedule';
const options = [{ value: 'my-team', label: 'My Team' }, { value: 'schedule', label: 'Schedule' }] as const;
const TabFocusContext = createContext<{ target: View | null; request: (view: View | null) => void }>({
  target: null, request: () => {},
});

/** Retain keyboard focus across the two server-loaded views on this route. */
export function MyTeamTabNavigation({ children }: { children: ReactNode }) {
  const [target, request] = useState<View | null>(null);
  return <TabFocusContext.Provider value={{ target, request }}>{children}</TabFocusContext.Provider>;
}

export function MyTeamTabs({ view, week, children }: { view: View; week?: number; children: ReactNode }) {
  const site = useLeagueSite();
  const router = useRouter();
  const refs = useRef<Partial<Record<View, HTMLButtonElement | null>>>({});
  const focus = useContext(TabFocusContext);
  useEffect(() => {
    if (focus.target !== view) return;
    refs.current[view]?.focus();
    focus.request(null);
  }, [view, focus]);
  function select(next: View) {
    if (next === view) return;
    focus.request(next);
    const query = new URLSearchParams();
    if (next === 'schedule') query.set('view', 'schedule');
    if (week !== undefined) query.set('week', String(week));
    router.push(`${site.prefix}/my-team${query.size ? `?${query}` : ''}`);
  }
  function onKey(event: KeyboardEvent<HTMLButtonElement>, current: View) {
    const next = event.key === 'Home' ? 'my-team' : event.key === 'End' ? 'schedule'
      : event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? (current === 'my-team' ? 'schedule' : 'my-team') : null;
    if (!next) return;
    event.preventDefault();
    refs.current[next]?.focus();
    select(next);
  }
  return <>
    <div className={`standings-view-tabs ${styles.tabs}`} role="tablist" aria-label="My Team views">
      {options.map(option => <button key={option.value} type="button" role="tab"
        ref={element => { refs.current[option.value] = element; }}
        id={`my-team-${option.value}-tab`} aria-controls="my-team-view-panel"
        aria-selected={view === option.value} tabIndex={view === option.value ? 0 : -1}
        onClick={() => select(option.value)} onKeyDown={event => onKey(event, option.value)}>
        {option.label}
      </button>)}
    </div>
    <div id="my-team-view-panel" role="tabpanel" aria-labelledby={`my-team-${view}-tab`}>
      {children}
    </div>
  </>;
}
