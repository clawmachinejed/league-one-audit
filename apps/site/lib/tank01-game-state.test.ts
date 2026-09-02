import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createTank01GameStateProvider,
  normalizeTank01GameStates,
} from './tank01-game-state';

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

const startedAt = Date.parse('2026-09-13T16:00:00.000Z');
const completedAt = Date.parse('2026-09-13T16:00:00.250Z');

describe('Tank01 weekly game-state normalization', () => {
  it('normalizes all provider states, aliases, clocks, and request timestamps', () => {
    const response = envelope([
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
    ]);

    const result = normalizeTank01GameStates(response, '2026', 1, startedAt, completedAt);

    expect(result).toMatchObject({
      status: 'available',
      season: '2026',
      week: 1,
      requestStartedAt: '2026-09-13T16:00:00.000Z',
      requestCompletedAt: '2026-09-13T16:00:00.250Z',
      fetchedAt: '2026-09-13T16:00:00.250Z',
    });
    expect(result.games).toHaveLength(6);
    expect(result.byTeam.WAS).toBe(result.byTeam.JAX);
    expect(result.byTeam.WAS).toMatchObject({
      gameId: 'opaque-pregame', homeTeam: 'WAS', awayTeam: 'JAX', phase: 'pregame', remainingFraction: 1,
    });
    expect(result.byTeam.LAC).toMatchObject({
      gameId: 'opaque-live', phase: 'q2', clock: '12:34', clockSeconds: 754,
      remainingFraction: ((30 * 60) + 754) / (60 * 60),
    });
    expect(result.byTeam.DAL).toMatchObject({ phase: 'halftime', clockSeconds: null, remainingFraction: 0.5 });
    expect(result.byTeam.NYG).toMatchObject({ phase: 'final', remainingFraction: 0 });
    expect(result.byTeam.BUF).toMatchObject({ phase: 'postponed', remainingFraction: 1 });
    expect(result.byTeam.BAL).toMatchObject({ phase: 'suspended', remainingFraction: null });
  });

  it('treats IDs as opaque and does not derive identity from their contents', () => {
    const gameId = 'not-a-date / arbitrary provider value';
    const result = normalizeTank01GameStates(
      envelope([[gameId, game(gameId, 'ARI', 'SEA')]]),
      '2026',
      7,
      startedAt,
      completedAt,
    );
    expect(result.games[0].gameId).toBe(gameId);
  });

  it('fails closed when two reported clocks or periods contradict one another', () => {
    const result = normalizeTank01GameStates(envelope([
      ['clock-conflict', game('clock-conflict', 'ARI', 'SEA', {
        gameStatusCode: 1,
        gameClock: '4:00',
        currentPeriod: 'Q2',
        lineScore: { period: 'Q3', gameClock: '3:59' },
      })],
    ]), '2026', 7, startedAt, completedAt);

    expect(result.games[0]).toMatchObject({
      phase: 'unknown', period: null, clock: null, clockSeconds: null, remainingFraction: null,
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
  ])('rejects %s', (_label, response) => {
    expect(() => normalizeTank01GameStates(response, '2026', 1, startedAt, completedAt)).toThrow();
  });

  it('rejects an impossible request window', () => {
    expect(() => normalizeTank01GameStates(
      envelope([['id', game('id', 'ARI', 'SEA')]]), '2026', 1, completedAt, startedAt,
    )).toThrow();
  });
});

describe('Tank01 weekly game-state provider', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('requests one uncached regular-season weekly scoreboard with all inputs explicit', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (...args) => {
      void args;
      return Response.json(envelope([
        ['game-id', game('game-id', 'ARI', 'SEA')],
      ]));
    });
    const times = [startedAt, completedAt];
    const provider = createTank01GameStateProvider({
      apiKey: 'fixture-key',
      fetch: fetch as typeof globalThis.fetch,
      now: () => times.shift() ?? completedAt,
    });

    const result = await provider.getWeeklyGameStates('2026', 18);

    expect(result.status).toBe('available');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [input, init] = fetch.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname).toBe('/getNFLScoresOnly');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      gameWeek: '18', season: '2026', seasonType: 'reg', topPerformers: 'false',
    });
    expect(init).toMatchObject({
      method: 'GET', cache: 'no-store', redirect: 'error',
      headers: {
        Accept: 'application/json',
        'x-rapidapi-host': 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com',
        'x-rapidapi-key': 'fixture-key',
      },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects invalid requests and missing configuration without calling Tank01', async () => {
    const fetch = vi.fn();
    const provider = createTank01GameStateProvider({ apiKey: null, fetch: fetch as typeof globalThis.fetch });
    await expect(provider.getWeeklyGameStates('26', 1)).resolves.toMatchObject({
      status: 'unavailable', reason: 'invalid-request',
    });
    await expect(provider.getWeeklyGameStates('2026', 0)).resolves.toMatchObject({
      status: 'unavailable', reason: 'invalid-request',
    });
    await expect(provider.getWeeklyGameStates('2026', 19)).resolves.toMatchObject({
      status: 'unavailable', reason: 'invalid-request',
    });
    await expect(provider.getWeeklyGameStates('2026', 1)).resolves.toMatchObject({
      status: 'unavailable', reason: 'missing-api-key',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['HTTP failure', new Response(null, { status: 429 }), 'provider-error'],
    ['invalid JSON', new Response('{', { status: 200 }), 'invalid-response'],
    ['provider error envelope', Response.json({ statusCode: 500, body: {} }), 'provider-error'],
    ['malformed success envelope', Response.json({ statusCode: 200, body: {} }), 'invalid-response'],
  ])('represents %s without throwing', async (_label, response, reason) => {
    const provider = createTank01GameStateProvider({
      apiKey: 'fixture-key', fetch: vi.fn(async () => response.clone()) as typeof globalThis.fetch,
    });
    await expect(provider.getWeeklyGameStates('2026', 1)).resolves.toMatchObject({
      status: 'unavailable', reason,
    });
  });

  it('does not write credentials or provider details to the console', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const provider = createTank01GameStateProvider({
      apiKey: 'do-not-log',
      fetch: vi.fn(async () => Response.json({ statusCode: 200, error: 'private provider detail', body: {} })) as typeof globalThis.fetch,
    });
    await expect(provider.getWeeklyGameStates('2026', 1)).resolves.toMatchObject({ status: 'unavailable' });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
