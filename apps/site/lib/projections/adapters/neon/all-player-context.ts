import 'server-only';

import type { DatabaseClient } from '../../../database';
import type { ProjectionStore } from './contracts';
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
          mapping.mapping_status, mapping.valid_to::text
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
