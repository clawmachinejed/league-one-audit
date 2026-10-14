import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../database';
import { projectDraftMetadata } from '../aggregator/draft-metadata';
import { projectDraftSelections } from '../aggregator/draft-selections';
import { projectTradedPicks } from '../aggregator/traded-picks';
import type { PublicCaptureWitness, PublicIntakeWork } from './contracts';
import { createLeagueAdministrationStore } from './store';
import type { LeagueAdministrationStore } from './store-contracts';
import { createPublicDataRefreshStore, createPublicIntakeStore } from './neon/public-intake';
import { PUBLIC_DRAFT_PICKS, validatePublicIntake, type PublicIntakeStore } from './public-intake-contracts';
import { validatePublicDataRefresh } from './public-refresh-contracts';
import { runPublicIntakeStep, type PublicIntakeDependencies } from './public-intake';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const id = randomUUID(), league = '90071992547409981', catalogReceipt = randomUUID();
const native = { draft_id: 'draft-A', league_id: league, season: '2026', sport: 'nfl' };
const mapping = { connectionId: randomUUID(), leagueSeasonId: randomUUID(), revisionId: randomUUID(), generation: 1,
  scope: { leagueKey: 'cp19-unit', provider: 'sleeper' as const, externalLeagueId: league, season: 2026 } };
const input = { id, username: 'cp19_manager', seasons: [2026] };
type Work = Extract<PublicIntakeWork, { kind: 'drafts' }>;
function fixture(resource: Work['resource'] = 'catalog') {
  const base = { kind: 'drafts' as const, requestId: id, revision: 3, externalLeagueId: league, season: 2026 as const };
  const work: Work = resource === 'catalog' || resource === 'league-trades' ? { ...base, resource }
    : { ...base, resource, externalDraftId: native.draft_id, catalogReceiptId: catalogReceipt };
  const events: string[] = []; let reserved = '';
  const fetch = vi.fn<typeof globalThis.fetch>(async () => { events.push('get'); return Response.json(resource === 'catalog' ? [native] : resource === 'detail' ? native : []); });
  vi.stubGlobal('fetch', fetch);
  const observationId = randomUUID(), receiptId = randomUUID();
  const intake: PublicIntakeStore = { submit: vi.fn(), recover: vi.fn(), next: vi.fn(async () => work), admit: vi.fn(async () => true),
    recordIdentity: vi.fn(), recordLeagues: vi.fn(), register: vi.fn(), completeCore: vi.fn(), completeExactPeriod: vi.fn(),
    completeDraft: vi.fn(async () => undefined), fail: vi.fn(async () => undefined), draftCatalog: vi.fn(async () => ({ receiptId: catalogReceipt, sourceMapping: mapping,
      payload: { metadataVersion: 'sleeper-draft-metadata-v1', kind: 'catalog', catalog: [native] } })),
    captureWitness: vi.fn(async (selected, selectedMapping, fence): Promise<PublicCaptureWitness> => {
      events.push('witness'); return { version: 'public-network-capture-v1', work: selected, mapping: selectedMapping, fence,
        dispatchNonce: randomUUID(), attempts: { [resource === 'catalog' || resource === 'detail' ? 'draftMetadata' : resource === 'selections' ? 'draftSelections' : 'tradedPicks']:
          { id: reserved, nonce: randomUUID() } } };
    }) };
  const reserve = async (_mapping: unknown, _resource: unknown, attemptId: string) => {
    events.push('reserve'); reserved = attemptId; return { id: attemptId, scopeId: randomUUID(), ordinal: 1, expectedGeneration: 0 };
  };
  const administration = { ...createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }), enabled: true,
    readSourceMapping: vi.fn(async () => mapping), beginDraftMetadataAttempt: vi.fn(reserve), beginDraftSelectionsAttempt: vi.fn(reserve), beginTradedPicksAttempt: vi.fn(reserve),
    recordObservation: vi.fn<LeagueAdministrationStore['recordObservation']>(async normalized => {
      events.push('write'); const projection = resource === 'catalog' || resource === 'detail' ? projectDraftMetadata(normalized)
        : resource === 'selections' ? projectDraftSelections(normalized) : projectTradedPicks(normalized);
      return { status: 'rejected', observationId, [resource === 'catalog' || resource === 'detail' ? 'draftMetadataAcceptance'
        : resource === 'selections' ? 'draftSelectionsAcceptance' : 'tradedPicksAcceptance']:
        { status: projection.status === 'accepted' && projection.value.complete ? 'accepted' : 'preserved', receiptId, acceptedGeneration: 1 } };
    }) } satisfies LeagueAdministrationStore;
  const jobs = { acquireJob: vi.fn<PublicIntakeDependencies['jobs']['acquireJob']>(async () => ({ kind: 'acquired' as const, attempt: 1, leaseUntil: new Date(Date.now() + 25_000).toISOString() })),
    completeJob: vi.fn(async () => true), failJob: vi.fn(async () => true) };
  const dependencies: PublicIntakeDependencies = { intake, administration, jobs };
  return { work, events, fetch, intake, administration, jobs, dependencies, receiptId, observationId,
    run: () => runPublicIntakeStep(id, dependencies, new AbortController().signal) };
}
describe('ordinary draft selectors and receipts', () => {
  it('preserves omitted replay identity and validates2026 selectors on intake and refresh', () => {
    expect(validatePublicIntake(input)).toEqual(input);
    expect(validatePublicIntake({ ...input, draftPicks: PUBLIC_DRAFT_PICKS }).draftPicks).toBe(PUBLIC_DRAFT_PICKS);
    const refresh = { id, expectedRevision: 0, identityRequestId: randomUUID(), seasons: [2026], cadenceSeconds: 60,
      expiresAt: new Date(Date.now() + 60_000).toISOString(), paused: false, draftPicks: PUBLIC_DRAFT_PICKS };
    expect(validatePublicDataRefresh(refresh).draftPicks).toBe(PUBLIC_DRAFT_PICKS);
    for (const seasons of [[2025], [2027], [2026, 2027]]) {
      expect(() => validatePublicIntake({ ...input, seasons, draftPicks: PUBLIC_DRAFT_PICKS })).toThrow();
      expect(() => validatePublicDataRefresh({ ...refresh, seasons })).toThrow();
    }
    for (const draftPicks of [null, {}, true, 'other']) expect(() => validatePublicIntake({ ...input, draftPicks } as never)).toThrow();
  });
  it('refuses explicit selection before mutation on a database lacking056', async () => {
    const query = vi.fn(async () => [{ supported: false }]), client = { enabled: true, query } as unknown as DatabaseClient;
    await expect(createPublicIntakeStore(client).submit({ ...input, draftPicks: PUBLIC_DRAFT_PICKS })).rejects.toThrow('R056');
    expect(query).toHaveBeenCalledOnce(); query.mockClear();
    await expect(createPublicDataRefreshStore(client).configure({ id, expectedRevision: 0, identityRequestId: randomUUID(),
      seasons: [2026], cadenceSeconds: 60, expiresAt: new Date(Date.now() + 60_000).toISOString(), paused: false, draftPicks: PUBLIC_DRAFT_PICKS })).rejects.toThrow('R056');
    expect(query).toHaveBeenCalledOnce();
  });
  it.each(['catalog', 'detail', 'selections', 'league-trades', 'draft-trades'] as const)('runs %s once with exact reservation/witness/receipt', async resource => {
    const f = fixture(resource); expect(await f.run()).toEqual({ status: 'progress', resource: 'drafts', providerRequests: 1 });
    expect(f.events).toEqual(['reserve', 'witness', 'get', 'write']); expect(f.fetch).toHaveBeenCalledOnce();
    const call = f.administration.recordObservation.mock.calls[0];
    expect(call[2]).toEqual(mapping); expect(call[0].envelope.provenance.acquisition?.work).toEqual(f.work);
    const accepted = resource === 'catalog' || resource === 'detail' ? call[13] : resource === 'selections' ? call[14] : call[15];
    expect(accepted?.attempt.id).toBe(Object.values(call[0].envelope.provenance.acquisition!.attempts)[0].id);
    expect(f.intake.completeDraft).toHaveBeenCalledExactlyOnceWith(f.work, mapping,
      { observations: { drafts: f.observationId }, receipts: { drafts: f.receiptId } }, call[1]);
    expect(f.jobs.acquireJob.mock.calls[0][0]).toMatchObject({ minimumIntervalSeconds: 60, leaseSeconds: 25 });
  });
  it('does not refetch inventory for a failed child and keeps its checkpoint incomplete', async () => {
    const f = fixture('selections'); f.fetch.mockRejectedValue(new Error('provider unavailable'));
    expect(await f.run()).toMatchObject({ status: 'unavailable', providerRequests: 1 });
    expect(f.fetch).toHaveBeenCalledOnce(); expect(String(f.fetch.mock.calls[0][0])).toContain('/draft/draft-A/picks');
    expect(f.intake.completeDraft).not.toHaveBeenCalled(); expect(f.intake.fail).toHaveBeenCalledOnce();
  });
  it('keeps bounded partial catalog evidence without completing the task', async () => {
    const f = fixture(); f.fetch.mockResolvedValue(Response.json(Array.from({ length: 9 }, (_, i) => ({ ...native, draft_id: 'id-' + i }))));
    expect(await f.run()).toMatchObject({ status: 'unavailable', providerRequests: 1 });
    expect(projectDraftMetadata(f.administration.recordObservation.mock.calls[0][0])).toMatchObject({ value: { totalCount: 9, complete: false } });
    expect(f.intake.completeDraft).not.toHaveBeenCalled();
  });
  it('fails closed before provider work on a changed catalog receipt or mapping', async () => {
    const f = fixture('detail'); vi.mocked(f.intake.draftCatalog!).mockResolvedValue({ receiptId: randomUUID(), sourceMapping: mapping, payload: {} });
    expect(await f.run()).toMatchObject({ status: 'unavailable', providerRequests: 0 }); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('skips all provider work when existing admission backs off', async () => {
    const f = fixture(); vi.mocked(f.intake.admit).mockResolvedValue(false);
    expect(await f.run()).toEqual({ status: 'backoff', providerRequests: 0 }); expect(f.fetch).not.toHaveBeenCalled();
  });
});
