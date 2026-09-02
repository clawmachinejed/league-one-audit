import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <Value,>(value: Value) => value }));
vi.mock('next/server', () => ({ after: vi.fn() }));

import { LEAGUE_IDS } from './config';
import { isMatchupsData } from './matchups-response';
import { handleMatchupsSnapshotRequest, handleProjectionCronRequest } from './projection-http';
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

function readStore(value: StoredProjectionSnapshot | null, enabled = true): {
  store: ProjectionStore;
  read: ReturnType<typeof vi.fn>;
} {
  const read = vi.fn(async () => value);
  return {
    store: { enabled, readLatestCurrentSnapshotBySleeperLeagueId: read } as unknown as ProjectionStore,
    read,
  };
}

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
    expect(await response.json()).toEqual({ status: 'unauthorized' });
    expect(run).not.toHaveBeenCalled();
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
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      status: 'completed', cadence: 'forced', publishedLeagues: 1, failedLeagues: 1, providerGroups: 1,
    });
    expect(body).not.toContain('private-value');
  });

  it('reports a fully successful synchronization as healthy', async () => {
    const response = await handleProjectionCronRequest(
      new Request('https://example.test/api/cron/live-projections', {
        headers: { authorization: 'Bearer private-value' },
      }),
      {
        secret: 'private-value',
        run: async () => ({
          status: 'completed', cadence: 'live-window', publishedLeagues: 2,
          failedLeagues: 0, providerGroups: 1,
        }),
      },
    );

    expect(response.status).toBe(200);
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

    expect(database.read).toHaveBeenCalledWith(LEAGUE_IDS.league1, 1);
    expect(database.read).toHaveBeenCalledWith(LEAGUE_IDS.league1);
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
    )).status).toBe(404);
    expect((await handleMatchupsSnapshotRequest(
      new Request('https://example.test/api/matchups/league1?week=19'), 'league1', missing.store,
    )).status).toBe(400);
    expect((await handleMatchupsSnapshotRequest(
      new Request('https://example.test/api/matchups/not-a-league?week=1'), 'not-a-league', missing.store,
    )).status).toBe(404);
  });

  it('does not return a malformed stored payload', async () => {
    const malformed = snapshot({ ...matchupPayload(), updatedAt: 'not-a-date' });
    const database = readStore(malformed);
    const response = await handleMatchupsSnapshotRequest(
      new Request('https://example.test/api/matchups/league2?week=1'),
      'league2',
      database.store,
    );
    expect(response.status).toBe(503);
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
    const read = vi.fn(async (_leagueId: string, week?: number) => week === 1 ? historical : latest);
    const store = {
      enabled: true,
      readLatestCurrentSnapshotBySleeperLeagueId: read,
    } as unknown as ProjectionStore;
    const response = await handleMatchupsSnapshotRequest(
      new Request('https://example.test/api/matchups/league1?week=1'),
      'league1',
      store,
      new Date('2027-01-01T00:00:00.000Z'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, s-maxage=300, stale-while-revalidate=3600');
    expect((await response.json()).league.week).toBe(2);
  });
});
