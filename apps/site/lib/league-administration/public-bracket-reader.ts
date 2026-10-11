import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../database';
import { BRACKET_VALUE_VERSION, type AcceptedBracketRead, type BracketFamily } from '../aggregator/playoff-brackets';
import type { LeagueAdministrationStore } from './store-contracts';
import { isAdministrationSourceMapping } from './source-mapping';
import { parsePublicCaptureWitness } from './public-capture-witness';
import { compatibleRevision } from '../projections/shared/revision-compatibility';

const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);
const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason });

/** Selected intake only. Exact checkpoint receipts preserve corrections without borrowing newer heads. */
export async function readPublicBrackets(client: DatabaseClient, administration: LeagueAdministrationStore,
  requestId: string, candidates: readonly DatabaseRow[]) {
  const rows = await client.query(`/* public-data-intake:read-brackets */
    SELECT task.ordinal,task.season,task.external_league_id,task.status,task.failure_count,task.reason,
      checkpoint.worker_id,checkpoint.generation,checkpoint.league_season_id,checkpoint.source_mapping,
      checkpoint.winners_bracket_receipt_id,checkpoint.losers_bracket_receipt_id,checkpoint.recorded_at
    FROM public.public_data_bracket_tasks task
    LEFT JOIN public.public_data_bracket_checkpoints checkpoint ON checkpoint.intake_id=task.intake_id
      AND checkpoint.task_ordinal=task.ordinal
    WHERE task.intake_id=$1::uuid ORDER BY task.ordinal`, [requestId]);
  if (rows.length > 20) throw new Error('Invalid stored bracket task count.');
  const ordinals = new Set<number>(), identities = new Set<string>();
  const brackets = [];
  for (const row of rows) {
    const ordinal = Number(row.ordinal), season = Number(row.season), externalLeagueId = String(row.external_league_id);
    if (season !== 2026 || !/^[1-9][0-9]{0,31}$/u.test(externalLeagueId)
      || !Number.isInteger(ordinal) || ordinal < 1 || ordinal > 20 || ordinals.has(ordinal) || identities.has(externalLeagueId)
      || !candidates.some(candidate => candidate.season === season && candidate.external_league_id === externalLeagueId
        && (candidate.stage !== 'capacity' || row.status === 'unavailable' && row.reason === 'bootstrap-capacity'))
      || !['pending', 'complete', 'unavailable'].includes(String(row.status))
      || !Number.isInteger(row.failure_count) || Number(row.failure_count) < 0 || Number(row.failure_count) > 5) {
      throw new Error('Invalid stored bracket task.');
    }
    ordinals.add(ordinal); identities.add(externalLeagueId);
    const task = { provider: 'sleeper' as const, externalLeagueId, season, ordinal,
      collection: String(row.status), failureCount: Number(row.failure_count), reason: row.reason };
    if (row.status !== 'complete') {
      brackets.push({ ...task, resource: unavailable('bracket-capture-not-complete'), acquisition: null });
      continue;
    }
    try {
      const mapping = await administration.readSourceMapping(externalLeagueId);
      if (!mapping || mapping.scope.season !== season || mapping.scope.externalLeagueId !== externalLeagueId
        || mapping.leagueSeasonId !== row.league_season_id || !isAdministrationSourceMapping(row.source_mapping)
        || compatibleRevision(mapping) !== compatibleRevision(row.source_mapping)
        || !uuid(row.worker_id) || !Number.isSafeInteger(row.generation) || Number(row.generation) < 1
        || !uuid(row.winners_bracket_receipt_id) || !uuid(row.losers_bracket_receipt_id)
        || !Number.isFinite(new Date(String(row.recorded_at)).getTime())) throw new Error('Invalid stored bracket checkpoint.');
      const read = async (family: BracketFamily, receiptId: string): Promise<AcceptedBracketRead> => {
        if (!administration.readAcceptedBracket) return unavailable('bracket-reader-unsupported');
        const value = await administration.readAcceptedBracket(mapping, { family, bracketReceiptId: receiptId });
        if (value.status !== 'available') return value;
        if (value.version !== BRACKET_VALUE_VERSION || value.selection !== 'receipt' || value.bracketReceiptId !== receiptId
          || value.sourceMappingRevisionId !== mapping.revisionId || value.value.family !== family || value.value.season !== 2026) {
          return unavailable('intake-bracket-receipt-mismatch');
        }
        const witness = parsePublicCaptureWitness(value.provenance.acquisition);
        if (witness.work.kind !== 'playoff-brackets' || witness.work.requestId !== requestId
          || witness.work.externalLeagueId !== externalLeagueId || witness.work.season !== season
          || witness.fence.workerId !== row.worker_id || witness.fence.generation !== row.generation
          || compatibleRevision(witness.mapping) !== compatibleRevision(mapping)) return unavailable('intake-bracket-acquisition-mismatch');
        return value;
      };
      // Keep each stored read bounded and provider-free; a family failure does not hide its sibling evidence.
      const winners = await read('winners_bracket', row.winners_bracket_receipt_id).catch(() => unavailable('bracket-read-failed'));
      const losers = await read('losers_bracket', row.losers_bracket_receipt_id).catch(() => unavailable('bracket-read-failed'));
      const complete = winners.status === 'available' && losers.status === 'available'
        && compatibleRevision(winners.provenance.acquisition) === compatibleRevision(losers.provenance.acquisition);
      brackets.push({ ...task, resource: { ...(complete ? { status: 'available' as const }
        : unavailable('bracket-pair-not-available')), winners_bracket: winners, losers_bracket: losers },
      acquisition: { sourceMapping: row.source_mapping, workerId: row.worker_id, generation: row.generation,
        winnersBracketReceiptId: row.winners_bracket_receipt_id, losersBracketReceiptId: row.losers_bracket_receipt_id,
        recordedAt: row.recorded_at } });
    } catch {
      brackets.push({ ...task, resource: unavailable('stored-bracket-source-unavailable'), acquisition: null });
    }
  }
  return brackets;
}