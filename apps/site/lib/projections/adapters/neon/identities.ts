import 'server-only';

import type { DatabaseClient } from '../../../database';
import type { ProjectionStore } from './contracts';
import {
  deterministicUuid,
  json,
  provider,
  requiredText,
  rowBoolean,
  rowNullableText,
  rowText,
  rulesHash,
} from './database-values';

type IdentityMethods = Pick<ProjectionStore,
  | 'registerLeagueSeason'
  | 'upsertScoringEntities'
  | 'upsertNflGames'
>;

export function createIdentityMethods(client: DatabaseClient): IdentityMethods {
  return {
    async registerLeagueSeason(input) {
      const scoringRulesHash = rulesHash(input.scoringRules);
      const rows = await client.query(`/* projection-store:register-league-season */
        WITH profile AS (
          INSERT INTO scoring_profiles (rules_hash, rules)
          VALUES ($1, $2::jsonb)
          ON CONFLICT (rules_hash) DO UPDATE SET rules = scoring_profiles.rules
          RETURNING id
        ), league AS (
          INSERT INTO leagues (league_key, name)
          VALUES ($3, $4)
          ON CONFLICT (league_key) DO UPDATE
          SET name = EXCLUDED.name, updated_at = now()
          RETURNING id
        ), season AS (
          INSERT INTO league_seasons (league_id, season, scoring_profile_id)
          SELECT league.id, $5, profile.id FROM league CROSS JOIN profile
          ON CONFLICT (league_id, season) DO UPDATE
          SET updated_at = now()
          WHERE league_seasons.scoring_profile_id = EXCLUDED.scoring_profile_id
          RETURNING id, league_id, scoring_profile_id
        ), connection AS (
          INSERT INTO league_source_connections
            (league_season_id, provider, external_league_id)
          SELECT season.id, 'sleeper', $6 FROM season
          ON CONFLICT (league_season_id, provider) DO UPDATE
          SET external_league_id = EXCLUDED.external_league_id, connected_at = now()
          RETURNING league_season_id
        )
        SELECT season.league_id, season.id AS league_season_id, season.scoring_profile_id
        FROM season JOIN connection ON connection.league_season_id = season.id`, [
        scoringRulesHash,
        json(input.scoringRules),
        requiredText(input.leagueKey, 'League key'),
        requiredText(input.leagueName, 'League name'),
        input.season,
        requiredText(input.sleeperLeagueId, 'Sleeper league ID'),
      ]);
      const row = rows[0];
      if (!row) {
        const existing = await client.query(`/* projection-store:read-league-season-profile */
          SELECT season.id AS league_season_id, profile.rules_hash
          FROM leagues league
          JOIN league_seasons season ON season.league_id = league.id AND season.season = $2
          JOIN scoring_profiles profile ON profile.id = season.scoring_profile_id
          WHERE league.league_key = $1`, [
          requiredText(input.leagueKey, 'League key'), input.season,
        ]);
        if (existing[0] && rowText(existing[0], 'rules_hash') !== scoringRulesHash) {
          throw new Error(
            'Scoring rules are immutable for an existing league season; register a new season for revised rules.',
          );
        }
        throw new Error('League season registration did not return a row.');
      }
      return {
        kind: 'stored',
        value: {
          leagueId: rowText(row, 'league_id'),
          leagueSeasonId: rowText(row, 'league_season_id'),
          scoringProfileId: rowText(row, 'scoring_profile_id'),
        },
      };
    },

    async upsertScoringEntities(inputs) {
      if (inputs.length === 0) return { kind: 'stored', value: [] };

      const inputKeys = new Set<string>();
      const providerKeys = new Set<string>();
      for (const input of inputs) {
        const key = requiredText(input.key, 'Scoring entity key');
        if (inputKeys.has(key)) throw new Error(`Duplicate scoring entity key: ${key}`);
        inputKeys.add(key);
        for (const identity of input.providerIds) {
          const providerKey = `${provider(identity.provider)}\0${input.kind}\0${requiredText(identity.externalId, 'External scoring entity ID')}`;
          if (providerKeys.has(providerKey)) throw new Error('A provider identifier was assigned more than once.');
          providerKeys.add(providerKey);
        }
      }

      const prepared = inputs.map((input, ordinal) => ({
        ordinal,
        proposed_id: deterministicUuid(
          `scoring-entity:${input.kind}`,
          requiredText(input.key, 'Scoring entity key'),
        ),
        input_key: requiredText(input.key, 'Scoring entity key'),
        kind: input.kind,
        display_name: requiredText(input.displayName, 'Scoring entity display name'),
        nfl_team: input.nflTeam?.trim() || null,
        provider_ids: input.providerIds.map((identity) => ({
          provider: provider(identity.provider),
          external_id: requiredText(identity.externalId, 'External scoring entity ID'),
        })),
      }));
      if (prepared.some((item) => item.provider_ids.length === 0)) {
        throw new Error('Every scoring entity needs at least one provider identifier.');
      }

      await client.query(`/* projection-store:upsert-scoring-entities */
        WITH input AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
            ordinal integer, proposed_id uuid, input_key text, kind text,
            display_name text, nfl_team text, provider_ids jsonb
          )
        ), expanded AS (
          SELECT input.*, ids.provider, ids.external_id
          FROM input
          CROSS JOIN LATERAL jsonb_to_recordset(input.provider_ids) AS ids(
            provider text, external_id text
          )
        ), existing AS (
          SELECT expanded.ordinal,
            COALESCE(array_agg(DISTINCT mapping.scoring_entity_id)
              FILTER (WHERE mapping.scoring_entity_id IS NOT NULL), '{}'::uuid[]) AS entity_ids
          FROM expanded
          LEFT JOIN external_scoring_entity_ids mapping
            ON mapping.provider = expanded.provider
            AND mapping.entity_kind = expanded.kind
            AND mapping.external_id = expanded.external_id
          GROUP BY expanded.ordinal
        ), targets AS (
          SELECT input.*,
            CASE
              WHEN cardinality(existing.entity_ids) = 1 THEN existing.entity_ids[1]
              ELSE input.proposed_id
            END AS target_id,
            cardinality(existing.entity_ids) > 1 AS conflict
          FROM input JOIN existing USING (ordinal)
        ), upserted_entities AS (
          INSERT INTO scoring_entities (id, kind, display_name, nfl_team)
          SELECT DISTINCT ON (target_id) target_id, kind, display_name, nfl_team
          FROM targets WHERE NOT conflict
          ORDER BY target_id, ordinal
          ON CONFLICT (id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            nfl_team = EXCLUDED.nfl_team,
            updated_at = now()
          RETURNING id
        ), inserted_mappings AS (
          INSERT INTO external_scoring_entity_ids
            (provider, entity_kind, external_id, scoring_entity_id)
          SELECT expanded.provider, expanded.kind, expanded.external_id, targets.target_id
          FROM expanded
          JOIN targets USING (ordinal)
          JOIN upserted_entities ON upserted_entities.id = targets.target_id
          WHERE NOT targets.conflict
          ON CONFLICT (provider, entity_kind, external_id) DO NOTHING
          RETURNING scoring_entity_id
        )
        SELECT count(*) AS mappings_written FROM inserted_mappings`, [json(prepared)]);

      // A fresh statement obtains a post-conflict snapshot. This closes the
      // READ COMMITTED first-writer race inherent in INSERT ... DO NOTHING CTEs.
      const rows = await client.query(`/* projection-store:resolve-scoring-entities */
        WITH input AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
            ordinal integer, proposed_id uuid, input_key text, kind text,
            display_name text, nfl_team text, provider_ids jsonb
          )
        ), expanded AS (
          SELECT input.ordinal, input.input_key, input.proposed_id,
            ids.provider, input.kind, ids.external_id
          FROM input
          CROSS JOIN LATERAL jsonb_to_recordset(input.provider_ids) AS ids(
            provider text, external_id text
          )
        ), resolved AS (
          SELECT expanded.ordinal, expanded.input_key, expanded.proposed_id,
            COALESCE(array_agg(DISTINCT mapping.scoring_entity_id)
              FILTER (WHERE mapping.scoring_entity_id IS NOT NULL), '{}'::uuid[]) AS entity_ids
          FROM expanded
          LEFT JOIN external_scoring_entity_ids mapping
            ON mapping.provider = expanded.provider
            AND mapping.entity_kind = expanded.kind
            AND mapping.external_id = expanded.external_id
          GROUP BY expanded.ordinal, expanded.input_key, expanded.proposed_id
        )
        SELECT input_key,
          CASE WHEN cardinality(entity_ids) = 1 THEN entity_ids[1] END AS entity_id,
          cardinality(entity_ids) > 1 AS conflict,
          proposed_id
        FROM resolved ORDER BY ordinal`, [json(prepared)]);

      const proposedIdsToClean = rows
        .filter((row) => rowNullableText(row, 'entity_id') !== rowText(row, 'proposed_id'))
        .map((row) => rowText(row, 'proposed_id'));
      if (proposedIdsToClean.length > 0) {
        await client.query(`/* projection-store:clean-orphan-scoring-entities */
          DELETE FROM scoring_entities entity
          WHERE entity.id = ANY($1::uuid[])
            AND NOT EXISTS (
              SELECT 1 FROM external_scoring_entity_ids mapping
              WHERE mapping.scoring_entity_id = entity.id
            )`, [proposedIdsToClean]);
      }

      return {
        kind: 'stored',
        value: rows.map((row) => ({
          key: rowText(row, 'input_key'),
          entityId: rowBoolean(row, 'conflict') ? null : rowNullableText(row, 'entity_id'),
          conflict: rowBoolean(row, 'conflict'),
        })),
      };
    },

    async upsertNflGames(inputs) {
      if (inputs.length === 0) return { kind: 'stored', value: [] };
      const providerGameKeys = new Set<string>();
      const scheduleKeys = new Set<string>();
      for (const input of inputs) {
        const providerGameKey = `${provider(input.provider)}\0${requiredText(input.externalGameId, 'External NFL game ID')}`;
        const scheduleKey = `${input.season}\0${input.seasonType}\0${input.week}\0${input.homeTeam.toUpperCase()}\0${input.awayTeam.toUpperCase()}`;
        if (providerGameKeys.has(providerGameKey) || scheduleKeys.has(scheduleKey)) {
          throw new Error('NFL game identity inputs must be unique.');
        }
        providerGameKeys.add(providerGameKey);
        scheduleKeys.add(scheduleKey);
      }
      const prepared = inputs.map((input, ordinal) => ({
        ordinal,
        proposed_id: deterministicUuid(
          'nfl-game',
          `${provider(input.provider)}:${requiredText(input.externalGameId, 'External NFL game ID')}`,
        ),
        input_key: requiredText(input.key, 'NFL game key'),
        provider: provider(input.provider),
        external_game_id: requiredText(input.externalGameId, 'External NFL game ID'),
        season: input.season,
        season_type: input.seasonType,
        week: input.week,
        home_team: requiredText(input.homeTeam, 'Home team').toUpperCase(),
        away_team: requiredText(input.awayTeam, 'Away team').toUpperCase(),
        kickoff_at: input.kickoffAt,
      }));

      await client.query(`/* projection-store:upsert-nfl-games */
        WITH input AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
            ordinal integer, proposed_id uuid, input_key text, provider text,
            external_game_id text, season smallint, season_type text, week smallint,
            home_team text, away_team text, kickoff_at timestamptz
          )
        ), existing_mappings AS (
          SELECT input.ordinal, mapping.nfl_game_id
          FROM input
          JOIN external_game_ids mapping
            ON mapping.provider = input.provider
            AND mapping.external_game_id = input.external_game_id
        ), inserted_games AS (
          INSERT INTO nfl_games
            (id, season, season_type, week, home_team, away_team, kickoff_at)
          SELECT input.proposed_id, input.season, input.season_type, input.week,
            input.home_team, input.away_team, input.kickoff_at
          FROM input LEFT JOIN existing_mappings USING (ordinal)
          WHERE existing_mappings.nfl_game_id IS NULL
          ON CONFLICT (season, season_type, week, home_team, away_team) DO UPDATE
          SET kickoff_at = COALESCE(EXCLUDED.kickoff_at, nfl_games.kickoff_at),
              updated_at = now()
          RETURNING id, season, season_type, week, home_team, away_team
        ), targets AS (
          SELECT input.*,
            COALESCE(existing_mappings.nfl_game_id, inserted_games.id) AS target_id
          FROM input
          LEFT JOIN existing_mappings USING (ordinal)
          LEFT JOIN inserted_games
            ON inserted_games.season = input.season
            AND inserted_games.season_type = input.season_type
            AND inserted_games.week = input.week
            AND inserted_games.home_team = input.home_team
            AND inserted_games.away_team = input.away_team
        ), inserted_mappings AS (
          INSERT INTO external_game_ids (provider, external_game_id, nfl_game_id)
          SELECT provider, external_game_id, target_id FROM targets
          WHERE target_id IS NOT NULL
          ON CONFLICT (provider, external_game_id) DO NOTHING
          RETURNING nfl_game_id
        ), write_gate AS (
          SELECT count(*) FROM inserted_mappings
        )
        SELECT input_key, target_id AS game_id
        FROM targets CROSS JOIN write_gate
        WHERE target_id IS NOT NULL
        ORDER BY ordinal`, [json(prepared)]);

      const rows = await client.query(`/* projection-store:resolve-nfl-games */
        WITH input AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
            ordinal integer, proposed_id uuid, input_key text, provider text,
            external_game_id text, season smallint, season_type text, week smallint,
            home_team text, away_team text, kickoff_at timestamptz
          )
        )
        SELECT input.input_key, input.proposed_id,
          mapping.nfl_game_id AS mapped_game_id,
          natural_game.id AS natural_game_id,
          COALESCE(mapping.nfl_game_id, natural_game.id) AS game_id,
          (
            mapped_game.id IS NOT NULL AND (
              mapped_game.season IS DISTINCT FROM input.season
              OR mapped_game.season_type IS DISTINCT FROM input.season_type
              OR mapped_game.week IS DISTINCT FROM input.week
              OR mapped_game.home_team IS DISTINCT FROM input.home_team
              OR mapped_game.away_team IS DISTINCT FROM input.away_team
            )
          ) OR (
            mapping.nfl_game_id IS NOT NULL AND natural_game.id IS NOT NULL
            AND mapping.nfl_game_id <> natural_game.id
          ) AS conflict
        FROM input
        LEFT JOIN external_game_ids mapping
          ON mapping.provider = input.provider
          AND mapping.external_game_id = input.external_game_id
        LEFT JOIN nfl_games mapped_game ON mapped_game.id = mapping.nfl_game_id
        LEFT JOIN nfl_games natural_game
          ON natural_game.season = input.season
          AND natural_game.season_type = input.season_type
          AND natural_game.week = input.week
          AND natural_game.home_team = input.home_team
          AND natural_game.away_team = input.away_team
        ORDER BY input.ordinal`, [json(prepared)]);

      const proposedIdsToClean = rows
        .filter((row) => rowNullableText(row, 'game_id') !== rowText(row, 'proposed_id'))
        .map((row) => rowText(row, 'proposed_id'));
      if (proposedIdsToClean.length > 0) {
        await client.query(`/* projection-store:clean-orphan-nfl-games */
          DELETE FROM nfl_games game
          WHERE game.id = ANY($1::uuid[])
            AND NOT EXISTS (SELECT 1 FROM external_game_ids source WHERE source.nfl_game_id = game.id)
            AND NOT EXISTS (SELECT 1 FROM game_state_observations state WHERE state.nfl_game_id = game.id)
            AND NOT EXISTS (SELECT 1 FROM pregame_projection_candidates candidate WHERE candidate.nfl_game_id = game.id)
            AND NOT EXISTS (SELECT 1 FROM pregame_projection_baselines baseline WHERE baseline.nfl_game_id = game.id)
            AND NOT EXISTS (SELECT 1 FROM league_week_expected_games expected WHERE expected.nfl_game_id = game.id)`,
        [proposedIdsToClean]);
      }
      if (rows.some((row) => rowBoolean(row, 'conflict'))) {
        throw new Error('An external NFL game ID conflicts with its scheduled game identity.');
      }
      if (rows.some((row) => !rowNullableText(row, 'game_id'))) {
        throw new Error('NFL game identity resolution did not return every game.');
      }

      return {
        kind: 'stored',
        value: rows.map((row) => ({ key: rowText(row, 'input_key'), gameId: rowText(row, 'game_id') })),
      };
    },

  };
}
