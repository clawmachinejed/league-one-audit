import 'server-only';

import { matchupSnapshotSelectionSql } from './matchup-selection-sql';

import type { DatabaseClient, DatabaseRow } from '../../../database';
import { matchesRefinement } from '../../../matchups-shape';
import type { ProjectionStore, StoredMatchupRevisionSnapshot } from './contracts';
import { requiredText, rowBoolean, rowNullableText, rowNumber, rowText } from './database-values';
import { matchupsStructureSql, safeJsonArray } from './matchups-shape-sql';
import { authorityFromRow, futureFreshnessFromRow, projectionIdentityValues, wholeNumber } from './period-values';
import { InvalidStoredProjectionSnapshotError, rowActivityWindows } from './snapshot-codec';

export const COMPACT_MATCHUP_PAYLOAD_COLUMNS = `
  ${matchupsStructureSql('snapshot.payload')} AS payload_structure_valid,
  snapshot.payload ->> 'updatedAt' AS payload_updated_at,
  snapshot.payload #>> '{league,season}' AS payload_season,
  snapshot.payload ->> 'week' AS payload_week,
  snapshot.payload #>> '{league,week}' AS payload_league_week,
  COALESCE((
    SELECT jsonb_agg(matchup.value -> 'status')
    FROM jsonb_array_elements(${safeJsonArray("snapshot.payload -> 'matchups'")}) matchup(value)
  ), '[]'::jsonb) AS matchup_statuses,
  COALESCE((
    SELECT jsonb_agg(DISTINCT starter.value #>> '{game,kickoffAt}')
    FROM jsonb_array_elements(${safeJsonArray("snapshot.payload -> 'matchups'")}) matchup(value)
    CROSS JOIN jsonb_array_elements(${safeJsonArray("matchup.value -> 'sides'")}) side(value)
    CROSS JOIN jsonb_array_elements(${safeJsonArray("side.value -> 'starters'")}) starter(value)
    WHERE starter.value #>> '{game,kind}' = 'scheduled'
      AND COALESCE(starter.value #>> '{game,kickoffAt}', '') <> ''
  ), '[]'::jsonb) AS scheduled_kickoffs,
  COALESCE((
    SELECT jsonb_agg(DISTINCT starter.value #>> '{game,date}')
    FROM jsonb_array_elements(${safeJsonArray("snapshot.payload -> 'matchups'")}) matchup(value)
    CROSS JOIN jsonb_array_elements(${safeJsonArray("matchup.value -> 'sides'")}) side(value)
    CROSS JOIN jsonb_array_elements(${safeJsonArray("side.value -> 'starters'")}) starter(value)
    WHERE starter.value #>> '{game,kind}' = 'scheduled'
      AND COALESCE(starter.value #>> '{game,kickoffAt}', '') = ''
  ), '[]'::jsonb) AS scheduled_dates_without_kickoff`;

function arrayValue(row: DatabaseRow, key: string): unknown[] {
  const value: unknown = typeof row[key] === 'string' ? JSON.parse(row[key]) : row[key];
  if (!Array.isArray(value)) throw new Error(`Database did not return ${key}.`);
  return value;
}

function strings(row: DatabaseRow, key: string): string[] {
  const values = arrayValue(row, key);
  if (!values.every((value): value is string => typeof value === 'string')) {
    throw new Error(`Database did not return valid ${key}.`);
  }
  return values;
}

export function snapshotRevisionFromRow(row: DatabaseRow): StoredMatchupRevisionSnapshot {
  try {
    if (!rowBoolean(row, 'payload_structure_valid')) throw new Error('Invalid matchup structure.');
    const payloadUpdatedAt = rowText(row, 'payload_updated_at');
    const payloadSeason = row.payload_season;
    if (typeof payloadSeason !== 'string') throw new Error('Invalid matchup season.');
    const matchupStatuses = arrayValue(row, 'matchup_statuses');
    if (!matchesRefinement('date-string', payloadUpdatedAt)
      || !matchupStatuses.every((status) => matchesRefinement('matchup-status', status))) {
      throw new Error('Invalid matchup refinements.');
    }
    return {
      snapshotId: rowText(row, 'snapshot_id'),
      leagueSeasonId: rowText(row, 'league_season_id'),
      week: rowNumber(row, 'week'), modelVersion: rowText(row, 'model_version'),
      revisionKey: rowText(row, 'revision_key'), calculatedAt: rowText(row, 'calculated_at'),
      publishedAt: rowNullableText(row, 'published_at'), verifiedAt: rowText(row, 'verified_at'),
      isCurrent: rowBoolean(row, 'is_current'), activityWindows: rowActivityWindows(row),
      payloadUpdatedAt, payloadSeason,
      payloadWeek: rowNumber(row, 'payload_week'), payloadLeagueWeek: rowNumber(row, 'payload_league_week'),
      matchupStatuses, scheduledKickoffs: strings(row, 'scheduled_kickoffs'),
      scheduledDatesWithoutKickoff: strings(row, 'scheduled_dates_without_kickoff'),
    };
  } catch (error) {
    if (error instanceof InvalidStoredProjectionSnapshotError) throw error;
    throw new InvalidStoredProjectionSnapshotError(error);
  }
}

type RevisionMethods = Pick<ProjectionStore, 'readMatchupSnapshotRevisionByLeagueKey'>;

export function createSnapshotRevisionMethods(client: DatabaseClient): RevisionMethods {
  return {
    async readMatchupSnapshotRevisionByLeagueKey(leagueKey, requestedWeek, identity) {
      if (requestedWeek !== undefined) wholeNumber(requestedWeek, 1, 18, 'Requested week');
      const identityValues = projectionIdentityValues(identity);
      const rows = await client.query(`/* projection-store:read-matchup-snapshot-revision-by-league-key */
        ${matchupSnapshotSelectionSql(COMPACT_MATCHUP_PAYLOAD_COLUMNS)}`, [
        requiredText(leagueKey, 'League key'), requestedWeek ?? null,
        ...identityValues,
      ]);
      const row = rows[0];
      if (!row) return null;
      return {
        authority: authorityFromRow(row),
        snapshot: row.snapshot_id === null || row.snapshot_id === undefined ? null : snapshotRevisionFromRow(row),
        futureRefresh: futureFreshnessFromRow(row),
      };
    },
  };
}

