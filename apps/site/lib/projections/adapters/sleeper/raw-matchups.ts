import 'server-only';

import { startingSlots } from '../../../sleeper-lineup';
import type { SleeperMatchup, SleeperRoster } from '../../../transform';

export type RawSleeperMatchupObservation = Readonly<{
  rows: SleeperMatchup[];
  requestStartedAt: string;
  requestCompletedAt: string;
}>;

export type RawSleeperMatchupClient = Readonly<{
  readJson: (path: string, revalidate: number) => Promise<unknown>;
  now: () => string;
}>;

export type SleeperMatchupShape = Readonly<{
  rosterIds: readonly number[];
  starterSlots: readonly string[];
  expectedRosterCount: number;
  expectedStarterSlotCount: number;
}>;

type RosterIdentity = Pick<SleeperRoster, 'roster_id'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || value === null
    || (typeof value === 'number' && Number.isFinite(value));
}

function isStringArray(value: unknown): boolean {
  return value === undefined || value === null
    || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

function isPointsMap(value: unknown): boolean {
  return value === undefined || value === null || (isRecord(value)
    && Object.values(value).every((points) => isOptionalNumber(points)));
}

function isSleeperMatchup(value: unknown): value is SleeperMatchup {
  const matchupId = isRecord(value) ? value.matchup_id : undefined;
  return isRecord(value) && typeof value.roster_id === 'number' && Number.isInteger(value.roster_id)
    && value.roster_id > 0
    && Object.prototype.hasOwnProperty.call(value, 'matchup_id')
    && (matchupId === null || (typeof matchupId === 'number' && Number.isInteger(matchupId) && matchupId > 0))
    && isStringArray(value.starters)
    && (value.starters_points === undefined || value.starters_points === null
      || (Array.isArray(value.starters_points) && value.starters_points.every((points) => isOptionalNumber(points))))
    && isPointsMap(value.players_points) && isOptionalNumber(value.points) && isOptionalNumber(value.custom_points);
}

/** Validate without rewriting IDs, slot order, points, or source response order. */
export function parseRawSleeperMatchups(value: unknown, path: string): SleeperMatchup[] {
  if (!Array.isArray(value) || value.some((row) => !isSleeperMatchup(row))) {
    throw new Error(`Sleeper returned an invalid response for ${path}.`);
  }
  const rows = value as SleeperMatchup[];
  const keys = rows.map((row) => String(row.roster_id));
  if (new Set(keys).size !== keys.length) {
    throw new Error(`Sleeper returned duplicate entries for ${path}.`);
  }
  return rows;
}

/** Full loads and thin observers share this one weekly request and raw parser. */
export function createRawSleeperMatchupLoader(client: RawSleeperMatchupClient) {
  return async (
    leagueId: string,
    week: number,
    revalidate: number,
  ): Promise<RawSleeperMatchupObservation> => {
    const path = `/league/${leagueId}/matchups/${week}`;
    const requestStartedAt = client.now();
    const rows = parseRawSleeperMatchups(await client.readJson(path, revalidate), path);
    const requestCompletedAt = client.now();
    return { rows, requestStartedAt, requestCompletedAt };
  };
}

export function sleeperMatchupShape(
  rosters: readonly RosterIdentity[],
  rosterPositions: readonly string[],
): SleeperMatchupShape {
  const rosterIds = [...new Set(rosters.map((roster) => roster.roster_id))];
  const starterSlots = startingSlots(rosterPositions);
  return {
    rosterIds,
    starterSlots,
    expectedRosterCount: rosterIds.length,
    expectedStarterSlotCount: starterSlots.length,
  };
}

export function assertMatchupCompleteness(
  rows: readonly SleeperMatchup[],
  rosters: readonly RosterIdentity[],
  slateExpected: boolean,
): void {
  if (!rows.length) {
    if (slateExpected) throw new Error('Sleeper returned an incomplete matchup slate for this league.');
    return;
  }
  const rosterIds = new Set(rosters.map((roster) => roster.roster_id));
  if (rows.length !== rosterIds.size || rows.some((row) => !rosterIds.has(row.roster_id))) {
    throw new Error('Sleeper returned an incomplete matchup slate for this league.');
  }
  const pairedCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.matchup_id === null || row.matchup_id === undefined) continue;
    const id = String(row.matchup_id);
    pairedCounts.set(id, (pairedCounts.get(id) ?? 0) + 1);
  }
  if ([...pairedCounts.values()].some((count) => count !== 2)) {
    throw new Error('Sleeper returned an invalid matchup grouping for this league.');
  }
}

export function assertProjectionMatchupReadiness(
  rows: readonly SleeperMatchup[],
  rosters: readonly RosterIdentity[],
  rosterPositions: readonly string[],
): void {
  assertMatchupCompleteness(rows, rosters, true);
  if (rows.some((row) => row.matchup_id === null || row.matchup_id === undefined)) {
    throw new Error('Sleeper has not resolved every matchup pairing for the requested projection week.');
  }

  const requiredSlots = startingSlots(rosterPositions);
  if (!requiredSlots.length || rows.some((row) => !Array.isArray(row.starters)
    || row.starters.length !== requiredSlots.length
    || row.starters.some((starter) => !starter.trim()))) {
    throw new Error('Sleeper has not published complete lineups for the requested projection week.');
  }
}
