import 'server-only';
import type { DatabaseClient } from '../../database';
import { CURRENT_ROSTER_POLICY, currentRosterScope, type RosterAttempt } from '../../aggregator/current-roster';
import { TEAM_MANAGERS_POLICY, teamManagersScope, type AcceptedTeamManagersRead,
  type ProviderManagerIdentity, type TeamManagerRelationships, TEAM_MANAGER_EVIDENCE_POLICY, teamManagerEvidenceScope,
  teamManagerEvidenceCoverage, type AcceptedTeamManagerEvidenceRead, type TeamManagerEvidenceRelationships } from '../../aggregator/team-managers';
import { assertAcceptedResource, assertProviderReference } from '../../aggregator/validation';
import type { AcceptedResource } from '../../aggregator/contracts';
import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../source-mapping';
import { normalizeAdministrationObservation } from '../normalize';
import type { AdministrationEnvelope } from '../contracts';
import type { AdministrationWriteFence } from '../store-contracts';
import { compatibleRevision } from '../../projections/shared/revision-compatibility';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid manager evidence.');
  return value as Record<string, unknown>;
}
function integer(value: unknown, minimum = 1): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') throw new Error('Invalid manager generation.');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < minimum) throw new Error('Invalid manager generation.');
  return n;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new Error('Invalid manager identity.');
  return value;
}
function attempt(value: unknown): RosterAttempt {
  const row = object(value);
  return { id: id(row.id), scopeId: id(row.scopeId), ordinal: integer(row.ordinal), expectedGeneration: integer(row.expectedGeneration, 0) };
}

export function teamManagerMethods(client: DatabaseClient) {
  async function beginCapture(mapping: AdministrationSourceMapping, playersId: string, managersId: string,
      fence: AdministrationWriteFence | undefined, evidence: boolean) {
      const managerPolicy = evidence ? TEAM_MANAGER_EVIDENCE_POLICY : TEAM_MANAGERS_POLICY;
      const managerScope = evidence ? teamManagerEvidenceScope(mapping) : teamManagersScope(mapping);
      if (!isAdministrationSourceMapping(mapping) || playersId === managersId) throw new Error('Invalid roster capture identity.');
      // One transaction reserves both policies before the same existing HTTP call.
      const rows = await client.query(`/* league-administration:begin-roster-capture */
        SELECT public.begin_current_roster_attempt($1::jsonb,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb) AS players,
          public.begin_current_roster_attempt($1::jsonb,$6::uuid,$7::jsonb,$8::jsonb,$5::jsonb) AS managers`,
      [JSON.stringify(mapping), playersId, JSON.stringify(currentRosterScope(mapping)), JSON.stringify(CURRENT_ROSTER_POLICY),
        fence ? JSON.stringify(fence) : null, managersId, JSON.stringify(managerScope), JSON.stringify(managerPolicy)]);
      if (rows.length !== 1) throw new Error('Missing roster capture reservations.');
      const players = attempt(rows[0].players); const managers = attempt(rows[0].managers);
      if (players.id !== playersId || managers.id !== managersId || players.scopeId === managers.scopeId) throw new Error('Invalid roster capture reservations.');
      return { players, managers };
    }
  async function readManagers(mapping: AdministrationSourceMapping, evidence: false): Promise<AcceptedTeamManagersRead>;
  async function readManagers(mapping: AdministrationSourceMapping, evidence: true): Promise<AcceptedTeamManagerEvidenceRead>;
  async function readManagers(mapping: AdministrationSourceMapping, evidence: boolean): Promise<AcceptedTeamManagersRead | AcceptedTeamManagerEvidenceRead> {
      const policy = evidence ? TEAM_MANAGER_EVIDENCE_POLICY : TEAM_MANAGERS_POLICY;
      const scope = evidence ? teamManagerEvidenceScope(mapping) : teamManagersScope(mapping);
      if (!isAdministrationSourceMapping(mapping)) return { status: 'unavailable', reason: 'invalid_mapping' };
      try {
        const rows = await client.query(`/* league-administration:read-accepted-team-managers */
          SELECT scope.identity,accepted.generation,accepted.source_mapping_revision_id,
            receipt.id AS receipt_id,receipt.attempt_id,receipt.provenance,receipt.configuration_content_id,
            receipt.expected_team_count,receipt.legacy_observation_id,receipt.coverage,
            attempt.ordinal,attempt.source_mapping,content.id AS content_id,content.content_hash,
            content.payload,content.normalizer_version,content.completeness,
            content.league_season_id,content.provider,content.external_league_id,
            (SELECT jsonb_agg(jsonb_build_object('seasonTeamId',team.id,'externalRosterId',team.external_roster_id,
              'sourceValue',entry.source_value) ORDER BY team.external_roster_id)
              FROM public.league_team_manager_entries entry
              JOIN public.league_season_teams team ON team.id=entry.team_id AND team.league_season_id=entry.league_season_id
              WHERE entry.content_id=content.id AND entry.league_season_id=content.league_season_id
                AND entry.normalizer_version=scope.identity->'policy'->>'canonicalNormalizerVersion'
                AND team.provider=content.provider AND team.external_league_id=content.external_league_id) AS identities,
            (SELECT jsonb_agg(jsonb_build_object('seasonTeamId',membership.team_id,'providerManagerId',manager.id,
              'externalManagerId',manager.external_manager_id,'role',membership.role))
              FROM public.league_team_manager_memberships membership
              JOIN public.league_source_manager_accounts manager ON manager.id=membership.manager_id AND manager.provider=content.provider
              JOIN public.league_season_teams team ON team.id=membership.team_id AND team.league_season_id=membership.league_season_id
              WHERE membership.content_id=content.id AND membership.league_season_id=content.league_season_id
                AND membership.normalizer_version=scope.identity->'policy'->>'canonicalNormalizerVersion'
                AND team.provider=content.provider AND team.external_league_id=content.external_league_id) AS managers
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
            AND connection.mapping_generation=$3 AND content.family='rosters' AND content.week=0`,
        [JSON.stringify({ scope, policy }), mapping.revisionId, mapping.generation]);
        if (!rows.length) return { status: 'missing' };
        if (rows.length !== 1) throw new Error('Ambiguous manager head.');
        const row = rows[0];
        if (!isAdministrationSourceMapping(row.source_mapping) || compatibleRevision(row.source_mapping) !== compatibleRevision(mapping)
          || row.source_mapping_revision_id !== mapping.revisionId
          || compatibleRevision(row.identity) !== compatibleRevision({ scope, policy })
          || row.league_season_id !== mapping.leagueSeasonId || row.provider !== 'sleeper'
          || row.external_league_id !== mapping.scope.externalLeagueId || row.normalizer_version !== 'sleeper-administration-v1'
          || row.completeness !== 'complete') {
          throw new Error('Invalid manager lineage.');
        }
        const provenance = object(row.provenance) as AdministrationEnvelope['provenance'];
        const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
          normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope,
          family: 'rosters', week: null, completeness: 'complete', provenance,
          payload: row.payload as AdministrationEnvelope['payload'] }, { expectedRosterCount: integer(row.expected_team_count), ...(evidence ? { managerEvidenceVersion: 'v2' as const } : {}) });
        const projection = evidence ? normalized.teamManagerEvidence : normalized.teamManagers;
        if (!projection?.teams || projection.status === 'invalid' || normalized.contentHash !== row.content_hash
          || provenance.origin !== 'network' || !provenance.requestStartedAt || !provenance.requestCompletedAt || !provenance.sourceObservedAt
          || !Array.isArray(row.identities)) throw new Error('Invalid manager content.');
        const coverage = evidence ? teamManagerEvidenceCoverage(normalized.teamManagerEvidence!)
          : { periodIds: [], interval: null, entitySet: 'full', fields: ['owner_id'], pagination: 'complete',
            nextCursor: null, completeness: 'complete', reasons: [] };
        if (compatibleRevision(row.coverage) !== compatibleRevision(coverage)) throw new Error('Invalid manager coverage.');
        const identities = new Map<string, { id: string; sourceValue: unknown }>();
        for (const raw of row.identities) {
          const entry = object(raw);
          if (typeof entry.externalRosterId !== 'string' || identities.has(entry.externalRosterId)) throw new Error('Duplicate team identity.');
          identities.set(entry.externalRosterId, { id: id(entry.seasonTeamId), sourceValue: entry.sourceValue });
        }
        if (identities.size !== projection.teams.length || new Set([...identities.values()].map(entry => entry.id)).size !== identities.size) throw new Error('Incomplete team identity.');
        if (row.managers !== null && !Array.isArray(row.managers)) throw new Error('Invalid manager identities.');
        const memberships = new Map<string, ProviderManagerIdentity>();
        const managerIds = new Map<string, string>();
        const nativeIds = new Map<string, string>();
        for (const raw of (row.managers ?? []) as unknown[]) {
          const entry = object(raw);
          if (typeof entry.externalManagerId !== 'string' || !['owner', 'co_owner'].includes(String(entry.role))) throw new Error('Invalid manager membership.');
          const sourceManager = { provider: 'sleeper' as const, resourceKind: 'manager', nativeNamespace: 'account', nativeId: entry.externalManagerId };
          assertProviderReference(sourceManager);
          const providerManagerId = id(entry.providerManagerId);
          const prior = managerIds.get(providerManagerId);
          if (prior !== undefined && prior !== entry.externalManagerId) throw new Error('Conflicting manager identity.');
          if (nativeIds.has(entry.externalManagerId) && nativeIds.get(entry.externalManagerId) !== providerManagerId) throw new Error('Conflicting native manager identity.');
          managerIds.set(providerManagerId, entry.externalManagerId);
          nativeIds.set(entry.externalManagerId, providerManagerId);
          const key = JSON.stringify([id(entry.seasonTeamId), entry.role, entry.externalManagerId]);
          if (memberships.has(key)) throw new Error('Duplicate membership.');
          memberships.set(key, { providerManagerId, sourceManager });
        }
        const teams: (TeamManagerRelationships | TeamManagerEvidenceRelationships)[] = projection.teams.map(team => {
          const identity = identities.get(team.externalRosterId);
          if (!identity || compatibleRevision(identity.sourceValue) !== compatibleRevision(team) || !evidence && team.primaryOwner.state === 'unknown') throw new Error('Unproved primary owner.');
          const sourceTeam = { provider: 'sleeper' as const, resourceKind: 'team', nativeNamespace: JSON.stringify(['nfl', mapping.scope.season, mapping.scope.externalLeagueId]), nativeId: team.externalRosterId };
          assertProviderReference(sourceTeam);
          const manager = (role: string, nativeId: string) => {
            const key = JSON.stringify([identity.id, role, nativeId]);
            const value = memberships.get(key);
            if (!value) throw new Error('Missing scoped manager identity.');
            memberships.delete(key);
            return value;
          };
          const sourceRefs = [id(row.receipt_id)];
          return { seasonTeamId: identity.id, sourceTeam,
            primaryOwner: team.primaryOwner.state === 'owned'
              ? { state: 'owned', manager: manager('owner', team.primaryOwner.externalManagerId) }
              : team.primaryOwner.state === 'unknown' && 'reason' in team.primaryOwner
                ? { state: 'unknown', manager: null, reason: team.primaryOwner.reason } : { state: 'unowned', manager: null },
            coManagers: team.coManagers.state === 'known' ? { state: 'known', completeness: 'complete', sourceRefs,
              observedAt: provenance.sourceObservedAt!, managers: team.coManagers.externalManagerIds.map(value => manager('co_owner', value)) }
              : team.coManagers.state === 'partial' ? { state: 'partial', completeness: 'partial', sourceRefs,
                observedAt: provenance.sourceObservedAt!, managers: team.coManagers.externalManagerIds.map(value => manager('co_owner', value)),
                reason: team.coManagers.reason }
              : { state: 'unknown', completeness: 'unknown', sourceRefs, observedAt: provenance.sourceObservedAt!,
                managers: null, reason: team.coManagers.reason },
            assurance: 'provider-observed', effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' };
        });
        if (memberships.size) throw new Error('Unevidenced manager membership.');
        const accepted: AcceptedResource = { scope, canonicalNormalizerVersion: policy.canonicalNormalizerVersion,
          sourceMappingRevisionId: mapping.revisionId, contentId: id(row.content_id), observationIds: [id(row.receipt_id)],
          validationVersion: policy.validationVersion, acceptedGeneration: integer(row.generation), verifiedAt: provenance.sourceObservedAt,
          effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' };
        assertAcceptedResource(accepted);
        const receipt: Extract<AcceptedTeamManagersRead, { status: 'available' }>['receipt'] = { id: id(row.receipt_id),
          attemptId: id(row.attempt_id), ordinal: integer(row.ordinal), provenance, configurationContentId: id(row.configuration_content_id),
          expectedTeamCount: integer(row.expected_team_count), legacyObservationId: id(row.legacy_observation_id) };
        return evidence ? { status: 'available', accepted, receipt, teams: teams as TeamManagerEvidenceRelationships[],
          evidenceCompleteness: projection.status, evidenceReasons: coverage.reasons }
          : { status: 'available', accepted, receipt, teams: teams as TeamManagerRelationships[] };
      } catch { return { status: 'unavailable', reason: 'team_manager_evidence_unavailable' }; }
    }
  return {
    beginRosterCapture: (mapping: AdministrationSourceMapping, playersId: string, managersId: string, fence?: AdministrationWriteFence) =>
      beginCapture(mapping, playersId, managersId, fence, false),
    beginRosterEvidenceCapture: (mapping: AdministrationSourceMapping, playersId: string, managersId: string, fence?: AdministrationWriteFence) =>
      beginCapture(mapping, playersId, managersId, fence, true),
    readAcceptedTeamManagers: (mapping: AdministrationSourceMapping) => readManagers(mapping, false),
    readAcceptedTeamManagerEvidence: (mapping: AdministrationSourceMapping) => readManagers(mapping, true),
  };
}
