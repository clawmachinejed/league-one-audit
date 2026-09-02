import type { NflGamePhase } from './game-time';

export type LiveProjectionKind = 'offense' | 'kicker' | 'defense';

export type LiveProjectionGameState = Readonly<{
  phase: NflGamePhase;
  remainingFraction: number | null;
}>;

export type PregameProjectionBaseline = Readonly<{
  /** Full-precision fantasy points calculated from the frozen pregame stat line. */
  points: number;
  /** Missing source data is deliberately represented by a zero-point baseline. */
  quality: 'complete' | 'missing';
}>;

export type LiveProjectionQuality =
  | 'estimated'
  | 'official-final'
  | 'pregame-baseline'
  | 'defense-baseline-held'
  | 'missing-baseline'
  | 'retained-prior'
  | 'unavailable';

export type LiveProjectionResult = Readonly<{
  /** Null means the caller must retain its last published aggregate rather than publish a partial result. */
  projectedPoints: number | null;
  quality: LiveProjectionQuality;
}>;

export type LiveProjectionInput = Readonly<{
  kind: LiveProjectionKind;
  gameState: LiveProjectionGameState;
  baseline: PregameProjectionBaseline | null;
  /** Sleeper's official fantasy points through the current observation. */
  officialPoints: number | null;
  /** The last complete value published for this player, if one exists. */
  priorProjectedPoints?: number | null;
}>;

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isLivePhase(phase: NflGamePhase): boolean {
  return phase === 'q1' || phase === 'q2' || phase === 'halftime'
    || phase === 'q3' || phase === 'q4' || phase === 'overtime';
}

function usableBaseline(baseline: PregameProjectionBaseline | null): PregameProjectionBaseline {
  if (!baseline || !finite(baseline.points) || baseline.quality === 'missing') {
    return { points: 0, quality: 'missing' };
  }
  return baseline;
}

function baselineResult(baseline: PregameProjectionBaseline | null): LiveProjectionResult {
  const usable = usableBaseline(baseline);
  return {
    projectedPoints: usable.points,
    quality: usable.quality === 'missing' ? 'missing-baseline' : 'pregame-baseline',
  };
}

function retainPriorOrBaseline(input: LiveProjectionInput): LiveProjectionResult {
  if (finite(input.priorProjectedPoints)) {
    return { projectedPoints: input.priorProjectedPoints, quality: 'retained-prior' };
  }
  return baselineResult(input.baseline);
}

function retainPriorOrUnavailable(input: LiveProjectionInput): LiveProjectionResult {
  if (finite(input.priorProjectedPoints)) {
    return { projectedPoints: input.priorProjectedPoints, quality: 'retained-prior' };
  }
  return { projectedPoints: null, quality: 'unavailable' };
}

/**
 * Applies the clock-v1 projection policy without fetching, persistence, rounding,
 * or presentation behavior. The caller must provide observations that belong to
 * the same synchronized calculation run.
 */
export function calculateLiveProjection(input: LiveProjectionInput): LiveProjectionResult {
  const { gameState } = input;

  if (gameState.phase === 'pregame') return baselineResult(input.baseline);

  if (gameState.phase === 'final') {
    return finite(input.officialPoints)
      ? { projectedPoints: input.officialPoints, quality: 'official-final' }
      : retainPriorOrUnavailable(input);
  }

  if (!isLivePhase(gameState.phase)) return retainPriorOrBaseline(input);

  const remainingFraction = gameState.remainingFraction;
  if (!finite(remainingFraction) || remainingFraction < 0 || remainingFraction > 1) {
    return retainPriorOrBaseline(input);
  }

  // Sleeper's live D/ST points can contain provisional points-allowed scoring.
  // Combining them with a partial baseline would double-count that component.
  if (input.kind === 'defense') {
    const baseline = baselineResult(input.baseline);
    return baseline.quality === 'missing-baseline'
      ? baseline
      : { projectedPoints: baseline.projectedPoints, quality: 'defense-baseline-held' };
  }

  if (!finite(input.officialPoints)) return retainPriorOrUnavailable(input);

  const baseline = usableBaseline(input.baseline);
  return {
    projectedPoints: input.officialPoints + (baseline.points * remainingFraction),
    quality: baseline.quality === 'missing' ? 'missing-baseline' : 'estimated',
  };
}
