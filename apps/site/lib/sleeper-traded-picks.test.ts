import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeAdministrationObservation } from './league-administration/normalize';
import { projectTradedPicks } from './aggregator/traded-picks';
import type { AdministrationEnvelope } from './league-administration/contracts';
vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: <T,>(value: T) => value }));
vi.mock('next/cache', () => ({ unstable_cache: <T,>(value: T) => value }));
import { getOfficialDraftAdministration, getOfficialAdministrationMetadata, type CapturedAdministrationDocument } from './sleeper';
const league = '123456789', draft = { draft_id: 'draft1', league_id: league, season: '2026', sport: 'nfl' };
const pick = { season: '2027', round: 1, roster_id: 1, owner_id: 2, previous_owner_id: 1 };
let responses: Record<string, unknown>;
const paths = () => vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url)).pathname.replace(/^\/v1/u, ''));
const capture = (maxRequests = 10) => getOfficialDraftAdministration(league, 2026, { tradedPicksOnly: true, maxRequests });
function projected(document: CapturedAdministrationDocument) {
  return projectTradedPicks(normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: { leagueKey: 'fixture', provider: 'sleeper', externalLeagueId: league, season: 2026 }, family: 'drafts', week: null,
    payload: document.payload as AdministrationEnvelope['payload'], completeness: document.completeness ?? 'complete',
    provenance: { origin: 'network', requestStartedAt: document.requestStartedAt, requestCompletedAt: document.requestCompletedAt,
      sourceObservedAt: document.sourceObservedAt, checkedAt: new Date().toISOString() } }));
}
beforeEach(() => {
  responses = { [`/league/${league}/traded_picks`]: [pick], [`/league/${league}/drafts`]: [draft], '/draft/draft1/traded_picks': [pick] };
  vi.stubGlobal('fetch', vi.fn(async url => {
    const path = new URL(String(url)).pathname.replace(/^\/v1/u, '');
    if (!Object.hasOwn(responses, path)) throw Error('Unexpected endpoint');
    if (responses[path] instanceof Error) throw responses[path];
    return Response.json(responses[path]);
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('bounded traded picks collection through the existing draft owner', () => {
  it('retains each native endpoint and clock without future season requests', async () => {
    const result = await capture(); expect(paths()).toEqual([`/league/${league}/traded_picks`, `/league/${league}/drafts`, '/draft/draft1/traded_picks']);
    expect(result.providerRequests).toBe(3); expect(result.observations).toHaveLength(3);
    expect(projected(result.observations[0])).toMatchObject({ value: { kind: 'league', complete: true, externalDraftId: null, entries: [{ pickSeason: { value: '2027' } }] } });
    expect(projected(result.observations[2])).toMatchObject({ value: { kind: 'draft', complete: true, externalDraftId: 'draft1' } });
    for (let i = 1; i < result.observations.length; i++) expect(result.observations[i - 1].requestCompletedAt <= result.observations[i].requestStartedAt).toBe(true);
    for (const [,options] of vi.mocked(fetch).mock.calls) expect(options).toMatchObject({ cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) });
  });
  it.each([0, 1, 2])('honestly accounts for request allowance %s without fanout', async max => {
    const result = await capture(max); expect(result.providerRequests).toBe(max); expect(paths()).toHaveLength(max);
    expect(result.reason).toBe('metadata-request-budget-exceeded'); expect(result.observations).toHaveLength(2);
    expect(projected(result.observations[0])).toMatchObject({ value: { complete: max > 0 } });
    expect(projected(result.observations[1])).toMatchObject({ value: { complete: false, attemptedTradeCount: 0 } });
  });
  it('bounds eight drafts at ten total attempts and retains nine draft inventory without fanout', async () => {
    responses[`/league/${league}/drafts`] = Array.from({ length: 8 }, (_, i) => ({ ...draft, draft_id: 'd' + i }));
    for (let i = 0; i < 8; i++) responses['/draft/d' + i + '/traded_picks'] = [];
    expect(await capture(120)).toMatchObject({ providerRequests: 10 }); expect(paths()).toHaveLength(10);
    vi.mocked(fetch).mockClear(); responses[`/league/${league}/drafts`] = Array.from({ length: 9 }, (_, i) => ({ ...draft, draft_id: 'd' + i }));
    const result = await capture(120); expect(result).toMatchObject({ providerRequests: 2, reason: 'draft-inventory-limit' });
    expect(projected(result.observations[1])).toMatchObject({ value: { totalCount: 9, unrequestedTradeCount: 9 } });
  });
  it('accepts complete league evidence independently of failed catalog or draft endpoints', async () => {
    responses[`/league/${league}/drafts`] = new Error('fixture catalog failure');
    const result = await capture(); expect(projected(result.observations[0])).toMatchObject({ value: { complete: true } });
    expect(projected(result.observations[1])).toMatchObject({ value: { complete: false, totalCount: null } });
    responses[`/league/${league}/drafts`] = [draft]; responses['/draft/draft1/traded_picks'] = null;
    const second = await capture(); expect(projected(second.observations[0])).toMatchObject({ value: { complete: true } });
    expect(projected(second.observations[2])).toMatchObject({ value: { complete: false, tradesState: 'null' } });
  });
  it('counts league bytes in the shared retained budget before catalog and detail', async () => {
    responses[`/league/${league}/traded_picks`] = [{ ...pick, padding: 'x'.repeat(5 * 1024 * 1024) }];
    responses[`/league/${league}/drafts`] = [{ ...draft, padding: 'x'.repeat(4 * 1024 * 1024) }];
    const result = await capture(); expect(result.providerRequests).toBe(2);
    expect(projected(result.observations[0])).toMatchObject({ value: { complete: true } });
    expect(projected(result.observations[1])).toMatchObject({ value: { complete: false, totalCount: null } });
    responses[`/league/${league}/drafts`] = [draft]; responses['/draft/draft1/traded_picks'] = [{ ...pick, padding: 'x'.repeat(4 * 1024 * 1024) }];
    const second = await capture(); expect(second.providerRequests).toBe(3);
    expect(projected(second.observations[2])).toMatchObject({ value: { complete: false, tradesState: 'null' } });
  });
  it('retains bounded row overflow as diagnostic and refuses decoded byte and depth overflow', async () => {
    responses[`/league/${league}/traded_picks`] = Array.from({ length: 10_001 }, () => pick);
    expect(projected((await capture()).observations[0]).status).toBe('rejected');
    responses[`/league/${league}/traded_picks`] = [{ ...pick, padding: 'x'.repeat(8 * 1024 * 1024) }];
    expect(projected((await capture()).observations[0])).toMatchObject({ value: { complete: false, tradesState: 'null' } });
    let nested: unknown = 1; for (let i = 0; i < 65; i++) nested = [nested];
    responses[`/league/${league}/traded_picks`] = nested;
    expect(projected((await capture()).observations[0])).toMatchObject({ value: { complete: false, tradesState: 'null' } });
  });
  it('cancels reservation waits under the original signal and rejects mixed capture modes or another season', async () => {
    const control = new AbortController();
    await expect(getOfficialDraftAdministration(league, 2026, { tradedPicksOnly: true, maxRequests: 10, signal: control.signal,
      beforeDetail: async () => { control.abort(Error('original deadline')); await new Promise(() => {}); } })).rejects.toThrow('original deadline');
    expect(paths()).toHaveLength(2); vi.mocked(fetch).mockClear();
    for (const other of [{ selectionsOnly: true }, { metadataOnly: true }]) await expect(getOfficialDraftAdministration(league, 2026, { tradedPicksOnly: true, maxRequests: 10, ...other })).rejects.toThrow();
    await expect(getOfficialDraftAdministration(league, 2027, { tradedPicksOnly: true, maxRequests: 10 })).rejects.toThrow();
    await expect(getOfficialAdministrationMetadata(league, 2026, { tradedPicksOnly: true, maxRequests: 10 })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
