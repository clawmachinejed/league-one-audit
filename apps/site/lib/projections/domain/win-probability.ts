import type { MatchupStatus, NflGamePhase, ProjectionPointQuality } from './contracts';
import type { LiveProjectionKind } from './live-calculation';

export const WIN_PROBABILITY_MODEL_VERSION = 'normal-v2' as const;

export type WinProbabilityPlayerInput = Readonly<{
  position: string;
  kind: LiveProjectionKind;
  phase: NflGamePhase | 'bye';
  remainingFraction: number | null;
  baselinePoints: number | null;
  projectionQuality: ProjectionPointQuality;
  officialPoints: number | null;
  /** Caller-proved requested-period Out designation. Never inferred from a zero baseline. */
  expectedRemainingPointsZero?: boolean;
}>;

export type WinProbabilitySideInput = Readonly<{
  officialPoints: number | null;
  /** Canonical projected finish, including any evidenced official team adjustment. */
  projectedPoints: number | null;
  lineupAvailable: boolean;
  /** Occupied starting slots only. An explicitly empty lineup is valid. */
  players: readonly WinProbabilityPlayerInput[];
}>;

export type WinProbabilityInput = Readonly<{
  status: MatchupStatus;
  sides: readonly WinProbabilitySideInput[];
}>;

export type WinProbabilityUnavailableReason =
  | 'invalid-matchup'
  | 'missing-lineup'
  | 'missing-projection'
  | 'missing-official-points'
  | 'unknown-game-state'
  | 'invalid-input';

type ModelIdentity = Readonly<{ modelVersion: typeof WIN_PROBABILITY_MODEL_VERSION }>;

export type WinProbabilityResult = ModelIdentity & (
  | Readonly<{ status: 'estimated' | 'final'; probabilities: readonly [number, number] }>
  | Readonly<{ status: 'tie'; probabilities: readonly [0, 0] }>
  | Readonly<{ status: 'unavailable'; reason: WinProbabilityUnavailableReason }>
);

// Uncalibrated position assumptions retained from normal-v1, in fantasy-point units. Errors
// are treated as independent. Scoring-scaled baseline magnitudes affect SD;
// floors are not a fitted model of every league's scoring rules or correlations.
const OFFENSE_UNCERTAINTY: Readonly<Record<string, Readonly<{ floor: number; ratio: number }>>> = {
  QB: { floor: 5, ratio: 0.45 },
  RB: { floor: 4, ratio: 0.75 },
  WR: { floor: 4, ratio: 0.80 },
  TE: { floor: 3, ratio: 0.85 },
};
const OTHER_OFFENSE_UNCERTAINTY = { floor: 4, ratio: 0.80 } as const;
const KICKER_UNCERTAINTY = { floor: 3, ratio: 0.60 } as const;
const DEFENSE_UNCERTAINTY = { floor: 5, ratio: 0.90 } as const;
const LIVE_VARIANCE_FLOOR = 0.05;
const OVERTIME_VARIANCE_FLOOR = 0.10;
const PROBABILITY_PRECISION = 1_000_000;

function finite(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteOrNull(value: number | null): boolean {
  return value === null || finite(value);
}

function isLive(phase: WinProbabilityPlayerInput['phase']): boolean {
  return phase === 'q1' || phase === 'q2' || phase === 'halftime'
    || phase === 'q3' || phase === 'q4' || phase === 'overtime';
}

function settled(player: WinProbabilityPlayerInput): boolean {
  return player.phase === 'final' || player.phase === 'bye';
}

function unavailable(reason: WinProbabilityUnavailableReason): WinProbabilityResult {
  return { modelVersion: WIN_PROBABILITY_MODEL_VERSION, status: 'unavailable', reason };
}

function playerVariance(player: WinProbabilityPlayerInput): number | WinProbabilityUnavailableReason {
  if (player.phase === 'bye') return 0;
  if (player.phase === 'final') {
    return finite(player.officialPoints) && player.projectionQuality === 'official-final'
      ? 0
      : 'missing-official-points';
  }
  if (player.phase !== 'pregame' && !isLive(player.phase)) return 'unknown-game-state';
  if (player.expectedRemainingPointsZero === true) {
    if (player.phase === 'pregame') {
      // A pregame expectation may be zero without an actual observation. It
      // must not silently erase a contradictory nonzero observed score.
      if (finite(player.officialPoints) && player.officialPoints !== 0) return 'invalid-input';
    } else {
      if (!finite(player.remainingFraction)) return 'unknown-game-state';
      if (!finite(player.officialPoints)) return 'missing-official-points';
    }
    // Out means no further points are expected. Live actuals, including points
    // scored before an injury, remain part of the caller's canonical mean.
    return 0;
  }
  if (!finite(player.baselinePoints)) return 'missing-projection';
  const expectedQuality = player.phase === 'pregame'
    ? 'pregame-baseline'
    : player.kind === 'defense' ? 'defense-baseline-held' : 'estimated';
  if (player.projectionQuality !== expectedQuality) return 'missing-projection';
  if (isLive(player.phase)) {
    if (!finite(player.remainingFraction)) return 'unknown-game-state';
    if (!finite(player.officialPoints)) return 'missing-official-points';
  }
  const assumption = player.kind === 'defense'
    ? DEFENSE_UNCERTAINTY
    : player.kind === 'kicker'
      ? KICKER_UNCERTAINTY
      : OFFENSE_UNCERTAINTY[player.position.trim().toUpperCase()] ?? OTHER_OFFENSE_UNCERTAINTY;
  const sigma = Math.max(assumption.floor, Math.abs(player.baselinePoints) * assumption.ratio);
  // D/ST's clock-v1 mean holds the baseline until final; shrinking its variance
  // around that mean late in a game would create unjustified confidence.
  const fraction = player.phase === 'pregame' || player.kind === 'defense'
    ? 1
    : Math.max(
      player.remainingFraction!,
      player.phase === 'overtime' ? OVERTIME_VARIANCE_FLOOR : LIVE_VARIANCE_FLOOR,
    );
  return sigma * sigma * fraction;
}

/** Deterministic normal CDF via the standard five-term erf approximation. */
function normalCdf(z: number): number {
  if (z === 0) return 0.5;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const tail = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z > 0 ? 1 - tail / 2 : tail / 2;
}

/**
 * Estimates a pair's win chances without fetching, scoring or changing results.
 * The caller supplies the same canonical projected finishes shown on the card.
 * A continuous normal approximation does not model nonfinal exact-score ties.
 */
export function calculateWinProbability(input: WinProbabilityInput): WinProbabilityResult {
  if (input.sides.length !== 2) return unavailable('invalid-matchup');
  if (input.sides.some((side) => !side.lineupAvailable)) return unavailable('missing-lineup');
  if (input.sides.some((side) => !finiteOrNull(side.officialPoints) || !finiteOrNull(side.projectedPoints)
    || side.players.some((player) => !finiteOrNull(player.officialPoints)
      || !finiteOrNull(player.baselinePoints) || !finiteOrNull(player.remainingFraction)
      || (finite(player.remainingFraction) && (player.remainingFraction < 0 || player.remainingFraction > 1))
      || typeof player.position !== 'string' || player.position.trim().length === 0
      || (player.expectedRemainingPointsZero !== undefined && typeof player.expectedRemainingPointsZero !== 'boolean')
      || !['offense', 'kicker', 'defense'].includes(player.kind)))) {
    return unavailable('invalid-input');
  }

  const [left, right] = input.sides;
  const players = input.sides.flatMap((side) => side.players);
  if (input.status === 'final') {
    if (!players.every(settled)) return unavailable('unknown-game-state');
    if (!finite(left.officialPoints) || !finite(right.officialPoints)) return unavailable('missing-official-points');
    if (left.officialPoints === right.officialPoints) {
      return { modelVersion: WIN_PROBABILITY_MODEL_VERSION, status: 'tie', probabilities: [0, 0] };
    }
    return {
      modelVersion: WIN_PROBABILITY_MODEL_VERSION,
      status: 'final',
      probabilities: left.officialPoints > right.officialPoints ? [1, 0] : [0, 1],
    };
  }
  if (input.status !== 'upcoming' && input.status !== 'live') return unavailable('unknown-game-state');
  if (players.some((player) => player.phase !== 'pregame' && !settled(player) && !isLive(player.phase))
    || (input.status === 'upcoming' && players.some((player) => isLive(player.phase) || player.phase === 'final'))) {
    return unavailable('unknown-game-state');
  }
  if (!finite(left.projectedPoints) || !finite(right.projectedPoints)) return unavailable('missing-projection');
  if (input.sides.some((side) => side.players.some((player) => isLive(player.phase) || player.phase === 'final')
    && !finite(side.officialPoints))) return unavailable('missing-official-points');

  let variance = 0;
  for (const player of players) {
    const contribution = playerVariance(player);
    if (typeof contribution === 'string') return unavailable(contribution);
    variance += contribution;
  }
  if (!Number.isFinite(variance)) return unavailable('invalid-input');
  // All Out/byes/empty slots cannot establish matchup finality on their own.
  if (variance <= 0) return unavailable('unknown-game-state');
  const meanDifference = left.projectedPoints - right.projectedPoints;
  if (!Number.isFinite(meanDifference)) return unavailable('invalid-input');
  const probability = Math.min(1 - 1 / PROBABILITY_PRECISION, Math.max(
    1 / PROBABILITY_PRECISION,
    Math.round(normalCdf(meanDifference / Math.sqrt(variance)) * PROBABILITY_PRECISION) / PROBABILITY_PRECISION,
  ));
  return {
    modelVersion: WIN_PROBABILITY_MODEL_VERSION,
    status: 'estimated',
    probabilities: [probability, Math.round((1 - probability) * PROBABILITY_PRECISION) / PROBABILITY_PRECISION],
  };
}
