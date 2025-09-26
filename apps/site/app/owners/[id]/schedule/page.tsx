// apps/site/app/owners/[id]/schedule/page.tsx
import Link from "next/link";
import Image from "next/image";
import { getOwner } from "../../../../lib/owners";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API = "https://api.sleeper.app/v1";

// tiny fetch helper with Next caching hints
async function j<T>(path: string, revalidate = 300): Promise<T> {
  const res = await fetch(`${API}${path}`, { next: { revalidate } });
  if (!res.ok) {
    throw new Error(
      `Sleeper fetch failed: ${res.status} ${res.statusText} ${path}`,
    );
  }
  return res.json();
}

type Matchup = {
  roster_id: number;
  matchup_id: number;
  points: number;
};

function asNum(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// Group a week's matchups by matchup_id
function groupByMatchupId(
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

// Compute W/L/T record for a roster up to and including a weekIndex (1-based)
function recordThroughWeek(
  rosterId: number,
  weeks: Matchup[][],
  throughWeek: number,
) {
  let w = 0,
    l = 0,
    t = 0;
  for (let widx = 0; widx < weeks.length && widx < throughWeek; widx++) {
    const wk = weeks[widx];
    const groups = groupByMatchupId(wk);
    for (const [, g] of groups) {
      const mine = g.find((r) => Number(r.roster_id) === rosterId);
      if (!mine) continue;

      let max = -Infinity;
      for (const r of g) max = Math.max(max, asNum(r.points, 0));
      const top = g.filter((r) => asNum(r.points, 0) === max);

      if (top.length > 1) {
        if (top.some((r) => Number(r.roster_id) === rosterId)) t++;
        else l++;
      } else {
        const winnerRid = Number(top[0].roster_id);
        if (winnerRid === rosterId) w++;
        else l++;
      }
      break; // one matchup group per roster per week
    }
  }
  return { w, l, t };
}

// Find the opponent for this roster within a group's array
function pickOpponent(
  group: Matchup[],
  myRosterId: number,
): Matchup | undefined {
  return group.find((m) => Number(m.roster_id) !== myRosterId);
}

export default async function OwnerSchedulePage(props: {
  params: Promise<{ id: string }>;
}) {
  // Params (Next 15: async)
  const { id } = await props.params;
  const rosterId = Number(id);

  // Owner header info (avatar, record, PF/PA)
  const owner = await getOwner(rosterId);
  if (!owner) {
    return (
      <main className="page owner">
        <p>Owner not found.</p>
        <p>
          <Link href="/owners">← Back to Owners</Link>
        </p>
      </main>
    );
  }

  // Only show regular season (Weeks 1–14)
  type Row = {
    week: number;
    oppRosterId?: number;
    oppName?: string;
    oppRecord?: string;
    myPts?: number | null;
    oppPts?: number | null;
    tbd: boolean;
  };
  const REG_WEEKS = 14;
  const rows: Row[] = Array.from({ length: REG_WEEKS }, (_, i) => ({
    week: i + 1,
    tbd: true,
  }));

  const lid =
    process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

  if (lid) {
    try {
      // Fetch only weeks 1..14
      const weekly: Matchup[][] = await Promise.all(
        Array.from({ length: REG_WEEKS }, (_, i) =>
          j<Matchup[]>(`/league/${lid}/matchups/${i + 1}`, 600).catch(() => []),
        ),
      );

      // Resolve opponent/score + opponent record through each week
      for (let weekIdx = 0; weekIdx < REG_WEEKS; weekIdx++) {
        const wkList = weekly[weekIdx] || [];
        const groups = groupByMatchupId(wkList);

        let found: { mine: Matchup; opp?: Matchup } | null = null;

        for (const [, g] of groups) {
          const mine = g.find((m) => Number(m.roster_id) === rosterId);
          if (!mine) continue;
          found = { mine, opp: pickOpponent(g, rosterId) };
          break;
        }

        if (!found) continue;

        const oppRid = found.opp ? Number(found.opp.roster_id) : undefined;

        let oppName: string | undefined;
        if (Number.isFinite(oppRid)) {
          try {
            const oppOwner = await getOwner(oppRid!);
            oppName =
              oppOwner?.display_name || oppOwner?.team_name || String(oppRid);
          } catch {
            oppName = String(oppRid);
          }
        }

        let oppRecord: string | undefined;
        if (Number.isFinite(oppRid)) {
          const r = recordThroughWeek(oppRid!, weekly, weekIdx + 1);
          // show W-L (ties are supported internally; omit in display by request)
          oppRecord = `${r.w}-${r.l}`;
        }

        rows[weekIdx] = {
          week: weekIdx + 1,
          tbd: false,
          oppRosterId: oppRid,
          oppName,
          oppRecord,
          myPts: asNum(found.mine.points, null as any),
          oppPts: found.opp ? asNum(found.opp.points, null as any) : null,
        };
      }
    } catch {
      // Fail-soft: keep defaults (TBD rows)
    }
  }

  return (
    <main className="page owner" style={{ display: "grid", gap: 20 }}>
      {/* Header (exactly like roster page) */}
      <h1>{owner.display_name}</h1>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Image
          src={owner.avatar_url || "/avatar-placeholder.png"}
          alt=""
          width={64}
          height={64}
          style={{ borderRadius: "50%", objectFit: "cover" }}
        />
        <div>
          <div>
            Record {owner.wins}-{owner.losses}
          </div>
          <div>
            PF {owner.points_for.toFixed(1)} • PA{" "}
            {owner.points_against.toFixed(1)}
          </div>
        </div>
        <div style={{ marginLeft: "auto" }} />
      </div>

      {/* Schedule table (Weeks 1–14 only) */}
      <section>
        <h2 style={{ margin: "8px 0 12px", fontSize: 18 }}>Schedule</h2>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col style={{ width: "70px" }} /> {/* Week */}
            <col /> {/* Opponent */}
            <col style={{ width: "90px" }} /> {/* Opp Record */}
            <col style={{ width: "140px" }} /> {/* Score */}
          </colgroup>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>Week</th>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>
                Opponent
              </th>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>Opp Rec</th>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const score =
                r.myPts != null && r.oppPts != null
                  ? `${r.myPts.toFixed(2)} – ${r.oppPts.toFixed(2)}`
                  : "—";

              const opp =
                r.tbd || !r.oppRosterId ? (
                  "TBD"
                ) : (
                  <Link href={`/owners/${r.oppRosterId}`}>
                    {r.oppName || r.oppRosterId}
                  </Link>
                );

              return (
                <tr key={r.week}>
                  <td style={{ padding: "8px 8px" }}>{r.week}</td>
                  <td style={{ padding: "8px 8px" }}>{opp}</td>
                  <td style={{ padding: "8px 8px" }}>
                    {r.tbd || !r.oppRosterId ? "—" : r.oppRecord || "—"}
                  </td>
                  <td style={{ padding: "8px 8px" }}>{score}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p style={{ marginTop: 12 }}>
          <Link href="/owners">← Back to Owners</Link>
        </p>
      </section>
    </main>
  );
}
