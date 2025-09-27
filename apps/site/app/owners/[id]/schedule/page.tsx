// apps/site/app/owners/[id]/schedule/page.tsx
import Link from "next/link";
import Image from "next/image";
import { getOwner } from "../../../../lib/owners";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API = "https://api.sleeper.app/v1";

async function j<T>(path: string, reval = 300): Promise<T> {
  const res = await fetch(`${API}${path}`, { next: { revalidate: reval } });
  if (!res.ok)
    throw new Error(
      `Sleeper fetch failed: ${res.status} ${res.statusText} ${path}`,
    );
  return res.json();
}

type Matchup = { roster_id: number; matchup_id: number; points: number };
type League = { week?: number };
type SleeperUser = {
  user_id: string;
  display_name?: string;
  metadata?: { team_name?: string };
};
type SleeperRoster = { roster_id: number; owner_id: string | null };

const asNum = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

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

function pickOpponent(
  group: Matchup[],
  myRosterId: number,
): Matchup | undefined {
  return group.find((m) => Number(m.roster_id) !== myRosterId);
}

function recordThroughWeek(
  rosterId: number,
  weeks: Matchup[][],
  throughWeek: number,
) {
  let w = 0,
    l = 0,
    t = 0;
  for (let wi = 0; wi < weeks.length && wi < throughWeek; wi++) {
    const groups = groupByMatchupId(weeks[wi]);
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

function pickTeamName(
  user: SleeperUser | undefined | null,
  rid: number,
): string {
  const metaName = user?.metadata?.team_name?.trim();
  if (metaName) return metaName;
  const display = user?.display_name?.trim();
  if (display) return display;
  return `Team #${rid}`;
}

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
  params: { id: string };
}) {
  const { id } = props.params;

  const lid =
    process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

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

  // Header (owner card)
  const maybeRosterId = Number(id);
  const owner = await getOwner(maybeRosterId);
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

  // Core league data
  const [users, rosters] = await Promise.all([
    j<SleeperUser[]>(`/league/${lid}/users`, 600),
    j<SleeperRoster[]>(`/league/${lid}/rosters`, 600),
  ]);
  const usersById = new Map(users.map((u) => [u.user_id, u]));

  // Resolve roster id from either roster_id or user_id in the URL for THIS league
  const myRosterId = resolveMyRosterId(id, rosters);
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

  type Row = {
    week: number;
    oppRosterId?: number;
    oppName?: string;
    oppRecord?: string;
    myPts?: number | null;
    oppPts?: number | null;
    final?: boolean;
    tbd: boolean;
  };

  const rows: Row[] = Array.from({ length: 14 }, (_, i) => ({
    week: i + 1,
    tbd: true,
    final: false,
  }));

  try {
    // League week (to mark finals)
    const league = await j<League>(`/league/${lid}`, 600);
    const currentWeek = asNum(league?.week, 1);
    const lastCompleted = Math.max(0, currentWeek - 1);

    // Name map for opponents
    const nameByRosterId = new Map<number, string>();
    for (const r of rosters) {
      const rid = Number(r.roster_id);
      const u = r.owner_id ? usersById.get(r.owner_id) : undefined;
      nameByRosterId.set(rid, pickTeamName(u, rid));
    }

    // Fetch all weeks (1..14)
    const settled = await Promise.allSettled(
      Array.from({ length: 14 }, (_, i) =>
        j<Matchup[]>(`/league/${lid}/matchups/${i + 1}`, 600),
      ),
    );
    const weekly: Matchup[][] = settled.map((s) =>
      s.status === "fulfilled" ? s.value || [] : [],
    );

    // Build rows
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
              const r = recordThroughWeek(oppRid, weekly, weekIdx + 1);
              return `${r.w}-${r.l}${r.t ? `-${r.t}` : ""}`;
            })()
          : undefined;

      rows[weekIdx] = {
        week: weekIdx + 1,
        tbd: false,
        final: weekIdx + 1 <= lastCompleted,
        oppRosterId: oppRid,
        oppName,
        oppRecord: oppRec,
        myPts: asNum(mine.points, null as any),
        oppPts: opp ? asNum(opp.points, null as any) : null,
      };
    }
  } catch {
    // leave TBD if Sleeper hiccups
  }

  return (
    <main className="page owner" style={{ display: "grid", gap: 20 }}>
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
              const haveScores = r.myPts != null && r.oppPts != null;
              const iWon = haveScores && r.final && r.myPts! > r.oppPts!;
              const iLost = haveScores && r.final && r.myPts! < r.oppPts!;

              const myStyle: React.CSSProperties | undefined = iWon
                ? { fontWeight: 700, color: "#16a34a" }
                : iLost
                  ? { fontWeight: 700, color: "#dc2626" }
                  : r.final && haveScores
                    ? { fontWeight: 700 }
                    : undefined;

              const scoreCell = haveScores ? (
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
                  "TBD"
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

// prod-touch:4a2313e1-4f63-4f62-a547-ba8ec5852319
