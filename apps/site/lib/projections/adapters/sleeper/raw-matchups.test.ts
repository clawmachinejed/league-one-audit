import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { sleeperLineupEntryId, startingSlots } from '../../../sleeper-lineup';
import type { SleeperMatchup } from '../../../transform';
import {
  assertMatchupCompleteness,
  assertProjectionMatchupReadiness,
  createRawSleeperMatchupLoader,
  parseRawSleeperMatchups,
  sleeperMatchupShape,
} from './raw-matchups';

const path = '/league/raw-test-league/matchups/5';
const rosterIdentities = [{ roster_id: 1 }, { roster_id: 2 }];
const positions = ['QB', 'RB', 'FLEX', 'DEF', 'BN', 'IR', 'TAXI'];

function rows(): SleeperMatchup[] {
  return [
    {
      roster_id: 2,
      matchup_id: 7,
      starters: ['qb-b', 'rb-b', '0', 'BAL'],
      starters_points: [3.25, null, 0, -1.5],
      players_points: { 'qb-b': 3.25, 'rb-b': null, BAL: -1.5 },
      points: 1.75,
      custom_points: null,
    },
    {
      roster_id: 1,
      matchup_id: 7,
      starters: ['qb-a', 'rb-a', 'flex-a', 'NYJ'],
      starters_points: null,
      players_points: null,
      points: null,
    },
  ];
}

describe('shared raw Sleeper matchup boundary', () => {
  it.each([0, 60])('forwards cache lifetime %i and observes exactly one request', async (revalidate) => {
    const events: string[] = [];
    const source = rows();
    const timestamps = ['2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.500Z'];
    const readJson = vi.fn(async () => {
      events.push('request');
      return source;
    });
    const now = vi.fn(() => {
      events.push('clock');
      return timestamps[now.mock.calls.length - 1];
    });
    const load = createRawSleeperMatchupLoader({ readJson, now });

    const result = await load('raw-test-league', 5, revalidate);

    expect(readJson).toHaveBeenCalledExactlyOnceWith(path, revalidate);
    expect(events).toEqual(['clock', 'request', 'clock']);
    expect(result).toEqual({
      rows: source,
      requestStartedAt: timestamps[0],
      requestCompletedAt: timestamps[1],
    });
    expect(result.rows).toBe(source);
  });

  it('preserves raw starter order, opaque IDs, optional scores, and response order', () => {
    const source = rows();
    const before = structuredClone(source);
    expect(parseRawSleeperMatchups(source, path)).toBe(source);
    expect(source).toEqual(before);
    expect(source[0].starters).toEqual(['qb-b', 'rb-b', '0', 'BAL']);
  });

  it.each([
    null,
    { roster_id: 1, matchup_id: 1 },
    [{ roster_id: 1 }],
    [{ roster_id: 0, matchup_id: 1 }],
    [{ roster_id: 1.5, matchup_id: 1 }],
    [{ roster_id: 1, matchup_id: 0 }],
    [{ roster_id: 1, matchup_id: 1, starters: [9] }],
    [{ roster_id: 1, matchup_id: 1, starters_points: [Infinity] }],
    [{ roster_id: 1, matchup_id: 1, players_points: { a: '3' } }],
    [{ roster_id: 1, matchup_id: 1, custom_points: NaN }],
  ])('rejects malformed raw data without discarding invalid rows: %j', (source) => {
    expect(() => parseRawSleeperMatchups(source, path))
      .toThrow(`Sleeper returned an invalid response for ${path}.`);
  });

  it('rejects duplicate roster rows rather than deduplicating a partial response', () => {
    const row = rows()[0];
    expect(() => parseRawSleeperMatchups([row, row], path))
      .toThrow(`Sleeper returned duplicate entries for ${path}.`);
  });

  it('does not report a completed observation when the provider fails', async () => {
    const error = new Error('provider unavailable');
    const readJson = vi.fn().mockRejectedValue(error);
    const now = vi.fn(() => '2026-09-03T12:00:00.000Z');
    const load = createRawSleeperMatchupLoader({ readJson, now });

    await expect(load('raw-test-league', 5, 0)).rejects.toBe(error);
    expect(readJson).toHaveBeenCalledOnce();
    expect(now).toHaveBeenCalledOnce();
  });

  it('retains the website empty-slate and unresolved-pairing behavior', () => {
    expect(() => assertMatchupCompleteness([], rosterIdentities, false)).not.toThrow();
    expect(() => assertMatchupCompleteness([], rosterIdentities, true)).toThrow('incomplete matchup slate');
    const unpaired = rows().map((row) => ({ ...row, matchup_id: null }));
    expect(() => assertMatchupCompleteness(unpaired, rosterIdentities, false)).not.toThrow();
    expect(() => assertProjectionMatchupReadiness(unpaired, rosterIdentities, positions))
      .toThrow('has not resolved every matchup pairing');
  });

  it('rejects missing rosters, foreign rosters, and incomplete matchup groups', () => {
    expect(() => assertMatchupCompleteness(rows().slice(0, 1), rosterIdentities, true))
      .toThrow('incomplete matchup slate');
    const foreign = rows().map((row, index) => ({ ...row, roster_id: index + 10 }));
    expect(() => assertMatchupCompleteness(foreign, rosterIdentities, true))
      .toThrow('incomplete matchup slate');
    const mismatched = rows().map((row, index) => ({ ...row, matchup_id: index + 1 }));
    expect(() => assertMatchupCompleteness(mismatched, rosterIdentities, true))
      .toThrow('invalid matchup grouping');
  });

  it('retains projection readiness rules and accepts explicit empty starter slots', () => {
    expect(() => assertProjectionMatchupReadiness(rows(), rosterIdentities, positions)).not.toThrow();
    for (const starters of [null, [], ['qb-b'], ['qb-b', 'rb-b', ' ', 'BAL']]) {
      const incomplete = rows();
      incomplete[0] = { ...incomplete[0], starters };
      expect(() => assertProjectionMatchupReadiness(incomplete, rosterIdentities, positions))
        .toThrow('has not published complete lineups');
    }
  });

  it('derives expected raw shape from authoritative rosters and configured positions', () => {
    expect(sleeperMatchupShape(rosterIdentities, positions)).toEqual({
      rosterIds: [1, 2],
      starterSlots: ['QB', 'RB', 'FLEX', 'DEF'],
      expectedRosterCount: 2,
      expectedStarterSlotCount: 4,
    });
  });
});

describe('shared Sleeper slot normalization', () => {
  it('preserves duplicate starting slots and excludes only the existing roster-only slots', () => {
    expect(startingSlots(['RB', 'RB', 'BN', 'FLEX', 'IR', 'TAXI', 'UTIL']))
      .toEqual(['RB', 'RB', 'FLEX', 'UTIL']);
  });

  it('normalizes only the existing empty markers without inferring entity type or trimming IDs', () => {
    expect([null, undefined, '', '0'].map(sleeperLineupEntryId)).toEqual([null, null, null, null]);
    expect(['BAL', 'qb-a', ' 9 ', '00'].map(sleeperLineupEntryId))
      .toEqual(['BAL', 'qb-a', ' 9 ', '00']);
  });
});
