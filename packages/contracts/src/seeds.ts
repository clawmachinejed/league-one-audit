import { DateTime } from "luxon";
import { Team, Matchup, StandingsRow, BenchStat } from "./schemas";

const tz = "America/New_York";
const season = new Date().getFullYear();

export const seedTeams: Team[] = [
  { id: "t1", name: "Anchorage Narwhals", owner: "Al" },
  { id: "t2", name: "Boulder Bighorns", owner: "Bea" },
  { id: "t3", name: "Columbus Krakens", owner: "Cam" },
  { id: "t4", name: "Denton Dragons", owner: "Dee" },
];

export const seedStandings: StandingsRow[] = seedTeams.map((t, i) => ({
  team: t,
  wins: i,
  losses: seedTeams.length - 1 - i,
  points_for: 100 * (i + 1),
  points_against: 100 * (seedTeams.length - i),
}));

export const seedSchedule: Matchup[] = [
  {
    week: 1,
    matchup_id: 1,
    home_team: seedTeams[0],
    away_team: seedTeams[1],
    home_score: 98.2,
    away_score: 102.7,
    start:
      DateTime.fromObject(
        { year: season, month: 9, day: 5, hour: 13 },
        { zone: tz },
      ).toISO() ?? new Date().toISOString(),
    end:
      DateTime.fromObject(
        { year: season, month: 9, day: 5, hour: 16 },
        { zone: tz },
      ).toISO() ?? new Date().toISOString(),
  },
  {
    week: 1,
    matchup_id: 2,
    home_team: seedTeams[2],
    away_team: seedTeams[3],
    home_score: 110.1,
    away_score: 88.4,
    start:
      DateTime.fromObject(
        { year: season, month: 9, day: 5, hour: 16 },
        { zone: tz },
      ).toISO() ?? new Date().toISOString(),
    end:
      DateTime.fromObject(
        { year: season, month: 9, day: 5, hour: 19 },
        { zone: tz },
      ).toISO() ?? new Date().toISOString(),
  },
];

export const seedBenchStats: BenchStat[] = [
  {
    matchup_id: 1,
    highest_bench_points: 21.4,
    tiebreak_team_points: 102.7,
    tiebreak_player_id: "p101",
  },
  {
    matchup_id: 2,
    highest_bench_points: 27.2,
    tiebreak_team_points: 110.1,
    tiebreak_player_id: "p203",
  },
];
