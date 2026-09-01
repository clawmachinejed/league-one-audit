import 'server-only';

import { unstable_cache } from 'next/cache';
import type {
  NormalizedTank01DefenseProjection,
  NormalizedTank01KickerProjection,
  NormalizedTank01OffenseProjection,
} from './projection-scoring';

const RAPID_API_HOST = 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com';
const RAPID_API_ORIGIN = `https://${RAPID_API_HOST}`;
const SUCCESS_CACHE_SECONDS = 60 * 60;
const SUCCESS_CACHE_MS = SUCCESS_CACHE_SECONDS * 1_000;
const FAILURE_BACKOFF_MS = 60 * 1_000;
const REQUEST_TIMEOUT_MS = 15_000;

const teamAliases = new Map([
  ['JAC', 'JAX'],
  ['LA', 'LAR'],
  ['WSH', 'WAS'],
]);

const nflTeams = new Set([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
]);

export type Tank01PlayerStats = Readonly<{
  passing: Readonly<{
    attempts: number | null;
    completions: number | null;
    yards: number | null;
    touchdowns: number | null;
    interceptions: number | null;
  }>;
  rushing: Readonly<{
    carries: number | null;
    yards: number | null;
    touchdowns: number | null;
  }>;
  receiving: Readonly<{
    targets: number | null;
    receptions: number | null;
    yards: number | null;
    touchdowns: number | null;
  }>;
  kicking: Readonly<{
    fieldGoalsMade: number | null;
    fieldGoalsMissed: number | null;
    extraPointsMade: number | null;
    extraPointsMissed: number | null;
  }>;
  twoPointConversions: number | null;
  fumblesLost: number | null;
}>;

export type Tank01DefenseStats = Readonly<{
  returnTouchdowns: number | null;
  defensiveTouchdowns: number | null;
  safeties: number | null;
  fumbleRecoveries: number | null;
  pointsAllowed: number | null;
  interceptions: number | null;
  sacks: number | null;
  blockedKicks: number | null;
}>;

export type Tank01PlayerProjection = Readonly<{
  tank01PlayerId: string;
  sleeperPlayerId: string;
  team: string | null;
  position: string | null;
  stats: Tank01PlayerStats;
  /** Flat view accepted directly by scoreTank01Projection. */
  scoringProjection: NormalizedTank01OffenseProjection | NormalizedTank01KickerProjection;
  /** Provider fields that were absent or were not finite numeric values. */
  missingFields: readonly string[];
}>;

export type Tank01DefenseProjection = Readonly<{
  team: string;
  stats: Tank01DefenseStats;
  /** Flat view accepted directly by scoreTank01Projection. */
  scoringProjection: NormalizedTank01DefenseProjection;
  /** Provider fields that were absent or were not finite numeric values. */
  missingFields: readonly string[];
}>;

export type Tank01ProjectionCoverage = Readonly<{
  playerListRows: number;
  crosswalkEntries: number;
  malformedPlayerListRows: number;
  ambiguousPlayerListRows: number;
  playerProjectionRows: number;
  matchedPlayerProjections: number;
  unmatchedPlayerProjections: number;
  malformedPlayerProjections: number;
  incompletePlayerProjections: number;
  defenseProjectionRows: number;
  usableDefenseProjections: number;
  malformedDefenseProjections: number;
  incompleteDefenseProjections: number;
}>;

export type Tank01AvailableResult = Readonly<{
  status: 'available';
  season: string;
  week: number;
  /** Time the weekly projection response was retrieved, not a league-point calculation time. */
  fetchedAt: string;
  projections: Readonly<{
    bySleeperId: Readonly<Record<string, Tank01PlayerProjection>>;
    byDefenseTeam: Readonly<Record<string, Tank01DefenseProjection>>;
  }>;
  coverage: Tank01ProjectionCoverage;
  warnings: readonly string[];
}>;

export type Tank01UnavailableReason =
  | 'invalid-request'
  | 'missing-api-key'
  | 'provider-error'
  | 'invalid-response';

export type Tank01UnavailableResult = Readonly<{
  status: 'unavailable';
  season: string;
  week: number;
  reason: Tank01UnavailableReason;
  message: string;
  /** Present after a transient provider failure is placed in the short retry backoff. */
  retryAt?: string;
}>;

export type Tank01ProjectionResult = Tank01AvailableResult | Tank01UnavailableResult;

export type Tank01ProjectionProvider = Readonly<{
  getWeeklyProjections: (season: string, week: number) => Promise<Tank01ProjectionResult>;
}>;

export type Tank01ProviderOptions = Readonly<{
  /** Undefined reads TANK01_API_KEY at request time; null deliberately disables the provider. */
  apiKey?: string | null;
  fetch?: typeof fetch;
  now?: () => number;
  successCacheMs?: number;
  failureBackoffMs?: number;
}>;

type CacheEntry<T> = Readonly<{ value: T; expiresAt: number }>;

type NormalizedPlayerProjection = Readonly<{
  tank01PlayerId: string;
  team: string | null;
  position: string | null;
  stats: Tank01PlayerStats;
  scoringProjection: NormalizedTank01OffenseProjection | NormalizedTank01KickerProjection;
  missingFields: readonly string[];
}>;

type NormalizedProjectionSlate = Readonly<{
  fetchedAtMs: number;
  playersByTank01Id: Readonly<Record<string, NormalizedPlayerProjection>>;
  defensesByTeam: Readonly<Record<string, Tank01DefenseProjection>>;
  playerProjectionRows: number;
  malformedPlayerProjections: number;
  incompletePlayerProjections: number;
  defenseProjectionRows: number;
  malformedDefenseProjections: number;
  incompleteDefenseProjections: number;
}>;

type NormalizedCrosswalk = Readonly<{
  sleeperIdByTank01Id: Readonly<Record<string, string>>;
  playerListRows: number;
  malformedPlayerListRows: number;
  ambiguousPlayerListRows: number;
}>;

class Tank01ProviderFailure extends Error {
  constructor(readonly reason: 'provider-error' | 'invalid-response') {
    super(reason);
    this.name = 'Tank01ProviderFailure';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nullRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function copyToNullRecord<T>(source: Readonly<Record<string, T>>): Record<string, T> {
  const copy = nullRecord<T>();
  for (const [key, value] of Object.entries(source)) copy[key] = value;
  return copy;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function canonicalTeam(value: unknown): string | null {
  const abbreviation = nonEmptyText(value)?.toUpperCase();
  if (!abbreviation) return null;
  const canonical = teamAliases.get(abbreviation) ?? abbreviation;
  return nflTeams.has(canonical) ? canonical : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueAt(record: Record<string, unknown> | null, field: string, path: string, missing: string[]): number | null {
  const value = record ? finiteNumber(record[field]) : null;
  if (value === null) missing.push(path);
  return value;
}

function playerStats(row: Record<string, unknown>): { stats: Tank01PlayerStats; missingFields: string[]; valueCount: number } {
  const missingFields: string[] = [];
  const passing = isRecord(row.Passing) ? row.Passing : null;
  const rushing = isRecord(row.Rushing) ? row.Rushing : null;
  const receiving = isRecord(row.Receiving) ? row.Receiving : null;
  const kicking = isRecord(row.Kicking) ? row.Kicking : null;
  const position = nonEmptyText(row.pos)?.toUpperCase();
  const isKicker = position === 'K' || position === 'PK';
  const validatePassing = !isKicker || passing !== null;
  const validateRushing = !isKicker || rushing !== null;
  const validateReceiving = !isKicker || receiving !== null;
  const validateMisc = !isKicker
    || Object.prototype.hasOwnProperty.call(row, 'twoPointConversion')
    || Object.prototype.hasOwnProperty.call(row, 'fumblesLost');
  // Tank01 documents Kicking as optional. Its absence is expected for non-kickers and must
  // remain unknown rather than being manufactured as four zeroes.
  const validateKicking = kicking !== null || isKicker;
  const positionValue = (
    record: Record<string, unknown> | null,
    field: string,
    path: string,
    validate: boolean,
  ): number | null => (validate ? valueAt(record, field, path, missingFields) : null);
  const kickingValue = (field: string, path: string): number | null => (
    validateKicking ? valueAt(kicking, field, path, missingFields) : null
  );
  const stats: Tank01PlayerStats = {
    passing: {
      attempts: positionValue(passing, 'passAttempts', 'Passing.passAttempts', validatePassing),
      completions: positionValue(passing, 'passCompletions', 'Passing.passCompletions', validatePassing),
      yards: positionValue(passing, 'passYds', 'Passing.passYds', validatePassing),
      touchdowns: positionValue(passing, 'passTD', 'Passing.passTD', validatePassing),
      interceptions: positionValue(passing, 'int', 'Passing.int', validatePassing),
    },
    rushing: {
      carries: positionValue(rushing, 'carries', 'Rushing.carries', validateRushing),
      yards: positionValue(rushing, 'rushYds', 'Rushing.rushYds', validateRushing),
      touchdowns: positionValue(rushing, 'rushTD', 'Rushing.rushTD', validateRushing),
    },
    receiving: {
      targets: positionValue(receiving, 'targets', 'Receiving.targets', validateReceiving),
      receptions: positionValue(receiving, 'receptions', 'Receiving.receptions', validateReceiving),
      yards: positionValue(receiving, 'recYds', 'Receiving.recYds', validateReceiving),
      touchdowns: positionValue(receiving, 'recTD', 'Receiving.recTD', validateReceiving),
    },
    kicking: {
      fieldGoalsMade: kickingValue('fgMade', 'Kicking.fgMade'),
      fieldGoalsMissed: kickingValue('fgMissed', 'Kicking.fgMissed'),
      extraPointsMade: kickingValue('xpMade', 'Kicking.xpMade'),
      extraPointsMissed: kickingValue('xpMissed', 'Kicking.xpMissed'),
    },
    twoPointConversions: positionValue(row, 'twoPointConversion', 'twoPointConversion', validateMisc),
    fumblesLost: positionValue(row, 'fumblesLost', 'fumblesLost', validateMisc),
  };
  const values = [
    ...Object.values(stats.passing),
    ...Object.values(stats.rushing),
    ...Object.values(stats.receiving),
    ...Object.values(stats.kicking),
    stats.twoPointConversions,
    stats.fumblesLost,
  ];
  return { stats, missingFields, valueCount: values.filter((value) => value !== null).length };
}

function defenseStats(row: Record<string, unknown>): { stats: Tank01DefenseStats; missingFields: string[]; valueCount: number } {
  const missingFields: string[] = [];
  const stats: Tank01DefenseStats = {
    returnTouchdowns: valueAt(row, 'returnTD', 'returnTD', missingFields),
    defensiveTouchdowns: valueAt(row, 'defTD', 'defTD', missingFields),
    safeties: valueAt(row, 'safeties', 'safeties', missingFields),
    fumbleRecoveries: valueAt(row, 'fumbleRecoveries', 'fumbleRecoveries', missingFields),
    pointsAllowed: valueAt(row, 'ptsAgainst', 'ptsAgainst', missingFields),
    interceptions: valueAt(row, 'interceptions', 'interceptions', missingFields),
    sacks: valueAt(row, 'sacks', 'sacks', missingFields),
    blockedKicks: valueAt(row, 'blockKick', 'blockKick', missingFields),
  };
  return { stats, missingFields, valueCount: 8 - missingFields.length };
}

function providerBody(envelope: unknown): unknown {
  if (!isRecord(envelope)) throw new Tank01ProviderFailure('invalid-response');
  if (Object.prototype.hasOwnProperty.call(envelope, 'error')
    && envelope.error !== undefined && envelope.error !== null && envelope.error !== '') {
    throw new Tank01ProviderFailure('provider-error');
  }
  const statusCode = finiteNumber(envelope.statusCode);
  if (statusCode !== 200 || !Object.prototype.hasOwnProperty.call(envelope, 'body')) {
    throw new Tank01ProviderFailure('invalid-response');
  }
  return envelope.body;
}

function normalizeCrosswalk(envelope: unknown): NormalizedCrosswalk {
  const body = providerBody(envelope);
  if (!Array.isArray(body) || body.length === 0) throw new Tank01ProviderFailure('invalid-response');

  const candidates: Array<readonly [string, string]> = [];
  let malformedPlayerListRows = 0;
  for (const value of body) {
    if (!isRecord(value)) {
      malformedPlayerListRows += 1;
      continue;
    }
    const tank01PlayerId = nonEmptyText(value.playerID);
    const sleeperPlayerId = nonEmptyText(value.sleeperBotID);
    if (!tank01PlayerId || !sleeperPlayerId) {
      malformedPlayerListRows += 1;
      continue;
    }
    candidates.push([tank01PlayerId, sleeperPlayerId]);
  }

  const sleepersByTank01 = new Map<string, Set<string>>();
  const tank01BySleeper = new Map<string, Set<string>>();
  for (const [tank01PlayerId, sleeperPlayerId] of candidates) {
    const sleeperIds = sleepersByTank01.get(tank01PlayerId) ?? new Set<string>();
    sleeperIds.add(sleeperPlayerId);
    sleepersByTank01.set(tank01PlayerId, sleeperIds);
    const tank01Ids = tank01BySleeper.get(sleeperPlayerId) ?? new Set<string>();
    tank01Ids.add(tank01PlayerId);
    tank01BySleeper.set(sleeperPlayerId, tank01Ids);
  }

  const sleeperIdByTank01Id = nullRecord<string>();
  let ambiguousPlayerListRows = 0;
  for (const [tank01PlayerId, sleeperPlayerId] of candidates) {
    if (sleepersByTank01.get(tank01PlayerId)?.size !== 1 || tank01BySleeper.get(sleeperPlayerId)?.size !== 1) {
      ambiguousPlayerListRows += 1;
      continue;
    }
    sleeperIdByTank01Id[tank01PlayerId] = sleeperPlayerId;
  }
  if (Object.keys(sleeperIdByTank01Id).length === 0) throw new Tank01ProviderFailure('invalid-response');

  return {
    sleeperIdByTank01Id,
    playerListRows: body.length,
    malformedPlayerListRows,
    ambiguousPlayerListRows,
  };
}

function projectionId(mapKey: string, row: Record<string, unknown>): string | null {
  const keyId = nonEmptyText(mapKey);
  const rowId = nonEmptyText(row.playerID);
  if (keyId && rowId && keyId !== rowId) return null;
  return rowId ?? keyId;
}

function normalizeProjectionSlate(envelope: unknown, fetchedAtMs: number): NormalizedProjectionSlate {
  const body = providerBody(envelope);
  if (!isRecord(body) || !isRecord(body.playerProjections) || !isRecord(body.teamDefenseProjections)) {
    throw new Tank01ProviderFailure('invalid-response');
  }

  const playerRows = Object.entries(body.playerProjections);
  const defenseRows = Object.entries(body.teamDefenseProjections);
  if (playerRows.length + defenseRows.length === 0) throw new Tank01ProviderFailure('invalid-response');

  const playersByTank01Id = nullRecord<NormalizedPlayerProjection>();
  const duplicatePlayerIds = new Set<string>();
  let malformedPlayerProjections = 0;
  let incompletePlayerProjections = 0;
  for (const [key, value] of playerRows) {
    if (!isRecord(value)) {
      malformedPlayerProjections += 1;
      continue;
    }
    const tank01PlayerId = projectionId(key, value);
    const normalized = playerStats(value);
    if (!tank01PlayerId || normalized.valueCount === 0 || duplicatePlayerIds.has(tank01PlayerId)) {
      malformedPlayerProjections += 1;
      continue;
    }
    if (playersByTank01Id[tank01PlayerId]) {
      delete playersByTank01Id[tank01PlayerId];
      duplicatePlayerIds.add(tank01PlayerId);
      malformedPlayerProjections += 2;
      continue;
    }
    if (normalized.missingFields.length > 0) incompletePlayerProjections += 1;
    const position = nonEmptyText(value.pos)?.toUpperCase() ?? null;
    const isKicker = position === 'K' || position === 'PK';
    const scoringProjection: NormalizedTank01OffenseProjection | NormalizedTank01KickerProjection = isKicker
      ? {
          kind: 'kicker',
          fieldGoalsMade: normalized.stats.kicking.fieldGoalsMade,
          fieldGoalsMissed: normalized.stats.kicking.fieldGoalsMissed,
          extraPointsMade: normalized.stats.kicking.extraPointsMade,
          extraPointsMissed: normalized.stats.kicking.extraPointsMissed,
        }
      : {
          kind: 'offense',
          passingYards: normalized.stats.passing.yards,
          passingTouchdowns: normalized.stats.passing.touchdowns,
          passingInterceptions: normalized.stats.passing.interceptions,
          rushingYards: normalized.stats.rushing.yards,
          rushingTouchdowns: normalized.stats.rushing.touchdowns,
          receptions: normalized.stats.receiving.receptions,
          receivingYards: normalized.stats.receiving.yards,
          receivingTouchdowns: normalized.stats.receiving.touchdowns,
          twoPointConversions: normalized.stats.twoPointConversions,
          fumblesLost: normalized.stats.fumblesLost,
        };
    playersByTank01Id[tank01PlayerId] = {
      tank01PlayerId,
      team: canonicalTeam(value.team),
      position,
      stats: normalized.stats,
      scoringProjection,
      missingFields: normalized.missingFields,
    };
  }

  const defensesByTeam = nullRecord<Tank01DefenseProjection>();
  const duplicateDefenseTeams = new Set<string>();
  let malformedDefenseProjections = 0;
  let incompleteDefenseProjections = 0;
  for (const [key, value] of defenseRows) {
    if (!isRecord(value)) {
      malformedDefenseProjections += 1;
      continue;
    }
    const keyTeam = canonicalTeam(key);
    const rowTeam = canonicalTeam(value.teamAbv);
    const team = rowTeam ?? keyTeam;
    const normalized = defenseStats(value);
    if (!team || (keyTeam && rowTeam && keyTeam !== rowTeam) || normalized.valueCount === 0
      || duplicateDefenseTeams.has(team)) {
      malformedDefenseProjections += 1;
      continue;
    }
    if (defensesByTeam[team]) {
      delete defensesByTeam[team];
      duplicateDefenseTeams.add(team);
      malformedDefenseProjections += 2;
      continue;
    }
    if (normalized.missingFields.length > 0) incompleteDefenseProjections += 1;
    defensesByTeam[team] = {
      team,
      stats: normalized.stats,
      scoringProjection: {
        kind: 'defense',
        sacks: normalized.stats.sacks,
        interceptions: normalized.stats.interceptions,
        fumbleRecoveries: normalized.stats.fumbleRecoveries,
        defensiveTouchdowns: normalized.stats.defensiveTouchdowns,
        specialTeamsTouchdowns: normalized.stats.returnTouchdowns,
        safeties: normalized.stats.safeties,
        blockedKicks: normalized.stats.blockedKicks,
        pointsAllowed: normalized.stats.pointsAllowed,
      },
      missingFields: normalized.missingFields,
    };
  }

  if (Object.keys(playersByTank01Id).length + Object.keys(defensesByTeam).length === 0) {
    throw new Tank01ProviderFailure('invalid-response');
  }

  return {
    fetchedAtMs,
    playersByTank01Id,
    defensesByTeam,
    playerProjectionRows: playerRows.length,
    malformedPlayerProjections,
    incompletePlayerProjections,
    defenseProjectionRows: defenseRows.length,
    malformedDefenseProjections,
    incompleteDefenseProjections,
  };
}

function warningMessages(coverage: Tank01ProjectionCoverage): string[] {
  const warnings: string[] = [];
  if (coverage.malformedPlayerListRows > 0 || coverage.ambiguousPlayerListRows > 0) {
    warnings.push('Some Tank01 player identifiers could not be safely matched to Sleeper.');
  }
  if (coverage.unmatchedPlayerProjections > 0) {
    warnings.push('Some Tank01 player projections did not have a Sleeper player identifier.');
  }
  if (coverage.malformedPlayerProjections > 0 || coverage.malformedDefenseProjections > 0) {
    warnings.push('Some malformed Tank01 projection rows were ignored.');
  }
  if (coverage.incompletePlayerProjections > 0 || coverage.incompleteDefenseProjections > 0) {
    warnings.push('Some Tank01 projection rows are missing one or more projected statistics.');
  }
  if (coverage.matchedPlayerProjections === 0) {
    warnings.push('Tank01 did not provide any player projections that could be matched to Sleeper.');
  }
  if (coverage.usableDefenseProjections === 0) {
    warnings.push('Tank01 did not provide any usable team defense projections.');
  }
  return warnings;
}

function joinSlate(
  season: string,
  week: number,
  slate: NormalizedProjectionSlate,
  crosswalk: NormalizedCrosswalk,
): Tank01AvailableResult {
  const bySleeperId = nullRecord<Tank01PlayerProjection>();
  let unmatchedPlayerProjections = 0;
  for (const [tank01PlayerId, projection] of Object.entries(slate.playersByTank01Id)) {
    const sleeperPlayerId = crosswalk.sleeperIdByTank01Id[tank01PlayerId];
    if (!sleeperPlayerId) {
      unmatchedPlayerProjections += 1;
      continue;
    }
    bySleeperId[sleeperPlayerId] = { ...projection, sleeperPlayerId };
  }

  const coverage: Tank01ProjectionCoverage = {
    playerListRows: crosswalk.playerListRows,
    crosswalkEntries: Object.keys(crosswalk.sleeperIdByTank01Id).length,
    malformedPlayerListRows: crosswalk.malformedPlayerListRows,
    ambiguousPlayerListRows: crosswalk.ambiguousPlayerListRows,
    playerProjectionRows: slate.playerProjectionRows,
    matchedPlayerProjections: Object.keys(bySleeperId).length,
    unmatchedPlayerProjections,
    malformedPlayerProjections: slate.malformedPlayerProjections,
    incompletePlayerProjections: slate.incompletePlayerProjections,
    defenseProjectionRows: slate.defenseProjectionRows,
    usableDefenseProjections: Object.keys(slate.defensesByTeam).length,
    malformedDefenseProjections: slate.malformedDefenseProjections,
    incompleteDefenseProjections: slate.incompleteDefenseProjections,
  };

  return {
    status: 'available',
    season,
    week,
    fetchedAt: new Date(slate.fetchedAtMs).toISOString(),
    projections: { bySleeperId, byDefenseTeam: slate.defensesByTeam },
    coverage,
    warnings: warningMessages(coverage),
  };
}

function validSeason(value: string): boolean {
  return /^20\d{2}$/u.test(value);
}

function validWeek(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 18;
}

function unavailable(
  season: string,
  week: number,
  reason: Tank01UnavailableReason,
  retryAtMs?: number,
): Tank01UnavailableResult {
  const message = reason === 'missing-api-key'
    ? 'Player projections are not configured.'
    : reason === 'invalid-request'
      ? 'Player projections are unavailable for the requested season or week.'
      : 'Player projections are temporarily unavailable.';
  return {
    status: 'unavailable',
    season,
    week,
    reason,
    message,
    ...(retryAtMs === undefined ? {} : { retryAt: new Date(retryAtMs).toISOString() }),
  };
}

async function fetchEnvelope(request: typeof fetch, path: string, apiKey: string): Promise<unknown> {
  let response: Response;
  try {
    response = await request(`${RAPID_API_ORIGIN}${path}`, {
      method: 'GET',
      cache: 'no-store',
      // Custom authentication headers can survive a cross-origin redirect in Node fetch.
      // Refuse redirects so RapidAPI cannot accidentally forward the credential elsewhere.
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'x-rapidapi-host': RAPID_API_HOST,
        'x-rapidapi-key': apiKey,
      },
    });
  } catch {
    throw new Tank01ProviderFailure('provider-error');
  }
  if (!response.ok) throw new Tank01ProviderFailure('provider-error');
  try {
    return await response.json();
  } catch {
    throw new Tank01ProviderFailure('invalid-response');
  }
}

function projectionPath(season: string, week: number): string {
  return `/getNFLProjections?week=${week}&archiveSeason=${encodeURIComponent(season)}&itemFormat=map`;
}

/** Next's persistent cache deserializes records with Object.prototype; restore safe lookup tables at its boundary. */
function rehydrateProjectionSlate(slate: NormalizedProjectionSlate): NormalizedProjectionSlate {
  return {
    ...slate,
    playersByTank01Id: copyToNullRecord(slate.playersByTank01Id),
    defensesByTeam: copyToNullRecord(slate.defensesByTeam),
  };
}

/** Next's persistent cache deserializes records with Object.prototype; restore safe lookup tables at its boundary. */
function rehydrateCrosswalk(crosswalk: NormalizedCrosswalk): NormalizedCrosswalk {
  return {
    ...crosswalk,
    sleeperIdByTank01Id: copyToNullRecord(crosswalk.sleeperIdByTank01Id),
  };
}

export function createTank01ProjectionProvider(options: Tank01ProviderOptions = {}): Tank01ProjectionProvider {
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const successCacheMs = options.successCacheMs ?? SUCCESS_CACHE_MS;
  const failureBackoffMs = options.failureBackoffMs ?? FAILURE_BACKOFF_MS;
  const projectionCache = new Map<string, CacheEntry<NormalizedProjectionSlate>>();
  const projectionRequests = new Map<string, Promise<NormalizedProjectionSlate>>();
  let crosswalkCache: CacheEntry<NormalizedCrosswalk> | null = null;
  let crosswalkRequest: Promise<NormalizedCrosswalk> | null = null;
  const failureCache = new Map<string, CacheEntry<Tank01UnavailableResult>>();

  const configuredKey = (): string | null => {
    const value = options.apiKey === undefined ? process.env.TANK01_API_KEY : options.apiKey;
    return nonEmptyText(value);
  };

  const projectionsFor = async (season: string, week: number, apiKey: string): Promise<NormalizedProjectionSlate> => {
    const cacheKey = `${season}:${week}`;
    const timestamp = now();
    const cached = projectionCache.get(cacheKey);
    if (cached && cached.expiresAt > timestamp) return cached.value;
    const pending = projectionRequests.get(cacheKey);
    if (pending) return pending;

    const loading = (async () => {
      const envelope = await fetchEnvelope(request, projectionPath(season, week), apiKey);
      const fetchedAtMs = now();
      const normalized = normalizeProjectionSlate(envelope, fetchedAtMs);
      projectionCache.set(cacheKey, { value: normalized, expiresAt: fetchedAtMs + successCacheMs });
      return normalized;
    })();
    projectionRequests.set(cacheKey, loading);
    try {
      return await loading;
    } finally {
      projectionRequests.delete(cacheKey);
    }
  };

  const playerCrosswalk = async (apiKey: string): Promise<NormalizedCrosswalk> => {
    const timestamp = now();
    if (crosswalkCache && crosswalkCache.expiresAt > timestamp) return crosswalkCache.value;
    if (crosswalkRequest) return crosswalkRequest;
    crosswalkRequest = (async () => {
      const envelope = await fetchEnvelope(request, '/getNFLPlayerList', apiKey);
      const normalized = normalizeCrosswalk(envelope);
      crosswalkCache = { value: normalized, expiresAt: now() + successCacheMs };
      return normalized;
    })();
    try {
      return await crosswalkRequest;
    } finally {
      crosswalkRequest = null;
    }
  };

  const getWeeklyProjections = async (season: string, week: number): Promise<Tank01ProjectionResult> => {
    if (!validSeason(season) || !validWeek(week)) return unavailable(season, week, 'invalid-request');
    const apiKey = configuredKey();
    if (!apiKey) return unavailable(season, week, 'missing-api-key');

    const cacheKey = `${season}:${week}`;
    const timestamp = now();
    const recentFailure = failureCache.get(cacheKey);
    if (recentFailure && recentFailure.expiresAt > timestamp) return recentFailure.value;
    failureCache.delete(cacheKey);

    try {
      const [slate, crosswalk] = await Promise.all([
        projectionsFor(season, week, apiKey),
        playerCrosswalk(apiKey),
      ]);
      return joinSlate(season, week, slate, crosswalk);
    } catch (error) {
      const reason = error instanceof Tank01ProviderFailure ? error.reason : 'provider-error';
      const retryAtMs = now() + failureBackoffMs;
      const result = unavailable(season, week, reason, retryAtMs);
      failureCache.set(cacheKey, { value: result, expiresAt: retryAtMs });
      return result;
    }
  };

  return { getWeeklyProjections };
}

const sharedProjectionSlate = unstable_cache(
  async (season: string, week: number): Promise<NormalizedProjectionSlate> => {
    // The credential stays inside this function. It is never an argument or a key part, so
    // unstable_cache cannot incorporate it into its persistent cache key.
    const apiKey = nonEmptyText(process.env.TANK01_API_KEY);
    if (!apiKey) throw new Tank01ProviderFailure('provider-error');
    const envelope = await fetchEnvelope(globalThis.fetch, projectionPath(season, week), apiKey);
    return normalizeProjectionSlate(envelope, Date.now());
  },
  ['tank01-normalized-projection-slate-v1'],
  { revalidate: SUCCESS_CACHE_SECONDS },
);

const sharedPlayerCrosswalk = unstable_cache(
  async (): Promise<NormalizedCrosswalk> => {
    // As above, the credential is used only to authenticate the uncached upstream request.
    const apiKey = nonEmptyText(process.env.TANK01_API_KEY);
    if (!apiKey) throw new Tank01ProviderFailure('provider-error');
    const envelope = await fetchEnvelope(globalThis.fetch, '/getNFLPlayerList', apiKey);
    return normalizeCrosswalk(envelope);
  },
  ['tank01-normalized-player-crosswalk-v1'],
  { revalidate: SUCCESS_CACHE_SECONDS },
);

const sharedFailureCache = new Map<string, CacheEntry<Tank01UnavailableResult>>();

/**
 * Loads one complete Tank01 week and returns raw normalized stat lines keyed by Sleeper player ID
 * and canonical NFL defense abbreviation. This function never throws for provider/config failures.
 */
export async function getTank01WeeklyProjections(season: string, week: number): Promise<Tank01ProjectionResult> {
  if (!validSeason(season) || !validWeek(week)) return unavailable(season, week, 'invalid-request');
  if (!nonEmptyText(process.env.TANK01_API_KEY)) return unavailable(season, week, 'missing-api-key');

  const cacheKey = `${season}:${week}`;
  const timestamp = Date.now();
  const recentFailure = sharedFailureCache.get(cacheKey);
  if (recentFailure && recentFailure.expiresAt > timestamp) return recentFailure.value;
  sharedFailureCache.delete(cacheKey);

  try {
    const [slate, crosswalk] = await Promise.all([
      sharedProjectionSlate(season, week),
      sharedPlayerCrosswalk(),
    ]);
    return joinSlate(
      season,
      week,
      rehydrateProjectionSlate(slate),
      rehydrateCrosswalk(crosswalk),
    );
  } catch (error) {
    // Rejected cache loaders do not produce a persistent Next cache entry. Only this short,
    // process-local backoff is retained for failures.
    const reason = error instanceof Tank01ProviderFailure ? error.reason : 'provider-error';
    const retryAtMs = Date.now() + FAILURE_BACKOFF_MS;
    const result = unavailable(season, week, reason, retryAtMs);
    sharedFailureCache.set(cacheKey, { value: result, expiresAt: retryAtMs });
    return result;
  }
}
