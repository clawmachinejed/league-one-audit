import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeAdministrationObservation } from './league-administration/normalize';
import { projectDraftMetadata } from './aggregator/draft-metadata';
import type { AdministrationEnvelope } from './league-administration/contracts';
vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: <T,>(value: T) => value }));
vi.mock('next/cache', () => ({ unstable_cache: <T,>(value: T) => value }));
import { getOfficialDraftAdministration, getOfficialAdministrationMetadata, type CapturedAdministrationDocument } from './sleeper';

const league = '123456789';
const draft = { draft_id: 'draft1', league_id: league, season: '2026', sport: 'nfl', status: 'pre_draft' };
let responses: Record<string, unknown>;
const paths = () => vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url)).pathname.replace(/^\/v1/u, ''));
function projected(observation: CapturedAdministrationDocument) {
  return projectDraftMetadata(normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: { leagueKey: 'fixture', provider: 'sleeper', externalLeagueId: league, season: 2026 },
    family: 'drafts', week: null, payload: observation.payload as AdministrationEnvelope['payload'],
    completeness: observation.completeness ?? 'complete', provenance: { origin: 'network', requestStartedAt: observation.requestStartedAt,
      requestCompletedAt: observation.requestCompletedAt, sourceObservedAt: observation.sourceObservedAt ?? null, checkedAt: new Date().toISOString() } }));
}
beforeEach(() => {
  responses = { [`/league/${league}/drafts`]: [draft], '/draft/draft1': draft };
  vi.stubGlobal('fetch', vi.fn(async url => {
    const path = new URL(String(url)).pathname.replace(/^\/v1/u, '');
    if (!Object.hasOwn(responses, path)) throw new Error('Unexpected endpoint.');
    return Response.json(responses[path]);
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const capture = (maxRequests = 9, signal?: AbortSignal) => getOfficialDraftAdministration(league, 2026, { metadataOnly: true, maxRequests, signal });

describe('bounded metadata-only official draft collection', () => {
  it('uses exactly catalog plus owned details and keeps catalog/detail drift and clocks separate', async () => {
    responses['/draft/draft1'] = { ...draft, status: 'drafting', settings: { rounds: 0, reversal: false } };
    const result = await capture();
    expect(paths()).toEqual([`/league/${league}/drafts`, '/draft/draft1']);
    expect(result.providerRequests).toBe(2);
    expect(result.reason).toBeUndefined();
    expect(result.observations).toHaveLength(2);
    expect(result.observations[0].requestCompletedAt <= result.observations[1].requestStartedAt).toBe(true);
    expect(projected(result.observations[0])).toMatchObject({ status: 'accepted', value: { complete: true, totalCount: 1, attemptedDetailCount: 1, succeededDetailCount: 1 } });
    expect(projected(result.observations[1])).toMatchObject({ status: 'accepted', value: { catalog: { status: { value: 'pre_draft' } }, detail: { status: { value: 'drafting' } } } });
    for (const [, options] of vi.mocked(fetch).mock.calls) expect(options).toMatchObject({ cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) });
  });
  it('retains all nine inventory identities before the cap and performs no detail GET', async () => {
    responses[`/league/${league}/drafts`] = Array.from({ length: 9 }, (_, i) => ({ ...draft, draft_id: `draft${i}` }));
    const result = await capture(120);
    expect(result).toMatchObject({ providerRequests: 1, reason: 'draft-inventory-limit' });
    expect(projected(result.observations[0])).toMatchObject({ status: 'accepted', value: { complete: false, totalCount: 9, validIdentityCount: 9,
      attemptedDetailCount: 0, unrequestedDetailCount: 9, entries: expect.arrayContaining([expect.objectContaining({ externalDraftId: 'draft8' })]) } });
  });
  it('reports insufficient whole-fanout budget before any detail request', async () => {
    const result = await capture(1);
    expect(paths()).toEqual([`/league/${league}/drafts`]);
    expect(result.reason).toBe('metadata-request-budget-exceeded');
    expect(projected(result.observations[0])).toMatchObject({ value: { attemptedDetailCount: 0, unrequestedDetailCount: 1 } });
  });
  it('preserves complete empty evidence and honest zero-request unknown evidence', async () => {
    responses[`/league/${league}/drafts`] = [];
    const empty = await capture();
    expect(projected(empty.observations[0])).toMatchObject({ value: { complete: true, totalCount: 0 } });
    const none = await capture(0);
    expect(none.providerRequests).toBe(0);
    expect(projected(none.observations[0])).toMatchObject({ value: { complete: false, totalCount: null } });
  });
  it('does not follow duplicate, foreign, wrong-season or path-injected identities', async () => {
    responses[`/league/${league}/drafts`] = [draft, draft, { ...draft, draft_id: 'foreign', league_id: 'elsewhere' },
      { ...draft, draft_id: 'prior', season: '2025' }, { ...draft, draft_id: '../picks' }, { ...draft, draft_id: 'good' }];
    responses['/draft/good'] = { ...draft, draft_id: 'good' };
    const result = await capture();
    expect(paths()).toEqual([`/league/${league}/drafts`, '/draft/good']);
    expect(projected(result.observations[0])).toMatchObject({ value: { complete: false, totalCount: 6, validIdentityCount: 1, invalidIdentityCount: 5,
      attemptedDetailCount: 1, succeededDetailCount: 1, unrequestedDetailCount: 5 } });
  });
  it('one detail failure retains successful siblings and does not fabricate picks/trades', async () => {
    responses[`/league/${league}/drafts`] = [draft, { ...draft, draft_id: 'two' }, { ...draft, draft_id: 'three' }];
    responses['/draft/three'] = { ...draft, draft_id: 'three' };
    const result = await capture();
    expect(result.providerRequests).toBe(4);
    expect(projected(result.observations[0])).toMatchObject({ value: { complete: false, attemptedDetailCount: 3, succeededDetailCount: 2, failedDetailCount: 1 } });
    expect(projected(result.observations[1]).status).toBe('accepted');
    expect(projected(result.observations[2]).status).toBe('rejected');
    expect(projected(result.observations[3]).status).toBe('accepted');
    expect(JSON.stringify(result)).not.toContain('"picks":[]');
    expect(JSON.stringify(result)).not.toContain('"traded_picks":[]');
  });
  it.each(['bytes', 'values', 'depth'] as const)('uses the shared %s response bound and reports unknown catalog total', async boundary => {
    let body: unknown = boundary === 'bytes' ? 'x'.repeat(8 * 1024 * 1024) : Array(250_000).fill(null);
    if (boundary === 'depth') { body = null; for (let i = 0; i < 65; i++) body = [body]; }
    responses[`/league/${league}/drafts`] = body;
    const result = await capture();
    expect(result).toMatchObject({ providerRequests: 1, reason: 'metadata-source-partial' });
    expect(projected(result.observations[0])).toMatchObject({ value: { totalCount: null, complete: false } });
  });
  it('enforces the aggregate native persistence budget across detail responses', async () => {
    responses[`/league/${league}/drafts`] = [draft, { ...draft, draft_id: 'two' }, { ...draft, draft_id: 'three' }];
    for (const id of ['draft1', 'two', 'three']) responses[`/draft/${id}`] = { ...draft, draft_id: id, extension: 'x'.repeat(3 * 1024 * 1024) };
    const result = await capture();
    expect(projected(result.observations[0])).toMatchObject({ value: { attemptedDetailCount: 3, succeededDetailCount: 2, failedDetailCount: 1 } });
    expect(result.observations[3]).toMatchObject({ completeness: 'partial', payload: { draft: null } });
  });
  it('stops a hanging reservation at the original caller deadline and never starts its detail', async () => {
    const controller = new AbortController();
    let reservedSignal: AbortSignal | undefined;
    const pending = getOfficialDraftAdministration(league, 2026, { metadataOnly: true, maxRequests: 9, signal: controller.signal,
      beforeDetail: async (_id, signal) => { reservedSignal = signal; controller.abort(new Error('original-work-expired')); await new Promise(() => {}); } });
    await expect(pending).rejects.toThrow('original-work-expired');
    expect(reservedSignal?.aborted).toBe(true);
    expect(paths()).toEqual([`/league/${league}/drafts`]);
  });
  it('never restarts the original twenty-second work deadline for a later detail', async () => {
    const actual = AbortSignal.timeout.bind(AbortSignal), calls: number[] = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { calls.push(ms); return actual(ms); });
    responses[`/league/${league}/drafts`] = Array.from({ length: 8 }, (_, i) => ({ ...draft, draft_id: `draft${i}` }));
    for (let i = 0; i < 8; i++) responses[`/draft/draft${i}`] = { ...draft, draft_id: `draft${i}` };
    expect((await capture(120)).providerRequests).toBe(9);
    expect(calls.filter(ms => ms === 20_000)).toHaveLength(1);
    expect(calls.filter(ms => ms === 12_000)).toHaveLength(9);
  });
  it('refuses a non2026 target or combined ancillary entry before source access', async () => {
    await expect(getOfficialDraftAdministration(league, 2025, { metadataOnly: true, maxRequests: 9 })).rejects.toThrow();
    await expect(getOfficialAdministrationMetadata(league, 2026, { metadataOnly: true, maxRequests: 9 })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
