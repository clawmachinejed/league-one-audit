import 'server-only';
import type { DatabaseClient } from '../database';
import type { LeagueAdministrationStore } from './store-contracts';
import { isAdministrationSourceMapping } from './source-mapping';
import { compatibleRevision } from '../projections/shared/revision-compatibility';

function receiptBound<T extends { status: string }>(resource: T, expected: unknown) {
  const accepted = 'accepted' in resource ? resource.accepted as { observationIds?: readonly string[] } : undefined;
  return resource.status !== 'available' ? resource : typeof expected === 'string' && accepted?.observationIds?.includes(expected)
    ? resource : { status: 'unavailable' as const, reason: 'intake-capture-not-current-head', retained: resource };
}

/** Backend-only stored read. No provider call, registration, calculation or write.
 * Discovery membership is public source evidence, never an ownership entitlement. */
export async function readPublicSleeperIntake(client: DatabaseClient, administration: LeagueAdministrationStore, requestId: string,
  options: Readonly<{ managerEvidenceVersion?: 'v2' }> = {}) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(requestId)) throw new Error('Invalid public intake identity.');
  const requests = await client.query(`/* public-data-intake:read-request */
    SELECT request.id,request.username AS requested_username,request.seasons,request.revision,request.terminal,
      request.failure_count,request.next_attempt_at,identity.source_manager_account_id,account.external_manager_id,
      identity.username,identity.display_name,identity.avatar_url,identity.request_started_at,identity.request_completed_at
    FROM public.public_data_intakes request
    LEFT JOIN public.public_data_identity_observations identity ON identity.intake_id=request.id
    LEFT JOIN public.league_source_manager_accounts account ON account.id=identity.source_manager_account_id AND account.provider='sleeper'
    WHERE request.id=$1::uuid`, [requestId]);
  if (requests.length !== 1) return { status: 'missing' } as const;
  const lists = await client.query(`/* public-data-intake:read-lists */
    SELECT season,request_started_at,request_completed_at FROM public.public_data_league_lists WHERE intake_id=$1::uuid ORDER BY season`, [requestId]);
  const candidates = await client.query(`/* public-data-intake:read-candidates */
    SELECT candidate.season,candidate.external_league_id,candidate.name,candidate.stage,candidate.league_season_id,
      candidate.league_observation_id,candidate.roster_observation_id,candidate.users_observation_id,
      candidate.settings_receipt_id,candidate.players_receipt_id,candidate.managers_receipt_id,
      CASE WHEN capture.id IS NOT NULL THEN jsonb_build_object('id',capture.id,'contentId',capture.content_id,
        'legacyObservationId',capture.legacy_observation_id,'sourceMapping',capture.source_mapping,
        'requestStartedAt',capture.request_started_at,'requestCompletedAt',capture.request_completed_at,
        'sourceObservedAt',capture.source_observed_at) END AS directory_capture
    FROM public.public_data_league_candidates candidate
    LEFT JOIN public.public_data_directory_captures capture ON capture.id=candidate.users_capture_id
      AND capture.intake_id=candidate.intake_id AND capture.league_season_id=candidate.league_season_id
      AND capture.legacy_observation_id=candidate.users_observation_id
    WHERE candidate.intake_id=$1::uuid ORDER BY candidate.season,candidate.external_league_id`, [requestId]);
  const rejected = await client.query(`/* public-data-intake:read-rejections */
    SELECT revision,resource,source_scope,request_started_at,request_completed_at,reason
    FROM public.public_data_rejections WHERE intake_id=$1::uuid ORDER BY revision`, [requestId]);
  const leagues = [];
  // Sequential bounded reads: at most twenty collected candidates. Retained excess
  // list members remain explicit capacity entries without fan-out or silent filtering.
  for (const candidate of candidates) {
    const identity = { provider: 'sleeper' as const, externalLeagueId: String(candidate.external_league_id), season: Number(candidate.season) };
    if (!candidate.league_season_id) {
      leagues.push({ ...identity, name: String(candidate.name), collection: String(candidate.stage), resources: null });
      continue;
    }
    try {
      const mapping = await administration.readSourceMapping(identity.externalLeagueId);
      if (!mapping || mapping.leagueSeasonId !== candidate.league_season_id || mapping.scope.season !== identity.season) {
        throw new Error('Stored source mapping changed.');
      }
      const [settings, teamManagers, heldRoster, directory, teamManagerEvidence] = await Promise.all([
        administration.readAcceptedLeagueSettings(mapping).catch(() => ({ status: 'unavailable' as const, reason: 'settings-read-failed' })),
        administration.readAcceptedTeamManagers(mapping).catch(() => ({ status: 'unavailable' as const, reason: 'team-managers-read-failed' })),
        administration.readAcceptedCurrentRoster(mapping, { includeSeasonOverview: true }).catch(() => ({ status: 'unavailable' as const, reason: 'held-roster-read-failed' })),
        administration.readSource({ ...mapping.scope, family: 'users', week: null }).catch(() => ({ status: 'unavailable' as const, reason: 'directory-read-failed' })),
        options.managerEvidenceVersion === 'v2'
          ? administration.readAcceptedTeamManagerEvidence?.(mapping).catch(() => ({ status: 'unavailable' as const, reason: 'team-manager-evidence-read-failed' }))
            ?? { status: 'unavailable' as const, reason: 'team-manager-evidence-unsupported' } : undefined,
      ]);
      const acquisition = candidate.directory_capture && typeof candidate.directory_capture === 'object'
        ? candidate.directory_capture as Record<string, unknown> : null;
      const directoryCurrent = acquisition && isAdministrationSourceMapping(acquisition.sourceMapping) && compatibleRevision(acquisition.sourceMapping) === compatibleRevision(mapping);
      leagues.push({ ...identity, name: String(candidate.name), leagueSeasonId: mapping.leagueSeasonId,
        leagueKey: mapping.scope.leagueKey, collection: String(candidate.stage),
        resources: { settings: receiptBound(settings, candidate.settings_receipt_id),
          teamManagers: receiptBound(teamManagers, candidate.managers_receipt_id),
          // Latest scoped provider evidence may outlive a failed intake step. It is
          // explicitly not a receipt-bound completion claim for this request.
          ...(teamManagerEvidence ? { teamManagerEvidence: { ...teamManagerEvidence,
            captureBinding: 'latest-for-current-source-mapping' as const } } : {}),
          heldRoster: receiptBound(heldRoster, candidate.players_receipt_id),
          directory: directory.status === 'available'
            ? directory.observationId !== candidate.users_observation_id || !directoryCurrent
              ? { status: 'unavailable' as const, reason: 'intake-capture-not-current-head', retained: directory }
              : { ...directory, acquisition } : directory } });
    } catch {
      leagues.push({ ...identity, name: String(candidate.name), collection: String(candidate.stage),
        resources: null, reason: 'stored-source-unavailable' });
    }
  }
  const header = requests[0];
  const completeResources = leagues.every(league => league.collection === 'complete' && league.resources
    && league.resources.settings.status === 'available' && league.resources.teamManagers.status === 'available'
    && league.resources.heldRoster.status === 'available' && league.resources.directory.status === 'available');
  const allSeasons = Array.isArray(header.seasons) && lists.length === header.seasons.length;
  const status = !header.external_manager_id || !allSeasons ? header.terminal ? 'unavailable' : 'pending'
    : completeResources ? 'available' : header.terminal ? 'partial' : 'pending';
  return { status, readAt: new Date().toISOString(), request: header, lists, leagues, rejected,
    freshness: 'Use each resource acceptance verifiedAt and each directory acquisition sourceObservedAt and list request_completed_at; this read does not refresh them.',
    coverage: { requested: ['identity', 'season-league-lists', 'league-settings', 'team-managers', 'held-rosters', 'manager-directory',
      ...(options.managerEvidenceVersion === 'v2' ? ['team-manager-evidence-v2'] : [])],
      notRequested: ['exact-matchups', 'official-results', 'transactions', 'drafts', 'playoff-brackets', 'annual-history'],
      note: 'Provider standings fields are retained with the roster; no derived rank or calculation is produced.' } } as const;
}
