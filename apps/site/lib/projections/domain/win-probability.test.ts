import { describe, expect, it } from 'vitest';
import {
  calculateWinProbability,
  WIN_PROBABILITY_MODEL_VERSION,
  type WinProbabilityInput,
  type WinProbabilityPlayerInput,
  type WinProbabilityResult,
  type WinProbabilitySideInput,
} from './win-probability';

function player(overrides: Partial<WinProbabilityPlayerInput> = {}): WinProbabilityPlayerInput {
  return {
    position: 'QB', kind: 'offense', phase: 'pregame', remainingFraction: 1,
    baselinePoints: 20, projectionQuality: 'pregame-baseline', officialPoints: 0,
    ...overrides,
  };
}

function side(overrides: Partial<WinProbabilitySideInput> = {}): WinProbabilitySideInput {
  return { officialPoints: 0, projectedPoints: 20, lineupAvailable: true, players: [player()], ...overrides };
}

function result(left = side(), right = side(), status: WinProbabilityInput['status'] = 'upcoming') {
  return calculateWinProbability({ sides: [left, right], status });
}

function probability(estimate: WinProbabilityResult): number {
  expect(estimate.status).toBe('estimated');
  if (estimate.status !== 'estimated') throw new Error('Expected an available estimate');
  return estimate.probabilities[0];
}

function expectUnavailable(estimate: WinProbabilityResult, reason: string) {
  expect(estimate).toEqual({ modelVersion: WIN_PROBABILITY_MODEL_VERSION, status: 'unavailable', reason });
}

describe('normal-v3 matchup win probability', () => {
  it('gives equal canonical projected finishes equal chances', () => {
    expect(result()).toEqual({ modelVersion: 'normal-v3', status: 'estimated', probabilities: [0.5, 0.5] });
  });

  it('matches a known standard-normal probability independently of the implementation approximation', () => {
    // Two projected 20-point QBs each have SD 9; a sqrt(162) mean advantage is z=1.
    const estimate = result(side({ projectedPoints: 20 + Math.sqrt(162) }));
    expect(probability(estimate)).toBeCloseTo(0.841344746, 6);
  });

  it('uses the supplied projected finish rather than recomputing player scores', () => {
    const left = side({ projectedPoints: 37, officialPoints: 21 });
    const right = side({ projectedPoints: 22, officialPoints: 6 });
    expect(probability(result(left, right))).toBeGreaterThan(0.5);
    // Baselines and current points are unchanged. A canonical correction must affect the estimate.
    expect(probability(result({ ...left, projectedPoints: 7 }, right))).toBeLessThan(0.5);
  });

  it('is symmetric under side reversal and complementary across a range of advantages', () => {
    for (const lead of [-200, -40, -7.5, 0, 7.5, 40, 200]) {
      const left = side({ projectedPoints: 20 + lead });
      const estimate = result(left);
      const reversed = result(side(), left);
      const p = probability(estimate);
      expect(probability(reversed)).toBeCloseTo(1 - p, 12);
      if (estimate.status === 'estimated') expect(estimate.probabilities[0] + estimate.probabilities[1]).toBe(1);
    }
  });

  it('increases monotonically with an advantage at fixed uncertainty', () => {
    const chances = [-10, 0, 10, 20, 30].map((lead) => probability(result(side({ projectedPoints: 20 + lead }))));
    expect(chances.every((chance, index) => index === 0 || chance > chances[index - 1])).toBe(true);
  });

  it('reduces uncertainty as time elapses without altering a canonical mean', () => {
    function liveSide(projectedPoints: number, remainingFraction: number) {
      return side({ projectedPoints, officialPoints: 10, players: [player({
        phase: 'q3', remainingFraction, officialPoints: 10, projectionQuality: 'estimated',
      })] });
    }
    const earlier = probability(result(liveSide(30, 0.75), liveSide(20, 0.75), 'live'));
    const later = probability(result(liveSide(30, 0.25), liveSide(20, 0.25), 'live'));
    expect(later).toBeGreaterThan(earlier);
    expect(later).toBeLessThan(1);
  });

  it('keeps material uncertainty at a zero clock and in overtime', () => {
    function clockSide(projectedPoints: number, phase: 'q4' | 'overtime') {
      return side({ projectedPoints, players: [player({ phase, remainingFraction: 0, projectionQuality: 'estimated' })] });
    }
    const regulation = probability(result(clockSide(21, 'q4'), clockSide(20, 'q4'), 'live'));
    const overtime = probability(result(clockSide(21, 'overtime'), clockSide(20, 'overtime'), 'live'));
    expect(regulation).toBeGreaterThan(0.5);
    expect(regulation).toBeLessThan(0.8);
    expect(overtime).toBeGreaterThan(0.5);
    expect(overtime).toBeLessThan(regulation);
  });

  it('retains D/ST uncertainty while clock-v1 holds its pregame mean', () => {
    function defenseSide(projectedPoints: number, remainingFraction: number) {
      return side({ projectedPoints, players: [player({
        position: 'DEF', kind: 'defense', phase: 'q4', baselinePoints: 8,
        remainingFraction, projectionQuality: 'defense-baseline-held',
      })] });
    }
    expect(result(defenseSide(10, 0.9), defenseSide(8, 0.9), 'live'))
      .toEqual(result(defenseSide(10, 0), defenseSide(8, 0), 'live'));
  });

  it('uses component-based D/ST means while preserving conservative defensive uncertainty', () => {
    function defenseSide(projectedPoints: number, remainingFraction: number) {
      return side({ projectedPoints, officialPoints: 13, players: [player({
        position: 'DEF', kind: 'defense', phase: 'q4', baselinePoints: 8,
        remainingFraction, projectionQuality: 'defense-estimated', officialPoints: 13,
      })] });
    }
    const updated = probability(result(defenseSide(15, 0.5), defenseSide(8, 0.5), 'live'));
    expect(updated).toBeGreaterThan(0.5);
    expect(probability(result(defenseSide(5, 0.5), defenseSide(8, 0.5), 'live'))).toBeLessThan(0.5);
    expect(result(defenseSide(15, 0.9), defenseSide(8, 0.9), 'live'))
      .toEqual(result(defenseSide(15, 0), defenseSide(8, 0), 'live'));
  });

  it('supports negative defensive means without negative variance', () => {
    const defense = player({ position: 'DEF', kind: 'defense', baselinePoints: -3 });
    const p = probability(result(side({ projectedPoints: -3, players: [defense] }), side({ projectedPoints: -5, players: [defense] })));
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(1);
  });

  it('handles kicker, tight-end and unusual offensive position uncertainties', () => {
    for (const entry of [player({ kind: 'kicker', position: 'K' }), player({ position: 'TE' }), player({ position: 'FB' })]) {
      const p = probability(result(side({ projectedPoints: 30, players: [entry] })));
      expect(p).toBeGreaterThan(0.5);
      expect(p).toBeLessThan(1);
    }
  });

  it('adds independent variances, making a fixed lead less certain with more unresolved players', () => {
    const oneEach = probability(result(side({ projectedPoints: 30 })));
    const twoEach = probability(result(side({ projectedPoints: 30, players: [player(), player()] }), side({ players: [player(), player()] })));
    expect(twoEach).toBeLessThan(oneEach);
    expect(twoEach).toBeGreaterThan(0.5);
  });

  it('uses a positive floor even for a complete zero baseline', () => {
    const zero = player({ baselinePoints: 0 });
    expect(probability(result(side({ projectedPoints: 1, players: [zero] }), side({ projectedPoints: 0, players: [zero] }))))
      .toBeGreaterThan(0.5);
  });

  it('allows a scoped Out pregame starter without a projection and gives that slot zero variance', () => {
    const out = player({ expectedRemainingPointsZero: true, baselinePoints: null, projectionQuality: 'missing-baseline' });
    const estimate = result(side({ projectedPoints: 0, players: [out] }));
    expect(estimate).toEqual(result(side({ projectedPoints: 0, players: [] })));
    expect(probability(estimate)).toBeLessThan(0.5);
    expect(result(side({ projectedPoints: 0, players: [{ ...out, officialPoints: null }] }))).toEqual(estimate);
  });

  it('does not infer an Out designation from an ordinary complete zero projection', () => {
    const ordinary = side({ projectedPoints: 0, players: [player({ baselinePoints: 0 })] });
    const out = side({ projectedPoints: 0, players: [player({ baselinePoints: 0, expectedRemainingPointsZero: true })] });
    // The uncertain ordinary player still has some chance to exceed its zero projection.
    expect(probability(result(ordinary))).toBeGreaterThan(probability(result(out)));
    expect(result({ ...ordinary, players: [player({ baselinePoints: 0, expectedRemainingPointsZero: false })] })).toEqual(result(ordinary));
    expectUnavailable(result(side({ players: [player({ baselinePoints: null, expectedRemainingPointsZero: false })] })), 'missing-projection');
  });

  it('uses zero remaining uncertainty for a scoped live Out player while retaining points already scored', () => {
    const out = player({ phase: 'q3', remainingFraction: 0.25, officialPoints: 12,
      baselinePoints: 20, projectionQuality: 'estimated', expectedRemainingPointsZero: true });
    const left = side({ projectedPoints: 12, officialPoints: 12, players: [out] });
    const estimate = result(left, side(), 'live');
    expect(estimate).toEqual(result({ ...left, players: [] }, side(), 'live'));
    expect(probability(estimate)).toBeGreaterThan(probability(result({ ...left, projectedPoints: 0 }, side(), 'live')));
    // A historical baseline remains source evidence; the Out input, not that baseline's value, establishes zero remaining points.
    expect(result({ ...left, players: [{ ...out, baselinePoints: null, projectionQuality: 'missing-baseline' }] }, side(), 'live')).toEqual(estimate);
  });

  it('does not let a scoped Out expectation override final official points or team totals', () => {
    const out = player({ phase: 'final', officialPoints: 25, projectionQuality: 'official-final', expectedRemainingPointsZero: true });
    const finished = player({ phase: 'final', officialPoints: 12, projectionQuality: 'official-final' });
    expect(result(side({ projectedPoints: 0, officialPoints: 25, players: [out] }),
      side({ officialPoints: 12, players: [finished] }), 'final'))
      .toEqual({ modelVersion: 'normal-v3', status: 'final', probabilities: [1, 0] });
    expect(result(side({ projectedPoints: 25, officialPoints: 25, players: [out] }), side(), 'live'))
      .toEqual(result(side({ projectedPoints: 25, officialPoints: 25, players: [] }), side(), 'live'));
  });

  it('retains source-readiness checks for Out starters instead of creating observed zeros', () => {
    const out = player({ expectedRemainingPointsZero: true, baselinePoints: null, projectionQuality: 'missing-baseline' });
    expectUnavailable(result(side({ players: [{ ...out, officialPoints: 1 }] })), 'invalid-input');
    expectUnavailable(result(side({ players: [{ ...out, phase: 'unknown' }] })), 'unknown-game-state');
    const liveOut = { ...out, phase: 'q3' as const, remainingFraction: 0.25 };
    expectUnavailable(result(side({ players: [{ ...liveOut, officialPoints: null }] }), side(), 'live'), 'missing-official-points');
    expectUnavailable(result(side({ players: [{ ...liveOut, remainingFraction: null }] }), side(), 'live'), 'unknown-game-state');
    expectUnavailable(result(side({ players: [{ ...out, baselinePoints: NaN }] })), 'invalid-input');
    expectUnavailable(result(side({ players: [{ ...out, expectedRemainingPointsZero: 'true' as unknown as boolean }] })), 'invalid-input');
  });

  it('does not invent a final result when all unresolved starters on both sides are Out', () => {
    const outSide = side({ projectedPoints: 0, players: [player({ expectedRemainingPointsZero: true })] });
    expectUnavailable(result(outSide, outSide), 'unknown-game-state');
    const liveOutSide = { ...outSide, officialPoints: 7, projectedPoints: 7,
      players: [player({ phase: 'q4', remainingFraction: 0.1, officialPoints: 7, expectedRemainingPointsZero: true })] };
    expectUnavailable(result(liveOutSide, { ...liveOutSide, officialPoints: 10, projectedPoints: 10 }, 'live'), 'unknown-game-state');
  });

  it('does not claim certainty in a nonfinal matchup even at an overwhelming advantage', () => {
    const p = probability(result(side({ projectedPoints: 10_000 })));
    expect(p).toBeGreaterThan(0.999);
    expect(p).toBeLessThan(1);
    expect(probability(result(side({ projectedPoints: -10_000 })))).toBeGreaterThan(0);
  });

  it('is deterministic and does not mutate its source observations', () => {
    const input: WinProbabilityInput = { status: 'upcoming', sides: [side({ projectedPoints: 27 }), side()] };
    const before = structuredClone(input);
    const first = calculateWinProbability(input);
    for (let index = 0; index < 10; index++) expect(calculateWinProbability(input)).toEqual(first);
    expect(input).toEqual(before);
  });

  it('treats an explicit empty starting lineup as zero variance, not a missing lineup', () => {
    const p = probability(result(side({ projectedPoints: 0, players: [] })));
    expect(p).toBeLessThan(0.5);
    expect(p).toBeGreaterThan(0);
  });

  it('gives real byes no uncertainty, even without a baseline', () => {
    const bye = player({ phase: 'bye', baselinePoints: null, projectionQuality: 'missing-baseline' });
    expect(result(side({ projectedPoints: 0, players: [bye] })))
      .toEqual(result(side({ projectedPoints: 0, players: [] })));
  });

  it('does not use byes or empty slots alone as evidence of completed fantasy results', () => {
    expectUnavailable(result(side({ projectedPoints: 0, players: [] }), side({ projectedPoints: 0, players: [] })), 'unknown-game-state');
    const bye = player({ phase: 'bye', baselinePoints: null });
    expectUnavailable(result(side({ players: [bye] }), side({ players: [bye] })), 'unknown-game-state');
  });

  it('uses official team totals for finals, including a commissioner adjustment reversing the player sum', () => {
    const left = side({ officialPoints: 3, projectedPoints: null, players: [player({ phase: 'final', officialPoints: 50, baselinePoints: null })] });
    const right = side({ officialPoints: 10, projectedPoints: null, players: [player({ phase: 'final', officialPoints: 2, baselinePoints: null })] });
    expect(result(left, right, 'final')).toEqual({ modelVersion: 'normal-v3', status: 'final', probabilities: [0, 1] });
    expect(result(right, left, 'final')).toEqual({ modelVersion: 'normal-v3', status: 'final', probabilities: [1, 0] });
  });

  it('labels an official final tie explicitly instead of a fabricated 50% chance', () => {
    const finished = side({ officialPoints: 24.6, players: [player({ phase: 'final' })] });
    expect(result(finished, finished, 'final')).toEqual({ modelVersion: 'normal-v3', status: 'tie', probabilities: [0, 0] });
  });

  it('requires final game evidence, both official totals, and an available lineup before final results', () => {
    const finished = side({ players: [player({ phase: 'final' })] });
    expectUnavailable(result(finished, side(), 'final'), 'unknown-game-state');
    expectUnavailable(result({ ...finished, officialPoints: null }, finished, 'final'), 'missing-official-points');
    expectUnavailable(result({ ...finished, lineupAvailable: false }, finished, 'final'), 'missing-lineup');
  });

  it('gives completed players zero uncertainty while another game is still live', () => {
    const finished = player({ phase: 'final', baselinePoints: null, officialPoints: 0, projectionQuality: 'official-final' });
    expect(result(side({ projectedPoints: 0, players: [finished] }), side(), 'live'))
      .toEqual(result(side({ projectedPoints: 0, players: [] }), side(), 'live'));
  });

  it('does not treat an untrusted retained score for a final player as official', () => {
    expectUnavailable(result(side({ players: [player({ phase: 'final', projectionQuality: 'retained-prior' })] }), side(), 'live'), 'missing-official-points');
  });

  it('permits absent pregame official totals but requires them once a team has started', () => {
    expect(probability(result(side({ officialPoints: null })))).toBe(0.5);
    const livePlayer = player({ phase: 'q2', remainingFraction: 0.5, projectionQuality: 'estimated' });
    expectUnavailable(result(side({ officialPoints: null, players: [livePlayer] }), side(), 'live'), 'missing-official-points');
    expectUnavailable(result(side({ players: [{ ...livePlayer, officialPoints: null }] }), side(), 'live'), 'missing-official-points');
  });

  it.each(['missing-baseline', 'retained-prior', 'unavailable'] as const)('withholds a result for %s player projection quality', (projectionQuality) => {
    expectUnavailable(result(side({ players: [player({ projectionQuality })] })), 'missing-projection');
  });

  it('withholds estimates for missing baselines, totals, or an unavailable opponent lineup', () => {
    expectUnavailable(result(side({ players: [player({ baselinePoints: null })] })), 'missing-projection');
    expectUnavailable(result(side({ projectedPoints: null })), 'missing-projection');
    expectUnavailable(result(side(), side({ lineupAvailable: false, players: [] })), 'missing-lineup');
  });

  it.each(['unknown', 'postponed', 'suspended'] as const)('withholds estimates for %s game context', (phase) => {
    expectUnavailable(result(side({ players: [player({ phase })] }), side(), 'live'), 'unknown-game-state');
  });

  it('rejects unknown or inconsistent matchup phase and missing live clock evidence', () => {
    expectUnavailable(result(side(), side(), 'unknown'), 'unknown-game-state');
    const livePlayer = player({ phase: 'q1', projectionQuality: 'estimated' });
    expectUnavailable(result(side({ players: [livePlayer] })), 'unknown-game-state');
    expectUnavailable(result(side({ players: [{ ...livePlayer, remainingFraction: null }] }), side(), 'live'), 'unknown-game-state');
  });

  it('rejects unmatched or multi-team matchup shapes', () => {
    for (const sides of [[], [side()], [side(), side(), side()]]) {
      expectUnavailable(calculateWinProbability({ status: 'upcoming', sides }), 'invalid-matchup');
    }
  });

  it.each([NaN, Infinity, -Infinity])('rejects nonfinite values (%s) without throwing', (invalid) => {
    expectUnavailable(result(side({ officialPoints: invalid })), 'invalid-input');
    expectUnavailable(result(side({ projectedPoints: invalid })), 'invalid-input');
    expectUnavailable(result(side({ players: [player({ baselinePoints: invalid })] })), 'invalid-input');
    expectUnavailable(result(side({ players: [player({ officialPoints: invalid })] })), 'invalid-input');
    expectUnavailable(result(side({ players: [player({ remainingFraction: invalid })] })), 'invalid-input');
  });

  it('rejects out-of-range fractions and arithmetic overflow', () => {
    expectUnavailable(result(side({ players: [player({ remainingFraction: -0.1 })] })), 'invalid-input');
    expectUnavailable(result(side({ players: [player({ remainingFraction: 1.1 })] })), 'invalid-input');
    expectUnavailable(result(side({ players: [player({ baselinePoints: Number.MAX_VALUE })] })), 'invalid-input');
    expectUnavailable(result(side({ projectedPoints: Number.MAX_VALUE }), side({ projectedPoints: -Number.MAX_VALUE })), 'invalid-input');
  });
});
