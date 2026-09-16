import type { DatabaseClient } from '../lib/database';
import { rulesHash } from '../lib/projections/adapters/neon/database-values';

/** Explicit owner setup only. Runtime registration must never enroll a league. */
export async function enrollIntegrationSeason(
  ownerQuery: DatabaseClient['query'], leagueKeys: readonly string[], season: number,
) {
  await ownerQuery(`INSERT INTO league_administration_enrollments
    (league_id,provider,evidence)
    SELECT id,'sleeper','isolated fixture owner approval' FROM leagues WHERE league_key=ANY($1::text[])
    ON CONFLICT (league_id) DO NOTHING`, [leagueKeys]);
  // Membership deliberately does not join league_seasons: tests must detect
  // an intended member whose exact-season registration is missing.
  await ownerQuery(`INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence)
    SELECT id,$2::smallint,'sleeper','isolated fixture season approval' FROM leagues
    WHERE league_key=ANY($1::text[]) ON CONFLICT (league_id,season) DO NOTHING`, [leagueKeys, season]);
}

/** Synthetic historical seasons are explicitly evidenced by the fixture owner,
 * never inferred by runtime registration or the forward-only annual operator. */
export async function registerEnrolledIntegrationSeason(ownerQuery: DatabaseClient['query'], input: {
  leagueKey: string; season: number; sleeperLeagueId: string; scoringRules: Readonly<Record<string, number>>;
}) {
  await ownerQuery('INSERT INTO leagues(league_key,name) VALUES($1,$1) ON CONFLICT(league_key) DO NOTHING', [input.leagueKey]);
  const profile = await ownerQuery<{ id: string }>('SELECT public.get_or_create_scoring_profile($1,$2::jsonb)::text AS id',
    [rulesHash(input.scoringRules), JSON.stringify(input.scoringRules)]);
  const season = await ownerQuery<{ id: string; scoring_profile_id: string }>(`INSERT INTO league_seasons(league_id,season,scoring_profile_id)
    SELECT id,$2::smallint,$3::uuid FROM leagues WHERE league_key=$1
    ON CONFLICT (league_id,season) DO UPDATE SET scoring_profile_id=league_seasons.scoring_profile_id
    RETURNING id::text,scoring_profile_id::text`, [input.leagueKey, input.season, profile[0].id]);
  if (season.length !== 1 || season[0].scoring_profile_id !== profile[0].id) throw new Error('Synthetic season registration conflict.');
  await ownerQuery(`INSERT INTO league_source_connection_history(league_season_id,provider,external_league_id,evidence)
    SELECT $1::uuid,'sleeper',$2,'isolated fixture explicit historical connection'
    WHERE NOT EXISTS (SELECT 1 FROM league_source_connections WHERE league_season_id=$1::uuid AND provider='sleeper')`,
  [season[0].id, input.sleeperLeagueId]);
  await ownerQuery(`INSERT INTO league_source_connections(league_season_id,provider,external_league_id)
    VALUES ($1::uuid,'sleeper',$2) ON CONFLICT (league_season_id,provider) DO NOTHING`, [season[0].id, input.sleeperLeagueId]);
  const connection = await ownerQuery<{ external_league_id: string }>(`SELECT external_league_id FROM league_source_connections
    WHERE league_season_id=$1::uuid AND provider='sleeper'`, [season[0].id]);
  if (connection[0]?.external_league_id !== input.sleeperLeagueId) throw new Error('Synthetic source connection conflict.');
  await enrollIntegrationSeason(ownerQuery, [input.leagueKey], input.season);
  return { leagueSeasonId: season[0].id, scoringProfileId: profile[0].id };
}
