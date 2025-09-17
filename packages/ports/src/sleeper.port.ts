import { Matchup, StandingsRow, Team } from "@l1/contracts";
export interface SleeperRepository {
  getTeams(): Promise<Team[]>;
  getStandings(season: number): Promise<StandingsRow[]>;
  getSchedule(season: number): Promise<Matchup[]>;
}
