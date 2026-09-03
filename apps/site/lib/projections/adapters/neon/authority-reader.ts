import 'server-only';
import type { DatabaseClient } from '../../../database';
import type { ProjectionStore, StoredLeagueAuthorityRead } from './contracts';
import { requiredText, rowNumber, rowText } from './database-values';
import { authorityFromRow } from './period-values';
import { authorityLineupShapeFromRow } from './period-shape';
import { normalizePeriodCadenceTiming } from './period-cadence-values';

/** One database statement gives every league the same authority read boundary. */
export function createAuthorityReadMethods(client: DatabaseClient): Pick<ProjectionStore, 'readLeagueLineupAuthorities'> {
  return {
    async readLeagueLineupAuthorities(leagueKeys): Promise<readonly StoredLeagueAuthorityRead[]> {
      const keys = [...new Set(leagueKeys.map((key) => requiredText(key, 'League key')))];
      if (!keys.length) return [];
      const rows = await client.query(`/* projection-store:read-league-lineup-authorities */
        SELECT league_key, default_season, default_season_type, default_week,
          active_season, active_season_type, active_week, league_lifecycle,
          nfl_phase, source_provider, source_revision, source_observed_at::text,
          verified_at::text AS period_verified_at, source_external_league_id,
          expected_roster_count, expected_starter_slot_count, expected_roster_ids,
          authority_generation, default_period_cadence
        FROM league_period_authorities
        WHERE league_key = ANY($1::text[])
        ORDER BY league_key`, [keys]);
      const byKey = new Map(rows.map((row) => [rowText(row, 'league_key'), row]));
      return keys.map((leagueKey): StoredLeagueAuthorityRead => {
        const row = byKey.get(leagueKey);
        if (!row) return { kind: 'missing', leagueKey };
        try {
          const authorityGeneration = rowNumber(row, 'authority_generation');
          if (!Number.isSafeInteger(authorityGeneration) || authorityGeneration < 1) {
            throw new Error('Authority generation is invalid.');
          }
          return { kind: 'available', leagueKey, authority: {
            ...authorityFromRow(row),
            lineupShape: authorityLineupShapeFromRow(row),
            defaultPeriodCadence: normalizePeriodCadenceTiming(row.default_period_cadence),
            authorityGeneration,
          } };
        } catch {
          // One damaged row must not disable unrelated healthy leagues.
          return { kind: 'malformed', leagueKey };
        }
      });
    },
  };
}
