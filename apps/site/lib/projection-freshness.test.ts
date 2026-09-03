import { describe, expect, it } from 'vitest';
import type { MatchupPeriodContext } from './matchup-period';
import type { StoredProjectionSnapshot } from './projection-store';
import { selectSnapshotMetadata, snapshotFreshnessMetadata, snapshotPayloadAtVerification } from './projection-freshness';
import type { Matchup, MatchupsData, NflGame } from './types';

function selectSnapshot(stored: StoredProjectionSnapshot | null, period: MatchupPeriodContext, now = new Date()) {
  return selectSnapshotMetadata(stored ? snapshotFreshnessMetadata(stored) : null, period, now);
}

function payload(week = 1): MatchupsData {
  return {
    league: { season: '2026', rosterPositions: ['QB'], week, maxWeek: 18 },
    teams: [], updatedAt: '2026-09-13T18:00:00.000Z', week,
    matchups: [],
  };
}

function snapshot(week = 1, verifiedAt = '2026-09-13T18:00:00.000Z'): StoredProjectionSnapshot {
  return {
    snapshotId: `snapshot-${week}`, leagueSeasonId: 'season-1', week,
    modelVersion: 'clock-v1', revisionKey: `revision-${week}`,
    calculatedAt: verifiedAt, publishedAt: verifiedAt, verifiedAt,
    activityWindows: [{
      startsAt: '2026-09-13T15:00:00.000Z',
      endsAt: '2026-09-14T00:00:00.000Z',
    }],
    isCurrent: true, payload: payload(week),
  };
}

function context(
  temporalState: MatchupPeriodContext['temporalState'],
  defaultWeek = 1,
): MatchupPeriodContext {
  return {
    defaultSeason: 2026, defaultWeek, activeSeason: 2026, activeWeek: 1,
    lifecycle: 'active', nflPhase: 'regular', temporalState, refreshDue: false,
  };
}

function withStarterGame(
  game: NflGame | null,
  status: Matchup['status'] = 'upcoming',
): StoredProjectionSnapshot {
  const stored = snapshot();
  const team = {
    id: 1, managerName: 'Manager', name: 'Team', avatar: null,
    wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: null,
  };
  return {
    ...stored,
    activityWindows: [],
    payload: {
      ...stored.payload,
      teams: [team],
      matchups: [{
        id: '1', status,
        sides: [{
          team, points: 0, projectedPoints: 10,
          starters: [{
            id: 'player-1', name: 'Player One', position: 'QB', nflTeam: 'LAC',
            injuryStatus: null, game, slot: 'QB', points: 0, projectedPoints: 10,
          }],
        }],
      }],
    },
  };
}

describe('period-aware projection freshness', () => {
  it.each([
    { elapsedMs: 180_000, expected: 'usable' },
    { elapsedMs: 180_001, expected: 'stale' },
  ])('keeps the exact three-minute active boundary at $elapsedMs ms', ({ elapsedMs, expected }) => {
    const stored = snapshot();
    const now = new Date(Date.parse(stored.verifiedAt) + elapsedMs);
    expect(selectSnapshot(stored, context('active'), now).kind).toBe(expected);
  });

  it.each([
    { elapsedMs: 4_500_000, expected: 'usable' },
    { elapsedMs: 4_500_001, expected: 'stale' },
  ])('keeps the exact 75-minute idle boundary at $elapsedMs ms', ({ elapsedMs, expected }) => {
    const stored = { ...snapshot(), activityWindows: [] };
    const now = new Date(Date.parse(stored.verifiedAt) + elapsedMs);
    expect(selectSnapshot(stored, context('active'), now).kind).toBe(expected);
  });

  it.each([
    { aheadMs: 300_000, expected: 'usable' },
    { aheadMs: 300_001, expected: 'stale' },
  ])('keeps the exact future verification tolerance at $aheadMs ms', ({ aheadMs, expected }) => {
    const now = new Date('2026-09-13T18:00:00.000Z');
    const stored = snapshot(1, new Date(now.getTime() + aheadMs).toISOString());
    expect(selectSnapshot(stored, context('active'), now).kind).toBe(expected);
  });

  it('applies live freshness from the payload even when no stored activity window is active', () => {
    const stored = withStarterGame(null, 'live');
    expect(selectSnapshot(
      stored, context('active'), new Date('2026-09-13T18:03:00.001Z'),
    ).kind).toBe('stale');
    expect(selectSnapshot(
      withStarterGame(null, 'upcoming'), context('active'), new Date('2026-09-13T18:03:00.001Z'),
    ).kind).toBe('usable');
  });

  it.each([
    { kickoffAt: '2026-09-13T20:00:00.000Z', expected: 'stale' },
    { kickoffAt: '2026-09-13T20:00:00.001Z', expected: 'usable' },
    { kickoffAt: '2026-09-13T11:00:00.000Z', expected: 'stale' },
    { kickoffAt: '2026-09-13T10:59:59.999Z', expected: 'usable' },
  ])('uses the starter kickoff fallback at $kickoffAt without activity windows', ({ kickoffAt, expected }) => {
    const stored = {
      ...withStarterGame({
        kind: 'scheduled', opponent: 'KC', location: 'home',
        date: '2026-09-13', kickoffAt,
      }),
      verifiedAt: '2026-09-13T17:56:00.000Z',
    };
    expect(selectSnapshot(
      stored, context('active'), new Date('2026-09-13T18:00:00.000Z'),
    ).kind).toBe(expected);
  });

  it.each([
    { gameDate: '2026-09-13', expected: 'stale' },
    { gameDate: '2026-09-14', expected: 'usable' },
  ])('uses Eastern calendar date $gameDate for a starter without kickoff time', ({ gameDate, expected }) => {
    const stored = {
      ...withStarterGame({
        kind: 'scheduled', opponent: 'KC', location: 'away', date: gameDate, kickoffAt: null,
      }),
      verifiedAt: '2026-09-14T00:56:00.000Z',
    };
    // The UTC date is September 14, but it is still September 13 in New York.
    expect(selectSnapshot(
      stored, context('active'), new Date('2026-09-14T01:00:00.000Z'),
    ).kind).toBe(expected);
  });

  it('strictly rejects an active game-window snapshot after three minutes', () => {
    expect(selectSnapshot(
      snapshot(), context('active'), new Date('2026-09-13T18:03:01.000Z'),
    )).toEqual({ kind: 'stale', context: { ...context('active'), refreshDue: true } });
  });

  it('accepts and advances the visible verification time for a fresh active snapshot', () => {
    const stored = snapshot(1, '2026-09-13T18:01:00.000Z');
    const result = selectSnapshot(stored, context('active'), new Date('2026-09-13T18:03:30.000Z'));
    expect(result).toEqual({
      kind: 'usable',
      context: context('active'),
    });
    expect(snapshotPayloadAtVerification(stored, context('active')))
      .toEqual({ ...stored.payload, updatedAt: stored.verifiedAt });
  });

  it('advances verification time without changing revision or mutating the stored payload', () => {
    const initial = snapshot();
    const verified = { ...initial, verifiedAt: '2026-09-13T18:02:00.000Z' };
    const now = new Date('2026-09-13T18:02:30.000Z');
    const before = selectSnapshot(initial, context('active'), now);
    const after = selectSnapshot(verified, context('active'), now);
    expect(before.kind).toBe('usable');
    expect(after.kind).toBe('usable');
    if (before.kind !== 'usable' || after.kind !== 'usable') return;
    expect(verified.revisionKey).toBe(initial.revisionKey);
    expect(snapshotPayloadAtVerification(verified, context('active'))).toEqual({
      ...snapshotPayloadAtVerification(initial, context('active')), updatedAt: verified.verifiedAt,
    });
    expect(initial.payload.updatedAt).toBe('2026-09-13T18:00:00.000Z');
    expect(verified.payload).toBe(initial.payload);
  });

  it('does not move visible payload time backward when verification time is older', () => {
    const stored = snapshot(1, '2026-09-13T17:59:00.000Z');
    const result = selectSnapshot(stored, context('active'), new Date('2026-09-13T18:00:00.000Z'));
    expect(result.kind).toBe('usable');
    expect(snapshotPayloadAtVerification(stored, context('active'))).toBe(stored.payload);
  });

  it('keeps a stale future snapshot as last-known-good and marks refresh due', () => {
    const stored = snapshot(2, '2026-09-01T00:00:00.000Z');
    const result = selectSnapshot(
      stored, context('future', 2), new Date('2026-09-13T18:00:00.000Z'),
    );
    expect(result).toEqual({
      kind: 'usable',
      context: { ...context('future', 2), refreshDue: true },
    });
    expect(snapshotPayloadAtVerification(stored, context('future', 2))).toBe(stored.payload);
  });

  it('keeps past snapshots indefinitely without rewriting their target week', () => {
    const stored = snapshot(1, '2026-09-01T00:00:00.000Z');
    const result = selectSnapshot(
      stored, context('past', 2), new Date('2027-01-01T00:00:00.000Z'),
    );
    expect(result).toEqual({
      kind: 'usable', context: context('past', 2),
    });
    expect(snapshotPayloadAtVerification(stored, context('past', 2)).league.week).toBe(1);
  });

  it('preserves the historical display timestamp even when verification is much newer', () => {
    const stored = snapshot(1, '2027-01-01T00:00:00.000Z');
    const result = selectSnapshot(stored, context('past', 2), new Date('2027-01-02T00:00:00.000Z'));
    expect(result.kind).toBe('usable');
    if (result.kind !== 'usable') return;
    expect(snapshotPayloadAtVerification(stored, context('past', 2))).toBe(stored.payload);
    expect(snapshotPayloadAtVerification(stored, context('past', 2)).updatedAt).toBe('2026-09-13T18:00:00.000Z');
    expect(result.context.refreshDue).toBe(false);
  });

  it('rejects missing or period-mismatched payloads', () => {
    expect(selectSnapshot(null, context('active'))).toEqual({ kind: 'missing' });
    const stored = snapshot();
    expect(selectSnapshot(
      { ...stored, payload: payload(2) }, context('active'),
    )).toEqual({ kind: 'missing' });
  });
});
