import { describe, expect, it } from 'vitest';
import {
  calculateLiveProjection,
  type LiveProjectionInput,
} from './projections/domain/live-calculation';
import type { LiveDefenseProjectionEvidence } from './projections/domain/live-defense';
import { providerKey } from './projections/shared/provider-identity';

const completeBaseline = (points: number) => ({ points, quality: 'complete' as const });
const defenseEvidence: LiveDefenseProjectionEvidence = {
  projection: { kind: 'defense', sacks: 2, pointsAllowed: 20 },
  profile: {
    rules: { sacks: 1, pointsAllowedZero: 10, pointsAllowedSevenToThirteen: 4, pointsAllowedFourteenToTwenty: 1 },
    provenance: {
      provider: providerKey('sleeper'), rawRules: { sack: 1, pts_allow_0: 10, pts_allow_7_13: 4, pts_allow_14_20: 1 },
      supportedSourceKeys: ['sack', 'pts_allow_0', 'pts_allow_7_13', 'pts_allow_14_20'],
      unsupportedSourceKeys: [], aggregateTwoPointConversionSupported: true, usesPointsAllowedBucketProxy: true,
    },
  },
  stats: { pts_allow: 0, pts_allow_0: 1, sack: 3 },
  supportedActualRuleKeys: new Set(['sack', 'pts_allow_0', 'pts_allow_7_13', 'pts_allow_14_20']),
  pointsAllowedStatKey: 'pts_allow',
  pointsAllowedBuckets: {
    pointsAllowedZero: 'pts_allow_0', pointsAllowedOneToSix: 'pts_allow_1_6',
    pointsAllowedSevenToThirteen: 'pts_allow_7_13', pointsAllowedFourteenToTwenty: 'pts_allow_14_20',
    pointsAllowedTwentyOneToTwentySeven: 'pts_allow_21_27', pointsAllowedTwentyEightToThirtyFour: 'pts_allow_28_34',
    pointsAllowedThirtyFivePlus: 'pts_allow_35p',
  },
};

function calculate(overrides: Partial<LiveProjectionInput> = {}) {
  return calculateLiveProjection({
    kind: 'offense',
    gameState: { phase: 'halftime', remainingFraction: 0.5 },
    baseline: completeBaseline(20),
    officialPoints: 10,
    ...overrides,
  });
}

describe('clock-v1 live projection', () => {
  it('returns the frozen baseline before kickoff without requiring official points', () => {
    expect(calculate({
      gameState: { phase: 'pregame', remainingFraction: 1 },
      officialPoints: null,
      baseline: completeBaseline(22.29),
    })).toEqual({ projectedPoints: 22.29, quality: 'pregame-baseline' });
  });

  it('reproduces the halftime example at full precision', () => {
    const result = calculate({
      officialPoints: 24.8,
      baseline: completeBaseline(22.29),
      gameState: { phase: 'halftime', remainingFraction: 0.5 },
    });

    expect(result.quality).toBe('estimated');
    expect(result.projectedPoints).toBeCloseTo(35.945, 12);
    expect(result.projectedPoints).not.toBe(35.95);
  });

  it('uses the same full-precision formula for kickers and permits negative official scores', () => {
    expect(calculate({
      kind: 'kicker',
      officialPoints: -1,
      baseline: completeBaseline(8.25),
      gameState: { phase: 'q4', remainingFraction: 0.25 },
    })).toEqual({ projectedPoints: 1.0625, quality: 'estimated' });
  });

  it('holds D/ST at its frozen baseline without correlated component evidence', () => {
    expect(calculate({
      kind: 'defense',
      officialPoints: 10,
      baseline: completeBaseline(7.375),
      gameState: { phase: 'q4', remainingFraction: 0.25 },
    })).toEqual({ projectedPoints: 7.375, quality: 'defense-baseline-held' });
  });

  it('estimates live D/ST using verified components without double-counting provisional points', () => {
    expect(calculate({
      kind: 'defense', baseline: completeBaseline(3), officialPoints: 13, defense: defenseEvidence,
    })).toEqual({ projectedPoints: 8, quality: 'defense-estimated' });
  });

  it('scopes absent, invalid and mismatched D/ST component evidence to the existing held fallback', () => {
    for (const stats of [null, {}, { pts_allow: 7, pts_allow_7_13: 1, sack: 3 }]) {
      expect(calculate({
        kind: 'defense', baseline: completeBaseline(3), officialPoints: 13,
        defense: { ...defenseEvidence, stats },
      })).toEqual({ projectedPoints: 3, quality: 'defense-baseline-held',
        defenseReason: stats === null ? 'missing-actual-statistics' : 'actual-score-mismatch' });
    }
    expect(calculate({ kind: 'defense', baseline: null, officialPoints: 13, defense: defenseEvidence }))
      .toEqual({ projectedPoints: 0, quality: 'missing-baseline' });
  });

  it('keeps pregame and final behavior independent of live component availability', () => {
    const invalidEvidence = { ...defenseEvidence, stats: null };
    expect(calculate({ kind: 'defense', baseline: completeBaseline(3), officialPoints: null,
      defense: invalidEvidence, gameState: { phase: 'pregame', remainingFraction: 1 } }))
      .toEqual({ projectedPoints: 3, quality: 'pregame-baseline' });
    expect(calculate({ kind: 'defense', baseline: completeBaseline(3), officialPoints: 13,
      defense: invalidEvidence, gameState: { phase: 'final', remainingFraction: 0 } }))
      .toEqual({ projectedPoints: 13, quality: 'official-final' });
  });

  it('uses actual D/ST components at a zero regulation clock or in overtime without declaring finality', () => {
    for (const phase of ['q4', 'overtime'] as const) {
      expect(calculate({ kind: 'defense', baseline: completeBaseline(3), officialPoints: 13,
        defense: defenseEvidence, gameState: { phase, remainingFraction: 0 } }))
        .toEqual({ projectedPoints: 13, quality: 'defense-estimated' });
    }
  });

  it.each(['offense', 'kicker', 'defense'] as const)(
    'converges a final %s result exactly to Sleeper official points',
    (kind) => {
      expect(calculate({
        kind,
        gameState: { phase: 'final', remainingFraction: 0 },
        officialPoints: -0.125,
        baseline: completeBaseline(100),
      })).toEqual({ projectedPoints: -0.125, quality: 'official-final' });
    },
  );

  it('uses zero for a missing baseline while preserving that quality signal', () => {
    expect(calculate({ baseline: null, officialPoints: 12.5 }))
      .toEqual({ projectedPoints: 12.5, quality: 'missing-baseline' });
    expect(calculate({
      gameState: { phase: 'pregame', remainingFraction: 1 },
      officialPoints: null,
      baseline: { points: 0, quality: 'missing' },
    })).toEqual({ projectedPoints: 0, quality: 'missing-baseline' });
  });

  it('retains the prior value when a live or final official score is missing', () => {
    expect(calculate({ officialPoints: null, priorProjectedPoints: 17.75 }))
      .toEqual({ projectedPoints: 17.75, quality: 'retained-prior' });
    expect(calculate({
      gameState: { phase: 'final', remainingFraction: 0 }, officialPoints: null, priorProjectedPoints: 19,
    })).toEqual({ projectedPoints: 19, quality: 'retained-prior' });
  });

  it('returns no result when an official score is required and no prior exists', () => {
    expect(calculate({ officialPoints: null, priorProjectedPoints: null }))
      .toEqual({ projectedPoints: null, quality: 'unavailable' });
    expect(calculate({
      gameState: { phase: 'final', remainingFraction: 0 }, officialPoints: Number.NaN, priorProjectedPoints: null,
    })).toEqual({ projectedPoints: null, quality: 'unavailable' });
  });

  it.each(['postponed', 'suspended', 'unknown'] as const)(
    'retains a prior %s projection and otherwise falls back to the baseline',
    (phase) => {
      expect(calculate({ gameState: { phase, remainingFraction: null }, priorProjectedPoints: 13.2 }))
        .toEqual({ projectedPoints: 13.2, quality: 'retained-prior' });
      expect(calculate({ gameState: { phase, remainingFraction: null }, priorProjectedPoints: null }))
        .toEqual({ projectedPoints: 20, quality: 'pregame-baseline' });
    },
  );

  it('falls back safely instead of calculating with an invalid remaining fraction', () => {
    expect(calculate({
      gameState: { phase: 'q1', remainingFraction: 1.01 }, priorProjectedPoints: 14,
    })).toEqual({ projectedPoints: 14, quality: 'retained-prior' });
    expect(calculate({
      gameState: { phase: 'q1', remainingFraction: Number.NaN }, priorProjectedPoints: null,
    })).toEqual({ projectedPoints: 20, quality: 'pregame-baseline' });
  });
});
