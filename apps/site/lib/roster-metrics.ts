import type { RosterTeam } from './types';
import { numberOrNull, type SleeperMatchup } from './transform';

export type RosterHistoryBoundaryInput = Readonly<{
  selectedWeek: number;
  activeWeek: number | null;
  lastScoredWeek: number | null;
  lifecycle: 'preseason' | 'active' | 'complete';
}>;

function validWeek(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value >= 1 && value <= 18;
}

/** Never cross either the selected-week or authoritative completed-score boundary. */
export function rosterHistoryBoundary(input: RosterHistoryBoundaryInput): number | null {
  if (input.lifecycle === 'preseason') return 0;
  if (input.lifecycle === 'complete') {
    return validWeek(input.lastScoredWeek) ? Math.min(input.selectedWeek, input.lastScoredWeek) : null;
  }
  if (validWeek(input.activeWeek)) return Math.max(0, Math.min(input.selectedWeek, input.activeWeek - 1));
  return validWeek(input.lastScoredWeek) ? Math.min(input.selectedWeek, input.lastScoredWeek) : null;
}

function sourcePoints(row: SleeperMatchup): number | null {
  return numberOrNull(row.custom_points) ?? numberOrNull(row.points);
}

function descendingCompetitionRanks(values: ReadonlyMap<number, number>): Map<number, number> {
  const ordered = [...values.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const ranks = new Map<number, number>();
  let previous: number | null = null;
  let rank = 0;
  ordered.forEach(([id, value], index) => {
    if (previous === null || value !== previous) rank = index + 1;
    ranks.set(id, rank);
    previous = value;
  });
  return ranks;
}

/**
 * Average official team totals only when every required week has exactly one valid row.
 * A finite zero is a score. Missing/malformed history invalidates only that team's average;
 * ranks are emitted only when every expected team has a provable average.
 */
export function calculateTeamPpg(
  history: readonly (readonly SleeperMatchup[] | null)[],
  requiredWeeks: number,
  rosterIds: readonly number[],
): Map<number, Readonly<{ ppg: number; rank: number | null }>> {
  if (requiredWeeks < 1 || history.length < requiredWeeks) return new Map();
  const averages = new Map<number, number>();
  for (const rosterId of rosterIds) {
    const scores: number[] = [];
    for (let index = 0; index < requiredWeeks; index += 1) {
      const matches = (history[index] ?? []).filter((row) => row.roster_id === rosterId);
      const score = matches.length === 1 ? sourcePoints(matches[0]) : null;
      if (score === null) break;
      scores.push(score);
    }
    if (scores.length === requiredWeeks) {
      averages.set(rosterId, scores.reduce((sum, value) => sum + value, 0) / requiredWeeks);
    }
  }
  const ranks = averages.size === rosterIds.length ? descendingCompetitionRanks(averages) : new Map<number, number>();
  return new Map([...averages].map(([id, ppg]) => [id, { ppg, rank: ranks.get(id) ?? null }]));
}

export function orderRosterTeams(teams: readonly RosterTeam[], selected: number | null): RosterTeam[] {
  const completeStandings = teams.length > 0 && teams.every((team) => Number.isInteger(team.standingsRank)
    && team.standingsRank !== null && team.standingsRank > 0)
    && new Set(teams.map((team) => team.standingsRank)).size === teams.length;
  return [...teams].sort((a, b) => {
    if (a.id === selected) return b.id === selected ? 0 : -1;
    if (b.id === selected) return 1;
    return completeStandings
      ? a.standingsRank! - b.standingsRank!
      : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id - b.id;
  });
}
