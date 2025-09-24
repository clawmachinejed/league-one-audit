// apps/site/app/standings/page.tsx
import { getApp } from "../../lib/app";
import { cookies } from "next/headers";

export const metadata = { title: "Standings • League One" };
// Render at request time so SLEEPER_LEAGUE_ID is read from the server env
export const dynamic = "force-dynamic";
export const revalidate = 0;

const API = "https://api.sleeper.app/v1";

// tiny server-side fetch helper
async function j<T>(path: string, revalidate = 300): Promise<T> {
  const res = await fetch(`${API}${path}`, { next: { revalidate } });
  if (!res.ok)
    throw new Error(
      `Sleeper fetch failed: ${res.status} ${res.statusText} ${path}`,
    );
  return res.json();
}

// prefer a full URL in users[].metadata.avatar; otherwise fall back to user avatar id → CDN thumbs
function pickAvatarUrl(user: any | undefined): string | undefined {
  const metaUrl =
    typeof user?.metadata?.avatar === "string" && user.metadata.avatar.trim()
      ? user.metadata.avatar.trim()
      : null;
  if (metaUrl) return metaUrl; // e.g. https://sleepercdn.com/uploads/...jpg
  const id =
    typeof user?.avatar === "string" && user.avatar.trim()
      ? user.avatar.trim()
      : null;
  return id ? `https://sleepercdn.com/avatars/thumbs/${id}` : undefined;
}

// --- helpers for table stats ---
type AnyRow = Record<string, any>;
const asNum = (v: unknown, d = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : d;
function streakStr(row: AnyRow): string {
  if (typeof row?.streak === "string") return row.streak;
  const len = asNum(row?.streak_len, 0);
  const sign = typeof row?.streak_sign === "string" ? row.streak_sign : "";
  if (len > 0 && (sign === "W" || "L")) return `${sign}${len}`;
  return "—";
}

/* ------------------ STREAK COMPUTATION (existing) ------------------ */
type Matchup = {
  roster_id: number;
  matchup_id: number;
  points: number;
};

function resultsFromMatchups(
  matchups: Matchup[],
): Map<number, "W" | "L" | "T"> {
  const groups = new Map<number, Matchup[]>();
  for (const m of matchups) {
    if (!groups.has(m.matchup_id)) groups.set(m.matchup_id, []);
    groups.get(m.matchup_id)!.push(m);
  }

  const out = new Map<number, "W" | "L" | "T">();
  for (const [, list] of groups) {
    if (!list || list.length === 0) continue;

    let max = -Infinity;
    for (const m of list) max = Math.max(max, Number(m.points ?? 0));

    const top = list.filter((m) => Number(m.points ?? 0) === max);

    if (top.length > 1) {
      for (const m of list) {
        if (Number(m.points ?? 0) === max) out.set(m.roster_id, "T");
        else out.set(m.roster_id, "L");
      }
    } else {
      const winner = top[0]?.roster_id;
      for (const m of list) {
        out.set(m.roster_id, m.roster_id === winner ? "W" : "L");
      }
    }
  }
  return out;
}

async function getStreaks(
  lid: string,
  leagueWeekMaybe: number | undefined,
  revalidate = 180,
): Promise<Map<number, string>> {
  let currentWeek = Number(leagueWeekMaybe);
  if (!Number.isFinite(currentWeek)) {
    const state = await j<{ week: number }>(`/state/nfl`, 120);
    currentWeek = Number(state?.week ?? 1);
  }
  const lastCompleted = Math.max(0, currentWeek - 1);
  if (lastCompleted === 0) return new Map();

  const weeks = Array.from({ length: lastCompleted }, (_, i) => i + 1);
  const weekly = await Promise.all(
    weeks.map((w) => j<Matchup[]>(`/league/${lid}/matchups/${w}`, revalidate)),
  );

  const history = new Map<number, ("W" | "L" | "T")[]>();
  for (const weekMatchups of weekly) {
    const wk = resultsFromMatchups(weekMatchups || []);
    for (const [rid, res] of wk) {
      if (!history.has(rid)) history.set(rid, []);
      history.get(rid)!.push(res);
    }
  }

  const streaks = new Map<number, string>();
  for (const [rid, arr] of history) {
    let i = arr.length - 1;
    while (i >= 0 && arr[i] === "T") i--;
    if (i < 0) {
      streaks.set(rid, "—");
      continue;
    }
    const last = arr[i];
    let count = 0;
    while (i >= 0 && arr[i] === last) {
      count++;
      i--;
    }
    streaks.set(rid, `${last}${count}`);
  }
  return streaks;
}
/* ------------------------------------------------------------------ */

export default async function StandingsPage() {
  const season = new Date().getFullYear();
  const { standings } = await getApp().home(season, 1);

  // Read "My Team" roster id from cookie (works on first page load)
  const cookieStore = await cookies(); // Next 15: must await
  const myTeamCookie =
    cookieStore.get("l1.myTeamRosterId")?.value ??
    cookieStore.get("myTeam")?.value ??
    null;
  const myTeamRosterId = Number(myTeamCookie);
  const myTeamId = Number.isFinite(myTeamRosterId) ? myTeamRosterId : null;

  // Build maps of roster_id -> (team avatar URL, FAAB remaining)
  const teamAvatarByRosterId = new Map<number, string | undefined>();
  const faabByRosterId = new Map<number, number>();
  const streakByRosterId = new Map<number, string>();
  const lid =
    process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

  if (lid) {
    try {
      const [users, rosters, league] = await Promise.all([
        j<any[]>(`/league/${lid}/users`, 600),
        j<any[]>(`/league/${lid}/rosters`, 600),
        j<any>(`/league/${lid}`, 600),
      ]);
      const usersById = new Map(users.map((u) => [u.user_id, u]));
      const defaultBudget = asNum(league?.settings?.waiver_budget, 100) || 100;

      const streaks = await getStreaks(lid, asNum(league?.week, NaN));
      for (const [rid, s] of streaks) streakByRosterId.set(Number(rid), s);

      for (const r of rosters) {
        const u = usersById.get(r.owner_id);
        teamAvatarByRosterId.set(Number(r.roster_id), pickAvatarUrl(u));
      }

      const preliminaryRemaining = new Map<number, number>();
      for (const r of rosters) {
        const s = r?.settings ?? {};
        const rid = Number(r.roster_id);
        const remaining = asNum(s.waiver_balance, NaN);
        if (Number.isFinite(remaining) && remaining > 0) {
          preliminaryRemaining.set(rid, remaining);
        }
      }

      const needToCompute = rosters
        .map((r) => Number(r.roster_id))
        .filter((rid) => !preliminaryRemaining.has(rid));

      if (needToCompute.length) {
        const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
        const weeklyTxns = await Promise.all(
          weeks.map((w) => j<any[]>(`/league/${lid}/transactions/${w}`, 600)),
        );

        const spentByRoster = new Map<number, number>();
        for (const txns of weeklyTxns) {
          for (const t of txns || []) {
            if (
              (t?.type === "waiver" || t?.type === "waiver_add") &&
              t?.status === "complete"
            ) {
              const rid = asNum(
                t?.roster_id ??
                  (Array.isArray(t?.roster_ids) ? t.roster_ids[0] : undefined),
                NaN,
              );
              const bid = asNum(
                t?.waiver_bid ??
                  t?.metadata?.waiver_bid ??
                  t?.settings?.waiver_bid,
                NaN,
              );
              if (Number.isFinite(rid) && Number.isFinite(bid) && bid > 0) {
                spentByRoster.set(rid, (spentByRoster.get(rid) ?? 0) + bid);
              }
            }
          }
        }

        for (const rid of needToCompute) {
          const r = rosters.find((x) => Number(x.roster_id) === rid);
          const s = r?.settings ?? {};
          const initial = asNum(s.waiver_budget, NaN) || defaultBudget || 100;
          const spent = spentByRoster.get(rid) ?? 0;
          const remaining = Math.max(0, initial - spent);
          preliminaryRemaining.set(rid, remaining);
        }
      }

      for (const r of rosters) {
        const rid = Number(r.roster_id);
        const val = preliminaryRemaining.get(rid);
        faabByRosterId.set(rid, Number.isFinite(val!) ? Number(val) : 0);
      }
    } catch {
      // If Sleeper is unavailable, just render what we have without avatars/FAAB.
    }
  }

  // Normalize rows once for both mobile & desktop renderings
  const rows = standings.map((row: AnyRow) => {
    const id = row?.team?.id ?? row?.team_id ?? row?.id;
    const name =
      row?.team?.name ?? row?.team_name ?? row?.name ?? "Unknown Team";

    const wins = asNum(row?.wins);
    const losses = asNum(row?.losses);

    const pf = asNum(row?.points_for ?? row?.pf ?? row?.pointsFor ?? row?.fpts);
    const pa = asNum(
      row?.points_against ?? row?.pa ?? row?.pointsAgainst ?? row?.fpts_against,
    );
    const dif = pf - pa;

    const rosterId = Number(row?.team?.id);
    const computedStrk = Number.isFinite(rosterId)
      ? streakByRosterId.get(rosterId)
      : undefined;
    const strk = computedStrk ?? streakStr(row);

    const avatarUrl = Number.isFinite(rosterId)
      ? teamAvatarByRosterId.get(rosterId)
      : undefined;
    const faab = Number.isFinite(rosterId)
      ? (faabByRosterId.get(rosterId) ?? 0)
      : 0;

    const isMine =
      myTeamId != null && Number.isFinite(rosterId) && myTeamId === rosterId;

    return {
      id,
      name,
      wins,
      losses,
      pf,
      pa,
      dif,
      strk,
      avatarUrl,
      faab,
      isMine,
    };
  });

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Standings</h1>

      {/* MOBILE: compact list — all 12 teams visible, 2-line left cell; right shows W/L/PF/PA/Dif */}
      <div className="sm:hidden">
        <ul className="divide-y rounded-lg border overflow-hidden">
          {/* header */}
          <li
            className="grid items-center px-2 h-7 text-[10px] font-medium text-gray-600 bg-gray-50 tabular-nums"
            style={{
              gridTemplateColumns:
                "18px minmax(0,1fr) 24px 24px 40px 40px 34px",
            }}
          >
            <div />
            <div className="truncate">Team</div>
            <div className="text-center">W</div>
            <div className="text-center">L</div>
            <div className="text-center">PF</div>
            <div className="text-center">PA</div>
            <div className="text-center">Dif</div>
          </li>

          {rows.map((r) => (
            <li
              key={r.id}
              className={`grid items-center px-2 h-10 text-[11px] tabular-nums ${
                r.isMine ? "bg-blue-50" : ""
              }`}
              style={{
                gridTemplateColumns:
                  "18px minmax(0,1fr) 24px 24px 40px 40px 34px",
              }}
            >
              {r.avatarUrl ? (
                <img
                  src={r.avatarUrl}
                  alt=""
                  width={18}
                  height={18}
                  className="rounded-full object-cover"
                />
              ) : (
                <span className="inline-block w-[18px] h-[18px]" />
              )}

              <div className="min-w-0 leading-tight">
                <div className="truncate">{r.name}</div>
                <div className="truncate text-[10px] text-gray-500">
                  ${r.faab} • {r.strk}
                </div>
              </div>

              <span className="text-center">{r.wins}</span>
              <span className="text-center">{r.losses}</span>
              <span className="text-center">{r.pf}</span>
              <span className="text-center">{r.pa}</span>
              <span className="text-center">{r.dif}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* DESKTOP/TABLET */}
      <div className="hidden sm:block overflow-x-auto -mx-4 sm:mx-0">
        <table className="min-w-[720px] w-full border-collapse text-sm sm:text-base">
          <thead>
            <tr className="text-left text-gray-600">
              <th className="sticky left-0 z-10 bg-white py-2 pr-2">Team</th>
              <th className="px-2 py-2 text-right tabular-nums">W</th>
              <th className="px-2 py-2 text-right tabular-nums">L</th>
              <th className="px-2 py-2 text-right tabular-nums">Dif</th>
              <th className="px-2 py-2 text-right tabular-nums">PF</th>
              <th className="px-2 py-2 text-right tabular-nums">PA</th>
              <th className="px-2 py-2 text-right tabular-nums hidden md:table-cell">
                FAAB
              </th>
              <th className="px-2 py-2 text-right tabular-nums hidden md:table-cell">
                Strk
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={`border-b last:border-b-0 ${
                  r.isMine ? "bg-blue-50 outline outline-1 outline-blue-200" : ""
                }`}
              >
                <td
                  className={`sticky left-0 z-10 py-2 pr-2 ${
                    r.isMine ? "bg-blue-50" : "bg-white"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {r.avatarUrl ? (
                      <img
                        src={r.avatarUrl}
                        alt=""
                        width={22}
                        height={22}
                        className="rounded-full object-cover"
                      />
                    ) : (
                      <span className="inline-block w-[22px] h-[22px]" />
                    )}
                    <div className="flex flex-col leading-tight">
                      <span className="whitespace-nowrap">{r.name}</span>
                      <span className="text-xs text-gray-500">
                        ${r.faab} • {r.strk}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{r.wins}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {r.losses}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{r.dif}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.pf}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.pa}</td>
                <td className="px-2 py-2 text-right tabular-nums hidden md:table-cell">
                  ${r.faab}
                </td>
                <td className="px-2 py-2 text-right tabular-nums hidden md:table-cell">
                  {r.strk}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
