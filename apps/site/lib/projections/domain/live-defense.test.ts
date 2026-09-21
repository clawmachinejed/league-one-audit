import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  normalizeSleeperScoringProfile,
  SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
} from '../adapters/sleeper/scoring-profile';
import type { DefenseProjectionStats } from './contracts';
import {
  calculateLiveDefenseProjection,
  type LiveDefenseProjectionEvidence,
} from './live-defense';
import { scoreProjection } from './scoring';
import { providerKey } from '../shared/provider-identity';

const bucketKeys = {
  pointsAllowedZero: 'pts_allow_0',
  pointsAllowedOneToSix: 'pts_allow_1_6',
  pointsAllowedSevenToThirteen: 'pts_allow_7_13',
  pointsAllowedFourteenToTwenty: 'pts_allow_14_20',
  pointsAllowedTwentyOneToTwentySeven: 'pts_allow_21_27',
  pointsAllowedTwentyEightToThirtyFour: 'pts_allow_28_34',
  pointsAllowedThirtyFivePlus: 'pts_allow_35p',
} as const;
const rules = {
  sack: 1, int: 2, def_st_fum_rec: 2, fum_rec: 2, def_td: 6,
  def_st_td: 6, safe: 2, blk_kick: 2, def_3_and_out: 0.5, def_4_and_stop: 1,
  pass_td_40p: 1, rush_td_40p: 1, rec_td_40p: 1,
  pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1,
  pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4,
};
const projection: DefenseProjectionStats = {
  kind: 'defense', sacks: 2, interceptions: 1, fumbleRecoveries: 1,
  defensiveTouchdowns: 0.2, specialTeamsTouchdowns: 0.1, safeties: 0.1,
  blockedKicks: 0.1, pointsAllowed: 20,
};

function profile(rawRules: Readonly<Record<string, number>> = rules) {
  const normalized = normalizeSleeperScoringProfile({ provider: providerKey('sleeper'), rawRules });
  if (normalized.status !== 'available') throw new Error('Invalid test profile');
  return normalized.profile;
}

function evidence(overrides: Partial<LiveDefenseProjectionEvidence> = {}): LiveDefenseProjectionEvidence {
  return {
    projection,
    profile: profile(),
    stats: { pts_allow: 0, pts_allow_0: 1, sack: 1, def_3_and_out: 2, def_4_and_stop: 1 },
    supportedActualRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
    pointsAllowedStatKey: 'pts_allow',
    pointsAllowedBuckets: bucketKeys,
    ...overrides,
  };
}

function calculate(overrides: Partial<Parameters<typeof calculateLiveDefenseProjection>[0]> = {}) {
  return calculateLiveDefenseProjection({
    evidence: evidence(), baselinePoints: 9.2, officialPoints: 13, remainingFraction: 0.5,
    ...overrides,
  });
}

function projected(result: ReturnType<typeof calculateLiveDefenseProjection>) {
  expect(result.status).toBe('available');
  if (result.status !== 'available') throw new Error(result.reason);
  return result.projectedPoints;
}

describe('live defense components', () => {
  it('replaces provisional points allowed once and retains earned stop bonuses', () => {
    // Actual 13 = 10 shutout + 1 sack + 1 three-and-out points + 1 fourth-down stop.
    // 20 * half remaining = 10 expected final PA => 4-point bracket.
    expect(projected(calculate())).toBeCloseTo(13 - 10 + 4.1 + 4, 12);
  });

  it('does not add a second shutout bonus at the start of a game', () => {
    expect(projected(calculate({
      evidence: evidence({ stats: { pts_allow: 0, pts_allow_0: 1 } }),
      officialPoints: 10, remainingFraction: 1,
    }))).toBeCloseTo(9.2, 12);
  });

  it('accepts an omitted zero allowance only when the observed exclusive shutout bracket proves zero', () => {
    const { pts_allow, ...sparseZero } = evidence().stats!;
    expect(pts_allow).toBe(0);
    expect(calculate({ evidence: evidence({ stats: sparseZero }) })).toEqual(calculate());
    expect(calculate({ evidence: evidence({ stats: { ...sparseZero, pts_allow_21_27: 1 } }) }))
      .toEqual({ status: 'unavailable', reason: 'invalid-points-allowed' });
  });

  it('credits all earned sacks, turnovers, touchdowns and bonuses without projecting extra bonuses', () => {
    const stats = { pts_allow: 14, pts_allow_14_20: 1, sack: 3, int: 1, def_td: 1, def_3_and_out: 2, def_4_and_stop: 1 };
    expect(projected(calculate({ evidence: evidence({ stats }), officialPoints: 14, remainingFraction: 0.25 })))
      .toBeCloseTo(16.05, 12);
    // Doubling actual bonus weights changes the earned total, not the projected remainder.
    const higherBonus = profile({ ...rules, def_3_and_out: 1, def_4_and_stop: 2 });
    expect(projected(calculate({ evidence: evidence({ stats, profile: higherBonus }), officialPoints: 16, remainingFraction: 0.25 })))
      .toBeCloseTo(18.05, 12);
  });

  it('allows negative defensive projections and converges at a zero remaining fraction', () => {
    const loss = evidence({ stats: { pts_allow: 35, pts_allow_35p: 1 } });
    expect(projected(calculate({ evidence: loss, officialPoints: -4, remainingFraction: 0.25 })))
      .toBeCloseTo(-1.95, 12);
    expect(projected(calculate({ remainingFraction: 0 }))).toBe(13);
  });

  it.each([
    [0, 'pts_allow_0', 10], [1, 'pts_allow_1_6', 7], [6, 'pts_allow_1_6', 7],
    [7, 'pts_allow_7_13', 4], [13, 'pts_allow_7_13', 4], [14, 'pts_allow_14_20', 1],
    [20, 'pts_allow_14_20', 1], [21, 'pts_allow_21_27', 0], [27, 'pts_allow_21_27', 0],
    [28, 'pts_allow_28_34', -1], [34, 'pts_allow_28_34', -1], [35, 'pts_allow_35p', -4],
  ])('uses the existing scorer at the %i points-allowed boundary', (pointsAllowed, key, officialPoints) => {
    expect(projected(calculate({
      evidence: evidence({ stats: { pts_allow: pointsAllowed, [key]: 1 } }),
      officialPoints: officialPoints as number, remainingFraction: 0,
    }))).toBe(officialPoints);
  });

  it('uses each league profile and preserves its frozen baseline rather than replacing it with a fresh projection', () => {
    const higherScoring = profile({ ...rules, sack: 2, pts_allow_0: 15, pts_allow_7_13: 6 });
    expect(projected(calculate({ evidence: evidence({ profile: higherScoring }), baselinePoints: 11.2, officialPoints: 19 })))
      .toBeCloseTo(19 - 15 + 5.1 + 6, 12);
    expect(calculate({ evidence: evidence({ projection: { ...projection, sacks: 4 } }) }))
      .toMatchObject({ status: 'unavailable', reason: 'baseline-score-mismatch' });
  });

  it('uses the ordinary formula when the profile has no points-allowed scoring', () => {
    const additiveOnly = profile({ sack: 1, def_3_and_out: 0.5 });
    const noPointsAllowed = evidence({ profile: additiveOnly, projection: { kind: 'defense', sacks: 2 }, stats: null });
    expect(projected(calculate({ evidence: noPointsAllowed, baselinePoints: 2, officialPoints: 3, remainingFraction: 0.25 }))).toBe(3.5);
  });

  it.each([
    [null, 'missing-actual-statistics'],
    [{ pts_allow_7_13: 1, sack: 7, def_3_and_out: 2, def_4_and_stop: 1 }, 'invalid-points-allowed'],
    [{ pts_allow: '0', pts_allow_0: 1 }, 'invalid-actual-statistics'],
    [{ pts_allow: Number.NaN, pts_allow_0: 1 }, 'invalid-actual-statistics'],
    [{ pts_allow: -1, pts_allow_0: 1, sack: 3 }, 'invalid-points-allowed'],
    [{ pts_allow: 0.1, pts_allow_0: 1, sack: 3 }, 'invalid-points-allowed'],
    [{ pts_allow: 0, pts_allow_0: 1, sack: 1 }, 'actual-score-mismatch'],
  ] as const)('refuses absent, malformed or uncorrelated actual evidence %#', (stats, reason) => {
    expect(calculate({ evidence: evidence({ stats }) })).toEqual({ status: 'unavailable', reason });
  });

  it('rejects contradictory and missing brackets even when weighted score parity matches', () => {
    // Wrong bracket has zero weight, so the official total still matches.
    expect(calculate({ evidence: evidence({ stats: { ...evidence().stats, pts_allow_21_27: 1 } }) }))
      .toEqual({ status: 'unavailable', reason: 'points-allowed-bucket-mismatch' });
    expect(calculate({
      evidence: evidence({ stats: { pts_allow: 21 } }), officialPoints: 0,
    })).toEqual({ status: 'unavailable', reason: 'points-allowed-bucket-mismatch' });
    expect(calculate({
      evidence: evidence({ stats: { pts_allow: 0, pts_allow_0: 0.5 } }), officialPoints: 5,
    })).toEqual({ status: 'unavailable', reason: 'points-allowed-bucket-mismatch' });
  });

  it('rejects unsupported active rules and inconsistent source mappings instead of silently dropping points', () => {
    expect(calculate({ evidence: evidence({ profile: profile({ ...rules, yds_allow_0_100: 5 }) }) }))
      .toEqual({ status: 'unavailable', reason: 'unsupported-actual-scoring' });
    expect(calculate({ evidence: evidence({ pointsAllowedBuckets: { ...bucketKeys, pointsAllowedZero: 'pts_allow_7_13' } }) }))
      .toEqual({ status: 'unavailable', reason: 'invalid-scoring-mapping' });
  });

  it('preserves the existing exact official parity tolerance', () => {
    expect(calculate({ officialPoints: 13.0000005 }).status).toBe('available');
    expect(calculate({ officialPoints: 13.000002 }))
      .toEqual({ status: 'unavailable', reason: 'actual-score-mismatch' });
  });

  it.each(['league1-settings.json', 'league2-settings.json'])('uses the captured full weekly schema and %s scoring without inventing bonus projections', (file) => {
    const load = (name: string) => JSON.parse(readFileSync(new URL(`../../../test-support/fixtures/all-player-foundation/${name}`, import.meta.url), 'utf8'));
    const source = load('weekly-stat-response.json');
    const fullProfile = profile(load(file).scoring_settings);
    const frozenPoints = scoreProjection(projection, fullProfile.rules).points!;
    // SF's captured score: 1 INT (2), 1 recovery (2), 7 PA (4),
    // 1 three-and-out (0.5), 2 fourth-down stops (2) = 10.5.
    const result = calculate({ evidence: evidence({ stats: source.SF, profile: fullProfile }), baselinePoints: frozenPoints, officialPoints: 10.5 });
    expect(projected(result)).toBeCloseTo(10.5 - 4 + 4.1 + 1, 12);
    // SEA's captured score includes its 0.5 stop bonus: 3 sacks + 6 INT + 4 PA + 0.5.
    expect(projected(calculate({ evidence: evidence({ stats: source.SEA, profile: fullProfile }), baselinePoints: frozenPoints, officialPoints: 13.5 })))
      .toBeCloseTo(13.5 - 4 + 4.1 + 1, 12);
  });
});
