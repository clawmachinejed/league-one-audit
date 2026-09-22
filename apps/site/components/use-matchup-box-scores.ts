'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { nextAllPlayerRefreshAt } from '../lib/all-player-refresh-schedule';
import { boxScoreResponseMatchesScope } from '../lib/matchup-box-scores';
import { boxScoreFinalCapturePending, type BoxScoreActivity } from '../lib/matchup-box-score-refresh';
import type { MatchupBoxScores } from '../lib/matchup-box-score-types';

const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_MS = 60_000;
const BACKOFF_AFTER_FAILURES = 3;
const FAILURE_BACKOFF_MS = 5 * 60_000;
const MAX_FINAL_ATTEMPTS = 3;
const HOURLY_SETTLE_MS = 3 * 60_000;
const pageVisible = () => document.visibilityState !== 'hidden';

export function nextBoxScoreRefreshAt(now: number): number {
  return now + RETRY_MS;
}

type Scope = { leagueKey: string; season: string; week: number };
type WatchOptions = Scope & {
  refreshAutomatically: boolean; activity: BoxScoreActivity; initialData: MatchupBoxScores | null;
  onData: (data: MatchupBoxScores) => void; onLoading: (loading: boolean) => void;
};

/** Visible-page polling of the existing stored-data reader; no statistics provider calls. */
export function watchMatchupBoxScores({ leagueKey, season, week, refreshAutomatically, activity,
  initialData, onData, onLoading }: WatchOptions) {
  let disposed = false;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let nextDue = 0;
  let failures = 0;
  let attempts = 0;
  let accepted = initialData;
  function clearTimers() {
    if (timer) clearTimeout(timer);
    if (timeout) clearTimeout(timeout);
    timer = null; timeout = null;
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (disposed || controller || !refreshAutomatically || !pageVisible()) return;
    const pendingFinal = attempts < MAX_FINAL_ATTEMPTS && boxScoreFinalCapturePending(accepted, activity.finalKeys);
    if (!activity.live && !pendingFinal) {
      // Keep the existing active-week correction read after final settling ends.
      nextDue = nextAllPlayerRefreshAt(new Date(Date.now() - HOURLY_SETTLE_MS)).getTime() + HOURLY_SETTLE_MS;
    }
    timer = setTimeout(() => { void load(); }, Math.max(1, nextDue - Date.now()));
  }
  async function load() {
    if (disposed || controller || !pageVisible() || Date.now() < nextDue) return;
    if (timer) clearTimeout(timer);
    timer = null;
    const active = new AbortController(); controller = active;
    onLoading(true);
    timeout = setTimeout(() => active.abort(), REQUEST_TIMEOUT_MS);
    nextDue = nextBoxScoreRefreshAt(Date.now());
    attempts += 1;
    try {
      const response = await fetch(`/api/matchups/${encodeURIComponent(leagueKey)}/box-scores?season=${encodeURIComponent(season)}&week=${week}`,
        { signal: active.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Box scores unavailable.');
      const result: unknown = await response.json();
      if (!boxScoreResponseMatchesScope(result, leagueKey, season, week)) throw new Error('Box score scope is invalid.');
      if (disposed || active.signal.aborted) return;
      if (result.status === 'unavailable') {
        failures += 1;
        if (accepted?.status !== 'available') { accepted = result; onData(result); }
      } else if (accepted?.status === 'available' && Date.parse(result.observedAt!) < Date.parse(accepted.observedAt!)) {
        failures += 1;
      } else {
        failures = 0; accepted = result; onData(result);
      }
    } catch {
      // Preserve the last observed stats and timestamp; repeated failures slow automatic reads.
      if (!disposed && pageVisible()) failures += 1;
    } finally {
      if (timeout) clearTimeout(timeout);
      timeout = null; controller = null;
      if (failures >= BACKOFF_AFTER_FAILURES) nextDue = Date.now() + FAILURE_BACKOFF_MS;
      if (!disposed) { onLoading(false); schedule(); }
    }
  }
  function request() {
    failures = 0; attempts = 0;
    if (Date.now() >= nextDue) void load();
    else schedule();
  }
  function visibilityChanged() {
    if (!pageVisible()) {
      clearTimers(); controller?.abort();
    } else if (refreshAutomatically || attempts === 0) {
      request();
    }
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  void load();
  return { request, dispose() {
      disposed = true;
      clearTimers(); controller?.abort();
      document.removeEventListener('visibilitychange', visibilityChanged);
    } };
}

/** One lazy bulk read per board, then minute reads only during the displayed active games. */
export function useMatchupBoxScores({ leagueKey, season, week, lineupKey, refreshAutomatically, activity }: Scope & {
  lineupKey: string; refreshAutomatically: boolean; activity: BoxScoreActivity;
}) {
  const scope = `${leagueKey}:${season}:${week}`;
  const [requested, setRequested] = useState(false);
  const [stored, setStored] = useState<{ scope: string; data: MatchupBoxScores } | null>(null);
  const accepted = useRef<typeof stored>(null);
  const [loadingScope, setLoadingScope] = useState<string | null>(null);
  const check = useRef<() => void>(() => {});
  const request = useCallback(() => { setRequested(true); check.current(); }, []);
  const activityKey = activity.key;
  useEffect(() => {
    if (!requested) return;
    const phases = JSON.parse(activityKey) as Array<[string, string]>;
    const watch = watchMatchupBoxScores({ leagueKey, season, week, refreshAutomatically,
      activity: { key: activityKey, live: phases.some(([, phase]) => phase === 'live'),
        finalKeys: phases.filter(([, phase]) => phase === 'final').map(([key]) => key) },
      initialData: accepted.current?.scope === scope ? accepted.current.data : null,
      onData: data => { const value = { scope, data }; accepted.current = value; setStored(value); },
      onLoading: loading => setLoadingScope(loading ? scope : null),
    });
    check.current = watch.request;
    return () => { check.current = () => {}; watch.dispose(); };
  }, [requested, leagueKey, season, week, scope, lineupKey, refreshAutomatically, activityKey]);

  return { data: stored?.scope === scope ? stored.data : null, loading: loadingScope === scope, request };
}
