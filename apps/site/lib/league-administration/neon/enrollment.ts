import type { DatabaseClient, DatabaseRow } from '../../database';
import type { AdministrationEnrollmentInventory, AdministrationEnrollmentResolution,
  AdministrationEnrollmentSelector } from '../store-contracts';

function requiredIdentity(row: DatabaseRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    // Without a stable membership identity the failure cannot safely be scoped.
    throw new Error('Administration enrollment identity is invalid.');
  }
  return value;
}
const validText = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()) && value === value.trim();

function resolution(row: DatabaseRow): AdministrationEnrollmentResolution {
  const intendedSeason = Number(row.intended_season);
  const intended = { leagueId: requiredIdentity(row, 'league_id'), leagueKey: requiredIdentity(row, 'league_key'),
    provider: typeof row.provider === 'string' ? row.provider : null,
    season: Number.isInteger(intendedSeason) && intendedSeason >= 1920 && intendedSeason <= 2200 ? intendedSeason : null };
  const unavailable = (reason: Extract<AdministrationEnrollmentResolution, { status: 'unavailable' }>['reason']) =>
    ({ status: 'unavailable' as const, intended, reason });
  if (intended.season === null) return unavailable('missing-intended-season');
  if (row.provider !== 'sleeper' || !validText(row.name)) return unavailable('invalid-registration');
  if (!validText(row.league_season_id) || Number(row.season) !== intended.season) return unavailable('unregistered-season');
  if (!validText(row.scoring_profile_id)) return unavailable('missing-scoring-profile');
  if (!validText(row.external_league_id)) return unavailable('missing-source-connection');
  return { status: 'ready', intended, enrollment: { leagueId: intended.leagueId, leagueKey: intended.leagueKey,
    leagueSeasonId: row.league_season_id, displayName: row.name, season: intended.season,
    provider: 'sleeper', externalLeagueId: row.external_league_id, scoringProfileId: row.scoring_profile_id } };
}

/** One read boundary, shared by strict publication, tolerant inventory and exact scoped reads. */
export async function readEnrollmentInventory(client: DatabaseClient, season?: number,
  selector?: AdministrationEnrollmentSelector): Promise<AdministrationEnrollmentInventory> {
  if (season !== undefined && (!Number.isInteger(season) || season < 1920 || season > 2200)) {
    throw new Error('Invalid administration enrollment season.');
  }
  const parameters: unknown[] = season === undefined ? [] : [season];
  let scope = '';
  if (selector) {
    const value = 'leagueKey' in selector ? selector.leagueKey : selector.externalLeagueId;
    if (!validText(value) || !('leagueKey' in selector) && selector.provider !== 'sleeper') {
      throw new Error('Invalid administration enrollment selector.');
    }
    parameters.push(value);
    scope = 'leagueKey' in selector ? ` AND league.league_key=$${parameters.length}`
      : ` AND connection.external_league_id=$${parameters.length} AND connection.provider='sleeper'`;
  }
  const rows = await client.query(season === undefined ? `/* league-administration:list-enrollments */
    SELECT league.id AS league_id,league.league_key,league.name,season.id AS league_season_id,
      intended.season AS intended_season,season.season,season.scoring_profile_id,enrollment.provider,connection.external_league_id
    FROM public.league_administration_enrollments enrollment
    JOIN public.leagues league ON league.id=enrollment.league_id
    LEFT JOIN LATERAL (SELECT candidate.season FROM public.league_administration_enrollment_seasons candidate
      WHERE candidate.league_id=league.id AND candidate.provider=enrollment.provider
      ORDER BY candidate.season DESC LIMIT 1) intended ON true
    LEFT JOIN public.league_seasons season ON season.league_id=league.id AND season.season=intended.season
    LEFT JOIN public.league_source_connections connection ON connection.league_season_id=season.id AND connection.provider=enrollment.provider
    WHERE enrollment.active${scope} ORDER BY league.league_key`
    : `/* league-administration:list-season-enrollments */
    SELECT league.id AS league_id,league.league_key,league.name,season.id AS league_season_id,
      membership.season AS intended_season,season.season,season.scoring_profile_id,membership.provider,connection.external_league_id
    FROM public.league_administration_enrollment_seasons membership
    JOIN public.leagues league ON league.id=membership.league_id
    LEFT JOIN public.league_seasons season ON season.league_id=membership.league_id AND season.season=membership.season
    LEFT JOIN public.league_source_connections connection ON connection.league_season_id=season.id AND connection.provider=membership.provider
    WHERE membership.season=$1${scope} ORDER BY league.league_key`, parameters);
  const entries = rows.map(resolution);
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const keys = [`key:${entry.intended.leagueKey}`, `id:${entry.intended.leagueId}`,
      ...(entry.status === 'ready' ? [`source:${entry.enrollment.provider}:${entry.enrollment.externalLeagueId}`] : [])];
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { entries: entries.map(entry => {
    const ambiguous = (counts.get(`key:${entry.intended.leagueKey}`) ?? 0) > 1
      || (counts.get(`id:${entry.intended.leagueId}`) ?? 0) > 1
      || entry.status === 'ready' && (counts.get(`source:${entry.enrollment.provider}:${entry.enrollment.externalLeagueId}`) ?? 0) > 1;
    return ambiguous ? { status: 'unavailable', intended: entry.intended, reason: 'ambiguous-registration' } : entry;
  }) };
}
