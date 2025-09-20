// apps/site/lib/owners.ts
// server-only helpers for Owners pages
import "server-only";

const API = "https://api.sleeper.app/v1";

export type OwnerVM = {
  roster_id: number;
  owner_id: string;
  display_name: string;
  avatar_url?: string;
  /** Current season team name */
  team_name?: string | null;
  wins: number;
  losses: number;
  points_for: number;
  points_against: number;
};

export type PlayerVM = {
  id: string;
  name: string;
  pos: string; // QB/RB/WR/TE/DEF/…
  nfl: string | null; // NFL team (e.g., KC, PHI) or null
  slot?: string; // Starting slot label (QB/RB/WR/TE/FLEX/DEF/…)
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

async function j<T>(path: string, revalidate = 3600): Promise<T> {
  const res = await fetch(`${API}${path}`, { next: { revalidate } });
  if (!res.ok) throw new Error(`Sleeper fetch failed: ${res.status} ${res.statusText} ${path}`);
  return res.json();
}

function avatarUrl(avatar?: string): string | undefined {
  if (!avatar) return undefined;
  return `https://sleepercdn.com/avatars/thumbs/${avatar}`;
}

function normalizeTeamName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

/** List Owners (adds team_name from roster.metadata.team_name; fallback to users[].metadata.team_name) */
export async function getOwners(): Promise<OwnerVM[]> {
  const lid = leagueId();
  const [users, rosters] = await Promise.all([
    j<any[]>(`/league/${lid}/users`, 3600),
    j<any[]>(`/league/${lid}/rosters`, 300),
  ]);

  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const owners = rosters.map((r) => {
    const u = usersById.get(r.owner_id);
    const s = r.settings ?? {};

    // prefer roster.metadata.team_name; fallback to users[].metadata.team_name
    const teamName =
      normalizeTeamName(r?.metadata?.team_name) ??
      normalizeTeamName(u?.metadata?.team_name) ??
      null;

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
    } as OwnerVM;
  });

  owners.sort((a, b) => a.display_name.localeCompare(b.display_name));
  return owners;
}

function playersToMap(players: Record<string, any>) {
  return new Map<string, any>(Object.entries(players));
}

function asName(p: any, idFallback: string): string {
  if (p?.full_name) return p.full_name as string;
  const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (p?.position === "DEF" && p?.team) return `${p.team} DEF`;
  return idFallback;
}

/** Owner detail (record + starters with slot + bench) */
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

  const pmap = playersToMap(players);
  const rosterPositions: string[] = Array.isArray(league?.roster_positions)
    ? league.roster_positions
    : [];
  const startingSlots = rosterPositions.filter(
    (slot) => slot !== "BN" && slot !== "TAXI" && slot !== "IR"
  );

  const starterIds: string[] = (r.starters ?? []).filter(Boolean);
  const allPlayerIds: string[] = (r.players ?? []).filter(Boolean);

  const starters = starterIds.map((pid, idx) => {
    const p = pmap.get(pid) ?? {};
    const slotLabel = startingSlots[idx] ?? undefined;
    return {
      id: pid,
      name: asName(p, pid),
      pos: p?.position ?? "UNK",
      nfl: p?.team ?? null,
      slot: slotLabel,
    } as PlayerVM;
  });

  const starterSet = new Set(starterIds);
  const bench = allPlayerIds
    .filter((pid) => !starterSet.has(pid))
    .map((pid) => {
      const p = pmap.get(pid) ?? {};
      return {
        id: pid,
        name: asName(p, pid),
        pos: p?.position ?? "UNK",
        nfl: p?.team ?? null,
      } as PlayerVM;
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
