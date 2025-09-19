// apps/site/lib/owners.ts
// Minimal data layer for Owners (separate from standings logic)

type SleeperRoster = {
  roster_id: number;
  owner_id: string | null;
  settings?: {
    wins?: number;
    losses?: number;
    pf?: number; // points for
    pa?: number; // points against
  };
};

type SleeperUser = {
  user_id: string;
  display_name: string;
  metadata?: {
    team_name?: string;
    avatar?: string | null;
  };
  avatar?: string | null;
};

export type OwnerVM = {
  roster_id: number;
  owner_id: string | null;
  display_name: string;
  team_name?: string;
  avatar_url?: string | null;
  wins?: number;
  losses?: number;
  points_for?: number;
  points_against?: number;
};

function getLeagueId(): string {
  const id = process.env.SLEEPER_LEAGUE_ID;
  if (!id) {
    throw new Error("SLEEPER_LEAGUE_ID not configured");
  }
  return id;
}

function avatarUrl(avatar?: string | null): string | null {
  if (!avatar) return null;
  return `https://sleepercdn.com/avatars/thumbs/${avatar}`;
}

async function sleeper<T>(path: string, revalidateSeconds = 300): Promise<T> {
  const res = await fetch(`https://api.sleeper.app/v1${path}`, {
    next: { revalidate: revalidateSeconds },
  });
  if (!res.ok) {
    throw new Error(
      `Sleeper fetch failed: ${res.status} ${res.statusText} ${path}`,
    );
  }
  return (await res.json()) as T;
}

export async function getOwners(): Promise<OwnerVM[]> {
  const leagueId = getLeagueId();
  const [rosters, users] = await Promise.all([
    sleeper<SleeperRoster[]>(`/league/${leagueId}/rosters`),
    sleeper<SleeperUser[]>(`/league/${leagueId}/users`),
  ]);

  const usersById = new Map(users.map((u) => [u.user_id, u]));

  const owners: OwnerVM[] = rosters.map((r) => {
    const u = r.owner_id ? usersById.get(r.owner_id) : undefined;
    const display_name = u?.display_name ?? "Unassigned";
    const team_name = u?.metadata?.team_name;
    const avatar = u?.metadata?.avatar ?? u?.avatar ?? null;

    return {
      roster_id: r.roster_id,
      owner_id: r.owner_id ?? null,
      display_name,
      team_name: team_name || undefined,
      avatar_url: avatarUrl(avatar),
      wins: r.settings?.wins,
      losses: r.settings?.losses,
      points_for: r.settings?.pf,
      points_against: r.settings?.pa,
    };
  });

  owners.sort((a, b) => {
    const an = (a.team_name || a.display_name).toLowerCase();
    const bn = (b.team_name || b.display_name).toLowerCase();
    return an.localeCompare(bn);
  });

  return owners;
}

export async function getOwner(rosterId: number): Promise<OwnerVM | null> {
  const owners = await getOwners();
  return owners.find((o) => o.roster_id === rosterId) ?? null;
}
