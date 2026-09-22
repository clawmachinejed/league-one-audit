import { describe, expect, it } from 'vitest';
import { snapshotFixture } from '../test-support/matchup-snapshot-fixtures';
import { matchupBoxScoreActivity } from './matchup-box-score-refresh';

describe('box-score game transition signal', () => {
  it('changes for accepted kickoff and final transitions, not the live clock, score, ordering or duplicate memberships', () => {
    const player = snapshotFixture().matchups[0].sides[0].starters[0];
    player.game = { kind: 'scheduled', opponent: 'TEN', location: 'away', date: '2026-09-13', kickoffAt: '2026-09-13T17:00:00Z' };
    const scheduled = matchupBoxScoreActivity([player]);
    expect(scheduled.live).toBe(false);
    player.game.liveScore = { teamScore: 0, opponentScore: 0, phase: 'q1', clockSeconds: 890 };
    const live = matchupBoxScoreActivity([player]);
    expect(live.live).toBe(true); expect(live.key).not.toBe(scheduled.key);
    player.game.liveScore = { teamScore: 7, opponentScore: 0, phase: 'q2', clockSeconds: 850 };
    expect(matchupBoxScoreActivity([player, player])).toEqual(live);
    player.game.finalScore = { teamScore: 7, opponentScore: 0 };
    const final = matchupBoxScoreActivity([player]);
    expect(final.live).toBe(false); expect(final.key).not.toBe(live.key);
    expect(final.finalKeys).toEqual([`player:${player.id}`]);
  });
});
