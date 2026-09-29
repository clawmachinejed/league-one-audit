import 'server-only';
import type { DatabaseClient } from '../../database';
import { EXACT_MATCHUPS_POLICY, exactMatchupsScope, projectExactMatchups,
  type AcceptedExactMatchupsRead } from '../../aggregator/exact-matchups';
import { assertAcceptedResource } from '../../aggregator/validation';
import type { AcceptedResource } from '../../aggregator/contracts';
import type { RosterAttempt } from '../../aggregator/current-roster';
import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../source-mapping';
import { normalizeAdministrationObservation } from '../normalize';
import type { AdministrationEnvelope } from '../contracts';
import type { AdministrationWriteFence } from '../store-contracts';
import { compatibleRevision } from '../../projections/shared/revision-compatibility';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid matchup evidence.');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw new Error('Invalid matchup identity.');
  }
  return value;
}
function integer(value: unknown, minimum = 1): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') throw new Error('Invalid matchup ordinal.');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < minimum) throw new Error('Invalid matchup ordinal.');
  return n;
}

export function exactMatchupMethods(client: DatabaseClient) {
  return {
    async beginExactMatchupAttempt(mapping: AdministrationSourceMapping, week: number, attemptId: string,
      fence?: AdministrationWriteFence): Promise<RosterAttempt> {
      if (!isAdministrationSourceMapping(mapping)) throw new Error('Invalid matchup mapping.');
      exactMatchupsScope(mapping, week);
      const rows = await client.query(`/* league-administration:begin-exact-matchup-attempt */
        SELECT public.begin_exact_matchup_attempt($1::jsonb,$2::uuid,$3::integer,$4::jsonb) AS result`,
      [JSON.stringify(mapping), id(attemptId), week, fence ? JSON.stringify(fence) : null]);
      if (rows.length !== 1) throw new Error('Missing matchup reservation.');
      const row = object(rows[0].result);
      if (row.id !== attemptId) throw new Error('Wrong matchup reservation.');
      return { id: id(row.id), scopeId: id(row.scopeId), ordinal: integer(row.ordinal),
        expectedGeneration: integer(row.expectedGeneration, 0) };
    },
    async readAcceptedExactMatchups(mapping: AdministrationSourceMapping, week: number): Promise<AcceptedExactMatchupsRead> {
      if (!isAdministrationSourceMapping(mapping)) return { status: 'unavailable', reason: 'invalid_mapping' };
      let scope: ReturnType<typeof exactMatchupsScope>;
      try { scope = exactMatchupsScope(mapping, week); }
      catch { return { status: 'unavailable', reason: 'invalid_period' }; }
      try {
        const identity = { scope, policy: EXACT_MATCHUPS_POLICY };
        const rows = await client.query(`/* league-administration:read-accepted-exact-matchups */
          SELECT scope.identity,accepted.generation,accepted.source_mapping_revision_id,
            receipt.id AS receipt_id,receipt.attempt_id,receipt.provenance,receipt.coverage,
            receipt.configuration_content_id,receipt.population_evidence,receipt.expected_team_count,
            receipt.legacy_observation_id,attempt.ordinal,attempt.source_mapping,
            configuration.payload AS configuration_payload,configuration.content_hash AS configuration_hash,
            content.id AS content_id,content.content_hash,content.semantic_hash,content.payload,
            content.normalized_value,content.normalizer_version,content.completeness,
            content.league_season_id,content.provider,content.external_league_id,content.family,content.week,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object('seasonTeamId',team.id,
              'externalRosterId',team.external_roster_id) ORDER BY team.external_roster_id),'[]'::jsonb)
              FROM public.league_administration_team_entries entry
              JOIN public.league_season_teams team ON team.id=entry.team_id
                AND team.league_season_id=entry.league_season_id
              WHERE entry.content_id=content.id AND entry.league_season_id=content.league_season_id
                AND team.provider=content.provider AND team.external_league_id=content.external_league_id) AS teams
          FROM public.league_roster_resource_scopes scope
          JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id
          JOIN public.league_roster_resource_acceptances accepted ON accepted.id=head.accepted_id
            AND accepted.scope_id=scope.id AND accepted.generation=head.generation
          JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
          JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
            AND attempt.scope_id=scope.id
          JOIN public.league_administration_contents content ON content.id=receipt.content_id
          JOIN public.league_administration_contents configuration ON configuration.id=receipt.configuration_content_id
          JOIN public.league_source_connections connection ON connection.id=scope.connection_id
            AND connection.league_season_id=scope.league_season_id
            AND connection.current_mapping_revision_id=accepted.source_mapping_revision_id
          JOIN public.league_seasons season ON season.id=scope.league_season_id
          JOIN public.league_administration_enrollment_seasons enrollment ON enrollment.league_id=season.league_id
            AND enrollment.season=season.season AND enrollment.provider=connection.provider
          WHERE scope.identity=$1::jsonb AND connection.current_mapping_revision_id=$2::uuid
            AND connection.mapping_generation=$3 AND content.family='matchups' AND content.week=$4`,
        [JSON.stringify(identity), mapping.revisionId, mapping.generation, week]);
        if (!rows.length) return { status: 'missing' };
        if (rows.length !== 1) throw new Error('Ambiguous exact matchup acceptance.');
        const row = rows[0];
        const expectedCoverage = { periodIds: [scope.scoringPeriodId], interval: null, entitySet: 'full',
          fields: ['roster_id', 'matchup_id'],
          pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] };
        if (!isAdministrationSourceMapping(row.source_mapping)
          || compatibleRevision(row.source_mapping) !== compatibleRevision(mapping)
          || compatibleRevision(row.identity) !== compatibleRevision(identity)
          || row.source_mapping_revision_id !== mapping.revisionId
          || row.league_season_id !== mapping.leagueSeasonId || row.provider !== 'sleeper'
          || row.external_league_id !== mapping.scope.externalLeagueId || row.family !== 'matchups'
          || Number(row.week) !== week || row.normalizer_version !== 'sleeper-administration-v1'
          || row.completeness !== 'complete' || row.configuration_content_id === null
          || row.population_evidence === null || integer(row.expected_team_count) < 1
          || compatibleRevision(row.coverage) !== compatibleRevision(expectedCoverage)) {
          throw new Error('Invalid matchup acceptance lineage.');
        }
        const provenance = object(row.provenance) as AdministrationEnvelope['provenance'];
        const population = object(row.population_evidence);
        const configuration = object(row.configuration_payload);
        if (population.contentHash !== row.configuration_hash
          || configuration.league_id !== mapping.scope.externalLeagueId
          || configuration.season !== String(mapping.scope.season)
          || configuration.total_rosters !== integer(row.expected_team_count)) {
          throw new Error('Invalid matchup population evidence.');
        }
        if (provenance.origin !== 'network' || !provenance.sourceObservedAt
          || !provenance.requestStartedAt || !provenance.requestCompletedAt) throw new Error('Missing network provenance.');
        const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
          normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope,
          family: 'matchups', week, completeness: 'complete', provenance,
          payload: row.payload as AdministrationEnvelope['payload'] }, { expectedRosterCount: integer(row.expected_team_count) });
        if (normalized.status !== 'accepted' || normalized.contentHash !== row.content_hash
          || normalized.semanticHash !== row.semantic_hash
          || compatibleRevision(normalized.value) !== compatibleRevision(row.normalized_value)) {
          throw new Error('Raw and legacy matchup evidence disagree.');
        }
        if (!Array.isArray(row.teams) || row.teams.length !== integer(row.expected_team_count)) {
          throw new Error('Incomplete matchup team links.');
        }
        const teams = row.teams.map((team: unknown) => {
          const entry = object(team);
          return { seasonTeamId: id(entry.seasonTeamId), externalRosterId: String(entry.externalRosterId) };
        });
        const settings = configuration.settings && typeof configuration.settings === 'object'
          && !Array.isArray(configuration.settings) ? configuration.settings as Record<string, unknown> : null;
        const positions = configuration.roster_positions;
        const slotEvidence = configuration.status === 'in_season' && settings?.leg === week && Array.isArray(positions)
          && positions.every(slot => typeof slot === 'string' && slot.length > 0)
          ? { nativePeriodWeek: week, nativeRosterPositions: positions as string[],
            evidenceRef: id(row.configuration_content_id) } : undefined;
        const value = projectExactMatchups(normalized, teams, slotEvidence);
        const accepted: AcceptedResource = { scope, canonicalNormalizerVersion: EXACT_MATCHUPS_POLICY.canonicalNormalizerVersion,
          sourceMappingRevisionId: mapping.revisionId, contentId: id(row.content_id), observationIds: [id(row.receipt_id)],
          validationVersion: EXACT_MATCHUPS_POLICY.validationVersion, acceptedGeneration: integer(row.generation),
          verifiedAt: provenance.sourceObservedAt, effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' };
        assertAcceptedResource(accepted);
        return { status: 'available', accepted, value, receipt: { id: id(row.receipt_id),
          attemptId: id(row.attempt_id), ordinal: integer(row.ordinal), legacyObservationId: id(row.legacy_observation_id),
          provenance, rawContentHash: normalized.contentHash, expectedTeamCount: integer(row.expected_team_count) },
          comparison: { status: 'equal', fields: ['raw-content', 'legacy-normalized-value', 'team-points', 'participants'] } };
      } catch { return { status: 'unavailable', reason: 'exact_matchup_evidence_unavailable' }; }
    },
  };
}
