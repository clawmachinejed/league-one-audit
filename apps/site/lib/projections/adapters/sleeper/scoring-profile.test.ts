import { describe, expect, it } from 'vitest';
import type { SourceScoringSettings } from '../../domain/contracts';
import { scoreProjection } from '../../domain/scoring';
import { providerKey } from '../../shared/provider-identity';
import { compatibleScoringRulesHash } from '../../shared/revision-compatibility';
import { normalizeSleeperScoringProfile } from './scoring-profile';

const sourceProvider = providerKey('official-source');

function source(rawRules: Readonly<Record<string, unknown>> | null): SourceScoringSettings {
  return { provider: sourceProvider, rawRules };
}

describe('Sleeper scoring-profile adapter', () => {
  it('keeps exact validated raw rules while mapping every supported Sleeper key', () => {
    const rawRules = {
      pass_yd: 0.04,
      pass_td: 6,
      pass_int: -2,
      rush_yd: 0.1,
      rush_td: 6,
      rec: 0.5,
      rec_yd: 0.1,
      rec_td: 6,
      pass_2pt: 2,
      rush_2pt: 2,
      rec_2pt: 2,
      fum_lost: -2,
      sack: 1,
      int: 2,
      def_st_fum_rec: 2,
      def_td: 6,
      def_st_td: 6,
      safe: 2,
      blk_kick: 2,
      pts_allow_0: 10,
      pts_allow_1_6: 7,
      pts_allow_7_13: 4,
      pts_allow_14_20: 1,
      pts_allow_21_27: 0,
      pts_allow_28_34: -1,
      pts_allow_35p: -4,
      fgm: 3,
      fgmiss: -1,
      xpm: 1,
      xpmiss: -1,
      bonus_pass_yd_300: 2,
      ignored_zero_rule: 0,
    } as const;

    const normalized = normalizeSleeperScoringProfile(source(rawRules));
    expect(normalized.status).toBe('available');
    if (normalized.status !== 'available') throw new Error('Expected an available scoring profile.');

    expect(normalized.profile.provenance.rawRules).toBe(rawRules);
    expect(compatibleScoringRulesHash(normalized.profile.provenance.rawRules))
      .toBe(compatibleScoringRulesHash(rawRules));
    expect(normalized.profile.provenance.provider).toBe(sourceProvider);
    expect(normalized.profile.rules).toMatchObject({
      passingYards: 0.04,
      passingTouchdowns: 6,
      passingInterceptions: -2,
      rushingYards: 0.1,
      rushingTouchdowns: 6,
      receptions: 0.5,
      receivingYards: 0.1,
      receivingTouchdowns: 6,
      passingTwoPointConversions: 2,
      rushingTwoPointConversions: 2,
      receivingTwoPointConversions: 2,
      fumblesLost: -2,
      sacks: 1,
      defensiveInterceptions: 2,
      fumbleRecoveries: 2,
      defensiveTouchdowns: 6,
      specialTeamsTouchdowns: 6,
      safeties: 2,
      blockedKicks: 2,
      pointsAllowedZero: 10,
      pointsAllowedOneToSix: 7,
      pointsAllowedSevenToThirteen: 4,
      pointsAllowedFourteenToTwenty: 1,
      pointsAllowedTwentyOneToTwentySeven: 0,
      pointsAllowedTwentyEightToThirtyFour: -1,
      pointsAllowedThirtyFivePlus: -4,
      fieldGoalsMade: 3,
      fieldGoalsMissed: -1,
      extraPointsMade: 1,
      extraPointsMissed: -1,
    });
    expect(normalized.profile.provenance.supportedSourceKeys).toContain('pass_td');
    expect(normalized.profile.provenance.supportedSourceKeys).not.toContain('pts_allow_21_27');
    expect(normalized.profile.provenance.unsupportedSourceKeys).toEqual(['bonus_pass_yd_300']);
    expect(normalized.profile.provenance.aggregateTwoPointConversionSupported).toBe(true);
    expect(normalized.profile.provenance.usesPointsAllowedBucketProxy).toBe(true);
  });

  it('preserves full-precision offense scoring and counts aggregate 2PT stats once', () => {
    const normalized = normalizeSleeperScoringProfile(source({
      pass_yd: 0.04,
      pass_td: 6,
      pass_int: -2,
      rush_yd: 0.1,
      rush_td: 6,
      pass_2pt: 2,
      rush_2pt: 2,
      rec_2pt: 2,
      fum_lost: -2,
    }));
    if (normalized.status !== 'available') throw new Error('Expected an available scoring profile.');

    const score = scoreProjection({
      kind: 'offense',
      passingYards: 278.4,
      passingTouchdowns: 1.8,
      passingInterceptions: 0.7,
      rushingYards: 14.2,
      rushingTouchdowns: 0.15,
      twoPointConversions: 0.08,
      fumblesLost: 0.2,
    }, normalized.profile.rules);

    expect(score.available).toBe(true);
    expect(score.points).toBeCloseTo(22.616, 12);
    expect(score.appliedScoringEvents).toEqual([
      'fumblesLost',
      'passingInterceptions',
      'passingTouchdowns',
      'passingTwoPointConversions',
      'passingYards',
      'receivingTwoPointConversions',
      'rushingTouchdowns',
      'rushingTwoPointConversions',
      'rushingYards',
    ]);
  });

  it('marks unequal aggregate 2PT source weights unsupported without inventing points', () => {
    const normalized = normalizeSleeperScoringProfile(source({
      pass_2pt: 2,
      rush_2pt: 1,
      rec_2pt: 2,
    }));
    if (normalized.status !== 'available') throw new Error('Expected an available scoring profile.');

    expect(normalized.profile.provenance.supportedSourceKeys).toEqual([]);
    expect(normalized.profile.provenance.unsupportedSourceKeys).toEqual([
      'pass_2pt',
      'rec_2pt',
      'rush_2pt',
    ]);
    expect(normalized.profile.provenance.aggregateTwoPointConversionSupported).toBe(false);
    expect(scoreProjection({
      kind: 'offense',
      twoPointConversions: 1,
    }, normalized.profile.rules)).toMatchObject({
      available: true,
      points: 0,
      unsupportedScoringEvents: [
        'passingTwoPointConversions',
        'receivingTwoPointConversions',
        'rushingTwoPointConversions',
      ],
    });
  });

  it('reports every active unsupported source rule while ignoring explicit zeroes', () => {
    const normalized = normalizeSleeperScoringProfile(source({
      pass_yd: 0.04,
      pass_td_40p: 1,
      rec_td_40p: 1,
      rush_td_40p: 1,
      fum_rec: 2,
      fum_rec_td: 6,
      st_td: 6,
      def_2pt: 2,
      def_3_and_out: 0.5,
      def_4_and_stop: 1,
      fgm_yds_over_30: 0.1,
      future_custom_rule: 3,
      ignored_zero_rule: 0,
    }));
    if (normalized.status !== 'available') throw new Error('Expected an available scoring profile.');

    expect(normalized.profile.provenance.supportedSourceKeys).toEqual(['pass_yd']);
    expect(normalized.profile.provenance.unsupportedSourceKeys).toEqual([
      'def_2pt',
      'def_3_and_out',
      'def_4_and_stop',
      'fgm_yds_over_30',
      'fum_rec',
      'fum_rec_td',
      'future_custom_rule',
      'pass_td_40p',
      'rec_td_40p',
      'rush_td_40p',
      'st_td',
    ]);
    expect(normalized.profile.provenance.unsupportedSourceKeys).not.toContain('ignored_zero_rule');
  });

  it('uses nearest-whole-point defense buckets at the same boundary as existing scoring', () => {
    const normalized = normalizeSleeperScoringProfile(source({
      pts_allow_1_6: 7,
      pts_allow_7_13: 4,
    }));
    if (normalized.status !== 'available') throw new Error('Expected an available scoring profile.');

    expect(scoreProjection({ kind: 'defense', pointsAllowed: 6.49 }, normalized.profile.rules))
      .toMatchObject({
        available: true,
        points: 7,
        pointsAllowedProxy: {
          projectedPointsAllowed: 6.49,
          roundedPointsAllowed: 6,
          scoringEvent: 'pointsAllowedOneToSix',
        },
      });
    expect(scoreProjection({ kind: 'defense', pointsAllowed: 6.5 }, normalized.profile.rules))
      .toMatchObject({
        available: true,
        points: 4,
        pointsAllowedProxy: {
          projectedPointsAllowed: 6.5,
          roundedPointsAllowed: 7,
          scoringEvent: 'pointsAllowedSevenToThirteen',
        },
      });
  });

  it('returns explicit missing and invalid results without throwing during source loading', () => {
    expect(normalizeSleeperScoringProfile(source(null))).toEqual({
      status: 'unavailable',
      reason: 'missing',
      invalidSourceKeys: [],
    });
    expect(normalizeSleeperScoringProfile(source({}))).toEqual({
      status: 'unavailable',
      reason: 'missing',
      invalidSourceKeys: [],
    });
    expect(normalizeSleeperScoringProfile(source({
      rush_yd: Number.NaN,
      pass_td: '6',
      rec: 0.5,
    }))).toEqual({
      status: 'unavailable',
      reason: 'invalid',
      invalidSourceKeys: ['pass_td', 'rush_yd'],
    });
  });
});
