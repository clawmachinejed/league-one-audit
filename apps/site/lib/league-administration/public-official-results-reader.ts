import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../database';
import { CURRENT_ROSTER_POLICY, currentRosterScope } from '../aggregator/current-roster';
import { OFFICIAL_STANDINGS_VERSION, type OfficialStandingsRead } from '../aggregator/official-standings';
import type { AdministrationSourceMapping } from './source-mapping';
import { isAdministrationSourceMapping } from './source-mapping';
import type { LeagueAdministrationStore } from './store-contracts';
import { parsePublicCaptureWitness } from './public-capture-witness';
import { compatibleRevision } from '../projections/shared/revision-compatibility';

export type PublicOfficialStandingsRead = Readonly<{
  captureBinding: 'intake-dispatch'; resource: OfficialStandingsRead;
  acquisition: Readonly<{ requestId: string; revision: number; workerId: string; generation: number;
    dispatchNonce: string; rosterReceiptId: string; attemptId: string }> | null;
}>;
const same = (left: unknown, right: unknown) => left === undefined || right === undefined
  ? left === right : compatibleRevision(left) === compatibleRevision(right);
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);
const unavailable = (reason: string): PublicOfficialStandingsRead => ({ captureBinding: 'intake-dispatch',
  resource: { status: 'unavailable', reason }, acquisition: null });

/** Failed core work can retain a receipt without a completion checkpoint. The original witness is its immutable request binding. */
export const PUBLIC_OFFICIAL_STANDINGS_SQL = `/* public-data-intake:read-official-standings */
  WITH recent AS (
    SELECT dispatch.* FROM public.public_data_dispatches dispatch
    JOIN public.public_data_league_candidates candidate ON candidate.intake_id=dispatch.intake_id
      AND candidate.external_league_id=dispatch.work->>'externalLeagueId'
      AND candidate.season::text=dispatch.work->>'season'
    WHERE dispatch.intake_id=$1::uuid AND dispatch.resource='core'
      AND candidate.league_season_id=$2::uuid AND candidate.external_league_id=$3
      AND candidate.season=$4
    ORDER BY dispatch.revision DESC,dispatch.admitted_at DESC LIMIT 2
  ), latest AS (SELECT * FROM recent WHERE revision=(SELECT max(revision) FROM recent))
  SELECT dispatch.intake_id,dispatch.revision,dispatch.work,dispatch.worker_id,dispatch.generation,
    dispatch.capture_nonce AS dispatch_nonce,attempt.id AS attempt_id,attempt.capture_nonce AS attempt_nonce,
    attempt.source_mapping,attempt.write_fence,receipt.id AS receipt_id,public.roster_capture_provenance(receipt) AS provenance,
    qualification.intake_id AS qualified_intake_id,qualification.worker_id AS qualified_worker_id,
    qualification.generation AS qualified_generation,qualification.receipt_id AS qualified_receipt_id
  FROM latest dispatch
  LEFT JOIN public.league_roster_resource_scopes scope ON scope.identity=$5::jsonb
  LEFT JOIN public.league_roster_resource_attempts attempt ON attempt.scope_id=scope.id
    AND attempt.write_fence->>'jobKey'='league-administration-public-intake'
    AND attempt.write_fence->>'workerId'=dispatch.worker_id
    AND attempt.write_fence->>'generation'=dispatch.generation::text
  LEFT JOIN public.league_roster_capture_receipts receipt ON receipt.attempt_id=attempt.id
  LEFT JOIN public.league_official_standings_captures qualification ON qualification.receipt_id=receipt.id
  LIMIT 2`;

export async function readPublicOfficialStandingsRows(rows: readonly DatabaseRow[], administration: LeagueAdministrationStore,
  requestId: string, mapping: AdministrationSourceMapping): Promise<PublicOfficialStandingsRead> {
  try {
    if (!uuid(requestId) || !isAdministrationSourceMapping(mapping) || mapping.scope.season !== 2026) throw new Error('Invalid standings request.');
    if (!rows.length) return unavailable('intake-core-not-dispatched');
    if (rows.length !== 1) throw new Error('Ambiguous intake standings dispatch.');
    const row = rows[0];
    if (row.intake_id !== requestId || !uuid(row.worker_id) || !uuid(row.dispatch_nonce)
      || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0
      || !Number.isSafeInteger(row.generation) || Number(row.generation) < 1) throw new Error('Invalid standings dispatch.');
    const expectedWork = { requestId, revision: row.revision, kind: 'core', externalLeagueId: mapping.scope.externalLeagueId, season: mapping.scope.season };
    if (!same(row.work, expectedWork)) throw new Error('Wrong intake standings work.');
    if (row.receipt_id === null) return unavailable('intake-core-has-no-roster-capture');
    if (!uuid(row.receipt_id) || !uuid(row.attempt_id) || !uuid(row.attempt_nonce)
      || !same(row.source_mapping, mapping)) throw new Error('Invalid standings reservation.');
    const provenance = row.provenance as { acquisition?: unknown };
    const witness = parsePublicCaptureWitness(provenance?.acquisition);
    if (!same(witness.work, expectedWork) || !same(witness.mapping, mapping)
      || !same(witness.fence, row.write_fence) || witness.fence.workerId !== row.worker_id
      || witness.fence.generation !== row.generation || witness.dispatchNonce !== row.dispatch_nonce
      || witness.attempts.players?.id !== row.attempt_id || witness.attempts.players?.nonce !== row.attempt_nonce) {
      throw new Error('Foreign intake standings acquisition.');
    }
    if (row.qualified_receipt_id === null) return { captureBinding: 'intake-dispatch',
      resource: { status: 'missing', reason: 'typed_standings_not_recorded' }, acquisition: null };
    if (row.qualified_receipt_id !== row.receipt_id || row.qualified_intake_id !== requestId
      || row.qualified_worker_id !== row.worker_id || row.qualified_generation !== row.generation) {
      throw new Error('Foreign intake standings qualification.');
    }
    if (!administration.readOfficialStandings) return unavailable('official-standings-reader-unsupported');
    const resource = await administration.readOfficialStandings(mapping, { rosterReceiptId: row.receipt_id });
    if (resource.status === 'available' && (resource.version !== OFFICIAL_STANDINGS_VERSION || resource.selection !== 'receipt' || !same(resource.mapping, mapping)
      || resource.capture.rosterReceiptId !== row.receipt_id || resource.capture.attemptId !== row.attempt_id
      || !same(resource.capture.provenance, row.provenance))) throw new Error('Intake standings receipt substitution.');
    return { captureBinding: 'intake-dispatch', resource,
      acquisition: { requestId, revision: Number(row.revision), workerId: row.worker_id, generation: Number(row.generation),
        dispatchNonce: row.dispatch_nonce, rosterReceiptId: row.receipt_id, attemptId: row.attempt_id } };
  } catch { return unavailable('intake-official-standings-evidence-mismatch'); }
}

export async function readPublicOfficialStandings(client: DatabaseClient, administration: LeagueAdministrationStore,
  requestId: string, mapping: AdministrationSourceMapping): Promise<PublicOfficialStandingsRead> {
  try {
    if (!uuid(requestId) || !isAdministrationSourceMapping(mapping) || mapping.scope.season !== 2026) throw new Error('Invalid standings request.');
    const rows = await client.query(PUBLIC_OFFICIAL_STANDINGS_SQL, [requestId, mapping.leagueSeasonId,
      mapping.scope.externalLeagueId, mapping.scope.season, JSON.stringify({ scope: currentRosterScope(mapping), policy: CURRENT_ROSTER_POLICY })]);
    return await readPublicOfficialStandingsRows(rows, administration, requestId, mapping);
  } catch { return unavailable('intake-official-standings-read-failed'); }
}
