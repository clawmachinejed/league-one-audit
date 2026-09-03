import { beforeEach, describe, expect, it, vi } from 'vitest';

const defaultCronRun = vi.hoisted(() => vi.fn());

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <Value,>(value: Value) => value }));
vi.mock('./live-projection-worker', () => ({ runLiveProjectionSync: defaultCronRun }));

import { isMatchupsData } from './matchups-response';
import { handleMatchupsSnapshotRequest } from './projection-http';
import { handleProjectionCronRequest } from './projection-cron-http';
import { ACTIVE_PROJECTION_SOURCE } from './projection-source-config';
import type { ProjectionStore, StoredProjectionSnapshot } from './projection-store';
import type { MatchupsData } from './types';

function matchupPayload(): MatchupsData {
  const team = {
    id: 1,
    managerName: 'Manager',
    name: 'Team',
    avatar: null,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  };
  return {
    league: { season: '2026', rosterPositions: ['QB'], week: 1, maxWeek: 18 },
    teams: [team],
    updatedAt: '2026-09-13T18:00:00.000Z',
    week: 1,
    matchups: [{
      id: '1',
      status: 'upcoming',
      sides: [{
        team,
        points: 0,
        projectedPoints: 10,
        starters: [{
          id: 'player-1',
          name: 'Player One',
          position: 'QB',
          nflTeam: 'LAC',
          injuryStatus: null,
          game: { kind: 'scheduled', opponent: 'KC', location: 'away', date: '2026-09-13', kickoffAt: '2026-09-13T17:00:00.000Z' },
          slot: 'QB',
          points: 0,
          projectedPoints: 10,
        }],
      }],
    }],
  };
}

function snapshot(payload = matchupPayload()): StoredProjectionSnapshot {
  return {
    snapshotId: `snapshot-${payload.week}`,
    leagueSeasonId: 'season-1',
    week: payload.week,
    modelVersion: 'clock-v1',
    revisionKey: 'revision-1',
    calculatedAt: payload.updatedAt,
    publishedAt: payload.updatedAt,
    verifiedAt: payload.updatedAt,
    activityWindows: [{
      startsAt: '2026-09-13T15:00:00.000Z',
      endsAt: '2026-09-14T00:00:00.000Z',
    }],
    isCurrent: true,
    payload,
  };
}

function readStore(
  selected: StoredProjectionSnapshot | null,
  enabled = true,
  latest: StoredProjectionSnapshot | null = selected,
  authorityVerifiedAt = '2026-09-13T18:00:00.000Z',
): {
  store: ProjectionStore;
  read: ReturnType<typeof vi.fn>;
} {
  const authorityWeek = latest?.week ?? selected?.week ?? 1;
  const read = vi.fn(async () => ({
    authority: {
      leagueKey: 'league1', defaultSeason: 2026, defaultSeasonType: 'reg' as const,
      defaultWeek: authorityWeek, activeSeason: 2026, activeSeasonType: 'reg' as const,
      activeWeek: authorityWeek, leagueLifecycle: 'active' as const, nflPhase: 'regular' as const,
      sourceProvider: 'sleeper', sourceRevision: 'period-revision',
      sourceObservedAt: authorityVerifiedAt, verifiedAt: authorityVerifiedAt,
    },
    snapshot: selected,
  }));
  return {
    store: { enabled, readMatchupSnapshotByLeagueKey: read } as unknown as ProjectionStore,
    read,
  };
}

async function expectResponse(
  response: Response,
  expected: Readonly<{ status: number; cacheControl: string; body: unknown }>,
): Promise<void> {
  expect(response.status).toBe(expected.status);
  expect(response.headers.get('cache-control')).toBe(expected.cacheControl);
  await expect(response.json()).resolves.toEqual(expected.body);
}

beforeEach(() => {
  defaultCronRun.mockReset();
});

describe('projection cron HTTP boundary', () => {
  it('requires the configured bearer secret and never invokes the worker when unauthorized', async () => {
    const run = vi.fn();
    const response = await handleProjectionCronRequest(
      new Request('https://example.test/api/cron/live-projections', {
        headers: { authorization: 'Bearer wrong-secret' },
      }),
      { secret: 'correct-secret', run },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'unauthorized' });
    expect(run).not.toHaveBeenCalled();
  });

  it('preserves no-store responses for missing configuration and failed worker outcomes', async () => {
    const missingConfigurationRun = vi.fn();
    await expectResponse(await handleProjectionCronRequest(
      new Request('https://example.test/api/cron/live-projections'),
      { secret: '', run: missingConfigurationRun },
    ), {
      status: 503,
      cacheControl: 'no-store',
      body: { status: 'unavailable' },
    });
    expect(missingConfigurationRun).not.toHaveBeenCalled();

    for (const workerResult of [{ status: 'disabled' as const }, { status: 'failed' as const }]) {
      const run = vi.fn(async () => workerResult);
      await expectResponse(await handleProjectionCronRequest(
        new Request('https://example.test/api/cron/live-projections', {
          headers: { authorization: 'Bearer private-value' },
        }),
        { secret: 'private-value', run },
      ), {
        status: workerResult.status === 'failed' ? 500 : 503,
        cacheControl: 'no-store',
        body: { status: workerResult.status === 'failed' ? 'failed' : 'unavailable' },
      });
      expect(run).toHaveBeenCalledOnce();
      expect(run).toHaveBeenCalledWith({ force: false });
    }

    const throwingRun = vi.fn(async () => { throw new Error('worker failure'); });
    await expectResponse(await handleProjectionCronRequest(
      new Request('https://example.test/api/cron/live-projections', {
        headers: { authorization: 'Bearer private-value' },
      }),
      { secret: 'private-value', run: throwingRun },
    ), {
      status: 500,
      cacheControl: 'no-store',
      body: { status: 'failed' },
    });
    expect(throwingRun).toHaveBeenCalledOnce();
    expect(throwingRun).toHaveBeenCalledWith({ force: false });
  });

  it.each([
    { reason: 'busy' as const, cadence: null },
    { reason: 'completed' as const, cadence: null },
    { reason: 'idle' as const, cadence: 'idle' as const },
  ])('returns a no-store 200 response when the worker skips for $reason', async ({ reason, cadence }) => {
    const run = vi.fn(async () => ({ status: 'skipped' as const, reason, cadence }));
    const response = await handleProjectionCronRequest(
      new Request('https://example.test/api/cron/live-projections', {
        headers: { authorization: 'Bearer private-value' },
      }),
      { secret: 'private-value', run },
    );

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith({ force: false });
    await expectResponse(response, {
      status: 200,
      cacheControl: 'no-store',
      body: { status: 'skipped', reason, cadence },
    });
  });

  it('passes an authenticated force request, returns only counts, and surfaces partial failure', async () => {
    const run = vi.fn(async () => ({
      status: 'completed' as const,
      cadence: 'forced' as const,
      publishedLeagues: 1,
      failedLeagues: 1,
      providerGroups: 1,
    }));
    const response = await handleProjectionCronRequest(
      new Request('https://example.test/api/cron/live-projections?force=1', {
        headers: { authorization: 'Bearer private-value' },
      }),
      { secret: 'private-value', run },
    );

    expect(run).toHaveBeenCalledWith({ force: true });
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      status: 'completed', cadence: 'forced', publishedLeagues: 1, failedLeagues: 1, providerGroups: 1,
    });
    expect(body).not.toContain('private-value');
  });

  it('reports a fully successful synchronization as healthy', async () => {
    const run = vi.fn(async () => ({
      status: 'completed' as const,
      cadence: 'live-window' as const,
      publishedLeagues: 2,
      failedLeagues: 0,
      providerGroups: 1,
    }));
    const response = await handleProjectionCronRequest(
      new Request('https://example.test/api/cron/live-projections', {
        headers: { authorization: 'Bearer private-value' },
      }),
      { secret: 'private-value', run },
    );

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith({ force: false });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      status: 'completed', cadence: 'live-window', publishedLeagues: 2,
      failedLeagues: 0, providerGroups: 1,
    });
  });
});

describe('matchup snapshot HTTP boundary', () => {
  it('returns a validated current snapshot for a canonical league key', async () => {
    expect(isMatchupsData(matchupPayload())).toBe(true);
    const database = readStore(snapshot());
    const response = await handleMatchupsSnapshotRequest(
      new Request('https://example.test/api/matchups/league1?week=1'),
      'league1',
      database.store,
      new Date('2026-09-13T18:02:00.000Z'),
    );

    expect(database.read).toHaveBeenCalledOnce();
    expect(database.read).toHaveBeenCalledWith('league1', 1, {
      projectionProvider: ACTIVE_PROJECTION_SOURCE.provider,
      normalizerVersion: ACTIVE_PROJECTION_SOURCE.normalizerVersion,
      modelVersion: ACTIVE_PROJECTION_SOURCE.modelVersion,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, s-maxage=15, stale-while-revalidate=30');
    expect(await response.json()).toEqual(matchupPayload());
  });

  it('fails safely for disabled storage, missing snapshots, invalid weeks, and noncanonical leagues', async () => {
    const disabled = readStore(null, false);
    expect((await handleMatchupsSnapshotRequest(
      new Request('https://example.test/api/matchups/league1?week=1'), 'league1', disabled.store,
    )).status).toBe(503);
    expect(disabled.read).not.toHaveBeenCalled();

    const missing = readStore(null);
    expect((await handleMatchupsSnapshotRequest(
      new Request('https://example.test/api/matchups/league1?week=1'), 'league1', missing.store,
      new Date('2026-09-13T18:02:00.000Z'),
    )).status).toBe(404);
    expect((await handleMatchupsSnapshotRequest(
      new Request('https://example.test/api/matchups/league1?week=0'), 'league1', missing.store,
    )).status).toBe(400);
    expect((await handleMatchupsSnapshotRequest(
      new Request('https://example.test/api/matchups/league1?week=19'), 'league1', missing.store,
    )).status).toBe(400);
    expect((await handleMatchupsSnapshotRequest(
      new Request('https://example.test/api/matchups/league1'), 'league1', missing.store,
    )).status).toBe(400);
    expect((await handleMatchupsSnapshotRequest(
      new Request('https://example.test/api/matchups/not-a-league?week=1'), 'not-a-league', missing.store,
    )).status).toBe(404);
    expect(missing.read).toHaveBeenCalledOnce();
    expect(missing.read).toHaveBeenCalledWith('league1', 1, {
      projectionProvider: ACTIVE_PROJECTION_SOURCE.provider,
      normalizerVersion: ACTIVE_PROJECTION_SOURCE.normalizerVersion,
      modelVersion: ACTIVE_PROJECTION_SOURCE.modelVersion,
    });
  });

  it('preserves the exact no-store response matrix for every unsuccessful user request', async () => {
    const current = snapshot();
    const databaseFailure = {
      enabled: true,
      readMatchupSnapshotByLeagueKey: vi.fn(async () => { throw new Error('database failure'); }),
    } as unknown as ProjectionStore;
    const cases: Array<Readonly<{
      label: string;
      request: () => Promise<Response>;
      status: number;
      body: unknown;
    }>> = [
      {
        label: 'unknown league',
        request: () => handleMatchupsSnapshotRequest(
          new Request('https://example.test/api/matchups/unknown?week=1'), 'unknown', readStore(null).store,
        ),
        status: 404,
        body: { status: 'not-found' },
      },
      ...['0', '19', 'abc'].map((week) => ({
        label: `invalid week ${week}`,
        request: () => handleMatchupsSnapshotRequest(
          new Request(`https://example.test/api/matchups/league1?week=${week}`),
          'league1',
          readStore(null).store,
        ),
        status: 400,
        body: { status: 'invalid-week' },
      })),
      {
        label: 'missing week',
        request: () => handleMatchupsSnapshotRequest(
          new Request('https://example.test/api/matchups/league1'), 'league1', readStore(null).store,
        ),
        status: 400,
        body: { status: 'invalid-week' },
      },
      {
        label: 'missing snapshot',
        request: () => handleMatchupsSnapshotRequest(
          new Request('https://example.test/api/matchups/league1?week=1'), 'league1', readStore(null).store,
          new Date('2026-09-13T18:02:00.000Z'),
        ),
        status: 404,
        body: { status: 'not-found' },
      },
      {
        label: 'missing snapshot with stale period authority',
        request: () => handleMatchupsSnapshotRequest(
          new Request('https://example.test/api/matchups/league1?week=1'),
          'league1',
          readStore(null).store,
          new Date('2026-09-13T18:10:00.001Z'),
        ),
        status: 404,
        body: { status: 'not-found' },
      },
      {
        label: 'disabled storage',
        request: () => handleMatchupsSnapshotRequest(
          new Request('https://example.test/api/matchups/league1?week=1'), 'league1', readStore(null, false).store,
        ),
        status: 503,
        body: { status: 'unavailable' },
      },
      {
        label: 'stale snapshot',
        request: () => handleMatchupsSnapshotRequest(
          new Request('https://example.test/api/matchups/league1?week=1'),
          'league1',
          readStore(current).store,
          new Date('2026-09-13T18:03:01.000Z'),
        ),
        status: 503,
        body: { status: 'unavailable' },
      },
      {
        label: 'stale period authority',
        request: () => handleMatchupsSnapshotRequest(
          new Request('https://example.test/api/matchups/league1?week=1'),
          'league1',
          readStore(current).store,
          new Date('2026-09-13T18:10:00.001Z'),
        ),
        status: 503,
        body: { status: 'unavailable' },
      },
      {
        label: 'malformed snapshot',
        request: () => {
          const malformed = { ...current, week: 2 };
          return handleMatchupsSnapshotRequest(
            new Request('https://example.test/api/matchups/league1?week=1'),
            'league1',
            readStore(malformed, true, malformed).store,
            new Date('2026-09-13T18:02:00.000Z'),
          );
        },
        status: 503,
        body: { status: 'unavailable' },
      },
      {
        label: 'database failure',
        request: () => handleMatchupsSnapshotRequest(
          new Request('https://example.test/api/matchups/league1?week=1'),
          'league1',
          databaseFailure,
        ),
        status: 503,
        body: { status: 'unavailable' },
      },
    ];

    for (const testCase of cases) {
      const response = await testCase.request();
      expect(response.status, testCase.label).toBe(testCase.status);
      expect(response.headers.get('cache-control'), testCase.label).toBe('no-store');
      expect(await response.json(), testCase.label).toEqual(testCase.body);
    }
    expect(defaultCronRun).not.toHaveBeenCalled();
  });

  it('does not return a malformed stored payload', async () => {
    const malformed = snapshot({ ...matchupPayload(), updatedAt: 'not-a-date' });
    const database = readStore(malformed);
    const response = await handleMatchupsSnapshotRequest(
      new Request('https://example.test/api/matchups/league2?week=1'),
      'league2',
      database.store,
      new Date('2026-09-13T18:02:00.000Z'),
    );
    expect(database.read).toHaveBeenCalledWith('league2', 1, {
      projectionProvider: ACTIVE_PROJECTION_SOURCE.provider,
      normalizerVersion: ACTIVE_PROJECTION_SOURCE.normalizerVersion,
      modelVersion: ACTIVE_PROJECTION_SOURCE.modelVersion,
    });
    expect(response.status).toBe(503);
  });

  it.each([
    {
      field: 'nested manager name',
      corrupt: (data: MatchupsData) => {
        const side = data.matchups[0].sides[0];
        side.team = { ...side.team };
        Object.assign(side.team, { managerName: 42 });
      },
    },
    {
      field: 'starter points',
      corrupt: (data: MatchupsData) => {
        Object.assign(data.matchups[0].sides[0].starters[0], { points: '12.4' });
      },
    },
    {
      field: 'starter game location',
      corrupt: (data: MatchupsData) => {
        Object.assign(data.matchups[0].sides[0].starters[0].game!, { location: 'neutral' });
      },
    },
    {
      field: 'starter collection',
      corrupt: (data: MatchupsData) => {
        Object.assign(data.matchups[0].sides[0], { starters: null });
      },
    },
  ])('rejects malformed $field even when snapshot metadata and timestamps are valid', async ({ corrupt }) => {
    const data = matchupPayload();
    expect(isMatchupsData(data)).toBe(true);
    corrupt(data);
    const database = readStore(snapshot(data));
    await expectResponse(await handleMatchupsSnapshotRequest(
      new Request('https://example.test/api/matchups/league1?week=1'),
      'league1', database.store, new Date('2026-09-13T18:02:00.000Z'),
    ), {
      status: 503,
      cacheControl: 'no-store',
      body: { status: 'unavailable' },
    });
    expect(database.read).toHaveBeenCalledOnce();
    expect(defaultCronRun).not.toHaveBeenCalled();
  });

  it('rejects a stale current snapshot so the client can refresh official data from Sleeper', async () => {
    const database = readStore(snapshot());
    const response = await handleMatchupsSnapshotRequest(
      new Request('https://example.test/api/matchups/league1?week=1'),
      'league1',
      database.store,
      new Date('2026-09-13T18:03:01.000Z'),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });

  it('retains an old historical snapshot and gives it a longer edge cache', async () => {
    const historicalPayload = matchupPayload();
    const historical = snapshot(historicalPayload);
    const latestPayload = matchupPayload();
    latestPayload.week = 2;
    latestPayload.league.week = 2;
    const latest = snapshot(latestPayload);
    const database = readStore(historical, true, latest, '2027-01-01T00:00:00.000Z');
    const response = await handleMatchupsSnapshotRequest(
      new Request('https://example.test/api/matchups/league1?week=1'),
      'league1',
      database.store,
      new Date('2027-01-01T00:00:00.000Z'),
    );

    expect(response.status).toBe(200);
    expect(database.read).toHaveBeenCalledOnce();
    expect(response.headers.get('cache-control')).toBe('public, s-maxage=300, stale-while-revalidate=3600');
    const body = await response.json();
    expect(body.week).toBe(1);
    expect(body.league.week).toBe(1);
  });
});
