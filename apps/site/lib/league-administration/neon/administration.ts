import 'server-only';

import type { DatabaseClient, DatabaseRow } from '../../database';
import type { AdministrationEnvelope } from '../contracts';
import { normalizeAdministrationObservation } from '../normalize';
import type { AdministrationEnrollment, AdministrationReadInput, AdministrationWriteResult,
  LeagueAdministrationStore, LeagueAdministrationStoreRead } from '../store-contracts';

function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return object(JSON.parse(value));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid administration database result.');
  return value as Record<string, unknown>;
}

function text(row: DatabaseRow, key: string): string {
  if (typeof row[key] !== 'string' || !row[key]) throw new Error(`Missing administration ${key}.`);
  return row[key];
}

function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid administration timestamp.');
  return date.toISOString();
}

const sourceColumns = `league.league_key,season.season,connection.provider,connection.external_league_id,
  head.generation,head.checked_at,head.verified_at,head.read_conflict,observation.id AS observation_id,
  observation.origin,observation.request_started_at,observation.request_completed_at,observation.source_observed_at,
  content.configuration_version_id,content.normalizer_version,content.completeness,content.payload,
  content.external_league_id AS observed_external_league_id,content.family,content.week`;
const sourceJoins = `FROM public.leagues league
  JOIN public.league_seasons season ON season.league_id=league.id
  JOIN public.league_administration_enrollment_seasons enrollment ON enrollment.league_id=league.id AND enrollment.season=season.season
  JOIN public.league_source_connections connection ON connection.league_season_id=season.id AND connection.provider=enrollment.provider
  LEFT JOIN public.league_administration_heads head ON head.league_season_id=season.id AND head.family=$3 AND head.week=$4
  LEFT JOIN public.league_administration_observations observation ON observation.id=head.accepted_observation_id
  LEFT JOIN public.league_administration_contents content ON content.id=observation.content_id`;

function sourceResult(rows: readonly DatabaseRow[]): LeagueAdministrationStoreRead {
  if (rows.length === 0) return { status: 'missing' };
  if (rows.length !== 1) return { status: 'conflict', reason: 'ambiguous_source_connection' };
  const row = rows[0];
  if (row.read_conflict) return { status: 'conflict', reason: String(row.read_conflict) };
  if (!row.observation_id) return { status: 'missing' };
  if (row.observed_external_league_id !== row.external_league_id) return { status: 'conflict', reason: 'source_connection_mismatch' };
  const envelope: AdministrationEnvelope = {
    schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: { leagueKey: text(row, 'league_key'), provider: 'sleeper', externalLeagueId: text(row, 'external_league_id'), season: Number(row.season) },
    family: row.family as AdministrationEnvelope['family'],
    week: row.family === 'matchups' || row.family === 'transactions' ? Number(row.week) : null,
    completeness: 'complete', payload: row.payload as AdministrationEnvelope['payload'],
    provenance: { origin: row.origin as AdministrationEnvelope['provenance']['origin'],
      requestStartedAt: row.request_started_at ? timestamp(row.request_started_at) : null,
      requestCompletedAt: row.request_completed_at ? timestamp(row.request_completed_at) : null,
      sourceObservedAt: row.source_observed_at ? timestamp(row.source_observed_at) : null,
      checkedAt: timestamp(row.checked_at) },
  };
  if (row.normalizer_version !== envelope.normalizerVersion || row.completeness !== 'complete'
    || !Number.isSafeInteger(Number(row.generation)) || Number(row.generation) < 1) {
    return { status: 'conflict', reason: 'invalid_stored_administration_head' };
  }
  if (normalizeAdministrationObservation(envelope).status !== 'accepted') {
    return { status: 'conflict', reason: 'invalid_stored_administration_document' };
  }
  return { status: 'available', envelope, observationId: text(row, 'observation_id'),
    versionId: typeof row.configuration_version_id === 'string' ? row.configuration_version_id : null,
    generation: Number(row.generation), checkedAt: envelope.provenance.checkedAt,
    verifiedAt: row.verified_at ? timestamp(row.verified_at) : null };
}

export function createLeagueAdministrationMethods(client: DatabaseClient): Omit<LeagueAdministrationStore, 'enabled'> {
  async function readSource(input: AdministrationReadInput): Promise<LeagueAdministrationStoreRead> {
    let rows: readonly DatabaseRow[];
    try {
      rows = await client.query(`/* league-administration:read-source */ SELECT ${sourceColumns} ${sourceJoins}
        WHERE league.league_key=$1 AND season.season=$2 AND connection.provider=$5`,
      [input.leagueKey, input.season, input.family, input.week ?? 0, input.provider]);
    } catch {
      return { status: 'unavailable', reason: 'administration_database_unavailable' };
    }
    if (rows.some(row => row.external_league_id !== input.externalLeagueId)) {
      return { status: 'conflict', reason: 'source_connection_mismatch' };
    }
    try { return sourceResult(rows); }
    catch { return { status: 'conflict', reason: 'invalid_stored_administration_head' }; }
  }

  return {
    async recordObservation(input, fence) {
      const rows = await client.query(`/* league-administration:record-observation */
        SELECT public.record_league_administration_observation($1::jsonb) AS result`,
      [JSON.stringify(fence ? { ...input, writeFence: fence } : input)]);
      if (rows.length !== 1) throw new Error('Administration observation did not return one result.');
      const result = object(rows[0].result);
      if (!['changed', 'unchanged', 'replayed', 'stale', 'rejected'].includes(String(result.status))) {
        throw new Error('Invalid administration write outcome.');
      }
      return result as AdministrationWriteResult;
    },
    readSource,
    async readSourceByConnection(input) {
      let rows: readonly DatabaseRow[];
      try {
        rows = await client.query(`/* league-administration:read-source-by-connection */ SELECT ${sourceColumns} ${sourceJoins}
          WHERE connection.provider=$1 AND connection.external_league_id=$2`,
        [input.provider, input.externalLeagueId, input.family, input.week ?? 0]);
        if (rows.length === 0) {
          const historical = await client.query(`SELECT 1 FROM public.league_source_connection_history
            WHERE provider=$1 AND external_league_id=$2 LIMIT 1`, [input.provider, input.externalLeagueId]);
          if (historical.length > 0) return { status: 'conflict', reason: 'source_connection_is_not_current_or_enrolled' };
        }
      } catch {
        return { status: 'unavailable', reason: 'administration_database_unavailable' };
      }
      try { return sourceResult(rows); }
      catch { return { status: 'conflict', reason: 'invalid_stored_administration_head' }; }
    },
    async listEnrollments(requestedSeason?: number) {
      if (requestedSeason !== undefined && (!Number.isInteger(requestedSeason) || requestedSeason < 1920 || requestedSeason > 2200)) {
        throw new Error('Invalid administration enrollment season.');
      }
      const rows = requestedSeason === undefined ? await client.query(`/* league-administration:list-enrollments */
        SELECT league.id AS league_id,league.league_key,league.name,season.id AS league_season_id,
          season.season,season.scoring_profile_id,enrollment.provider,connection.external_league_id
        FROM public.league_administration_enrollments enrollment
        JOIN public.leagues league ON league.id=enrollment.league_id
        LEFT JOIN LATERAL (SELECT candidate.season FROM public.league_administration_enrollment_seasons candidate
          WHERE candidate.league_id=league.id AND candidate.provider=enrollment.provider
          ORDER BY candidate.season DESC LIMIT 1) intended ON true
        LEFT JOIN public.league_seasons season ON season.league_id=league.id AND season.season=intended.season
        LEFT JOIN public.league_source_connections connection
          ON connection.league_season_id=season.id AND connection.provider=enrollment.provider
        WHERE enrollment.active ORDER BY league.league_key`)
        : await client.query(`/* league-administration:list-season-enrollments */
          SELECT league.id AS league_id,league.league_key,league.name,season.id AS league_season_id,
            season.season,season.scoring_profile_id,membership.provider,connection.external_league_id
          FROM public.league_administration_enrollment_seasons membership
          JOIN public.leagues league ON league.id=membership.league_id
          LEFT JOIN public.league_seasons season ON season.league_id=membership.league_id AND season.season=membership.season
          LEFT JOIN public.league_source_connections connection ON connection.league_season_id=season.id AND connection.provider=membership.provider
          WHERE membership.season=$1 ORDER BY league.league_key`, [requestedSeason]);
      if (rows.length === 0) throw new Error('Enabled league administration has no active enrollments.');
      return rows.map((row): AdministrationEnrollment => {
        const season = Number(row.season);
        if (!Number.isInteger(season) || season < 1920 || season > 2200 || row.provider !== 'sleeper') {
          throw new Error('An active league administration enrollment is incomplete.');
        }
        return { leagueId: text(row, 'league_id'), leagueSeasonId: text(row, 'league_season_id'),
          leagueKey: text(row, 'league_key'), displayName: text(row, 'name'), season, provider: 'sleeper',
          externalLeagueId: text(row, 'external_league_id'), scoringProfileId: text(row, 'scoring_profile_id') };
      });
    },
  };
}
