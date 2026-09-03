import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    const pending = new Map<string, Promise<Result>>();
    const registration = {
      keyParts: [...keyParts], options, invocations: [] as unknown[][], loads: 0, values: [] as unknown[],
    };
    nextCacheRegistrations.push(registration);
    return async (...args: Arguments): Promise<Result> => {
      registration.invocations.push(args);
      const key = JSON.stringify(args);
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const inFlight = pending.get(key);
      if (inFlight) return inFlight;
      const loading = (async () => {
        registration.loads += 1;
        const loaded = await loader(...args);
        const serialized = JSON.parse(JSON.stringify(loaded)) as Result;
        registration.values.push(serialized);
        cache.set(key, serialized);
        return serialized;
      })();
      pending.set(key, loading);
      try {
        return await loading;
      } finally {
        pending.delete(key);
      }
    };
  },
}));

import { NFL_TEAMS } from '../../../nfl-teams';
import type { LeaguePeriod } from '../../domain/contracts';
import {
  externalPlayerRef,
  externalTeamDefenseRef,
  providerKey,
} from '../../shared/provider-identity';
import { compatibleRevision } from '../../shared/revision-compatibility';
import {
  createCachedTank01ProjectionFeed,
  joinNormalizedProjectionSlate,
} from './projection-feed';
import { normalizeCrosswalk, normalizeProjectionSlate } from './projection-normalization';
import { assessProjectionSlate } from './slate-validation';

const period: LeaguePeriod = { season: 2026, seasonType: 'regular', week: 1 };
const tankProvider = providerKey('tank01');
const officialProvider = providerKey('sleeper');

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
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    void init;
    const url = new URL(String(input));
    if (url.pathname === '/getNFLProjections') return Response.json(projections);
    if (url.pathname === '/getNFLPlayerList') return Response.json(players);
    return new Response(null, { status: 404 });
  });
}

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
    return { playerID, sleeperBotID: `official-${team}-${position}` };
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

function translateProjectionFixture(
  projections: unknown = projectionEnvelope(),
  players: unknown = playerEnvelope(),
  at = Date.parse('2026-09-01T12:00:00.000Z'),
) {
  return joinNormalizedProjectionSlate(
    period,
    normalizeProjectionSlate(projections, at),
    normalizeCrosswalk(players),
    tankProvider,
    officialProvider,
  );
}

describe('Tank01 canonical projection feed', () => {
  beforeEach(() => {
    nextCacheRegistrations.length = 0;
  });
  it('exposes the adapter-owned schedule-relative slate assessment through the port', () => {
    const feed = createCachedTank01ProjectionFeed({
      apiKey: () => null,
      provider: tankProvider,
      officialProvider,
      fetch: globalThis.fetch,
      now: () => Date.parse('2026-09-01T12:00:00.000Z'),
    });
    expect(feed.assessProjectionSlate).toBe(assessProjectionSlate);
  });

  it('normalizes once, keeps the crosswalk private, and emits a legacy-compatible revision', () => {
    const now = Date.parse('2026-09-01T12:00:00Z');
    const first = translateProjectionFixture(projectionEnvelope(), playerEnvelope(), now);

    expect(first.status).toBe('available');
    if (first.status !== 'available') return;
    expect(first.slate).toMatchObject({
      source: 'tank01',
      period,
      quality: 'partial',
      requestStartedAt: '2026-09-01T12:00:00.000Z',
      requestCompletedAt: '2026-09-01T12:00:00.000Z',
      observedAt: '2026-09-01T12:00:00.000Z',
      coverage: {
        crosswalkRows: 1, crosswalkEntries: 1, playerRows: 1, matchedPlayers: 1,
        unmatchedPlayers: 0, defenseRows: 1, usableDefenses: 1,
      },
    });
    const quarterback = first.slate.projections.find((value) => value.position === 'QB');
    expect(quarterback).toMatchObject({
      identity: {
        primary: { provider: 'tank01', externalId: 'tank-qb', entityKind: 'player' },
        aliases: [{ provider: 'sleeper', externalId: 'sleeper-qb', entityKind: 'player' }],
      },
      nflTeam: 'WAS',
      stats: { passing: { yards: 275.25 }, rushing: { yards: -1.5 } },
      scoringStats: {
        kind: 'offense', passingYards: 275.25, passingTouchdowns: 2.1,
        rushingYards: -1.5, twoPointConversions: 0.05,
      },
      missingFields: [],
    });
    expect(JSON.stringify(first.slate)).not.toContain('sleeperBotID');
    expect(JSON.stringify(first.slate)).not.toContain('bySleeperId');
    expect(JSON.stringify(first.slate)).not.toContain('tank01PlayerId');

    const expectedStats = {
      passing: { attempts: 34.5, completions: 22.1, yards: 275.25, touchdowns: 2.1, interceptions: 0.6 },
      rushing: { carries: 4, yards: -1.5, touchdowns: 0.2 },
      receiving: { targets: 0, receptions: 0, yards: 0, touchdowns: 0 },
      kicking: {
        fieldGoalsMade: null, fieldGoalsMissed: null, extraPointsMade: null, extraPointsMissed: null,
      },
      twoPointConversions: 0.05,
      fumblesLost: 0.1,
    };
    const expectedScoringStats = {
      kind: 'offense',
      passingYards: 275.25,
      passingTouchdowns: 2.1,
      passingInterceptions: 0.6,
      rushingYards: -1.5,
      rushingTouchdowns: 0.2,
      receptions: 0,
      receivingYards: 0,
      receivingTouchdowns: 0,
      twoPointConversions: 0.05,
      fumblesLost: 0.1,
    };
    const expectedDefenseStats = {
      returnTouchdowns: 0.1,
      defensiveTouchdowns: 0.2,
      safeties: 0.05,
      fumbleRecoveries: 0.8,
      pointsAllowed: 20.5,
      interceptions: 1.25,
      sacks: 2.75,
      blockedKicks: 0.1,
    };
    const expectedDefenseScoringStats = {
      kind: 'defense',
      sacks: 2.75,
      interceptions: 1.25,
      fumbleRecoveries: 0.8,
      defensiveTouchdowns: 0.2,
      specialTeamsTouchdowns: 0.1,
      safeties: 0.05,
      blockedKicks: 0.1,
      pointsAllowed: 20.5,
    };
    const legacyCoverage = {
      playerListRows: 1,
      crosswalkEntries: 1,
      malformedPlayerListRows: 0,
      ambiguousPlayerListRows: 0,
      playerProjectionRows: 1,
      matchedPlayerProjections: 1,
      unmatchedPlayerProjections: 0,
      malformedPlayerProjections: 0,
      incompletePlayerProjections: 0,
      defenseProjectionRows: 1,
      usableDefenseProjections: 1,
      malformedDefenseProjections: 0,
      incompleteDefenseProjections: 0,
    };
    expect(first.slate.sourceRevision).toBe(compatibleRevision({
      season: '2026',
      week: 1,
      fetchedAt: '2026-09-01T12:00:00.000Z',
      coverage: legacyCoverage,
      projections: {
        bySleeperId: {
          'sleeper-qb': {
            tank01PlayerId: 'tank-qb', team: 'WAS', position: 'QB', stats: expectedStats,
            scoringProjection: expectedScoringStats, missingFields: [], sleeperPlayerId: 'sleeper-qb',
          },
        },
        byDefenseTeam: {
          JAX: {
            team: 'JAX', stats: expectedDefenseStats,
            scoringProjection: expectedDefenseScoringStats, missingFields: [],
          },
        },
      },
    }));
  });

  it('preserves success caching, coalescing, and archive-season request behavior', async () => {
    const clock = Date.parse('2026-09-01T12:00:00Z');
    const fetch = mockFetch(completeProjectionEnvelope(), playerEnvelope(completePlayerListRows()));
    const feed = createCachedTank01ProjectionFeed({
      apiKey: () => 'fixture-key', provider: tankProvider, officialProvider,
      fetch: fetch as typeof globalThis.fetch, now: () => clock,
    });

    const [first, second] = await Promise.all([
      feed.getProjectionSlate({ ...period, season: 2025 }),
      feed.getProjectionSlate({ ...period, season: 2025 }),
    ]);
    expect(first).toEqual(second);
    expect(fetch).toHaveBeenCalledTimes(2);
    const projectionCall = fetch.mock.calls.find(([input]) => (
      new URL(String(input)).pathname === '/getNFLProjections'
    ));
    expect(Object.fromEntries(new URL(String(projectionCall?.[0])).searchParams)).toEqual({
      week: '1', itemFormat: 'map', archiveSeason: '2025',
    });
    expect(new URL(String(projectionCall?.[0])).hostname)
      .toBe('tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com');
    expect(projectionCall?.[1]).toMatchObject({
      method: 'GET', cache: 'no-store', redirect: 'error',
      headers: {
        Accept: 'application/json',
        'x-rapidapi-host': 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com',
        'x-rapidapi-key': 'fixture-key',
      },
    });
    expect(projectionCall?.[1]?.signal).toBeInstanceOf(AbortSignal);

    const januaryFetch = mockFetch(
      completeProjectionEnvelope(),
      playerEnvelope(completePlayerListRows()),
    );
    await createCachedTank01ProjectionFeed({
      apiKey: () => 'fixture-key', provider: tankProvider, officialProvider,
      fetch: januaryFetch as typeof globalThis.fetch,
      now: () => Date.parse('2027-01-03T12:00:00Z'),
    }).getProjectionSlate({ ...period, week: 18 });
    const januaryProjectionCall = januaryFetch.mock.calls.find(([input]) => (
      new URL(String(input)).pathname === '/getNFLProjections'
    ));
    expect(Object.fromEntries(new URL(String(januaryProjectionCall?.[0])).searchParams)).toEqual({
      week: '18', itemFormat: 'map',
    });

    await feed.getProjectionSlate({ ...period, season: 2025 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('preserves reserved external IDs without mutating record prototypes', () => {
    const playerProjections = Object.create(null) as Record<string, unknown>;
    playerProjections.__proto__ = playerProjection({ playerID: '__proto__', pos: 'RB' });
    Object.defineProperty(playerProjections, 'constructor', {
      value: playerProjection({ playerID: 'constructor', pos: 'WR' }),
      enumerable: true,
    });
    const result = translateProjectionFixture(projectionEnvelope({
      body: { playerProjections, teamDefenseProjections: { JAC: defenseProjection() } },
    }), playerEnvelope([
        { playerID: '__proto__', sleeperBotID: 'constructor' },
        { playerID: 'constructor', sleeperBotID: '__proto__' },
    ]));

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.slate.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        identity: {
          primary: externalPlayerRef(tankProvider, '__proto__'),
          aliases: [externalPlayerRef(officialProvider, 'constructor')],
        },
      }),
      expect.objectContaining({
        identity: {
          primary: externalPlayerRef(tankProvider, 'constructor'),
          aliases: [externalPlayerRef(officialProvider, '__proto__')],
        },
      }),
    ]));
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('canonicalizes defense aliases and rejects invalid or contradictory defense identities', () => {
    const result = translateProjectionFixture(projectionEnvelope({
      body: {
        playerProjections: { 'tank-qb': playerProjection() },
        teamDefenseProjections: {
          WSH: defenseProjection({ teamAbv: 'WSH' }),
          wrong: defenseProjection({ teamAbv: 'XYZ' }),
          SF: defenseProjection({ teamAbv: 'LAC' }),
        },
      },
    }));

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    const defenses = result.slate.projections.filter(({ identity }) => (
      identity.primary.entityKind === 'team-defense'
    ));
    expect(defenses).toEqual([
      expect.objectContaining({
        identity: { primary: externalTeamDefenseRef(tankProvider, 'WAS'), aliases: [] },
        nflTeam: 'WAS',
      }),
    ]);
    expect(result.slate.coverage).toMatchObject({
      defenseRows: 3, usableDefenses: 1, malformedDefenses: 2,
    });
    expect(result.slate.warnings).toContain('Some malformed Tank01 projection rows were ignored.');
  });

  it.each(['K', 'PK'])('emits canonical kicker statistics for the %s position', (position) => {
    const result = translateProjectionFixture(projectionEnvelope({
      body: {
        playerProjections: {
          'tank-kicker': playerProjection({
            playerID: 'tank-kicker',
            pos: position,
            Passing: undefined,
            Rushing: undefined,
            Receiving: undefined,
            Kicking: { fgMade: '2.4', fgMissed: '0.3', xpMade: '2.8', xpMissed: '0.1' },
            twoPointConversion: '0',
            fumblesLost: '0',
          }),
        },
        teamDefenseProjections: { JAC: defenseProjection() },
      },
    }), playerEnvelope([
      { playerID: 'tank-kicker', sleeperBotID: 'official-kicker' },
    ]));

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.slate.projections.find(({ position: value }) => value === position)).toMatchObject({
      scoringStats: {
        kind: 'kicker', fieldGoalsMade: 2.4, fieldGoalsMissed: 0.3,
        extraPointsMade: 2.8, extraPointsMissed: 0.1,
      },
      missingFields: [],
    });
  });

  it('preserves incomplete rows as nulls and reports malformed numeric input without coercion', () => {
    const result = translateProjectionFixture(projectionEnvelope({
        body: {
          playerProjections: {
            'tank-qb': playerProjection({
              Passing: {
                passAttempts: 'nope', passCompletions: '', passYds: '300.5',
                passTD: null, int: 'Infinity',
              },
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
    }));

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    const quarterback = result.slate.projections.find(({ position }) => position === 'QB');
    expect(quarterback).toMatchObject({
      stats: {
        passing: {
          attempts: null, completions: null, yards: 300.5, touchdowns: null, interceptions: null,
        },
        rushing: { carries: null, yards: null, touchdowns: null },
        fumblesLost: null,
      },
      missingFields: expect.arrayContaining([
        'Passing.passAttempts', 'Passing.passCompletions', 'Passing.passTD', 'Passing.int',
        'Rushing.carries', 'Rushing.rushYds', 'Rushing.rushTD', 'fumblesLost',
      ]),
    });
    const defense = result.slate.projections.find(({ identity }) => (
      identity.primary.entityKind === 'team-defense'
    ));
    expect(defense).toMatchObject({ stats: { sacks: null, interceptions: null } });
    expect(result.slate.coverage).toMatchObject({
      playerRows: 4, matchedPlayers: 1, malformedPlayers: 3, incompletePlayers: 1,
      defenseRows: 3, usableDefenses: 1, malformedDefenses: 2, incompleteDefenses: 1,
    });
    expect(result.slate.warnings).toEqual(expect.arrayContaining([
      'Some malformed Tank01 projection rows were ignored.',
      'Some Tank01 projection rows are missing one or more projected statistics.',
    ]));
  });

  it('keeps ambiguous identities unmatched and preserves malformed or missing values as missing', () => {
    const result = translateProjectionFixture(projectionEnvelope({
      body: {
        playerProjections: {
          'tank-qb': playerProjection({ Passing: { passYds: '1e3' } }),
          'tank-other': playerProjection({ playerID: 'tank-other', pos: 'RB' }),
        },
        teamDefenseProjections: { JAC: defenseProjection() },
      },
    }), playerEnvelope([
      { playerID: 'tank-qb', sleeperBotID: 'shared' },
      { playerID: 'tank-other', sleeperBotID: 'shared' },
      { playerID: 'safe', sleeperBotID: 'safe-official' },
      'malformed',
    ]));
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    const unmatchedPlayers = result.slate.projections.filter(({ identity }) => (
      identity.primary.entityKind === 'player'
    ));
    expect(unmatchedPlayers).toHaveLength(2);
    expect(unmatchedPlayers.map(({ identity }) => identity.primary.externalId).sort())
      .toEqual(['tank-other', 'tank-qb']);
    expect(unmatchedPlayers.every(({ identity }) => identity.aliases.length === 0)).toBe(true);
    expect(result.slate.coverage).toMatchObject({
      crosswalkRows: 4, crosswalkEntries: 1, malformedCrosswalkRows: 1,
      ambiguousCrosswalkRows: 2, playerRows: 2, matchedPlayers: 0, unmatchedPlayers: 2,
      incompletePlayers: 1,
    });
  });

  it('rejects invalid periods and missing injected credentials before any request', async () => {
    const fetch = mockFetch();
    const configured = createCachedTank01ProjectionFeed({
      apiKey: () => 'fixture-key', provider: tankProvider, officialProvider,
      fetch: fetch as typeof globalThis.fetch,
      now: () => Date.parse('2026-09-01T12:00:00.000Z'),
    });
    const disabled = createCachedTank01ProjectionFeed({
      apiKey: () => null, provider: tankProvider, officialProvider,
      fetch: fetch as typeof globalThis.fetch,
      now: () => Date.parse('2026-09-01T12:00:00.000Z'),
    });
    await expect(configured.getProjectionSlate({ ...period, season: 26 })).resolves.toMatchObject({
      status: 'unavailable', reason: 'invalid-request', period: { season: 26 },
    });
    await expect(configured.getProjectionSlate({ ...period, week: 0 })).resolves.toMatchObject({
      status: 'unavailable', reason: 'invalid-request', period: { week: 0 },
    });
    await expect(configured.getProjectionSlate({ ...period, week: 19 })).resolves.toMatchObject({
      status: 'unavailable', reason: 'invalid-request', period: { week: 19 },
    });
    await expect(configured.getProjectionSlate({ ...period, seasonType: 'postseason' })).resolves.toMatchObject({
      status: 'unavailable', reason: 'invalid-request', period: { seasonType: 'postseason' },
    });
    await expect(disabled.getProjectionSlate(period)).resolves.toEqual({
      status: 'unavailable', period, reason: 'not-configured',
      message: 'Player projections are not configured.',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads credentials at request time without placing them in persistent-cache keys', async () => {
    let apiKey: string | null = null;
    const fetch = mockFetch(completeProjectionEnvelope(), playerEnvelope(completePlayerListRows()));
    const feed = createCachedTank01ProjectionFeed({
      apiKey: () => apiKey,
      provider: tankProvider,
      officialProvider,
      fetch: fetch as typeof globalThis.fetch,
      now: () => Date.parse('2026-09-01T12:00:00.000Z'),
    });

    await expect(feed.getProjectionSlate(period)).resolves.toMatchObject({
      status: 'unavailable', reason: 'not-configured',
    });
    expect(fetch).not.toHaveBeenCalled();

    apiKey = 'first-secret';
    await expect(feed.getProjectionSlate(period)).resolves.toMatchObject({ status: 'available' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([, init]) => (
      new Headers(init?.headers).get('x-rapidapi-key')
    ))).toEqual(['first-secret', 'first-secret']);

    apiKey = null;
    await expect(feed.getProjectionSlate(period)).resolves.toMatchObject({
      status: 'unavailable', reason: 'not-configured',
    });
    expect(fetch).toHaveBeenCalledTimes(2);

    apiKey = 'rotated-secret';
    await expect(feed.getProjectionSlate({ ...period, week: 2 })).resolves.toMatchObject({
      status: 'available',
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(new Headers(fetch.mock.calls[2]?.[1]?.headers).get('x-rapidapi-key'))
      .toBe('rotated-secret');
    expect(JSON.stringify(nextCacheRegistrations.map(({ keyParts, invocations }) => ({
      keyParts, invocations,
    })))).not.toMatch(/first-secret|rotated-secret/u);
  });

  it('uses the exact production cache namespaces and rejects truncated slates before caching', async () => {
    let clock = Date.parse('2026-09-01T12:00:00Z');
    let complete = false;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/getNFLProjections') {
        return Response.json(complete ? completeProjectionEnvelope() : projectionEnvelope());
      }
      return Response.json(playerEnvelope(completePlayerListRows()));
    });
    const secret = 'must-not-enter-cache-keys';
    const feed = createCachedTank01ProjectionFeed({
      apiKey: () => secret, provider: tankProvider, officialProvider,
      fetch: fetch as typeof globalThis.fetch, now: () => clock,
    });
    const projectionRegistration = nextCacheRegistrations.find(({ keyParts }) => (
      keyParts.includes('tank01-normalized-projection-slate-v3')
    ));
    const crosswalkRegistration = nextCacheRegistrations.find(({ keyParts }) => (
      keyParts.includes('tank01-normalized-player-crosswalk-v1')
    ));
    expect(projectionRegistration?.options.revalidate).toBe(3_600);
    expect(crosswalkRegistration?.options.revalidate).toBe(3_600);

    const failed = await feed.getProjectionSlate(period);
    expect(failed).toMatchObject({
      status: 'unavailable', reason: 'invalid-response', retryAt: '2026-09-01T12:01:00.000Z',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(feed.getProjectionSlate(period)).resolves.toEqual(failed);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(projectionRegistration?.values).toHaveLength(0);

    clock += 60_001;
    complete = true;
    const recovered = await feed.getProjectionSlate(period);
    expect(recovered).toMatchObject({ status: 'available', slate: { quality: 'complete' } });
    expect(fetch).toHaveBeenCalledTimes(3);
    const callsAfterRecovery = fetch.mock.calls.length;
    await expect(feed.getProjectionSlate(period)).resolves.toEqual(recovered);
    expect(fetch).toHaveBeenCalledTimes(callsAfterRecovery);
    expect(projectionRegistration?.values).toHaveLength(1);
    expect(crosswalkRegistration?.values).toHaveLength(1);
    expect(projectionRegistration?.values[0]).not.toHaveProperty('body');
    expect(projectionRegistration?.values[0]).not.toHaveProperty('statusCode');
    expect(crosswalkRegistration?.values[0]).not.toHaveProperty('body');
    expect(JSON.stringify(nextCacheRegistrations.map(({ keyParts, invocations }) => ({
      keyParts, invocations,
    })))).not.toContain(secret);
  });

  it.each([
    ['HTTP failure', () => Promise.resolve(new Response(null, { status: 429 })), 'provider-error'],
    ['provider error envelope', () => Promise.resolve(Response.json({
      statusCode: 200, body: {}, error: 'quota reached',
    })), 'provider-error'],
    ['invalid JSON', () => Promise.resolve(new Response('{', { status: 200 })), 'invalid-response'],
    ['missing provider status', () => Promise.resolve(Response.json({
      body: projectionEnvelope().body,
    })), 'invalid-response'],
    ['partial envelope', () => Promise.resolve(Response.json({
      statusCode: 200, body: { playerProjections: {} },
    })), 'invalid-response'],
  ] as const)('maps %s to a safe unavailable result', async (_label, projectionResponse, reason) => {
    const fetch = vi.fn(async (input: string | URL | Request) => (
      new URL(String(input)).pathname === '/getNFLProjections'
        ? projectionResponse()
        : Response.json(playerEnvelope())
    ));
    const result = await createCachedTank01ProjectionFeed({
      apiKey: () => 'fixture-key', provider: tankProvider, officialProvider,
      fetch: fetch as typeof globalThis.fetch,
      now: () => Date.parse('2026-09-01T12:00:00.000Z'),
    }).getProjectionSlate(period);
    expect(result).toMatchObject({ status: 'unavailable', reason });
  });

  it('settles both upstream requests and applies a short failure backoff without logging secrets', async () => {
    vi.useFakeTimers();
    const clock = Date.parse('2026-09-01T12:00:00Z');
    let activeRequests = 0;
    const consoleSpies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('timed out', 'TimeoutError')), milliseconds);
      return controller.signal;
    });
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/getNFLProjections')) return Promise.reject(new Error('secret failure'));
      activeRequests += 1;
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => {
          activeRequests -= 1;
          reject(signal?.reason ?? new Error('aborted'));
        };
        if (!signal || signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    });
    const feed = createCachedTank01ProjectionFeed({
      apiKey: () => 'secret-key', provider: tankProvider, officialProvider,
      fetch: fetch as typeof globalThis.fetch, now: () => clock,
    });
    try {
      const pending = feed.getProjectionSlate(period);
      await vi.advanceTimersByTimeAsync(15_000);
      const failed = await pending;
      expect(failed).toMatchObject({
        status: 'unavailable', reason: 'provider-error', retryAt: '2026-09-01T12:01:00.000Z',
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(timeout).toHaveBeenCalledTimes(2);
      expect(activeRequests).toBe(0);
      await expect(feed.getProjectionSlate(period)).resolves.toEqual(failed);
      expect(fetch).toHaveBeenCalledTimes(2);
      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    } finally {
      await vi.runOnlyPendingTimersAsync();
      timeout.mockRestore();
      vi.useRealTimers();
      consoleSpies.forEach((spy) => spy.mockRestore());
    }
  });
});
