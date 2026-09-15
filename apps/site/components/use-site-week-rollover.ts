'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export type SiteWeekRollover = Readonly<{
  week: number;
  nextRolloverAt: string | null;
  evaluatedAt: string;
}>;

const AUTHORITY_SETTLE_MS = 65_000;
export type RolloverRefreshState = { requested: Set<string>; lastVisibilityRefreshAt: number };

/** A route refresh at the known boundary, with one bounded cache-settling retry.
 * It does not request statistics or replace the existing collection schedule. */
export function watchSiteWeekRollover(
  signal: SiteWeekRollover,
  refresh: () => void,
  state: RolloverRefreshState,
): () => void {
  const cutoff = signal.nextRolloverAt === null ? NaN : Date.parse(signal.nextRolloverAt);
  const evaluated = Date.parse(signal.evaluatedAt);
  if (!Number.isInteger(signal.week) || signal.week < 1 || signal.week > 18
    || !Number.isFinite(cutoff) || !Number.isFinite(evaluated)) return () => {};
  const key = `${signal.week}:${signal.nextRolloverAt}`;
  const firstKey = `${key}:boundary`;
  const retryKey = `${key}:settled`;
  const { requested } = state;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function check(event?: Event) {
    clearTimeout(timer);
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now < cutoff) {
      timer = setTimeout(check, Math.min(cutoff - now, 2_147_483_647));
      return;
    }
    // Fresh server evidence already evaluated after the boundary needs no
    // repeated wakeup merely because unfinished games keep the same week.
    if (evaluated >= cutoff && !requested.has(firstKey) || requested.has(retryKey)) {
      if (event?.type === 'visibilitychange' && now - state.lastVisibilityRefreshAt >= 60_000) {
        state.lastVisibilityRefreshAt = now;
        refresh();
      }
      return;
    }
    if (!requested.has(firstKey)) {
      requested.add(firstKey);
      if (now >= cutoff + AUTHORITY_SETTLE_MS) requested.add(retryKey);
      refresh();
    } else if (now >= cutoff + AUTHORITY_SETTLE_MS && !requested.has(retryKey)) {
      requested.add(retryKey);
      refresh();
    }
    if (!requested.has(retryKey)) timer = setTimeout(check, Math.max(1, cutoff + AUTHORITY_SETTLE_MS - now));
  }

  document.addEventListener('visibilitychange', check);
  check();
  return () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', check);
  };
}

export function useSiteWeekRollover(signal: SiteWeekRollover | null | undefined) {
  const router = useRouter();
  const state = useRef<RolloverRefreshState>({ requested: new Set<string>(), lastVisibilityRefreshAt: 0 });
  const week = signal?.week;
  const nextRolloverAt = signal?.nextRolloverAt;
  const evaluatedAt = signal?.evaluatedAt;
  useEffect(() => {
    if (week === undefined || nextRolloverAt === undefined || evaluatedAt === undefined) return;
    return watchSiteWeekRollover({ week, nextRolloverAt, evaluatedAt }, () => router.refresh(), state.current);
  }, [week, nextRolloverAt, evaluatedAt, router]);
}
