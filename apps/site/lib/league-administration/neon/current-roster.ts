import 'server-only';
import type { DatabaseClient } from '../../database';
import { CURRENT_ROSTER_POLICY, currentRosterScope, type AcceptedCurrentRosterRead,
  type CurrentRosterPolicy, type RosterAttempt } from '../../aggregator/current-roster';
import { assertAcceptedResource, assertRosterMembership } from '../../aggregator/validation';
import type { AcceptedResource, RosterMembership } from '../../aggregator/contracts';
import type { AdministrationSourceMapping } from '../source-mapping';
import { isAdministrationSourceMapping } from '../source-mapping';
import { normalizeAdministrationObservation } from '../normalize';
import type { AdministrationEnvelope } from '../contracts';
import type { AdministrationWriteFence } from '../store-contracts';
import { compatibleRevision } from '../../projections/shared/revision-compatibility';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid current roster evidence.');
  return value as Record<string, unknown>;
}
function integer(value: unknown, minimum = 1): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') throw new Error('Invalid current roster generation.');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < minimum) throw new Error('Invalid current roster generation.');
  return n;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('Invalid current roster identity.');
  return value;
}

/** Internal-only shadow readback. It never selects content through the v1 head. */
export function currentRosterMethods(client: DatabaseClient) {
  return {
    async beginRosterAttempt(mapping: AdministrationSourceMapping, attemptId: string,
      policy: CurrentRosterPolicy = CURRENT_ROSTER_POLICY, fence?: AdministrationWriteFence): Promise<RosterAttempt> {
      if (!isAdministrationSourceMapping(mapping)) throw new Error('Invalid current roster mapping.');
      const rows = await client.query(`/* league-administration:begin-roster-attempt */
        SELECT public.begin_current_roster_attempt($1::jsonb,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb) AS result`,
      [JSON.stringify(mapping), attemptId, JSON.stringify(currentRosterScope(mapping)), JSON.stringify(policy), fence ? JSON.stringify(fence) : null]);
      if (rows.length !== 1) throw new Error('Missing current roster attempt.');
      const result = object(rows[0].result);
      return { id: id(result.id), scopeId: id(result.scopeId), ordinal: integer(result.ordinal),
        expectedGeneration: integer(result.expectedGeneration, 0) };
    },
    async readAcceptedCurrentRoster(mapping: AdministrationSourceMapping): Promise<AcceptedCurrentRosterRead> {
      if (!isAdministrationSourceMapping(mapping)) return { status: 'unavailable', reason: 'invalid_mapping' };
      try {
        const rows = await client.query(`/* league-administration:read-accepted-current-roster */
          SELECT scope.identity,accepted.scope_id,accepted.generation,accepted.source_mapping_revision_id,
            receipt.id AS receipt_id,receipt.attempt_id,receipt.provenance,receipt.configuration_content_id,
            receipt.expected_team_count,receipt.legacy_observation_id,receipt.coverage,
            attempt.ordinal,attempt.source_mapping,content.id AS content_id,content.content_hash,
            content.payload,content.normalized_value,content.normalizer_version,content.completeness,
            content.league_season_id,content.provider,content.external_league_id,
            (SELECT jsonb_agg(jsonb_build_object('seasonTeamId',team.id,'externalRosterId',team.external_roster_id)
              ORDER BY team.external_roster_id) FROM public.league_administration_team_entries entry
              JOIN public.league_season_teams team ON team.id=entry.team_id AND team.league_season_id=entry.league_season_id
              WHERE entry.content_id=content.id AND entry.league_season_id=content.league_season_id
                AND team.provider=content.provider AND team.external_league_id=content.external_league_id) AS identities
          FROM public.league_roster_resource_scopes scope
          JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id
          JOIN public.league_roster_resource_acceptances accepted ON accepted.id=head.accepted_id
            AND accepted.scope_id=scope.id AND accepted.generation=head.generation
          JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
          JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id AND attempt.scope_id=scope.id
          JOIN public.league_administration_contents content ON content.id=receipt.content_id
          JOIN public.league_source_connections connection ON connection.id=scope.connection_id
            AND connection.league_season_id=scope.league_season_id
            AND connection.current_mapping_revision_id=accepted.source_mapping_revision_id
          WHERE scope.identity=$1::jsonb AND connection.current_mapping_revision_id=$2::uuid
            AND connection.mapping_generation=$3 AND content.accepted AND content.family='rosters' AND content.week=0`,
        [JSON.stringify({ scope: currentRosterScope(mapping), policy: CURRENT_ROSTER_POLICY }), mapping.revisionId, mapping.generation]);
        if (rows.length === 0) return { status: 'missing' };
        if (rows.length !== 1) throw new Error('Ambiguous current roster.');
        const row = rows[0];
        const capturedMapping = object(row.source_mapping);
        if (!isAdministrationSourceMapping(capturedMapping)
          || compatibleRevision(capturedMapping) !== compatibleRevision(mapping)
          || row.source_mapping_revision_id !== mapping.revisionId
          || compatibleRevision(row.identity) !== compatibleRevision({ scope: currentRosterScope(mapping), policy: CURRENT_ROSTER_POLICY })
          || row.league_season_id !== mapping.leagueSeasonId || row.provider !== 'sleeper'
          || row.external_league_id !== mapping.scope.externalLeagueId || row.normalizer_version !== 'sleeper-administration-v1'
          || row.completeness !== 'complete' || compatibleRevision(row.coverage) !== compatibleRevision({ periodIds: [],
            interval: null, entitySet: 'full', fields: ['players'], pagination: 'complete', nextCursor: null,
            completeness: 'complete', reasons: [] })) throw new Error('Invalid roster lineage.');
        const provenance = object(row.provenance) as AdministrationEnvelope['provenance'];
        const envelope: AdministrationEnvelope = { schemaVersion: 'league-administration-v1',
          normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope,
          family: 'rosters', week: null, completeness: 'complete', provenance,
          payload: row.payload as AdministrationEnvelope['payload'] };
        const normalized = normalizeAdministrationObservation(envelope, { expectedRosterCount: integer(row.expected_team_count) });
        if (normalized.status !== 'accepted' || normalized.value?.family !== 'rosters'
          || normalized.contentHash !== row.content_hash || provenance.origin !== 'network'
          || provenance.requestStartedAt === null || provenance.requestCompletedAt === null || provenance.sourceObservedAt === null
          || compatibleRevision(normalized.value) !== compatibleRevision(row.normalized_value)
          || !Array.isArray(row.identities)) throw new Error('Invalid roster content.');
        const identities = new Map<string, string>();
        for (const raw of row.identities) {
          const identity = object(raw);
          if (typeof identity.externalRosterId !== 'string' || identities.has(identity.externalRosterId)) throw new Error('Duplicate roster identity.');
          identities.set(identity.externalRosterId, id(identity.seasonTeamId));
        }
        if (identities.size !== normalized.value.teams.length || new Set(identities.values()).size !== identities.size) throw new Error('Incomplete roster identities.');
        const teams = normalized.value.teams.map(team => {
          const seasonTeamId = identities.get(team.externalRosterId);
          if (!seasonTeamId || team.playerExternalIds === null) throw new Error('Incomplete players coverage.');
          const players: RosterMembership[] = team.playerExternalIds.map(nativeId => ({ seasonTeamId,
            sourceTeam: { provider: 'sleeper', resourceKind: 'team',
              nativeNamespace: JSON.stringify(['nfl', mapping.scope.season, mapping.scope.externalLeagueId]), nativeId: team.externalRosterId },
            sourceEntity: { provider: 'sleeper', resourceKind: 'scoring-entity', nativeNamespace: 'nfl', nativeId },
            canonicalEntityId: null, identityState: 'unresolved', nativeSection: 'players', section: 'roster',
            effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' }));
          players.forEach(assertRosterMembership);
          return { seasonTeamId, externalRosterId: team.externalRosterId, players };
        });
        const accepted: AcceptedResource = { scope: currentRosterScope(mapping),
          canonicalNormalizerVersion: CURRENT_ROSTER_POLICY.canonicalNormalizerVersion,
          sourceMappingRevisionId: mapping.revisionId, contentId: id(row.content_id), observationIds: [id(row.receipt_id)],
          validationVersion: CURRENT_ROSTER_POLICY.validationVersion, acceptedGeneration: integer(row.generation),
          verifiedAt: provenance.sourceObservedAt, effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' };
        assertAcceptedResource(accepted);
        return { status: 'available', accepted, receipt: { id: id(row.receipt_id), attemptId: id(row.attempt_id),
          ordinal: integer(row.ordinal), provenance, configurationContentId: id(row.configuration_content_id),
          expectedTeamCount: integer(row.expected_team_count), legacyObservationId: id(row.legacy_observation_id) }, teams };
      } catch { return { status: 'unavailable', reason: 'current_roster_evidence_unavailable' }; }
    },
  };
}
