import 'server-only';
import type { DatabaseClient } from '../../database';
import { CURRENT_ROSTER_POLICY, currentRosterScope } from '../../aggregator/current-roster';
import { ROSTER_PLAYER_LINK_VERSION, ROSTER_PLAYER_LINK_MAX_ROWS, ROSTER_PLAYER_LINK_MAX_TEAMS,
  ROSTER_PLAYER_LINK_MAX_BYTES, rosterCategoryEvidence, rosterPlayerKind,
  type RosterPlayerLink, type RosterPlayerLinksRead, type RosterPlayerLinksSelection,
  type RosterPlayerKindEvidence, type RosterPlayerMappingProof } from '../../aggregator/roster-player-links';
import { compatibleRevision } from '../../projections/shared/revision-compatibility';
import { normalizeAdministrationObservation } from '../normalize';
import { isAdministrationSourceMapping } from '../source-mapping';
import { isPlayerDirectoryNativeId } from '../player-directory';
import type { AdministrationEnvelope, JsonObject } from '../contracts';
import type { PlayerDirectoryVersion, PlayerDirectorySourceSlice } from '../player-directory-contracts';

/** Immutable receipt selection, with no current head, mapping or crosswalk dependency. */
export const ROSTER_PLAYER_LINK_READ_SQL = `/* league-administration:read-roster-player-links */
  SELECT linked.*,linked.resolved_at::text AS resolved_at,linked.mapping_evaluated_at::text AS mapping_evaluated_at,accepted.generation,scope.identity,scope.connection_id,receipt.provenance,receipt.coverage,
    receipt.expected_team_count,attempt.source_mapping,content.content_hash,content.payload,content.normalized_value,
    content.normalizer_version,content.completeness,content.provider,content.external_league_id,
    content.league_season_id AS content_league_season_id,
    coalesce(teams.rows,'[]'::jsonb) AS identities,coalesce(links.rows,'[]'::jsonb) AS links,
    CASE WHEN directory.id IS NULL THEN NULL ELSE jsonb_build_object('versionId',directory.id,
      'contentId',directory.content_id,'receiptId',capture.id,'attemptId',capture.attempt_id,
      'generation',directory.generation,'acceptedAt',directory.accepted_at,'sourceRevision',catalog.source_revision,
      'requestStartedAt',capture.request_started_at,'requestCompletedAt',capture.request_completed_at,
      'sourceObservedAt',capture.source_observed_at,'rowCount',catalog.row_count,
      'sourceSlices',jsonb_build_array(jsonb_build_object('scope',slice.scope,'endpoint',slice.endpoint,
        'status',slice.status,'sourceRevision',slice.source_revision,'observedAt',slice.observed_at,
        'complete',slice.complete,'rowCount',slice.row_count,'validRowCount',slice.valid_row_count,
        'invalidRowCount',slice.invalid_row_count,'conflictRowCount',slice.conflict_row_count))) END AS directory
  FROM public.league_roster_player_link_receipts linked
  JOIN public.league_roster_resource_acceptances accepted ON accepted.id=linked.roster_acceptance_id
    AND accepted.receipt_id=linked.roster_receipt_id AND accepted.source_mapping_revision_id=linked.source_mapping_revision_id
  JOIN public.league_roster_resource_scopes scope ON scope.id=accepted.scope_id AND scope.league_season_id=linked.league_season_id
  JOIN public.league_roster_capture_receipts receipt ON receipt.id=linked.roster_receipt_id AND receipt.content_id=linked.roster_content_id
  JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id AND attempt.scope_id=scope.id
  JOIN public.league_administration_contents content ON content.id=linked.roster_content_id
    AND content.league_season_id=linked.league_season_id AND content.accepted AND content.family='rosters' AND content.week=0
  LEFT JOIN public.league_player_directory_versions directory ON directory.id=linked.directory_version_id
  LEFT JOIN public.league_player_directory_captures capture ON capture.id=directory.capture_id
    AND capture.content_id=directory.content_id AND capture.status='complete'
  LEFT JOIN public.league_player_directory_contents catalog ON catalog.id=directory.content_id
  LEFT JOIN public.league_player_directory_source_slices slice ON slice.capture_id=capture.id AND slice.complete
  LEFT JOIN LATERAL (SELECT jsonb_agg(selected.row ORDER BY selected.external_id COLLATE "C") AS rows FROM (
    SELECT team.external_roster_id AS external_id,jsonb_build_object('seasonTeamId',team.id,'externalRosterId',team.external_roster_id) AS row
    FROM public.league_administration_team_entries entry
    JOIN public.league_season_teams team ON team.id=entry.team_id AND team.league_season_id=entry.league_season_id
    WHERE entry.content_id=content.id AND entry.league_season_id=linked.league_season_id
      AND team.provider=content.provider AND team.external_league_id=content.external_league_id
    ORDER BY team.external_roster_id COLLATE "C" LIMIT 1001
  ) selected) teams ON true
  LEFT JOIN LATERAL (SELECT jsonb_agg(selected.row ORDER BY selected.team_id,selected.ordinal) AS rows FROM (
    SELECT item.season_team_id AS team_id,item.membership_ordinal AS ordinal,
      jsonb_build_object('seasonTeamId',item.season_team_id,'externalRosterId',item.external_roster_id,
        'nativePlayerId',item.native_player_id,'membershipOrdinal',item.membership_ordinal,'entityKind',item.entity_kind,
        'identityState',item.identity_state,'canonicalEntityId',item.canonical_entity_id,'reasons',item.reasons,
        'directoryIdentityStatus',item.directory_identity_status,'kindEvidence',item.kind_evidence,'mappingProof',item.mapping_proof) AS row
    FROM public.league_roster_player_links item WHERE item.roster_acceptance_id=linked.roster_acceptance_id
    ORDER BY item.season_team_id,item.membership_ordinal LIMIT 10001
  ) selected) links ON true
  WHERE linked.roster_receipt_id=$1::uuid AND linked.league_season_id=$2::uuid`;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid roster link object.');
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) throw new Error('Invalid roster link identity.');
  return value;
}
function integer(value: unknown, minimum = 0): number {
  const result = typeof value === 'number' || typeof value === 'string' && value !== '' ? Number(value) : NaN;
  if (!Number.isSafeInteger(result) || result < minimum) throw new Error('Invalid roster link count.');
  return result;
}
/** PostgreSQL proof times retain microseconds and original spelling. Date objects
 * would already have lost precision; scalar columns are explicitly selected as text. */
function timestamp(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid roster link timestamp.');
  instantMicros(value);
  return value;
}
function instantMicros(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::\d{2})?)$/u.exec(value);
  if (!match) throw new Error('Invalid precise roster link timestamp.');
  const local = `${match[1]}T${match[2]}`;
  const localEpoch = Date.parse(`${local}.000Z`);
  const zone = match[4].length === 3 ? `${match[4]}:00` : match[4];
  const epoch = Date.parse(`${local}.000${zone}`);
  if (!Number.isFinite(epoch) || !Number.isFinite(localEpoch) || new Date(localEpoch).toISOString().slice(0, 19) !== local) {
    throw new Error('Invalid precise roster link calendar instant.');
  }
  return BigInt(epoch) * 1_000n + BigInt((match[3] ?? '').padEnd(6, '0'));
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32 || value.some(item => typeof item !== 'string')
    || new Set(value).size !== value.length) throw new Error('Invalid roster link reasons.');
  return value;
}
function directoryVersion(value: unknown, expectedId: unknown): PlayerDirectoryVersion | null {
  if (expectedId === null && value === null) return null;
  const row = object(value);
  const versionId = uuid(row.versionId), rowCount = integer(row.rowCount, 1);
  const sourceObservedAt = timestamp(row.sourceObservedAt);
  if (versionId !== uuid(expectedId) || rowCount > 100_000 || typeof row.sourceRevision !== 'string'
    || !/^sha256:[0-9a-f]{64}$/u.test(row.sourceRevision) || !Array.isArray(row.sourceSlices) || row.sourceSlices.length !== 1) {
    throw new Error('Invalid roster link directory.');
  }
  const slice = object(row.sourceSlices[0]);
  const normalizedSlice = { ...slice, observedAt: timestamp(slice.observedAt) };
  if (compatibleRevision(normalizedSlice) !== compatibleRevision({ scope: 'all', endpoint: '/players/nfl', status: 'available',
    sourceRevision: row.sourceRevision, observedAt: sourceObservedAt, complete: true, rowCount, validRowCount: rowCount,
    invalidRowCount: 0, conflictRowCount: 0 })) throw new Error('Invalid roster link directory slice.');
  const requestStartedAt = timestamp(row.requestStartedAt), requestCompletedAt = timestamp(row.requestCompletedAt);
  if (instantMicros(requestStartedAt) > instantMicros(requestCompletedAt) || instantMicros(requestCompletedAt) !== instantMicros(sourceObservedAt)) throw new Error('Invalid directory observation order.');
  return { versionId, contentId: uuid(row.contentId), receiptId: uuid(row.receiptId), attemptId: uuid(row.attemptId),
    generation: integer(row.generation, 1), acceptedAt: timestamp(row.acceptedAt), sourceRevision: row.sourceRevision,
    requestStartedAt, requestCompletedAt, sourceObservedAt, rowCount, sourceSlices: [normalizedSlice as PlayerDirectorySourceSlice] };
}
function kindEvidence(value: unknown): RosterPlayerKindEvidence | null {
  if (value === null) return null;
  const row = object(value);
  for (const [field, state] of [['position', 'positionState'], ['fantasyPositions', 'fantasyPositionsState']] as const) {
    if (!['missing', 'null', 'supplied', 'invalid'].includes(String(row[state]))
      || (row[state] === 'supplied' ? field === 'position' ? typeof row[field] !== 'string'
        : !Array.isArray(row[field]) || row[field].some(item => typeof item !== 'string') : row[field] !== null)) {
      throw new Error('Invalid roster link kind evidence.');
    }
  }
  return row as RosterPlayerKindEvidence;
}
function mappingProof(value: unknown, nativeId: string): readonly RosterPlayerMappingProof[] {
  if (!Array.isArray(value) || value.length > 2) throw new Error('Invalid roster mapping proof.');
  const result = value.map(input => {
    const row = object(input);
    if (row.provider !== 'sleeper' || row.externalId !== nativeId
      || !['player', 'team_defense'].includes(String(row.entityKind)) || !['player', 'team_defense'].includes(String(row.canonicalKind))
      || !['verified', 'unverified', 'retired'].includes(String(row.mappingStatus))) throw new Error('Invalid roster mapping identity.');
    const validFrom = timestamp(row.validFrom), validTo = row.validTo === null ? null : timestamp(row.validTo);
    if (validTo !== null && instantMicros(validFrom) >= instantMicros(validTo)) throw new Error('Invalid roster mapping interval.');
    return { ...row, scoringEntityId: uuid(row.scoringEntityId), validFrom, validTo } as RosterPlayerMappingProof;
  });
  if (new Set(result.map(proof => proof.entityKind)).size !== result.length) throw new Error('Duplicate roster mapping kind.');
  return result;
}
const linkReasons = new Set(['directory_unavailable', 'directory_player_missing', 'directory_identity_invalid', 'directory_identity_conflict',
  'roster_source_scope_conflict', 'native_player_id_invalid', 'vacancy_marker_not_player', 'kind_unavailable', 'kind_conflict', 'canonical_kind_conflict',
  'canonical_mapping_unverified', 'canonical_mapping_retired', 'canonical_mapping_not_yet_valid', 'canonical_mapping_expired', 'canonical_identity_conflict']);
function linkRow(value: unknown, directory: PlayerDirectoryVersion | null, evaluatedAt: string): RosterPlayerLink {
  const row = object(value);
  if (typeof row.nativePlayerId !== 'string' || typeof row.externalRosterId !== 'string'
    || !['resolved', 'unresolved', 'conflict'].includes(String(row.identityState))
    || !['valid', 'invalid', 'conflict', 'missing'].includes(String(row.directoryIdentityStatus))
    || row.entityKind !== null && !['player', 'team_defense'].includes(String(row.entityKind))) throw new Error('Invalid roster link state.');
  const reasons = strings(row.reasons);
  if (reasons.some(reason => !linkReasons.has(reason))) throw new Error('Invalid roster link reason.');
  const kind = kindEvidence(row.kindEvidence), proof = mappingProof(row.mappingProof, row.nativePlayerId);
  const canonicalEntityId = row.canonicalEntityId === null ? null : uuid(row.canonicalEntityId);
  if (row.identityState === 'resolved') {
    const mapping = proof[0];
    if (!directory || row.directoryIdentityStatus !== 'valid' || !kind || kind.positionState === 'invalid' || kind.fantasyPositionsState === 'invalid'
      || rosterPlayerKind(kind).entityKind !== row.entityKind
      || !isPlayerDirectoryNativeId(row.nativePlayerId) || row.nativePlayerId === '0' || reasons.length || !canonicalEntityId
      || proof.length !== 1 || mapping.entityKind !== row.entityKind || mapping.canonicalKind !== row.entityKind
      || mapping.scoringEntityId !== canonicalEntityId || mapping.mappingStatus !== 'verified'
      || instantMicros(mapping.validFrom) > instantMicros(evaluatedAt) || mapping.validTo !== null && instantMicros(mapping.validTo) <= instantMicros(evaluatedAt)) {
      throw new Error('Invalid resolved roster identity proof.');
    }
  } else if (canonicalEntityId !== null || reasons.length === 0) throw new Error('Missing unresolved identity proof.');
  return { seasonTeamId: uuid(row.seasonTeamId), externalRosterId: row.externalRosterId, nativePlayerId: row.nativePlayerId,
    membershipOrdinal: integer(row.membershipOrdinal, 1), entityKind: row.entityKind as RosterPlayerLink['entityKind'],
    identityState: row.identityState as RosterPlayerLink['identityState'], canonicalEntityId, reasons,
    directoryIdentityStatus: row.directoryIdentityStatus as RosterPlayerLink['directoryIdentityStatus'], kindEvidence: kind, mappingProof: proof };
}

export function rosterPlayerLinkMethods(client: DatabaseClient) {
  return {
    async readRosterPlayerLinks(selection: RosterPlayerLinksSelection): Promise<RosterPlayerLinksRead> {
      try {
        const receiptId = uuid(selection.rosterReceiptId), leagueSeasonId = uuid(selection.leagueSeasonId);
        const rows = await client.query(ROSTER_PLAYER_LINK_READ_SQL, [receiptId, leagueSeasonId]);
        if (rows.length === 0) return { status: 'missing', reason: 'roster_player_links_not_recorded' };
        if (rows.length !== 1 || Buffer.byteLength(JSON.stringify(rows[0]), 'utf8') > ROSTER_PLAYER_LINK_MAX_BYTES) throw new Error('Invalid roster link snapshot size.');
        const row = rows[0], mapping = row.source_mapping;
        if (!isAdministrationSourceMapping(mapping) || mapping.leagueSeasonId !== leagueSeasonId
          || row.league_season_id !== leagueSeasonId || row.content_league_season_id !== leagueSeasonId
          || row.roster_receipt_id !== receiptId || row.source_mapping_revision_id !== mapping.revisionId
          || row.connection_id !== mapping.connectionId || row.provider !== 'sleeper'
          || row.external_league_id !== mapping.scope.externalLeagueId || row.link_version !== ROSTER_PLAYER_LINK_VERSION
          || compatibleRevision(row.identity) !== compatibleRevision({ scope: currentRosterScope(mapping), policy: CURRENT_ROSTER_POLICY })
          || row.normalizer_version !== 'sleeper-administration-v1' || row.completeness !== 'complete'
          || !Array.isArray(row.links) || row.links.length > ROSTER_PLAYER_LINK_MAX_ROWS
          || !Array.isArray(row.identities) || row.identities.length > ROSTER_PLAYER_LINK_MAX_TEAMS + 1) throw new Error('Invalid roster link lineage.');
        const counts = { teams: integer(row.team_count), held: integer(row.held_count), resolved: integer(row.resolved_count),
          unresolved: integer(row.unresolved_count), conflict: integer(row.conflict_count) };
        if (counts.resolved + counts.unresolved + counts.conflict !== counts.held) throw new Error('Invalid roster link partition.');
        if (!Array.isArray(row.payload) || row.payload.length !== counts.teams
          || row.payload.reduce((total: number, input: unknown) => {
            const native = object(input);
            if (!Array.isArray(native.players)) throw new Error('Missing source held-player list.');
            return total + native.players.length;
          }, 0) !== counts.held) throw new Error('Invalid declared source membership counts.');
        const reasons = strings(row.reasons);
        if (row.outcome === 'capacity_exceeded') {
          if (row.links.length || counts.resolved || counts.conflict || !reasons.includes('capacity_exceeded')) throw new Error('Invalid capacity snapshot.');
          return { status: 'capacity_exceeded', reason: 'roster_player_link_capacity_exceeded', rosterReceiptId: receiptId,
            counts: { teams: counts.teams, held: counts.held } };
        }
        if (row.outcome === 'owner_unqualified') {
          if (row.links.length || counts.resolved || counts.conflict || !reasons.includes('owner_unqualified')) throw new Error('Invalid owner snapshot.');
          return { status: 'unavailable', reason: 'roster_player_link_owner_unqualified' };
        }
        if (!['complete', 'partial'].includes(String(row.outcome)) || counts.teams > ROSTER_PLAYER_LINK_MAX_TEAMS
          || counts.held > ROSTER_PLAYER_LINK_MAX_ROWS || row.links.length !== counts.held || row.identities.length !== counts.teams
          || compatibleRevision(row.coverage) !== compatibleRevision({ periodIds: [], interval: null, entitySet: 'full', fields: ['players'],
            pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] })) throw new Error('Incomplete roster link snapshot.');
        const rosterSource = object(row.provenance) as AdministrationEnvelope['provenance'];
        const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
          dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'rosters', week: null, completeness: 'complete',
          provenance: rosterSource, payload: row.payload as AdministrationEnvelope['payload'] }, { expectedRosterCount: integer(row.expected_team_count, 1) });
        if (normalized.status !== 'accepted' || normalized.value?.family !== 'rosters' || rosterSource.origin !== 'network'
          || rosterSource.requestStartedAt === null || rosterSource.requestCompletedAt === null || rosterSource.sourceObservedAt === null
          || normalized.contentHash !== row.content_hash || compatibleRevision(normalized.value) !== compatibleRevision(row.normalized_value)
          || normalized.value.teams.length !== counts.teams || !Array.isArray(row.payload)) throw new Error('Invalid captured roster content.');
        const mappingEvaluatedAt = timestamp(row.mapping_evaluated_at), resolvedAt = timestamp(row.resolved_at);
        if (instantMicros(mappingEvaluatedAt) > instantMicros(resolvedAt)) throw new Error('Invalid roster resolution time.');
        const directory = directoryVersion(row.directory, row.directory_version_id);
        const links = row.links.map(value => linkRow(value, directory, mappingEvaluatedAt));
        if (links.filter(link => link.identityState === 'resolved').length !== counts.resolved
          || links.filter(link => link.identityState === 'unresolved').length !== counts.unresolved
          || links.filter(link => link.identityState === 'conflict').length !== counts.conflict
          || (row.outcome === 'complete') !== (counts.resolved === counts.held)
          || compatibleRevision(reasons) !== compatibleRevision(row.outcome === 'complete' ? [] : ['unresolved_player_links'])) throw new Error('Invalid link outcome.');
        const identities = new Map<string, string>();
        for (const input of row.identities) {
          const identity = object(input);
          if (typeof identity.externalRosterId !== 'string' || identities.has(identity.externalRosterId)) throw new Error('Duplicate roster team.');
          identities.set(identity.externalRosterId, uuid(identity.seasonTeamId));
        }
        if (new Set(identities.values()).size !== counts.teams) throw new Error('Duplicate canonical roster team.');
        const rawTeams = new Map((row.payload as JsonObject[]).map(raw => [String(raw.roster_id), raw]));
        const byTeam = new Map<string, RosterPlayerLink[]>();
        for (const link of links) { const list = byTeam.get(link.seasonTeamId) ?? []; list.push(link); byTeam.set(link.seasonTeamId, list); }
        const teams = normalized.value.teams.map(team => {
          const seasonTeamId = identities.get(team.externalRosterId), raw = rawTeams.get(team.externalRosterId);
          if (!seasonTeamId || !raw || team.playerExternalIds === null) throw new Error('Missing source team.');
          const heldLinks = byTeam.get(seasonTeamId) ?? [];
          if (heldLinks.length !== team.playerExternalIds.length) throw new Error('Incomplete team links.');
          heldLinks.forEach((link, index) => {
            if (link.externalRosterId !== team.externalRosterId || link.membershipOrdinal !== index + 1
              || link.nativePlayerId !== team.playerExternalIds![index]) throw new Error('Foreign player link.');
          });
          byTeam.delete(seasonTeamId);
          return { seasonTeamId, externalRosterId: team.externalRosterId, categories: {
            players: rosterCategoryEvidence(raw, 'players'), starters: rosterCategoryEvidence(raw, 'starters'),
            reserve: rosterCategoryEvidence(raw, 'reserve'), taxi: rosterCategoryEvidence(raw, 'taxi') } };
        });
        if (byTeam.size) throw new Error('Extra linked team.');
        return { status: 'available', version: ROSTER_PLAYER_LINK_VERSION, provider: 'sleeper', nativeNamespace: 'nfl', directoryNamespace: 'nfl:players',
          rosterAcceptanceId: uuid(row.roster_acceptance_id),
          rosterReceiptId: receiptId, rosterContentId: uuid(row.roster_content_id), mapping, rosterSource,
          resolvedAt, mappingEvaluatedAt, directory, outcome: row.outcome as 'complete' | 'partial', reasons, counts, teams, links };
      } catch { return { status: 'unavailable', reason: 'roster_player_link_evidence_unavailable' }; }
    },
  };
}
