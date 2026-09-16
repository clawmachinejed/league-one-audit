import 'server-only';

import type { DatabaseClient } from '../../../database';
import type { ProjectionStore } from './contracts';
import { canonicalNflTeam } from '../../../nfl-teams';
import {
  json,
  provider,
  requiredText,
  rowNullableText,
  rowObject,
  rowText,
} from './database-values';

type AllPlayerContextMethods = Pick<ProjectionStore,
  | 'readAllPlayerLeagueProfiles'
  | 'readAllPlayerIdentityMappings'
  | 'readAllPlayerGameContext'
  | 'readAllPlayerHistoricalTeamContexts'
  | 'readDatabaseIdentity'
>;

function season(value: number): number {
  if (!Number.isInteger(value) || value < 1920 || value > 2200) {
    throw new Error('All-player context season is invalid.');
  }
  return value;
}

function week(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 18) {
    throw new Error('All-player context week is invalid.');
  }
  return value;
}

export function createAllPlayerContextMethods(
  client: DatabaseClient,
): AllPlayerContextMethods {
  return {
    async readAllPlayerLeagueProfiles(input) {
      const normalizedProvider = provider(input.provider);
      const normalizedSeason = season(input.season);
      const keys = new Set<string>();
      const externalIds = new Set<string>();
      const leagues = input.leagues.map((league, ordinal) => {
        const leagueKey = requiredText(league.leagueKey, 'All-player league key');
        const externalLeagueId = requiredText(
          league.externalLeagueId,
          'All-player external league ID',
        );
        const rulesHash = requiredText(league.rulesHash, 'All-player rules hash');
        if (!/^[0-9a-f]{64}$/u.test(rulesHash)
          || keys.has(leagueKey) || externalIds.has(externalLeagueId)) {
          throw new Error('All-player league profile inputs are invalid or duplicated.');
        }
        keys.add(leagueKey);
        externalIds.add(externalLeagueId);
        return {
          ordinal,
          league_key: leagueKey,
          external_league_id: externalLeagueId,
          rules_hash: rulesHash,
        };
      });
      if (leagues.length === 0) return [];
      const rows = await client.query(`/* projection-store:read-all-player-league-profiles */
        WITH input AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
            ordinal integer, league_key text, external_league_id text, rules_hash text
          )
        )
        SELECT input.league_key, season.id AS league_season_id,
          profile.id AS scoring_profile_id, profile.rules_hash, profile.rules
        FROM input
        JOIN leagues league ON league.league_key = input.league_key
        JOIN league_seasons season
          ON season.league_id = league.id AND season.season = $2::smallint
        JOIN scoring_profiles profile
          ON profile.id = season.scoring_profile_id
          AND profile.rules_hash = input.rules_hash
        JOIN league_source_connections connection
          ON connection.league_season_id = season.id
          AND connection.provider = $3
          AND connection.external_league_id = input.external_league_id
        ORDER BY input.ordinal`, [json(leagues), normalizedSeason, normalizedProvider]);
      return rows.map((row) => ({
        leagueKey: rowText(row, 'league_key'),
        leagueSeasonId: rowText(row, 'league_season_id'),
        scoringProfileId: rowText(row, 'scoring_profile_id'),
        rulesHash: rowText(row, 'rules_hash'),
        rules: rowObject(row, 'rules'),
      }));
    },

    async readAllPlayerIdentityMappings(inputs) {
      const keys = new Set<string>();
      const prepared = inputs.map((input, ordinal) => {
        const normalizedProvider = provider(input.provider);
        const externalId = requiredText(input.externalId, 'All-player external entity ID');
        if (!['player', 'team_defense'].includes(input.entityKind)) {
          throw new Error('All-player identity kind is invalid.');
        }
        const key = `${normalizedProvider}\0${input.entityKind}\0${externalId}`;
        if (keys.has(key)) throw new Error('All-player identity lookup is duplicated.');
        keys.add(key);
        return {
          ordinal,
          provider: normalizedProvider,
          entity_kind: input.entityKind,
          external_id: externalId,
        };
      });
      if (prepared.length === 0) return [];
      const rows = await client.query(`/* projection-store:read-all-player-identity-mappings */
        WITH input AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
            ordinal integer, provider text, entity_kind text, external_id text
          )
        )
        SELECT input.provider, input.entity_kind, input.external_id,
          mapping.scoring_entity_id, entity.kind AS mapped_entity_kind,
          mapping.mapping_status, mapping.valid_from::text, mapping.valid_to::text
        FROM input
        LEFT JOIN external_scoring_entity_ids mapping
          ON mapping.provider = input.provider
          AND mapping.entity_kind = input.entity_kind
          AND mapping.external_id = input.external_id
        LEFT JOIN scoring_entities entity ON entity.id = mapping.scoring_entity_id
        ORDER BY input.ordinal`, [json(prepared)]);
      return rows.map((row) => ({
        provider: rowText(row, 'provider'),
        entityKind: rowText(row, 'entity_kind') as 'player' | 'team_defense',
        externalId: rowText(row, 'external_id'),
        scoringEntityId: rowNullableText(row, 'scoring_entity_id'),
        mappedEntityKind: rowNullableText(row, 'mapped_entity_kind') as
          | 'player' | 'team_defense' | null,
        mappingStatus: rowNullableText(row, 'mapping_status') as
          | 'verified' | 'unverified' | 'retired' | null,
        validTo: rowNullableText(row, 'valid_to'),
        validFrom: rowNullableText(row, 'valid_from'),
      }));
    },

    async readAllPlayerGameContext(input) {
      const rows = await client.query(`/* projection-store:read-all-player-game-context */
        SELECT game.id AS nfl_game_id, game.home_team, game.away_team,
          game.kickoff_at::text,
          CASE
            WHEN latest.status_code = 2 THEN 'final'
            WHEN latest.status_code IN (1, 4) THEN 'live'
            ELSE 'unknown'
          END AS phase
        FROM nfl_games game
        LEFT JOIN LATERAL (
          SELECT observation.status_code
          FROM game_state_observations observation
          WHERE observation.nfl_game_id = game.id
            AND observation.provider = $4
          ORDER BY observation.observed_at DESC,
            observation.request_completed_at DESC,
            observation.created_at DESC,
            observation.id DESC
          LIMIT 1
        ) latest ON true
        WHERE game.season = $1::smallint
          AND game.season_type = $2
          AND game.week = $3::smallint
        ORDER BY game.home_team, game.away_team`, [
        season(input.season), input.seasonType, week(input.week),
        provider(input.gameStateProvider),
      ]);
      return rows.map((row) => ({
        nflGameId: rowText(row, 'nfl_game_id'),
        homeTeam: rowText(row, 'home_team'),
        awayTeam: rowText(row, 'away_team'),
        kickoffAt: rowNullableText(row, 'kickoff_at'),
        phase: rowText(row, 'phase') as 'live' | 'final' | 'unknown',
      }));
    },

    async readAllPlayerHistoricalTeamContexts(input) {
      const normalizedProvider = provider(input.provider);
      const normalizedSeason = season(input.season);
      const normalizedWeek = week(input.week);
      if (input.seasonType !== 'reg') throw new Error('All-player history period is invalid.');
      const rows = await client.query(`/* projection-store:read-all-player-historical-team-contexts */
        WITH accepted AS MATERIALIZED (
          SELECT observation.id, observation.all_player_stat_content_id,
            observation.observed_at, content.coverage
          FROM all_player_stat_observations observation
          JOIN all_player_stat_contents content ON content.id=observation.all_player_stat_content_id
          WHERE observation.provider=$1 AND observation.season=$2::smallint
            AND observation.season_type=$3 AND observation.week=$4::smallint
            AND observation.quality IN ('partial','complete')
            AND content.quality IN ('partial','complete')
        ), conflicts AS (
          SELECT DISTINCT key AS provider_external_id
          FROM accepted CROSS JOIN LATERAL jsonb_object_keys(CASE
            WHEN jsonb_typeof(coverage->'periodTeamContextConflicts')='object'
              THEN coverage->'periodTeamContextConflicts' ELSE '{}'::jsonb END) key
        ), earliest AS (
          SELECT DISTINCT ON (entry.provider_external_id,entry.nfl_team)
            entry.provider_external_id,entry.nfl_team,accepted.id AS source_observation_id,
            accepted.observed_at
          FROM accepted JOIN all_player_stat_entries entry
            ON entry.all_player_stat_content_id=accepted.all_player_stat_content_id
          WHERE entry.entity_kind='player' AND entry.nfl_team IS NOT NULL
          ORDER BY entry.provider_external_id,entry.nfl_team,accepted.observed_at,accepted.id
        )
        SELECT earliest.provider_external_id,earliest.nfl_team,earliest.source_observation_id,
          earliest.observed_at::text AS observed_at,
          conflicts.provider_external_id IS NOT NULL AS has_unresolved_conflict
        FROM earliest LEFT JOIN conflicts USING (provider_external_id)
        ORDER BY provider_external_id,nfl_team LIMIT 10001`,
      [normalizedProvider, normalizedSeason, input.seasonType, normalizedWeek]);
      if (rows.length > 10_000) throw new Error('All-player historical team context exceeds its bound.');
      return rows.map((row) => {
        const nflTeam = rowText(row, 'nfl_team');
        const observedAt = new Date(rowText(row, 'observed_at')).toISOString();
        const sourceObservationId = rowText(row, 'source_observation_id');
        const externalId = rowText(row, 'provider_external_id');
        if (canonicalNflTeam(nflTeam) !== nflTeam || typeof row.has_unresolved_conflict !== 'boolean'
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(sourceObservationId)) {
          throw new Error('All-player historical team context is invalid.');
        }
        return { providerExternalId: externalId, nflTeam, sourceObservationId, observedAt,
          effectivePeriod: { season: normalizedSeason, seasonType: 'reg' as const, week: normalizedWeek },
          hasUnresolvedConflict: row.has_unresolved_conflict };
      });
    },

    async readDatabaseIdentity() {
      const rows = await client.query(`/* projection-store:read-database-identity */
        SELECT current_database() AS database_name, current_user AS role_name`);
      const row = rows[0];
      if (!row) throw new Error('Database identity is unavailable.');
      return {
        databaseName: rowText(row, 'database_name'),
        roleName: rowText(row, 'role_name'),
      };
    },
  };
}
