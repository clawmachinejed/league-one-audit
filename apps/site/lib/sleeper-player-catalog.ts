import 'server-only';

import { createHash } from 'node:crypto';
import { startProviderHttp } from './provider-request-telemetry';
import { stableJson } from './projections/shared/stable-json';
import { normalizeInjuryStatus } from './injury-status';
import type { PlayerCatalog, SleeperPlayer } from './transform';

const API = 'https://api.sleeper.app/v1';
// Back off briefly after a catalog failure so an upstream outage does not trigger a large retry on every page request.
const PLAYER_FAILURE_CACHE_SECONDS = 300;
// The public leagues use these player positions. Sleeper's documented position filters keep
// each response small enough to load reliably in a serverless function.
export const FANTASY_PLAYER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
export type FantasyPlayerPosition = typeof FANTASY_PLAYER_POSITIONS[number];

export type FantasyPlayerCatalog = Readonly<{
  catalog: PlayerCatalog;
  complete: boolean;
  sourceRevision: string | null;
  warning?: string;
}>;

type PlayerCatalogSlice = Readonly<{
  catalog: PlayerCatalog;
  sourceRevision: string;
  rowCount: number;
  malformedRowCount: number;
}>;

export type FantasyPlayerPositionLoader = (
  position: FantasyPlayerPosition,
) => Promise<PlayerCatalogSlice>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function projectPlayerCatalog(raw: unknown): PlayerCatalogSlice {
  if (!isRecord(raw)) throw new Error('Sleeper did not return a valid player catalog.');
  const result: PlayerCatalog = {};
  let malformedRowCount = 0;
  for (const [id, value] of Object.entries(raw)) {
    if (!id.trim() || !isRecord(value)) {
      malformedRowCount += 1;
      continue;
    }
    const invalidTypedField = ['full_name', 'first_name', 'last_name', 'position', 'team', 'status']
      .some((field) => value[field] !== undefined && value[field] !== null
        && typeof value[field] !== 'string')
      || (value.active !== undefined && value.active !== null && typeof value.active !== 'boolean')
      || (value.fantasy_positions !== undefined && value.fantasy_positions !== null
        && (!Array.isArray(value.fantasy_positions)
          || !value.fantasy_positions.every((position) => typeof position === 'string')));
    if (invalidTypedField) {
      malformedRowCount += 1;
      continue;
    }
    const player: SleeperPlayer = {};
    for (const field of ['full_name', 'first_name', 'last_name', 'position', 'team'] as const) {
      if (typeof value[field] === 'string' && value[field].trim()) player[field] = value[field].trim();
    }
    if (typeof value.active === 'boolean') player.active = value.active;
    if (typeof value.status === 'string' && value.status.trim()) player.status = value.status.trim();
    if (Array.isArray(value.fantasy_positions)
      && value.fantasy_positions.every((position) => typeof position === 'string')) {
      player.fantasy_positions = value.fantasy_positions
        .map((position) => position.trim()).filter(Boolean);
    }
    const injuryStatus = normalizeInjuryStatus(value.injury_status);
    if (injuryStatus) player.injury_status = injuryStatus;
    if (player.full_name || player.first_name || player.last_name) result[id] = player;
    else malformedRowCount += 1;
  }
  if (!Object.keys(result).length) throw new Error('Sleeper returned an empty player catalog.');
  return {
    catalog: result,
    rowCount: Object.keys(raw).length,
    malformedRowCount,
    sourceRevision: `sha256:${createHash('sha256').update(stableJson(result)).digest('hex')}`,
  };
}

// These maps provide request deduplication and a short failure backoff in both
// Next.js runtimes and the server-only operator process.
const playerPositionFailures = new Map<FantasyPlayerPosition, number>();
const playerPositionRequests = new Map<FantasyPlayerPosition, Promise<PlayerCatalogSlice>>();

/** Loads and validates one of the six shared position catalogs without using a
 * framework cache. The website wraps this exact function in Next's daily cache. */
export async function loadFantasyPlayerPositionCatalog(
  position: FantasyPlayerPosition,
): Promise<PlayerCatalogSlice> {
  const failedUntil = playerPositionFailures.get(position);
  if (failedUntil && failedUntil > Date.now()) {
    throw new Error(`Sleeper's ${position} player catalog is in a temporary retry backoff.`);
  }
  if (failedUntil) playerPositionFailures.delete(position);

  const activeRequest = playerPositionRequests.get(position);
  if (activeRequest) return activeRequest;

  const path = `/players/nfl?position=${encodeURIComponent(position)}`;
  const request = (async () => {
    const finished = startProviderHttp('sleeper', 'nfl-players', 'bypass');
    let response: Response;
    try {
      response = await fetch(`${API}${path}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      finished('unavailable');
      throw error;
    }
    if (!response.ok) {
      finished('unavailable');
      throw new Error(`Sleeper could not load ${path} (HTTP ${response.status}).`);
    }
    let raw: unknown;
    try {
      raw = await response.json();
      finished('available');
    } catch (error) {
      finished('invalid');
      throw error;
    }
    return projectPlayerCatalog(raw);
  })()
    .then((catalog) => {
      playerPositionFailures.delete(position);
      return catalog;
    })
    .catch((error: unknown) => {
      playerPositionFailures.set(position, Date.now() + PLAYER_FAILURE_CACHE_SECONDS * 1_000);
      console.warn(`Sleeper ${position} player catalog could not be loaded.`, error);
      throw error;
    })
    .finally(() => playerPositionRequests.delete(position));
  playerPositionRequests.set(position, request);
  return request;
}

/** Retrieves, combines, fingerprints, and classifies the shared six-position
 * catalog. Its default path is cache-neutral for command-line/server operators;
 * the website supplies the existing Next.js-cached position loader. */
export async function loadFantasyPlayerCatalog(
  loadPosition: FantasyPlayerPositionLoader = loadFantasyPlayerPositionCatalog,
): Promise<FantasyPlayerCatalog> {
  const results = await Promise.allSettled(
    FANTASY_PLAYER_POSITIONS.map((position) => loadPosition(position)),
  );
  const catalog = Object.assign(
    {},
    ...results.flatMap((result) => result.status === 'fulfilled' ? [result.value.catalog] : []),
  ) as PlayerCatalog;
  const failedPositions = FANTASY_PLAYER_POSITIONS
    .filter((_, index) => results[index].status === 'rejected');
  const malformedRows = results.reduce((total, result) => (
    total + (result.status === 'fulfilled' ? result.value.malformedRowCount : 0)
  ), 0);
  const sourceRevision = failedPositions.length === 0 ? `sha256:${createHash('sha256').update(stableJson(
    results.map((result, index) => result.status === 'fulfilled' ? {
      position: FANTASY_PLAYER_POSITIONS[index],
      sourceRevision: result.value.sourceRevision,
      rowCount: result.value.rowCount,
      malformedRowCount: result.value.malformedRowCount,
    } : { position: FANTASY_PLAYER_POSITIONS[index], unavailable: true }),
  )).digest('hex')}` : null;
  const warning = !Object.keys(catalog).length
    ? 'Player names and injury designations are temporarily unavailable. Sleeper player IDs are shown where necessary.'
    : failedPositions.length
      ? `Some player names and injury designations are temporarily unavailable (${failedPositions.join(', ')}). Sleeper player IDs are shown where necessary.`
      : malformedRows > 0
        ? `Sleeper returned ${malformedRows} malformed player catalog row${malformedRows === 1 ? '' : 's'}; all-player ingestion is unavailable until the catalog is complete.`
        : undefined;
  return {
    catalog,
    sourceRevision,
    ...(warning ? { warning } : {}),
    complete: warning === undefined,
  };
}
