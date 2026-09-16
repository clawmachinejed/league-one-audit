import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeAdministrationObservation } from './league-administration/normalize';
import type { AdministrationEnvelope } from './league-administration/contracts';

vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: <T,>(value: T) => value }));
vi.mock('next/cache', () => ({ unstable_cache: <T,>(value: T) => value }));
import { getOfficialAdministrationMetadata, getOfficialAdministrationObservation, getOfficialDraftAdministration,
  type CapturedAdministrationDocument } from './sleeper';

const league = 'metadata-league';
const draft = { draft_id: 'draft-1', league_id: league, season: '2026', sport: 'nfl', settings: { rounds: 3 }, vendor_extension: true };
const pick = { draft_id: 'draft-1', player_id: 'player-1', pick_no: 1, round: 1, metadata: { unusual: 'retained' } };
let responses: Record<string, unknown>;
let failures: Set<string>;
const paths = () => vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url)).pathname.replace(/^\/v1/u, ''));
function normalizeCaptured(observation: CapturedAdministrationDocument) {
  return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: league, season: 2026 },
    family: observation.family, week: observation.week, payload: observation.payload as AdministrationEnvelope['payload'],
    completeness: observation.completeness ?? 'complete', provenance: { ...observation, checkedAt: new Date().toISOString() } });
}
beforeEach(() => {
  responses = { [`/league/${league}/drafts`]: [draft], [`/draft/${draft.draft_id}`]: draft,
    [`/draft/${draft.draft_id}/picks`]: [pick], [`/draft/${draft.draft_id}/traded_picks`]: [],
    [`/league/${league}/traded_picks`]: [], [`/league/${league}/winners_bracket`]: [], [`/league/${league}/losers_bracket`]: [] };
  failures = new Set();
  vi.stubGlobal('fetch', vi.fn(async url => {
    const path = new URL(String(url)).pathname.replace(/^\/v1/u, '');
    if (failures.has(path)) return new Response('failed', { status: 503 });
    if (!Object.hasOwn(responses, path)) throw new Error(`Unexpected provider path: ${path}`);
    return Response.json(responses[path]);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('bounded official administration metadata source', () => {
  it('captures all four families and original draft bodies with seven bounded requests', async () => {
    const result = await getOfficialAdministrationMetadata(league, 2026, { maxRequests: 7 });
    expect(result.reason).toBeUndefined();
    expect(result.providerRequests).toBe(7);
    expect(paths()).toHaveLength(7);
    expect(result.observations.map(document => document.family)).toEqual(['traded_picks', 'winners_bracket', 'losers_bracket', 'drafts']);
    expect(result.observations[3].payload).toEqual([{ catalog: draft, draft, picks: [pick], traded_picks: [] }]);
    for (const observation of result.observations) {
      expect(observation.origin).toBe('network');
      expect(Date.parse(observation.requestCompletedAt)).toBeGreaterThanOrEqual(Date.parse(observation.requestStartedAt));
      const envelope: AdministrationEnvelope = { ...observation, payload: observation.payload as never,
        schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
        scope: { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: league, season: 2026 },
        completeness: observation.completeness ?? 'complete', provenance: { ...observation, checkedAt: new Date().toISOString() } };
      expect(normalizeAdministrationObservation(envelope).status).toBe('accepted');
    }
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.cache === 'no-store')).toBe(true);
  });

  it('retains complete empty source inventories without inventing draft requests', async () => {
    responses[`/league/${league}/drafts`] = [];
    const result = await getOfficialAdministrationMetadata(league, 2026, { maxRequests: 4 });
    expect(result).toMatchObject({ providerRequests: 4 });
    expect(result.reason).toBeUndefined();
    expect(result.observations.every(document => Array.isArray(document.payload) && document.payload.length === 0)).toBe(true);
  });

  it.each(['winners_bracket', 'losers_bracket'] as const)('retains successful unpublished %s as complete raw null', async family => {
    responses[`/league/${league}/${family}`] = null;
    const result = await getOfficialAdministrationMetadata(league, 2026, { maxRequests: 7 });
    expect(result.reason).toBeUndefined();
    expect(result.providerRequests).toBe(7);
    expect(paths()).toHaveLength(7);
    const observation = result.observations.find(document => document.family === family)!;
    expect(observation).toMatchObject({ family, payload: null, origin: 'network' });
    expect(observation.completeness ?? 'complete').toBe('complete');
    expect(observation.sourceObservedAt).toBe(observation.requestCompletedAt);
    expect(normalizeCaptured(observation)).toMatchObject({ status: 'accepted', envelope: { payload: null, completeness: 'complete' } });
  });

  it.each(['winners_bracket', 'losers_bracket'] as const)('keeps an HTTP503 %s response partial and rejected', async family => {
    failures.add(`/league/${league}/${family}`);
    const result = await getOfficialAdministrationMetadata(league, 2026, { maxRequests: 7 });
    expect(result).toMatchObject({ reason: 'metadata-source-partial', providerRequests: 7 });
    expect(paths()).toHaveLength(7);
    const observation = result.observations.find(document => document.family === family)!;
    expect(observation).toMatchObject({ family, payload: null, origin: 'network', completeness: 'partial', sourceObservedAt: null });
    expect(normalizeCaptured(observation).status).toBe('rejected');
  });

  it.each(['winners_bracket', 'losers_bracket'] as const)('preserves a malformed %s object without accepting it as an unpublished bracket', async family => {
    const malformed = { matches: [] };
    responses[`/league/${league}/${family}`] = malformed;
    const result = await getOfficialAdministrationMetadata(league, 2026, { maxRequests: 7 });
    expect(result).toMatchObject({ reason: 'metadata-source-partial', providerRequests: 7 });
    const observation = result.observations.find(document => document.family === family)!;
    expect(observation.payload).toEqual(malformed);
    expect(normalizeCaptured(observation).status).toBe('rejected');
  });

  it.each(['traded_picks', 'drafts'] as const)('keeps successful null %s outside the bracket-only allowance', async family => {
    responses[`/league/${league}/${family}`] = null;
    const result = await getOfficialAdministrationMetadata(league, 2026, { maxRequests: 7 });
    expect(result.reason).toBe('metadata-source-partial');
    const observation = result.observations.find(document => document.family === family)!;
    expect(observation.payload).toBeNull();
    expect(normalizeCaptured(observation).status).toBe('rejected');
  });

  it('refuses an insufficient aggregate budget before any provider request', async () => {
    const result = await getOfficialAdministrationMetadata(league, 2026, { maxRequests: 3 });
    expect(result).toMatchObject({ reason: 'metadata-request-budget-exceeded', providerRequests: 0 });
    expect(result.observations.every(document => document.payload === null && document.completeness === 'partial')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('checks the complete draft budget before any detail fanout', async () => {
    const result = await getOfficialDraftAdministration(league, 2026, { maxRequests: 3 });
    expect(result).toMatchObject({ reason: 'metadata-request-budget-exceeded', providerRequests: 1 });
    expect(paths()).toEqual([`/league/${league}/drafts`]);
    expect(result.observations[0]).toMatchObject({ completeness: 'partial', payload: [{ catalog: draft, draft: null, picks: null, traded_picks: null }] });
  });

  it('retains an oversized catalog and refuses more than eight draft bundles', async () => {
    responses[`/league/${league}/drafts`] = Array.from({ length: 9 }, (_, i) => ({ ...draft, draft_id: `draft-${i}` }));
    expect(await getOfficialDraftAdministration(league, 2026, { maxRequests: 120 }))
      .toMatchObject({ reason: 'draft-inventory-limit', providerRequests: 1 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(['league', 'season', 'duplicate', 'path'])('rejects %s catalog identity before following draft endpoints', async mismatch => {
    responses[`/league/${league}/drafts`] = mismatch === 'duplicate' ? [draft, draft]
      : [{ ...draft, ...(mismatch === 'league' ? { league_id: 'another' } : mismatch === 'season' ? { season: '2025' } : { draft_id: '../other' }) }];
    expect(await getOfficialDraftAdministration(league, 2026, { maxRequests: 25 }))
      .toMatchObject({ reason: 'metadata-source-partial', providerRequests: 1 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('retains successful bodies and a missing response as partial evidence', async () => {
    failures.add(`/draft/${draft.draft_id}/picks`);
    const result = await getOfficialDraftAdministration(league, 2026, { maxRequests: 4 });
    expect(result).toMatchObject({ reason: 'metadata-source-partial', providerRequests: 4 });
    expect(result.observations[0]).toMatchObject({ completeness: 'partial', sourceObservedAt: null,
      payload: [{ catalog: draft, draft, picks: null, traded_picks: [] }] });
  });

  it('provides a direct single-family read without unrelated metadata fanout', async () => {
    expect((await getOfficialAdministrationObservation(league, 'winners_bracket', null)).payload).toEqual([]);
    expect(paths()).toEqual([`/league/${league}/winners_bracket`]);
  });

  it('honors the shared deadline before any metadata request', async () => {
    await expect(getOfficialAdministrationMetadata(league, 2026, { maxRequests: 120,
      signal: AbortSignal.abort(new Error('Deadline')) })).rejects.toThrow('Deadline');
    expect(fetch).not.toHaveBeenCalled();
  });
});
