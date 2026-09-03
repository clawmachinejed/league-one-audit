import 'server-only';
import type { DatabaseRow } from '../../../database';
import type { MatchupProjectionIdentity, SeasonType, StoredLeaguePeriodAuthority, StoredFutureMaterializationFreshness } from './contracts';
import { provider, requiredText, rowNumber, rowText } from './database-values';
export const SEASON_TYPES = ['pre', 'reg', 'post'] as const;
export const LIFECYCLES = ['preseason', 'active', 'complete'] as const;
export const NFL_PHASES = ['preseason', 'regular', 'postseason', 'unknown'] as const;

export function member<Value extends string>(
  value: string,
  values: readonly Value[],
  label: string,
): Value {
  if (!values.includes(value as Value)) throw new Error(`Database did not return a valid ${label}.`);
  return value as Value;
}

export function wholeNumber(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

export function timestamp(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid.`);
  return value;
}

function nullableNumber(row: DatabaseRow, key: string): number | null {
  if (row[key] === null || row[key] === undefined) return null;
  return rowNumber(row, key);
}

function nullableText(row: DatabaseRow, key: string): string | null {
  if (row[key] === null || row[key] === undefined) return null;
  return rowText(row, key);
}

function nullableTimestamp(row: DatabaseRow, key: string, label: string): string | null {
  const value = nullableText(row, key);
  return value === null ? null : timestamp(value, label);
}

function nullableSeasonType(row: DatabaseRow, key: string): SeasonType | null {
  if (row[key] === null || row[key] === undefined) return null;
  return member(rowText(row, key), SEASON_TYPES, key);
}

export function projectionIdentityValues(
  identity: MatchupProjectionIdentity,
): readonly [string, string, string] {
  return [
    provider(identity.projectionProvider),
    requiredText(identity.normalizerVersion, 'Projection normalizer version'),
    requiredText(identity.modelVersion, 'Projection model version'),
  ];
}

export function authorityFromRow(row: DatabaseRow): StoredLeaguePeriodAuthority {
  const rawActiveSeason = nullableNumber(row, 'active_season');
  const rawActiveWeek = nullableNumber(row, 'active_week');
  const authority: StoredLeaguePeriodAuthority = {
    leagueKey: requiredText(rowText(row, 'league_key'), 'League key'),
    defaultSeason: wholeNumber(rowNumber(row, 'default_season'), 1920, 2200, 'Default season'),
    defaultSeasonType: member(rowText(row, 'default_season_type'), SEASON_TYPES, 'default season type'),
    defaultWeek: wholeNumber(rowNumber(row, 'default_week'), 1, 18, 'Default week'),
    activeSeason: rawActiveSeason === null
      ? null : wholeNumber(rawActiveSeason, 1920, 2200, 'Active season'),
    activeSeasonType: nullableSeasonType(row, 'active_season_type'),
    activeWeek: rawActiveWeek === null
      ? null : wholeNumber(rawActiveWeek, 1, 18, 'Active week'),
    leagueLifecycle: member(rowText(row, 'league_lifecycle'), LIFECYCLES, 'league lifecycle'),
    nflPhase: member(rowText(row, 'nfl_phase'), NFL_PHASES, 'NFL phase'),
    sourceProvider: provider(rowText(row, 'source_provider')),
    sourceRevision: requiredText(rowText(row, 'source_revision'), 'Period source revision'),
    sourceObservedAt: timestamp(rowText(row, 'source_observed_at'), 'Period source observation time'),
    verifiedAt: timestamp(rowText(row, 'period_verified_at'), 'Period verification time'),
  };
  const activeValues = [authority.activeSeason, authority.activeSeasonType, authority.activeWeek];
  const activeCount = activeValues.filter((value) => value !== null).length;
  if (activeCount !== 0 && activeCount !== activeValues.length) {
    throw new Error('Database returned an incomplete active scoring period.');
  }
  if ((authority.leagueLifecycle === 'active') !== (activeCount === activeValues.length)) {
    throw new Error('Database returned an inconsistent league lifecycle.');
  }
  if (Date.parse(authority.verifiedAt) < Date.parse(authority.sourceObservedAt)) {
    throw new Error('Database returned an invalid period verification time.');
  }
  return authority;
}

export function futureFreshnessFromRow(row: DatabaseRow): StoredFutureMaterializationFreshness | null {
  if (row.future_next_refresh_at === null || row.future_next_refresh_at === undefined) return null;
  return {
    nextRefreshAt: timestamp(rowText(row, 'future_next_refresh_at'), 'Future refresh time'),
    lastSucceededAt: nullableTimestamp(row, 'future_last_succeeded_at', 'Future refresh success time'),
    activeAttemptExpiresAt: nullableTimestamp(row, 'future_attempt_expires_at', 'Future refresh attempt expiration'),
    lastProjectionSlateContentId: nullableText(row, 'future_last_slate_content_id'),
    currentProjectionSlateContentId: nullableText(row, 'future_current_slate_content_id'),
    lastSnapshotRevision: nullableText(row, 'future_last_snapshot_revision'),
  };
}
