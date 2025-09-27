// apps/site/app/owners/[id]/schedule/page.tsx
import Link from "next/link";
import Image from "next/image";
import { getOwner } from "../../../../lib/owners";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API = "https://api.sleeper.app/v1";

// tiny fetch helper with Next caching hints
async function j<T>(path: string, reval = 300): Promise<T> {
  const res = await fetch(`${API}${path}`, { next: { revalidate: reval } });
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
  return group.find((m) => Number(m.roster_id) !== myRosterId);
}

// Prefer user's custom team_name; else use display_name; else "Team #<rid>"
function pickTeamName(user: any, rid: number): string {
  const metaName =
    typeof user?.metadata?.team_name === "string" &&
    user.metadata.team_name.trim()
      ? user.metadata.team_name.trim()
      : null;
  if (metaName) return metaName;
  const display =
    typeof user?.display_name === "string" && user.display_name.trim()
      ? user.display_name.trim()
      : null;
  if (display) return display;
  return `Team #${rid}`;
}

// NEW: resolve roster from either a roster_id or a user_id (for THIS league)
function resolveMyRosterId(
  idParam: string,
  rosters: { roster_id: number; owner_id: string | null }[],
): number | undefined {
  const maybeRid = Number(idParam);
  if (
    Number.isFinite(maybeRid) &&
    rosters.some((r) => Number(r.roster_id) === maybeRid)
  ) {
    return maybeRid; // URL already is a roster_id in THIS league
  }
  const byUser = rosters.find((r) => r.owner_id === idParam); // treat as user_id
  return byUser ? Number(byUser.roster_id) : undefined;
}

export default async function OwnerSchedulePage(props: {
  params: Promise<{ id: string }>;
}) {
  // Params (Next 15: async)
  const { id } = await props.params;

  // League id
  const lid =
    process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

  // NEW: explicit guard to avoid silent TBDs when env is missing
  if (!lid) {
    return (
      <main className="page owner">
        <p>
          <strong>Missing league id.</strong> Set <code>SLEEPER_LEAGUE_ID</code>{" "}
          or <code>NEXT_PUBLIC_SLEEPER_LEAGUE_ID</code> for this app.
        </p>
        <p>
          <Link href="/owners">← Back to Owners</Link>
        </p>
      </main>
    );
  }

  // Build rosterId -> team display name map (from users + rosters)
  const [users, rosters] = await Promise.all([
    j<any[]>(`/league/${lid}/users`, 600),
    j<any[]>(`/league/${lid}/rosters`, 600),
  ]);
  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const nameByRosterId = new Map<number, string>();
  for (const r of rosters) {
    const rid = Number(r.roster_id);
    const u = usersById.get(r.owner_id);
    nameByRosterId.set(rid, pickTeamName(u, rid));
  }

  // NEW: resolve the effective roster id we should use on this page
  const myRosterId = resolveMyRosterId(id, rosters);

  // Owner header info (avatar, record, PF/PA) — use resolved roster id
  if (!myRosterId) {
    return (
      <main className="page owner">
        <p>
          Could not resolve roster for <code>{id}</code> in league{" "}
          <code>{String(lid)}</code>.
        </p>
        <p>
          <Link href="/owners">← Back to Owners</Link>
        </p>
      </main>
    );
  }

  const owner = await getOwner(myRosterId);
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

  try {
    // League (unused for now, but cheap + keeps parity with other pages)
    const _league: League = await j<League>(`/league/${lid}`, 600);

    // Fetch all 17 weeks of matchups (we only *render* 1..14; 15..17 TBD unless present)
    const weekly: Matchup[][] = await Promise.all(
      Array.from({ length: 17 }, (_, i) =>
        j<Matchup[]>(`/league/${lid}/matchups/${i + 1}`, 600).catch(() => []),
      ),
    );

    // For each regular-season week (1..14) find opponent & score
    for (let weekIdx = 0; weekIdx < 14; weekIdx++) {
      const wkList = weekly[weekIdx] || [];
      const groups = groupByMatchupId(wkList);

      let found: { mine: Matchup; opp?: Matchup } | null = null;

      for (const [, g] of groups) {
        const mine = g.find((m) => Number(m.roster_id) === myRosterId);
        if (!mine) continue;
        found = { mine, opp: pickOpponent(g, myRosterId) };
        break;
      }

      if (found) {
        const oppRid = found.opp ? Number(found.opp.roster_id) : undefined;

        // Opponent name via our map (robust + fast)
        const oppName =
          Number.isFinite(oppRid) && nameByRosterId.get(oppRid!)
            ? nameByRosterId.get(oppRid!)!
            : Number.isFinite(oppRid)
              ? `Team #${oppRid}`
              : undefined;

        // Opponent record THROUGH this week
        let oppRecord: string | undefined;
        if (Number.isFinite(oppRid)) {
          const r = recordThroughWeek(oppRid!, weekly, weekIdx + 1);
          oppRecord = `${r.w}-${r.l}${r.t ? `-${r.t}` : ""}`;
        }

        rows[weekIdx] = {
          week: weekIdx + 1,
          playoff: false,
          tbd: false,
          oppRosterId: oppRid,
          oppName,
          oppRecord,
          myPts: asNum(found.mine.points, null as any),
          oppPts: found.opp ? asNum(found.opp.points, null as any) : null,
        };
      } else {
        rows[weekIdx] = {
          week: weekIdx + 1,
          playoff: false,
          tbd: true,
        };
      }
    }

    // Playoff weeks (15–17): leave TBD unless actual matchups exist
    for (let weekIdx = 14; weekIdx < 17; weekIdx++) {
      const wkList = weekly[weekIdx] || [];
      const groups = groupByMatchupId(wkList);
      let found: { mine: Matchup; opp?: Matchup } | null = null;

      for (const [, g] of groups) {
        const mine = g.find((m) => Number(m.roster_id) === myRosterId);
        if (!mine) continue;
        found = { mine, opp: pickOpponent(g, myRosterId) };
        break;
      }

      if (found) {
        const oppRid = found.opp ? Number(found.opp.roster_id) : undefined;
        const oppName =
          Number.isFinite(oppRid) && nameByRosterId.get(oppRid!)
            ? nameByRosterId.get(oppRid!)!
            : Number.isFinite(oppRid)
              ? `Team #${oppRid}`
              : undefined;

        let oppRecord: string | undefined;
        if (Number.isFinite(oppRid)) {
          const r = recordThroughWeek(oppRid!, weekly, weekIdx + 1);
          oppRecord = `${r.w}-${r.l}${r.t ? `-${r.t}` : ""}`;
        }

        rows[weekIdx] = {
          week: weekIdx + 1,
          playoff: true,
          tbd: false,
          oppRosterId: oppRid,
          oppName,
          oppRecord,
          myPts: asNum(found.mine.points, null as any),
          oppPts: found.opp ? asNum(found.opp.points, null as any) : null,
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

  return (
    <main className="page owner" style={{ display: "grid", gap: 20 }}>
      {/* Header (same as roster page) */}
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
            <col style={{ width: "70px" }} />
            <col />
            <col style={{ width: "90px" }} />
            <col style={{ width: "140px" }} />
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
                  r.playoff ? (
                    "TBD (Playoffs)"
                  ) : (
                    "TBD"
                  )
                ) : (
                  <Link href={`/owners/${r.oppRosterId}`}>
                    {r.oppName || `Team #${r.oppRosterId}`}
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
