import 'server-only';

import { createHash } from 'node:crypto';
import type { DatabaseRow } from '../../../database';
import { isMatchupsData } from '../../../matchups-response';
import type { MatchupsData } from '../../../types';
import type { ProjectionActivityWindow, StoredProjectionSnapshot } from './contracts';
import { json, rowBoolean, rowNullableText, rowNumber, rowObject, rowText } from './database-values';

const ACTIVITY_WINDOW_MS = 9 * 60 * 60 * 1_000;

export function canonicalActivityWindows(
  input: readonly ProjectionActivityWindow[],
): readonly ProjectionActivityWindow[] {
  if (input.length > 32) throw new Error('A projection snapshot cannot contain more than 32 activity windows.');
  const unique = new Map<string, ProjectionActivityWindow>();
  for (const window of input) {
    const startsAtMs = Date.parse(window.startsAt);
    const endsAtMs = Date.parse(window.endsAt);
    if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs)
      || endsAtMs - startsAtMs !== ACTIVITY_WINDOW_MS) {
      throw new Error('Projection activity windows must span kickoff minus two hours through kickoff plus seven hours.');
    }
    const normalized = {
      startsAt: new Date(startsAtMs).toISOString(),
      endsAt: new Date(endsAtMs).toISOString(),
    };
    unique.set(`${normalized.startsAt}\0${normalized.endsAt}`, normalized);
  }
  return [...unique.values()].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

export function snapshotContentHash(
  payload: MatchupsData,
  activityWindows: readonly ProjectionActivityWindow[],
): string {
  const materialPayload = Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== 'updatedAt'),
  );
  return createHash('sha256').update(json({ materialPayload, activityWindows })).digest('hex');
}

export function containsScheduledGame(value: unknown, visited = new Set<object>()): boolean {
  if (!value || typeof value !== 'object' || visited.has(value)) return false;
  visited.add(value);
  if (!Array.isArray(value) && (value as Readonly<Record<string, unknown>>).kind === 'scheduled') {
    return true;
  }
  return Object.values(value).some((item) => containsScheduledGame(item, visited));
}

function rowMatchupsPayload(row: DatabaseRow): MatchupsData {
  const payload = rowObject(row, 'payload');
  if (!isMatchupsData(payload)) {
    throw new Error('Stored projection snapshot is not valid matchup data.');
  }
  return payload;
}

function rowActivityWindows(row: DatabaseRow): readonly ProjectionActivityWindow[] {
  const raw = typeof row.activity_windows === 'string'
    ? JSON.parse(row.activity_windows) as unknown
    : row.activity_windows;
  if (!Array.isArray(raw) || raw.some((item) => !item || typeof item !== 'object'
    || typeof (item as Record<string, unknown>).startsAt !== 'string'
    || typeof (item as Record<string, unknown>).endsAt !== 'string')) {
    throw new Error('Stored projection snapshot does not contain valid activity windows.');
  }
  return canonicalActivityWindows(raw as readonly ProjectionActivityWindow[]);
}

export function snapshotFromRow(row: DatabaseRow): StoredProjectionSnapshot {
  try {
    return {
      snapshotId: rowText(row, 'snapshot_id'),
      leagueSeasonId: rowText(row, 'league_season_id'),
      week: rowNumber(row, 'week'),
      modelVersion: rowText(row, 'model_version'),
      revisionKey: rowText(row, 'revision_key'),
      calculatedAt: rowText(row, 'calculated_at'),
      publishedAt: rowNullableText(row, 'published_at'),
      verifiedAt: rowText(row, 'verified_at'),
      activityWindows: rowActivityWindows(row),
      isCurrent: rowBoolean(row, 'is_current'),
      payload: rowMatchupsPayload(row),
    };
  } catch (error) {
    if (error instanceof InvalidStoredProjectionSnapshotError) throw error;
    throw new InvalidStoredProjectionSnapshotError(error);
  }
}

export class InvalidStoredProjectionSnapshotError extends Error {
  constructor(cause: unknown) {
    super('Stored projection snapshot is malformed.', { cause });
    this.name = 'InvalidStoredProjectionSnapshotError';
  }
}
