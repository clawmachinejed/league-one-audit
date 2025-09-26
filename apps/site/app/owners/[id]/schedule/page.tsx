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

type League = {
  week?: number;
  settings?: { playoff_teams?: number; playoff_round_type?: string | number };
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
      // Find this roster’s entry in this group (if any)
      const mine = g.find((r) => Number(r.roster_id) === rosterId);
      if (!mine) continue;
      // Find top points in this group
      let max = -Infinity;
      for (const r of g) max = Math.max(max, asNum(r.points, 0));
      const top = g.filter((r) => asNum(r.points, 0) === max);

      if (top.length > 1) {
        // All top scorers are ties; if mine is top → T, else L
        if (top.some((r) => Number(r.roster_id) === rosterId)) t++;
        else l++;
      } else {
        const winnerRid = Number(top[0].roster_id);
        if (winnerRid === rosterId) w++;
        else l++;
      }
      break; // only one group per week for a roster
    }
  }
  return { w, l, t };
}

// Find the opponent for this roster within a group's array
function pickOpponent(
  group: Matchup[],
  myRosterId: number,
): Matchup | undefined {
  // Sleeper standard is 2 per matchup; if more, pick the first different
  return group.find((m) => Number(m.roster_id) !== myRosterId);
}

// tiny number formatter for scores
function fmtScore(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : "—";
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

  // League & matchups
  const lid =
    process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

  // Prebuild an empty schedule scaffold Wk 1..17
  type Row = {
    week: number;
    oppRosterId?: number;
    oppName?: string;
    oppRecord?: string;
    myPts?: number | null;
    oppPts?: number | null;
    playoff: boolean;
    tbd: boolean;
  };
  const rows: Row[] = Array.from({ length: 17 }, (_, i) => ({
    week: i + 1,
    playoff: i + 1 >= 15,
    tbd: i + 1 >= 15, // playoffs TBD by default until bracket set
  }));

  if (lid) {
    try {
      const league: League = await j<League>(`/league/${lid}`, 600);

      // Fetch all 17 weeks of matchups
      const weekly: Matchup[][] = await Promise.all(
        Array.from({ length: 17 }, (_, i) =>
          j<Matchup[]>(`/league/${lid}/matchups/${i + 1}`, 600).catch(() => []),
        ),
      );

      // cache for opponent names so we don't refetch owners repeatedly
      const ownerCache = new Map<number, string>();

      async function nameForRoster(rid: number): Promise<string> {
        if (ownerCache.has(rid)) return ownerCache.get(rid)!;
        try {
          const o = await getOwner(rid);
          const name = o?.display_name || String(rid);
          ownerCache.set(rid, name);
          return name;
        } catch {
          return String(rid);
        }
      }

      // For each regular-season week (1..14) attempt to find opponent & score
      for (let weekIdx = 0; weekIdx < 14; weekIdx++) {
        const wkList = weekly[weekIdx] || [];
        const groups = groupByMatchupId(wkList);

        let found: { mine: Matchup; opp?: Matchup } | null = null;

        for (const [, g] of groups) {
          const mine = g.find((m) => Number(m.roster_id) === rosterId);
          if (!mine) continue;
          found = { mine, opp: pickOpponent(g, rosterId) };
          break;
        }

        if (found) {
          const oppRid = found.opp ? Number(found.opp.roster_id) : undefined;

          // Opponent name (no team_name fallback — stick to display_name/id)
          let oppName: string | undefined;
          if (Number.isFinite(oppRid)) {
            oppName = await nameForRoster(oppRid!);
          }

          // Opponent record THROUGH this week (W-L only)
          let oppRecord: string | undefined;
          if (Number.isFinite(oppRid)) {
            const r = recordThroughWeek(oppRid!, weekly, weekIdx + 1);
            oppRecord = `${r.w}-${r.l}`;
          }

          const myPts = asNum(found.mine.points, NaN);
          const opPts = found.opp ? asNum(found.opp.points, NaN) : NaN;

          rows[weekIdx] = {
            week: weekIdx + 1,
            playoff: false,
            tbd: false,
            oppRosterId: oppRid,
            oppName,
            oppRecord,
            myPts: Number.isFinite(myPts) ? myPts : null,
            oppPts: Number.isFinite(opPts) ? opPts : null,
          };
        } else {
          // No matchup for me this week (bye or schedule gap)
          rows[weekIdx] = {
            week: weekIdx + 1,
            playoff: false,
            tbd: true,
          };
        }
      }

      // Playoff weeks (15–17): try to resolve if matchups exist (late season)
      for (let weekIdx = 14; weekIdx < 17; weekIdx++) {
        const wkList = weekly[weekIdx] || [];
        const groups = groupByMatchupId(wkList);
        let found: { mine: Matchup; opp?: Matchup } | null = null;

        for (const [, g] of groups) {
          const mine = g.find((m) => Number(m.roster_id) === rosterId);
          if (!mine) continue;
          found = { mine, opp: pickOpponent(g, rosterId) };
          break;
        }

        if (found) {
          const oppRid = found.opp ? Number(found.opp.roster_id) : undefined;

          let oppName: string | undefined;
          if (Number.isFinite(oppRid)) {
            oppName = await nameForRoster(oppRid!);
          }

          let oppRecord: string | undefined;
          if (Number.isFinite(oppRid)) {
            const r = recordThroughWeek(oppRid!, weekly, weekIdx + 1);
            oppRecord = `${r.w}-${r.l}`;
          }

          const myPts = asNum(found.mine.points, NaN);
          const opPts = found.opp ? asNum(found.opp.points, NaN) : NaN;

          rows[weekIdx] = {
            week: weekIdx + 1,
            playoff: true,
            tbd: false,
            oppRosterId: oppRid,
            oppName,
            oppRecord,
            myPts: Number.isFinite(myPts) ? myPts : null,
            oppPts: Number.isFinite(opPts) ? opPts : null,
          };
        } else {
          rows[weekIdx] = {
            week: weekIdx + 1,
            playoff: true,
            tbd: true,
          };
        }
      }
    } catch {
      // Fail-soft: keep rows as TBD
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

      {/* Schedule table */}
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
                  ? `${fmtScore(r.myPts)} – ${fmtScore(r.oppPts)}`
                  : "—";

              const opp =
                r.tbd || !r.oppRosterId ? (
                  r.playoff ? (
                    "TBD (Playoffs)"
                  ) : (
                    "TBD"
                  )
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
