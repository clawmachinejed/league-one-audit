import { Matchup, StandingsRow } from "@l1/contracts";
export interface StandingsRepo {
  load(season: number): Promise<StandingsRow[]>;
}
export interface ScheduleRepo {
  load(season: number): Promise<Matchup[]>;
}
