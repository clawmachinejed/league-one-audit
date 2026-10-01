/** Synthetic B4 retained sources; no runtime module imports this fixture. */
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import type { AdministrationFamily, JsonValue } from '../league-administration/contracts';
import type { AdministrationReadInput, LeagueAdministrationStoreRead } from '../league-administration/store-contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { projectRetainedRoster } from './roster-bridge';
import type { BundleFourReadInput } from './bundle-four';

const uuid = (value: number) => `00000000-0000-4000-9000-${String(value).padStart(12, '0')}`;
export const b4SourceKey = (input: AdministrationReadInput) => `${input.externalLeagueId}:${input.family}:${input.week ?? 0}`;
export function b4Fixture() {
  const now = new Date('2026-09-30T12:00:30.000Z');
  const mapping = (season: number): AdministrationSourceMapping => ({ connectionId: uuid(season * 10),
    revisionId: uuid(season * 10 + 1), leagueSeasonId: uuid(season * 10 + 2), generation: 1,
    scope: { leagueKey: 'league2', provider: 'sleeper', externalLeagueId: `99000${season}`, season } });
  const current = mapping(2026), previous = mapping(2025);
  const mappings = new Map([current, previous].map(value => [value.scope.externalLeagueId, value]));
  const reads = new Map<string, LeagueAdministrationStoreRead>();
  let sequence = 100;
  function source(mapping: AdministrationSourceMapping, family: AdministrationFamily, payload: JsonValue,
    week: number | null = null, at = mapping.scope.season === 2026 ? '2026-09-30T12:00:00.000Z' : '2026-01-01T12:00:00.000Z') {
    const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope,
      family, week, payload, completeness: 'complete', provenance: { origin: 'network', requestStartedAt: at,
        requestCompletedAt: at, checkedAt: at, sourceObservedAt: at } });
    if (normalized.status !== 'accepted') throw new Error(`Invalid B4 fixture: ${JSON.stringify(normalized.diagnostics)}`);
    const base = { status: 'available' as const, envelope: normalized.envelope, observationId: uuid(sequence++),
      versionId: family === 'league' ? uuid(sequence++) : null, generation: 1, checkedAt: at, verifiedAt: at };
    const read: Extract<LeagueAdministrationStoreRead, { status: 'available' }> = family === 'rosters'
      ? { ...base, commonRoster: projectRetainedRoster(base, { league_season_id: mapping.leagueSeasonId,
        content_id: uuid(sequence++), content_hash: normalized.contentHash, observation_checked_at: at,
        source_mapping_revision_id: mapping.revisionId, source_connection_id: mapping.connectionId,
        source_mapping_generation: mapping.generation, mapping_league_season_id: mapping.leagueSeasonId,
        mapping_provider: 'sleeper', mapping_external_league_id: mapping.scope.externalLeagueId,
        roster_team_identities: [1, 2].map(id => ({ externalRosterId: String(id), seasonTeamId: uuid(mapping.scope.season * 100 + id) })),
      }, normalized) } : base;
    reads.set(b4SourceKey({ ...mapping.scope, family, week }), read);
    return read;
  }
  const leaguePayload = (mapping: AdministrationSourceMapping): JsonValue => ({ league_id: mapping.scope.externalLeagueId,
    season: String(mapping.scope.season), previous_league_id: mapping.scope.season === 2026 ? previous.scope.externalLeagueId : null,
    name: 'Synthetic history', sport: 'nfl', season_type: 'regular', status: mapping.scope.season === 2026 ? 'pre_draft' : 'complete', total_rosters: 2,
    roster_positions: ['QB', 'BN'], scoring_settings: { rec: 0.5 },
    settings: { playoff_week_start: 3, start_week: 1, best_ball: 0, league_average_match: 0 } });
  const rosters = (season: number): JsonValue => [1, 2].map(id => ({ roster_id: id,
    owner_id: id === 1 ? (season === 2026 ? 'current-owner' : 'previous-owner') : 'same-owner', co_owners: [],
    players: [`player-${id}`], starters: [`player-${id}`], reserve: [], taxi: [],
    settings: { wins: 99, losses: 99, ties: 99, fpts: 9999, fpts_against: 9999 } }));
  for (const item of [current, previous]) {
    source(item, 'league', leaguePayload(item)); source(item, 'rosters', rosters(item.scope.season));
    source(item, 'users', [{ user_id: item === current ? 'current-owner' : 'previous-owner', display_name: 'Same name' },
      { user_id: 'same-owner', display_name: 'Returning manager' }]);
  }
  source(previous, 'matchups', [{ roster_id: 1, matchup_id: 1, points: 1.004 }, { roster_id: 2, matchup_id: 1, points: 1.003 }], 1);
  source(previous, 'matchups', [{ roster_id: 1, matchup_id: 2, points: -2, custom_points: 0 }, { roster_id: 2, matchup_id: 2, points: 0 }], 2);
  const request: BundleFourReadInput = { expectedMapping: current, now, calendar: null,
    context: { defaultSeason: 2026, defaultWeek: 1, activeSeason: null, activeWeek: null,
      lifecycle: 'preseason', nflPhase: 'preseason', temporalState: 'future', refreshDue: false } };
  return { current, previous, mappings, reads, source, leaguePayload, rosters, request };
}
