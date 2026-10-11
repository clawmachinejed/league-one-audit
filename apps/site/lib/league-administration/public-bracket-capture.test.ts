import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturePublicSleeperCore } from '../sleeper';
import { projectPlayoffBracket, type BracketFamily } from '../aggregator/playoff-brackets';
import { ADMINISTRATION_DIALECT, ADMINISTRATION_NORMALIZER_VERSION, ADMINISTRATION_SCHEMA_VERSION,
  type AdministrationEnvelope, type CapturedAdministrationDocument, type JsonValue } from './contracts';
import { normalizeAdministrationObservation } from './normalize';
import { assertOriginalPublicCapture, parsePublicCaptureWitness, publicCaptureForRequest,
  validateRequestedPublicCaptureWitness, type PublicCaptureWitness } from './public-capture-witness';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));

const uuid = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const native = '9876543210', capturedAt = '2026-10-11T12:00:00.000Z';
const rows = [{ r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 },
  { r: 2, m: 2, t1: { w: 1 }, t2: null, p: 1 }];
function bracketWitness() {
  return {
    version: 'public-network-capture-v1' as const,
    work: { requestId: uuid(1), revision: 3, kind: 'playoff-brackets' as const, externalLeagueId: native, season: 2026 as const },
    fence: { jobKey: 'league-administration-public-intake', workerId: uuid(2), generation: 4,
      deadlineAt: '2026-10-11T12:00:20.000Z' },
    dispatchNonce: uuid(3),
    mapping: { connectionId: uuid(4), leagueSeasonId: uuid(5), revisionId: uuid(6), generation: 1,
      scope: { leagueKey: 'bracket-capture-fixture', provider: 'sleeper' as const, externalLeagueId: native, season: 2026 } },
    attempts: { winners_bracket: { id: uuid(10), nonce: uuid(20) }, losers_bracket: { id: uuid(11), nonce: uuid(21) } },
  } satisfies PublicCaptureWitness;
}
function envelope(capture: CapturedAdministrationDocument): AdministrationEnvelope {
  return { schemaVersion: ADMINISTRATION_SCHEMA_VERSION, normalizerVersion: ADMINISTRATION_NORMALIZER_VERSION,
    dialect: ADMINISTRATION_DIALECT, scope: bracketWitness().mapping.scope, family: capture.family, week: capture.week,
    completeness: 'complete', payload: capture.payload as JsonValue,
    provenance: { origin: 'network', requestStartedAt: capture.requestStartedAt,
      requestCompletedAt: capture.requestCompletedAt, sourceObservedAt: capture.sourceObservedAt ?? null,
      checkedAt: capture.requestCompletedAt, ...(capture.acquisition === undefined ? {} : { acquisition: capture.acquisition }) } };
}
function fixtureFetch(payload: unknown = rows) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(payload)));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const capture = (family: BracketFamily, witness?: PublicCaptureWitness) =>
  capturePublicSleeperCore(native, family, new AbortController().signal, undefined, witness);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(capturedAt);
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => { throw new Error('Unexpected outbound connection.'); });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected fixture HTTP request.'); }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('ordinary bracket capture through the maintained transport', () => {
  it.each(['winners_bracket', 'losers_bracket'] as const)('keeps the exact %s route, witness and typed source values', async family => {
    const fetch = fixtureFetch(), witness = bracketWitness();
    const document: CapturedAdministrationDocument = await capture(family, witness);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`https://api.sleeper.app/v1/league/${native}/${family}`,
      expect.objectContaining({ cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) }));
    expect(document).toMatchObject({ family, week: null, payload: rows, origin: 'network',
      requestStartedAt: capturedAt, requestCompletedAt: capturedAt, sourceObservedAt: capturedAt, acquisition: witness });
    expect(() => assertOriginalPublicCapture(document, witness)).not.toThrow();
    expect(Object.isFrozen(document.payload)).toBe(true);
    const normalized = normalizeAdministrationObservation(envelope(document));
    expect(normalized.status).toBe('accepted');
    expect(projectPlayoffBracket(normalized)).toMatchObject({ status: 'accepted', value: { family,
      publication: 'published', matches: [{ externalMatchupId: '1' }, { externalMatchupId: '2' }],
      edges: [{ sourceMatchupId: '1', targetMatchupId: '2', outcome: 'winner', sourceMatchPresent: true }] } });
    const plain = normalizeAdministrationObservation(envelope(await capture(family)));
    expect(plain.envelope.provenance).not.toHaveProperty('acquisition');
    expect(plain.contentHash).toBe(normalized.contentHash);
    expect(plain.semanticHash).toBe(normalized.semanticHash);
    expect(plain.value).toEqual(normalized.value);
  });

  it.each([null, []])('preserves the native unpublished/empty distinction for %j', async payload => {
    fixtureFetch(payload);
    const normalized = normalizeAdministrationObservation(envelope(await capture('winners_bracket', bracketWitness())));
    expect(normalized.envelope.payload).toEqual(payload);
    expect(projectPlayoffBracket(normalized)).toMatchObject({ status: 'accepted', value: {
      publication: payload === null ? 'unpublished' : 'published', rounds: [], matches: [], edges: [] } });
  });

  it('requires the exact paired reservations and rejects malformed or extra scope before HTTP', async () => {
    const witness = bracketWitness(), fetch = fixtureFetch();
    const invalid: unknown[] = [
      { ...witness, mapping: null },
      { ...witness, work: { ...witness.work, season: 2025 } },
      { ...witness, work: { ...witness.work, nativeWeek: 18 } },
      { ...witness, work: { ...witness.work, family: 'winners_bracket' } },
      { ...witness, attempts: { winners_bracket: witness.attempts.winners_bracket } },
      { ...witness, attempts: { ...witness.attempts, settings: { id: uuid(12), nonce: uuid(22) } } },
      { ...witness, attempts: { ...witness.attempts, losers_bracket: { ...witness.attempts.losers_bracket, id: uuid(10) } } },
      { ...witness, attempts: { ...witness.attempts, losers_bracket: { ...witness.attempts.losers_bracket, nonce: uuid(20) } } },
      { ...witness, mapping: { ...witness.mapping, scope: { ...witness.mapping.scope, externalLeagueId: '123' } } },
    ];
    for (const value of invalid) {
      expect(() => parsePublicCaptureWitness(value)).toThrow();
      await expect(capture('winners_bracket', value as PublicCaptureWitness)).rejects.toThrow();
    }
    await expect(capturePublicSleeperCore('123', 'winners_bracket', new AbortController().signal, undefined, witness)).rejects.toThrow(/scope mismatch/);
    await expect(capturePublicSleeperCore(native, 'league', new AbortController().signal, undefined, witness)).rejects.toThrow(/scope mismatch/);
    await expect(capturePublicSleeperCore(native, 'matchups', new AbortController().signal, 18, witness)).rejects.toThrow(/scope mismatch/);
    expect(() => publicCaptureForRequest(witness, 'winners_bracket', native, 18)).toThrow(/scope mismatch/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('compares exact family-to-attempt identity before accepting a reservation witness', () => {
    const witness = bracketWitness(), ids = { winners_bracket: uuid(10), losers_bracket: uuid(11) };
    expect(validateRequestedPublicCaptureWitness(witness, witness.work, witness.mapping, witness.fence, ids)).toEqual(witness);
    const wrongGroups: Readonly<Record<string, string>>[] = [
      { winners_bracket: uuid(11), losers_bracket: uuid(10) }, { winners_bracket: uuid(10) }];
    for (const attempts of wrongGroups) {
      expect(() => validateRequestedPublicCaptureWitness(witness, witness.work, witness.mapping, witness.fence, attempts)).toThrow();
    }
    expect(() => validateRequestedPublicCaptureWitness(witness, witness.work, witness.mapping,
      { ...witness.fence, deadlineAt: '2026-10-11T12:00:21.000Z' }, ids)).toThrow();
  });

  it('copies the original witness before HTTP and refuses reconstructed or retagged captures', async () => {
    const witness = bracketWitness(), original = structuredClone(witness), pending = Promise.withResolvers<Response>();
    vi.stubGlobal('fetch', vi.fn(() => pending.promise));
    const running = capture('losers_bracket', witness);
    witness.attempts.losers_bracket.id = uuid(99);
    pending.resolve(new Response(JSON.stringify(rows)));
    const document: CapturedAdministrationDocument = await running;
    expect(document.acquisition).toEqual(original);
    expect(() => assertOriginalPublicCapture(document, original)).not.toThrow();
    expect(() => assertOriginalPublicCapture({ ...document }, original)).toThrow(/Original public transport/);
    expect(() => assertOriginalPublicCapture(document, witness)).toThrow(/acquisition mismatch/);
    const retagged: CapturedAdministrationDocument = { ...document, family: 'winners_bracket' };
    expect(() => assertOriginalPublicCapture(retagged, original)).toThrow(/Original public transport/);
  });

  it('rejects a witness whose mapping or source season does not match normalized source scope', async () => {
    fixtureFetch();
    const source = envelope(await capture('winners_bracket', bracketWitness()));
    for (const scope of [{ ...source.scope, season: 2025 }, { ...source.scope, externalLeagueId: '123' }]) {
      const normalized = normalizeAdministrationObservation({ ...source, scope });
      expect(normalized.status).toBe('rejected');
      expect(normalized.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid_acquisition' }));
    }
    const unsupported = normalizeAdministrationObservation({ ...source, family: 'drafts' });
    expect(unsupported.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid_acquisition' }));
  });

  it('retains typed rejection for malformed or partial bracket facts without changing transport evidence', async () => {
    const witness = bracketWitness();
    fixtureFetch([{ r: 1, m: 1, t1: 1, t2: 1 }]);
    const malformed = normalizeAdministrationObservation(envelope(await capture('winners_bracket', witness)));
    expect(projectPlayoffBracket(malformed).status).toBe('rejected');
    fixtureFetch();
    const original = envelope(await capture('losers_bracket', witness));
    const partial = normalizeAdministrationObservation({ ...original, completeness: 'partial' });
    expect(partial.status).toBe('accepted');
    expect(projectPlayoffBracket(partial).status).toBe('rejected');
    expect(partial.envelope.provenance.acquisition).toEqual(witness);
  });

  it('keeps bracket HTTP failures single-attempt and applies the existing response structure bound', async () => {
    const failed = vi.fn(async () => new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', failed);
    await expect(capture('winners_bracket', bracketWitness())).rejects.toThrow();
    expect(failed).toHaveBeenCalledOnce();
    let nested: unknown = null;
    for (let depth = 0; depth < 65; depth++) nested = [nested];
    const bounded = fixtureFetch(nested);
    await expect(capture('losers_bracket', bracketWitness())).rejects.toThrow(/depth limit/);
    expect(bounded).toHaveBeenCalledOnce();
  });

  it('cancels a pending bracket response body with the original caller signal', async () => {
    const controller = new AbortController(), cancel = vi.fn();
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel })));
    vi.stubGlobal('fetch', fetch);
    const running = capturePublicSleeperCore(native, 'winners_bracket', controller.signal, undefined, bracketWitness());
    await Promise.resolve();
    controller.abort(new Error('original capture deadline'));
    await expect(running).rejects.toThrow(/original capture deadline/);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
