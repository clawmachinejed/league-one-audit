// server-only, typed, cached fetchers for Sleeper
import "server-only";

const API = "https://api.sleeper.app/v1";

function leagueId(): string {
  const id = process.env.SLEEPER_LEAGUE_ID;
  if (!id) throw new Error("SLEEPER_LEAGUE_ID not configured");
  return id;
}

async function j<T>(path: string, revalidate = 3600): Promise<T> {
  const res = await fetch(`${API}${path}`, { next: { revalidate } });
  if (!res.ok)
    throw new Error(`Sleeper ${res.status} ${res.statusText} ${path}`);
  return res.json();
}

// Raw Sleeper shapes (partial but enough for our use)
export type SleeperUser = {
  user_id: string;
  display_name?: string;
  avatar?: string;
  metadata?: Record<string, unknown>;
};
export type SleeperRoster = {
  roster_id: number;
  owner_id: string;
  settings?: any;
  metadata?: Record<string, unknown>;
  starters?: string[];
  players?: string[];
};
export type SleeperLeague = { roster_positions?: string[] } | null;
export type SleeperPlayers = Record<string, any>;

// Public client
export const sleeper = {
  league: () => j<SleeperLeague>(`/league/${leagueId()}`, 3600),
  users: () => j<SleeperUser[]>(`/league/${leagueId()}/users`, 3600),
  rosters: () => j<SleeperRoster[]>(`/league/${leagueId()}/rosters`, 300),
  players: () => j<SleeperPlayers>(`/players/nfl`, 86400), // big; cache 1 day
};
