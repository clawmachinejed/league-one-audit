import { describe, expect, it } from 'vitest';
import {
  auditProjectionScoringSettings,
  POINTS_ALLOWED_SCORING_KEYS,
  scoreTank01Projection,
  SUPPORTED_DEFENSE_SCORING_KEYS,
  SUPPORTED_KICKER_SCORING_KEYS,
  SUPPORTED_OFFENSE_SCORING_KEYS,
  TWO_POINT_SCORING_KEYS,
} from './projection-scoring';
import type {
  NormalizedTank01DefenseProjection,
  NormalizedTank01OffenseProjection,
  NormalizedTank01KickerProjection,
  SleeperScoringSettings,
} from './projection-scoring';

const currentLeagueSettings: SleeperScoringSettings = {
  sack: 1,
  fgm_40_49: 0,
  fgm_yds: 0,
  bonus_rec_yd_100: 0,
  bonus_rush_yd_100: 0,
  pass_int: -2,
  pts_allow_0: 10,
  bonus_pass_yd_400: 0,
  pass_2pt: 2,
  st_td: 6,
  fgm_yds_over_30: 0.1,
  rec_td: 6,
  fgm_30_39: 0,
  xpmiss: 0,
  rush_td: 6,
  def_4_and_stop: 1,
  pass_td_40p: 1,
  fgm: 3,
  rec_2pt: 2,
  st_fum_rec: 0,
  fgmiss: 0,
  ff: 0,
  rec: 0.5,
  pts_allow_14_20: 1,
  def_2pt: 2,
  fgm_0_19: 0,
  int: 2,
  def_st_fum_rec: 2,
  fum_lost: -2,
  pts_allow_1_6: 7,
  fgm_20_29: 0,
  pts_allow_21_27: 0,
  xpm: 1,
  def_3_and_out: 0.5,
  rush_2pt: 2,
  fum_rec: 2,
  bonus_rec_yd_200: 0,
  def_st_td: 6,
  fgm_50p: 0,
  def_td: 6,
  rec_td_40p: 1,
  bonus_rush_yd_200: 0,
  safe: 2,
  pass_yd: 0.04,
  blk_kick: 2,
  pass_td: 6,
  rush_yd: 0.1,
  fum: 0,
  pts_allow_28_34: -1,
  pts_allow_35p: -4,
  fum_rec_td: 6,
  rec_yd: 0.1,
  rush_td_40p: 1,
  def_st_ff: 0,
  pts_allow_7_13: 4,
  st_ff: 0,
};

const offenseProjection: NormalizedTank01OffenseProjection = {
  kind: 'offense',
  passingYards: 278.4,
  passingTouchdowns: 1.8,
  passingInterceptions: 0.7,
  rushingYards: 14.2,
  rushingTouchdowns: 0.15,
  receptions: 0,
  receivingYards: 0,
  receivingTouchdowns: 0,
  twoPointConversions: 0.08,
  fumblesLost: 0.2,
};

const defenseProjection: NormalizedTank01DefenseProjection = {
  kind: 'defense',
  sacks: 2.7,
  interceptions: 0.9,
  fumbleRecoveries: 0.55,
  defensiveTouchdowns: 0.18,
  specialTeamsTouchdowns: 0.02,
  safeties: 0.04,
  blockedKicks: 0.08,
  pointsAllowed: 19.6,
};

describe('Tank01 offense projection scoring', () => {
  it('applies the current League One offense formula at full precision', () => {
    const result = scoreTank01Projection(offenseProjection, currentLeagueSettings);

    expect(result.available).toBe(true);
    expect(result.points).toBeCloseTo(22.616, 12);
    expect(result.points).not.toBe(22.62);
    expect(result.appliedScoringKeys).toEqual([...SUPPORTED_OFFENSE_SCORING_KEYS].sort());
    expect(result.pointsAllowedProxy).toBeNull();
  });

  it('reports active long-touchdown and recovery rules without inventing those events', () => {
    const result = scoreTank01Projection(offenseProjection, currentLeagueSettings);

    expect(result.unsupportedScoringKeys).toEqual([
      'fum_rec',
      'fum_rec_td',
      'pass_td_40p',
      'rec_td_40p',
      'rush_td_40p',
      'st_td',
    ]);
    expect(result.available).toBe(true);
  });

  it('treats explicit numeric zero as data and returns a real zero projection', () => {
    const zeroProjection = Object.fromEntries(
      Object.keys(offenseProjection).map((key) => [key, key === 'kind' ? 'offense' : 0]),
    ) as unknown as NormalizedTank01OffenseProjection;

    const result = scoreTank01Projection(zeroProjection, currentLeagueSettings);
    expect(result).toMatchObject({ available: true, points: 0, missingStats: [], invalidStats: [] });
  });

  it('does not silently turn a required missing statistic into zero', () => {
    const result = scoreTank01Projection(
      { ...offenseProjection, receivingYards: undefined },
      currentLeagueSettings,
    );

    expect(result).toMatchObject({
      available: false,
      points: null,
      missingStats: ['receivingYards'],
    });
  });

  it('does not require a statistic when its scoring weight is zero', () => {
    const result = scoreTank01Projection(
      { kind: 'offense', passingYards: 250 },
      { pass_yd: 0.04, rec: 0, rush_yd: 0 },
    );

    expect(result).toMatchObject({ available: true, points: 10, missingStats: [] });
  });

  it.each([
    ['not a number', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
  ])('rejects %s instead of returning a misleading score', (_label, invalidValue) => {
    const result = scoreTank01Projection(
      { ...offenseProjection, passingYards: invalidValue },
      currentLeagueSettings,
    );

    expect(result).toMatchObject({ available: false, points: null, invalidStats: ['passingYards'] });
  });

  it('allows negative projected yardage but rejects negative event counts', () => {
    const negativeYards = scoreTank01Projection({ kind: 'offense', rushingYards: -1.5 }, { rush_yd: 0.1 });
    expect(negativeYards).toMatchObject({ available: true, invalidStats: [] });
    expect(negativeYards.points).toBeCloseTo(-0.15, 12);
    expect(scoreTank01Projection({ kind: 'offense', passingTouchdowns: -1 }, { pass_td: 6 }))
      .toMatchObject({ available: false, points: null, invalidStats: ['passingTouchdowns'] });
  });

  it('rejects non-finite and non-numeric scoring weights without coercion', () => {
    const result = scoreTank01Projection(offenseProjection, {
      pass_yd: Number.POSITIVE_INFINITY,
      pass_td: '6',
      pass_td_50p: Number.NaN,
    });

    expect(result).toMatchObject({
      available: false,
      points: null,
      invalidScoringKeys: ['pass_td', 'pass_td_50p', 'pass_yd'],
    });
  });

  it('uses the aggregate 2PT projection only when all three Sleeper weights match', () => {
    const supported = scoreTank01Projection(
      { kind: 'offense', twoPointConversions: 0.25 },
      { pass_2pt: 2, rush_2pt: 2, rec_2pt: 2 },
    );
    expect(supported).toMatchObject({ available: true, points: 0.5, unsupportedScoringKeys: [] });
    expect(supported.appliedScoringKeys).toEqual([...TWO_POINT_SCORING_KEYS].sort());

    const unsupported = scoreTank01Projection(
      { kind: 'offense' },
      { pass_2pt: 1, rush_2pt: 2, rec_2pt: 2 },
    );
    expect(unsupported).toMatchObject({
      available: true,
      points: 0,
      missingStats: [],
      unsupportedScoringKeys: ['pass_2pt', 'rec_2pt', 'rush_2pt'],
    });
  });
});

describe('Tank01 kicker projection scoring', () => {
  const kickerProjection: NormalizedTank01KickerProjection = {
    kind: 'kicker',
    fieldGoalsMade: 2.1,
    fieldGoalsMissed: 0.2,
    extraPointsMade: 2.8,
    extraPointsMissed: 0.1,
  };

  it('applies count-based kicker rules and reports distance scoring as unsupported', () => {
    const result = scoreTank01Projection(kickerProjection, currentLeagueSettings);
    expect(result.available).toBe(true);
    expect(result.points).toBeCloseTo(9.1, 12);
    expect(result.appliedScoringKeys).toEqual(['fgm', 'xpm']);
    expect(result.unsupportedScoringKeys).toEqual(['fgm_yds_over_30']);
  });
});

describe('Tank01 team-defense projection scoring', () => {
  it('applies supported D/ST stats and clearly surfaces the points-allowed proxy', () => {
    const result = scoreTank01Projection(defenseProjection, currentLeagueSettings);

    expect(result.available).toBe(true);
    expect(result.points).toBeCloseTo(8.04, 12);
    expect(result.pointsAllowedProxy).toEqual({
      projectedPointsAllowed: 19.6,
      roundedPointsAllowed: 20,
      scoringKey: 'pts_allow_14_20',
    });
    expect(result.appliedScoringKeys).toEqual([
      'blk_kick', 'def_st_fum_rec', 'def_st_td', 'def_td', 'int', 'pts_allow_14_20', 'sack', 'safe',
    ]);
  });

  it('reports the current unsupported custom D/ST rules', () => {
    const result = scoreTank01Projection(defenseProjection, currentLeagueSettings);

    expect(result.unsupportedScoringKeys).toEqual([
      'def_2pt', 'def_3_and_out', 'def_4_and_stop',
    ]);
  });

  it.each([
    [0, 'pts_allow_0', 10],
    [0.49, 'pts_allow_0', 10],
    [0.5, 'pts_allow_1_6', 7],
    [6.49, 'pts_allow_1_6', 7],
    [6.5, 'pts_allow_7_13', 4],
    [13.49, 'pts_allow_7_13', 4],
    [13.5, 'pts_allow_14_20', 1],
    [20.5, 'pts_allow_21_27', 0],
    [27.5, 'pts_allow_28_34', -1],
    [34.5, 'pts_allow_35p', -4],
  ])('maps %f expected points to the %s proxy bucket', (pointsAllowed, scoringKey, points) => {
    const result = scoreTank01Projection(
      { kind: 'defense', pointsAllowed },
      Object.fromEntries(POINTS_ALLOWED_SCORING_KEYS.map((key) => [key, currentLeagueSettings[key]])),
    );

    expect(result).toMatchObject({
      available: true,
      points,
      pointsAllowedProxy: { scoringKey },
    });
  });

  it('requires points allowed when any points-allowed tier is active', () => {
    const result = scoreTank01Projection({ kind: 'defense' }, { pts_allow_0: 10 });
    expect(result).toMatchObject({ available: false, points: null, missingStats: ['pointsAllowed'] });
  });

  it('does not require points allowed when every tier is absent or zero', () => {
    const result = scoreTank01Projection(
      { kind: 'defense', sacks: 2.25 },
      { sack: 1, pts_allow_0: 0 },
    );
    expect(result).toMatchObject({ available: true, points: 2.25, pointsAllowedProxy: null });
  });
});

describe('projection scoring coverage', () => {
  it('publishes explicit, non-overlapping allowlists', () => {
    expect(SUPPORTED_OFFENSE_SCORING_KEYS).toContain('pass_yd');
    expect(SUPPORTED_OFFENSE_SCORING_KEYS).toContain('rec_2pt');
    expect(SUPPORTED_DEFENSE_SCORING_KEYS).toContain('def_st_fum_rec');
    expect(SUPPORTED_DEFENSE_SCORING_KEYS).toContain('pts_allow_35p');
    expect(SUPPORTED_KICKER_SCORING_KEYS).toContain('fgm');
    expect(new Set([
      ...SUPPORTED_OFFENSE_SCORING_KEYS, ...SUPPORTED_DEFENSE_SCORING_KEYS, ...SUPPORTED_KICKER_SCORING_KEYS,
    ]).size).toBe(
      SUPPORTED_OFFENSE_SCORING_KEYS.length + SUPPORTED_DEFENSE_SCORING_KEYS.length
      + SUPPORTED_KICKER_SCORING_KEYS.length,
    );
  });

  it('reports all active unsupported and invalid league settings while ignoring zero-value rules', () => {
    const coverage = auditProjectionScoringSettings({
      ...currentLeagueSettings,
      future_custom_rule: 3,
      another_future_rule: 0,
      malformed_rule: Number.NaN,
    });

    expect(coverage.aggregateTwoPointConversionSupported).toBe(true);
    expect(coverage.usesPointsAllowedBucketProxy).toBe(true);
    expect(coverage.supportedScoringKeys).toContain('pass_yd');
    expect(coverage.unsupportedScoringKeys).toEqual([
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
    expect(coverage.unsupportedScoringKeys).not.toContain('another_future_rule');
    expect(coverage.invalidScoringKeys).toEqual(['malformed_rule']);
  });

  it('marks unequal aggregate 2PT weights unsupported in the coverage audit', () => {
    const coverage = auditProjectionScoringSettings({ pass_2pt: 1, rush_2pt: 2, rec_2pt: 2 });
    expect(coverage.aggregateTwoPointConversionSupported).toBe(false);
    expect(coverage.supportedScoringKeys).toEqual([]);
    expect(coverage.unsupportedScoringKeys).toEqual(['pass_2pt', 'rec_2pt', 'rush_2pt']);
  });
});
