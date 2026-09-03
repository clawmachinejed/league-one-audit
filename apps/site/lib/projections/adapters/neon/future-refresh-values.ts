import 'server-only';

import type { DatabaseRow } from '../../../database';
import type { FutureRefreshFailureCode } from '../../ports/future-refresh-repository';
import type {
  StoreFutureRefreshClaim,
  StoreFutureRefreshPeriod,
  StoreFutureRefreshTarget,
  StoreFutureRefreshTransition,
} from './contracts';
import { requiredText, rowNumber, rowText } from './database-values';

const SEASON_TYPES = ['pre', 'reg', 'post'] as const;
const FAILURE_CODES = [
  'provider-unavailable',
  'projection-slate-incomplete',
  'projection-slate-invalid',
  'projection-slate-persistence-failed',
  'projection-slate-unavailable',
  'game-state-unavailable',
  'game-state-incomplete',
  'league-source-unavailable',
  'league-period-mismatch',
  'lineup-not-ready',
  'identity-conflict',
  'scoring-failed',
  'baseline-freeze-incomplete',
  'official-observation-incomplete',
  'snapshot-rejected',
  'snapshot-publication-failed',
  'deadline-exceeded',
  'unexpected',
] as const satisfies readonly FutureRefreshFailureCode[];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function futureRefreshTimestamp(value: string, label: string): string {
  const normalized = requiredText(value, label);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${label} is invalid.`);
  return normalized;
}

export function futureRefreshPeriod(value: StoreFutureRefreshPeriod): StoreFutureRefreshPeriod {
  if (!Number.isInteger(value.season) || value.season < 1920 || value.season > 2200
    || !SEASON_TYPES.includes(value.seasonType)
    || !Number.isInteger(value.week) || value.week < 1 || value.week > 18) {
    throw new Error('Future projection period is invalid.');
  }
  return value;
}

export function futureRefreshPeriods(
  values: readonly StoreFutureRefreshPeriod[],
): StoreFutureRefreshPeriod[] {
  const normalized = values.map(futureRefreshPeriod);
  const seasonTypeRank = (value: StoreFutureRefreshPeriod['seasonType']) => (
    SEASON_TYPES.indexOf(value)
  );
  return [...new Map(normalized.map((value) => [
    `${value.season}:${value.seasonType}:${value.week}`,
    value,
  ])).values()].sort((left, right) => (
    left.season - right.season
    || seasonTypeRank(left.seasonType) - seasonTypeRank(right.seasonType)
    || left.week - right.week
  ));
}

export function futureRefreshTargets(
  values: readonly StoreFutureRefreshTarget[],
): StoreFutureRefreshTarget[] {
  const byPeriod = new Map<string, StoreFutureRefreshTarget>();
  for (const value of values) {
    const period = futureRefreshPeriod(value.period);
    if (!Number.isInteger(value.weekDistance)
      || value.weekDistance < 1 || value.weekDistance > 18) {
      throw new Error('Future projection week distance is invalid.');
    }
    const projectionWeekDistance = value.projectionWeekDistance ?? value.weekDistance;
    if (!Number.isInteger(projectionWeekDistance) || projectionWeekDistance < 1
      || projectionWeekDistance > value.weekDistance) {
      throw new Error('Shared projection week distance is invalid.');
    }
    const key = `${period.season}:${period.seasonType}:${period.week}`;
    const existing = byPeriod.get(key);
    if (existing && (existing.weekDistance !== value.weekDistance
      || existing.projectionWeekDistance !== projectionWeekDistance)) {
      throw new Error('Future projection period has conflicting week distances.');
    }
    byPeriod.set(key, { period, weekDistance: value.weekDistance, projectionWeekDistance });
  }
  const orderedPeriods = futureRefreshPeriods([...byPeriod.values()].map(({ period }) => period));
  return orderedPeriods.map((period) => byPeriod.get(
    `${period.season}:${period.seasonType}:${period.week}`,
  )!);
}

export function futureRefreshTexts(values: readonly string[], label: string): string[] {
  return [...new Set(values.map((value) => requiredText(value, label)))].sort();
}

export function futureRefreshUuid(value: string, label: string): string {
  const normalized = requiredText(value, label);
  if (!UUID.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized.toLowerCase();
}

export function futureRefreshLeaseSeconds(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 900) {
    throw new Error('Future refresh lease must be between 1 and 900 seconds.');
  }
  return value;
}

export function futureRefreshFailureCode(value: string): FutureRefreshFailureCode {
  if (!FAILURE_CODES.includes(value as FutureRefreshFailureCode)) {
    throw new Error('Future refresh failure code is invalid.');
  }
  return value as FutureRefreshFailureCode;
}

export function futureRefreshNextAfter(value: string, after: string): string {
  const next = futureRefreshTimestamp(value, 'Next future refresh time');
  if (Date.parse(next) <= Date.parse(after)) {
    throw new Error('Next future refresh time must follow completion time.');
  }
  return next;
}

export function nullableRowText(row: DatabaseRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return rowText(row, key);
}

export function futureRefreshClaim(rows: readonly DatabaseRow[]): StoreFutureRefreshClaim {
  const row = rows[0];
  if (!row) return { kind: 'unavailable' };
  const kind = rowText(row, 'result_kind');
  if (kind === 'acquired') {
    return {
      kind,
      attempt: rowNumber(row, 'attempt_count'),
      attemptId: rowText(row, 'attempt_id'),
      leaseUntil: rowText(row, 'lease_until'),
    };
  }
  if (kind === 'backed-off') {
    return {
      kind,
      consecutiveFailures: rowNumber(row, 'consecutive_failures'),
      nextRefreshAt: rowText(row, 'next_refresh_at'),
    };
  }
  throw new Error('Database returned an invalid future refresh claim.');
}

export function futureRefreshTransition(
  rows: readonly DatabaseRow[],
): StoreFutureRefreshTransition {
  const row = rows[0];
  if (!row) return { kind: 'stale' };
  return {
    kind: 'updated',
    consecutiveFailures: rowNumber(row, 'consecutive_failures'),
    nextRefreshAt: rowText(row, 'next_refresh_at'),
    materializationsWoken: rowNumber(row, 'materializations_woken'),
  };
}
