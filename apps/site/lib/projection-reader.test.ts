import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { readStoredMatchups } from './projection-reader';
import type {
  ProjectionStore,
  StoredProjectionSnapshot,
  StoredProjectionSnapshotSelection,
} from './projection-store';
import type { MatchupsData } from './types';

function payload(week = 1): MatchupsData {
  return {
    league: { season: '2026', rosterPositions: ['QB'], week, maxWeek: 18 },
    teams: [],
    updatedAt: '2026-09-13T18:00:00.000Z',
    week,
    matchups: [],
  };
}

function snapshot(data = payload()): StoredProjectionSnapshot {
  return {
    snapshotId: `snapshot-${data.week}`,
    leagueSeasonId: 'season-1',
    week: data.week,
    modelVersion: 'clock-v1',
    revisionKey: `revision-${data.week}`,
    calculatedAt: data.updatedAt,
    publishedAt: data.updatedAt,
    verifiedAt: data.updatedAt,
    activityWindows: [],
    isCurrent: true,
    payload: data,
  };
}

function store(
  selection: StoredProjectionSnapshotSelection,
  enabled = true,
): ProjectionStore {
  return {
    enabled,
    readSnapshotSelectionBySleeperLeagueId: vi.fn(async () => selection),
  } as unknown as ProjectionStore;
}

describe('stored matchup reader', () => {
  it('returns one freshness-checked payload from the combined store read', async () => {
    const current = snapshot();
    const database = store({ selected: current, latest: current });

    await expect(readStoredMatchups('league-id', 1, {
      store: database,
      now: new Date('2026-09-13T18:02:00.000Z'),
    })).resolves.toEqual({
      kind: 'usable',
      historical: false,
      payload: current.payload,
    });
    expect(database.readSnapshotSelectionBySleeperLeagueId).toHaveBeenCalledOnce();
    expect(database.readSnapshotSelectionBySleeperLeagueId).toHaveBeenCalledWith('league-id', 1);
  });

  it('distinguishes disabled, missing, and stale storage outcomes', async () => {
    const current = snapshot();
    await expect(readStoredMatchups('league-id', 1, {
      store: store({ selected: null, latest: null }, false),
    })).resolves.toEqual({ kind: 'disabled' });
    await expect(readStoredMatchups('league-id', 1, {
      store: store({ selected: null, latest: current }),
    })).resolves.toEqual({ kind: 'missing' });
    await expect(readStoredMatchups('league-id', 1, {
      store: store({ selected: current, latest: current }),
      now: new Date('2026-09-13T19:30:00.000Z'),
    })).resolves.toEqual({ kind: 'stale' });
  });

  it('distinguishes malformed snapshots from database failures', async () => {
    const mismatched = { ...snapshot(), week: 2 };
    await expect(readStoredMatchups('league-id', 1, {
      store: store({ selected: mismatched, latest: mismatched }),
    })).resolves.toEqual({ kind: 'malformed' });
    await expect(readStoredMatchups('league-id', 1, {
      store: store({ selected: snapshot(), latest: null }),
    })).resolves.toEqual({ kind: 'malformed' });

    const failed = {
      enabled: true,
      readSnapshotSelectionBySleeperLeagueId: vi.fn(async () => {
        throw new Error('connection failed');
      }),
    } as unknown as ProjectionStore;
    await expect(readStoredMatchups('league-id', 1, { store: failed }))
      .resolves.toEqual({ kind: 'database-error' });
  });
});
