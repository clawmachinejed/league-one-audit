import { describe, expect, it } from 'vitest';
import { boxScoreSummary, boxScoreObservedLabel, boxScoreResponseMatchesScope, canExpandPlayerBoxScore, playerBoxScoreKey } from './matchup-box-scores';
import { snapshotFixture } from '../test-support/matchup-snapshot-fixtures';
import { nextBoxScoreRefreshAt } from '../components/use-matchup-box-scores';

describe('position-specific actual box scores', () => {
  it('shows observed zeroes and negative yardage without fabricating absent statistics', () => {
    expect(boxScoreSummary('QB', { pass_cmp: 0, pass_att: 0, rush_yd: -2, pass_td: 0, pts_ppr: 6 }).map(stat => stat.text))
      .toEqual(['0/0 CMP', '0 TD', '-2 YD']);
    expect(boxScoreSummary('QB', { pass_cmp: 17 }).map(stat => stat.text)).toEqual(['17 CMP']);
    expect(boxScoreSummary('QB', { pass_att: 27 }).map(stat => stat.text)).toEqual(['27 ATT']);
    expect(boxScoreSummary('WR', {})).toEqual([]);
    expect(boxScoreSummary('WR', { pos_rank_ppr: 1, pts_ppr: 14, rec_yd: NaN })).toEqual([]);
  });

  it.each(['RB', 'FB', 'WR', 'TE'])('%s shows receiving and relevant unusual offensive statistics', position => {
    const summary = boxScoreSummary(position, { rec: 3, rec_tgt: 5, rec_yd: 41, rec_td: 0, pass_td: 1, rush_yd: 8, fum_lost: 1 });
    expect(summary.map(stat => stat.text).join(', ')).toBe('1 TD, 8 YD, 3 REC, 5 TGT, 41 YD, 0 TD, 1 LOST');
    expect(summary).toContainEqual({ text: '0 TD', description: 'Receiving: 0 TD' });
  });

  it('keeps kicking, defensive, and special teams statistics distinct', () => {
    expect(boxScoreSummary('K', { fgm: 2, fga: 3, xpm: 0, xpa: 0, fgm_lng: 53, rec_yd: 0 }).map(stat => stat.text))
      .toEqual(['2/3 FG', '0/0 XP', '53 LNG']);
    const stats = boxScoreSummary('DEF', { sack: 2, int: 1, fum_rec: 0, def_td: 1, def_st_td: 1, pts_allow: 0, pts_ppr: 14 });
    expect(stats).toContainEqual({ text: '0 PA', description: 'Defense / special teams: 0 Points allowed' });
    expect(stats.filter(stat => stat.text.includes('TD')).map(stat => stat.text)).toEqual(['1 TD', '1 ST TD']);
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

  it('checks live stored statistics every minute, including midnight and DST', () => {
    expect(new Date(nextBoxScoreRefreshAt(Date.parse('2026-09-13T16:02:00Z'))).toISOString()).toBe('2026-09-13T16:03:00.000Z');
    expect(new Date(nextBoxScoreRefreshAt(Date.parse('2026-09-13T16:04:00Z'))).toISOString()).toBe('2026-09-13T16:05:00.000Z');
    expect(new Date(nextBoxScoreRefreshAt(Date.parse('2026-09-14T04:04:00Z'))).toISOString()).toBe('2026-09-14T04:05:00.000Z');
    expect(new Date(nextBoxScoreRefreshAt(Date.parse('2026-11-01T05:04:00Z'))).toISOString()).toBe('2026-11-01T05:05:00.000Z');
  });
});
