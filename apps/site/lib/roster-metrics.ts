import type { RosterTeam } from './types';
import { numberOrNull, type SleeperMatchup } from './transform';

export type RosterHistoryBoundaryInput = Readonly<{
  selectedWeek: number;
  activeWeek: number | null;
  lastScoredWeek: number | null;
  lifecycle: 'preseason' | 'active' | 'complete';
}>;

type RosterStandingsCandidate = Readonly<{
  id: number;
  name: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
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

function sourcePointsHundredths(row: SleeperMatchup): number | null {
  const points = numberOrNull(row.custom_points) ?? numberOrNull(row.points);
  if (points === null) return null;
  const hundredths = Math.round(points * 100);
  return Number.isSafeInteger(hundredths) ? hundredths : null;
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
  const totals = new Map<number, number>();
  for (const rosterId of rosterIds) {
    const scoresHundredths: number[] = [];
    for (let index = 0; index < requiredWeeks; index += 1) {
      const matches = (history[index] ?? []).filter((row) => row.roster_id === rosterId);
      const score = matches.length === 1 ? sourcePointsHundredths(matches[0]) : null;
      if (score === null) break;
      scoresHundredths.push(score);
    }
    if (scoresHundredths.length === requiredWeeks) {
      totals.set(rosterId, scoresHundredths.reduce((sum, value) => sum + value, 0));
    }
  }
  const ranks = totals.size === rosterIds.length ? descendingCompetitionRanks(totals) : new Map<number, number>();
  return new Map([...totals].map(([id, total]) => [
    id,
    { ppg: total / (requiredWeeks * 100), rank: ranks.get(id) ?? null },
  ]));
}

function compareRosterNames(a: Pick<RosterStandingsCandidate, 'id' | 'name'>, b: Pick<RosterStandingsCandidate, 'id' | 'name'>): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id - b.id;
}

/** Rosters standings use only record, Points For, name, and finally roster ID. */
export function compareRosterStandings(a: RosterStandingsCandidate, b: RosterStandingsCandidate): number {
  const gamesA = a.wins + a.losses + a.ties;
  const gamesB = b.wins + b.losses + b.ties;
  const rateA = gamesA ? (a.wins + a.ties * 0.5) / gamesA : 0;
  const rateB = gamesB ? (b.wins + b.ties * 0.5) / gamesB : 0;
  return rateB - rateA || b.pointsFor - a.pointsFor || compareRosterNames(a, b);
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
      : compareRosterNames(a, b);
  });
}
