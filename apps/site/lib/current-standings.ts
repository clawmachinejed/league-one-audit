/** Current official standings, separate from immutable exact-week matchup snapshots. */
export type CurrentStandings = {
  leagueId: string;
  season: string;
  playoffTeams: number | null;
  places: Record<number, number>;
};
