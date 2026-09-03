import { isMatchupsData } from './matchups-response';
import { MATCHUP_PERIOD_HEADERS, matchupPeriodContextFromHeaders, type MatchupPeriodContext } from './matchup-period';
import { SNAPSHOT_REVISION_HEADER, SNAPSHOT_VERIFIED_AT_HEADER, validSnapshotRevision } from './matchup-snapshot-metadata';
import type { MatchupsData } from './types';

export type MatchupSnapshotScope = Readonly<{ leagueKey: string; season: string; week: number }>;
export type ClientMatchupSnapshot = Readonly<{
  data: MatchupsData;
  context: MatchupPeriodContext;
  revision: string | null;
  verifiedAt: string | null;
}>;
export type SnapshotCheckResult = Readonly<{ kind: 'accepted'; snapshot: ClientMatchupSnapshot }>
  | Readonly<{ kind: 'failed' | 'cancelled' }>;

export function matchupSnapshotScopeKey(scope: MatchupSnapshotScope): string {
  return JSON.stringify([scope.leagueKey, scope.season, scope.week]);
}

function protocolTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function newerTime(first: string, second: string): string {
  return Date.parse(first) >= Date.parse(second) ? first : second;
}

export function initialClientSnapshot(
  data: MatchupsData, context: MatchupPeriodContext, revision: string | null, verifiedAt: string | null,
): ClientMatchupSnapshot {
  const valid = revision !== null && validSnapshotRevision(revision) && verifiedAt !== null && Number.isFinite(Date.parse(verifiedAt));
  return { data, context, revision: valid ? revision : null, verifiedAt: valid ? new Date(verifiedAt).toISOString() : null };
}

/** An intentional safe fallback replaces Neon lineage; an unrelated older SSR response does not. */
export function reconcileServerSnapshot(
  adopted: ClientMatchupSnapshot, incoming: ClientMatchupSnapshot, intentionalFallback: boolean,
): ClientMatchupSnapshot {
  if ((intentionalFallback && incoming.revision === null) || adopted.revision === null) return incoming;
  if (incoming.revision === null) return adopted;
  if (adopted.revision === incoming.revision) {
    const order = { future: 0, active: 1, past: 2 };
    return { ...adopted,
      context: order[incoming.context.temporalState] < order[adopted.context.temporalState] ? adopted.context : incoming.context,
      verifiedAt: newerTime(adopted.verifiedAt!, incoming.verifiedAt!) };
  }
  return Date.parse(incoming.verifiedAt!) >= Date.parse(adopted.verifiedAt!) ? incoming : adopted;
}

function responseContext(headers: Headers, scope: MatchupSnapshotScope, fallback: MatchupPeriodContext): MatchupPeriodContext | null {
  const sentinel = { ...fallback };
  const context = matchupPeriodContextFromHeaders(headers, sentinel);
  if (context === sentinel || String(context.defaultSeason) !== scope.season) return null;
  const activeSeason = headers.get(MATCHUP_PERIOD_HEADERS.activeSeason);
  const activeWeek = headers.get(MATCHUP_PERIOD_HEADERS.activeWeek);
  if ((activeSeason === null) !== (activeWeek === null)
    || (activeSeason !== null && (String(context.activeSeason) !== activeSeason || String(context.activeWeek) !== activeWeek))) return null;
  return context;
}

function responseMatchesRequest(response: Response, path: string, scope: MatchupSnapshotScope): boolean {
  if (response.redirected) return false;
  // Native same-origin fetch proves the league route. MatchupsData intentionally has no league ID.
  if (!response.url) return true; // Constructed Response objects used by deterministic tests.
  try {
    const actual = new URL(response.url);
    return actual.pathname === path && actual.searchParams.get('week') === String(scope.week)
      && (typeof location === 'undefined' || actual.origin === location.origin);
  } catch { return false; }
}

/** One compact lookup, a full body only for changed content, and at most one 409 reconciliation. */
export async function checkMatchupSnapshot({
  scope, adopted, signal, request = fetch,
}: Readonly<{
  scope: MatchupSnapshotScope;
  adopted: ClientMatchupSnapshot;
  signal: AbortSignal;
  request?: typeof fetch;
}>): Promise<SnapshotCheckResult> {
  const path = `/api/matchups/${encodeURIComponent(scope.leagueKey)}`;
  const cancelled = (): boolean => signal.aborted;
  const options: RequestInit = { headers: { accept: 'application/json' }, signal, redirect: 'error' };
  try {
    for (let race = 0; race < 2; race += 1) {
      if (cancelled()) return { kind: 'cancelled' };
      const compact = await request(`${path}/revision?week=${scope.week}`, { ...options, cache: 'no-store' });
      if (cancelled()) return { kind: 'cancelled' };
      if (!compact.ok || !responseMatchesRequest(compact, `${path}/revision`, scope)) return { kind: 'failed' };
      const value: unknown = await compact.json();
      if (cancelled()) return { kind: 'cancelled' };
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return { kind: 'failed' };
      const metadata = value as Record<string, unknown>;
      if (metadata.status !== 'ok' || typeof metadata.revision !== 'string'
        || !validSnapshotRevision(metadata.revision) || !protocolTime(metadata.verifiedAt)) return { kind: 'failed' };
      const context = responseContext(compact.headers, scope, adopted.context);
      if (!context) return { kind: 'failed' };
      if (metadata.revision === adopted.revision) return { kind: 'accepted', snapshot: {
        ...adopted, context, verifiedAt: adopted.verifiedAt === null ? metadata.verifiedAt
          : newerTime(adopted.verifiedAt, metadata.verifiedAt),
      } };
      const full = await request(`${path}?week=${scope.week}&rev=${metadata.revision}`, options);
      if (cancelled()) return { kind: 'cancelled' };
      if (full.status === 409 && race === 0) continue;
      if (!full.ok || !responseMatchesRequest(full, path, scope)) return { kind: 'failed' };
      const revision = full.headers.get(SNAPSHOT_REVISION_HEADER);
      const headerTime = full.headers.get(SNAPSHOT_VERIFIED_AT_HEADER);
      const fullContext = responseContext(full.headers, scope, context);
      if (revision === null || !validSnapshotRevision(revision) || !protocolTime(headerTime) || !fullContext) return { kind: 'failed' };
      const data: unknown = await full.json();
      if (cancelled()) return { kind: 'cancelled' };
      if (!isMatchupsData(data) || data.week !== scope.week || data.league.week !== scope.week
        || data.league.season !== scope.season) return { kind: 'failed' };
      // A compact verification is transferable only to the exact same content revision.
      const verifiedAt = revision === metadata.revision ? newerTime(headerTime, metadata.verifiedAt) : headerTime;
      if (adopted.verifiedAt !== null && Date.parse(verifiedAt) < Date.parse(adopted.verifiedAt)) return { kind: 'failed' };
      return { kind: 'accepted', snapshot: { data, context: fullContext, revision, verifiedAt } };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: cancelled() ? 'cancelled' : 'failed' };
  }
}
