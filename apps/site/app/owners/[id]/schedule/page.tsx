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
type SleeperUser = {
  user_id: string;
  display_name?: string;
  metadata?: { team_name?: string };
};
type SleeperRoster = { roster_id: number; owner_id: string | null };

const asNum = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

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
    const groups = groupByMatchupId(weeks[widx]);
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
      break;
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

// Robustly resolve the roster we should use from either a roster_id or a user_id (for THIS league)
function resolveMyRosterId(
  idParam: string,
  rosters: SleeperRoster[],
): number | undefined {
  const maybeRid = Number(idParam);
  if (
    Number.isFinite(maybeRid) &&
    rosters.some((r) => Number(r.roster_id) === maybeRid)
  ) {
    return maybeRid; // URL is a roster_id for THIS league
  }
  const byUser = rosters.find((r) => r.owner_id === idParam); // treat as user_id
  return byUser ? Number(byUser.roster_id) : undefined;
}

export default async function OwnerSchedulePage(props: {
  params: Promise<{ id: string }>;
}) {
  // Next 15 async params
  const { id } = await props.params;

  // League id
  const lid =
    process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

  // Guard: missing env = guaranteed TBDs; show clear error
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

  // Pull league + maps
  const [_league, users, rosters] = await Promise.all([
    j<League>(`/league/${lid}`, 600).catch(() => ({}) as League),
    j<SleeperUser[]>(`/league/${lid}/users`, 600).catch(() => []),
    j<SleeperRoster[]>(`/league/${lid}/rosters`, 600).catch(() => []),
  ]);

  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const nameByRosterId = new Map<number, string>();
  for (const r of rosters) {
    const rid = Number(r.roster_id);
    const u = r.owner_id ? usersById.get(r.owner_id) : undefined;
    nameByRosterId.set(rid, pickTeamName(u, rid));
  }

  // Resolve my roster id from URL (supports roster_id or user_id)
  let myRosterId = resolveMyRosterId(id, rosters);

  // Owner header (using resolved roster id)
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

  // Fetch all 17 weeks (regular + playoffs); each week isolated with fallback
  const settled = await Promise.allSettled(
    Array.from({ length: 17 }, (_, i) =>
      j<Matchup[]>(`/league/${lid}/matchups/${i + 1}`, 600),
    ),
  );
  const weekly: Matchup[][] = settled.map((s) =>
    s.status === "fulfilled" ? s.value || [] : [],
  );

  // **Self-heal**: if myRosterId wasn’t in *any* week (common if URL had wrong id),
  // but the numeric id *does* appear in weekly data, adopt it.
  if (
    !weekly.some((wk) => wk.some((m) => Number(m.roster_id) === myRosterId))
  ) {
    const numericParam = Number(id);
    if (
      Number.isFinite(numericParam) &&
      weekly.some((wk) => wk.some((m) => Number(m.roster_id) === numericParam))
    ) {
      myRosterId = numericParam;
    }
  }

  // Diagnostics (always visible; remove after things are stable)
  const wk1 = weekly[0] || [];
  const diag = {
    lid: String(lid),
    idParam: id,
    myRosterId,
    rostersCount: rosters.length,
    wk1Count: wk1.length,
    wk1HasMine: wk1.some((m) => Number(m.roster_id) === myRosterId),
    firstRosters: rosters.slice(0, 5).map((r) => Number(r.roster_id)),
  };

  // Build schedule scaffold 1..17
  type Row = {
    week: number;
    oppRosterId?: number;
    oppName?: string;
    oppRecord?: string;
    myPts?: number | null;
    oppPts?: number | null;
    playoff: boolean;
    tbd: boolean;
    final?: boolean;
  };
  const rows: Row[] = Array.from({ length: 17 }, (_, i) => ({
    week: i + 1,
    playoff: i + 1 >= 15,
    tbd: i + 1 >= 15,
    final: false,
  }));

  const currentWeek = asNum(_league?.week, 1);
  const lastCompleted = Math.max(0, currentWeek - 1);

  // Fill regular-season weeks (1..14)
  for (let weekIdx = 0; weekIdx < 14; weekIdx++) {
    const groups = groupByMatchupId(weekly[weekIdx]);
    let mine: Matchup | undefined;
    let opp: Matchup | undefined;

    for (const [, g] of groups) {
      const m = g.find((x) => Number(x.roster_id) === myRosterId);
      if (!m) continue;
      mine = m;
      opp = pickOpponent(g, myRosterId);
      break;
    }

    if (!mine) {
      rows[weekIdx] = {
        week: weekIdx + 1,
        playoff: false,
        tbd: true,
        final: weekIdx + 1 <= lastCompleted,
      };
      continue;
    }

    const oppRid = opp ? Number(opp.roster_id) : undefined;
    const oppName =
      oppRid != null
        ? (nameByRosterId.get(oppRid) ?? `Team #${oppRid}`)
        : undefined;

    const oppRec =
      oppRid != null
        ? (() => {
            const r = recordThroughWeek(oppRid!, weekly, weekIdx + 1);
            return `${r.w}-${r.l}${r.t ? `-${r.t}` : ""}`;
          })()
        : undefined;

    rows[weekIdx] = {
      week: weekIdx + 1,
      playoff: false,
      tbd: false,
      final: weekIdx + 1 <= lastCompleted,
      oppRosterId: oppRid,
      oppName,
      oppRecord: oppRec,
      myPts: asNum(mine.points, null as any),
      oppPts: opp ? asNum(opp.points, null as any) : null,
    };
  }

  // Playoff weeks (15–17): leave TBD unless actual matchups exist
  for (let weekIdx = 14; weekIdx < 17; weekIdx++) {
    const groups = groupByMatchupId(weekly[weekIdx]);
    let mine: Matchup | undefined;
    let opp: Matchup | undefined;

    for (const [, g] of groups) {
      const m = g.find((x) => Number(x.roster_id) === myRosterId);
      if (!m) continue;
      mine = m;
      opp = pickOpponent(g, myRosterId);
      break;
    }

    if (!mine) {
      rows[weekIdx] = {
        week: weekIdx + 1,
        playoff: true,
        tbd: true,
        final: weekIdx + 1 <= lastCompleted,
      };
      continue;
    }

    const oppRid = opp ? Number(opp.roster_id) : undefined;
    const oppName =
      oppRid != null
        ? (nameByRosterId.get(oppRid) ?? `Team #${oppRid}`)
        : undefined;

    const oppRec =
      oppRid != null
        ? (() => {
            const r = recordThroughWeek(oppRid!, weekly, weekIdx + 1);
            return `${r.w}-${r.l}${r.t ? `-${r.t}` : ""}`;
          })()
        : undefined;

    rows[weekIdx] = {
      week: weekIdx + 1,
      playoff: true,
      tbd: false,
      final: weekIdx + 1 <= lastCompleted,
      oppRosterId: oppRid,
      oppName,
      oppRecord: oppRec,
      myPts: asNum(mine.points, null as any),
      oppPts: opp ? asNum(opp.points, null as any) : null,
    };
  }

  return (
    <main className="page owner" style={{ display: "grid", gap: 20 }}>
      {/* DIAGNOSTICS — remove when stable */}
      <div
        style={{
          padding: "8px",
          background: "#fff7ed",
          border: "1px solid #fed7aa",
          borderRadius: 6,
          fontSize: 12,
        }}
      >
        <b>diag.lid:</b> {diag.lid} &nbsp;|&nbsp; <b>idParam:</b> {diag.idParam}{" "}
        &nbsp;|&nbsp; <b>myRosterId:</b> {String(diag.myRosterId)}
        <br />
        <b>rosters:</b> {diag.rostersCount} (first:{" "}
        {diag.firstRosters.join(", ")}) &nbsp;|&nbsp; <b>wk1 rows:</b>{" "}
        {diag.wk1Count} &nbsp;|&nbsp; <b>wk1 has mine?</b>{" "}
        {String(diag.wk1HasMine)}
      </div>

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
            <col style={{ width: "160px" }} />
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
              const have = r.myPts != null && r.oppPts != null;
              const iWon = have && r.final && r.myPts! > r.oppPts!;
              const iLost = have && r.final && r.myPts! < r.oppPts!;
              const myStyle: React.CSSProperties | undefined = iWon
                ? { fontWeight: 700, color: "#16a34a" }
                : iLost
                  ? { fontWeight: 700, color: "#dc2626" }
                  : r.final && have
                    ? { fontWeight: 700 }
                    : undefined;

              const scoreCell = have ? (
                <span>
                  <span style={myStyle}>{r.myPts!.toFixed(2)}</span>
                  {" – "}
                  <span>{r.oppPts!.toFixed(2)}</span>
                </span>
              ) : (
                "—"
              );

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
                  <td style={{ padding: "8px 8px" }}>{scoreCell}</td>
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
