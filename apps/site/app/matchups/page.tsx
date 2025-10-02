// apps/site/app/matchups/page.tsx
import Link from "next/link";
import Image from "next/image";
import ExpandableMatchups from "./ui/ExpandableMatchups";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API = "https://api.sleeper.app/v1";

// small JSON fetch with Next revalidate hints
async function j<T>(path: string, reval = 60): Promise<T> {
  const res = await fetch(`${API}${path}`, { next: { revalidate: reval } });
  if (!res.ok)
    throw new Error(
      `Sleeper fetch failed: ${res.status} ${res.statusText} ${path}`,
    );
  return res.json();
}

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
};

// Sleeper /matchups/{week} model (subset)
type Matchup = {
  roster_id: number;
  matchup_id: number;
  points: number;
  starters?: string[]; // array of player_ids (strings)
  players_points?: Record<string, number>;
};

// Sleeper /players/nfl model (subset)
type Player = {
  player_id: string;
  full_name?: string;
  position?: string; // QB/RB/WR/TE/DEF/â€¦
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

// display name preference
function teamName(user: SleeperUser | undefined, rid: number): string {
  const meta = user?.metadata?.team_name?.trim?.();
  if (meta) return meta;
  const disp = user?.display_name?.trim?.();
  if (disp) return disp;
  return `Team #${rid}`;
}

// standings-style user avatar normalization
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

// prefer roster avatar; else user; ignore placeholders/relative
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

// group matchups by matchup_id
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

// Desired start order (only starters): QB, RB, RB, WR, WR, TE, FLEX, FLEX, DEF
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

// Take a team's matchup entry, return starters in the desired order
function buildStarters(
  entry: Matchup,
  playersById: Map<string, Player>,
): { slot: string; name: string; pts: number }[] {
  const starters = entry.starters ?? [];
  const ptsMap = entry.players_points ?? {};
  // First, label each starter with their position and name
  const labeled = starters
    .map((pid) => {
      const p = playersById.get(pid);
      const pos = (p?.position || "").toUpperCase();
      const name = p?.full_name || pid;
      const pts = asNum(ptsMap[pid], 0);
      return { pid, pos, name, pts };
    })
    .filter((x) => x.pos); // keep only known positions

  // Buckets for fixed slots
  const result: { slot: string; name: string; pts: number }[] = [];

  // Helpers to pull next by exact position
  const take = (want: string) => {
    const i = labeled.findIndex((x) => x.pos === want);
    if (i >= 0) {
      const [x] = labeled.splice(i, 1);
      result.push({ slot: want, name: x.name, pts: x.pts });
    } else {
      result.push({ slot: want, name: "â€”", pts: 0 });
    }
  };

  // FLEX can be RB/WR/TE (whatever remains that fits)
  const takeFlex = () => {
    const i = labeled.findIndex(
      (x) => x.pos === "RB" || x.pos === "WR" || x.pos === "TE",
    );
    if (i >= 0) {
      const [x] = labeled.splice(i, 1);
      result.push({ slot: "FLEX", name: x.name, pts: x.pts });
    } else {
      result.push({ slot: "FLEX", name: "â€”", pts: 0 });
    }
  };

  // Fill in the desired ORDER
  for (const slot of ORDER) {
    if (slot === "FLEX") takeFlex();
    else if (slot === "DEF") take("DEF");
    else take(slot); // QB/RB/WR/TE
  }

  return result;
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

  // Week
  const league = await j<League>(`/league/${lid}`, 60);
  const currentWeek = asNum(league?.week, 1);

  // Users & rosters
  const [users, rosters] = await Promise.all([
    j<SleeperUser[]>(`/league/${lid}/users`, 600),
    j<SleeperRoster[]>(`/league/${lid}/rosters`, 600),
  ]);
  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const rosterById = new Map(rosters.map((r) => [Number(r.roster_id), r]));

  // Names/avatars per roster
  const nameByRosterId = new Map<number, string>();
  const avatarByRosterId = new Map<number, string | undefined>();
  for (const r of rosters) {
    const rid = Number(r.roster_id);
    const u = r.owner_id ? usersById.get(r.owner_id) : undefined;
    nameByRosterId.set(rid, teamName(u, rid));
    avatarByRosterId.set(rid, pickAvatarUrl(r, u));
  }

  // This week's matchups
  const list = await j<Matchup[]>(`/league/${lid}/matchups/${currentWeek}`, 30);
  const grouped = Array.from(groupByMatchup(list))
    .map(([mid, arr]) => ({ id: mid, a: arr[0], b: arr[1] }))
    .filter((x) => x.a && x.b)
    .sort((x, y) => x.id - y.id);

  // Player directory (weâ€™ll only read entries we need at render time; cached for 10 mins)
  const playersObj = await j<Record<string, Player>>(`/players/nfl`, 600);
  const playersById = new Map(Object.entries(playersObj));

  // Prepare UI-safe payload (plain JSON)
  const ui = grouped.map((g) => {
    const aRid = Number(g.a.roster_id);
    const bRid = Number(g.b.roster_id);
    return {
      id: g.id,
      a: {
        rid: aRid,
        name: nameByRosterId.get(aRid) || `Team #${aRid}`,
        avatar: avatarByRosterId.get(aRid) || "/avatar-placeholder.png",
        pts: asNum(g.a.points, 0),
        starters: buildStarters(g.a, playersById),
      },
      b: {
        rid: bRid,
        name: nameByRosterId.get(bRid) || `Team #${bRid}`,
        avatar: avatarByRosterId.get(bRid) || "/avatar-placeholder.png",
        pts: asNum(g.b.points, 0),
        starters: buildStarters(g.b, playersById),
      },
    };
  });

  return (
    <main className="page" style={{ display: "grid", gap: 12 }}>
      <h1 style={{ marginBottom: 4 }}>Matchups â€” Week {currentWeek}</h1>
      <p style={{ color: "#6b7280", marginTop: -6 }}>
        Reload to refresh scores. Click a card to expand starters.
      </p>

      <ExpandableMatchups cards={ui} />

      <style>{`
        .muted{color:#6b7280}
      `}</style>
    </main>
  );
}
