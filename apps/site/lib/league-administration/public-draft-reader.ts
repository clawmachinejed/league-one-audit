import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../database';
import type { LeagueAdministrationStore } from './store-contracts';
import type { AdministrationSourceMapping } from './source-mapping';
import { isAdministrationSourceMapping } from './source-mapping';
import { parsePublicCaptureWitness } from './public-capture-witness';
import { PUBLIC_DRAFT_PICKS, type PublicPeriodInventoryPage } from './public-intake-contracts';
import { refreshUuid } from './public-refresh-contracts';
import { validDraftId } from '../aggregator/draft-metadata';
import { compatibleRevision } from '../projections/shared/revision-compatibility';

const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason });
const resources = ['catalog', 'league-trades', 'detail', 'selections', 'draft-trades'];
const timestamp = (value: unknown) => Number.isFinite(new Date(String(value)).getTime());

async function readResource(administration: LeagueAdministrationStore, mapping: AdministrationSourceMapping,
  row: DatabaseRow, receiptId?: string) {
  const receipt = receiptId ? { receiptId } : {};
  if (row.resource === 'catalog' || row.resource === 'detail') return administration.readDraftMetadata?.(mapping,
    row.resource === 'catalog' ? { kind: 'catalog', ...receipt } : { kind: 'detail', externalDraftId: String(row.external_draft_id), ...receipt })
    ?? unavailable('draft-metadata-reader-unsupported');
  if (row.resource === 'selections') return administration.readDraftSelections?.(mapping,
    { kind: 'selections', externalDraftId: String(row.external_draft_id), ...receipt }) ?? unavailable('draft-selections-reader-unsupported');
  return administration.readTradedPicks?.(mapping, row.resource === 'league-trades' ? { kind: 'league', ...receipt }
    : { kind: 'draft', externalDraftId: String(row.external_draft_id), ...receipt }) ?? unavailable('traded-picks-reader-unsupported');
}

/** One immutable catalog per league/cycle. Rich reads are limited to twenty endpoint receipts. */
export async function readPublicDraftPicks(client: DatabaseClient, administration: LeagueAdministrationStore,
  requestId: string, candidates: readonly DatabaseRow[], lists: readonly DatabaseRow[],
  page: PublicPeriodInventoryPage = {}, terminal = false) {
  const afterOrdinal = page.afterOrdinal ?? 0, limit = page.limit ?? 20;
  if (!Number.isInteger(afterOrdinal) || afterOrdinal < 0 || afterOrdinal > 520
    || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid draft intake page.');
  if (candidates.length > 1000 || lists.length > 1 || lists.some(list => list.season !== 2026)
    || candidates.some(candidate => candidate.season !== 2026 || typeof candidate.external_league_id !== 'string'
      || !/^[1-9][0-9]{0,31}$/u.test(candidate.external_league_id))
    || new Set(candidates.map(candidate => candidate.external_league_id)).size !== candidates.length) throw new Error('Invalid draft discovery.');
  const rows = await client.query(`/* public-data-intake:read-drafts */
    SELECT task.ordinal,task.season,task.external_league_id,task.resource,task.external_draft_id,task.catalog_receipt_id,
      task.status,task.failure_count,task.reason,checkpoint.worker_id,checkpoint.generation,checkpoint.league_season_id,
      checkpoint.source_mapping,checkpoint.draft_receipt_id,checkpoint.recorded_at,
      observed.receipt_id AS observed_receipt_id,observed.source_mapping AS observed_source_mapping,
      observed.worker_id AS observed_worker_id,observed.generation AS observed_generation,
      observed.recorded_at AS observed_recorded_at,observed.catalog_evidence,
      CASE WHEN task.resource='catalog' AND task.status='complete' THEN
        (SELECT jsonb_agg(jsonb_build_array(entry.source_ordinal,entry.identity_state,entry.external_draft_id)
          ORDER BY entry.source_ordinal) FROM public.league_roster_capture_receipts receipt
          JOIN public.league_draft_metadata_entries entry ON entry.content_id=receipt.content_id
          WHERE receipt.id=checkpoint.draft_receipt_id) END AS catalog_entries,
      CASE WHEN task.resource='catalog' AND task.status='complete' THEN
        (SELECT header.total_count FROM public.league_roster_capture_receipts receipt
          JOIN public.league_draft_metadata_contents header ON header.content_id=receipt.content_id
          WHERE receipt.id=checkpoint.draft_receipt_id AND header.kind='catalog' AND header.complete) END AS catalog_count
    FROM public.public_data_draft_tasks task LEFT JOIN public.public_data_draft_checkpoints checkpoint
      ON checkpoint.intake_id=task.intake_id AND checkpoint.task_ordinal=task.ordinal
    LEFT JOIN LATERAL (
      SELECT receipt.id AS receipt_id,attempt.source_mapping,dispatch.worker_id,dispatch.generation,receipt.recorded_at,
        CASE WHEN task.resource='catalog' AND header.content_id IS NOT NULL THEN jsonb_build_object(
          'complete',header.complete,'totalCount',header.total_count,'validIdentityCount',header.valid_identity_count,
          'invalidIdentityCount',header.invalid_identity_count,'reason',header.reason) END AS catalog_evidence
      FROM public.public_data_dispatches dispatch
      JOIN public.league_roster_resource_attempts attempt ON attempt.write_fence->>'workerId'=dispatch.worker_id
        AND attempt.write_fence->>'generation'=dispatch.generation::text
      JOIN public.league_roster_capture_receipts receipt ON receipt.attempt_id=attempt.id
      LEFT JOIN public.league_draft_metadata_contents header ON header.content_id=receipt.content_id AND header.kind='catalog'
      WHERE dispatch.intake_id=task.intake_id AND dispatch.resource='drafts' AND dispatch.max_requests=1
        AND dispatch.work->>'externalLeagueId'=task.external_league_id AND dispatch.work->>'resource'=task.resource
        AND dispatch.work->>'season'=task.season::text
        AND dispatch.work->>'externalDraftId' IS NOT DISTINCT FROM task.external_draft_id
        AND dispatch.work->>'catalogReceiptId' IS NOT DISTINCT FROM task.catalog_receipt_id::text
        AND receipt.provenance->'acquisition'->'work'=dispatch.work
        AND receipt.provenance->'acquisition'->>'dispatchNonce'=dispatch.capture_nonce::text
        AND receipt.provenance->'acquisition'->'fence'=attempt.write_fence
        AND receipt.provenance->'acquisition'->'mapping'=attempt.source_mapping
        AND receipt.provenance->'acquisition'->'attempts'=jsonb_build_object(
          CASE task.resource WHEN 'catalog' THEN 'draftMetadata' WHEN 'detail' THEN 'draftMetadata'
            WHEN 'selections' THEN 'draftSelections' ELSE 'tradedPicks' END,
          jsonb_build_object('id',attempt.id,'nonce',attempt.capture_nonce))
        AND dispatch.admitted_at<=attempt.reserved_at AND attempt.reserved_at<=receipt.recorded_at
      ORDER BY dispatch.revision DESC,receipt.id DESC LIMIT 1
    ) observed ON true
    WHERE task.intake_id=$1::uuid ORDER BY task.ordinal LIMIT 521`, [requestId]);
  const discovered = lists.length === 1;
  const admitted = candidates.filter(candidate => candidate.stage !== 'capacity'
    || rows.some(row => row.external_league_id === candidate.external_league_id))
    .sort((left, right) => String(left.external_league_id) < String(right.external_league_id) ? -1 : 1);
  if (rows.length > 520 || admitted.length > 20 || !discovered && (rows.length || candidates.length)) throw new Error('Invalid draft task capacity.');
  const expected: { ordinal: number; league: string; resource: string; draft: string | null; catalog: string | null }[] = [];
  for (const [index, candidate] of admitted.entries()) {
    const ordinal = index * 26 + 1, league = String(candidate.external_league_id);
    const catalog = rows.find(row => row.ordinal === ordinal && row.resource === 'catalog' && row.external_league_id === league);
    if (!catalog) throw new Error('Missing draft catalog task.');
    expected.push({ ordinal, league, resource: 'catalog', draft: null, catalog: null },
      { ordinal: ordinal + 1, league, resource: 'league-trades', draft: null, catalog: null });
    if (catalog.status === 'complete') {
      const entries = catalog.catalog_entries ?? [];
      if (!Number.isInteger(catalog.catalog_count) || Number(catalog.catalog_count) < 0 || Number(catalog.catalog_count) > 8
        || !Array.isArray(entries) || entries.length !== catalog.catalog_count
        || new Set(entries.map(entry => Array.isArray(entry) ? entry[2] : null)).size !== entries.length) throw new Error('Invalid immutable draft catalog matrix.');
      entries.forEach((entry: unknown, draftIndex: number) => {
        if (!Array.isArray(entry) || entry.length !== 3 || entry[0] !== draftIndex || entry[1] !== 'valid'
          || !validDraftId(entry[2]) || !refreshUuid(catalog.draft_receipt_id)) throw new Error('Invalid immutable draft catalog entry.');
        for (const [offset, resource] of ['detail', 'selections', 'draft-trades'].entries()) expected.push({
          ordinal: ordinal + 2 + draftIndex * 3 + offset, league, resource, draft: entry[2], catalog: catalog.draft_receipt_id });
      });
    }
  }
  if (rows.length !== expected.length) throw new Error('Incomplete draft task matrix.');
  const tasks = rows.map((row, index) => {
    const identity = expected[index];
    if (row.ordinal !== identity.ordinal || row.season !== 2026 || row.external_league_id !== identity.league
      || row.resource !== identity.resource || !resources.includes(String(row.resource))
      || row.external_draft_id !== identity.draft || row.catalog_receipt_id !== identity.catalog
      || !['pending', 'complete', 'unavailable'].includes(String(row.status))
      || !Number.isInteger(row.failure_count) || Number(row.failure_count) < 0 || Number(row.failure_count) > 5
      || row.status === 'pending' && Number(row.failure_count) >= 5 || (row.status === 'unavailable') !== (row.reason !== null)
      || row.status === 'complete' && (!refreshUuid(row.draft_receipt_id) || !refreshUuid(row.worker_id)
        || !Number.isSafeInteger(row.generation) || Number(row.generation) < 1 || !refreshUuid(row.league_season_id)
        || !isAdministrationSourceMapping(row.source_mapping) || row.source_mapping.leagueSeasonId !== row.league_season_id
        || row.source_mapping.scope.season !== 2026 || row.source_mapping.scope.externalLeagueId !== row.external_league_id
        || !timestamp(row.recorded_at)) || row.status !== 'complete' && row.draft_receipt_id != null) throw new Error('Invalid stored draft task.');
    const catalogEvidence = row.catalog_evidence as Record<string, unknown> | null | undefined;
    if (catalogEvidence != null && (row.resource !== 'catalog' || !catalogEvidence || typeof catalogEvidence !== 'object'
      || Array.isArray(catalogEvidence) || typeof catalogEvidence.complete !== 'boolean'
      || catalogEvidence.totalCount !== null && (!Number.isSafeInteger(catalogEvidence.totalCount) || Number(catalogEvidence.totalCount) < 0)
      || !Number.isSafeInteger(catalogEvidence.validIdentityCount) || Number(catalogEvidence.validIdentityCount) < 0
      || !Number.isSafeInteger(catalogEvidence.invalidIdentityCount) || Number(catalogEvidence.invalidIdentityCount) < 0
      || Number(catalogEvidence.totalCount ?? 0) !== Number(catalogEvidence.validIdentityCount) + Number(catalogEvidence.invalidIdentityCount)
      || !refreshUuid(row.observed_receipt_id) || !timestamp(row.observed_recorded_at))) throw new Error('Invalid observed draft catalog.');
    return { provider: 'sleeper' as const, season: 2026 as const, ordinal: Number(row.ordinal), externalLeagueId: String(row.external_league_id),
      resource: String(row.resource), externalDraftId: row.external_draft_id, catalogReceiptId: row.catalog_receipt_id,
      collection: String(row.status), failureCount: Number(row.failure_count), reason: row.reason, draftReceiptId: row.draft_receipt_id ?? null,
      ...(catalogEvidence ? { catalogEvidence: { ...catalogEvidence, receiptId: row.observed_receipt_id, recordedAt: row.observed_recorded_at } } : {}) };
  });
  const selectedRows = rows.filter(row => Number(row.ordinal) > afterOrdinal).slice(0, limit);
  const drafts = [];
  for (const row of selectedRows) {
    const task = tasks.find(task => task.ordinal === row.ordinal)!;
    let resource: Awaited<ReturnType<typeof readResource>> = unavailable('draft-capture-not-complete');
    let current: Awaited<ReturnType<typeof readResource>> = unavailable('current-draft-source-unavailable');
    let observed: Awaited<ReturnType<typeof readResource>> | null = null;
    let acquisition: null | { sourceMapping: unknown; workerId: unknown; generation: unknown; receiptId: string; recordedAt: unknown } = null;
    try {
      const mapping = await administration.readSourceMapping(task.externalLeagueId);
      if (!mapping || mapping.scope.season !== 2026 || mapping.scope.externalLeagueId !== task.externalLeagueId) throw new Error('Draft mapping unavailable.');
      current = await readResource(administration, mapping, row);
      if (row.observed_receipt_id != null) {
        if (!refreshUuid(row.observed_receipt_id) || compatibleRevision(mapping) !== compatibleRevision(row.observed_source_mapping)) throw new Error('Observed draft mapping changed.');
        observed = await readResource(administration, mapping, row, row.observed_receipt_id);
        if (observed.status !== 'available' && observed.status !== 'observed') throw new Error('Observed draft receipt unavailable.');
        const witness = parsePublicCaptureWitness(observed.provenance.acquisition), work = witness.work;
        if (observed.selection !== 'receipt' || observed.receiptId !== row.observed_receipt_id
          || work.kind !== 'drafts' || work.requestId !== requestId || work.externalLeagueId !== task.externalLeagueId
          || work.resource !== task.resource || witness.fence.workerId !== row.observed_worker_id
          || witness.fence.generation !== row.observed_generation || compatibleRevision(witness.mapping) !== compatibleRevision(mapping)
          || ('externalDraftId' in work && (work.externalDraftId !== task.externalDraftId || work.catalogReceiptId !== task.catalogReceiptId))) throw new Error('Observed draft acquisition mismatch.');
      }
      if (row.status === 'complete') {
        if (compatibleRevision(mapping) !== compatibleRevision(row.source_mapping)) throw new Error('Draft mapping changed.');
        resource = await readResource(administration, mapping, row, String(row.draft_receipt_id));
        if (resource.status !== 'available' || resource.selection !== 'receipt' || resource.receiptId !== row.draft_receipt_id
          || resource.sourceMappingRevisionId !== mapping.revisionId || !resource.value?.complete) throw new Error('Draft receipt unavailable.');
        const witness = parsePublicCaptureWitness(resource.provenance.acquisition), work = witness.work;
        if (work.kind !== 'drafts' || work.requestId !== requestId || work.externalLeagueId !== task.externalLeagueId
          || work.resource !== task.resource || work.season !== 2026 || witness.fence.workerId !== row.worker_id
          || witness.fence.generation !== row.generation || compatibleRevision(witness.mapping) !== compatibleRevision(mapping)
          || ('externalDraftId' in work ? work.externalDraftId !== task.externalDraftId || work.catalogReceiptId !== task.catalogReceiptId
            : task.externalDraftId !== null || task.catalogReceiptId !== null)) throw new Error('Draft acquisition mismatch.');
        acquisition = { sourceMapping: row.source_mapping, workerId: row.worker_id, generation: row.generation,
          receiptId: String(row.draft_receipt_id), recordedAt: row.recorded_at };
      }
      if (compatibleRevision(await administration.readSourceMapping(task.externalLeagueId)) !== compatibleRevision(mapping)) throw new Error('Draft mapping changed.');
    } catch { resource = unavailable('stored-draft-source-unavailable'); current = unavailable('current-draft-source-unavailable'); observed = null; acquisition = null; }
    drafts.push({ ...task, resource, acquisition, observedCapture: observed,
      currentAccepted: { captureBinding: 'latest-for-current-source-mapping' as const, resource: current } });
  }
  const capacityLeagues = candidates.length - admitted.length;
  const pendingResources = tasks.filter(task => task.collection === 'pending').length;
  const unavailableResources = tasks.filter(task => task.collection === 'unavailable').length;
  const acquiredResources = tasks.filter(task => task.collection === 'complete').length;
  const undiscoveredDraftLeagues = tasks.filter(task => task.resource === 'catalog' && task.collection !== 'complete').length;
  const lastOrdinal = Number(selectedRows.at(-1)?.ordinal ?? afterOrdinal);
  const collection = !discovered ? terminal ? 'unavailable' as const : 'pending' as const : pendingResources ? 'pending' as const
    : capacityLeagues || unavailableResources || undiscoveredDraftLeagues ? 'partial' as const : 'complete' as const;
  return { drafts, inventory: { policy: PUBLIC_DRAFT_PICKS, collection,
    readCoverage: selectedRows.length === rows.length ? 'complete' as const : 'page' as const,
    summary: { observedLeagues: candidates.length, admittedLeagues: admitted.length, capacityLeagues,
      materializedResources: tasks.length, pendingResources, acquiredResources, unavailableResources, undiscoveredDraftLeagues }, tasks,
    page: { afterOrdinal, limit, nextAfterOrdinal: rows.some(row => Number(row.ordinal) > lastOrdinal) ? lastOrdinal : null },
    meaning: 'Each accepted catalog is immutable discovery for this cycle. Partial observed catalog counts remain explicit without completing discovery or materializing children. Transport failure may leave unknown coverage. Current accepted data never completes this request; future pick years remain references.' } };
}
