// apps/site/app/owners/[id]/schedule/page.tsx
import "server-only";

const API = "https://api.sleeper.app/v1";

function asNum(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

async function j<T>(path: string, revalidate = 300): Promise<T> {
  const res = await fetch(`${API}${path}`, { next: { revalidate } });
  if (!res.ok)
    throw new Error(
      `Sleeper fetch failed: ${res.status} ${res.statusText} ${path}`,
    );
  return res.json();
}

type Matchup = {
  matchup_id: number;
  roster_id: number;
  points: number;
};

type Row = {
  week: number;
  opponentName: string;
  opponentRosterId: number | null;
  myPoints: number | null;
  oppPoints: number | null;
  result: "W" | "L" | "T" | "-";
  completed: boolean;
};

function resultFrom(
  pointsA: number | null,
  pointsB: number | null,
): "W" | "L" | "T" | "-" {
  if (pointsA == null || pointsB == null) return "-";
  if (pointsA === pointsB) return "T";
  return pointsA > pointsB ? "W" : "L";
}

export default async function OwnerSchedule(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const rosterId = Number(id);
  if (!Number.isFinite(rosterId)) {
    return (
      <main className="page owner">
        <p>Invalid roster id.</p>
      </main>
    );
  }

  const lid =
    process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;
  if (!lid) {
    return (
      <main className="page owner">
        <p>League ID is not configured.</p>
      </main>
    );
  }

  // Pull league (for current week), rosters (to resolve opponent roster_id),
  // and users (to resolve opponent display_name)
  const [league, rosters, users] = await Promise.all([
    j<any>(`/league/${lid}`, 600),
    j<any[]>(`/league/${lid}/rosters`, 600),
    j<any[]>(`/league/${lid}/users`, 600),
  ]);

  // Fallback for current week if league.week is missing
  let currentWeek = asNum(league?.week, NaN);
  if (!Number.isFinite(currentWeek)) {
    const state = await j<{ week: number }>(`/state/nfl`, 120);
    currentWeek = asNum(state?.week, 1);
  }

  // Map roster_id -> owner display_name (best-effort)
  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const ownerNameByRosterId = new Map<number, string>();
  for (const r of rosters) {
    const u = usersById.get(r.owner_id);
    const name = (u?.display_name as string) || "Unknown";
    ownerNameByRosterId.set(Number(r.roster_id), name);
  }

  // Fetch matchups for a reasonable set of weeks (regular season 1..18).
  const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
  const allWeeks = await Promise.all(
    weeks.map(async (w) => ({
      week: w,
      matchups: await j<Matchup[]>(`/league/${lid}/matchups/${w}`, 300),
    })),
  );

  // Build rows for this roster
  const rows: Row[] = [];
  for (const { week, matchups } of allWeeks) {
    const mine = (matchups || []).filter(
      (m) => Number(m.roster_id) === rosterId,
    );
    if (mine.length === 0) {
      // No matchup this week (bye or not generated yet)
      rows.push({
        week,
        opponentName: "—",
        opponentRosterId: null,
        myPoints: null,
        oppPoints: null,
        result: "-",
        completed: week < currentWeek,
      });
      continue;
    }

    // In head-to-head, there should be exactly one entry for me per matchup_id.
    // Find the opponent by matching the same matchup_id with different roster_id.
    // There can be 2+ teams per matchup if multi-team matchups are enabled;
    // pick the top "other" entry.
    const myEntry = mine[0];
    const candidates = (matchups || []).filter(
      (m) =>
        m.matchup_id === myEntry.matchup_id && Number(m.roster_id) !== rosterId,
    );
    const oppEntry = candidates[0] || null;

    const myPts = myEntry ? asNum(myEntry.points, null as any) : null;
    const oppPts = oppEntry ? asNum(oppEntry.points, null as any) : null;
    const oppRosterId = oppEntry ? Number(oppEntry.roster_id) : null;
    const oppName =
      (oppRosterId != null
        ? ownerNameByRosterId.get(oppRosterId)
        : undefined) || "—";

    rows.push({
      week,
      opponentName: oppName,
      opponentRosterId: oppRosterId,
      myPoints: myPts,
      oppPoints: oppPts,
      result: resultFrom(myPts, oppPts),
      completed: week < currentWeek,
    });
  }

  const completed = rows.filter((r) => r.completed);
  const upcoming = rows.filter((r) => !r.completed);

  return (
    <main className="page owner" style={{ display: "grid", gap: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>Schedule</h2>

      {/* Completed games */}
      <section>
        <h3
          style={{
            fontSize: 14,
            fontWeight: 600,
            opacity: 0.8,
            marginBottom: 8,
          }}
        >
          Completed
        </h3>
        {completed.length ? (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
            }}
          >
            <colgroup>
              <col style={{ width: 70 }} />
              <col />
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 60 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Week</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>
                  Opponent
                </th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>
                  My Score
                </th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>
                  Opp Score
                </th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Res</th>
              </tr>
            </thead>
            <tbody>
              {completed.map((r) => (
                <tr key={`c-${r.week}`}>
                  <td style={{ padding: "6px 8px" }}>{r.week}</td>
                  <td style={{ padding: "6px 8px" }}>{r.opponentName}</td>
                  <td style={{ padding: "6px 8px" }}>
                    {r.myPoints != null ? r.myPoints.toFixed(2) : "—"}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    {r.oppPoints != null ? r.oppPoints.toFixed(2) : "—"}
                  </td>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>
                    {r.result}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ opacity: 0.7 }}>No completed games yet.</p>
        )}
      </section>

      {/* Upcoming games */}
      <section>
        <h3
          style={{
            fontSize: 14,
            fontWeight: 600,
            opacity: 0.8,
            marginBottom: 8,
          }}
        >
          Upcoming
        </h3>
        {upcoming.length ? (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
            }}
          >
            <colgroup>
              <col style={{ width: 70 }} />
              <col />
              <col style={{ width: 60 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Week</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>
                  Opponent
                </th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Res</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((r) => (
                <tr key={`u-${r.week}`}>
                  <td style={{ padding: "6px 8px" }}>{r.week}</td>
                  <td style={{ padding: "6px 8px" }}>{r.opponentName}</td>
                  <td style={{ padding: "6px 8px" }}>—</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ opacity: 0.7 }}>No upcoming games.</p>
        )}
      </section>
    </main>
  );
}
