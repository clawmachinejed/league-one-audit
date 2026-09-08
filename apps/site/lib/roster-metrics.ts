import type { RosterTeam } from './types';
import { numberOrNull, type PlayerCatalog, type SleeperMatchup } from './transform';

export type RosterHistoryBoundaryInput = Readonly<{
  selectedWeek: number;
  currentWeek: number;
  activeWeek: number | null;
  lastScoredWeek: number | null;
  lifecycle: 'preseason' | 'active' | 'complete';
}>;

export type PlayerPpgMetric = Readonly<{ ppg: number; positionRank: number }>;

function validWeek(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value >= 1 && value <= 18;
}

/** The selected week never reads a later completed score, even when browsing future lineups. */
export function rosterHistoryBoundary(input: RosterHistoryBoundaryInput): number {
  if (input.lifecycle === 'preseason') return 0;
  if (input.lifecycle === 'complete') return input.selectedWeek;
  if (validWeek(input.activeWeek)) return Math.max(0, Math.min(input.selectedWeek, input.activeWeek - 1));
  if (validWeek(input.lastScoredWeek)) return Math.min(input.selectedWeek, input.lastScoredWeek);
  return 0;
}

function sourcePoints(row: SleeperMatchup): number | null {
  return numberOrNull(row.custom_points) ?? numberOrNull(row.points);
}

function average(values: readonly number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function descendingCompetitionRanks(values: ReadonlyMap<string | number, number>): Map<string | number, number> {
  const ordered = [...values.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const ranks = new Map<string | number, number>();
  let previous: number | null = null;
  let rank = 0;
  ordered.forEach(([id, value], index) => {
    if (previous === null || value !== previous) rank = index + 1;
    ranks.set(id, rank);
    previous = value;
  });
  return ranks;
}

/** Average official Sleeper weekly team totals. A finite zero remains a scored value. */
export function calculateTeamPpg(history: readonly (readonly SleeperMatchup[])[]): Map<number, Readonly<{ ppg: number; rank: number }>> {
  const values = new Map<number, number[]>();
  for (const rows of history) {
    const seen = new Set<number>();
    for (const row of rows) {
      if (seen.has(row.roster_id)) continue;
      seen.add(row.roster_id);
      const points = sourcePoints(row);
      if (points === null) continue;
      const scores = values.get(row.roster_id) ?? [];
      scores.push(points);
      values.set(row.roster_id, scores);
    }
  }
  const averages = new Map<number, number>();
  for (const [id, scores] of values) {
    const ppg = average(scores);
    if (ppg !== null) averages.set(id, ppg);
  }
  const ranks = descendingCompetitionRanks(averages);
  return new Map([...averages].map(([id, ppg]) => [id, { ppg, rank: ranks.get(id)! }]));
}

/** Average official Sleeper weekly player totals, ranked only against the same fantasy position. */
export function calculatePlayerPpg(
  history: readonly (readonly SleeperMatchup[])[],
  catalog: PlayerCatalog,
): Map<string, PlayerPpgMetric> {
  const values = new Map<string, number[]>();
  for (const rows of history) {
    const weekValues = new Map<string, number>();
    for (const row of rows) {
      for (const [id, rawPoints] of Object.entries(row.players_points ?? {})) {
        const points = numberOrNull(rawPoints);
        if (points !== null && !weekValues.has(id)) weekValues.set(id, points);
      }
    }
    for (const [id, points] of weekValues) {
      const scores = values.get(id) ?? [];
      scores.push(points);
      values.set(id, scores);
    }
  }
  const averages = new Map<string, number>();
  for (const [id, scores] of values) {
    const ppg = average(scores);
    if (ppg !== null) averages.set(id, ppg);
  }
  const byPosition = new Map<string, Map<string, number>>();
  for (const [id, ppg] of averages) {
    const position = catalog[id]?.position?.trim().toUpperCase();
    if (!position) continue;
    const peers = byPosition.get(position) ?? new Map<string, number>();
    peers.set(id, ppg);
    byPosition.set(position, peers);
  }
  const result = new Map<string, PlayerPpgMetric>();
  for (const peers of byPosition.values()) {
    const ranks = descendingCompetitionRanks(peers);
    for (const [id, ppg] of peers) result.set(id, { ppg, positionRank: ranks.get(id)! });
  }
  return result;
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
