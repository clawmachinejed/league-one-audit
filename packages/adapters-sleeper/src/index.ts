import type { SleeperRepository } from "@l1/ports";
import type { Matchup, StandingsRow, Team } from "@l1/contracts";
import { seedSchedule, seedStandings, seedTeams } from "@l1/contracts";

export function createSeedSleeperRepo(): SleeperRepository {
  return {
    async getTeams(): Promise<Team[]> {
      return seedTeams;
    },
    async getStandings(_season: number): Promise<StandingsRow[]> {
      return seedStandings;
    },
    async getSchedule(_season: number): Promise<Matchup[]> {
      return seedSchedule;
    },
  };
}
