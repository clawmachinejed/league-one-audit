// apps/site/lib/owners.ts
// Server-side helpers for Owners pages (runtime only)
import "server-only";

const API = "https://api.sleeper.app/v1";

export type OwnerVM = {
  roster_id: number;
  owner_id: string;
  display_name: string;
  avatar_url?: string;
  /** Current season team name – pulled from roster.metadata.team_name, or users[].metadata.team_name */
  team_name?: string | null;
  wins: number;
  losses: number;
  points_for: number;
  points_against: number;
};

export type PlayerVM = {
  id: string;
  name: string;
  pos: string;
  nfl: string | null;
  slot?: string;
};

export type OwnerDetail = OwnerVM & {
  starters: PlayerVM[];
  bench: PlayerVM[];
};

function leagueId(): string {
  const id = process.env.SLEEPER_LEAGUE_ID;
  if (!id) throw new Error("SLEEPER_LEAGUE_ID not configured");
  return id;
}

async function j<T>(path: string, revalidate = 600): Promise<T> {
  const res = await fetch(`${API}${path}`, { next: { revalidate } });
  if (!res.ok) {
    throw new Error(`Sleeper fetch failed: ${res.status} ${res.statusText} ${path}`);
  }
  return res.json();
}

function avatarUrl(avatar?: string): string | undefined {
  if (!avatar) return undefined;
  return `https://sleepercdn.com/avatars/thumbs/${avatar}`;
}

function normalizeTeamName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

/** List Owners (includes team_name) */
export async function getOwners(): Promise<OwnerVM[]> {
  const lid = leagueId();

  const [users, rosters] = await Promise.all([
    j<any[]>(`/league/${lid}/users`, 3600),
    j<any[]>(`/league/${lid}/rosters`, 300),
  ]);

  const usersById = new Map<string, any>(users.map((u) => [u.user_id, u]));

  const owners = rosters.map((r) => {
    const u = usersById.get(r.owner_id);
    const s = r.settings ?? {};

    const teamName =
      normalizeTeamName(r?.metadata?.team_name) ??
      normalizeTeamName(u?.metadata?.team_name) ??
      null;

    const vm: OwnerVM = {
      roster_id: r.roster_id,
      owner_id: r.owner_id,
      display_name: u?.display_name ?? "Unknown",
      avatar_url: avatarUrl(u?.avatar),
      team_name: teamName,
      wins: Number(s.wins ?? 0),
      losses: Number(s.losses ?? 0),
      points_for: Number(s.fpts ?? 0),
      points_against: Number(s.fpts_against ?? 0),
    };
    return vm;
  });

  // keep your current sort (display_name)
  owners.sort((a, b) => a.display_name.localeCompare(b.display_name));
  return owners;
}

/** Detail – unchanged logic other than team_name field for consistency */
export async function getOwner(rosterId: number): Promise<OwnerDetail | null> {
  const lid = leagueId();

  const [league, users, rosters, players] = await Promise.all([
    j<any>(`/league/${lid}`, 3600),
    j<any[]>(`/league/${lid}/users`, 3600),
    j<any[]>(`/league/${lid}/rosters`, 300),
    j<Record<string, any>>(`/players/nfl`, 86400),
  ]);

  const r = rosters.find((x) => Number(x.roster_id) === Number(rosterId));
  if (!r) return null;

  const u = users.find((x) => x.user_id === r.owner_id);
  const s = r.settings ?? {};

  const teamName =
    normalizeTeamName(r?.metadata?.team_name) ??
    normalizeTeamName(u?.metadata?.team_name) ??
    null;

  const pmap = new Map<string, any>(Object.entries(players ?? {}));
  const rosterPositions: string[] = Array.isArray(league?.roster_positions) ? league.roster_positions : [];
  const startingSlots = rosterPositions.filter((slot) => slot !== "BN" && slot !== "TAXI" && slot !== "IR");

  const starterIds: string[] = (r.starters ?? []).filter(Boolean);
  const allPlayerIds: string[] = (r.players ?? []).filter(Boolean);

  const starters: OwnerDetail["starters"] = starterIds.map((pid, idx) => {
    const p = pmap.get(pid) ?? {};
    return {
      id: pid,
      name: p?.full_name || [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || (p?.position === "DEF" && p?.team ? `${p.team} DEF` : pid),
      pos: p?.position ?? "UNK",
      nfl: p?.team ?? null,
      slot: startingSlots[idx],
    };
  });

  const starterSet = new Set(starterIds);
  const bench: OwnerDetail["bench"] = allPlayerIds
    .filter((pid) => !starterSet.has(pid))
    .map((pid) => {
      const p = pmap.get(pid) ?? {};
      return {
        id: pid,
        name: p?.full_name || [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || (p?.position === "DEF" && p?.team ? `${p.team} DEF` : pid),
        pos: p?.position ?? "UNK",
        nfl: p?.team ?? null,
      };
    })
    .sort((a, b) => (a.pos === b.pos ? a.name.localeCompare(b.name) : a.pos.localeCompare(b.pos)));

  return {
    roster_id: r.roster_id,
    owner_id: r.owner_id,
    display_name: u?.display_name ?? "Unknown",
    avatar_url: avatarUrl(u?.avatar),
    team_name: teamName,
    wins: Number(s.wins ?? 0),
    losses: Number(s.losses ?? 0),
    points_for: Number(s.fpts ?? 0),
    points_against: Number(s.fpts_against ?? 0),
    starters,
    bench,
  };
}
