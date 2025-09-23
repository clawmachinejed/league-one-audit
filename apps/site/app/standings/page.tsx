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
  if (!res.ok) {
    throw new Error(
      `Sleeper fetch failed: ${res.status} ${res.statusText} ${path}`,
    );
  }
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
      // also load league for fallback FAAB math
      const [league, users, rosters] = await Promise.all([
        j<any>(`/league/${lid}`, 600),
        j<any[]>(`/league/${lid}/users`, 600),
        j<any[]>(`/league/${lid}/rosters`, 600),
      ]);
      const usersById = new Map(users.map((u) => [u.user_id, u]));

      const leagueBudget = asNum(league?.settings?.waiver_budget, NaN);

      for (const r of rosters) {
        const u = usersById.get(r.owner_id);
        teamAvatarByRosterId.set(Number(r.roster_id), pickAvatarUrl(u));

        // FAAB remaining:
        // 1) preferred: roster.settings.waiver_balance (Sleeper provides this in many leagues)
        // 2) fallback: league.settings.waiver_budget - roster.settings.waiver_budget_used
        // 3) last resort: roster.settings.waiver
        const s = r?.settings ?? {};
        const bal = asNum(s.waiver_balance, NaN);
        let faab: number;

        if (Number.isFinite(bal)) {
          faab = bal;
        } else if (Number.isFinite(leagueBudget)) {
          const used = asNum(s.waiver_budget_used, 0);
          const computed = leagueBudget - used;
          faab = Number.isFinite(computed) ? computed : asNum(s.waiver, 0);
        } else {
          faab = asNum(s.waiver, 0);
        }

        faabByRosterId.set(Number(r.roster_id), Math.max(0, Math.round(faab)));
      }
    } catch {
      // If Sleeper is unavailable, just render what we have without avatars/FAAB.
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Standings</h1>

      {/* MOBILE (no scroll, all columns shown as a compact card) */}
      <ul className="md:hidden space-y-3">
        {standings.map((row: AnyRow) => {
          const id = row?.team?.id ?? row?.team_id ?? row?.id;
          const name =
            row?.team?.name ?? row?.team_name ?? row?.name ?? "Unknown Team";

          const wins = asNum(row?.wins);
          const losses = asNum(row?.losses);
          const ties = asNum(row?.ties ?? row?.t);
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

          const rosterId = Number(row?.team?.id);
          const avatarUrl = Number.isFinite(rosterId)
            ? teamAvatarByRosterId.get(rosterId)
            : undefined;
          const faab = Number.isFinite(rosterId)
            ? (faabByRosterId.get(rosterId) ?? 0)
            : 0;

          return (
            <li key={id} className="rounded border p-3">
              <div className="flex items-center gap-3 min-w-0">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    width={28}
                    height={28}
                    className="rounded-full shrink-0"
                    style={{ objectFit: "cover" }}
                  />
                ) : (
                  <span className="w-[28px] h-[28px] inline-block shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{name}</div>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-4 gap-x-3 gap-y-1 text-sm text-gray-700">
                <div>
                  <span className="text-gray-500">W</span> {wins}
                </div>
                <div>
                  <span className="text-gray-500">L</span> {losses}
                </div>
                <div>
                  <span className="text-gray-500">Pct</span>{" "}
                  {pct(wins, losses, ties)}
                </div>
                <div>
                  <span className="text-gray-500">Dif</span> {dif}
                </div>
                <div>
                  <span className="text-gray-500">PF</span> {pf}
                </div>
                <div>
                  <span className="text-gray-500">PA</span> {pa}
                </div>
                <div>
                  <span className="text-gray-500">FAAB</span> ${faab}
                </div>
                <div>
                  <span className="text-gray-500">Strk</span> {strk}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* DESKTOP/TABLE (classic layout) */}
      <div className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="text-left text-sm text-gray-600">
                <th className="py-2 pr-2">Team</th>
                <th className="px-2 py-2 text-right tabular-nums">W</th>
                <th className="px-2 py-2 text-right tabular-nums">L</th>
                <th className="px-2 py-2 text-right tabular-nums">Pct</th>
                <th className="px-2 py-2 text-right tabular-nums">Dif</th>
                <th className="px-2 py-2 text-right tabular-nums">PF</th>
                <th className="px-2 py-2 text-right tabular-nums">PA</th>
                <th className="px-2 py-2 text-right tabular-nums">FAAB</th>
                <th className="px-2 py-2 text-right tabular-nums">Strk</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row: AnyRow) => {
                const id = row?.team?.id ?? row?.team_id ?? row?.id;
                const name =
                  row?.team?.name ??
                  row?.team_name ??
                  row?.name ??
                  "Unknown Team";

                const wins = asNum(row?.wins);
                const losses = asNum(row?.losses);
                const ties = asNum(row?.ties ?? row?.t);
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

                const rosterId = Number(row?.team?.id);
                const avatarUrl = Number.isFinite(rosterId)
                  ? teamAvatarByRosterId.get(rosterId)
                  : undefined;
                const faab = Number.isFinite(rosterId)
                  ? (faabByRosterId.get(rosterId) ?? 0)
                  : 0;

                return (
                  <tr key={id} className="border-b last:border-b-0">
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {avatarUrl ? (
                          <img
                            src={avatarUrl}
                            alt=""
                            width={22}
                            height={22}
                            className="rounded-full shrink-0"
                            style={{ objectFit: "cover" }}
                          />
                        ) : (
                          <span className="w-[22px] h-[22px] inline-block shrink-0" />
                        )}
                        <span className="truncate">{name}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {wins}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {losses}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {pct(wins, losses, ties)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{dif}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{pf}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{pa}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      ${faab}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {strk}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
