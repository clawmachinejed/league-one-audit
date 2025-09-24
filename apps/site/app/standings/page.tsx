// apps/site/app/standings/page.tsx
import { getApp } from "../../lib/app";

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
  if (len > 0 && (sign === "W" || sign === "L")) return `${sign}${len}`;
  return "—";
}

export default async function StandingsPage() {
  const season = new Date().getFullYear();
  const { standings } = await getApp().home(season, 1);

  // Build maps of roster_id -> (team avatar URL, FAAB remaining)
  const teamAvatarByRosterId = new Map<number, string | undefined>();
  const faabByRosterId = new Map<number, number>();
  const lid =
    process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

  if (lid) {
    try {
      // Pull users/rosters plus league config (for default budget)
      const [users, rosters, league] = await Promise.all([
        j<any[]>(`/league/${lid}/users`, 600),
        j<any[]>(`/league/${lid}/rosters`, 600),
        j<any>(`/league/${lid}`, 600),
      ]);
      const usersById = new Map(users.map((u) => [u.user_id, u]));
      const defaultBudget = asNum(league?.settings?.waiver_budget, 100) || 100;

      // 1) Record avatars
      for (const r of rosters) {
        const u = usersById.get(r.owner_id);
        teamAvatarByRosterId.set(Number(r.roster_id), pickAvatarUrl(u));
      }

      // 2) Try to use a real remaining balance if Sleeper provides it (> 0)
      //    Otherwise we'll compute it from transactions below.
      const preliminaryRemaining = new Map<number, number>();
      for (const r of rosters) {
        const s = r?.settings ?? {};
        const rid = Number(r.roster_id);
        const remaining = asNum(s.waiver_balance, NaN);
        if (Number.isFinite(remaining) && remaining > 0) {
          preliminaryRemaining.set(rid, remaining);
        } else {
          // keep empty – we'll compute later
        }
      }

      // 3) For any roster we still don't have, compute:
      //    remaining = initial_budget - sum(winning waiver bids)
      const needToCompute = rosters
        .map((r) => Number(r.roster_id))
        .filter((rid) => !preliminaryRemaining.has(rid));

      if (needToCompute.length) {
        // Fetch all weeks' transactions (cache ~10 min)
        // Sleeper weeks are 1..18 (regular season); grabbing all is safest and cheap with revalidate.
        const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
        const weeklyTxns = await Promise.all(
          weeks.map((w) => j<any[]>(`/league/${lid}/transactions/${w}`, 600)),
        );

        const spentByRoster = new Map<number, number>();
        for (const txns of weeklyTxns) {
          for (const t of txns || []) {
            // Count only completed waiver wins
            if (
              (t?.type === "waiver" || t?.type === "waiver_add") &&
              t?.status === "complete"
            ) {
              // roster id fields vary, cover the common shapes
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
          // If the roster tells us the initial budget, use it; else league default.
          const initial = asNum(s.waiver_budget, NaN) || defaultBudget || 100;
          const spent = spentByRoster.get(rid) ?? 0;
          const remaining = Math.max(0, initial - spent);
          preliminaryRemaining.set(rid, remaining);
        }
      }

      // 4) Finalize FAAB per roster (ensure it's a finite number)
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

    // PF/PA (support several common keys)
    const pf = asNum(row?.points_for ?? row?.pf ?? row?.pointsFor ?? row?.fpts);
    const pa = asNum(
      row?.points_against ?? row?.pa ?? row?.pointsAgainst ?? row?.fpts_against,
    );
    const dif = pf - pa;

    const strk = streakStr(row);

    // Avatar + FAAB from Sleeper users/rosters maps
    const rosterId = Number(row?.team?.id);
    const avatarUrl = Number.isFinite(rosterId)
      ? teamAvatarByRosterId.get(rosterId)
      : undefined;
    const faab = Number.isFinite(rosterId)
      ? (faabByRosterId.get(rosterId) ?? 0)
      : 0;

    return { id, name, wins, losses, pf, pa, dif, strk, avatarUrl, faab };
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
              // avatar | name | W | L | PF | PA | Dif
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
              className="grid items-center px-2 h-10 text-[11px] tabular-nums"
              style={{
                gridTemplateColumns:
                  "18px minmax(0,1fr) 24px 24px 40px 40px 34px",
              }}
            >
              {/* avatar */}
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

              {/* name + subline (FAAB • Streak) */}
              <div className="min-w-0 leading-tight">
                <div className="truncate">{r.name}</div>
                <div className="truncate text-[10px] text-gray-500">
                  ${r.faab} • {r.strk}
                </div>
              </div>

              {/* metrics */}
              <span className="text-center">{r.wins}</span>
              <span className="text-center">{r.losses}</span>
              <span className="text-center">{r.pf}</span>
              <span className="text-center">{r.pa}</span>
              <span className="text-center">{r.dif}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* DESKTOP/TABLET: full table; Pct column removed per request */}
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
              <tr key={r.id} className="border-b last:border-b-0">
                <td className="sticky left-0 z-10 bg-white py-2 pr-2">
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
