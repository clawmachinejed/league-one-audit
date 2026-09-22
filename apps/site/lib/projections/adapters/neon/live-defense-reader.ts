import 'server-only';

import type { DatabaseClient } from '../../../database';
import { DEFENSE_PROJECTION_MODEL_VERSION, NFL_TEAM_CODES, type LeaguePeriod, type NflTeam } from '../../domain/contracts';
import type { LiveDefenseStatCapture } from '../../ports/live-defense-stat-source';
import { validateLiveDefenseEvidence } from './live-defense-evidence';
import { json } from './database-values';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseCapture(value: unknown, period: LeaguePeriod, now: number): LiveDefenseStatCapture | null {
  try { validateLiveDefenseEvidence(value, period.week, period.season); } catch { return null; }
  if (!object(value) || value.status !== 'available' || !Array.isArray(value.entries)
    || value.entries.length === 0 || value.entries.length > NFL_TEAM_CODES.length
    || typeof value.sourceRevision !== 'string' || value.sourceRevision.length > 1024) return null;
  const times = [value.requestStartedAt, value.requestCompletedAt, value.observedAt] as string[];
  if (!Number.isFinite(now) || times.some((time) => Date.parse(time) < now - 90_000 || Date.parse(time) > now)) return null;
  const entries: { team: NflTeam; stats: Record<string, number> }[] = [];
  for (const entry of value.entries) {
    if (!object(entry) || typeof entry.team !== 'string' || !NFL_TEAM_CODES.includes(entry.team as NflTeam)
      || !object(entry.stats) || entries.some((existing) => existing.team === entry.team)
      || Object.entries(entry.stats).some(([stat, count]) => !/^[a-z][a-z0-9_]{0,63}$/u.test(stat)
        || typeof count !== 'number' || !Number.isFinite(count))) return null;
    entries.push({ team: entry.team as NflTeam, stats: { ...entry.stats } as Record<string, number> });
  }
  return { period, sourceRevision: value.sourceRevision, requestStartedAt: times[0],
    requestCompletedAt: times[1], observedAt: times[2], entries };
}

/** Reuses an immutable compact or hourly defense observation at its original age. */
export function createLiveDefenseReadMethods(client: DatabaseClient) {
  return {
    async readLiveDefenseStatCapture(period: LeaguePeriod): Promise<LiveDefenseStatCapture | null> {
      if (!Number.isInteger(period.season) || period.season < 2026 || period.season > 2200
        || period.seasonType !== 'regular' || !Number.isInteger(period.week) || period.week < 1 || period.week > 18) return null;
      const rows = await client.query(`/* projection-store:read-live-defense-stat-capture */
        WITH enrolled AS (
        SELECT season.id
        FROM league_seasons season
        JOIN league_administration_enrollment_seasons enrollment
          ON enrollment.league_id = season.league_id AND enrollment.season = season.season
          AND enrollment.provider = 'sleeper'
        JOIN league_administration_enrollments membership
          ON membership.league_id = season.league_id AND membership.provider = 'sleeper' AND membership.active
        WHERE season.season = $1::smallint
        ), compact AS (
          SELECT recent.evidence, 'compact' AS source_kind
          FROM enrolled season JOIN LATERAL (
          SELECT observation.source_data -> 'liveDefense' AS evidence
          FROM league_week_observations observation
          WHERE observation.league_season_id = season.id AND observation.provider = 'sleeper'
            AND observation.week = $2::smallint AND observation.quality IN ('complete','partial')
            AND observation.observed_at BETWEEN clock_timestamp() - interval '90 seconds' AND clock_timestamp()
            AND observation.source_data #>> '{liveDefense,status}' = 'available'
          ORDER BY observation.observed_at DESC, observation.request_completed_at DESC,
            observation.created_at DESC, observation.id DESC
          LIMIT 1
        ) recent ON true
        ), latest_hourly AS (
          SELECT observation.*
          FROM all_player_stat_observations observation
          JOIN all_player_stat_contents content ON content.id = observation.all_player_stat_content_id
            AND content.provider = observation.provider AND content.season = observation.season
            AND content.season_type = observation.season_type AND content.week = observation.week
            AND content.normalizer_version = observation.normalizer_version AND content.quality = observation.quality
          WHERE observation.provider = 'sleeper' AND observation.season = $1::smallint
            AND observation.season_type = 'reg' AND observation.week = $2::smallint
            AND observation.normalizer_version = 'sleeper-weekly-stats-v4'
            AND observation.quality IN ('complete', 'partial') AND EXISTS (SELECT 1 FROM enrolled)
            AND observation.request_started_at BETWEEN clock_timestamp() - interval '90 seconds' AND clock_timestamp()
            AND observation.request_completed_at BETWEEN clock_timestamp() - interval '90 seconds' AND clock_timestamp()
            AND observation.observed_at BETWEEN clock_timestamp() - interval '90 seconds' AND clock_timestamp()
            AND observation.request_started_at <= observation.observed_at
            AND observation.observed_at <= observation.request_completed_at
          ORDER BY observation.observed_at DESC, observation.request_completed_at DESC,
            observation.created_at DESC, observation.id DESC LIMIT 1
        ), hourly AS (
          SELECT jsonb_build_object(
            'version', $4::text, 'status', 'available',
            'period', jsonb_build_object('season', $1::integer, 'seasonType', 'regular', 'week', $2::integer),
            'sourceRevision', observation.source_revision,
            'requestStartedAt', to_char(observation.request_started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'requestCompletedAt', to_char(observation.request_completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'observedAt', to_char(observation.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'entries', COALESCE((SELECT jsonb_agg(jsonb_build_object('team', entry.provider_external_id, 'stats', entry.stats)
              ORDER BY entry.provider_external_id)
              FROM all_player_stat_entries entry
              WHERE entry.all_player_stat_content_id = observation.all_player_stat_content_id
                AND entry.entity_kind = 'team_defense' AND entry.position = 'DEF'
                AND entry.provider_external_id = entry.nfl_team AND entry.provider_external_id = ANY($3::text[])
                AND entry.eligibility_evidence ->> 'kind' = 'weekly-stat'
                AND entry.eligibility_evidence ->> 'source' = 'weekly-stat-provider'
            ), '[]'::jsonb)
          ) AS evidence, 'hourly' AS source_kind FROM latest_hourly observation
        )
        SELECT evidence, source_kind, EXTRACT(EPOCH FROM clock_timestamp()) * 1000 AS database_now_ms
        FROM (SELECT * FROM compact UNION ALL SELECT * FROM hourly) captures`, [
        period.season, period.week, NFL_TEAM_CODES, DEFENSE_PROJECTION_MODEL_VERSION,
      ]);
      const captures = rows.flatMap((row) => {
        const now = typeof row.database_now_ms === 'number' || typeof row.database_now_ms === 'string'
          ? Number(row.database_now_ms) : NaN;
        const capture = parseCapture(row.evidence, period, now);
        return capture ? [{ capture, hourly: row.source_kind === 'hourly' }] : [];
      }).sort((left, right) => Date.parse(right.capture.requestCompletedAt) - Date.parse(left.capture.requestCompletedAt));
      const newest = captures[0]?.capture;
      if (!newest) return null;
      // One envelope represents exactly one original retrieval. Never combine
      // older team stats under a newer capture's revision or freshness time.
      const identity = (capture: LiveDefenseStatCapture) => json({
        sourceRevision: capture.sourceRevision, requestStartedAt: capture.requestStartedAt,
        requestCompletedAt: capture.requestCompletedAt, observedAt: capture.observedAt,
      });
      const newestIdentity = identity(newest);
      if (captures.some(({ capture }) => capture.requestCompletedAt === newest.requestCompletedAt
        && identity(capture) !== newestIdentity)) return null;
      const sameRetrieval = captures.filter(({ capture }) => identity(capture) === newestIdentity);
      // Hourly rows contain the full defense record, whereas compact rows retain
      // scoring fields only. Prefer that intact envelope; never mix envelopes
      // or interpret compact-field omission as a conflicting source statistic.
      const hourly = sameRetrieval.find((candidate) => candidate.hourly);
      if (hourly) return hourly.capture;
      const entries = new Map<NflTeam, LiveDefenseStatCapture['entries'][number]>();
      for (const { capture } of sameRetrieval) {
        for (const entry of capture.entries) {
          const previous = entries.get(entry.team);
          if (previous && json(previous.stats) !== json(entry.stats)) return null;
          entries.set(entry.team, entry);
        }
      }
      return { ...newest, entries: [...entries.values()].sort((left, right) => left.team.localeCompare(right.team)) };
    },
  };
}
