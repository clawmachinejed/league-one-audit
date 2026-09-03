import { describe, expect, it } from 'vitest';
import {
  calculateLiveProjection,
  type LiveProjectionInput,
} from './projections/domain/live-calculation';

const completeBaseline = (points: number) => ({ points, quality: 'complete' as const });

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

  it('holds D/ST at its frozen baseline while live to avoid provisional-score double counting', () => {
    expect(calculate({
      kind: 'defense',
      officialPoints: 10,
      baseline: completeBaseline(7.375),
      gameState: { phase: 'q4', remainingFraction: 0.25 },
    })).toEqual({ projectedPoints: 7.375, quality: 'defense-baseline-held' });
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
