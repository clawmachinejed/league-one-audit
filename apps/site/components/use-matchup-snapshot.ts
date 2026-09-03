'use client';

import { useCallback, useEffect, useEffectEvent, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  checkMatchupSnapshot, initialClientSnapshot, matchupSnapshotScopeKey, reconcileServerSnapshot,
  type ClientMatchupSnapshot, type MatchupSnapshotScope,
} from '../lib/matchup-snapshot-client';
import type { MatchupPeriodContext } from '../lib/matchup-period';
import type { MatchupsData } from '../lib/types';

const SNAPSHOT_REQUEST_TIMEOUT_MS = 15_000;
const SNAPSHOT_POLL_INTERVAL_MS = 60_000;
type Session = Readonly<{
  scopeKey: string;
  serverData: MatchupsData;
  serverContext: MatchupPeriodContext;
  serverRevision: string | null;
  serverVerifiedAt: string | null;
  snapshot: ClientMatchupSnapshot;
  generation: number;
  acceptFallback: boolean;
}>;

export function useMatchupSnapshot({
  leagueKey, data, periodContext, snapshotRevision, verifiedAt,
}: Readonly<{
  leagueKey: string;
  data: MatchupsData;
  periodContext: MatchupPeriodContext;
  snapshotRevision: string | null;
  verifiedAt: string | null;
}>) {
  const scope: MatchupSnapshotScope = { leagueKey, season: data.league.season, week: data.week };
  const scopeKey = matchupSnapshotScopeKey(scope);
  const [session, setSession] = useState<Session>(() => ({ scopeKey, serverData: data, serverContext: periodContext,
    serverRevision: snapshotRevision, serverVerifiedAt: verifiedAt, generation: 0, acceptFallback: false,
    snapshot: initialClientSnapshot(data, periodContext, snapshotRevision, verifiedAt) }));
  if (session.scopeKey !== scopeKey || session.serverData !== data || session.serverContext !== periodContext
    || session.serverRevision !== snapshotRevision || session.serverVerifiedAt !== verifiedAt) {
    const incoming = initialClientSnapshot(data, periodContext, snapshotRevision, verifiedAt);
    setSession({ scopeKey, serverData: data, serverContext: periodContext, serverRevision: snapshotRevision,
      serverVerifiedAt: verifiedAt, generation: session.generation + 1, acceptFallback: false,
      snapshot: session.scopeKey !== scopeKey ? incoming
        : reconcileServerSnapshot(session.snapshot, incoming, session.acceptFallback) });
  }
  const router = useRouter();
  const [routeRefreshing, startTransition] = useTransition();
  const [fetchingGeneration, setFetchingGeneration] = useState<number | null>(null);
  const sequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const generation = session.generation;
  const snapshot = session.snapshot;

  const refreshRoute = useCallback(() => {
    setSession((current) => current.generation === generation ? { ...current, acceptFallback: true } : current);
    startTransition(() => router.refresh());
  }, [generation, router]);

  const check = useCallback(async (manual: boolean) => {
    if (!manual && activeRequest.current) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const requestSequence = ++sequence.current;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, SNAPSHOT_REQUEST_TIMEOUT_MS);
    setFetchingGeneration(generation);
    try {
      const result = await checkMatchupSnapshot({ scope: { leagueKey, season: data.league.season, week: data.week },
        adopted: snapshot, signal: controller.signal });
      if (requestSequence !== sequence.current) return;
      if (result.kind === 'accepted') {
        setSession((current) => current.generation === generation
          ? { ...current, snapshot: result.snapshot, acceptFallback: false } : current);
      } else if ((result.kind === 'failed' || timedOut)
        && (manual || snapshot.context.temporalState === 'active')) {
        refreshRoute();
      }
    } finally {
      window.clearTimeout(timeout);
      if (requestSequence === sequence.current) {
        activeRequest.current = null;
        setFetchingGeneration(null);
      }
    }
  }, [data.league.season, data.week, generation, leagueKey, refreshRoute, snapshot]);

  const polling = snapshot.context.temporalState !== 'past';
  const checkAutomatically = useEffectEvent(() => { void check(false); });
  useEffect(() => {
    const cancel = () => { sequence.current += 1; activeRequest.current?.abort(); activeRequest.current = null; };
    if (!polling) return cancel;
    const checkVisible = () => { if (document.visibilityState === 'visible') checkAutomatically(); };
    const visibilityChanged = () => {
      if (document.visibilityState === 'visible') checkVisible();
      else { cancel(); setFetchingGeneration(null); }
    };
    const timer = window.setInterval(checkVisible, SNAPSHOT_POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      cancel();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [generation, polling]);

  return {
    data: snapshot.data,
    periodContext: snapshot.context,
    updatedAt: snapshot.context.temporalState === 'past' ? snapshot.data.updatedAt
      : snapshot.verifiedAt ?? snapshot.data.updatedAt,
    refreshing: fetchingGeneration === generation || routeRefreshing,
    refresh: () => check(true),
  };
}
