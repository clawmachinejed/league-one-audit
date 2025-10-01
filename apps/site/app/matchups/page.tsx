// apps/site/app/matchups/page.tsx
import Link from "next/link";
import Image from "next/image";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API = "https://api.sleeper.app/v1";

// tiny JSON fetch with Next revalidate hints
async function j<T>(path: string, reval = 60): Promise<T> {
  const res = await fetch(`${API}${path}`, { next: { revalidate: reval } });
  if (!res.ok)
    throw new Error(
      `Sleeper fetch failed: ${res.status} ${res.statusText} ${path}`,
    );
  return res.json();
}

type League = { week?: number };
type Matchup = { roster_id: number; matchup_id: number; points: number };
type SleeperUser = {
  user_id: string;
  display_name?: string;
  metadata?: {
    team_name?: string;
    avatar?: string;
    avatar_url?: string;
    team_avatar?: string;
    team_avatar_url?: string;
  };
  avatar?: string; // some installs store raw hash or url here
  avatar_url?: string; // some installs expose full url
};
type SleeperRoster = {
  roster_id: number;
  owner_id: string | null;
  metadata?: {
    avatar?: string;
    avatar_url?: string;
    team_avatar?: string;
    team_avatar_url?: string;
  };
};

const asNum = (v: unknown, d = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : d;

function teamName(user: SleeperUser | undefined, rid: number): string {
  const meta = user?.metadata?.team_name?.trim?.();
  if (meta) return meta;
  const disp = user?.display_name?.trim?.();
  if (disp) return disp;
  return `Team #${rid}`;
}

function groupByMatchup(
  list: Matchup[] | null | undefined,
): Map<number, Matchup[]> {
  const m = new Map<number, Matchup[]>();
  for (const it of list || []) {
    const id = Number(it.matchup_id);
    if (!m.has(id)) m.set(id, []);
    m.get(id)!.push(it);
  }
  return m;
}

/** Prefer team/roster avatar; fall back to user avatar; else undefined. */
function pickAvatarUrl(
  roster: SleeperRoster | undefined,
  user: SleeperUser | undefined,
): string | undefined {
  const tryVals: (string | undefined)[] = [
    roster?.metadata?.team_avatar_url,
    roster?.metadata?.team_avatar,
    roster?.metadata?.avatar_url,
    roster?.metadata?.avatar,
    user?.metadata?.team_avatar_url,
    user?.metadata?.team_avatar,
    user?.metadata?.avatar_url,
    user?.metadata?.avatar,
    user?.avatar_url,
    user?.avatar,
  ];
  for (const v of tryVals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

export default async function MatchupsPage() {
  const lid =
    process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;
  if (!lid) {
    return (
      <main className="page">
        <h1>Matchups</h1>
        <p>
          Missing league id. Set <code>SLEEPER_LEAGUE_ID</code> or{" "}
          <code>NEXT_PUBLIC_SLEEPER_LEAGUE_ID</code>.
        </p>
      </main>
    );
  }

  // 1) current week
  const league = await j<League>(`/league/${lid}`, 60);
  const currentWeek = asNum(league?.week, 1);

  // 2) users + rosters (for names & avatars)
  const [users, rosters] = await Promise.all([
    j<SleeperUser[]>(`/league/${lid}/users`, 600),
    j<SleeperRoster[]>(`/league/${lid}/rosters`, 600),
  ]);
  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const rostersById = new Map(rosters.map((r) => [Number(r.roster_id), r]));

  const nameByRosterId = new Map<number, string>();
  const avatarByRosterId = new Map<number, string | undefined>();
  for (const r of rosters) {
    const rid = Number(r.roster_id);
    const u = r.owner_id ? usersById.get(r.owner_id) : undefined;
    nameByRosterId.set(rid, teamName(u, rid));
    avatarByRosterId.set(rid, pickAvatarUrl(r, u));
  }

  // 3) this week's matchups
  const list = await j<Matchup[]>(`/league/${lid}/matchups/${currentWeek}`, 30);
  const groups = Array.from(groupByMatchup(list))
    .map(([mid, arr]) => ({ id: mid, a: arr[0], b: arr[1] }))
    .filter((x) => x.a && x.b)
    // stable order by matchup id
    .sort((x, y) => x.id - y.id);

  // current-week view → always "Live"
  const final = false;

  return (
    <main className="page" style={{ display: "grid", gap: 12 }}>
      <h1 style={{ marginBottom: 4 }}>Matchups — Week {currentWeek}</h1>
      <p style={{ color: "#6b7280", marginTop: -6 }}>
        Scores refresh when you reload the page.
      </p>

      <div className="m-grid">
        {groups.length === 0 ? (
          <div className="muted">No matchups found.</div>
        ) : (
          groups.map((g) => {
            const aRid = Number(g.a.roster_id);
            const bRid = Number(g.b.roster_id);
            const aName = nameByRosterId.get(aRid) || `Team #${aRid}`;
            const bName = nameByRosterId.get(bRid) || `Team #${bRid}`;
            const aPts = asNum(g.a.points, 0);
            const bPts = asNum(g.b.points, 0);

            const aWin = final && aPts > bPts;
            const bWin = final && bPts > aPts;

            const aAvatar =
              avatarByRosterId.get(aRid) || "/avatar-placeholder.png";
            const bAvatar =
              avatarByRosterId.get(bRid) || "/avatar-placeholder.png";

            return (
              <div className="m-card" key={g.id}>
                <div className="m-row">
                  <div className="m-team">
                    <Image
                      src={aAvatar}
                      alt=""
                      width={36}
                      height={36}
                      className="rounded-full object-cover"
                      style={{ borderRadius: "50%" }}
                    />
                    <Link href={`/owners/${aRid}`} className="m-name">
                      {aName}
                    </Link>
                  </div>
                  <div className="m-score">
                    <span
                      className={aWin ? "won" : final && bWin ? "lost" : ""}
                    >
                      {aPts.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="m-row">
                  <div className="m-team">
                    <Image
                      src={bAvatar}
                      alt=""
                      width={36}
                      height={36}
                      className="rounded-full object-cover"
                      style={{ borderRadius: "50%" }}
                    />
                    <Link href={`/owners/${bRid}`} className="m-name">
                      {bName}
                    </Link>
                  </div>
                  <div className="m-score">
                    <span
                      className={bWin ? "won" : final && aWin ? "lost" : ""}
                    >
                      {bPts.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="m-meta">
                  <span className="live">Live</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <style>{`
        .muted{color:#6b7280}
        .m-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
        .m-card{border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;display:grid;gap:6px}
        .m-row{display:flex;align-items:center;justify-content:space-between}
        .m-team{display:flex;align-items:center;gap:10px;min-width:0}
        .m-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .m-score span{font-variant-numeric:tabular-nums}
        .won{font-weight:700;color:#16a34a}
        .lost{font-weight:700;color:#dc2626}
        .m-meta{display:flex;gap:8px;margin-top:4px}
        .live{color:#2563eb;font-weight:600}
        @media (max-width:640px){
          .m-grid{grid-template-columns:1fr}
        }
      `}</style>
    </main>
  );
}
