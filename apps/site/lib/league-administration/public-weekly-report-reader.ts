import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../database';
import type { LeagueAdministrationStore } from './store-contracts';
import type { PublicExactPeriod } from './public-intake-contracts';
import { isAdministrationSourceMapping } from './source-mapping';
import { parsePublicCaptureWitness } from './public-capture-witness';
import { compatibleRevision } from '../projections/shared/revision-compatibility';

const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);
const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason });

/** Explicit report selection only; original checkpoint receipts remain readable after corrections. */
export async function readPublicWeeklyReports(client: DatabaseClient, administration: LeagueAdministrationStore,
  requestId: string, candidates: readonly DatabaseRow[], selection: readonly PublicExactPeriod[]) {
  const rows = await client.query(`/* public-data-intake:read-weekly-reports */
    SELECT task.ordinal,task.season,task.external_league_id,task.native_week,task.status,task.failure_count,task.reason,
      checkpoint.worker_id,checkpoint.generation,checkpoint.league_season_id,checkpoint.source_mapping,
      checkpoint.report_receipt_id,checkpoint.recorded_at
    FROM public.public_data_report_tasks task
    LEFT JOIN public.public_data_report_checkpoints checkpoint ON checkpoint.intake_id=task.intake_id
      AND checkpoint.task_ordinal=task.ordinal
    WHERE task.intake_id=$1::uuid ORDER BY task.ordinal`, [requestId]);
  if (rows.length > 360) throw new Error('Invalid stored report task count.');
  const ordinals = new Set<number>(), identities = new Set<string>();
  const reports = [];
  for (const row of rows) {
    const ordinal = Number(row.ordinal), season = Number(row.season), externalLeagueId = String(row.external_league_id);
    const nativeWeek = Number(row.native_week), identity = externalLeagueId + ':' + nativeWeek;
    if (season !== 2026 || !/^[1-9][0-9]{0,31}$/u.test(externalLeagueId)
      || !Number.isInteger(ordinal) || ordinal < 1 || ordinal > 360 || ordinals.has(ordinal) || identities.has(identity)
      || !selection.some(period => period.season === season && period.nativeWeek === nativeWeek)
      || !candidates.some(candidate => candidate.season === season && candidate.external_league_id === externalLeagueId
        && (candidate.stage !== 'capacity' || row.status === 'unavailable' && row.reason === 'bootstrap-capacity'))
      || !['pending', 'complete', 'unavailable'].includes(String(row.status))
      || !Number.isInteger(row.failure_count) || Number(row.failure_count) < 0 || Number(row.failure_count) > 5) {
      throw new Error('Invalid stored report task.');
    }
    ordinals.add(ordinal); identities.add(identity);
    const task = { provider: 'sleeper' as const, externalLeagueId, season, nativeWeek, ordinal,
      collection: String(row.status), failureCount: Number(row.failure_count), reason: row.reason };
    if (row.status !== 'complete') {
      reports.push({ ...task, resource: unavailable('report-capture-not-complete'), acquisition: null });
      continue;
    }
    try {
      const mapping = await administration.readSourceMapping(externalLeagueId);
      if (!mapping || mapping.scope.season !== season || mapping.scope.externalLeagueId !== externalLeagueId
        || mapping.leagueSeasonId !== row.league_season_id || !isAdministrationSourceMapping(row.source_mapping)
        || compatibleRevision(mapping) !== compatibleRevision(row.source_mapping)
        || !uuid(row.worker_id) || !Number.isSafeInteger(row.generation) || Number(row.generation) < 1
        || !uuid(row.report_receipt_id) || !Number.isFinite(new Date(String(row.recorded_at)).getTime())) {
        throw new Error('Invalid stored report checkpoint.');
      }
      if (!administration.readAcceptedWeeklyReport) throw new Error('Report reader unsupported.');
      const resource = await administration.readAcceptedWeeklyReport(mapping, { nativeWeek, reportReceiptId: row.report_receipt_id });
      if (resource.status === 'available') {
        if (resource.version !== 'sleeper-weekly-report-v1' || resource.selection !== 'receipt'
          || resource.reportReceiptId !== row.report_receipt_id || resource.sourceMappingRevisionId !== mapping.revisionId
          || resource.value.season !== season || resource.value.nativeWeek !== nativeWeek) throw new Error('Report receipt mismatch.');
        const witness = parsePublicCaptureWitness(resource.provenance.acquisition);
        if (witness.work.kind !== 'weekly-report' || witness.work.requestId !== requestId || witness.work.nativeWeek !== nativeWeek
          || witness.work.externalLeagueId !== externalLeagueId || witness.work.season !== season
          || witness.fence.workerId !== row.worker_id || witness.fence.generation !== row.generation
          || compatibleRevision(witness.mapping) !== compatibleRevision(mapping)) throw new Error('Report acquisition mismatch.');
      }
      reports.push({ ...task, resource, acquisition: { sourceMapping: row.source_mapping, workerId: row.worker_id,
        generation: row.generation, reportReceiptId: row.report_receipt_id, recordedAt: row.recorded_at } });
    } catch {
      reports.push({ ...task, resource: unavailable('stored-report-source-unavailable'), acquisition: null });
    }
  }
  return reports;
}
