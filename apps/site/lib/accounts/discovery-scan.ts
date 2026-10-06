import 'server-only';
import { normalizeSleeperUserLeagues } from '../sleeper';
import { createSleeperPermitTransport, type SleeperPermitRequest } from '../projections/adapters/sleeper/permit-transport';

export const SLEEPER_DISCOVERY_STRATEGY = 'sleeper-current-prior-two-retained-v1' as const;
type Candidates = ReturnType<typeof normalizeSleeperUserLeagues>;
type TargetRequest = Extract<SleeperPermitRequest, { kind: 'target' }>;
type CompletedScope = Readonly<{ season: number; captureId: string }>;

/** Loaded by the existing durable work owner, never accepted from an HTTP body.
 * The initial season and retained selection years are frozen at scan creation;
 * resuming after a calendar rollover does not silently change the work identity. */
export type DiscoveryScanWork = Readonly<{
  scanId: string; associationId: string; associationRevision: string;
  providerAccountId: string; nativeAccountId: string;
  accessContextId: string; accessRevision: string; audienceId: 'public';
  leagueSeasonAtStart: number; retainedSelectionSeasons: readonly number[];
  strategyVersion: typeof SLEEPER_DISCOVERY_STRATEGY;
  requiredSeasons: readonly number[]; completed: readonly CompletedScope[];
}>;

export type DiscoveryScopeWork = Readonly<{ scan: DiscoveryScanWork; season: number }>;
export type DiscoveryScanProgress = Readonly<{
  status: 'pending' | 'partial' | 'complete'; scanId: string;
  associationId: string; associationRevision: string;
  strategyVersion: typeof SLEEPER_DISCOVERY_STRATEGY;
  requiredSeasons: readonly number[]; completed: readonly CompletedScope[];
  continuation: Readonly<{ remainingSeasons: readonly number[] }> | null;
  reason: 'queued' | 'admission' | 'transport' | 'invalid_source' | 'capture_unconfirmed' | null;
}> | Readonly<{ status: 'unavailable'; reason: 'authority_unavailable' }>;

/** Required SQL/job-owner boundary, intentionally without a default adapter.
 * load must reauthorize the retained demand and exact association/context.
 * reserve must commit an immutable attempt for this exact scope and validate
 * the existing job lease/demand before returning its target transport request.
 * recordCapture must recheck those fences, derive timing from the permit's
 * actual network capture, and commit immutable source+normalized evidence and
 * the scan checkpoint atomically. Unknown commit is never completed coverage.
 * SQL implementation/qualification of this port remains a separate gate. */
export interface DiscoveryScanPort {
  load(scanId: string): Promise<DiscoveryScanWork | null>;
  reserve(scope: DiscoveryScopeWork): Promise<TargetRequest | null>;
  recordCapture(input: DiscoveryScopeWork & Readonly<{
    request: TargetRequest; permitId: string; rawValue: unknown; candidates: Candidates;
  }>): Promise<{ commit: 'confirmed'; captureId: string } | { commit: 'unknown' }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function revision(value: unknown): boolean {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}
function season(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1000 && Number(value) <= 9999;
}
function keys(value: object, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}

/** ENG04/R019: a finite declared query set, never a universal-history claim.
 * Refuse a current year without two representable preceding native years. */
export function sleeperDiscoverySeasons(leagueSeason: number, retainedSelections: readonly number[]): number[] {
  if (!season(leagueSeason) || leagueSeason < 1002 || !Array.isArray(retainedSelections)
    || !retainedSelections.every(season)) throw new Error('Invalid discovery season plan.');
  return [...new Set([leagueSeason - 2, leagueSeason - 1, leagueSeason, ...retainedSelections])].sort((a, b) => a - b);
}

function validWork(value: DiscoveryScanWork, scanId: string): boolean {
  if (!value || !keys(value, ['scanId', 'associationId', 'associationRevision', 'providerAccountId', 'nativeAccountId',
    'accessContextId', 'accessRevision', 'audienceId', 'leagueSeasonAtStart', 'retainedSelectionSeasons',
    'strategyVersion', 'requiredSeasons', 'completed']) || value.scanId !== scanId
    || ![value.scanId, value.associationId, value.providerAccountId, value.accessContextId].every(uuid)
    || !revision(value.associationRevision) || !revision(value.accessRevision)
    || typeof value.nativeAccountId !== 'string' || !/^[1-9]\d{0,31}$/.test(value.nativeAccountId)
    || value.audienceId !== 'public' || value.strategyVersion !== SLEEPER_DISCOVERY_STRATEGY
    || !Array.isArray(value.requiredSeasons) || !Array.isArray(value.completed)) return false;
  const required = sleeperDiscoverySeasons(value.leagueSeasonAtStart, value.retainedSelectionSeasons);
  if (JSON.stringify(required) !== JSON.stringify(value.requiredSeasons)) return false;
  const seen = new Set<number>(); const captures = new Set<string>();
  for (const scope of value.completed) {
    if (!scope || !keys(scope, ['season', 'captureId']) || !required.includes(scope.season)
      || seen.has(scope.season) || !uuid(scope.captureId) || captures.has(scope.captureId)) return false;
    seen.add(scope.season); captures.add(scope.captureId);
  }
  return true;
}

function progress(scan: DiscoveryScanWork, completed: readonly CompletedScope[],
  reason: Extract<DiscoveryScanProgress, { scanId: string }>['reason']): DiscoveryScanProgress {
  const ordered = [...completed].sort((a, b) => a.season - b.season);
  const remaining = scan.requiredSeasons.filter(year => !ordered.some(scope => scope.season === year));
  return { status: remaining.length ? ordered.length ? 'partial' : 'pending' : 'complete',
    scanId: scan.scanId, associationId: scan.associationId, associationRevision: scan.associationRevision,
    strategyVersion: scan.strategyVersion, requiredSeasons: [...scan.requiredSeasons], completed: ordered,
    continuation: remaining.length ? { remainingSeasons: remaining } : null, reason: remaining.length ? reason : null };
}

/** One bounded step of the existing worker's scan: at most one admitted HTTP
 * request, no retry, no alternate fetch/cache and no membership or enrollment.
 * Subsequent invocations reload committed progress instead of trusting a caller
 * continuation. No route or worker is activated by exporting this composition. */
export function createSleeperDiscoveryScan(dependencies: {
  scans: DiscoveryScanPort;
  transport: ReturnType<typeof createSleeperPermitTransport>;
}) {
  return async (scanId: string, signal?: AbortSignal): Promise<DiscoveryScanProgress> => {
    signal?.throwIfAborted();
    if (!uuid(scanId)) return { status: 'unavailable', reason: 'authority_unavailable' };
    let scan: DiscoveryScanWork;
    try {
      const loaded = await dependencies.scans.load(scanId);
      if (!loaded) return { status: 'unavailable', reason: 'authority_unavailable' };
      scan = structuredClone(loaded);
      if (!validWork(scan, scanId)) return { status: 'unavailable', reason: 'authority_unavailable' };
    } catch { return { status: 'unavailable', reason: 'authority_unavailable' }; }
    signal?.throwIfAborted();
    const next = scan.requiredSeasons.find(year => !scan.completed.some(scope => scope.season === year));
    if (next === undefined) return progress(scan, scan.completed, null);
    const scope = { scan, season: next };
    let request: TargetRequest;
    try {
      const reserved = await dependencies.scans.reserve(structuredClone(scope));
      signal?.throwIfAborted();
      if (!reserved || reserved.kind !== 'target' || reserved.source.kind !== 'pre-enrollment'
        || reserved.endpoint.family !== 'account-leagues' || reserved.endpoint.nativeAccountId !== scan.nativeAccountId
        || reserved.endpoint.season !== next) return progress(scan, scan.completed, 'admission');
      request = structuredClone(reserved);
    } catch { signal?.throwIfAborted(); return progress(scan, scan.completed, 'admission'); }
    let received: Awaited<ReturnType<typeof dependencies.transport>>;
    try { received = await dependencies.transport(request); }
    catch { signal?.throwIfAborted(); return progress(scan, scan.completed, 'transport'); }
    signal?.throwIfAborted();
    if (received.status !== 'received' || received.httpStatus < 200 || received.httpStatus >= 300 || !uuid(received.permitId)) {
      return progress(scan, scan.completed, 'transport');
    }
    let rawValue: unknown; let candidates: Candidates;
    try {
      rawValue = JSON.parse(received.body);
      candidates = normalizeSleeperUserLeagues(rawValue, String(next), signal);
    } catch { signal?.throwIfAborted(); return progress(scan, scan.completed, 'invalid_source'); }
    try {
      const captured = await dependencies.scans.recordCapture({ ...structuredClone(scope), request,
        permitId: received.permitId, rawValue, candidates });
      signal?.throwIfAborted();
      if (captured.commit !== 'confirmed' || !uuid(captured.captureId)
        || scan.completed.some(previous => previous.captureId === captured.captureId)) {
        return progress(scan, scan.completed, 'capture_unconfirmed');
      }
      return progress(scan, [...scan.completed, { season: next, captureId: captured.captureId }], 'queued');
    } catch { signal?.throwIfAborted(); return progress(scan, scan.completed, 'capture_unconfirmed'); }
  };
}
