import Link from "next/link";
import ExpandableMatchups from "./ui/ExpandableMatchups";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API = "https://api.sleeper.app/v1";
const MIN_WEEK = 1;
const MAX_WEEK = 17;
const PLAYOFF_WEEKS = new Set([15, 16, 17]);

// ---------- tiny fetch helper with guard ----------
async function j<T>(path: string, reval = 60): Promise<T> {
  const res = await fetch(`${API}${path}`, { next: { revalidate: reval } });
  if (!res.ok) {
    throw new Error(
      `Sleeper fetch failed: ${res.status} ${res.statusText} ${path}`,
    );
  }
  return res.json();
}

type League = { week?: number };
type SleeperUser = {
  user_id: string;
  display_name?: string;
  avatar?: string;
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

// ---------- naming & avatar helpers ----------
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

const ORDER: ("QB" | "RB" | "WR" | "TE" | "FLEX" | "DEF")[] = [
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
): { slot: string; name: string; pts: number }[] {
  const starters = entry?.starters ?? [];
  const ptsMap = entry?.players_points ?? {};
  const labeled = starters
    .map((pid) => {
      const p = playersById.get(pid);
      const pos = (p?.position || "").toUpperCase();
      const name = p?.full_name || pid;
      const pts = asNum(ptsMap[pid], 0);
      return { pid, pos, name, pts };
    })
    .filter((x) => x.pos);

  const result: { slot: string; name: string; pts: number }[] = [];

  const take = (want: string) => {
    const i = labeled.findIndex((x) => x.pos === want);
    if (i >= 0) {
      const [x] = labeled.splice(i, 1);
      result.push({ slot: want, name: x.name, pts: x.pts });
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
      result.push({ slot: "FLEX", name: x.name, pts: x.pts });
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

function clampWeek(n: number) {
  return Math.max(MIN_WEEK, Math.min(MAX_WEEK, n));
}

type PageProps = { searchParams?: { week?: string } };

export default async function MatchupsPage({ searchParams }: PageProps) {
  const lid =
    process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

  // ====== fetch league week (guarded) ======
  let leagueWeek = 1;
  try {
    if (!lid) throw new Error("Missing league id env");
    const league = await j<League>(`/league/${lid}`, 60);
    leagueWeek = clampWeek(asNum(league?.week, 1));
  } catch (err) {
    // leave leagueWeek=1; render an inline warning later
    console.error("[matchups] league fetch error:", err);
  }

  const week = clampWeek(asNum(searchParams?.week, leagueWeek));
  const isPlayoffs = PLAYOFF_WEEKS.has(week);

  // ====== fetch users & rosters (guarded) ======
  let users: SleeperUser[] = [];
  let rosters: SleeperRoster[] = [];
  try {
    if (!lid) throw new Error("Missing league id env");
    [users, rosters] = await Promise.all([
      j<SleeperUser[]>(`/league/${lid}/users`, 600),
      j<SleeperRoster[]>(`/league/${lid}/rosters`, 600),
    ]);
  } catch (err) {
    console.error("[matchups] users/rosters fetch error:", err);
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

  // ====== fetch matchups for week (guarded) ======
  let list: Matchup[] = [];
  try {
    if (!lid) throw new Error("Missing league id env");
    list = await j<Matchup[]>(`/league/${lid}/matchups/${week}`, 30);
  } catch (err) {
    console.error(`[matchups] matchups week=${week} fetch error:`, err);
  }

  const grouped = Array.from(groupByMatchup(list))
    .map(([mid, arr]) => ({ id: mid, a: arr?.[0], b: arr?.[1] }))
    .filter((x) => x.a && x.b)
    .sort((x, y) => x.id - y.id);

  // ====== players directory (SKIP for playoffs, guard for errors) ======
  let playersById = new Map<string, Player>();
  if (!isPlayoffs) {
    try {
      const playersObj = await j<Record<string, Player>>(`/players/nfl`, 600);
      playersById = new Map(Object.entries(playersObj ?? {}));
    } catch (err) {
      console.error("[matchups] players fetch error:", err);
      // leave playersById empty; buildStarters will fallback to "—"
    }
  }

  // ====== build UI payload safely ======
  const ui = grouped.map((g) => {
    const aRid = Number(g.a!.roster_id);
    const bRid = Number(g.b!.roster_id);
    const a = {
      rid: aRid,
      name: nameByRosterId.get(aRid) || `Team #${aRid}`,
      avatar: avatarByRosterId.get(aRid) || "/avatar-placeholder.png",
      pts: asNum(g.a!.points, 0),
      starters: isPlayoffs ? [] : buildStarters(g.a!, playersById),
    };
    const b = {
      rid: bRid,
      name: nameByRosterId.get(bRid) || `Team #${bRid}`,
      avatar: avatarByRosterId.get(bRid) || "/avatar-placeholder.png",
      pts: asNum(g.b!.points, 0),
      starters: isPlayoffs ? [] : buildStarters(g.b!, playersById),
    };
    return { id: g.id, a, b };
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

          <select
            className="wkselect"
            defaultValue={String(week)}
            onChange={() => {}}
          >
            {Array.from({ length: MAX_WEEK }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
          <Link
            href={{ pathname: "/matchups", query: { week } }}
            prefetch={false}
            className="wkgo"
          >
            Go
          </Link>

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

      {PLAYOFF_WEEKS.has(week) && (
        <p style={{ color: "#6b7280", marginTop: -6 }}>
          Weeks 15–17 are playoffs; matchup details may be limited.
        </p>
      )}

      {!lid && (
        <p style={{ color: "#dc2626" }}>
          Missing league id. Set <code>SLEEPER_LEAGUE_ID</code> or{" "}
          <code>NEXT_PUBLIC_SLEEPER_LEAGUE_ID</code>.
        </p>
      )}

      <p style={{ color: "#6b7280", marginTop: -6 }}>
        Reload to refresh scores. Click a card to expand starters.
      </p>

      <ExpandableMatchups items={ui as any} />

      <style>{`
        .wkbtn{
          display:inline-flex; align-items:center; gap:6px;
          padding:4px 8px; border:1px solid #e5e7eb; border-radius:8px;
          text-decoration:none; color:#111827; background:#fff;
        }
        .wkbtn:hover{ background:#fafafa; }
        .wkbtn.disabled{ opacity:.4; cursor:not-allowed; }
        .wkselect{
          padding:4px 8px; border:1px solid #e5e7eb; border-radius:8px; background:#fff;
        }
        .wkgo{
          padding:4px 8px; border:1px solid #e5e7eb; border-radius:8px; text-decoration:none; color:#111827; background:#fff;
        }
        .wkgo:hover{ background:#fafafa; }
      `}</style>
    </main>
  );
}
