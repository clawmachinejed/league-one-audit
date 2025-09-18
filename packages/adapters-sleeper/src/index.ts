// packages/adapters-sleeper/src/index.ts
import type { SleeperRepository, ConfigPort } from "@l1/ports";
import type { Matchup, StandingsRow, Team } from "@l1/contracts";

// Small JSON fetch helper (server-side cache OK)
async function j<T = any>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) {
    throw new Error(`Sleeper fetch failed: ${res.status} ${res.statusText} ${url}`);
  }
  return (await res.json()) as T;
}

type SleeperUser = {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string };
};

type SleeperRoster = {
  roster_id: number;
  owner_id: string | null;
  settings?: {
    wins?: number;
    losses?: number;
    fpts?: number;
    fpts_against?: number;
    pf?: number;
    pa?: number;
  } & Record<string, any>;
};

type SleeperMatchup = {
  matchup_id: number;
  roster_id: number;
  points: number;
};

export function createSleeperRepo(config: ConfigPort): SleeperRepository {
  const leagueId = config.get("SLEEPER_LEAGUE_ID");
  if (!leagueId) throw new Error("SLEEPER_LEAGUE_ID not configured");
  const base = `https://api.sleeper.app/v1/league/${leagueId}`;

  async function getUsers(): Promise<SleeperUser[]> {
    return j(`${base}/users`);
  }
  async function getRosters(): Promise<SleeperRoster[]> {
    return j(`${base}/rosters`);
  }
  async function getMatchups(week: number): Promise<SleeperMatchup[]> {
    return j(`${base}/matchups/${week}`);
  }

  async function buildTeams(): Promise<{ teams: Team[]; byRosterId: Record<number, Team> }> {
    const [users, rosters] = await Promise.all([getUsers(), getRosters()]);
    const userById = new Map(users.map((u) => [u.user_id, u]));
    const byRosterId: Record<number, Team> = {};
    const teams: Team[] = rosters.map((r) => {
      const u = r.owner_id ? userById.get(r.owner_id) : undefined;
      const teamName = (u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`).toString();
      const owner = u?.display_name || "";
      const t: Team = { id: String(r.roster_id), name: teamName, owner };
      byRosterId[r.roster_id] = t;
      return t;
    });
    return { teams, byRosterId };
  }

  return {
    async getTeams(): Promise<Team[]> {
      const { teams } = await buildTeams();
      return teams;
    },

    async getStandings(_season: number): Promise<StandingsRow[]> {
      const { byRosterId } = await buildTeams();
      const rosters = await getRosters();

      const rows: StandingsRow[] = rosters.map((r) => {
        const team =
          byRosterId[r.roster_id] || ({ id: String(r.roster_id), name: `Team ${r.roster_id}` } as Team);

        const wins = Number(r.settings?.wins ?? 0);
        const losses = Number(r.settings?.losses ?? 0);

        // Sleeper commonly exposes season totals as fpts / fpts_against; fall back to pf / pa if present.
        const points_for = Number(
          r.settings?.fpts ?? r.settings?.pf ?? 0,
        );
        const points_against = Number(
          r.settings?.fpts_against ?? r.settings?.pa ?? 0,
        );

        return { team, wins, losses, points_for, points_against };
      });

      // Sort by wins desc, losses asc, points_for desc
      rows.sort(
        (a, b) =>
          b.wins - a.wins ||
          a.losses - b.losses ||
          b.points_for - a.points_for
      );
      return rows;
    },

    async getSchedule(_season: number): Promise<Matchup[]> {
      const { byRosterId } = await buildTeams();

      const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
      const all: Matchup[] = [];

      for (const w of weeks) {
        try {
          const ms = await getMatchups(w);
          const byId: Record<number, SleeperMatchup[]> = {};
          for (const m of ms) {
            if (!byId[m.matchup_id]) byId[m.matchup_id] = [];
            byId[m.matchup_id].push(m);
          }
          for (const [midStr, entries] of Object.entries(byId)) {
            const mid = Number(midStr);
            const a = entries[0];
            const b = entries[1];
            if (!a || !b) continue;

            const home =
              byRosterId[a.roster_id] || ({ id: String(a.roster_id), name: `Team ${a.roster_id}` } as Team);
            const away =
              byRosterId[b.roster_id] || ({ id: String(b.roster_id), name: `Team ${b.roster_id}` } as Team);

            all.push({
              week: w,
              matchup_id: mid,
              home_team: home,
              away_team: away,
              home_score: Number(a.points ?? 0),
              away_score: Number(b.points ?? 0),
              start: new Date().toISOString(),
              end: new Date().toISOString(),
            });
          }
        } catch {
          // missing week / no data → skip
          continue;
        }
      }
      return all;
    },
  };
}

// Seed repo remains for local/demo use
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
      return seedSchedule as Matchup[];
    },
  };
}
