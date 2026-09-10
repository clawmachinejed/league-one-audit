import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { readStoredMatchups } from './projection-reader';
import { ACTIVE_PROJECTION_SOURCE } from './projection-source-config';
import type {
  ProjectionStore,
  StoredFutureMaterializationFreshness,
  StoredLeaguePeriodAuthority,
  StoredProjectionSnapshot,
} from './projection-store';
import type { MatchupsData } from './types';

function payload(week: number): MatchupsData {
  return {
    league: { season: '2026', rosterPositions: ['QB'], week, maxWeek: 18 },
    teams: [], updatedAt: '2026-09-13T18:00:00.000Z', week, matchups: [],
  };
}

function snapshot(week: number): StoredProjectionSnapshot {
  return {
    snapshotId: `snapshot-${week}`, leagueSeasonId: 'season-1', week,
    modelVersion: 'clock-v1', revisionKey: `revision-${week}`,
    calculatedAt: '2026-09-13T18:00:00.000Z',
    publishedAt: '2026-09-13T18:00:00.000Z',
    verifiedAt: '2026-09-13T18:00:00.000Z', activityWindows: [],
    isCurrent: true, payload: payload(week),
  };
}

function activeWeekBetweenGames(): StoredProjectionSnapshot {
  const stored = snapshot(1);
  const team = {
    id: 1, managerName: 'Manager', name: 'Team', avatar: null,
    wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
  };
  const matchup = (
    id: string,
    status: 'live' | 'upcoming',
    kickoffAt: string,
  ): MatchupsData['matchups'][number] => ({
    id, status,
    sides: [{
      team, points: 0, projectedPoints: 10,
      starters: [{
        id: `player-${id}`, name: `Player ${id}`, position: 'QB', nflTeam: 'LAC',
        injuryStatus: null, slot: 'QB', points: 0, projectedPoints: 10,
        game: {
          kind: 'scheduled', opponent: 'KC', location: 'away',
          date: '2026-09-10', kickoffAt,
        },
      }],
    }],
  });
  return {
    ...stored,
    calculatedAt: '2026-09-10T12:00:00.000Z',
    publishedAt: '2026-09-10T12:00:00.000Z',
    verifiedAt: '2026-09-10T12:00:00.000Z',
    activityWindows: [
      { startsAt: '2026-09-10T00:00:00.000Z', endsAt: '2026-09-10T09:00:00.000Z' },
      { startsAt: '2026-09-10T15:00:00.000Z', endsAt: '2026-09-11T00:00:00.000Z' },
    ],
    payload: {
      ...stored.payload,
      updatedAt: '2026-09-10T12:00:00.000Z',
      teams: [team],
      matchups: [
        matchup('1', 'live', '2026-09-10T02:00:00.000Z'),
        matchup('2', 'upcoming', '2026-09-10T17:00:00.000Z'),
      ],
    },
  };
}

function authority(overrides: Partial<StoredLeaguePeriodAuthority> = {}): StoredLeaguePeriodAuthority {
  return {
    leagueKey: 'league1', defaultSeason: 2026, defaultSeasonType: 'reg', defaultWeek: 2,
    activeSeason: 2026, activeSeasonType: 'reg', activeWeek: 1,
    leagueLifecycle: 'active', nflPhase: 'regular', sourceProvider: 'sleeper',
    sourceRevision: 'period-revision', sourceObservedAt: '2026-09-13T18:00:00.000Z',
    verifiedAt: '2026-09-13T18:00:00.000Z', ...overrides,
  };
}

function futureRefresh(
  overrides: Partial<StoredFutureMaterializationFreshness> = {},
): StoredFutureMaterializationFreshness {
  return {
    nextRefreshAt: '2026-09-21T00:00:00.000Z',
    lastSucceededAt: '2026-09-13T18:00:00.000Z',
    activeAttemptExpiresAt: null,
    lastProjectionSlateContentId: 'slate-content-2',
    currentProjectionSlateContentId: 'slate-content-2',
    lastSnapshotRevision: 'revision-2',
    ...overrides,
  };
}

function store(
  value: Awaited<ReturnType<ProjectionStore['readMatchupSnapshotByLeagueKey']>>,
  enabled = true,
): ProjectionStore {
  return {
    enabled,
    readMatchupSnapshotByLeagueKey: vi.fn(async () => value),
  } as unknown as ProjectionStore;
}

describe('period-aware stored matchup reader', () => {
  it.each([
    { now: '2026-09-10T12:04:00.000Z', expected: 'usable' },
    { now: '2026-09-10T13:15:00.000Z', expected: 'usable' },
    { now: '2026-09-10T13:15:00.001Z', expected: 'stale' },
  ])('applies between-game freshness at $now for a live/upcoming active week', async ({ now, expected }) => {
    const stored = activeWeekBetweenGames();
    const database = store({
      authority: authority({
        defaultWeek: 1,
        sourceObservedAt: now,
        verifiedAt: now,
      }),
      snapshot: stored,
      futureRefresh: null,
    });
    await expect(readStoredMatchups('league1', 1, {
      store: database,
      now: new Date(now),
    })).resolves.toMatchObject({ kind: expected });
  });

  it('resolves an omitted week to the authority default, never the latest stored week', async () => {
    const database = store({ authority: authority(), snapshot: snapshot(2), futureRefresh: null });
    const result = await readStoredMatchups('league1', undefined, {
      store: database, now: new Date('2026-09-13T18:05:00.000Z'),
    });
    expect(result).toMatchObject({
      kind: 'usable', historical: false,
      context: { defaultWeek: 2, activeWeek: 1, temporalState: 'future' },
    });
    expect(database.readMatchupSnapshotByLeagueKey).toHaveBeenCalledWith('league1', undefined, {
      projectionProvider: ACTIVE_PROJECTION_SOURCE.provider,
      normalizerVersion: ACTIVE_PROJECTION_SOURCE.normalizerVersion,
      modelVersion: ACTIVE_PROJECTION_SOURCE.modelVersion,
    });
  });

  it('preserves an exact explicit past week and does not rewrite its payload context', async () => {
    const database = store({
      authority: authority({
        activeWeek: 2,
        sourceObservedAt: '2027-01-01T00:00:00.000Z',
        verifiedAt: '2027-01-01T00:00:00.000Z',
      }),
      snapshot: snapshot(1), futureRefresh: null,
    });
    const result = await readStoredMatchups('league1', 1, {
      store: database, now: new Date('2027-01-01T00:00:00.000Z'),
    });
    expect(result).toMatchObject({ kind: 'usable', historical: true });
    if (result.kind === 'usable') {
      expect(result.context.temporalState).toBe('past');
      expect(result.payload.week).toBe(1);
      expect(result.payload.league.week).toBe(1);
    }
  });

  it('uses durable future scheduling and lineage instead of a fixed snapshot age', async () => {
    const now = new Date('2026-09-20T18:00:00.000Z');
    const scheduled = await readStoredMatchups('league1', 2, {
      store: store({
        authority: authority({
          sourceObservedAt: '2026-09-20T17:59:00.000Z',
          verifiedAt: '2026-09-20T17:59:00.000Z',
        }), snapshot: snapshot(2), futureRefresh: futureRefresh(),
      }),
      now,
    });
    expect(scheduled).toMatchObject({
      kind: 'usable', context: { temporalState: 'future', refreshDue: false },
    });

    const changedSlate = await readStoredMatchups('league1', 2, {
      store: store({
        authority: authority({
          sourceObservedAt: '2026-09-20T17:59:00.000Z',
          verifiedAt: '2026-09-20T17:59:00.000Z',
        }),
        snapshot: snapshot(2),
        futureRefresh: futureRefresh({ currentProjectionSlateContentId: 'new-content' }),
      }),
      now,
    });
    expect(changedSlate).toMatchObject({
      kind: 'usable', context: { temporalState: 'future', refreshDue: true },
    });

    const refreshing = await readStoredMatchups('league1', 2, {
      store: store({
        authority: authority({
          sourceObservedAt: '2026-09-20T17:59:00.000Z',
          verifiedAt: '2026-09-20T17:59:00.000Z',
        }),
        snapshot: snapshot(2),
        futureRefresh: futureRefresh({
          nextRefreshAt: '2026-09-20T17:00:00.000Z',
          activeAttemptExpiresAt: '2026-09-20T18:01:00.000Z',
        }),
      }),
      now,
    });
    expect(refreshing).toMatchObject({
      kind: 'usable', context: { temporalState: 'future', refreshDue: false },
    });

    const refreshingChangedSlate = await readStoredMatchups('league1', 2, {
      store: store({
        authority: authority({
          sourceObservedAt: '2026-09-20T17:59:00.000Z',
          verifiedAt: '2026-09-20T17:59:00.000Z',
        }),
        snapshot: snapshot(2),
        futureRefresh: futureRefresh({
          currentProjectionSlateContentId: 'new-content',
          activeAttemptExpiresAt: '2026-09-20T18:01:00.000Z',
        }),
      }),
      now,
    });
    expect(refreshingChangedSlate).toMatchObject({
      kind: 'usable', context: { temporalState: 'future', refreshDue: false },
    });

    const implausibleSuccessTime = await readStoredMatchups('league1', 2, {
      store: store({
        authority: authority({
          sourceObservedAt: '2026-09-20T17:59:00.000Z',
          verifiedAt: '2026-09-20T17:59:00.000Z',
        }),
        snapshot: snapshot(2),
        futureRefresh: futureRefresh({
          lastSucceededAt: '2026-09-20T18:05:00.001Z',
        }),
      }),
      now,
    });
    expect(implausibleSuccessTime).toMatchObject({
      kind: 'usable', context: { temporalState: 'future', refreshDue: true },
    });
  });

  it('rejects expired or implausibly future period authority so pages can consult Sleeper', async () => {
    await expect(readStoredMatchups('league1', 2, {
      store: store({ authority: authority(), snapshot: snapshot(2), futureRefresh: futureRefresh() }),
      now: new Date('2026-09-13T18:10:00.000Z'),
    })).resolves.toMatchObject({ kind: 'usable' });
    await expect(readStoredMatchups('league1', 2, {
      store: store({ authority: authority(), snapshot: snapshot(2), futureRefresh: futureRefresh() }),
      now: new Date('2026-09-13T18:10:00.001Z'),
    })).resolves.toEqual({ kind: 'authority-stale' });
    await expect(readStoredMatchups('league1', 2, {
      store: store({
        authority: authority({
          sourceObservedAt: '2026-09-13T18:05:00.000Z',
          verifiedAt: '2026-09-13T18:05:00.000Z',
        }),
        snapshot: snapshot(2),
        futureRefresh: futureRefresh(),
      }),
      now: new Date('2026-09-13T18:00:00.000Z'),
    })).resolves.toMatchObject({ kind: 'usable' });
    await expect(readStoredMatchups('league1', 2, {
      store: store({
        authority: authority({
          sourceObservedAt: '2026-09-13T18:05:00.001Z',
          verifiedAt: '2026-09-13T18:05:00.001Z',
        }),
        snapshot: snapshot(2),
        futureRefresh: futureRefresh(),
      }),
      now: new Date('2026-09-13T18:00:00.000Z'),
    })).resolves.toEqual({ kind: 'authority-stale' });
  });

  it('distinguishes disabled, missing authority, missing exact week, and stale active data', async () => {
    await expect(readStoredMatchups('league1', 1, { store: store(null, false) }))
      .resolves.toEqual({ kind: 'disabled' });
    await expect(readStoredMatchups('league1', 1, { store: store(null) }))
      .resolves.toEqual({ kind: 'missing' });
    await expect(readStoredMatchups('league1', 2, {
      store: store({ authority: authority(), snapshot: null, futureRefresh: null }),
      now: new Date('2026-09-13T18:05:00.000Z'),
    })).resolves.toMatchObject({ kind: 'missing', context: { temporalState: 'future' } });
    await expect(readStoredMatchups('league1', 2, {
      store: store({ authority: authority(), snapshot: null, futureRefresh: null }),
      now: new Date('2026-09-13T18:10:00.001Z'),
    })).resolves.toEqual({ kind: 'missing' });
    await expect(readStoredMatchups('league1', 1, {
      store: store({
        authority: authority({
          defaultWeek: 1,
          sourceObservedAt: '2026-09-13T19:15:00.000Z',
          verifiedAt: '2026-09-13T19:15:00.000Z',
        }),
        snapshot: snapshot(1),
        futureRefresh: null,
      }),
      now: new Date('2026-09-13T19:16:00.000Z'),
    })).resolves.toMatchObject({ kind: 'stale', context: { refreshDue: true } });
  });

  it('rejects payloads that do not match the exact authority season and target week', async () => {
    const wrongWeek = { ...snapshot(1), payload: payload(2) };
    await expect(readStoredMatchups('league1', 1, {
      store: store({ authority: authority(), snapshot: wrongWeek, futureRefresh: null }),
      now: new Date('2026-09-13T18:05:00.000Z'),
    })).resolves.toMatchObject({ kind: 'malformed' });
    const wrongSeasonPayload = payload(1);
    wrongSeasonPayload.league.season = '2025';
    await expect(readStoredMatchups('league1', 1, {
      store: store({
        authority: authority(),
        snapshot: { ...snapshot(1), payload: wrongSeasonPayload },
        futureRefresh: null,
      }),
      now: new Date('2026-09-13T18:05:00.000Z'),
    })).resolves.toMatchObject({ kind: 'malformed' });
  });

  it('distinguishes database failures', async () => {
    const failed = {
      enabled: true,
      readMatchupSnapshotByLeagueKey: vi.fn(async () => { throw new Error('connection failed'); }),
    } as unknown as ProjectionStore;
    await expect(readStoredMatchups('league1', 1, { store: failed }))
      .resolves.toEqual({ kind: 'database-error' });
  });
});
