import 'server-only';
import type { Database } from '../../database';

/** Narrow onboarding extension of the existing registry; no direct table grants. */
export function createAccountEnrollmentMethods(database: Database) {
  return {
    async assertSourceIdentity(key: string, externalId: string) {
      if (!database.enabled) throw new Error('Enrollment storage unavailable.');
      const rows = await database.query(`SELECT league.league_key FROM public.league_source_connections connection
        JOIN public.league_seasons season ON season.id=connection.league_season_id
        JOIN public.leagues league ON league.id=season.league_id
        WHERE connection.provider='sleeper' AND connection.external_league_id=$1`, [externalId]);
      if (rows.some(row => row.league_key !== key)) throw new Error('This source already has a different permanent league identity.');
    },
    async prepare(leagueId: string, season: number, externalId: string) {
      if (!database.enabled) throw new Error('Enrollment storage unavailable.');
      await database.query('SELECT public.prepare_account_league_enrollment($1::uuid,$2::integer,$3::text)',
        [leagueId, season, externalId]);
    },
    async activate(key: string, season: number, externalId: string) {
      if (!database.enabled) throw new Error('Enrollment storage unavailable.');
      await database.query('SELECT public.activate_account_league_enrollment($1::text,$2::integer,$3::text)', [key, season, externalId]);
    },
  };
}
