import { z } from "zod";

export const Team = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.string().optional(),
});

export const Matchup = z.object({
  week: z.number().int().min(1),
  matchup_id: z.number().int(),
  home_team: Team,
  away_team: Team,
  home_score: z.number().nonnegative(),
  away_score: z.number().nonnegative(),
  start: z.string(),
  end: z.string(),
});

export const StandingsRow = z.object({
  team: Team,
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  points_for: z.number().nonnegative(),
  points_against: z.number().nonnegative(),
});

export const LiveWindow = z.object({
  start: z.string(),
  end: z.string(),
});

export const BenchStat = z.object({
  matchup_id: z.number().int(),
  highest_bench_points: z.number().nonnegative(),
  tiebreak_team_points: z.number().nonnegative(),
  tiebreak_player_id: z.string(),
});

export const OddsInput = z.object({
  season: z.number().int(),
  current_week: z.number().int(),
  standings: z.array(StandingsRow),
  schedule: z.array(Matchup),
});

export const OddsResult = z.object({
  team_id: z.string(),
  playoff_odds: z.number().min(0).max(1),
});

export const OgParams = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  logoUrl: z.string().optional(),
});

export type Team = z.infer<typeof Team>;
export type Matchup = z.infer<typeof Matchup>;
export type StandingsRow = z.infer<typeof StandingsRow>;
export type BenchStat = z.infer<typeof BenchStat>;
export type LiveWindow = z.infer<typeof LiveWindow>;
export type OddsInput = z.infer<typeof OddsInput>;
export type OddsResult = z.infer<typeof OddsResult>;
export type OgParams = z.infer<typeof OgParams>;
