// apps/site/app/matchups/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import ExpandableMatchups from "./ui/ExpandableMatchups";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API = "https://api.sleeper.app/v1";
const MIN_WEEK = 1;
const MAX_WEEK = 17;

async function j<T>(path: string, reval = 60): Promise<T> {
  const res = await fetch(`${API}${path}`, { next: { revalidate: reval } });
  if (!res.ok)
    throw new Error(
      `Sleeper fetch failed: ${res.status} ${res.statusText} ${path}`,
    );
  return res.json();
}

type SleeperState = { week?: number };
type League = { week?: number };
type SleeperUser = {
  user_id: string;
  display_name?: string;
  avatar?: string; // hash or url
  metadata?: { team_name?: string; avatar?: string };
};
type SleeperRoster = {
  roster_id: number;
  owner_id: string | null;
  metadata?: {
    team_avatar_url?: string;
    team_avatar?: string;
    avatar_url?: string;
    avatar?: string;
  };
  settings?: {
    wins?: number;
    fpts?: number;
    fpts_decimal?: number | string;
  };
};
type Matchup = {
  roster_id: number;
  matchup_id: number;
  points: number;
  starters?: string[];
  players_points?: Record<string, number>;
};
type Player = {
  player_id: string;
  full_name?: string;
  position?: string;
  team?: string;
};

const asNum = (v: unknown, d = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : d;
const clampWeek = (n: number) => Math.max(MIN_WEEK, Math.min(MAX_WEEK, n));
const isUrl = (v?: string | null): v is string =>
  !!v && (v.startsWith("http://") || v.startsWith("https://"));
const isRelative = (v?: string | null): v is string => !!v && v.startsWith("/");
const isHash = (v?: string | null): v is string =>
  !!v && !v.includes("/") && !v.includes(" ") && !v.startsWith("data:");
const toCdn = (hash?: string | null): string | undefined =>
  isHash(hash) ? `https://sleepercdn.com/avatars/thumbs/${hash}` : undefined;
function isSleeperImagesPlaceholder(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "sleepercdn.com" && u.pathname.startsWith("/images");
  } catch {
    return false;
  }
}
function teamName(user: SleeperUser | undefined, rid: number): string {
  const meta = user?.metadata?.team_name?.trim?.();
  if (meta) return meta;
  const disp = user?.display_name?.trim?.();
  if (disp) return disp;
  return `Team #${rid}`;
}
function pickUserAvatarUrl(user: SleeperUser | undefined): string | undefined {
  if (!user) return undefined;
  const meta = user.metadata?.avatar?.trim();
  const raw = user.avatar?.trim();
  if (isUrl(meta) && !isSleeperImagesPlaceholder(meta)) return meta;
  const fromRaw = toCdn(raw);
  if (fromRaw) return fromRaw;
  const fromMeta = toCdn(meta);
  if (fromMeta) return fromMeta;
  return undefined;
}
function pickAvatarUrl(
  roster: SleeperRoster | undefined,
  user: SleeperUser | undefined,
): string | undefined {
  const m = roster?.metadata;
  const candidates = [
    m?.team_avatar_url,
    m?.team_avatar,
    m?.avatar_url,
    m?.avatar,
  ].map((x) => x?.trim());
  for (const c of candidates) {
    if (!c) continue;
    if (isRelative(c)) continue;
    if (isUrl(c)) {
      if (!isSleeperImagesPlaceholder(c)) return c;
      continue;
    }
    const cdn = toCdn(c);
    if (cdn) return cdn;
  }
  return pickUserAvatarUrl(user);
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

// desired starting slots order
const ORDER: Array<"QB" | "RB" | "WR" | "TE" | "FLEX" | "DEF"> = [
  "QB",
  "RB",
  "RB",
  "WR",
  "WR",
  "TE",
  "FLEX",
  "FLEX",
  "DEF",
];

function buildStarters(
  entry: Matchup,
  playersById: Map<string, Player>,
): { slot: string; name: string; pts: number; pid?: string }[] {
  const starters = entry.starters ?? [];
  const ptsMap = entry.players_points ?? {};
  const labeled = starters
    .map((pid) => {
      const p = playersById.get(pid);
      const pos = (p?.position || "").toUpperCase();
      const name = p?.full_name || pid;
      const pts = asNum(ptsMap[pid], 0);
      return { pid, pos, name, pts };
    })
    .filter((x) => x.pos);

  const result: { slot: string; name: string; pts: number; pid?: string }[] =
    [];

  const take = (want: string) => {
    const i = labeled.findIndex((x) => x.pos === want);
    if (i >= 0) {
      const [x] = labeled.splice(i, 1);
      result.push({ slot: want, name: x.name, pts: x.pts, pid: x.pid });
    } else {
      result.push({ slot: want, name: "—", pts: 0 });
    }
  };
  const takeFlex = () => {
    const i = labeled.findIndex(
      (x) => x.pos === "RB" || x.pos === "WR" || x.pos === "TE",
    );
    if (i >= 0) {
      const [x] = labeled.splice(i, 1);
      result.push({ slot: "FLEX", name: x.name, pts: x.pts, pid: x.pid });
    } else {
      result.push({ slot: "FLEX", name: "—", pts: 0 });
    }
  };

  for (const slot of ORDER) {
    if (slot === "FLEX") takeFlex();
    else if (slot === "DEF") take("DEF");
    else take(slot);
  }

  return result;
}

type PageProps = { searchParams?: { week?: string } };

export default async function MatchupsPage({ searchParams }: PageProps) {
  const lid =
    process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

  // true current NFL week (server)
  let currentWeek = 1;
  try {
    const state = await j<SleeperState>(`/state/nfl`, 30);
    currentWeek = clampWeek(asNum(state?.week, 1));
  } catch {
    currentWeek = 1;
  }

  // canonicalize ?week
  const hasWeekParam = typeof searchParams?.week !== "undefined";
  const requestedWeek = clampWeek(asNum(searchParams?.week, currentWeek));
  if (!hasWeekParam) {
    // redirect to ensure canonical URL / caching works cleanly
    return redirect(`/matchups?week=${requestedWeek}`);
  }
  const week = requestedWeek;

  // read "My Team" roster id from cookie (like Standings)
  const cookieStore = await cookies();
  const myTeamCookie =
    cookieStore.get("l1.myTeamRosterId")?.value ??
    cookieStore.get("myTeam")?.value ??
    null;
  const myRid = Number.isFinite(Number(myTeamCookie))
    ? Number(myTeamCookie)
    : undefined;

  // users & rosters
  let users: SleeperUser[] = [];
  let rosters: SleeperRoster[] = [];
  if (lid) {
    try {
      [users, rosters] = await Promise.all([
        j<SleeperUser[]>(`/league/${lid}/users`, 600),
        j<SleeperRoster[]>(`/league/${lid}/rosters`, 600),
      ]);
    } catch {
      // ignore
    }
  }
  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const nameByRosterId = new Map<number, string>();
  const avatarByRosterId = new Map<number, string | undefined>();
  for (const r of rosters) {
    const rid = Number(r.roster_id);
    const u = r.owner_id ? usersById.get(r.owner_id) : undefined;
    nameByRosterId.set(rid, teamName(u, rid));
    avatarByRosterId.set(rid, pickAvatarUrl(r, u));
  }

  // standings order for default sorting
  const standings = rosters.map((r) => {
    const wins = asNum(r.settings?.wins, 0);
    const fpts =
      asNum(r.settings?.fpts, 0) + asNum(r.settings?.fpts_decimal, 0) / 100;
    return { rid: Number(r.roster_id), wins, fpts };
  });
  standings.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.fpts !== a.fpts) return b.fpts - a.fpts;
    return a.rid - b.rid;
  });
  const rankByRid = new Map<number, number>();
  standings.forEach((s, i) => rankByRid.set(s.rid, i + 1));

  // matchups for week
  let list: Matchup[] = [];
  if (lid) {
    try {
      list = await j<Matchup[]>(`/league/${lid}/matchups/${week}`, 30);
    } catch {
      // ignore
    }
  }

  // players directory — cache for 24h per API guidance
  let playersById = new Map<string, Player>();
  try {
    const playersObj = await j<Record<string, Player>>(`/players/nfl`, 86400);
    playersById = new Map(Object.entries(playersObj || {}));
  } catch {
    // ignore
  }

  // group + sort by standings (lowest rank number first)
  const grouped = Array.from(groupByMatchup(list))
    .map(([mid, arr]) => ({ id: mid, a: arr?.[0], b: arr?.[1] }))
    .filter((x) => x.a && x.b)
    .sort((x, y) => {
      const ax =
        Math.min(
          rankByRid.get(Number(x.a!.roster_id)) ?? 999,
          rankByRid.get(Number(x.b!.roster_id)) ?? 999,
        ) || 999;
      const ay =
        Math.min(
          rankByRid.get(Number(y.a!.roster_id)) ?? 999,
          rankByRid.get(Number(y.b!.roster_id)) ?? 999,
        ) || 999;
      if (ax !== ay) return ax - ay;
      const minRidX = Math.min(Number(x.a!.roster_id), Number(x.b!.roster_id));
      const minRidY = Math.min(Number(y.a!.roster_id), Number(y.b!.roster_id));
      return minRidX - minRidY;
    });

  // Prepare UI payload
  const ui = grouped.map((g) => {
    const aRid = Number(g.a!.roster_id);
    const bRid = Number(g.b!.roster_id);
    return {
      id: g.id,
      a: {
        rid: aRid,
        name: nameByRosterId.get(aRid) || `Team #${aRid}`,
        avatar: avatarByRosterId.get(aRid) || "/avatar-placeholder.png",
        pts: asNum(g.a!.points, 0),
        starters: buildStarters(g.a!, playersById),
      },
      b: {
        rid: bRid,
        name: nameByRosterId.get(bRid) || `Team #${bRid}`,
        avatar: avatarByRosterId.get(bRid) || "/avatar-placeholder.png",
        pts: asNum(g.b!.points, 0),
        starters: buildStarters(g.b!, playersById),
      },
    };
  });

  const prevWeek = week > MIN_WEEK ? week - 1 : null;
  const nextWeek = week < MAX_WEEK ? week + 1 : null;

  return (
    <main className="page" style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0, lineHeight: 1 }}>Matchups</h1>
        <div aria-hidden="true" style={{ color: "#6b7280" }}>
          •
        </div>
        <strong>Week {week}</strong>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          {prevWeek ? (
            <Link
              href={{ pathname: "/matchups", query: { week: prevWeek } }}
              prefetch={false}
              className="wkbtn"
            >
              ◀ Prev
            </Link>
          ) : (
            <span className="wkbtn disabled">◀ Prev</span>
          )}
          {nextWeek ? (
            <Link
              href={{ pathname: "/matchups", query: { week: nextWeek } }}
              prefetch={false}
              className="wkbtn"
            >
              Next ▶
            </Link>
          ) : (
            <span className="wkbtn disabled">Next ▶</span>
          )}
        </div>
      </div>

      <p style={{ color: "#6b7280", marginTop: -6 }}>
        Tap the center header to open a matchup. Tap the POS column to show/hide
        all player stats. Tap a player name to toggle just that player.
      </p>

      <ExpandableMatchups
        items={ui as any}
        myRid={myRid}
        // statsByPlayerId={...} // Optional: pass a weekly stats map here when available
      />

      <style>{`
        .wkbtn{
          display:inline-flex; align-items:center; gap:6px;
          padding:4px 8px; border:1px solid #e5e7eb; border-radius:8px;
          text-decoration:none; color:#111827; background:#fff;
        }
        .wkbtn:hover{ background:#fafafa; }
        .wkbtn.disabled{ opacity:.4; cursor:not-allowed; }
      `}</style>
    </main>
  );
}
