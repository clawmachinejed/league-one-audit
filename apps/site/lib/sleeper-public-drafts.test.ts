import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdministrationEnvelope, PublicCaptureWitness, PublicIntakeWork } from './league-administration/contracts';
import { assertOriginalPublicCapture, parsePublicCaptureWitness } from './league-administration/public-capture-witness';
import { normalizeAdministrationObservation } from './league-administration/normalize';
import { projectDraftMetadata } from './aggregator/draft-metadata';
import { projectDraftSelections } from './aggregator/draft-selections';
import { projectTradedPicks } from './aggregator/traded-picks';
import { getOfficialDraftAdministration } from './sleeper';
vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: <T,>(fn: T) => fn }));
vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const league = '90071992547409989', native = { draft_id: 'native_draft-A', league_id: league, season: '2026', sport: 'nfl', settings: { rounds: 0 } };
const mapping = { connectionId: randomUUID(), leagueSeasonId: randomUUID(), revisionId: randomUUID(), generation: 1,
  scope: { leagueKey: 'cp19-unit', provider: 'sleeper' as const, externalLeagueId: league, season: 2026 } };
type Work = Extract<PublicIntakeWork, { kind: 'drafts' }>;
function witness(resource: Work['resource']): PublicCaptureWitness {
  const base = { kind: 'drafts' as const, externalLeagueId: league, season: 2026 as const, requestId: randomUUID(), revision: 4 };
  const work: Work = resource === 'catalog' || resource === 'league-trades' ? { ...base, resource }
    : { ...base, resource, externalDraftId: native.draft_id, catalogReceiptId: randomUUID() };
  const role = resource === 'catalog' || resource === 'detail' ? 'draftMetadata' : resource === 'selections' ? 'draftSelections' : 'tradedPicks';
  return { version: 'public-network-capture-v1', work, mapping, dispatchNonce: randomUUID(),
    fence: { jobKey: 'league-administration-public-intake', workerId: randomUUID(), generation: 1, deadlineAt: new Date(Date.now() + 20_000).toISOString() },
    attempts: { [role]: { id: randomUUID(), nonce: randomUUID() } } };
}
async function capture(resource: Work['resource'], body: unknown) {
  const original = witness(resource), fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(body)); vi.stubGlobal('fetch', fetch);
  const result = await getOfficialDraftAdministration(league, 2026, { maxRequests: 1,
    publicDraft: { witness: original, catalog: resource === 'catalog' || resource === 'league-trades' ? null : native } });
  const document = result.observations[0];
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: mapping.scope, family: 'drafts', week: null, payload: document.payload as AdministrationEnvelope['payload'], completeness: document.completeness ?? 'complete',
    provenance: { origin: 'network', requestStartedAt: document.requestStartedAt, requestCompletedAt: document.requestCompletedAt,
      sourceObservedAt: document.sourceObservedAt, checkedAt: new Date().toISOString(), acquisition: document.acquisition } });
  return { result, document, normalized, original, fetch };
}
describe('ordinary original single-endpoint draft transport', () => {
  it.each([
    { resource: 'catalog' as const, body: [native], path: `/league/${league}/drafts` },
    { resource: 'detail' as const, body: native, path: `/draft/${native.draft_id}` },
    { resource: 'selections' as const, body: [], path: `/draft/${native.draft_id}/picks` },
    { resource: 'league-trades' as const, body: [{ season: '2028', round: 1, roster_id: 1, owner_id: 2 }], path: `/league/${league}/traded_picks` },
    { resource: 'draft-trades' as const, body: [], path: `/draft/${native.draft_id}/traded_picks` },
  ])('captures only $resource using its original witness and native endpoint', async ({ resource, body, path }) => {
    const f = await capture(resource, body);
    expect(f.result.providerRequests).toBe(1); expect(f.fetch).toHaveBeenCalledOnce();
    expect(new URL(String(f.fetch.mock.calls[0][0])).pathname).toBe('/v1' + path);
    expect(f.fetch.mock.calls[0][1]).toMatchObject({ cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) });
    expect(() => assertOriginalPublicCapture(f.document, f.original)).not.toThrow();
    expect(() => assertOriginalPublicCapture({ ...f.document }, f.original)).toThrow();
    expect(f.normalized.diagnostics).toMatchObject([{ code: 'invalid_array', path: 'payload' }]);
    const projection = resource === 'catalog' || resource === 'detail' ? projectDraftMetadata(f.normalized)
      : resource === 'selections' ? projectDraftSelections(f.normalized) : projectTradedPicks(f.normalized);
    expect(projection).toMatchObject({ status: 'accepted', value: { complete: true } });
    if (resource === 'league-trades') expect(projection).toMatchObject({ value: { entries: [{ pickSeason: { value: '2028' } }] } });
  });
  it.each([0, 2, 8, 9])('collects catalog cardinality%s once without detail fanout', async count => {
    const f = await capture('catalog', Array.from({ length: count }, (_, index) => ({ ...native, draft_id: 'native-' + index })));
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(projectDraftMetadata(f.normalized)).toMatchObject({ status: 'accepted', value: { totalCount: count,
      complete: count <= 8, attemptedDetailCount: 0, unrequestedDetailCount: count } });
    if (count > 8) expect(f.result.reason).toBe('draft-inventory-limit');
  });
  it.each([[native, native], [{ ...native, league_id: '2' }], [{ ...native, season: '2027' }]].map(body => ({ body })))('retains malformed catalog evidence without child GETs', async ({ body }) => {
    const f = await capture('catalog', body);
    expect(f.fetch).toHaveBeenCalledOnce(); expect(f.result.reason).toBe('metadata-source-partial');
    expect(projectDraftMetadata(f.normalized)).toMatchObject({ status: 'accepted', value: { complete: false } });
  });
  it('rejects mismatched catalog context, budgets, specialized options and expired original work before HTTP', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const original = witness('detail');
    for (const options of [
      { maxRequests: 1, publicDraft: { witness: original, catalog: { ...native, draft_id: 'foreign' } } },
      { maxRequests: 2, publicDraft: { witness: original, catalog: native } },
      { maxRequests: 1, metadataOnly: true, publicDraft: { witness: original, catalog: native } },
      { maxRequests: 1, publicDraft: { witness: { ...original, fence: { ...original.fence, deadlineAt: new Date(0).toISOString() } }, catalog: native } },
    ]) await expect(getOfficialDraftAdministration(league, 2026, options)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps invalid work, wrong attempt roles and endpoint retagging unqualified', async () => {
    const f = await capture('selections', []), original = f.original;
    expect(() => parsePublicCaptureWitness({ ...original, attempts: { draftMetadata: Object.values(original.attempts)[0] } })).toThrow();
    expect(() => parsePublicCaptureWitness({ ...original, work: { ...original.work, extra: true } })).toThrow();
    expect(projectDraftSelections({ ...f.normalized, envelope: { ...f.normalized.envelope, provenance: { ...f.normalized.envelope.provenance,
      acquisition: { ...original, work: { ...original.work, resource: 'detail' } as Work,
        attempts: { draftMetadata: Object.values(original.attempts)[0] } } } } }).status).toBe('rejected');
  });
});
