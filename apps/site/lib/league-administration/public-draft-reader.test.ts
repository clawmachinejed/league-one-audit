import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../database';
import type { PublicCaptureWitness, PublicIntakeWork } from './contracts';
import type { LeagueAdministrationStore } from './store-contracts';
import { readPublicDraftPicks } from './public-draft-reader';
vi.mock('server-only', () => ({}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const id = randomUUID(), league = '90071992547409982', time = '2026-10-14T12:00:00.000Z';
const mapping = { connectionId: randomUUID(), leagueSeasonId: randomUUID(), revisionId: randomUUID(), generation: 1,
  scope: { leagueKey: 'cp19-read', provider: 'sleeper' as const, externalLeagueId: league, season: 2026 } };
type Work = Extract<PublicIntakeWork, { kind: 'drafts' }>;
function fixture(count = 2) {
  const catalogReceipt = randomUUID(), rows: Record<string, unknown>[] = [], receipts = new Map<string, unknown>();
  for (const [index, resource] of ['catalog', 'league-trades', ...Array.from({ length: count }, () => ['detail', 'selections', 'draft-trades']).flat()].entries()) {
    const draft = index < 2 ? null : 'draft-' + Math.floor((index - 2) / 3), receipt = index ? randomUUID() : catalogReceipt;
    const workerId = randomUUID();
    const base = { requestId: id, revision: index, kind: 'drafts' as const, season: 2026 as const, externalLeagueId: league };
    const work = (draft ? { ...base, resource, externalDraftId: draft, catalogReceiptId: catalogReceipt } : { ...base, resource }) as Work;
    const role = resource === 'catalog' || resource === 'detail' ? 'draftMetadata' : resource === 'selections' ? 'draftSelections' : 'tradedPicks';
    const acquisition: PublicCaptureWitness = { version: 'public-network-capture-v1', work, mapping, dispatchNonce: randomUUID(),
      fence: { jobKey: 'league-administration-public-intake', workerId, generation: index + 1, deadlineAt: time },
      attempts: { [role]: { id: randomUUID(), nonce: randomUUID() } } };
    const value = { kind: resource === 'league-trades' ? 'league' : resource === 'draft-trades' ? 'draft' : resource,
      complete: true, ...(resource === 'catalog' ? { totalCount: count } : {}), entries: [] };
    receipts.set(receipt, { status: 'available', selection: 'receipt', receiptId: receipt, sourceMappingRevisionId: mapping.revisionId,
      value, provenance: { acquisition, sourceObservedAt: time } });
    rows.push({ ordinal: index + 1, season: 2026, external_league_id: league, resource, external_draft_id: draft,
      catalog_receipt_id: draft ? catalogReceipt : null, status: 'complete', failure_count: 0, reason: null,
      worker_id: workerId, generation: index + 1, league_season_id: mapping.leagueSeasonId, source_mapping: mapping,
      draft_receipt_id: receipt, recorded_at: time,
      catalog_count: resource === 'catalog' ? count : null,
      catalog_entries: resource === 'catalog' ? Array.from({ length: count }, (_, i) => [i, 'valid', 'draft-' + i]) : null,
      observed_receipt_id: receipt, observed_source_mapping: mapping, observed_worker_id: workerId,
      observed_generation: index + 1, observed_recorded_at: time, catalog_evidence: resource === 'catalog'
        ? { complete: true, totalCount: count, validIdentityCount: count, invalidIdentityCount: 0, reason: null } : null });
  }
  const query = vi.fn(async () => rows);
  const client = { enabled: true, query } as unknown as DatabaseClient;
  const read = vi.fn(async (_mapping: unknown, selection: { receiptId?: string }) => selection.receiptId
    ? receipts.get(selection.receiptId) : { status: 'available', selection: 'current', value: { complete: true, totalCount: 1 } });
  const administration = { readSourceMapping: vi.fn(async () => mapping), readDraftMetadata: read, readDraftSelections: read, readTradedPicks: read } as unknown as LeagueAdministrationStore;
  const candidates = [{ season: 2026, external_league_id: league, stage: 'complete' }], lists = [{ season: 2026 }];
  return { rows, receipts, query, client, administration, read, candidates, lists,
    run: (page = {}) => readPublicDraftPicks(client, administration, id, candidates, lists, page, true) };
}
describe('receipt-bound ordinary draft status composition', () => {
  it.each([0, 2, 8])('verifies the entire %s-draft matrix and at most20 rich resources per page without HTTP', async count => {
    const f = fixture(count), fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const result = await f.run();
    expect(result.inventory.summary.materializedResources).toBe(2 + count * 3);
    expect(result.inventory.collection).toBe('complete'); expect(result.drafts).toHaveLength(Math.min(20, 2 + count * 3));
    expect(result.drafts.every(row => row.resource.status === 'available' && row.acquisition !== null)).toBe(true);
    expect(result.inventory.readCoverage).toBe(count === 8 ? 'page' : 'complete');
    if (count === 8) {
      expect(result.inventory.page.nextAfterOrdinal).toBe(20);
      const next = await f.run({ afterOrdinal: 20 }); expect(next.drafts).toHaveLength(6); expect(next.inventory.page.nextAfterOrdinal).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains9 observed draft identities while preserving the prior accepted catalog and pending status', async () => {
    const f = fixture(0), catalog = f.rows[0]; catalog.status = 'pending'; catalog.failure_count = 1;
    catalog.catalog_count = null; catalog.catalog_entries = null; catalog.draft_receipt_id = null;
    catalog.catalog_evidence = { complete: false, totalCount: 9, validIdentityCount: 9, invalidIdentityCount: 0, reason: 'draft-inventory-limit' };
    const receipt = String(catalog.observed_receipt_id), previous = f.receipts.get(receipt) as Record<string, unknown>;
    f.receipts.set(receipt, { ...previous, status: 'observed', value: { kind: 'catalog', complete: false, totalCount: 9 } });
    const result = await f.run(); expect(result.inventory.collection).toBe('pending');
    expect(result.inventory.tasks[0].catalogEvidence).toMatchObject({ totalCount: 9, complete: false });
    expect(result.drafts[0].observedCapture).toMatchObject({ status: 'observed', value: { totalCount: 9 } });
    expect(result.drafts[0].currentAccepted.resource).toMatchObject({ value: { totalCount: 1 } });
    expect(result.drafts[0].resource.status).toBe('unavailable'); expect(result.drafts[0].acquisition).toBeNull();
  });
  it.each(['missing-child', 'wrong-catalog', 'wrong-order', 'duplicate-native'] as const)('rejects corrupt matrix %s', async mode => {
    const f = fixture();
    if (mode === 'missing-child') f.rows.pop();
    else if (mode === 'wrong-catalog') f.rows[2].catalog_receipt_id = randomUUID();
    else if (mode === 'wrong-order') [f.rows[2], f.rows[3]] = [f.rows[3], f.rows[2]];
    else f.rows[0].catalog_entries = [[0, 'valid', 'draft-0'], [1, 'valid', 'draft-0']];
    await expect(f.run()).rejects.toThrow();
  });
  it('withholds a retagged receipt without claiming acquisition', async () => {
    const f = fixture(); const receipt = String(f.rows[2].draft_receipt_id);
    const prior = f.receipts.get(receipt) as { provenance: { acquisition: PublicCaptureWitness } };
    f.receipts.set(receipt, { ...prior, status: 'available', selection: 'receipt', receiptId: receipt,
      sourceMappingRevisionId: mapping.revisionId, value: { complete: true }, provenance: { acquisition: { ...prior.provenance.acquisition,
        work: { ...prior.provenance.acquisition.work, requestId: randomUUID() } } } });
    const result = await f.run(); expect(result.drafts[2].resource.status).toBe('unavailable'); expect(result.drafts[2].acquisition).toBeNull();
  });
});
