import 'server-only';
import type { DatabaseClient } from '../database';
import type { LeagueAdministrationStore } from './store-contracts';

/** Backend-only stored read. No provider call, registration, calculation or write.
 * Discovery membership is public source evidence, never an ownership entitlement. */
export async function readPublicSleeperIntake(client: DatabaseClient, administration: LeagueAdministrationStore, requestId: string) {
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
    SELECT season,external_league_id,name,stage,league_season_id,league_observation_id,roster_observation_id,users_observation_id
    FROM public.public_data_league_candidates WHERE intake_id=$1::uuid ORDER BY season,external_league_id`, [requestId]);
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
      const [settings, teamManagers, heldRoster, directory] = await Promise.all([
        administration.readAcceptedLeagueSettings(mapping).catch(() => ({ status: 'unavailable' as const, reason: 'settings-read-failed' })),
        administration.readAcceptedTeamManagers(mapping).catch(() => ({ status: 'unavailable' as const, reason: 'team-managers-read-failed' })),
        administration.readAcceptedCurrentRoster(mapping, { includeSeasonOverview: true }).catch(() => ({ status: 'unavailable' as const, reason: 'held-roster-read-failed' })),
        administration.readSource({ ...mapping.scope, family: 'users', week: null }).catch(() => ({ status: 'unavailable' as const, reason: 'directory-read-failed' })),
      ]);
      leagues.push({ ...identity, name: String(candidate.name), leagueSeasonId: mapping.leagueSeasonId,
        leagueKey: mapping.scope.leagueKey, collection: String(candidate.stage),
        resources: { settings, teamManagers, heldRoster, directory } });
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
    freshness: 'Use each resource acceptance verifiedAt and each list request_completed_at; this read does not refresh them.',
    coverage: { requested: ['identity', 'season-league-lists', 'league-settings', 'team-managers', 'held-rosters', 'manager-directory'],
      notRequested: ['exact-matchups', 'official-results', 'transactions', 'drafts', 'playoff-brackets', 'annual-history'],
      note: 'Provider standings fields are retained with the roster; no derived rank or calculation is produced.' } } as const;
}
