import type { Matchup, Team } from "@l1/contracts";
export function rivalrySpice(a: Team, b: Team, history: Matchup[]): number {
  const games = history.filter(
    (m) =>
      (m.home_team.id === a.id && m.away_team.id === b.id) ||
      (m.home_team.id === b.id && m.away_team.id === a.id),
  );
  if (games.length === 0) return 10;
  const total = games.reduce((acc, g) => {
    const margin = Math.abs(g.home_score - g.away_score);
    const closeness = Math.max(0, 30 - margin);
    return acc + closeness;
  }, 0);
  return Math.min(100, 20 + total / games.length);
}
