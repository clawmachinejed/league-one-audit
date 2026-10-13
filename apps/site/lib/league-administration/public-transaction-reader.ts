import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../database';
import { projectTransactionCapture } from '../aggregator/transaction-activity';
import type { LeagueAdministrationStore } from './store-contracts';
import { PUBLIC_TRANSACTION_HISTORY, publicTransactionHistoryPeriods, type PublicPeriodInventoryPage, type PublicTransactionPeriod } from './public-intake-contracts';
import { isAdministrationSourceMapping } from './source-mapping';
import { parsePublicCaptureWitness } from './public-capture-witness';
import { isTransactionCaptureId } from './transaction-capture-contracts';
import { compatibleRevision } from '../projections/shared/revision-compatibility';

const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason });

/** One selected native period. Read its immutable receipt, including fresh equal-content clocks. */
export async function readPublicTransactions(client: DatabaseClient, administration: LeagueAdministrationStore,
  requestId: string, candidates: readonly DatabaseRow[], selection: PublicTransactionPeriod,
  historyRows?: readonly DatabaseRow[]) {
  const rows = historyRows ?? await readTransactionTaskRows(client, requestId, false);
  const history = historyRows !== undefined;
  if (rows.length > 20) throw new Error('Invalid stored transaction task count.');
  const ordinals = new Set<number>(), identities = new Set<string>();
  const transactions = [];
  for (const row of rows) {
    const ordinal = Number(row.ordinal), season = Number(row.season), externalLeagueId = String(row.external_league_id);
    const nativeWeek = Number(row.native_week), identity = externalLeagueId + ':' + nativeWeek;
    if (season !== 2026 || !/^[1-9][0-9]{0,31}$/u.test(externalLeagueId)
      || !Number.isInteger(ordinal) || ordinal < 1 || ordinal > (history ? 380 : 20) || ordinals.has(ordinal) || identities.has(identity)
      || selection.season !== season || !Number.isInteger(nativeWeek) || nativeWeek < 0 || nativeWeek > 18
      || !history && selection.nativeWeek !== nativeWeek
      || !candidates.some(candidate => candidate.season === season && candidate.external_league_id === externalLeagueId
        && (candidate.stage !== 'capacity' || row.status === 'unavailable' && row.reason === 'bootstrap-capacity'))
      || !['pending', 'complete', 'unavailable'].includes(String(row.status))
      || !Number.isInteger(row.failure_count) || Number(row.failure_count) < 0 || Number(row.failure_count) > 5) {
      throw new Error('Invalid stored transaction task.');
    }
    ordinals.add(ordinal); identities.add(identity);
    const currentAccepted = history ? await readCurrentTransactions(administration, externalLeagueId, season, nativeWeek) : undefined;
    const task = { provider: 'sleeper' as const, externalLeagueId, season, nativeWeek, ordinal,
      collection: String(row.status), failureCount: Number(row.failure_count), reason: row.reason,
      ...(history ? { receiptState: row.status === 'pending' ? 'pending' as const
        : row.status === 'unavailable' ? 'unavailable' as const : 'unverified' as const } : {}),
      ...(currentAccepted ? { currentAccepted } : {}) };
    if (row.status !== 'complete') {
      transactions.push({ ...task, resource: unavailable('transaction-capture-not-complete'), acquisition: null });
      continue;
    }
    try {
      const mapping = await administration.readSourceMapping(externalLeagueId);
      if (!mapping || mapping.scope.season !== season || mapping.scope.externalLeagueId !== externalLeagueId
        || mapping.leagueSeasonId !== row.league_season_id || !isAdministrationSourceMapping(row.source_mapping)
        || compatibleRevision(mapping) !== compatibleRevision(row.source_mapping)
        || !isTransactionCaptureId(row.worker_id) || !Number.isSafeInteger(row.generation) || Number(row.generation) < 1
        || !isTransactionCaptureId(row.transaction_receipt_id) || !Number.isFinite(new Date(String(row.recorded_at)).getTime())) {
        throw new Error('Invalid stored transaction checkpoint.');
      }
      const resource = await administration.readAcceptedTransactions(mapping, nativeWeek, { receiptId: row.transaction_receipt_id });
      if (resource.status !== 'available') {
        transactions.push({ ...task, resource, acquisition: null });
        continue;
      }
      const capture = resource.capture;
      if (capture.captureKind !== 'receipt' || capture.captureId !== row.transaction_receipt_id
        || capture.receipt?.id !== row.transaction_receipt_id || capture.week !== nativeWeek
        || capture.leagueSeasonId !== mapping.leagueSeasonId
        || compatibleRevision(capture.mapping) !== compatibleRevision(mapping)
        || compatibleRevision(capture.envelope.scope) !== compatibleRevision(mapping.scope)
        || resource.accepted.sourceMappingRevisionId !== mapping.revisionId
        || compatibleRevision(resource.accepted.observationIds) !== compatibleRevision([row.transaction_receipt_id])) {
        throw new Error('Transaction receipt mismatch.');
      }
      const witness = parsePublicCaptureWitness(capture.envelope.provenance.acquisition);
      if (witness.work.kind !== 'transactions' || witness.work.requestId !== requestId || witness.work.nativeWeek !== nativeWeek
        || witness.work.externalLeagueId !== externalLeagueId || witness.work.season !== season
        || witness.fence.workerId !== row.worker_id || witness.fence.generation !== row.generation
        || witness.attempts.transactions.id !== capture.receipt.attemptId
        || compatibleRevision(witness.mapping) !== compatibleRevision(mapping)) throw new Error('Transaction acquisition mismatch.');
      const value = projectTransactionCapture(capture);
      if (value.status !== 'available') throw new Error('Transaction projection unavailable.');
      const finalMapping = await administration.readSourceMapping(externalLeagueId);
      if (compatibleRevision(finalMapping) !== compatibleRevision(mapping)) throw new Error('Transaction mapping changed.');
      transactions.push({ ...task, ...(history ? { receiptState: value.events.length ? 'complete' as const : 'complete-empty' as const } : {}),
        resource: { ...resource, value }, acquisition: { sourceMapping: row.source_mapping,
        workerId: row.worker_id, generation: row.generation, transactionReceiptId: row.transaction_receipt_id, recordedAt: row.recorded_at } });
    } catch {
      transactions.push({ ...task, resource: unavailable('stored-transaction-source-unavailable'), acquisition: null });
    }
  }
  return transactions;
}

async function readTransactionTaskRows(client: DatabaseClient, requestId: string, history: boolean) {
  return client.query(`/* public-data-intake:read-transactions */
    SELECT task.ordinal,task.season,task.external_league_id,task.native_week,task.status,task.failure_count,task.reason,
      checkpoint.worker_id,checkpoint.generation,checkpoint.league_season_id,checkpoint.source_mapping,
      checkpoint.transaction_receipt_id,checkpoint.recorded_at
    FROM public.public_data_transaction_tasks task
    LEFT JOIN public.public_data_transaction_checkpoints checkpoint ON checkpoint.intake_id=task.intake_id
      AND checkpoint.task_ordinal=task.ordinal
    WHERE task.intake_id=$1::uuid ORDER BY task.ordinal LIMIT ${history ? 381 : 21}`, [requestId]);
}

/** Current complete acceptance is useful after a failed cycle, but never its acquisition proof. */
async function readCurrentTransactions(administration: LeagueAdministrationStore, externalLeagueId: string, season: number, nativeWeek: number) {
  const captureBinding = 'latest-for-current-source-mapping' as const;
  try {
    const mapping = await administration.readSourceMapping(externalLeagueId);
    if (!mapping || mapping.scope.season !== season || mapping.scope.externalLeagueId !== externalLeagueId) {
      throw new Error('Current transaction mapping unavailable.');
    }
    const resource = await administration.readAcceptedTransactions(mapping, nativeWeek);
    if (resource.status !== 'available') return { captureBinding, resource };
    const value = projectTransactionCapture(resource.capture);
    if (value.status !== 'available' || compatibleRevision(await administration.readSourceMapping(externalLeagueId)) !== compatibleRevision(mapping)) {
      throw new Error('Current transaction source changed.');
    }
    return { captureBinding, resource: { ...resource, value } };
  } catch {
    return { captureBinding, resource: unavailable('current-transaction-source-unavailable') };
  }
}

/** All metadata is bounded to 380 tasks; at most twenty rich receipt pairs are read per page. */
export async function readPublicTransactionHistory(client: DatabaseClient, administration: LeagueAdministrationStore,
  requestId: string, candidates: readonly DatabaseRow[], lists: readonly DatabaseRow[], page: PublicPeriodInventoryPage = {}, terminal = false) {
  const afterOrdinal = page.afterOrdinal ?? 0, limit = page.limit ?? 20;
  if (!Number.isInteger(afterOrdinal) || afterOrdinal < 0 || afterOrdinal > 380
    || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid transaction history page.');
  if (candidates.length > 1000 || lists.length > 1 || lists.some(list => list.season !== 2026)
    || candidates.some(candidate => candidate.season !== 2026 || typeof candidate.external_league_id !== 'string'
      || !/^[1-9][0-9]{0,31}$/u.test(candidate.external_league_id))
    || new Set(candidates.map(candidate => candidate.external_league_id)).size !== candidates.length) {
    throw new Error('Invalid stored transaction discovery.');
  }
  const rows = await readTransactionTaskRows(client, requestId, true);
  const discovered = lists.length === 1;
  // A later bootstrap can change an admitted candidate to capacity. Its retained
  // nineteen tasks still prove admission and carry explicit unavailable reasons.
  const admitted = candidates.filter(candidate => candidate.stage !== 'capacity'
    || rows.some(row => row.external_league_id === candidate.external_league_id))
    .sort((left, right) => String(left.external_league_id) < String(right.external_league_id) ? -1 : 1);
  if (rows.length > 380 || admitted.length > 20 || !discovered && (rows.length || candidates.length)
    || rows.length !== admitted.length * 19) throw new Error('Incomplete stored transaction history task matrix.');
  const tasks = rows.map((row, index) => {
    const candidate = admitted[Math.floor(index / 19)], nativeWeek = index % 19;
    if (row.ordinal !== index + 1 || row.season !== 2026 || row.external_league_id !== candidate.external_league_id
      || row.native_week !== nativeWeek || !['pending', 'complete', 'unavailable'].includes(String(row.status))
      || !Number.isInteger(row.failure_count) || Number(row.failure_count) < 0 || Number(row.failure_count) > 5
      || row.status === 'pending' && Number(row.failure_count) >= 5
      || (row.status === 'unavailable') !== (row.reason !== null)
      || row.reason !== null && !['transaction-capture-exhausted', 'bootstrap-unavailable', 'bootstrap-capacity', 'discovery-unavailable'].includes(String(row.reason))
      || candidate.stage === 'capacity' && (row.status !== 'unavailable' || row.reason !== 'bootstrap-capacity')
      || row.status === 'complete' && (!isTransactionCaptureId(row.transaction_receipt_id)
        || !isTransactionCaptureId(row.worker_id) || !Number.isSafeInteger(row.generation) || Number(row.generation) < 1
        || !isTransactionCaptureId(row.league_season_id) || !isAdministrationSourceMapping(row.source_mapping)
        || row.source_mapping.leagueSeasonId !== row.league_season_id || row.source_mapping.scope.season !== 2026
        || row.source_mapping.scope.externalLeagueId !== row.external_league_id
        || !Number.isFinite(new Date(String(row.recorded_at)).getTime()))
      || row.status !== 'complete' && row.transaction_receipt_id != null) throw new Error('Invalid stored transaction history task.');
    return { provider: 'sleeper' as const, season: 2026 as const, externalLeagueId: String(row.external_league_id), nativeWeek,
      ordinal: index + 1, collection: String(row.status), failureCount: Number(row.failure_count), reason: row.reason,
      transactionReceiptId: row.transaction_receipt_id ?? null };
  });
  const capacityLeagues = candidates.length - admitted.length;
  const pendingPeriods = tasks.filter(task => task.collection === 'pending').length;
  const acquiredPeriods = tasks.filter(task => task.collection === 'complete').length;
  const unavailablePeriods = tasks.filter(task => task.collection === 'unavailable').length;
  const selectedRows = rows.filter(row => Number(row.ordinal) > afterOrdinal).slice(0, limit);
  const lastOrdinal = Number(selectedRows.at(-1)?.ordinal ?? afterOrdinal);
  const nextAfterOrdinal = rows.some(row => Number(row.ordinal) > lastOrdinal) ? lastOrdinal : null;
  const transactions = await readPublicTransactions(client, administration, requestId, candidates, publicTransactionHistoryPeriods()[0], selectedRows);
  const collection = !discovered ? terminal ? 'unavailable' as const : 'pending' as const
    : pendingPeriods ? 'pending' as const : capacityLeagues || unavailablePeriods ? 'partial' as const : 'complete' as const;
  return { transactions, inventory: { policy: PUBLIC_TRANSACTION_HISTORY, discovery: discovered ? 'complete' as const : terminal ? 'unavailable' as const : 'pending' as const,
    coverage: !discovered ? terminal ? 'limited' as const : 'pending' as const : capacityLeagues ? 'limited' as const : 'complete' as const,
    collection, readCoverage: selectedRows.length === rows.length ? 'complete' as const : 'page' as const,
    summary: { observedLeagues: candidates.length, admittedLeagues: admitted.length, capacityLeagues,
      requestedPeriods: candidates.length * 19, materializedPeriods: rows.length, capacityPeriods: capacityLeagues * 19,
      pendingPeriods, acquiredPeriods, unavailablePeriods }, tasks,
    capacity: candidates.filter(candidate => !admitted.includes(candidate)).map(candidate => ({ provider: 'sleeper' as const,
      season: 2026 as const, externalLeagueId: String(candidate.external_league_id), nativeWeeks: publicTransactionHistoryPeriods().map(period => period.nativeWeek),
      reason: 'intake-capacity' as const })), page: { afterOrdinal, limit, nextAfterOrdinal },
    meaning: 'Weeks 0–18 are requested coverage. Acquired counts immutable checkpoints; only this page verifies receipt resources. Current accepted data never counts as this request acquisition. Transactions remain grouped by native period.' } };
}
