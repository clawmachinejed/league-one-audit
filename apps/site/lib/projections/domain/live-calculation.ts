import type { NflGamePhase, ProjectionPointQuality } from './contracts';

export type LiveProjectionKind = 'offense' | 'kicker' | 'defense';

export type LiveProjectionGameState = Readonly<{
  phase: NflGamePhase;
  remainingFraction: number | null;
}>;

export type PregameProjectionBaseline = Readonly<{
  points: number;
  quality: 'complete' | 'missing';
}>;

export type LiveProjectionInput = Readonly<{
  kind: LiveProjectionKind;
  gameState: LiveProjectionGameState;
  baseline: PregameProjectionBaseline | null;
  officialPoints: number | null;
  priorProjectedPoints?: number | null;
}>;

export type LiveProjectionResult = Readonly<{
  projectedPoints: number | null;
  quality: ProjectionPointQuality;
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
 * The sole clock-v1 calculation. It performs no fetching, persistence,
 * presentation rounding, or provider-specific interpretation.
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
