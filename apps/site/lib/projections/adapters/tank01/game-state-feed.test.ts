import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { LeaguePeriod } from '../../domain/contracts';
import { providerKey } from '../../shared/provider-identity';
import { compatibleRevision } from '../../shared/revision-compatibility';
import { createTank01GameStateFeed, normalizeTank01GameStates } from './game-state-feed';

const period: LeaguePeriod = { season: 2026, seasonType: 'regular', week: 1 };
const provider = providerKey('tank01');
const startedAt = Date.parse('2026-09-13T16:00:00.000Z');
const completedAt = Date.parse('2026-09-13T16:00:00.250Z');

const game = (gameID: string, home: string, away: string, overrides: Record<string, unknown> = {}) => ({
  gameID,
  home,
  away,
  gameStatusCode: '0',
  gameStatus: 'Not Started Yet',
  gameClock: '',
  ...overrides,
});

function envelope(rows: ReadonlyArray<readonly [string, Record<string, unknown>]>) {
  return { statusCode: 200, body: Object.fromEntries(rows) };
}

describe('Tank01 canonical game-state normalization', () => {
  it('normalizes all phases and aliases while retaining exact legacy revision input', () => {
    const result = normalizeTank01GameStates(envelope([
      ['opaque-pregame', game('opaque-pregame', 'WSH', 'JAC')],
      ['opaque-live', game('opaque-live', 'LAC', 'KC', {
        gameStatusCode: 1,
        gameStatus: 'In Progress',
        gameClock: '12:34',
        lineScore: { period: 'Q2', gameClock: '12:34' },
      })],
      ['opaque-halftime', game('opaque-halftime', 'DAL', 'PHI', {
        gameStatusCode: '1', gameStatus: 'Halftime', lineScore: { period: 'Halftime', gameClock: '' },
      })],
      ['opaque-final-ot', game('opaque-final-ot', 'NYG', 'NYJ', {
        gameStatusCode: '2', gameStatus: 'Completed', lineScore: { period: 'Final/OT' },
      })],
      ['opaque-postponed', game('opaque-postponed', 'BUF', 'MIA', {
        gameStatusCode: '3', gameStatus: 'Postponed',
      })],
      ['opaque-suspended', game('opaque-suspended', 'BAL', 'PIT', {
        gameStatusCode: '4', gameStatus: 'Suspended', gameClock: '5:00', lineScore: { period: 'Q3' },
      })],
    ]), period, startedAt, completedAt, provider);

    expect(result).toMatchObject({
      source: 'tank01',
      period,
      requestStartedAt: '2026-09-13T16:00:00.000Z',
      requestCompletedAt: '2026-09-13T16:00:00.250Z',
      observedAt: '2026-09-13T16:00:00.250Z',
    });
    expect(result.games).toHaveLength(6);
    expect(result.games[0]).toMatchObject({
      gameRef: { provider: 'tank01', externalId: 'opaque-pregame' },
      homeTeam: 'WAS', awayTeam: 'JAX', phase: 'pregame', remainingFraction: 1,
      homeScore: null, awayScore: null,
    });
    expect(result.games[1]).toMatchObject({
      phase: 'q2', sourcePeriod: 'Q2', gameClock: '12:34', clockSeconds: 754,
      remainingFraction: ((30 * 60) + 754) / (60 * 60),
    });
    expect(result.games[2]).toMatchObject({ phase: 'halftime', clockSeconds: null, remainingFraction: 0.5 });
    expect(result.games[3]).toMatchObject({ phase: 'final', remainingFraction: 0 });
    expect(result.games[4]).toMatchObject({ phase: 'postponed', remainingFraction: 1 });
    expect(result.games[5]).toMatchObject({ phase: 'suspended', remainingFraction: null });
    expect(result.games[1].sourceRevision).toBe(compatibleRevision({
      gameId: 'opaque-live',
      fetchedAt: '2026-09-13T16:00:00.250Z',
      statusCode: 1,
      phase: 'q2',
      clock: '12:34',
      remainingFraction: ((30 * 60) + 754) / (60 * 60),
    }));
  });

  it('keeps opaque IDs opaque and collapses contradictory clock inputs to unknown', () => {
    const gameId = 'not-a-date / arbitrary provider value';
    const result = normalizeTank01GameStates(envelope([[
      gameId,
      game(gameId, 'ARI', 'SEA', {
        gameStatusCode: 1,
        gameClock: '4:00',
        currentPeriod: 'Q2',
        lineScore: { period: 'Q3', gameClock: '3:59' },
      }),
    ]]), { ...period, week: 7 }, startedAt, completedAt, provider);
    expect(result.games[0]).toMatchObject({
      gameRef: { externalId: gameId }, phase: 'unknown', sourcePeriod: null,
      gameClock: null, clockSeconds: null, remainingFraction: null,
    });
  });

  it.each([
    ['missing envelope status', { body: envelope([['id', game('id', 'ARI', 'SEA')]]).body }],
    ['provider error', { statusCode: 200, error: 'quota', body: {} }],
    ['empty body', { statusCode: 200, body: {} }],
    ['array body', { statusCode: 200, body: [] }],
    ['mismatched map and row ID', envelope([['map-id', game('row-id', 'ARI', 'SEA')]])],
    ['unknown team', envelope([['id', game('id', '???', 'SEA')]])],
    ['unknown status', envelope([['id', game('id', 'ARI', 'SEA', { gameStatusCode: 5 })]])],
    ['malformed line score', envelope([['id', game('id', 'ARI', 'SEA', { lineScore: 'bad' })]])],
    ['duplicate team', envelope([
      ['id-1', game('id-1', 'ARI', 'SEA')],
      ['id-2', game('id-2', 'ARI', 'LAC')],
    ])],
  ])('rejects %s atomically', (_label, response) => {
    expect(() => normalizeTank01GameStates(
      response, period, startedAt, completedAt, provider,
    )).toThrow();
  });

  it('rejects an impossible request window', () => {
    expect(() => normalizeTank01GameStates(
      envelope([['id', game('id', 'ARI', 'SEA')]]), period, completedAt, startedAt, provider,
    )).toThrow();
  });
});

describe('Tank01 canonical game-state feed', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('makes exactly one uncached regular-season request with injected credentials', async () => {
    const timestamps = [startedAt, completedAt];
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(envelope([
      ['id', game('id', 'ARI', 'SEA')],
    ])));
    const feed = createTank01GameStateFeed({
      apiKey: 'fixture-key', provider, fetch,
      now: () => timestamps.shift() ?? completedAt,
    });

    const result = await feed.getGameStateSlate(period);
    expect(result).toMatchObject({ status: 'available', slate: { period, games: [{ phase: 'pregame' }] } });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [input, init] = fetch.mock.calls[0];
    expect(Object.fromEntries(new URL(String(input)).searchParams)).toEqual({
      gameWeek: '1', season: '2026', seasonType: 'reg', topPerformers: 'false',
    });
    expect(init).toMatchObject({
      method: 'GET', cache: 'no-store', redirect: 'error',
      headers: {
        Accept: 'application/json',
        'x-rapidapi-host': 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com',
        'x-rapidapi-key': 'fixture-key',
      },
    });
  });

  it('validates the period and injected credential before fetching or reading the clock', async () => {
    const fetch = vi.fn();
    const now = vi.fn(() => startedAt);
    const configured = createTank01GameStateFeed({ apiKey: 'fixture-key', provider, fetch, now });
    const disabled = createTank01GameStateFeed({ apiKey: null, provider, fetch, now });
    await expect(configured.getGameStateSlate({ ...period, week: 0 })).resolves.toMatchObject({
      status: 'unavailable', reason: 'invalid-request',
    });
    await expect(configured.getGameStateSlate({ ...period, seasonType: 'postseason' })).resolves.toMatchObject({
      status: 'unavailable', reason: 'invalid-request',
    });
    await expect(disabled.getGameStateSlate(period)).resolves.toEqual({
      status: 'unavailable', period, reason: 'not-configured', message: 'Live game states are not configured.',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it.each([
    ['network failure', () => Promise.reject(new Error('offline')), 'provider-error'],
    ['HTTP failure', () => Promise.resolve(new Response(null, { status: 503 })), 'provider-error'],
    ['bad JSON', () => Promise.resolve(new Response('{', { status: 200 })), 'invalid-response'],
    ['provider error envelope', () => Promise.resolve(Response.json({
      statusCode: 500, body: {}, error: 'quota reached',
    })), 'provider-error'],
    ['malformed success envelope', () => Promise.resolve(Response.json({
      statusCode: 200, body: {},
    })), 'invalid-response'],
  ])('returns a safe canonical unavailable result for %s', async (_label, implementation, reason) => {
    const feed = createTank01GameStateFeed({
      apiKey: 'fixture-key', provider,
      fetch: vi.fn(implementation) as typeof globalThis.fetch,
      now: () => startedAt,
    });
    await expect(feed.getGameStateSlate(period)).resolves.toMatchObject({ status: 'unavailable', reason, period });
  });

  it('does not write credentials or provider details to the console', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const feed = createTank01GameStateFeed({
      apiKey: 'do-not-log-this', provider,
      fetch: vi.fn(async () => Response.json({ statusCode: 200, error: 'private detail', body: {} })),
      now: () => startedAt,
    });
    await expect(feed.getGameStateSlate(period)).resolves.toMatchObject({
      status: 'unavailable', reason: 'provider-error', message: 'Live game states are temporarily unavailable.',
    });
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    spies.forEach((spy) => spy.mockRestore());
  });
});
