import type { Matchup } from '../lib/types';

interface WinChanceDisplay {
  status: 'estimated' | 'final' | 'tie' | 'unavailable';
  label: string;
  values: readonly [string, string];
  description: string;
}

const unavailable: WinChanceDisplay = {
  status: 'unavailable', label: 'Estimated win chance', values: ['—', '—'],
  description: 'Estimated win chance unavailable.',
};

/** Present stored estimates only; player projections cannot reconstruct live odds. */
export function matchupWinChance(matchup: Matchup): WinChanceDisplay {
  const [left, right] = matchup.sides;
  if (matchup.sides.length !== 2 || !left || !right || left.team.id === right.team.id) return unavailable;

  // Legacy final snapshots already carry the authoritative result. This fallback
  // needs no prediction model and never supplies odds for a live matchup.
  if (matchup.status === 'final') {
    if (typeof left.points !== 'number' || !Number.isFinite(left.points)
      || typeof right.points !== 'number' || !Number.isFinite(right.points)) return unavailable;
    if (left.points === right.points) {
      return { status: 'tie', label: 'Final', values: ['Tie', 'Tie'], description: 'Final result: tied.' };
    }
    const leftWon = left.points > right.points;
    return { status: 'final', label: 'Final win chance', values: leftWon ? ['100%', '0%'] : ['0%', '100%'],
      description: `Final win chance: ${left.team.name} ${leftWon ? '100%' : '0%'}; ${right.team.name} ${leftWon ? '0%' : '100%'}.` };
  }

  const estimate = matchup.winProbability;
  if (estimate?.modelVersion !== 'normal-v1' || estimate.status !== 'estimated') return unavailable;
  const ordered = [...estimate.teams].sort((a, b) => a.teamId - b.teamId);
  if (ordered.length !== 2 || ordered[0].teamId === ordered[1].teamId
    || ordered.some(team => !Number.isFinite(team.probability) || team.probability < 0 || team.probability > 1)
    || Math.abs(ordered[0].probability + ordered[1].probability - 1) > 1e-9
    || !ordered.some(team => team.teamId === left.team.id) || !ordered.some(team => team.teamId === right.team.id)) return unavailable;

  // Round the pair once in stable identity order. Side swaps must not change a
  // team's display, and ordinary rounded percentages must still add up to 100.
  const firstPercent = Math.round(ordered[0].probability * 100);
  const values = new Map(ordered.map((team, index) => [team.teamId,
    team.probability < 0.01 ? '<1%' : team.probability > 0.99 ? '>99%'
      : `${index === 0 ? firstPercent : 100 - firstPercent}%`,
  ]));
  const leftValue = values.get(left.team.id)!;
  const rightValue = values.get(right.team.id)!;
  const spoken = (value: string) => value.replace('<', 'less than ').replace('>', 'greater than ');
  return { status: 'estimated', label: 'Estimated win chance', values: [leftValue, rightValue],
    description: `Estimated win chance: ${left.team.name} ${spoken(leftValue)}; ${right.team.name} ${spoken(rightValue)}.` };
}
