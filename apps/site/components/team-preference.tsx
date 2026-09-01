'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { Team } from '../lib/types';

interface TeamPreference {
  selected: number | null;
  select: (id: number | null) => void;
  validate: (ids: number[]) => void;
  storageWarning: string;
}

const MyTeamContext = createContext<TeamPreference>({ selected: null, select: () => undefined, validate: () => undefined, storageWarning: '' });
const preferenceMemory = new Map<string, number | null>();
const memoryOnlyPreferences = new Set<string>();
const preferenceEvent = 'league-one:my-team-change';

function parsePreference(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function TeamPreferenceProvider({ children, leagueId }: { children: ReactNode; leagueId: string }) {
  const storageKey = `league-one:my-team:${leagueId}`;
  const [announcement, setAnnouncement] = useState('');
  const [storageWarning, setStorageWarning] = useState('');
  const subscribe = useCallback((notify: () => void) => {
    const onStorage = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) notify(); };
    const onPreference = (event: Event) => { if ((event as CustomEvent<string>).detail === storageKey) notify(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener(preferenceEvent, onPreference);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(preferenceEvent, onPreference);
    };
  }, [storageKey]);
  const getSnapshot = useCallback(() => {
    if (memoryOnlyPreferences.has(storageKey)) return preferenceMemory.get(storageKey) ?? null;
    try { return parsePreference(window.localStorage.getItem(storageKey)); }
    catch { return preferenceMemory.get(storageKey) ?? null; }
  }, [storageKey]);
  const selected = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const ready = useSyncExternalStore(subscribe, () => true, () => false);

  const select = useCallback((id: number | null) => {
    preferenceMemory.set(storageKey, id);
    try {
      if (id === null) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, String(id));
      memoryOnlyPreferences.delete(storageKey);
      setStorageWarning('');
      setAnnouncement(id === null ? 'My Team selection cleared.' : 'My Team saved in this browser.');
    } catch {
      memoryOnlyPreferences.add(storageKey);
      setStorageWarning('This preference applies to this visit only. Browser storage is unavailable, so the change cannot be saved for next time.');
      setAnnouncement('Your selection works for this visit. Browser storage is unavailable, so it cannot be saved for next time.');
    }
    window.dispatchEvent(new CustomEvent(preferenceEvent, { detail: storageKey }));
  }, [storageKey]);

  const validate = useCallback((ids: number[]) => {
    if (ready && selected !== null && ids.length > 0 && !ids.includes(selected)) select(null);
  }, [ready, selected, select]);
  const preference = useMemo(() => ({ selected, select, validate, storageWarning }), [selected, select, validate, storageWarning]);

  return <MyTeamContext.Provider value={preference}>
    {children}
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </MyTeamContext.Provider>;
}

export function useTeamPreferenceContext() {
  return useContext(MyTeamContext);
}

export function useTeamPreference(teams: Team[]) {
  const preference = useTeamPreferenceContext();
  const { validate } = preference;
  const ids = teams.map(team => team.id).join(',');
  useEffect(() => { validate(ids ? ids.split(',').map(Number) : []); }, [ids, validate]);
  return preference;
}
