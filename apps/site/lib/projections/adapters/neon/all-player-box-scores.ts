import 'server-only';

import type { DatabaseClient } from '../../../database';
import {
  MATCHUP_BOX_SCORE_STAT_KEYS,
  type AllPlayerBoxScoreReadInput,
  type StoredAllPlayerBoxScores,
} from '../../../matchup-box-score-types';
import { isNflTeam } from '../../../nfl-teams';
import { rowObject, rowText } from './database-values';

const statKeys = new Set<string>(MATCHUP_BOX_SCORE_STAT_KEYS);
const unavailable = (): StoredAllPlayerBoxScores => ({
  status: 'unavailable', observedAt: null, revision: null, players: {},
});

function identityKey(kind: string, id: string): string {
  if (typeof id !== 'string') throw new Error('Invalid box-score identity.');
  if (kind === 'player' && /^[1-9]\d{0,19}$/u.test(id)) return `player:${id}`;
  if (kind === 'team_defense' && isNflTeam(id)) return `defense:${id}`;
  throw new Error('Invalid box-score identity.');
}

export function createAllPlayerBoxScoreMethods(client: DatabaseClient) {
  return {
    async readAllPlayerBoxScores(input: AllPlayerBoxScoreReadInput): Promise<StoredAllPlayerBoxScores> {
      if (!Number.isInteger(input.season) || input.season < 1920 || input.season > 2200
        || !Number.isInteger(input.week) || input.week < 1 || input.week > 18
        || !Array.isArray(input.identities) || input.identities.length > 512) {
        throw new Error('Invalid box-score period or inventory.');
      }
      const requested = new Map(input.identities.map((identity) => [
        identityKey(identity.entityKind, identity.providerExternalId), identity,
      ]));
      if (requested.size === 0) return unavailable();
      const identities = [...requested.values()].sort((left, right) => (
        identityKey(left.entityKind, left.providerExternalId)
          .localeCompare(identityKey(right.entityKind, right.providerExternalId))
      ));
      const rows = await client.query(`/* projection-store:read-all-player-box-scores */
        WITH latest AS (
          SELECT observation.all_player_stat_content_id, observation.observed_at,
            content.semantic_hash
          FROM all_player_stat_observations observation
          JOIN all_player_stat_contents content
            ON content.id = observation.all_player_stat_content_id
            AND content.provider = observation.provider AND content.season = observation.season
            AND content.season_type = observation.season_type AND content.week = observation.week
            AND content.normalizer_version = observation.normalizer_version
          WHERE observation.provider = 'sleeper' AND observation.season = $1::smallint
            AND observation.season_type = 'reg' AND observation.week = $2::smallint
            AND observation.quality IN ('complete', 'partial')
            AND content.quality = observation.quality
            AND observation.normalizer_version IN (
              'sleeper-weekly-stats-v2', 'sleeper-weekly-stats-v3', 'sleeper-weekly-stats-v4'
            )
          ORDER BY observation.observed_at DESC, observation.request_completed_at DESC,
            observation.created_at DESC, observation.id DESC
          LIMIT 1
        ), requested AS (
          SELECT * FROM jsonb_to_recordset($3::jsonb)
            AS identity(entity_kind text, provider_external_id text)
        )
        SELECT latest.observed_at::text, latest.semantic_hash,
          entry.entity_kind, entry.provider_external_id, entry.game_phase,
          COALESCE((
            SELECT jsonb_object_agg(stat.key, stat.value)
            FROM jsonb_each(entry.stats) stat
            WHERE stat.key = ANY($4::text[]) AND jsonb_typeof(stat.value) = 'number'
          ), '{}'::jsonb) AS stats
        FROM latest
        LEFT JOIN all_player_stat_entries entry
          ON entry.all_player_stat_content_id = latest.all_player_stat_content_id
          AND EXISTS (
            SELECT 1 FROM requested
            WHERE requested.entity_kind = entry.entity_kind
              AND requested.provider_external_id = entry.provider_external_id
          )
        ORDER BY entry.entity_kind, entry.provider_external_id`, [
        input.season, input.week,
        JSON.stringify(identities.map((identity) => ({
          entity_kind: identity.entityKind, provider_external_id: identity.providerExternalId,
        }))),
        MATCHUP_BOX_SCORE_STAT_KEYS,
      ]);
      if (rows.length === 0) return unavailable();
      const observedAt = new Date(rowText(rows[0], 'observed_at')).toISOString();
      const revision = rowText(rows[0], 'semantic_hash');
      if (!/^[a-f0-9]{64}$/u.test(revision)) throw new Error('Invalid box-score source revision.');
      const players: StoredAllPlayerBoxScores['players'] = {};
      const returned = new Set<string>();
      for (const row of rows) {
        if (new Date(rowText(row, 'observed_at')).toISOString() !== observedAt
          || rowText(row, 'semantic_hash') !== revision) {
          throw new Error('Box-score sources disagree.');
        }
        if (row.provider_external_id === null && row.entity_kind === null && rows.length === 1) continue;
        const key = identityKey(rowText(row, 'entity_kind'), rowText(row, 'provider_external_id'));
        if (!requested.has(key) || returned.has(key)) throw new Error('Box-score identities disagree.');
        returned.add(key);
        const phase = rowText(row, 'game_phase');
        if (!['live', 'final', 'unknown'].includes(phase)) throw new Error('Invalid box-score game phase.');
        const stats = Object.fromEntries(Object.entries(rowObject(row, 'stats')).flatMap(([stat, value]) => (
          statKeys.has(stat) && typeof value === 'number' && Number.isFinite(value) ? [[stat, value]] : []
        )));
        // An empty or rank-only/missing source record is not an observed zero box score.
        if (Object.keys(stats).length > 0) players[key] = { stats, gamePhase: phase };
      }
      return { status: 'available', observedAt, revision, players };
    },
  };
}
