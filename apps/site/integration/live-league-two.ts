import { createHash } from 'node:crypto';
import { LEAGUE_IDS } from '../lib/config';
import { capturePublicSleeperCore } from '../lib/sleeper';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { ADMINISTRATION_SCHEMA_VERSION, ADMINISTRATION_NORMALIZER_VERSION, ADMINISTRATION_DIALECT } from '../lib/league-administration/contracts';
import type { AdministrationScope, CapturedAdministrationDocument, JsonValue } from '../lib/league-administration/contracts';

export const LIVE_LEAGUE_ID = '1378850360529014784';
export const LIVE_CAPTURE_FAMILIES = ['league', 'league', 'rosters', 'users'] as const;
export const LIVE_RESPONSE_BYTES = 1_048_576;
export const LIVE_TOTAL_BYTES = LIVE_RESPONSE_BYTES * LIVE_CAPTURE_FAMILIES.length;
type Family = typeof LIVE_CAPTURE_FAMILIES[number];
type TransportReceipt = { family: Family; bytes: number; sha256: string };
const failureCodes = ['ordering', 'request', 'network', 'http', 'redirect', 'body', 'body-limit', 'abort', 'json', 'source-shape', 'source-id', 'source-season', 'source-population'] as const;
type FailureCode = typeof failureCodes[number];
class LiveSourceError extends Error { constructor(readonly reason: FailureCode) { super('Live League Two capture boundary rejected.'); } }
const invalid = (reason: FailureCode = 'source-shape') => new LiveSourceError(reason);

/** Test-only forwarding guard around the existing adapter. No retry or alternative transport. */
export function createLiveCaptures(transport: typeof fetch = globalThis.fetch) {
  if (LEAGUE_IDS.league2 !== LIVE_LEAGUE_ID) throw invalid();
  let attempts = 0, totalBytes = 0, active = false, failed = false;
  const receipts: TransportReceipt[] = [];
  let failure: { reason: FailureCode; family: Family | null; attempt: number; httpStatus?: number } | undefined;
  const remember = (error: unknown, family: Family | null = null, reason: FailureCode = 'source-shape', httpStatus?: number) => {
    failure ??= { reason: error instanceof LiveSourceError && failureCodes.includes(error.reason) ? error.reason : reason, family,
      attempt: Math.min(4, attempts), ...(httpStatus !== undefined ? { httpStatus } : {}) };
  };
  return {
    failure: (error: unknown) => { if (error instanceof LiveSourceError) remember(error); },
    snapshot: () => ({ attempts, totalBytes, failure: failure ? { ...failure } : null, receipts: receipts.map(receipt => ({ ...receipt })) }),
    async capture(family: Family): Promise<CapturedAdministrationDocument> {
      if (failed || active || LIVE_CAPTURE_FAMILIES[attempts] !== family) { failed = true; const error = invalid('ordering'); remember(error, LIVE_CAPTURE_FAMILIES.includes(family) ? family : null); throw error; }
      active = true;
      const original = globalThis.fetch;
      const expected = 'https://api.sleeper.app/v1/league/' + LIVE_LEAGUE_ID + (family === 'league' ? '' : '/' + family);
      let dispatched = false;
      let phase: FailureCode = 'network';
      const requestState: { signal?: AbortSignal } = {};
      globalThis.fetch = async (input, init) => {
        if (dispatched || typeof input !== 'string' || input !== expected || !init
          || (init.method !== undefined && init.method !== 'GET') || init.body !== undefined
          || init.redirect !== 'error' || init.cache !== 'no-store' || !init.signal) throw invalid('request');
        const headers = new Headers(init.headers);
        if ([...headers].some(([name, value]) => name !== 'accept' || value !== 'application/json')) throw invalid('request');
        requestState.signal = init.signal; dispatched = true; attempts++; // Count before dispatch: failures consume their one attempt.
        const response = await transport(input, init);
        if (response.status !== 200 || response.redirected || !response.body) {
          const error = invalid(response.redirected ? 'redirect' : response.status !== 200 ? 'http' : 'body');
          remember(error, family, error.reason, Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : undefined);
          void response.body?.cancel().catch(() => undefined); throw error;
        }
        phase = 'body';
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let size = 0;
        let abort: (() => void) | undefined;
        const aborted = new Promise<never>((_, reject) => {
          abort = () => reject(invalid('abort'));
          init.signal!.addEventListener('abort', abort, { once: true });
          if (init.signal!.aborted) abort();
        });
        try {
          while (true) {
            const part = await Promise.race([reader.read(), aborted]);
            if (part.done) break;
            size += part.value.byteLength; totalBytes += part.value.byteLength;
            if (size > LIVE_RESPONSE_BYTES || totalBytes > LIVE_TOTAL_BYTES) throw invalid('body-limit');
            chunks.push(part.value);
          }
          const body = Buffer.concat(chunks, size);
          receipts.push({ family, bytes: size, sha256: createHash('sha256').update(body).digest('hex') });
          phase = 'json';
          return new Response(body, { status: response.status, headers: { 'content-type': 'application/json' } });
        } finally {
          if (abort) init.signal.removeEventListener('abort', abort);
          void reader.cancel().catch(() => undefined);
        }
      };
      try { return await capturePublicSleeperCore(LIVE_LEAGUE_ID, family, AbortSignal.timeout(20_000)); }
      catch (error) { failed = true; remember(error, family, requestState.signal?.aborted ? 'abort' : phase); throw invalid(failure!.reason); }
      finally { globalThis.fetch = original; active = false; }
    },
  };
}
export type LiveLeagueExpectation = Readonly<{ leagueId: string; season: number }>;
export function liveLeagueMetadata(payload: unknown, expected: LiveLeagueExpectation = { leagueId: LIVE_LEAGUE_ID, season: 2026 }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid();
  const league = payload as Record<string, unknown>;
  if (league.league_id !== expected.leagueId) throw invalid('source-id');
  if (league.season !== String(expected.season)) throw invalid('source-season');
  if (!Number.isSafeInteger(league.total_rosters) || Number(league.total_rosters) < 1 || Number(league.total_rosters) > 32) throw invalid('source-population');
  if (league.sport !== 'nfl' || typeof league.name !== 'string' || !league.name.length || league.name.length > 256
    || !Number.isSafeInteger(league.total_rosters) || Number(league.total_rosters) < 1 || Number(league.total_rosters) > 32) throw invalid();
  return { name: league.name, season: Number(league.season), totalRosters: Number(league.total_rosters) };
}
/** Canonical expected write input, built from retained capture bytes before any writer call. */
export function normalizeLiveCapture(scope: AdministrationScope, document: CapturedAdministrationDocument, checkedAt: string,
  expectedRosterCount: number) {
  return normalizeAdministrationObservation({ schemaVersion: ADMINISTRATION_SCHEMA_VERSION, normalizerVersion: ADMINISTRATION_NORMALIZER_VERSION,
    dialect: ADMINISTRATION_DIALECT, scope, family: document.family, week: null, payload: document.payload as JsonValue,
    completeness: 'complete', provenance: { origin: 'network', requestStartedAt: document.requestStartedAt,
      requestCompletedAt: document.requestCompletedAt, sourceObservedAt: document.sourceObservedAt ?? null, checkedAt,
      ...(document.acquisition ? { acquisition: document.acquisition } : {}) } },
  { expectedRosterCount, managerEvidenceVersion: 'v2' });
}
/** Small independent raw-field oracle. It does not recreate the canonical normalizer. */
export function liveRawOracle(leaguePayload: unknown, rosterPayload: unknown, usersPayload: unknown, expected?: LiveLeagueExpectation) {
  const metadata = liveLeagueMetadata(leaguePayload, expected);
  const league = leaguePayload as Record<string, unknown>;
  if (!league.scoring_settings || typeof league.scoring_settings !== 'object' || Array.isArray(league.scoring_settings)
    || !Object.values(league.scoring_settings).every(value => typeof value === 'number' && Number.isFinite(value))
    || !Array.isArray(league.roster_positions) || !league.roster_positions.every(value => typeof value === 'string' && value.length <= 64)
    || !Array.isArray(rosterPayload) || !Array.isArray(usersPayload)) throw invalid();
  const nativeId = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[0-9]{1,32}$/u.test(value)) throw invalid(); return value;
  };
  const ids = (values: unknown, player = false): string[] => {
    if (!Array.isArray(values) || values.length > 256) throw invalid();
    const result = values.map(value => { if (!player) return nativeId(value);
      if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(value)) throw invalid(); return value; }).sort(); if (new Set(result).size !== result.length) throw invalid(); return result;
  };
  const teams = rosterPayload.map(raw => {
    if (!raw || typeof raw !== 'object' || !Number.isSafeInteger(raw.roster_id) || raw.roster_id < 1) throw invalid();
    const owner = raw.owner_id === null ? null : nativeId(raw.owner_id);
    const coOwners = raw.co_owners === null ? { state: 'unknown' as const, reason: 'co_managers_null', ids: null }
      : !Object.hasOwn(raw, 'co_owners') ? { state: 'unknown' as const, reason: 'co_managers_absent', ids: null }
      : { state: 'known' as const, ids: ids(raw.co_owners) };
    return { externalRosterId: String(raw.roster_id), players: ids(raw.players, true), owner, coOwners };
  }).sort((a, b) => a.externalRosterId.localeCompare(b.externalRosterId));
  if (teams.length !== metadata.totalRosters || new Set(teams.map(team => team.externalRosterId)).size !== teams.length) throw invalid('source-population');
  const directory = ids(usersPayload.map(raw => raw?.user_id));
  return { metadata, rules: league.scoring_settings as Record<string, number>, slots: league.roster_positions as string[], teams, directory };
}
/** Granular JSON assertions for dynamic native keys and array tails. The callback's Vitest matcher
 * remains the sole equality authority. Each failure retains one bounded owned/aliased path and value. */
export function assertLiveJson(actual: unknown, expected: unknown,
  compare: (id: 'live.json.type' | 'live.json.length' | 'live.json.key' | 'live.json.value', actual: unknown, expected: unknown) => void,
  resource: 'settings' | 'directory' | 'population') {
  let nodes = 0;
  const walk = (a: unknown, e: unknown, path: (string | number)[]) => {
    if (++nodes > 4_096 || path.length > 16) throw new Error('Live JSON assertion bound exceeded.');
    const kind = (value: unknown) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    compare('live.json.type', { path, value: kind(a) }, { path, value: kind(e) });
    if (e === null || typeof e !== 'object') { compare('live.json.value', { path, value: a }, { path, value: e }); return; }
    if (!a || typeof a !== 'object') return; // The authoritative type assertion above already failed.
    const left = Object.getOwnPropertyDescriptors(a), right = Object.getOwnPropertyDescriptors(e);
    if (Object.values(left).some(field => !Object.hasOwn(field, 'value')) || Object.values(right).some(field => !Object.hasOwn(field, 'value'))) throw new Error('Live JSON accessor rejected.');
    if (Array.isArray(e)) {
      compare('live.json.length', { path, length: left.length?.value }, { path, length: right.length.value });
      for (let index = 0; index < e.length; index++) walk(left[index]?.value, right[index]?.value, [...path, index]);
    } else {
      const keys = Object.keys(right).sort(), actualKeys = Object.keys(left).sort();
      compare('live.json.length', { path, length: actualKeys.length }, { path, length: keys.length });
      for (let index = 0; index < keys.length; index++) {
        compare('live.json.key', { path, ordinal: index, value: actualKeys[index] }, { path, ordinal: index, value: keys[index] });
        walk(left[keys[index]]?.value, right[keys[index]].value, [...path, keys[index]]);
      }
    }
  };
  walk(actual, expected, [resource]);
}
