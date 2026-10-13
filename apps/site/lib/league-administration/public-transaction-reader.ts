import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../database';
import { projectTransactionCapture } from '../aggregator/transaction-activity';
import type { LeagueAdministrationStore } from './store-contracts';
import type { PublicTransactionPeriod } from './public-intake-contracts';
import { isAdministrationSourceMapping } from './source-mapping';
import { parsePublicCaptureWitness } from './public-capture-witness';
import { isTransactionCaptureId } from './transaction-capture-contracts';
import { compatibleRevision } from '../projections/shared/revision-compatibility';

const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason });

/** One selected native period. Read its immutable receipt, including fresh equal-content clocks. */
export async function readPublicTransactions(client: DatabaseClient, administration: LeagueAdministrationStore,
  requestId: string, candidates: readonly DatabaseRow[], selection: PublicTransactionPeriod) {
  const rows = await client.query(`/* public-data-intake:read-transactions */
    SELECT task.ordinal,task.season,task.external_league_id,task.native_week,task.status,task.failure_count,task.reason,
      checkpoint.worker_id,checkpoint.generation,checkpoint.league_season_id,checkpoint.source_mapping,
      checkpoint.transaction_receipt_id,checkpoint.recorded_at
    FROM public.public_data_transaction_tasks task
    LEFT JOIN public.public_data_transaction_checkpoints checkpoint ON checkpoint.intake_id=task.intake_id
      AND checkpoint.task_ordinal=task.ordinal
    WHERE task.intake_id=$1::uuid ORDER BY task.ordinal`, [requestId]);
  if (rows.length > 20) throw new Error('Invalid stored transaction task count.');
  const ordinals = new Set<number>(), identities = new Set<string>();
  const transactions = [];
  for (const row of rows) {
    const ordinal = Number(row.ordinal), season = Number(row.season), externalLeagueId = String(row.external_league_id);
    const nativeWeek = Number(row.native_week);
    if (season !== 2026 || !/^[1-9][0-9]{0,31}$/u.test(externalLeagueId)
      || !Number.isInteger(ordinal) || ordinal < 1 || ordinal > 20 || ordinals.has(ordinal) || identities.has(externalLeagueId)
      || selection.season !== season || selection.nativeWeek !== nativeWeek
      || !candidates.some(candidate => candidate.season === season && candidate.external_league_id === externalLeagueId
        && (candidate.stage !== 'capacity' || row.status === 'unavailable' && row.reason === 'bootstrap-capacity'))
      || !['pending', 'complete', 'unavailable'].includes(String(row.status))
      || !Number.isInteger(row.failure_count) || Number(row.failure_count) < 0 || Number(row.failure_count) > 5) {
      throw new Error('Invalid stored transaction task.');
    }
    ordinals.add(ordinal); identities.add(externalLeagueId);
    const task = { provider: 'sleeper' as const, externalLeagueId, season, nativeWeek, ordinal,
      collection: String(row.status), failureCount: Number(row.failure_count), reason: row.reason };
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
      transactions.push({ ...task, resource: { ...resource, value }, acquisition: { sourceMapping: row.source_mapping,
        workerId: row.worker_id, generation: row.generation, transactionReceiptId: row.transaction_receipt_id, recordedAt: row.recorded_at } });
    } catch {
      transactions.push({ ...task, resource: unavailable('stored-transaction-source-unavailable'), acquisition: null });
    }
  }
  return transactions;
}
