import { describe, expect, it } from 'vitest';
import { boxScoreGroups, boxScoreObservedLabel, boxScoreResponseMatchesScope, canExpandPlayerBoxScore, playerBoxScoreKey } from './matchup-box-scores';
import { snapshotFixture } from '../test-support/matchup-snapshot-fixtures';
import { nextBoxScoreRefreshAt } from '../components/use-matchup-box-scores';

describe('position-specific actual box scores', () => {
  it('shows observed zeroes and negative yardage without fabricating absent statistics', () => {
    expect(boxScoreGroups('QB', { pass_cmp: 0, pass_att: 0, rush_yd: -2, pass_td: 0, pts_ppr: 6 }))
      .toEqual([
        { label: 'Passing', stats: [{ label: 'Completions', value: '0' }, { label: 'Attempts', value: '0' }, { label: 'TD', value: '0' }] },
        { label: 'Rushing', stats: [{ label: 'Yards', value: '-2' }] },
      ]);
    expect(boxScoreGroups('WR', {})).toEqual([]);
    expect(boxScoreGroups('WR', { pos_rank_ppr: 1, pts_ppr: 14, rec_yd: NaN })).toEqual([]);
  });

  it.each(['RB', 'FB', 'WR', 'TE'])('%s shows receiving and relevant unusual offensive statistics', position => {
    const groups = boxScoreGroups(position, { rec: 3, rec_tgt: 5, rec_yd: 41, rec_td: 0, pass_td: 1, rush_yd: 8, fum_lost: 1 });
    expect(groups.map(group => group.label)).toEqual(['Passing', 'Rushing', 'Receiving', 'Fumbles']);
    expect(groups.find(group => group.label === 'Receiving')?.stats).toContainEqual({ label: 'TD', value: '0' });
  });

  it('keeps kicking, defensive, and special teams statistics distinct', () => {
    expect(boxScoreGroups('K', { fgm: 2, fga: 3, xpm: 0, xpa: 0, fgm_lng: 53, rec_yd: 0 })[0].stats)
      .toContainEqual({ label: 'Longest FG', value: '53' });
    const stats = boxScoreGroups('DEF', { sack: 2, int: 1, fum_rec: 0, def_td: 1, def_st_td: 1, pts_allow: 0, pts_ppr: 14 })[0].stats;
    expect(stats).toContainEqual({ label: 'Points allowed', value: '0' });
    expect(stats.filter(stat => stat.label.includes('TD'))).toEqual([{ label: 'Defense TD', value: '1' }, { label: 'Special teams TD', value: '1' }]);
  });

  it('requires accepted live/final NFL state and keeps player and defense identities separate', () => {
    const player = snapshotFixture().matchups[0].sides[0].starters[0];
    expect(canExpandPlayerBoxScore(player)).toBe(false);
    player.game = { kind: 'scheduled', opponent: 'TEN', location: 'away', date: '2001-01-01', kickoffAt: '2001-01-01T00:00:00Z' };
    expect(canExpandPlayerBoxScore(player)).toBe(false);
    player.game.liveScore = { teamScore: 0, opponentScore: 0, phase: 'q1', clockSeconds: 890 };
    player.injuryStatus = 'Inactive';
    expect(canExpandPlayerBoxScore(player)).toBe(true);
    delete player.game.liveScore;
    player.game.finalScore = { teamScore: 0, opponentScore: 10 };
    expect(canExpandPlayerBoxScore(player)).toBe(true);
    player.game = { kind: 'bye' };
    expect(canExpandPlayerBoxScore(player)).toBe(false);
    expect(canExpandPlayerBoxScore(undefined)).toBe(false);
    expect(playerBoxScoreKey({ id: 'BAL', position: 'DEF' })).toBe('defense:BAL');
    expect(playerBoxScoreKey({ id: 'BAL', position: 'WR' })).toBe('player:BAL');
  });

  it('uses the actual observation timestamp in Eastern time', () => {
    expect(boxScoreObservedLabel('2026-09-13T17:00:00Z')).toBe('Stats as of Sep 13, 1:00 PM ET');
    expect(boxScoreObservedLabel(null)).toBeNull();
  });

  it('rejects a response for a different league, season or week and malformed values', () => {
    const response = { leagueKey: 'league1', season: '2026', week: 1, status: 'available',
      revision: 'test-observation', observedAt: '2026-09-13T17:00:00Z', players: { 'player:5859': { stats: { rec: 0 }, gamePhase: 'final' } } };
    expect(boxScoreResponseMatchesScope(response, 'league1', '2026', 1)).toBe(true);
    expect(boxScoreResponseMatchesScope(response, 'league2', '2026', 1)).toBe(false);
    expect(boxScoreResponseMatchesScope(response, 'league1', '2025', 1)).toBe(false);
    expect(boxScoreResponseMatchesScope(response, 'league1', '2026', 2)).toBe(false);
    expect(boxScoreResponseMatchesScope({ ...response, players: { 'player:5859': { stats: { rec: null } } } }, 'league1', '2026', 1)).toBe(false);
    expect(boxScoreResponseMatchesScope({ ...response, status: 'unavailable' }, 'league1', '2026', 1)).toBe(false);
  });

  it('checks after the existing hourly capture window, including midnight and DST', () => {
    expect(new Date(nextBoxScoreRefreshAt(Date.parse('2026-09-13T16:02:00Z'))).toISOString()).toBe('2026-09-13T16:03:00.000Z');
    expect(new Date(nextBoxScoreRefreshAt(Date.parse('2026-09-13T16:04:00Z'))).toISOString()).toBe('2026-09-13T17:03:00.000Z');
    expect(new Date(nextBoxScoreRefreshAt(Date.parse('2026-09-14T04:04:00Z'))).toISOString()).toBe('2026-09-14T16:03:00.000Z');
    expect(new Date(nextBoxScoreRefreshAt(Date.parse('2026-11-01T05:04:00Z'))).toISOString()).toBe('2026-11-01T17:03:00.000Z');
  });
});
