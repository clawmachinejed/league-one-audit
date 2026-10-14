import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeAdministrationObservation } from './league-administration/normalize';
import { projectDraftSelections } from './aggregator/draft-selections';
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
  return projectDraftSelections(normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: { leagueKey: 'fixture', provider: 'sleeper', externalLeagueId: league, season: 2026 },
    family: 'drafts', week: null, payload: observation.payload as AdministrationEnvelope['payload'],
    completeness: observation.completeness ?? 'complete', provenance: { origin: 'network', requestStartedAt: observation.requestStartedAt,
      requestCompletedAt: observation.requestCompletedAt, sourceObservedAt: observation.sourceObservedAt ?? null, checkedAt: new Date().toISOString() } }));
}
beforeEach(() => {
  responses = { [`/league/${league}/drafts`]: [draft], '/draft/draft1/picks': [{ pick_no: 2, player_id: '007' }, { pick_no: 1, roster_id: 1 }] };
  vi.stubGlobal('fetch', vi.fn(async url => {
    const path = new URL(String(url)).pathname.replace(/^\/v1/u, '');
    if (!Object.hasOwn(responses, path)) throw new Error('Unexpected endpoint.');
    return Response.json(responses[path]);
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const capture = (maxRequests = 9, signal?: AbortSignal) => getOfficialDraftAdministration(league, 2026, { selectionsOnly: true, maxRequests, signal });


describe('bounded selections-only draft collection', () => {
  it('requests only the catalog and native picks with separate endpoint clocks and unchanged source order', async () => {
    const result = await capture();
    expect(paths()).toEqual(['/league/'+league+'/drafts','/draft/draft1/picks']);
    expect(result.providerRequests).toBe(2); expect(result.observations).toHaveLength(2);
    expect(result.observations[0].requestCompletedAt <= result.observations[1].requestStartedAt).toBe(true);
    expect(projected(result.observations[0])).toMatchObject({ value: { complete: true, attemptedSelectionCount: 1, succeededSelectionCount: 1 } });
    expect(projected(result.observations[1])).toMatchObject({ value: { complete: true, entries: [{ sourceOrdinal: 0, pickNumber: { value: 2 } }, { sourceOrdinal: 1, pickNumber: { value: 1 } }] } });
    for (const [,options] of vi.mocked(fetch).mock.calls) expect(options).toMatchObject({ cache:'no-store', redirect:'error', signal:expect.any(AbortSignal) });
  });
  it('preserves capped catalogs and budget exhaustion before picks fanout', async () => {
    responses['/league/'+league+'/drafts'] = Array.from({ length:9 }, (_,i) => ({ ...draft, draft_id:'d'+i }));
    expect(await capture(120)).toMatchObject({ providerRequests:1, reason:'draft-inventory-limit' });
    expect(paths()).toEqual(['/league/'+league+'/drafts']);
    responses['/league/'+league+'/drafts'] = [draft]; vi.mocked(fetch).mockClear();
    expect(await capture(1)).toMatchObject({ providerRequests:1, reason:'metadata-request-budget-exceeded' });
    expect(paths()).toEqual(['/league/'+league+'/drafts']);
  });
  it('retains partial null and successful siblings without requesting traded picks', async () => {
    responses['/league/'+league+'/drafts'] = [draft,{ ...draft,draft_id:'draft2' }];
    responses['/draft/draft1/picks']=null; responses['/draft/draft2/picks']=[];
    const result=await capture();
    expect(result).toMatchObject({ providerRequests:3,reason:'metadata-source-partial' });
    expect(projected(result.observations[1])).toMatchObject({ value:{ complete:false,picksState:'null' } });
    expect(projected(result.observations[2])).toMatchObject({ value:{ complete:true,picksState:'empty' } });
    expect(paths().some(path=>path.includes('traded'))).toBe(false);
  });
  it('cancels reservation waits under the original signal and refuses conflicting options or other seasons before access', async () => {
    const control=new AbortController();
    await expect(getOfficialDraftAdministration(league,2026,{ selectionsOnly:true,maxRequests:9,signal:control.signal,
      beforeDetail:async()=>{ control.abort(Error('expired-original')); await new Promise(()=>{}); } })).rejects.toThrow('expired-original');
    expect(paths()).toEqual(['/league/'+league+'/drafts']); vi.mocked(fetch).mockClear();
    await expect(getOfficialDraftAdministration(league,2026,{ selectionsOnly:true,metadataOnly:true,maxRequests:9 })).rejects.toThrow();
    await expect(getOfficialDraftAdministration(league,2025,{ selectionsOnly:true,maxRequests:9 })).rejects.toThrow();
    await expect(getOfficialAdministrationMetadata(league,2026,{ selectionsOnly:true,maxRequests:9 })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains omitted-option legacy four-body behavior', async () => {
    responses['/draft/draft1']=draft; responses['/draft/draft1/traded_picks']=[];
    const result=await getOfficialDraftAdministration(league,2026,{ maxRequests:4 });
    expect(result.providerRequests).toBe(4); expect(result.observations).toHaveLength(1);
    expect(paths()).toEqual(['/league/'+league+'/drafts','/draft/draft1','/draft/draft1/picks','/draft/draft1/traded_picks']);
  });
});
