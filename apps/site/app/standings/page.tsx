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

function asNum(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function pct(w: number, l: number, t = 0): string {
  const g = w + l + t;
  if (!g) return ".000";
  return (w / g).toFixed(3).replace(/^0/, "");
}
function streakStr(row: AnyRow): string {
  // Support a few shapes (e.g., {streak: "W3"} or {streak_len: 3, streak_sign: "W"})
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
      // ⬇️ IMPROVED: include league so we can fallback to budget - used
      const [league, users, rosters] = await Promise.all([
        j<any>(`/league/${lid}`, 600),
        j<any[]>(`/league/${lid}/users`, 600),
        j<any[]>(`/league/${lid}/rosters`, 600),
      ]);

      const leagueBudget = asNum(league?.settings?.waiver_budget, NaN);
      const usersById = new Map(users.map((u) => [u.user_id, u]));

      for (const r of rosters) {
        const u = usersById.get(r.owner_id);
        // Avatar: prefer team meta avatar; else user's own avatar
        teamAvatarByRosterId.set(Number(r.roster_id), pickAvatarUrl(u));

        // ⬇️ FAAB remaining: try common keys, then fall back to (leagueBudget - used)
        const s = r?.settings ?? {};
        const balance = asNum(s.waiver_balance, NaN);      // remaining (best, newer leagues)
        const remaining = asNum(s.waiver_budget, NaN);     // remaining in many leagues
        const legacy = asNum(s.waiver, NaN);               // some older leagues
        const used = asNum(s.waiver_budget_used, NaN);     // amount already spent

        let faab: number | null = null;
        if (Number.isFinite(balance)) faab = balance;
        else if (Number.isFinite(remaining)) faab = remaining;
        else if (Number.isFinite(legacy)) faab = legacy;
        else if (Number.isFinite(leagueBudget) && Number.isFinite(used))
          faab = Math.max(leagueBudget - used, 0);

        faabByRosterId.set(
          Number(r.roster_id),
          Number.isFinite(faab ?? NaN) ? (faab as number) : 0,
        );
      }
    } catch {
      // If Sleeper is unavailable, just render what we have without avatars/FAAB.
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Standings</h1>

      {/* Responsive wrapper: horizontal scroll on small screens */}
      <div className="overflow-x-auto -mx-4 sm:mx-0">
        <table className="min-w-[720px] w-full border-collapse text-sm sm:text-base">
          <thead>
            <tr className="text-left text-gray-600">
              {/* sticky first header cell so Team stays visible while scrolling */}
              <th className="sticky left-0 z-10 bg-white py-2 pr-2">Team</th>
              <th className="px-2 py-2 text-right tabular-nums">W</th>
              <th className="px-2 py-2 text-right tabular-nums">L</th>
              {/* T removed */}
              <th className="px-2 py-2 text-right tabular-nums">Pct</th>
              {/* Less-critical columns: hide on small screens, show from md+ */}
              <th className="px-2 py-2 text-right tabular-nums hidden md:table-cell">
                Dif
              </th>
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
            {standings.map((row: AnyRow) => {
              const id = row?.team?.id ?? row?.team_id ?? row?.id;
              const name =
                row?.team?.name ?? row?.team_name ?? row?.name ?? "Unknown Team";

              const wins = asNum(row?.wins);
              const losses = asNum(row?.losses);
              const ties = asNum(row?.ties ?? row?.t); // not shown, but used for Pct if present

              // PF/PA (support several common keys)
              const pf = asNum(
                row?.points_for ?? row?.pf ?? row?.pointsFor ?? row?.fpts,
              );
              const pa = asNum(
                row?.points_against ??
                  row?.pa ??
                  row?.pointsAgainst ??
                  row?.fpts_against,
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

              return (
                <tr key={id} className="border-b last:border-b-0">
                  {/* sticky first column to match header */}
                  <td className="sticky left-0 z-10 bg-white py-2 pr-2">
                    <div className="flex items-center gap-2">
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt=""
                          width={22}
                          height={22}
                          style={{ borderRadius: "50%", objectFit: "cover" }}
                        />
                      ) : (
                        <span
                          style={{
                            width: 22,
                            height: 22,
                            display: "inline-block",
                          }}
                        />
                      )}
                      <span className="whitespace-nowrap">{name}</span>
                    </div>
                  </td>

                  <td className="px-2 py-2 text-right tabular-nums">{wins}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{losses}</td>
                  {/* T column removed */}
                  <td className="px-2 py-2 text-right tabular-nums">
                    {pct(wins, losses, ties)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums hidden md:table-cell">
                    {dif}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{pf}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{pa}</td>
                  <td className="px-2 py-2 text-right tabular-nums hidden md:table-cell">
                    ${faab}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums hidden md:table-cell">
                    {strk}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
