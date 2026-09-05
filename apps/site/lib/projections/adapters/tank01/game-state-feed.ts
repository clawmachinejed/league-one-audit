import 'server-only';
import { startProviderHttp } from '../../../provider-request-telemetry';

import {
  normalizeGamePhase,
  parseGameClockSeconds,
  resolveGameTime,
} from '../../../game-time';
import { canonicalNflTeam } from '../../../nfl-teams';
import type {
  GameStateObservation,
  GameStateSlate,
  LeaguePeriod,
  NflGameStatusCode,
} from '../../domain/contracts';
import type { GameStateFeedPort, GameStateFeedResult } from '../../ports/game-state-feed';
import { externalGameRef, type ProviderKey } from '../../shared/provider-identity';
import { compatibleRevision } from '../../shared/revision-compatibility';

const RAPID_API_HOST = 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com';
const RAPID_API_ORIGIN = `https://${RAPID_API_HOST}`;
const REQUEST_TIMEOUT_MS = 15_000;

export type Tank01GameStateFeedOptions = Readonly<{
  /** Credentials are injected by runtime composition. */
  apiKey: string | null;
  provider: ProviderKey;
  fetch: typeof fetch;
  now: () => number;
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

type OptionalProviderText =
  | Readonly<{ kind: 'missing' }>
  | Readonly<{ kind: 'value'; value: string }>
  | Readonly<{ kind: 'conflict' }>
  | Readonly<{ kind: 'invalid' }>;

function normalizedProviderText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toUpperCase();
}

function livePhaseComparisonKey(value: string): string {
  const phase = normalizeGamePhase(1, value);
  return phase === 'unknown'
    ? `opaque:${normalizedProviderText(value)}`
    : `phase:${phase}`;
}

function periodFrom(
  row: Record<string, unknown>,
  lineScore: Record<string, unknown> | null,
): OptionalProviderText {
  const values = [
    nonEmptyText(lineScore?.period),
    nonEmptyText(row.currentPeriod),
    nonEmptyText(row.period),
  ].filter((value): value is string => value !== null);
  if (values.length === 0) return { kind: 'missing' };
  const comparisonKey = livePhaseComparisonKey(values[0]);
  if (values.slice(1).some((value) => livePhaseComparisonKey(value) !== comparisonKey)) {
    return { kind: 'conflict' };
  }
  return { kind: 'value', value: values[0] };
}

function clockFrom(
  row: Record<string, unknown>,
  lineScore: Record<string, unknown> | null,
): OptionalProviderText {
  const values = [nonEmptyText(row.gameClock), nonEmptyText(lineScore?.gameClock)]
    .filter((value): value is string => value !== null);
  if (values.length === 0) return { kind: 'missing' };
  const seconds = values.map(parseGameClockSeconds);
  if (seconds.some((value) => value === null)) return { kind: 'invalid' };
  if (seconds.some((value) => value !== seconds[0])) return { kind: 'conflict' };
  return { kind: 'value', value: values[0] };
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
  period: LeaguePeriod,
  requestStartedAtMs: number,
  requestCompletedAtMs: number,
  provider: ProviderKey,
): GameStateSlate {
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
  const games: GameStateObservation[] = [];
  const byTeam = nullRecord<GameStateObservation>();
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
    const sourcePeriodResult = periodFrom(value, lineScore);
    const clockResult = clockFrom(value, lineScore);
    const sourcePeriod = sourcePeriodResult.kind === 'value' ? sourcePeriodResult.value : null;
    const clock = clockResult.kind === 'value' ? clockResult.value : null;
    const statusText = nonEmptyText(value.gameStatus);
    const sourcePeriodPhase = normalizeGamePhase(1, sourcePeriod);
    const statusTextPhase = normalizeGamePhase(1, undefined, statusText);
    if (statusCode === 1 && (sourcePeriodResult.kind === 'conflict'
      || clockResult.kind === 'conflict' || clockResult.kind === 'invalid'
      || (sourcePeriodPhase !== 'unknown' && statusTextPhase !== 'unknown'
        && sourcePeriodPhase !== statusTextPhase))) {
      throw new Tank01GameStateFailure('invalid-response');
    }
    const time = resolveGameTime({ statusCode, period: sourcePeriod, statusText, clock });
    const game: GameStateObservation = {
      gameRef: externalGameRef(provider, gameId),
      period,
      homeTeam,
      awayTeam,
      statusCode,
      statusText,
      sourcePeriod,
      gameClock: clock,
      ...time,
      homeScore: null,
      awayScore: null,
      requestStartedAt,
      requestCompletedAt,
      observedAt: fetchedAt,
      sourceRevision: compatibleRevision({
        gameId,
        fetchedAt,
        statusCode,
        phase: time.phase,
        clock,
        remainingFraction: time.remainingFraction,
      }),
    };
    games.push(game);
    gameIds.add(gameId);
    byTeam[homeTeam] = game;
    byTeam[awayTeam] = game;
  }

  return {
    source: provider,
    period,
    requestStartedAt,
    requestCompletedAt,
    observedAt: fetchedAt,
    games,
  };
}

function validPeriod(value: LeaguePeriod): boolean {
  return Number.isInteger(value.season)
    && /^20\d{2}$/u.test(String(value.season))
    && value.seasonType === 'regular'
    && Number.isInteger(value.week)
    && value.week >= 1
    && value.week <= 18;
}

function unavailable(
  period: LeaguePeriod,
  reason: Extract<GameStateFeedResult, { status: 'unavailable' }>['reason'],
): GameStateFeedResult {
  const message = reason === 'not-configured'
    ? 'Live game states are not configured.'
    : reason === 'invalid-request'
      ? 'Live game states are unavailable for the requested season or week.'
      : 'Live game states are temporarily unavailable.';
  return { status: 'unavailable', period, reason, message };
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

export function createTank01GameStateFeed(
  options: Tank01GameStateFeedOptions,
): GameStateFeedPort {
  const request = options.fetch;
  const now = options.now;
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

  const configuredKey = (): string | null => nonEmptyText(options.apiKey);

  const getGameStateSlate = async (period: LeaguePeriod): Promise<GameStateFeedResult> => {
    if (!validPeriod(period)) return unavailable(period, 'invalid-request');
    const apiKey = configuredKey();
    if (!apiKey) return unavailable(period, 'not-configured');

    const requestStartedAtMs = now();
    const finished = startProviderHttp('tank01', 'game-states', 'bypass');
    let response: Response;
    try {
      response = await request(`${RAPID_API_ORIGIN}${weeklyGameStatesPath(
        String(period.season),
        period.week,
      )}`, {
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
      finished('unavailable');
      return unavailable(period, 'provider-error');
    }
    if (!response.ok) { finished('unavailable'); return unavailable(period, 'provider-error'); }

    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      finished('invalid');
      return unavailable(period, 'invalid-response');
    }
    const requestCompletedAtMs = now();
    finished('available');
    try {
      return {
        status: 'available',
        slate: normalizeTank01GameStates(
          envelope,
          period,
          requestStartedAtMs,
          requestCompletedAtMs,
          options.provider,
        ),
      };
    } catch (error) {
      const reason = error instanceof Tank01GameStateFailure ? error.reason : 'invalid-response';
      return unavailable(period, reason);
    }
  };

  return { getGameStateSlate };
}
