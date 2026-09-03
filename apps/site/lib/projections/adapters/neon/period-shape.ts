import 'server-only';
import type { DatabaseRow } from '../../../database';
import { requiredText, rowNumber, rowText } from './database-values';

/** Opaque provider roster IDs are scoped by the authority's provider and league ID. */
export type StoredAuthorityLineupShape = Readonly<{
  sourceExternalLeagueId: string;
  expectedRosterCount: number;
  expectedStarterSlotCount: number;
  expectedRosterIds: readonly string[];
}>;

export function normalizeAuthorityLineupShape(
  shape: StoredAuthorityLineupShape,
): StoredAuthorityLineupShape {
  const sourceExternalLeagueId = requiredText(shape.sourceExternalLeagueId, 'Source league ID');
  if (!Number.isInteger(shape.expectedRosterCount) || shape.expectedRosterCount < 1
    || shape.expectedRosterCount > 1_000 || !Number.isInteger(shape.expectedStarterSlotCount)
    || shape.expectedStarterSlotCount < 1 || shape.expectedStarterSlotCount > 100
    || !Array.isArray(shape.expectedRosterIds)) throw new Error('Authority lineup shape is invalid.');
  const expectedRosterIds = shape.expectedRosterIds.map((id) => requiredText(id, 'Expected roster ID'));
  if (expectedRosterIds.length !== shape.expectedRosterCount
    || new Set(expectedRosterIds).size !== expectedRosterIds.length) {
    throw new Error('Authority roster membership is incomplete or duplicated.');
  }
  expectedRosterIds.sort();
  return { sourceExternalLeagueId, expectedRosterCount: shape.expectedRosterCount,
    expectedStarterSlotCount: shape.expectedStarterSlotCount, expectedRosterIds };
}

export function authorityLineupShapeFromRow(row: DatabaseRow): StoredAuthorityLineupShape {
  if (!Array.isArray(row.expected_roster_ids)
    || !row.expected_roster_ids.every((value) => typeof value === 'string')) {
    throw new Error('Authority roster membership is unavailable.');
  }
  return normalizeAuthorityLineupShape({
    sourceExternalLeagueId: rowText(row, 'source_external_league_id'),
    expectedRosterCount: rowNumber(row, 'expected_roster_count'),
    expectedStarterSlotCount: rowNumber(row, 'expected_starter_slot_count'),
    expectedRosterIds: row.expected_roster_ids as string[],
  });
}
