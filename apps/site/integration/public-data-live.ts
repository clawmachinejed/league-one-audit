import { createHash } from 'node:crypto';
import { capturePublicSleeperCore, capturePublicSleeperIdentity, capturePublicSleeperLeagueList } from '../lib/sleeper';
import { assertOriginalPublicCapture, type PublicCaptureWitness } from '../lib/league-administration/public-capture-witness';
import type { PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { qualificationDigest } from './qualification-profile';

// Qualification data only. The shared product has no named-league eligibility rule.
export const JOURNEY_USERNAME = 'DannyPak';
export const JOURNEY_MANAGER = '79628519873069056';
export const JOURNEY_SEASON = 2026;
export const JOURNEY_MAX_LEAGUES = 4;
export const JOURNEY_MAX_GETS = 36;
export const JOURNEY_BODY_BYTES = 1_048_576;
export const JOURNEY_TOTAL_BYTES = JOURNEY_BODY_BYTES * JOURNEY_MAX_GETS;
export const JOURNEY_LOOP_MS = 28 * 60_000 + 45_000;
export const JOURNEY_CASE_MS = 29 * 60_000;
export const JOURNEY_CADENCE_SECONDS = 3_600;
type Family = 'identity' | 'leagues' | 'league' | 'rosters' | 'users';
type Step = Readonly<{ cycle: 1 | 2; kind: 'identity' | 'leagues' | 'bootstrap' | 'core' | 'users'; leagueId?: string }>;
const journeySteps = (leagueIds: readonly string[]): readonly Step[] => Object.freeze(([1, 2] as const).flatMap(cycle => [
  { cycle, kind: 'identity' as const }, { cycle, kind: 'leagues' as const },
  ...leagueIds.flatMap(leagueId => [{ cycle, kind: 'bootstrap' as const, leagueId }, { cycle, kind: 'core' as const, leagueId }]),
  ...leagueIds.map(leagueId => ({ cycle, kind: 'users' as const, leagueId })),
]).map(step => Object.freeze(step)));
type Capture = Readonly<{ payload: unknown; requestStartedAt: string; requestCompletedAt: string; acquisition?: PublicCaptureWitness }>;
export type JourneyCapture = Readonly<{ cycle: number; family: Family; leagueId: string | null; capture: Capture; payloadDigest: string }>;
type FailureCode = 'ordering' | 'request' | 'network' | 'http' | 'redirect' | 'body' | 'body-limit' | 'abort' | 'source' | 'witness' | 'scope'
  | 'discovery-empty' | 'discovery-limit' | 'discovery-invalid' | 'discovery-drift';
class BoundaryError extends Error { constructor(readonly reason: FailureCode) { super('Live public intake boundary rejected: ' + reason); } }
const same = (a: unknown, b: unknown) => qualificationDigest(a) === qualificationDigest(b);
const pathFor = (family: Family, subject: string) => family === 'identity' ? '/user/' + subject
  : family === 'leagues' ? '/user/' + subject + '/leagues/nfl/' + JOURNEY_SEASON
    : '/league/' + subject + (family === 'league' ? '' : '/' + family);

/** A test-only forwarding boundary. Adapters, timestamps, parsing, seals and witnesses remain unchanged.
 * Install fetch once for the case; concurrent core captures receive separate one-use request slots. */
export function createLiveJourney(transport: typeof fetch) {
  let index = 0, attempts = 0, totalBytes = 0;
  let leagueIds: readonly string[] | undefined;
  let steps: readonly Step[] = Object.freeze(journeySteps([]).slice(0, 2));
  const discovery: { cycle: number; rawCount: number | null; normalizedCount: number | null; payloadDigest: string;
    idsDigest: string | null; accepted: boolean }[] = [];
  const expected = () => {
    if (!leagueIds) return reject('ordering');
    const count = leagueIds.length;
    return { perCycle: 2 + 3 * count, admissions: 4 + 6 * count, claims: 5 + 6 * count,
      gets: 4 + 8 * count, typedReceipts: 4 * count };
  };
  let active: { step: Step; requestId: string | undefined; opened: Set<Family>; finished: Set<Family> } | undefined;
  const slots = new Map<string, { dispatched: boolean }>();
  const controller = new AbortController();
  const captures: JourneyCapture[] = [];
  const receipts: { cycle: number; family: Family; leagueId: string | null; bytes: number; sha256: string }[] = [];
  let failure: { reason: FailureCode; attempt: number } | undefined;
  const reject = (reason: FailureCode): never => {
    failure ??= { reason, attempt: attempts }; controller.abort(); throw new BoundaryError(failure.reason);
  };
  const available = () => { if (failure) reject(failure.reason); };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    available();
    if (typeof input !== 'string') return reject('request');
    const slot = slots.get(input);
    if (!slot || slot.dispatched || !active || !init || (init.method !== undefined && init.method !== 'GET')
      || init.body !== undefined || init.redirect !== 'error' || init.cache !== 'no-store' || !init.signal
      || [...new Headers(init.headers)].some(([key, value]) => key !== 'accept' || value !== 'application/json')) return reject('request');
    slot.dispatched = true;
    if (++attempts > JOURNEY_MAX_GETS) return reject('request');
    const signal = AbortSignal.any([init.signal, controller.signal]);
    let response: Response;
    try { signal.throwIfAborted(); response = await transport(input, { ...init, signal }); }
    catch { return reject(signal.aborted ? 'abort' : 'network'); }
    if (response.status !== 200 || response.redirected || !response.body) {
      void response.body?.cancel().catch(() => undefined);
      return reject(response.redirected ? 'redirect' : response.status !== 200 ? 'http' : 'body');
    }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    let abort: (() => void) | undefined;
    const aborted = new Promise<never>((_, fail) => {
      abort = () => fail(new BoundaryError('abort'));
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    });
    try {
      while (true) {
        const part = await Promise.race([reader.read(), aborted]); if (part.done) break;
        bytes += part.value.byteLength; totalBytes += part.value.byteLength;
        if (bytes > JOURNEY_BODY_BYTES || totalBytes > JOURNEY_TOTAL_BYTES) return reject('body-limit');
        chunks.push(part.value);
      }
      const body = Buffer.concat(chunks, bytes);
      const family = input.endsWith('/rosters') ? 'rosters' : input.endsWith('/users') ? 'users'
        : input.includes('/leagues/nfl/') ? 'leagues' : input.includes('/user/') ? 'identity' : 'league';
      receipts.push({ cycle: active.step.cycle, family, leagueId: active.step.leagueId ?? null, bytes,
        sha256: createHash('sha256').update(body).digest('hex') });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (error) { return reject(error instanceof BoundaryError ? error.reason : signal.aborted ? 'abort' : 'body'); }
    finally { if (abort) signal.removeEventListener('abort', abort); void reader.cancel().catch(() => undefined); }
  };
  async function capture<T extends Capture>(family: Family, subject: string, signal: AbortSignal,
    witness: PublicCaptureWitness | undefined, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    available(); const current = active;
    if (!current || !witness || witness.work.kind !== current.step.kind
      || (current.requestId !== undefined && witness.work.requestId !== current.requestId)) return reject('witness');
    const work = witness.work;
    if (work.kind === 'identity' ? subject !== (current.step.cycle === 1 ? JOURNEY_USERNAME : JOURNEY_MANAGER) || work.username !== subject
      : work.kind === 'leagues' ? subject !== JOURNEY_MANAGER || work.userId !== subject || work.season !== JOURNEY_SEASON
        : subject !== current.step.leagueId || work.externalLeagueId !== subject || work.season !== JOURNEY_SEASON) return reject('scope');
    const expected: readonly Family[] = current.step.kind === 'core' ? ['league', 'rosters']
      : [current.step.kind === 'bootstrap' ? 'league' : current.step.kind];
    if (!expected.includes(family) || current.opened.has(family)) return reject('ordering');
    current.opened.add(family);
    const url = 'https://api.sleeper.app/v1' + pathFor(family, subject); const slot = { dispatched: false }; slots.set(url, slot);
    try {
      const value = await action(AbortSignal.any([signal, controller.signal]));
      if (!slot.dispatched) return reject('request');
      assertOriginalPublicCapture(value, witness);
      if (family === 'identity') {
        const identity = value as unknown as Awaited<ReturnType<typeof capturePublicSleeperIdentity>>;
        if (!identity.value || identity.value.userId !== JOURNEY_MANAGER || identity.value.username.toLowerCase() !== JOURNEY_USERNAME.toLowerCase()) return reject('source');
      }
      // Retain the exact sealed capture even when discovery is refused. No replacement
      // list can reach the intake checkpoint, and diagnostics expose only counts/digests.
      captures.push({ cycle: current.step.cycle, family, leagueId: current.step.leagueId ?? null,
        capture: value, payloadDigest: qualificationDigest(value.payload) });
      if (family === 'leagues') {
        const list = value as unknown as Awaited<ReturnType<typeof capturePublicSleeperLeagueList>>;
        const rawIds = Array.isArray(list.payload) ? list.payload.map(row => row?.league_id) : null;
        const normalizedIds = list.value?.map(row => row.id) ?? null;
        const valid = rawIds !== null && normalizedIds !== null && rawIds.length >= 1 && rawIds.length <= JOURNEY_MAX_LEAGUES
          && rawIds.every(id => typeof id === 'string' && /^[1-9]\d{0,31}$/u.test(id))
          && new Set(rawIds).size === rawIds.length && new Set(normalizedIds).size === normalizedIds.length
          && list.value!.every(row => row.season === String(JOURNEY_SEASON))
          && same([...rawIds].sort(), [...normalizedIds].sort());
        const ids = valid ? [...normalizedIds!].sort() : null;
        const accepted = ids !== null && (leagueIds === undefined || same(ids, leagueIds));
        discovery.push({ cycle: current.step.cycle, rawCount: rawIds?.length ?? null, normalizedCount: normalizedIds?.length ?? null,
          payloadDigest: qualificationDigest(list.payload), idsDigest: ids ? qualificationDigest(ids) : null, accepted });
        if (!accepted) return reject(rawIds?.length === 0 ? 'discovery-empty'
          : rawIds && rawIds.length > JOURNEY_MAX_LEAGUES ? 'discovery-limit' : !valid ? 'discovery-invalid' : 'discovery-drift');
        if (leagueIds === undefined) { leagueIds = Object.freeze(ids!); steps = journeySteps(leagueIds); }
      }
      current.finished.add(family); return value;
    } catch (error) { return reject(error instanceof BoundaryError ? error.reason : 'source'); }
    finally { slots.delete(url); }
  }
  const source: NonNullable<PublicIntakeDependencies['source']> = {
    identity: (username, signal, witness) => capture('identity', username, signal, witness,
      combined => capturePublicSleeperIdentity(username, combined, witness)),
    leagues: (manager, season, signal, witness) => {
      if (season !== JOURNEY_SEASON) return reject('scope');
      return capture('leagues', manager, signal, witness, combined => capturePublicSleeperLeagueList(manager, season, combined, witness));
    },
    core: (league, family, signal, witness) => capture(family, league, signal, witness,
      combined => capturePublicSleeperCore(league, family, combined, undefined, witness)),
  };
  return { fetch, source, captures,
    get leagueIds() { return leagueIds ?? []; }, get steps() { return steps; }, get expected() { return expected(); },
    beginStep(requestId?: string) {
      available(); if (active || !steps[index]) return reject('ordering');
      active = { step: steps[index], requestId, opened: new Set(), finished: new Set() }; return active.step;
    },
    finishStep(progress: boolean) {
      available(); if (!active || slots.size) return reject('ordering');
      if (progress ? active.finished.size !== (active.step.kind === 'core' ? 2 : 1) : active.opened.size !== 0) return reject('ordering');
      if (progress) index++; active = undefined;
    },
    assertComplete() {
      available(); const counts = expected();
      if (active || index !== counts.admissions || attempts !== counts.gets || captures.length !== counts.gets) reject('ordering');
    },
    snapshot() { return { steps: index, attempts, totalBytes, discovery: discovery.map(row => ({ ...row })),
      expected: leagueIds ? expected() : null, failure: failure ? { ...failure } : null,
      receipts: receipts.map(row => ({ ...row })), captures: captures.map(row => ({ cycle: row.cycle, family: row.family,
        leagueId: row.leagueId, requestStartedAt: row.capture.requestStartedAt, requestCompletedAt: row.capture.requestCompletedAt,
        payloadDigest: row.payloadDigest, witnessDigest: qualificationDigest(row.capture.acquisition) })) }; },
  };
}
