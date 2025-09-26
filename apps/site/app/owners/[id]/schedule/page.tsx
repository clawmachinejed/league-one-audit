// apps/site/app/owners/[id]/schedule/page.tsx
import Link from "next/link";

// tiny server-side fetch helper
const API = "https://api.sleeper.app/v1";
async function j<T>(path: string, revalidate = 300): Promise<T> {
  const res = await fetch(`${API}${path}`, { next: { revalidate } });
  if (!res.ok)
    throw new Error(
      `Sleeper fetch failed: ${res.status} ${res.statusText} ${path}`,
    );
  return res.json();
}

// Utility
function asNum(v: unknown, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

type Matchup = {
  matchup_id: number;
  roster_id: number;
  points: number;
};

export default async function OwnerSchedulePage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const rosterId = Number(id);

  const lid =
    process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;
  if (!lid || !Number.isFinite(rosterId)) {
    return (
      <div className="p-4 text-sm text-gray-600">Schedule unavailable.</div>
    );
  }

  // Pull league for current week, all users/rosters for name lookups
  const [league, users, rosters] = await Promise.all([
    j<any>(`/league/${lid}`, 600),
    j<any[]>(`/league/${lid}/users`, 600),
    j<any[]>(`/league/${lid}/rosters`, 600),
  ]);

  // Map roster_id -> { user_id, display_name }
  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const rosterInfo = new Map<number, { owner_id: string; name: string }>();
  for (const r of rosters) {
    const u = usersById.get(r.owner_id);
    rosterInfo.set(Number(r.roster_id), {
      owner_id: r.owner_id,
      name: u?.display_name ?? "Unknown",
    });
  }

  // Determine last completed week (don’t include current in-progress)
  let currentWeek = asNum(league?.week, NaN);
  if (!Number.isFinite(currentWeek)) {
    const state = await j<{ week: number }>(`/state/nfl`, 120);
    currentWeek = asNum(state?.week, 1);
  }
  const lastCompleted = Math.max(0, currentWeek - 1);
  if (lastCompleted === 0) {
    return (
      <div className="p-4 text-sm text-gray-600">No completed games yet.</div>
    );
  }

  // Fetch matchups for all completed weeks
  const weeks = Array.from({ length: lastCompleted }, (_, i) => i + 1);
  const weekly = await Promise.all(
    weeks.map((w) => j<Matchup[]>(`/league/${lid}/matchups/${w}`, 300)),
  );

  // Build schedule lines for this owner: week, me, opp, scores
  type Line = {
    week: number;
    mineId: number;
    oppId: number | null;
    myPts: number | null;
    oppPts: number | null;
  };
  const lines: Line[] = [];

  for (let wi = 0; wi < weeks.length; wi++) {
    const wk = weeks[wi];
    const matchups = weekly[wi] || [];

    // group by matchup_id
    const byMid = new Map<number, Matchup[]>();
    for (const m of matchups) {
      if (!byMid.has(m.matchup_id)) byMid.set(m.matchup_id, []);
      byMid.get(m.matchup_id)!.push(m);
    }

    for (const [, group] of byMid) {
      // Does this group include my roster?
      const mine = group.find((g) => Number(g.roster_id) === rosterId);
      if (!mine) continue;

      // find opponent (head-to-head assumed, but handle 3+ just in case: pick highest non-me as opp)
      const others = group.filter((g) => Number(g.roster_id) !== rosterId);
      let opponent: Matchup | undefined = others[0];
      if (others.length > 1) {
        // choose the one with the closest points to "mine" as a heuristic fallback
        opponent = others.reduce(
          (acc, cur) =>
            Math.abs(cur.points - mine.points) <
            Math.abs((acc?.points ?? 0) - mine.points)
              ? cur
              : acc,
          opponent,
        );
      }

      lines.push({
        week: wk,
        mineId: rosterId,
        oppId: opponent ? Number(opponent.roster_id) : null,
        myPts: Number.isFinite(mine.points) ? Number(mine.points) : null,
        oppPts:
          opponent && Number.isFinite(opponent.points)
            ? Number(opponent.points)
            : null,
      });
    }
  }

  // Sort by week ascending
  lines.sort((a, b) => a.week - b.week);

  return (
    <div className="p-3 sm:p-4">
      <h2 className="mb-3 text-lg font-semibold">Schedule</h2>

      <div className="overflow-x-auto -mx-3 sm:mx-0">
        <table className="min-w-[520px] w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-gray-600">
              <th className="px-2 py-2">Week</th>
              <th className="px-2 py-2">Owner</th>
              <th className="px-2 py-2">Opponent</th>
              <th className="px-2 py-2 text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((ln) => {
              const me = rosterInfo.get(ln.mineId);
              const opp =
                ln.oppId != null ? rosterInfo.get(ln.oppId) : undefined;
              const meName = me?.name ?? `Roster ${ln.mineId}`;
              const oppName =
                opp?.name ?? (ln.oppId != null ? `Roster ${ln.oppId}` : "—");
              const score =
                ln.myPts != null && ln.oppPts != null
                  ? `${ln.myPts} – ${ln.oppPts}`
                  : "—";

              return (
                <tr
                  key={`${ln.week}-${ln.mineId}`}
                  className="border-b last:border-b-0"
                >
                  <td className="px-2 py-2">{ln.week}</td>
                  <td className="px-2 py-2">
                    <Link
                      href={`/owners/${ln.mineId}`}
                      className="underline underline-offset-2 hover:opacity-80"
                    >
                      {meName}
                    </Link>
                  </td>
                  <td className="px-2 py-2">
                    {ln.oppId != null ? (
                      <Link
                        href={`/owners/${ln.oppId}`}
                        className="underline underline-offset-2 hover:opacity-80"
                      >
                        {oppName}
                      </Link>
                    ) : (
                      oppName
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{score}</td>
                </tr>
              );
            })}
            {lines.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-6 text-center text-gray-500">
                  No games found yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
