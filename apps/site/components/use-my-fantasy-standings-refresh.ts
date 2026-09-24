'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const CACHE_SETTLE_MS = 65_000;
const MAX_ATTEMPTS = 3;

export type MyFantasyStandingsRefreshState = {
  evidence: string | null;
  attempts: number;
  nextDue: number | null;
};

/** An unchanged response or failed route request cannot consume both settling retries. */
export function watchMyFantasyStandingsRefresh(
  evidence: string,
  refresh: () => void,
  state: MyFantasyStandingsRefreshState,
): () => void {
  if (state.evidence === null) state.evidence = evidence;
  else if (state.evidence !== evidence) {
    state.evidence = evidence;
    state.attempts = 0;
    state.nextDue = Date.now();
  }
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer() {
    clearTimeout(timer);
    timer = undefined;
  }

  function check() {
    clearTimer();
    if (disposed || state.evidence !== evidence || document.visibilityState !== 'visible'
      || state.nextDue === null || state.attempts >= MAX_ATTEMPTS) return;
    const now = Date.now();
    if (now >= state.nextDue) {
      state.attempts += 1;
      // Space retries from the actual attempt, so returning after a long hidden
      // interval cannot issue multiple overdue route requests at once.
      state.nextDue = state.attempts < MAX_ATTEMPTS ? now + CACHE_SETTLE_MS : null;
      try { refresh(); } catch {
        // A synchronous routing failure retains the same bounded retry budget.
      }
    }
    if (!disposed && state.evidence === evidence && state.nextDue !== null) {
      timer = setTimeout(check, Math.max(1, state.nextDue - Date.now()));
    }
  }

  document.addEventListener('visibilitychange', check);
  check();
  return () => {
    disposed = true;
    clearTimer();
    document.removeEventListener('visibilitychange', check);
  };
}

/** Route props can change without proving that the provider's cached standings have settled. */
export function useMyFantasyStandingsRefresh(evidence: string) {
  const router = useRouter();
  const state = useRef<MyFantasyStandingsRefreshState>({ evidence: null, attempts: 0, nextDue: null });
  useEffect(() => watchMyFantasyStandingsRefresh(evidence, () => router.refresh(), state.current), [evidence, router]);
}
