import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

import { externalLeagueRef } from '../../shared/provider-identity';
import { calculateLineupRevision } from '../../domain/lineup-revision';
import {
  assertProjectionMatchupReadiness,
  createRawSleeperMatchupLoader,
  sleeperMatchupShape,
} from './raw-matchups';
import { sleeperLineupObservationShape, translateSleeperLineupObservation } from './lineup-observation';

const league = externalLeagueRef('sleeper', 'raw-parity-test-league');
const period = { season: 2026, seasonType: 'regular' as const, week: 5 };
const rosters = [{ roster_id: 1 }, { roster_id: 2 }];
const positions = ['QB', 'RB', 'FLEX', 'DEF', 'BN', 'IR', 'TAXI'];
const shape = sleeperLineupObservationShape(league, sleeperMatchupShape(rosters, positions));
const rawRows = [
  { roster_id: 1, matchup_id: 7, starters: ['qb-a', 'rb-a', 'flex-a', 'NYJ'], points: 15.75 },
  { roster_id: 2, matchup_id: 7, starters: ['qb-b', 'rb-b', '0', 'BAL'], points: -1.25 },
];

describe('one raw lineup normalization for full and thin consumers', () => {
  it('retains authoritative roster membership instead of accepting only the same row count', () => {
    const foreignRows = rawRows.map((row) => ({ ...row, roster_id: row.roster_id + 10 }));
    expect(shape.expectedRosterRefs.map((reference) => String(reference.externalId))).toEqual(['1', '2']);
    expect(translateSleeperLineupObservation(league, period, shape, foreignRows))
      .toEqual({ status: 'invalid', reason: 'roster-population-incomplete' });
  });
  it('produces identical lineup-v1 revisions from the shared full and thin raw boundary', async () => {
    const readJson = vi.fn(async () => rawRows);
    const load = createRawSleeperMatchupLoader({ readJson, now: () => '2026-09-03T12:00:00.000Z' });
    const fullRaw = await load(String(league.externalId), period.week, 0);
    assertProjectionMatchupReadiness(fullRaw.rows, rosters, positions);
    const full = translateSleeperLineupObservation(league, period, shape, fullRaw.rows);
    const thinRaw = await load(String(league.externalId), period.week, 0);
    const thin = translateSleeperLineupObservation(league, period, shape, thinRaw.rows);
    expect(full.status).toBe('complete');
    expect(thin.status).toBe('complete');
    if (full.status !== 'complete' || thin.status !== 'complete') throw new Error('Fixture must be complete.');
    expect(await calculateLineupRevision(full.observation)).toEqual(await calculateLineupRevision(thin.observation));
    expect(full.observation.rows[1].starters[2]).toBeNull();
    expect(full.observation.rows[0].starters[3]?.resource).toBe('lineup-entry');
    expect(readJson).toHaveBeenCalledTimes(2);
    // Two independent fixture consumers, never two production requests for comparison.
    expect(readJson.mock.calls).toEqual([
      [`/league/${league.externalId}/matchups/5`, 0],
      [`/league/${league.externalId}/matchups/5`, 0],
    ]);
  });

  it('ignores score and observation changes but detects an altered starter in provider rows', async () => {
    const before = translateSleeperLineupObservation(league, period, shape, rawRows);
    const pointsOnly = translateSleeperLineupObservation(league, period, shape, rawRows.map((row) => ({ ...row, points: 999 })));
    const changed = translateSleeperLineupObservation(league, period, shape, rawRows.map((row, index) => index === 0 ? { ...row, starters: ['qb-a', 'rb-a', 'replacement', 'NYJ'] } : row));
    if (before.status !== 'complete' || pointsOnly.status !== 'complete' || changed.status !== 'complete') throw new Error('Fixture must be complete.');
    expect(await calculateLineupRevision(before.observation)).toEqual(await calculateLineupRevision(pointsOnly.observation));
    expect(await calculateLineupRevision(before.observation)).not.toEqual(await calculateLineupRevision(changed.observation));
  });

  it('does not convert blank or absent starter arrays into healthy empty lineups', () => {
    for (const starters of [undefined, ['qb-a', '', '0', 'NYJ']]) {
      expect(translateSleeperLineupObservation(league, period, shape, [{ ...rawRows[0], starters }, rawRows[1]]))
        .toEqual({ status: 'invalid', reason: 'starter-shape-invalid' });
    }
  });

  it('distinguishes not-yet-published pairings and empty rows from a partial response', () => {
    expect(translateSleeperLineupObservation(league, period, shape, []).status).toBe('not-ready');
    expect(translateSleeperLineupObservation(league, period, shape, rawRows.map((row) => ({ ...row, matchup_id: null })))).toEqual({ status: 'not-ready', reason: 'unpaired' });
    expect(translateSleeperLineupObservation(league, period, shape, rawRows.slice(0, 1))).toEqual({ status: 'invalid', reason: 'roster-population-incomplete' });
  });
});
