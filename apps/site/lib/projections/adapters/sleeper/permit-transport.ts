import 'server-only';

/** BC-M1 internal transport boundary. No production caller is wired until the
 * database gate and every owned Sleeper callsite pass qualification. */
export type SleeperEndpoint =
  | { family: 'identity'; username: string }
  | { family: 'account-leagues'; nativeAccountId: string; season: number }
  | { family: 'league' | 'rosters' | 'users'; externalLeagueId: string }
  | { family: 'matchups' | 'transactions'; externalLeagueId: string; week: number }
  | { family: 'nfl-state' | 'players' }
  | { family: 'schedule'; season: number }
  | { family: 'scores' | 'weekly-stats'; season: number; week: number };

export type PermitSource =
  | { kind: 'pre-enrollment'; attemptId: string; policyQualificationId: string; policyRevision: string }
  | { kind: 'enrolled'; attemptId: string; scopeId: string; policyRevision: string };
export type PermitJobFence = { jobKey: string; workerId: string; attemptCount: number; leaseUntil: string };
export type SleeperPermitRequest =
  | { kind: 'target'; requestId: string; demandId: string; source: PermitSource;
      fence: PermitJobFence; endpoint: SleeperEndpoint }
  | { kind: 'existing'; requestId: string; endpoint: SleeperEndpoint;
      purpose: 'live-score' | 'role-roster' | 'transactions' | 'metadata'
        | 'historical-import' | 'future-observation' | 'future-preparation';
      connectionId: string | null; source: PermitSource | null; fence: PermitJobFence | null }
  | { kind: 'retry'; requestId: string; previousPermitId: string;
      source: PermitSource | null; fence: PermitJobFence | null };
type Grant = { status: 'granted'; permitId: string; dbSampleAt: string;
  dispatchBefore: string; remainingDispatchMs: number; httpDeadlineMs: 5000 };
export type PermitOutcome = 'success' | 'invalid' | 'http429' | 'http503' | 'http5xx'
  | 'http4xx' | 'network' | 'cancelled' | 'unknown';

/** Implement with the existing runtime SQL transaction owner. Resolve retry
 * endpoint from immutable request_context IN the reservation transaction; SQL
 * must revalidate source/fence, fresh attempt, cooldown and global budgets.
 * Never return confirmed before COMMIT acknowledgement. A repeated requestId
 * must not return a grant. No caller-provided retry endpoint or lane exists. */
export interface SleeperPermitPort {
  reserveCommitted(request: SleeperPermitRequest): Promise<
    | { commit: 'confirmed'; result: unknown; endpoint: unknown }
    | { commit: 'unknown' }>;
  finish(permitId: string, outcome: PermitOutcome, retryAfterSeconds: number | null): Promise<boolean>;
}

/** Capacity must be reserved before SQL, without a hidden post-grant queue.
 * dispatch invokes the observable HTTP start synchronously, once, and does not
 * retry. This local connection reservation is NOT the global SQL slot ledger.
 * terminateLocal must immediately destroy exclusively owned local resources and
 * acknowledge only their observed closure, never just an abort/destroy request.
 * An unconfirmed slot is permanently retired by the capacity owner. release is
 * called only before dispatch or after that acknowledgement; it never refunds
 * the durable permit. No method asserts remote cancellation. */
export interface SleeperDispatchSlot {
  dispatch(url: string, init: RequestInit): Promise<Response>;
  terminateLocal(): Promise<'terminated' | 'unconfirmed'>;
  release(): void;
}
export type PermitTransportResult =
  | { status: 'received'; permitId: string; httpStatus: number; body: string;
    requestStartedAt: string; requestCompletedAt: string }
  | { status: 'unavailable'; reason: 'admission' | 'scope' | 'deadline' | 'transport' | 'completion' };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, names: string[]): boolean {
  return Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function instant(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
    && Number.isFinite(Date.parse(value));
}
function grant(value: unknown): value is Grant {
  return record(value) && keys(value, ['status', 'permitId', 'dbSampleAt', 'dispatchBefore', 'remainingDispatchMs', 'httpDeadlineMs'])
    && value.status === 'granted' && typeof value.permitId === 'string' && uuid.test(value.permitId)
    && instant(value.dbSampleAt) && instant(value.dispatchBefore)
    && typeof value.remainingDispatchMs === 'number' && Number.isInteger(value.remainingDispatchMs)
    && value.remainingDispatchMs > 0 && value.remainingDispatchMs <= 1000 && value.httpDeadlineMs === 5000
    && Date.parse(value.dispatchBefore) - Date.parse(value.dbSampleAt) >= value.remainingDispatchMs
    && Date.parse(value.dispatchBefore) - Date.parse(value.dbSampleAt) <= 1000;
}
function validSource(value: unknown): boolean {
  if (value === null) return true;
  if (!record(value) || !['pre-enrollment', 'enrolled'].includes(String(value.kind))) return false;
  const key = value.kind === 'enrolled' ? 'scopeId' : 'policyQualificationId';
  return keys(value, ['kind', 'attemptId', key, 'policyRevision'])
    && typeof value.attemptId === 'string' && uuid.test(value.attemptId)
    && typeof value[key] === 'string' && uuid.test(value[key])
    && typeof value.policyRevision === 'string' && /^[1-9]\d{0,18}$/.test(value.policyRevision)
    && BigInt(value.policyRevision) <= 9223372036854775807n;
}
function validFence(value: unknown): boolean {
  if (value === null) return true;
  return record(value) && keys(value, ['jobKey', 'workerId', 'attemptCount', 'leaseUntil'])
    && typeof value.jobKey === 'string' && value.jobKey.length > 0
    && typeof value.workerId === 'string' && value.workerId.length > 0 && value.workerId.length <= 100
    && Number.isSafeInteger(value.attemptCount) && Number(value.attemptCount) > 0 && instant(value.leaseUntil);
}
function validRequest(value: unknown): value is SleeperPermitRequest {
  if (!record(value) || typeof value.requestId !== 'string' || !uuid.test(value.requestId)
    || !validSource(value.source) || !validFence(value.fence)) return false;
  if (value.kind === 'retry') return keys(value, ['kind', 'requestId', 'previousPermitId', 'source', 'fence'])
    && typeof value.previousPermitId === 'string' && uuid.test(value.previousPermitId);
  if (sleeperEndpointUrl(value.endpoint) === null) return false;
  if (value.kind === 'target') return keys(value, ['kind', 'requestId', 'demandId', 'source', 'fence', 'endpoint'])
    && value.source !== null && value.fence !== null && typeof value.demandId === 'string' && uuid.test(value.demandId);
  return value.kind === 'existing' && keys(value, ['kind', 'requestId', 'endpoint', 'purpose', 'connectionId', 'source', 'fence'])
    && ['live-score', 'role-roster', 'transactions', 'metadata', 'historical-import', 'future-observation', 'future-preparation'].includes(String(value.purpose))
    && (value.connectionId === null || typeof value.connectionId === 'string' && uuid.test(value.connectionId));
}

/** Routing is closed and server owned; qualification of a particular season,
 * family and native identity is still the SQL source-policy owner's decision. */
export function sleeperEndpointUrl(value: unknown): string | null {
  if (!record(value) || typeof value.family !== 'string') return null;
  const family = value.family;
  const fields = family === 'identity' ? ['username'] : family === 'account-leagues' ? ['nativeAccountId', 'season']
    : ['league', 'rosters', 'users'].includes(family) ? ['externalLeagueId']
      : ['matchups', 'transactions'].includes(family) ? ['externalLeagueId', 'week']
        : ['nfl-state', 'players'].includes(family) ? [] : family === 'schedule' ? ['season']
          : ['scores', 'weekly-stats'].includes(family) ? ['season', 'week'] : null;
  if (!fields || !keys(value, ['family', ...fields])) return null;
  if (fields.includes('season') && (!Number.isSafeInteger(value.season) || Number(value.season) < 1 || Number(value.season) > 9999)) return null;
  if (fields.includes('week') && (!Number.isSafeInteger(value.week) || Number(value.week) < 1 || Number(value.week) > 22)) return null;
  const native = value.nativeAccountId ?? value.externalLeagueId;
  // Preserve opaque IDs, including large decimal IDs; encode them as one segment.
  if (native !== undefined && (typeof native !== 'string' || !native.length || native === '.' || native === '..')) return null;
  let segment: string;
  try { segment = typeof native === 'string' ? encodeURIComponent(native) : ''; } catch { return null; }
  const api = 'https://api.sleeper.app/v1';
  switch (family) {
    case 'identity': return typeof value.username === 'string' && /^[a-zA-Z0-9_]{1,100}$/.test(value.username) ? `${api}/user/${value.username}` : null;
    case 'account-leagues': return `${api}/user/${segment}/leagues/nfl/${value.season}`;
    case 'league': return `${api}/league/${segment}`;
    case 'rosters': case 'users': return `${api}/league/${segment}/${family}`;
    case 'matchups': case 'transactions': return `${api}/league/${segment}/${family}/${value.week}`;
    case 'nfl-state': return `${api}/state/nfl`;
    case 'players': return `${api}/players/nfl`;
    case 'schedule': return `https://api.sleeper.com/schedule/nfl/regular/${value.season}`;
    case 'scores': return `https://api.sleeper.com/scores/nfl/regular/${value.season}/${value.week}`;
    case 'weekly-stats': return `${api}/stats/nfl/regular/${value.season}/${value.week}`;
    default: return null;
  }
}

/** Date Retry-After uses the DB sample as a conservative lower bound on now.
 * Adding elapsed since BEFORE SQL would overestimate DB elapsed, shortening
 * cooldown. Omitting that uncertain interval safely rounds cooldown upward. */
export function sleeperRetryAfter(value: string | null, dbSampleAt: string): number | null {
  if (value === null) return null;
  const raw = value.trim();
  let seconds: number;
  if (/^\d+$/.test(raw)) seconds = Number(raw);
  else {
    if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw)) return -1;
    const date = Date.parse(raw);
    if (!Number.isFinite(date) || new Date(date).toUTCString() !== raw || !instant(dbSampleAt)) return -1;
    seconds = Math.max(0, Math.ceil((date - Date.parse(dbSampleAt)) / 1000));
  }
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 86400 ? seconds : -1;
}
function responseOutcome(status: number): PermitOutcome {
  return status === 429 ? 'http429' : status === 503 ? 'http503' : status >= 500 ? 'http5xx'
    : status >= 400 ? 'http4xx' : status >= 200 && status < 300 ? 'success' : 'invalid';
}

export function createSleeperPermitTransport(dependencies: {
  permits: SleeperPermitPort;
  reserveLocalCapacity(): Promise<SleeperDispatchSlot | null>;
  monotonicNow(): number;
  wallClockNow(): string;
}) {
  const unavailable = (reason: Extract<PermitTransportResult, { status: 'unavailable' }>['reason']): PermitTransportResult => ({ status: 'unavailable', reason });
  const finish = async (id: string, outcome: PermitOutcome, retry: number | null) => {
    try { return await dependencies.permits.finish(id, outcome, retry); } catch { return false; }
  };
  return async (request: SleeperPermitRequest): Promise<PermitTransportResult> => {
    // Snapshot trusted input before awaits so reservation and dispatch cannot
    // observe different endpoints through a mutable caller object.
    let owned: SleeperPermitRequest;
    try { owned = structuredClone(request); } catch { return unavailable('scope'); }
    if (!validRequest(owned)) return unavailable('scope');
    const originalUrl = owned.kind === 'retry' ? null : sleeperEndpointUrl(owned.endpoint);
    if (owned.kind !== 'retry' && originalUrl === null) return unavailable('scope');
    let slot: SleeperDispatchSlot | null;
    try { slot = await dependencies.reserveLocalCapacity(); } catch { return unavailable('transport'); }
    if (!slot) return unavailable('transport');
    let released = false;
    let retired = false;
    let quarantine: ReturnType<typeof setTimeout> | undefined;
    let teardown: Promise<void> | undefined;
    const release = () => {
      if (!released && !retired) { released = true; clearTimeout(quarantine); slot.release(); }
    };
    const terminate = (): Promise<void> => {
      if (teardown) return teardown;
      clearTimeout(quarantine);
      // Start local destruction at the quarantine boundary. The additional
      // second only waits for closure proof; capacity remains occupied. If the
      // owner cannot prove closure, retire permanently, including late settles.
      teardown = (async () => {
        let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          const confirmation = slot.terminateLocal();
          const result = await Promise.race([confirmation, new Promise<'unconfirmed'>((resolve) => {
            confirmationTimer = setTimeout(() => resolve('unconfirmed'), 1000);
          })]);
          if (result === 'terminated') release();
          else retired = true;
        } catch { retired = true; }
        finally { clearTimeout(confirmationTimer); }
      })();
      return teardown;
    };
    const anchor = dependencies.monotonicNow();
    if (!Number.isFinite(anchor) || anchor < 0) { release(); return unavailable('deadline'); }
    let reservation: Awaited<ReturnType<SleeperPermitPort['reserveCommitted']>>;
    try { reservation = await dependencies.permits.reserveCommitted(owned); }
    catch { release(); return unavailable('admission'); }
    if (reservation.commit !== 'confirmed' || !grant(reservation.result)) { release(); return unavailable('admission'); }
    const permit = reservation.result;
    const url = sleeperEndpointUrl(reservation.endpoint);
    if (!url || (originalUrl !== null && url !== originalUrl)) {
      release(); await finish(permit.permitId, 'cancelled', null); return unavailable('scope');
    }
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let observedHeaders: { outcome: PermitOutcome; retry: number | null } | null = null;
    const deadline = new Promise<null>((resolve) => {
      timeout = setTimeout(() => {
        timedOut = true;
        // Install cleanup before abort: abort listeners and accounting can fail
        // or remain pending without preventing the owned-resource deadline.
        quarantine = setTimeout(() => { void terminate(); }, 60_000);
        controller.abort();
        resolve(null);
      }, permit.httpDeadlineMs);
    });
    const init: RequestInit = { method: 'GET', cache: 'no-store', redirect: 'manual',
      headers: { Accept: 'application/json' }, signal: controller.signal };
    // Host wall-clock samples record observed network chronology only. They do
    // not authorize acquisition, extend leases or establish source freshness.
    let requestStartedAt: string;
    try {
      requestStartedAt = dependencies.wallClockNow();
      if (!instant(requestStartedAt)) throw new Error('Invalid source chronology');
    } catch { clearTimeout(timeout); release(); await finish(permit.permitId, 'cancelled', null); return unavailable('transport'); }
    const now = dependencies.monotonicNow();
    // No await, logging, user callback or wall-clock read between check and send.
    if (!Number.isFinite(now) || now < anchor || permit.remainingDispatchMs - Math.ceil(now - anchor) <= 0) {
      clearTimeout(timeout); release(); await finish(permit.permitId, 'cancelled', null); return unavailable('deadline');
    }
    let responsePromise: Promise<Response>;
    try { responsePromise = slot.dispatch(url, init); }
    catch { clearTimeout(timeout); await terminate(); await finish(permit.permitId, 'network', null); return unavailable('transport'); }
    const operation = responsePromise.then(async (response) => {
      const outcome = responseOutcome(response.status);
      const retry = response.status === 429 || response.status === 503
        ? sleeperRetryAfter(response.headers.get('retry-after'), permit.dbSampleAt) : null;
      observedHeaders = { outcome, retry };
      if (timedOut) {
        // A late observation only tightens accounting, never accepts source data.
        void finish(permit.permitId, outcome, retry);
        // Headers alone are not completion. Teardown owns cancellation even if
        // a custom response body's cancel promise never settles.
        void response.body?.cancel().catch(() => {});
        await terminate();
        return null;
      }
      try {
        const body = await response.text();
        const requestCompletedAt = dependencies.wallClockNow();
        if (!instant(requestCompletedAt) || Date.parse(requestCompletedAt) < Date.parse(requestStartedAt)) {
          throw new Error('Invalid source chronology');
        }
        await terminate();
        if (retired) { await finish(permit.permitId, outcome === 'success' ? 'network' : outcome, retry); return null; }
        if (timedOut) { await finish(permit.permitId, outcome, retry); return null; }
        return { response, body, outcome, retry, requestCompletedAt };
      } catch {
        await terminate();
        await finish(permit.permitId, outcome === 'success' ? 'network' : outcome, retry);
        return null;
      }
    }, async () => { await terminate(); if (!timedOut) await finish(permit.permitId, 'network', null); return null; });
    const observed = await Promise.race([operation, deadline]);
    clearTimeout(timeout);
    if (timedOut) {
      await finish(permit.permitId, 'unknown', null);
      // Preserve quarantine, but do not lose a known 429/503 because its body
      // never finishes. SQL's unknown-refinement rule cannot reopen the slot.
      const headers = observedHeaders as { outcome: PermitOutcome; retry: number | null } | null;
      if (headers) await finish(permit.permitId, headers.outcome, headers.retry);
      return unavailable('deadline');
    }
    if (!observed) return unavailable('transport');
    if (!await finish(permit.permitId, observed.outcome, observed.retry)) return unavailable('completion');
    const completedAt = dependencies.monotonicNow();
    if (!Number.isFinite(completedAt) || completedAt < now || completedAt - now >= permit.httpDeadlineMs) return unavailable('deadline');
    if (observed.outcome === 'invalid') return unavailable('transport');
    return { status: 'received', permitId: permit.permitId, httpStatus: observed.response.status, body: observed.body,
      requestStartedAt, requestCompletedAt: observed.requestCompletedAt };
  };
}
