import { NFL_TEAM_CODES, type GameStateSlate, type NflTeam } from '../domain/contracts';
import type { GameStateDiagnostic, ProjectionLogEntry } from '../ports/logger';

// Exact known messages become fixed labels. Never log raw messages, SQL detail,
// query text, arbitrary constraint names, nested causes, or provider payloads.
const reasons = new Map<string, string>([
  ['game-state regression: source time moved backward', 'game-source-time-regressed'],
  ['game-state regression: final game became non-final', 'game-finality-regressed'],
  ['game-state regression: started game became pregame', 'game-returned-to-pregame'],
  ['game-state regression: live game became postponed', 'game-live-became-postponed'],
  ['game-state regression: interruption status changed ambiguously', 'game-interruption-conflict'],
  ['game-state regression: live period is unavailable', 'game-live-period-unavailable'],
  ['game-state regression: regulation clock is unavailable', 'game-clock-unavailable'],
  ['game-state regression: period moved backward', 'game-period-regressed'],
  ['game-state plausibility: regulation clock advanced faster than elapsed time', 'game-clock-implausible'],
  ['game-state regression: regulation clock increased', 'game-clock-increased'],
  ['An external NFL game ID conflicts with its scheduled game identity.', 'game-identity-conflict'],
  ['NFL games could not be persisted completely.', 'game-identities-incomplete'],
  ['NFL game states could not be persisted completely.', 'game-states-incomplete'],
  ['A game-state batch must contain each external game ID once.', 'game-state-duplicate-id'],
  ['Scoring identities could not be resolved.', 'scoring-identities-unavailable'],
  ['The official identity provider is unavailable.', 'official-identity-provider-unavailable'],
  ['The provider projection slate could not be persisted completely.', 'projection-slate-incomplete'],
  ['projection slate conflict: equal observation time has different semantic content', 'projection-slate-observation-conflict'],
]);

// Only recognized SQLSTATE values are emitted, not merely any five-character string.
const databaseErrorCodes = new Set([
  'P0001', '23502', '23503', '23505', '23514', '22003', '22007', '22008', '22P02',
  '40001', '40P01', '55P03', '57014', '53300', '57P01', '08001', '08003', '08006',
  '08P01', '42501', '42P01', '42703', '42883',
]);

export function providerPersistenceDiagnostics(error: unknown): Pick<ProjectionLogEntry,
  'persistenceFailureReason' | 'databaseErrorCode'> {
  try {
    if (error === null || typeof error !== 'object') return { persistenceFailureReason: 'unclassified' };
    const value = error as { message?: unknown; code?: unknown };
    const message = value.message;
    const code = value.code;
    return {
      persistenceFailureReason: typeof message === 'string' ? reasons.get(message) ?? 'unclassified' : 'unclassified',
      ...(typeof code === 'string' && databaseErrorCodes.has(code) ? { databaseErrorCode: code } : {}),
    };
  } catch {
    // Exotic exception getters must not interfere with the original failure path.
    return { persistenceFailureReason: 'unclassified' };
  }
}

const canonicalTeams = new Set<string>(NFL_TEAM_CODES);
const safePeriods = /^(?:Q?[1-4]|[1-4](?:ST|ND|RD|TH)(?: QUARTER)?|HALFTIME|HALF|HT|OT|OVERTIME|FINAL|PREGAME)$/u;
const summaryLimit = 32;

function diagnosticTime(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : null;
}

function gameDiagnostic(value: unknown): GameStateDiagnostic {
  const empty: GameStateDiagnostic = { homeTeam: null, awayTeam: null, statusCode: null,
    sourcePeriod: null, gameClock: null, observedAt: null, requestCompletedAt: null };
  try {
    if (value === null || typeof value !== 'object') return empty;
    const { homeTeam, awayTeam, statusCode, sourcePeriod, gameClock, observedAt, requestCompletedAt } =
      value as Record<string, unknown>;
    const period = typeof sourcePeriod === 'string' && sourcePeriod.length <= 24 ? sourcePeriod.toUpperCase() : '';
    const clock = typeof gameClock === 'string' && /^(?:[0-9]|1[0-4]):[0-5][0-9]$|^15:00$|^0[0-9]:[0-5][0-9]$/u.test(gameClock)
      ? gameClock : null;
    return {
      homeTeam: typeof homeTeam === 'string' && canonicalTeams.has(homeTeam) ? homeTeam as NflTeam : null,
      awayTeam: typeof awayTeam === 'string' && canonicalTeams.has(awayTeam) ? awayTeam as NflTeam : null,
      statusCode: statusCode === 0 || statusCode === 1 || statusCode === 2 || statusCode === 3 || statusCode === 4 ? statusCode : null,
      sourcePeriod: safePeriods.test(period) ? period : null,
      gameClock: clock,
      observedAt: diagnosticTime(observedAt),
      requestCompletedAt: diagnosticTime(requestCompletedAt),
    };
  } catch {
    return empty;
  }
}

/** Failure-only context from already loaded normalized data; no source payload or extra retrieval. */
export function gameStatePersistenceDiagnostics(slate: GameStateSlate): Pick<ProjectionLogEntry,
  'gameStateCount' | 'gameStateSummaryTruncated' | 'gameStateSummary'> {
  try {
    const games = slate.games;
    if (!Array.isArray(games)) return {};
    const count: unknown = games.length;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return {};
    const summary: GameStateDiagnostic[] = [];
    for (let index = 0; index < Math.min(count, summaryLimit); index += 1) {
      summary.push(gameDiagnostic(games[index]));
    }
    return {
      gameStateCount: count,
      gameStateSummaryTruncated: count > summaryLimit,
      gameStateSummary: summary,
    };
  } catch {
    return {};
  }
}
