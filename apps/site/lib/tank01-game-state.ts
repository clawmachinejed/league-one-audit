import 'server-only';

import {
  normalizeGamePhase,
  parseGameClockSeconds,
  resolveGameTime,
  type NflGamePhase,
  type NflGameStatusCode,
} from './game-time';
import { canonicalNflTeam, type NflTeam } from './nfl-teams';

const RAPID_API_HOST = 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com';
const RAPID_API_ORIGIN = `https://${RAPID_API_HOST}`;
const REQUEST_TIMEOUT_MS = 15_000;

export type Tank01GameState = Readonly<{
  /** Opaque Tank01 identifier. Consumers must never parse or construct this value. */
  gameId: string;
  season: string;
  week: number;
  homeTeam: NflTeam;
  awayTeam: NflTeam;
  statusCode: NflGameStatusCode;
  statusText: string | null;
  /** Raw provider period retained for diagnostics; phase is the normalized value. */
  period: string | null;
  /** Raw provider clock retained for diagnostics when its sources agree. */
  clock: string | null;
  phase: NflGamePhase;
  clockSeconds: number | null;
  /** Null requires the projection worker to retain the last valid calculated result. */
  remainingFraction: number | null;
  requestStartedAt: string;
  requestCompletedAt: string;
  fetchedAt: string;
}>;

export type Tank01GameStatesAvailable = Readonly<{
  status: 'available';
  season: string;
  week: number;
  requestStartedAt: string;
  requestCompletedAt: string;
  fetchedAt: string;
  games: readonly Tank01GameState[];
  byTeam: Readonly<Record<string, Tank01GameState>>;
}>;

export type Tank01GameStatesUnavailableReason =
  | 'invalid-request'
  | 'missing-api-key'
  | 'provider-error'
  | 'invalid-response';

export type Tank01GameStatesUnavailable = Readonly<{
  status: 'unavailable';
  season: string;
  week: number;
  reason: Tank01GameStatesUnavailableReason;
  message: string;
}>;

export type Tank01GameStatesResult = Tank01GameStatesAvailable | Tank01GameStatesUnavailable;

export type Tank01GameStateProvider = Readonly<{
  getWeeklyGameStates: (season: string, week: number) => Promise<Tank01GameStatesResult>;
}>;

export type Tank01GameStateProviderOptions = Readonly<{
  /** Undefined reads TANK01_API_KEY at request time; null deliberately disables the provider. */
  apiKey?: string | null;
  fetch?: typeof fetch;
  now?: () => number;
  requestTimeoutMs?: number;
}>;

class Tank01GameStateFailure extends Error {
  constructor(readonly reason: 'provider-error' | 'invalid-response') {
    super(reason);
    this.name = 'Tank01GameStateFailure';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nullRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function providerStatus(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value !== 'string' || !/^\d+$/u.test(value.trim())) return null;
  return Number(value.trim());
}

function gameStatusCode(value: unknown): NflGameStatusCode | null {
  const parsed = providerStatus(value);
  return parsed !== null && parsed >= 0 && parsed <= 4 ? parsed as NflGameStatusCode : null;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new Tank01GameStateFailure('invalid-response');
  return value;
}

function isoTime(value: number): string {
  if (!Number.isFinite(value)) throw new Tank01GameStateFailure('invalid-response');
  try {
    return new Date(value).toISOString();
  } catch {
    throw new Tank01GameStateFailure('invalid-response');
  }
}

function equivalentLivePhase(statusCode: NflGameStatusCode, first: string, second: string): boolean {
  return normalizeGamePhase(statusCode, first) === normalizeGamePhase(statusCode, second);
}

function periodFrom(row: Record<string, unknown>, lineScore: Record<string, unknown> | null): string | null {
  const values = [
    nonEmptyText(lineScore?.period),
    nonEmptyText(row.currentPeriod),
    nonEmptyText(row.period),
  ].filter((value): value is string => value !== null);
  if (values.length === 0) return null;
  if (values.slice(1).some((value) => !equivalentLivePhase(1, values[0], value))) return null;
  return values[0];
}

function clockFrom(row: Record<string, unknown>, lineScore: Record<string, unknown> | null): string | null {
  const values = [nonEmptyText(row.gameClock), nonEmptyText(lineScore?.gameClock)]
    .filter((value): value is string => value !== null);
  if (values.length === 0) return null;
  const seconds = values.map(parseGameClockSeconds);
  if (seconds.some((value) => value === null) || seconds.some((value) => value !== seconds[0])) return null;
  return values[0];
}

function gameIdFrom(mapKey: string, row: Record<string, unknown>): string | null {
  const keyId = nonEmptyText(mapKey);
  const rowId = nonEmptyText(row.gameID);
  if (!keyId || (rowId && rowId !== keyId)) return null;
  return rowId ?? keyId;
}

/**
 * Strictly validates one complete Tank01 response boundary. A malformed row rejects
 * the observation so an atomic caller can retain its prior complete league snapshot.
 */
export function normalizeTank01GameStates(
  envelope: unknown,
  season: string,
  week: number,
  requestStartedAtMs: number,
  requestCompletedAtMs: number,
): Tank01GameStatesAvailable {
  if (!isRecord(envelope)) throw new Tank01GameStateFailure('invalid-response');
  const status = providerStatus(envelope.statusCode);
  if (status === null) throw new Tank01GameStateFailure('invalid-response');
  if (status !== 200 || (envelope.error !== undefined && envelope.error !== null)) {
    throw new Tank01GameStateFailure('provider-error');
  }
  if (!isRecord(envelope.body)) throw new Tank01GameStateFailure('invalid-response');

  const rows = Object.entries(envelope.body);
  if (rows.length === 0 || rows.length > 16) throw new Tank01GameStateFailure('invalid-response');
  if (requestCompletedAtMs < requestStartedAtMs) throw new Tank01GameStateFailure('invalid-response');

  const requestStartedAt = isoTime(requestStartedAtMs);
  const requestCompletedAt = isoTime(requestCompletedAtMs);
  const fetchedAt = requestCompletedAt;
  const games: Tank01GameState[] = [];
  const byTeam = nullRecord<Tank01GameState>();
  const gameIds = new Set<string>();

  for (const [mapKey, value] of rows) {
    if (!isRecord(value)) throw new Tank01GameStateFailure('invalid-response');
    const gameId = gameIdFrom(mapKey, value);
    const homeTeam = canonicalNflTeam(value.home);
    const awayTeam = canonicalNflTeam(value.away);
    const statusCode = gameStatusCode(value.gameStatusCode);
    if (!gameId || !homeTeam || !awayTeam || homeTeam === awayTeam || statusCode === null
      || gameIds.has(gameId) || byTeam[homeTeam] || byTeam[awayTeam]) {
      throw new Tank01GameStateFailure('invalid-response');
    }

    const lineScore = optionalRecord(value.lineScore);
    const period = periodFrom(value, lineScore);
    const clock = clockFrom(value, lineScore);
    const statusText = nonEmptyText(value.gameStatus);
    const time = resolveGameTime({ statusCode, period, statusText, clock });
    const game: Tank01GameState = {
      gameId,
      season,
      week,
      homeTeam,
      awayTeam,
      statusCode,
      statusText,
      period,
      clock,
      ...time,
      requestStartedAt,
      requestCompletedAt,
      fetchedAt,
    };
    games.push(game);
    gameIds.add(gameId);
    byTeam[homeTeam] = game;
    byTeam[awayTeam] = game;
  }

  return {
    status: 'available',
    season,
    week,
    requestStartedAt,
    requestCompletedAt,
    fetchedAt,
    games,
    byTeam,
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
  reason: Tank01GameStatesUnavailableReason,
): Tank01GameStatesUnavailable {
  const message = reason === 'missing-api-key'
    ? 'Live game states are not configured.'
    : reason === 'invalid-request'
      ? 'Live game states are unavailable for the requested season or week.'
      : 'Live game states are temporarily unavailable.';
  return { status: 'unavailable', season, week, reason, message };
}

function weeklyGameStatesPath(season: string, week: number): string {
  const query = new URLSearchParams({
    gameWeek: String(week),
    season,
    seasonType: 'reg',
    topPerformers: 'false',
  });
  return `/getNFLScoresOnly?${query.toString()}`;
}

export function createTank01GameStateProvider(
  options: Tank01GameStateProviderOptions = {},
): Tank01GameStateProvider {
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

  const configuredKey = (): string | null => {
    const value = options.apiKey === undefined ? process.env.TANK01_API_KEY : options.apiKey;
    return nonEmptyText(value);
  };

  const getWeeklyGameStates = async (season: string, week: number): Promise<Tank01GameStatesResult> => {
    if (!validSeason(season) || !validWeek(week)) return unavailable(season, week, 'invalid-request');
    const apiKey = configuredKey();
    if (!apiKey) return unavailable(season, week, 'missing-api-key');

    const requestStartedAtMs = now();
    let response: Response;
    try {
      response = await request(`${RAPID_API_ORIGIN}${weeklyGameStatesPath(season, week)}`, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: 'application/json',
          'x-rapidapi-host': RAPID_API_HOST,
          'x-rapidapi-key': apiKey,
        },
      });
    } catch {
      return unavailable(season, week, 'provider-error');
    }
    if (!response.ok) return unavailable(season, week, 'provider-error');

    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      return unavailable(season, week, 'invalid-response');
    }
    const requestCompletedAtMs = now();
    try {
      return normalizeTank01GameStates(envelope, season, week, requestStartedAtMs, requestCompletedAtMs);
    } catch (error) {
      const reason = error instanceof Tank01GameStateFailure ? error.reason : 'invalid-response';
      return unavailable(season, week, reason);
    }
  };

  return { getWeeklyGameStates };
}

/** Loads one uncached weekly NFL game-state observation from Tank01. */
export async function getTank01WeeklyGameStates(season: string, week: number): Promise<Tank01GameStatesResult> {
  return createTank01GameStateProvider().getWeeklyGameStates(season, week);
}
