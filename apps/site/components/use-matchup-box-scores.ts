'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { nextAllPlayerRefreshAt } from '../lib/all-player-refresh-schedule';
import { boxScoreResponseMatchesScope } from '../lib/matchup-box-scores';
import type { MatchupBoxScores } from '../lib/matchup-box-score-types';

const SETTLE_MS = 3 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_MS = 60_000;
const pageVisible = () => document.visibilityState !== 'hidden';

/** Same collection window as roster statistics, with time for the hourly capture to settle. */
export function nextBoxScoreRefreshAt(now: number): number {
  return nextAllPlayerRefreshAt(new Date(now - SETTLE_MS)).getTime() + SETTLE_MS;
}

/** One lazy bulk read for this board; player taps never call a statistics provider. */
export function useMatchupBoxScores({ leagueKey, season, week, lineupKey, refreshAutomatically }: {
  leagueKey: string; season: string; week: number; lineupKey: string; refreshAutomatically: boolean;
}) {
  const [requested, setRequested] = useState(false);
  const [data, setData] = useState<MatchupBoxScores | null>(null);
  const [loading, setLoading] = useState(false);
  const check = useRef<() => void>(() => {});
  const request = useCallback(() => { setRequested(true); check.current(); }, []);

  useEffect(() => {
    if (!requested) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let nextDue = 0;
    function clearTimers() {
      if (timer) clearTimeout(timer);
      if (timeout) clearTimeout(timeout);
      timer = null; timeout = null;
    }
    function schedule() {
      if (disposed || !refreshAutomatically || !pageVisible()) return;
      timer = setTimeout(() => { void load(); }, Math.max(1, nextDue - Date.now()));
    }
    async function load() {
      if (disposed || controller || !pageVisible() || Date.now() < nextDue) return;
      if (timer) clearTimeout(timer);
      const active = new AbortController(); controller = active;
      setLoading(true);
      timeout = setTimeout(() => active.abort(), REQUEST_TIMEOUT_MS);
      nextDue = Date.now() + RETRY_MS;
      try {
        const response = await fetch(`/api/matchups/${encodeURIComponent(leagueKey)}/box-scores?season=${encodeURIComponent(season)}&week=${week}`, { signal: active.signal });
        if (!response.ok) throw new Error('Box scores unavailable.');
        const result: unknown = await response.json();
        if (!boxScoreResponseMatchesScope(result, leagueKey, season, week)) throw new Error('Box score scope is invalid.');
        if (disposed || active.signal.aborted) return;
        setData(previous => {
          if (previous?.status === 'available' && (result.status === 'unavailable'
            || Date.parse(result.observedAt!) < Date.parse(previous.observedAt!))) return previous;
          return result;
        });
        nextDue = nextBoxScoreRefreshAt(Date.now());
      } catch {
        // Keep the last observed stats and their honest timestamp; no fabricated replacement.
        // A subsequent tap may retry after a minute, automatic retries wait for the next capture.
      } finally {
        if (timeout) clearTimeout(timeout);
        timeout = null; controller = null;
        if (!disposed) {
          setLoading(false);
          if (refreshAutomatically && pageVisible()) {
            timer = setTimeout(() => { void load(); }, Math.max(1, nextBoxScoreRefreshAt(Date.now()) - Date.now()));
          }
        }
      }
    }
    function visibilityChanged() {
      if (!pageVisible()) {
        clearTimers(); controller?.abort();
      } else {
        if (Date.now() >= nextDue && (refreshAutomatically || nextDue === 0)) void load();
        else schedule();
      }
    }
    check.current = () => { void load(); };
    document.addEventListener('visibilitychange', visibilityChanged);
    void load();
    return () => {
      disposed = true; check.current = () => {};
      clearTimers(); controller?.abort();
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [requested, leagueKey, season, week, lineupKey, refreshAutomatically]);

  return { data, loading, request };
}
