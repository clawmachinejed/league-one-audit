import { describe, expect, it, vi } from 'vitest';

const nextCacheRegistrations = vi.hoisted(() => [] as Array<{
  keyParts: string[];
  options: { revalidate?: number };
  invocations: unknown[][];
  loads: number;
  values: unknown[];
}>);

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  unstable_cache: <Arguments extends unknown[], Result>(
    loader: (...args: Arguments) => Promise<Result>,
    keyParts: string[],
    options: { revalidate?: number },
  ) => {
    const cache = new Map<string, Result>();
    const registration = {
      keyParts: [...keyParts], options, invocations: [] as unknown[][], loads: 0, values: [] as unknown[],
    };
    nextCacheRegistrations.push(registration);
    return async (...args: Arguments): Promise<Result> => {
      registration.invocations.push(args);
      const key = JSON.stringify(args);
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      registration.loads += 1;
      const loaded = await loader(...args);
      // Approximate Next's persistent serialization so tests exercise null-prototype rehydration.
      const serialized = JSON.parse(JSON.stringify(loaded)) as Result;
      registration.values.push(serialized);
      cache.set(key, serialized);
      return serialized;
    };
  },
}));

import { NFL_TEAMS } from './nfl-teams';
import { createTank01ProjectionProvider, getTank01WeeklyProjections } from './tank01';

const playerProjection = (overrides: Record<string, unknown> = {}) => ({
  playerID: 'tank-qb',
  longName: 'Quarter Back',
  pos: 'QB',
  team: 'WSH',
  Passing: {
    passAttempts: '34.5', passCompletions: '22.1', passYds: '275.25', passTD: '2.1', int: '0.6',
  },
  Rushing: { carries: '4', rushYds: '-1.5', rushTD: '0.2' },
  Receiving: { targets: '0', receptions: '0', recYds: '0', recTD: '0' },
  twoPointConversion: '.05',
  fumblesLost: '0.10',
  ...overrides,
});

const defenseProjection = (overrides: Record<string, unknown> = {}) => ({
  teamID: '31',
  teamAbv: 'JAC',
  returnTD: '0.10',
  defTD: '0.20',
  safeties: '0.05',
  fumbleRecoveries: '0.8',
  ptsAgainst: '20.5',
  interceptions: '1.25',
  sacks: '2.75',
  blockKick: '0.1',
  ...overrides,
});

const coveragePositions = ['QB', 'RB', 'WR', 'TE'] as const;

function completePlayerProjectionRows(): Record<string, unknown> {
  return Object.fromEntries(NFL_TEAMS.flatMap((team) => coveragePositions.map((position) => {
    const playerID = `tank-${team}-${position}`;
    return [playerID, playerProjection({ playerID, team, pos: position })] as const;
  })));
}

function completeDefenseProjectionRows(): Record<string, unknown> {
  return Object.fromEntries(NFL_TEAMS.map((team) => [team, defenseProjection({ teamAbv: team })]));
}

function completePlayerListRows(): unknown[] {
  return NFL_TEAMS.flatMap((team) => coveragePositions.map((position) => {
    const playerID = `tank-${team}-${position}`;
    return { playerID, sleeperBotID: `sleeper-${team}-${position}` };
  }));
}

function completeProjectionEnvelope() {
  return projectionEnvelope({
    body: {
      playerProjections: completePlayerProjectionRows(),
      teamDefenseProjections: completeDefenseProjectionRows(),
    },
  });
}

const projectionEnvelope = (overrides: Record<string, unknown> = {}) => ({
  statusCode: 200,
  body: {
    playerProjections: { 'tank-qb': playerProjection() },
    teamDefenseProjections: { JAC: defenseProjection() },
  },
  ...overrides,
});

const playerEnvelope = (body: unknown = [
  { playerID: 'tank-qb', sleeperBotID: 'sleeper-qb', longName: 'Quarter Back' },
]) => ({ statusCode: '200', body });

function mockFetch(projections: unknown = projectionEnvelope(), players: unknown = playerEnvelope()) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    void _init;
    const url = new URL(String(input));
    if (url.pathname === '/getNFLProjections') return Response.json(projections);
    if (url.pathname === '/getNFLPlayerList') return Response.json(players);
    return new Response(null, { status: 404 });
  });
}

describe('Tank01 weekly projection provider', () => {
  it('loads a full weekly slate, crosswalks through sleeperBotID, and keeps raw numeric stat lines', async () => {
    const fetch = mockFetch();
    const provider = createTank01ProjectionProvider({
      apiKey: 'fixture-key', fetch: fetch as typeof globalThis.fetch, now: () => Date.parse('2026-09-01T12:00:00Z'),
    });

    const result = await provider.getWeeklyProjections('2026', 1);

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.fetchedAt).toBe('2026-09-01T12:00:00.000Z');
    expect(result.projections.bySleeperId['sleeper-qb']).toMatchObject({
      tank01PlayerId: 'tank-qb', sleeperPlayerId: 'sleeper-qb', team: 'WAS', position: 'QB',
      stats: {
        passing: { attempts: 34.5, completions: 22.1, yards: 275.25, touchdowns: 2.1, interceptions: 0.6 },
        rushing: { carries: 4, yards: -1.5, touchdowns: 0.2 },
        kicking: { fieldGoalsMade: null, fieldGoalsMissed: null, extraPointsMade: null, extraPointsMissed: null },
        twoPointConversions: 0.05,
        fumblesLost: 0.1,
      },
      scoringProjection: {
        kind: 'offense', passingYards: 275.25, passingTouchdowns: 2.1, passingInterceptions: 0.6,
        rushingYards: -1.5, rushingTouchdowns: 0.2, receptions: 0, receivingYards: 0,
        receivingTouchdowns: 0, twoPointConversions: 0.05, fumblesLost: 0.1,
      },
      missingFields: [],
    });
    expect(result.projections.byDefenseTeam.JAX).toMatchObject({
      team: 'JAX', stats: { pointsAllowed: 20.5, sacks: 2.75, blockedKicks: 0.1 }, missingFields: [],
      scoringProjection: {
        kind: 'defense', sacks: 2.75, interceptions: 1.25, fumbleRecoveries: 0.8,
        defensiveTouchdowns: 0.2, specialTeamsTouchdowns: 0.1, safeties: 0.05,
        blockedKicks: 0.1, pointsAllowed: 20.5,
      },
    });
    expect(result.coverage).toMatchObject({
      crosswalkEntries: 1, matchedPlayerProjections: 1, usableDefenseProjections: 1,
      malformedPlayerProjections: 0, malformedDefenseProjections: 0,
    });
    expect(result.warnings).toEqual([]);

    const projectionCall = fetch.mock.calls.find(([input]) => new URL(String(input)).pathname === '/getNFLProjections');
    const projectionUrl = new URL(String(projectionCall?.[0]));
    expect(projectionUrl.hostname).toBe('tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com');
    expect(Object.fromEntries(projectionUrl.searchParams)).toEqual({ week: '1', itemFormat: 'map' });
    const headers = new Headers(projectionCall?.[1]?.headers);
    expect(headers.get('x-rapidapi-host')).toBe(projectionUrl.hostname);
    expect(headers.get('x-rapidapi-key')).toBe('fixture-key');
    expect(projectionCall?.[1]?.redirect).toBe('error');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('uses archiveSeason only when explicitly loading an older season', async () => {
    const fetch = mockFetch();
    const provider = createTank01ProjectionProvider({
      apiKey: 'fixture-key', fetch: fetch as typeof globalThis.fetch,
      now: () => Date.parse('2026-09-01T12:00:00Z'),
    });

    await provider.getWeeklyProjections('2025', 1);

    const projectionCall = fetch.mock.calls.find(([input]) => new URL(String(input)).pathname === '/getNFLProjections');
    const projectionUrl = new URL(String(projectionCall?.[0]));
    expect(Object.fromEntries(projectionUrl.searchParams)).toEqual({
      week: '1', itemFormat: 'map', archiveSeason: '2025',
    });
  });

  it('keeps the active NFL season unarchived through January Week 18', async () => {
    const fetch = mockFetch();
    const provider = createTank01ProjectionProvider({
      apiKey: 'fixture-key', fetch: fetch as typeof globalThis.fetch,
      now: () => Date.parse('2027-01-03T12:00:00Z'),
    });

    await provider.getWeeklyProjections('2026', 18);

    const projectionCall = fetch.mock.calls.find(([input]) => new URL(String(input)).pathname === '/getNFLProjections');
    const url = new URL(String(projectionCall?.[0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({ week: '18', itemFormat: 'map' });
  });

  it('preserves reserved Tank01 and Sleeper IDs without changing record prototypes', async () => {
    const playerProjections = Object.create(null) as Record<string, unknown>;
    playerProjections['__proto__'] = playerProjection({ playerID: '__proto__', pos: 'RB' });
    Object.defineProperty(playerProjections, 'constructor', {
      value: playerProjection({ playerID: 'constructor', pos: 'WR' }), enumerable: true,
    });
    const projections = projectionEnvelope({
      body: { playerProjections, teamDefenseProjections: { JAC: defenseProjection() } },
    });
    const players = playerEnvelope([
      { playerID: '__proto__', sleeperBotID: 'constructor' },
      { playerID: 'constructor', sleeperBotID: '__proto__' },
    ]);
    const provider = createTank01ProjectionProvider({
      apiKey: 'fixture-key', fetch: mockFetch(projections, players) as typeof globalThis.fetch,
    });

    const result = await provider.getWeeklyProjections('2026', 6);

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(Object.getPrototypeOf(result.projections.bySleeperId)).toBeNull();
    expect(Object.getPrototypeOf(result.projections.byDefenseTeam)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(result.projections.bySleeperId, 'constructor')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result.projections.bySleeperId, '__proto__')).toBe(true);
    expect((Reflect.get(result.projections.bySleeperId, 'constructor') as {
      tank01PlayerId: string;
    }).tank01PlayerId).toBe('__proto__');
    expect(result.projections.bySleeperId['__proto__'].tank01PlayerId).toBe('constructor');
    expect(result.coverage).toMatchObject({ crosswalkEntries: 2, matchedPlayerProjections: 2 });
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('canonicalizes D/ST aliases and never confuses an invalid team or mismatched map key with a defense', async () => {
    const projections = projectionEnvelope({
      body: {
        playerProjections: { 'tank-qb': playerProjection() },
        teamDefenseProjections: {
          WSH: defenseProjection({ teamAbv: 'WSH' }),
          wrong: defenseProjection({ teamAbv: 'XYZ' }),
          SF: defenseProjection({ teamAbv: 'LAC' }),
        },
      },
    });
    const provider = createTank01ProjectionProvider({ apiKey: 'fixture-key', fetch: mockFetch(projections) as typeof globalThis.fetch });
    const result = await provider.getWeeklyProjections('2026', 4);

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(Object.keys(result.projections.byDefenseTeam)).toEqual(['WAS']);
    expect(result.coverage).toMatchObject({ defenseProjectionRows: 3, usableDefenseProjections: 1, malformedDefenseProjections: 2 });
    expect(result.warnings).toContain('Some malformed Tank01 projection rows were ignored.');
  });

  it.each(['K', 'PK'])('emits a scoring-ready kicker line for the %s position', async (position) => {
    const kicker = playerProjection({
      playerID: 'tank-kicker',
      pos: position,
      Passing: undefined,
      Rushing: undefined,
      Receiving: undefined,
      Kicking: { fgMade: '2.4', fgMissed: '0.3', xpMade: '2.8', xpMissed: '0.1' },
      twoPointConversion: undefined,
      fumblesLost: undefined,
    });
    const projections = projectionEnvelope({
      body: {
        playerProjections: { 'tank-kicker': kicker },
        teamDefenseProjections: { JAC: defenseProjection() },
      },
    });
    const provider = createTank01ProjectionProvider({
      apiKey: 'fixture-key',
      fetch: mockFetch(projections, playerEnvelope([
        { playerID: 'tank-kicker', sleeperBotID: 'sleeper-kicker' },
      ])) as typeof globalThis.fetch,
    });

    const result = await provider.getWeeklyProjections('2026', 5);

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.projections.bySleeperId['sleeper-kicker']).toMatchObject({
      position,
      scoringProjection: {
        kind: 'kicker', fieldGoalsMade: 2.4, fieldGoalsMissed: 0.3, extraPointsMade: 2.8, extraPointsMissed: 0.1,
      },
      missingFields: [],
    });
  });

  it('preserves partial rows with nulls and reports malformed numeric strings instead of turning them into zero', async () => {
    const projections = projectionEnvelope({
      body: {
        playerProjections: {
          'tank-qb': playerProjection({
            Passing: { passAttempts: 'nope', passCompletions: '', passYds: '300.5', passTD: null, int: 'Infinity' },
            Rushing: null,
            fumblesLost: Number.NaN,
          }),
          broken: { playerID: 'different-id', Passing: { passYds: '120' } },
          scalar: 'not-a-row',
          empty: { playerID: 'empty', pos: 'QB' },
        },
        teamDefenseProjections: {
          JAC: defenseProjection({ sacks: '2e3', interceptions: undefined }),
          BAD: { teamAbv: '???', sacks: '1' },
          NE: { teamAbv: 'NE' },
        },
      },
    });
    const provider = createTank01ProjectionProvider({ apiKey: 'fixture-key', fetch: mockFetch(projections) as typeof globalThis.fetch });
    const result = await provider.getWeeklyProjections('2026', 2);

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    const quarterback = result.projections.bySleeperId['sleeper-qb'];
    expect(quarterback.stats.passing).toEqual({ attempts: null, completions: null, yards: 300.5, touchdowns: null, interceptions: null });
    expect(quarterback.stats.rushing).toEqual({ carries: null, yards: null, touchdowns: null });
    expect(quarterback.stats.fumblesLost).toBeNull();
    expect(quarterback.missingFields).toEqual(expect.arrayContaining([
      'Passing.passAttempts', 'Passing.passCompletions', 'Passing.passTD', 'Passing.int',
      'Rushing.carries', 'Rushing.rushYds', 'Rushing.rushTD', 'fumblesLost',
    ]));
    expect(result.projections.byDefenseTeam.JAX.stats).toMatchObject({ sacks: null, interceptions: null });
    expect(result.coverage).toMatchObject({
      playerProjectionRows: 4, matchedPlayerProjections: 1, malformedPlayerProjections: 3, incompletePlayerProjections: 1,
      defenseProjectionRows: 3, usableDefenseProjections: 1, malformedDefenseProjections: 2, incompleteDefenseProjections: 1,
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      'Some malformed Tank01 projection rows were ignored.',
      'Some Tank01 projection rows are missing one or more projected statistics.',
    ]));
  });

  it('counts unmatched and ambiguous IDs without assigning a projection to the wrong Sleeper player', async () => {
    const projections = projectionEnvelope({
      body: {
        playerProjections: {
          'tank-qb': playerProjection(),
          'tank-rb': playerProjection({ playerID: 'tank-rb', pos: 'RB' }),
          'tank-wr': playerProjection({ playerID: 'tank-wr', pos: 'WR' }),
        },
        teamDefenseProjections: { JAC: defenseProjection() },
      },
    });
    const players = playerEnvelope([
      { playerID: 'tank-qb', sleeperBotID: 'sleeper-shared' },
      { playerID: 'tank-rb', sleeperBotID: 'sleeper-shared' },
      { playerID: 'tank-good', sleeperBotID: 'sleeper-good' },
      { playerID: '', sleeperBotID: 'missing-tank-id' },
    ]);
    const provider = createTank01ProjectionProvider({ apiKey: 'fixture-key', fetch: mockFetch(projections, players) as typeof globalThis.fetch });
    const result = await provider.getWeeklyProjections('2026', 3);

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.projections.bySleeperId).toEqual({});
    expect(result.coverage).toMatchObject({
      playerListRows: 4, crosswalkEntries: 1, malformedPlayerListRows: 1, ambiguousPlayerListRows: 2,
      playerProjectionRows: 3, matchedPlayerProjections: 0, unmatchedPlayerProjections: 3,
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      'Some Tank01 player identifiers could not be safely matched to Sleeper.',
      'Some Tank01 player projections did not have a Sleeper player identifier.',
      'Tank01 did not provide any player projections that could be matched to Sleeper.',
    ]));
  });

  it('uses an hourly success cache for normalized inputs and refreshes after expiry', async () => {
    let clock = Date.parse('2026-09-01T12:00:00Z');
    const fetch = mockFetch();
    const sharedInvocations = nextCacheRegistrations.map((registration) => registration.invocations.length);
    const provider = createTank01ProjectionProvider({
      apiKey: 'fixture-key', fetch: fetch as typeof globalThis.fetch, now: () => clock,
    });

    await provider.getWeeklyProjections('2026', 1);
    clock += 59 * 60 * 1_000;
    await provider.getWeeklyProjections('2026', 1);
    expect(fetch).toHaveBeenCalledTimes(2);

    clock += 2 * 60 * 1_000;
    await provider.getWeeklyProjections('2026', 1);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(nextCacheRegistrations.map((registration) => registration.invocations.length)).toEqual(sharedInvocations);
  });

  it('uses two one-hour shared caches for normalized production data without putting the credential in a key', async () => {
    const projectionRegistration = nextCacheRegistrations.find(({ keyParts }) => (
      keyParts.includes('tank01-normalized-projection-slate-v2')
    ));
    const crosswalkRegistration = nextCacheRegistrations.find(({ keyParts }) => (
      keyParts.includes('tank01-normalized-player-crosswalk-v1')
    ));
    expect(projectionRegistration?.options.revalidate).toBe(3_600);
    expect(crosswalkRegistration?.options.revalidate).toBe(3_600);

    const originalKey = process.env.TANK01_API_KEY;
    const originalFetch = globalThis.fetch;
    const secret = 'must-not-enter-a-cache-key';
    const sharedPlayerProjections = Object.create(null) as Record<string, unknown>;
    Object.assign(sharedPlayerProjections, completePlayerProjectionRows());
    sharedPlayerProjections['tank-qb'] = playerProjection();
    sharedPlayerProjections['__proto__'] = playerProjection({ playerID: '__proto__', pos: 'RB' });
    Object.defineProperty(sharedPlayerProjections, 'constructor', {
      value: playerProjection({ playerID: 'constructor', pos: 'WR' }), enumerable: true,
    });
    const fetch = mockFetch(projectionEnvelope({
      body: {
        playerProjections: sharedPlayerProjections,
        teamDefenseProjections: completeDefenseProjectionRows(),
      },
    }), playerEnvelope([
      ...completePlayerListRows(),
      { playerID: 'tank-qb', sleeperBotID: 'sleeper-qb' },
      { playerID: '__proto__', sleeperBotID: 'constructor' },
      { playerID: 'constructor', sleeperBotID: '__proto__' },
    ]));
    process.env.TANK01_API_KEY = secret;
    globalThis.fetch = fetch as typeof globalThis.fetch;
    try {
      const first = await getTank01WeeklyProjections('2026', 8);
      const second = await getTank01WeeklyProjections('2026', 8);
      expect(first.status).toBe('available');
      expect(second).toEqual(first);
      if (second.status === 'available') {
        // The cache mock serializes successful values like a persistent cache. The exported
        // provider must restore safe records after that serialization boundary.
        expect(Object.getPrototypeOf(second.projections.bySleeperId)).toBeNull();
        expect(Object.getPrototypeOf(second.projections.byDefenseTeam)).toBeNull();
        expect((Reflect.get(second.projections.bySleeperId, 'constructor') as {
          tank01PlayerId: string;
        }).tank01PlayerId).toBe('__proto__');
        expect(second.projections.bySleeperId['__proto__'].tank01PlayerId).toBe('constructor');
      }
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.TANK01_API_KEY;
      else process.env.TANK01_API_KEY = originalKey;
    }

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(projectionRegistration?.loads).toBe(1);
    expect(crosswalkRegistration?.loads).toBe(1);
    expect(projectionRegistration?.values[0]).toMatchObject({
      fetchedAtMs: expect.any(Number),
      playersByTank01Id: { 'tank-qb': { tank01PlayerId: 'tank-qb' } },
    });
    expect(projectionRegistration?.values[0]).not.toHaveProperty('body');
    expect(projectionRegistration?.values[0]).not.toHaveProperty('statusCode');
    expect(crosswalkRegistration?.values[0]).toMatchObject({
      sleeperIdByTank01Id: { 'tank-qb': 'sleeper-qb', constructor: '__proto__' },
      playerListRows: completePlayerListRows().length + 3,
    });
    const cachedCrosswalk = crosswalkRegistration?.values[0] as {
      sleeperIdByTank01Id: Record<string, string>;
    };
    expect(Object.prototype.hasOwnProperty.call(cachedCrosswalk.sleeperIdByTank01Id, '__proto__')).toBe(true);
    expect(cachedCrosswalk.sleeperIdByTank01Id['__proto__']).toBe('constructor');
    expect(crosswalkRegistration?.values[0]).not.toHaveProperty('body');
    expect(JSON.stringify(nextCacheRegistrations.map(({ keyParts, invocations }) => ({ keyParts, invocations })))).not.toContain(secret);
  });

  it('does not persist provider failures in the one-hour shared cache and retains the short retry backoff', async () => {
    const projectionRegistration = nextCacheRegistrations.find(({ keyParts }) => (
      keyParts.includes('tank01-normalized-projection-slate-v2')
    ));
    const loadsBefore = projectionRegistration?.loads ?? 0;
    const originalKey = process.env.TANK01_API_KEY;
    const originalFetch = globalThis.fetch;
    let clock = Date.parse('2026-09-01T12:00:00Z');
    let projectionFails = true;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/getNFLProjections') {
        return projectionFails ? new Response(null, { status: 503 }) : Response.json(completeProjectionEnvelope());
      }
      if (url.pathname === '/getNFLPlayerList') return Response.json(playerEnvelope());
      return new Response(null, { status: 404 });
    });
    process.env.TANK01_API_KEY = 'failure-cache-secret';
    globalThis.fetch = fetch as typeof globalThis.fetch;

    try {
      const first = await getTank01WeeklyProjections('2026', 16);
      expect(first).toMatchObject({
        status: 'unavailable', reason: 'provider-error', retryAt: '2026-09-01T12:01:00.000Z',
      });
      const callsAfterFailure = fetch.mock.calls.length;
      await expect(getTank01WeeklyProjections('2026', 16)).resolves.toEqual(first);
      expect(fetch).toHaveBeenCalledTimes(callsAfterFailure);

      clock += 60_001;
      projectionFails = false;
      await expect(getTank01WeeklyProjections('2026', 16)).resolves.toMatchObject({ status: 'available' });
      expect(fetch.mock.calls.length).toBeGreaterThan(callsAfterFailure);
    } finally {
      now.mockRestore();
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.TANK01_API_KEY;
      else process.env.TANK01_API_KEY = originalKey;
    }

    expect(projectionRegistration?.loads).toBe(loadsBefore + 2);
  });

  it('rejects a truncated raw production slate before success caching and recovers after failure backoff', async () => {
    const projectionRegistration = nextCacheRegistrations.find(({ keyParts }) => (
      keyParts.includes('tank01-normalized-projection-slate-v2')
    ));
    const loadsBefore = projectionRegistration?.loads ?? 0;
    const valuesBefore = projectionRegistration?.values.length ?? 0;
    const originalKey = process.env.TANK01_API_KEY;
    const originalFetch = globalThis.fetch;
    let clock = Date.parse('2026-09-01T12:00:00Z');
    let truncated = true;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/getNFLProjections') {
        return Response.json(truncated ? projectionEnvelope() : completeProjectionEnvelope());
      }
      if (url.pathname === '/getNFLPlayerList') return Response.json(playerEnvelope(completePlayerListRows()));
      return new Response(null, { status: 404 });
    });
    process.env.TANK01_API_KEY = 'truncated-slate-secret';
    globalThis.fetch = fetch as typeof globalThis.fetch;

    try {
      const first = await getTank01WeeklyProjections('2026', 17);
      expect(first).toMatchObject({
        status: 'unavailable', reason: 'invalid-response', retryAt: '2026-09-01T12:01:00.000Z',
      });
      const callsAfterFailure = fetch.mock.calls.length;
      await expect(getTank01WeeklyProjections('2026', 17)).resolves.toEqual(first);
      expect(fetch).toHaveBeenCalledTimes(callsAfterFailure);

      clock += 60_001;
      truncated = false;
      await expect(getTank01WeeklyProjections('2026', 17)).resolves.toMatchObject({ status: 'available' });
      const callsAfterRecovery = fetch.mock.calls.length;
      await expect(getTank01WeeklyProjections('2026', 17)).resolves.toMatchObject({ status: 'available' });
      expect(fetch).toHaveBeenCalledTimes(callsAfterRecovery);
    } finally {
      now.mockRestore();
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.TANK01_API_KEY;
      else process.env.TANK01_API_KEY = originalKey;
    }

    expect(projectionRegistration?.loads).toBe(loadsBefore + 2);
    expect(projectionRegistration?.values).toHaveLength(valuesBefore + 1);
  });

  it('waits for sibling HTTP work to abort at the fifteen-second provider deadline', async () => {
    vi.useFakeTimers();
    const clock = Date.parse('2026-09-01T12:00:00Z');
    let activeRequests = 0;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      expect(milliseconds).toBe(15_000);
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Tank01 request timed out', 'TimeoutError')), milliseconds);
      return controller.signal;
    });
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/getNFLProjections')) {
        return Promise.reject(new Error('Projection endpoint failed immediately'));
      }
      activeRequests += 1;
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => {
          activeRequests -= 1;
          reject(signal?.reason ?? new Error('Request aborted'));
        };
        if (!signal || signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    });
    const provider = createTank01ProjectionProvider({
      apiKey: 'fixture-key', fetch: fetch as typeof globalThis.fetch, now: () => clock,
    });

    try {
      let providerResolved = false;
      const pending = provider.getWeeklyProjections('2026', 10);
      void pending.then(() => { providerResolved = true; });

      await vi.advanceTimersByTimeAsync(14_999);
      expect(providerResolved).toBe(false);
      expect(activeRequests).toBe(1);

      await vi.advanceTimersByTimeAsync(1);
      const first = await pending;
      expect(first).toMatchObject({
        status: 'unavailable', reason: 'provider-error', retryAt: '2026-09-01T12:01:00.000Z',
      });
      expect(timeout).toHaveBeenCalledTimes(2);
      expect(timeout).toHaveBeenCalledWith(15_000);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(activeRequests).toBe(0);

      await expect(provider.getWeeklyProjections('2026', 10)).resolves.toEqual(first);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      await vi.runOnlyPendingTimersAsync();
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });

  it('coalesces concurrent requests for the same weekly slate', async () => {
    const fetch = mockFetch();
    const provider = createTank01ProjectionProvider({ apiKey: 'fixture-key', fetch: fetch as typeof globalThis.fetch });
    const [first, second] = await Promise.all([
      provider.getWeeklyProjections('2026', 1),
      provider.getWeeklyProjections('2026', 1),
    ]);
    expect(first).toEqual(second);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns a safe unavailable state for missing configuration without making a request', async () => {
    const fetch = mockFetch();
    const provider = createTank01ProjectionProvider({ apiKey: null, fetch: fetch as typeof globalThis.fetch });
    await expect(provider.getWeeklyProjections('2026', 1)).resolves.toEqual({
      status: 'unavailable', season: '2026', week: 1, reason: 'missing-api-key', message: 'Player projections are not configured.',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['HTTP failure', new Response(null, { status: 429 }), 'provider-error'],
    ['provider error envelope', Response.json({ statusCode: 200, body: {}, error: 'quota reached' }), 'provider-error'],
    ['invalid JSON', new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }), 'invalid-response'],
    ['missing provider status', Response.json({ body: projectionEnvelope().body }), 'invalid-response'],
    ['partial envelope', Response.json({ statusCode: 200, body: { playerProjections: {} } }), 'invalid-response'],
    ['empty full slate', Response.json({ statusCode: 200, body: { playerProjections: {}, teamDefenseProjections: {} } }), 'invalid-response'],
  ])('represents %s as unavailable and applies a short failure backoff', async (_label, failedResponse, reason) => {
    let clock = Date.parse('2026-09-01T12:00:00Z');
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return url.pathname === '/getNFLProjections' ? failedResponse.clone() : Response.json(playerEnvelope());
    });
    const provider = createTank01ProjectionProvider({
      apiKey: 'fixture-key', fetch: fetch as typeof globalThis.fetch, now: () => clock, failureBackoffMs: 30_000,
    });

    const first = await provider.getWeeklyProjections('2026', 1);
    expect(first).toMatchObject({ status: 'unavailable', reason, retryAt: '2026-09-01T12:00:30.000Z' });
    const callsAfterFailure = fetch.mock.calls.length;
    await expect(provider.getWeeklyProjections('2026', 1)).resolves.toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(callsAfterFailure);

    clock += 30_001;
    await provider.getWeeklyProjections('2026', 1);
    expect(fetch.mock.calls.length).toBeGreaterThan(callsAfterFailure);
  });

  it('rejects invalid requests before reading credentials or calling Tank01', async () => {
    const fetch = mockFetch();
    const provider = createTank01ProjectionProvider({ apiKey: 'fixture-key', fetch: fetch as typeof globalThis.fetch });
    await expect(provider.getWeeklyProjections('26', 1)).resolves.toMatchObject({ status: 'unavailable', reason: 'invalid-request' });
    await expect(provider.getWeeklyProjections('2026', 0)).resolves.toMatchObject({ status: 'unavailable', reason: 'invalid-request' });
    await expect(provider.getWeeklyProjections('2026', 19)).resolves.toMatchObject({ status: 'unavailable', reason: 'invalid-request' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never writes credentials or provider errors to a console', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const fetch = vi.fn(async () => Response.json({ statusCode: 200, body: {}, error: 'secret provider detail' }));
    const provider = createTank01ProjectionProvider({ apiKey: 'do-not-log-this', fetch: fetch as typeof globalThis.fetch });
    const result = await provider.getWeeklyProjections('2026', 1);
    expect(result).toMatchObject({ status: 'unavailable', reason: 'provider-error', message: 'Player projections are temporarily unavailable.' });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
  });
});
