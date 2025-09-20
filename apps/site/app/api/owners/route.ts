// apps/site/app/api/owners/route.ts
import { NextResponse } from "next/server";

const API = "https://api.sleeper.app/v1";

// NOTE: This API route runs at request time, not at build.
// If env is missing (e.g. CI export), return an empty list instead of throwing.
function leagueId(): string | null {
  return process.env.SLEEPER_LEAGUE_ID ?? null;
}

function avatarUrl(avatar?: string): string | undefined {
  if (!avatar) return undefined;
  return `https://sleepercdn.com/avatars/thumbs/${avatar}`;
}

async function j<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { cache: "no-store" });
  if (!res.ok)
    throw new Error(
      `Sleeper fetch failed: ${res.status} ${res.statusText} ${path}`,
    );
  return res.json();
}

export async function GET() {
  try {
    const lid = leagueId();
    if (!lid) return NextResponse.json([], { status: 200 });

    const [users, rosters] = await Promise.all([
      j<any[]>(`/league/${lid}/users`),
      j<any[]>(`/league/${lid}/rosters`),
    ]);

    const usersById = new Map(users.map((u) => [u.user_id, u]));
    const owners = rosters
      .map((r) => {
        const u = usersById.get(r.owner_id);
        const s = r.settings ?? {};
        return {
          roster_id: r.roster_id,
          owner_id: r.owner_id,
          display_name: u?.display_name ?? "Unknown",
          avatar_url: avatarUrl(u?.avatar),
          wins: Number(s.wins ?? 0),
          losses: Number(s.losses ?? 0),
          points_for: Number(s.fpts ?? 0),
          points_against: Number(s.fpts_against ?? 0),
        };
      })
      .sort((a: any, b: any) => a.display_name.localeCompare(b.display_name));

    return NextResponse.json(owners, { status: 200 });
  } catch (err) {
    // Don’t crash static export; send an empty list on failure
    return NextResponse.json([], { status: 200 });
  }
}
