// apps/site/app/owners/[id]/schedule/page.tsx
import Link from "next/link";
import Image from "next/image";
import MyTeamClient from "../../../../components/MyTeamClient";
import { getOwner } from "../../../../lib/owners";
import { getApp } from "../../../../lib/app";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const API = "https://api.sleeper.app/v1";

// tiny server-side fetch helper
async function j<T>(path: string, revalidate = 600): Promise<T> {
  const res = await fetch(`${API}${path}`, { next: { revalidate } });
  if (!res.ok)
    throw new Error(
      `Sleeper fetch failed: ${res.status} ${res.statusText} ${path}`,
    );
  return res.json();
}

type Matchup = {
  roster_id: number;
  matchup_id: number;
  points: number;
};

export default async function OwnerSchedule(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const rosterId = Number(id);
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

  // standings → map roster -> name / record (wins, losses)
  const season = new Date().getFullYear();
  const { standings } = await getApp().home(season, 1);

  const nameByRoster = new Map<number, string>();
  const recordByRoster = new Map<number, { w: number; l: number }>();
  for (const row of standings as any[]) {
    const rid = Number(row?.team?.id ?? row?.team_id ?? row?.id);
    if (Number.isFinite(rid)) {
      const nm =
        row?.team?.name ?? row?.team_name ?? row?.name ?? `Team ${rid}`;
      nameByRoster.set(rid, nm);
      const w = Number(row?.wins ?? 0) || 0;
      const l = Number(row?.losses ?? 0) || 0;
      recordByRoster.set(rid, { w, l });
    }
  }

  const lid =
    process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

  type Row = {
    week: number;
    oppId: number | null;
    oppName: string; // "TBD" if unknown
    oppRecord: string; // "(W-L)" or ""
    myPts: number | null;
    oppPts: number | null;
  };

  const rows: Row[] = [];

  if (lid) {
    // Detect playoff start (Sleeper exposes this on league.settings), default to 15.
    const league = await j<any>(`/league/${lid}`, 600);
    const playoffStart: number =
      Number(league?.settings?.playoff_week_start) || 15;

    // We want 1..14 regular season, and two more after playoffStart to cover 15–17
    const lastWeek = Math.max(playoffStart + 2, 17); // safety, but will be 17 for typical config
    const firstWeek = 1;

    // Pull all weeks we care about
    const weekly = await Promise.all(
      Array.from(
        { length: lastWeek - firstWeek + 1 },
        (_, i) => firstWeek + i,
      ).map((w) => j<Matchup[]>(`/league/${lid}/matchups/${w}`, 600)),
    );

    // Build rows; for playoff weeks (>= playoffStart), we show "TBD" until Sleeper posts matchups.
    weekly.forEach((list, idx) => {
      const week = firstWeek + idx;
      const mine = (list || []).find((m) => Number(m.roster_id) === rosterId);
      const opp = mine
        ? (list || []).find(
            (m) =>
              m.matchup_id === mine.matchup_id &&
              Number(m.roster_id) !== rosterId,
          )
        : undefined;

      if (!mine) {
        // No matchup for this roster this week (bye/eliminated/not yet set) → show TBD in playoffs.
        const isPlayoff = week >= playoffStart;
        rows.push({
          week,
          oppId: null,
          oppName: isPlayoff ? "TBD" : "—",
          oppRecord: "",
          myPts: null,
          oppPts: null,
        });
        return;
      }

      const oppId = opp ? Number(opp.roster_id) : null;
      const oppName =
        (oppId != null ? nameByRoster.get(oppId) : null) ??
        (week >= playoffStart ? "TBD" : "—");

      const rec = oppId != null ? recordByRoster.get(oppId) : undefined;
      const oppRecord =
        rec && Number.isFinite(rec.w) && Number.isFinite(rec.l)
          ? `(${rec.w}-${rec.l})`
          : "";

      const myPts = Number.isFinite(Number(mine.points))
        ? Number(mine.points)
        : null;
      const oppPts =
        opp && Number.isFinite(Number(opp.points))
          ? Number(opp.points)
          : opp
            ? null
            : null;

      rows.push({ week, oppId, oppName, oppRecord, myPts, oppPts });
    });

    // Only keep 1..14, 15..17 even if league config is weird.
    const filtered = rows.filter(
      (r) => r.week <= 14 || (r.week >= 15 && r.week <= 17),
    );
    filtered.sort((a, b) => a.week - b.week);
    rows.length = 0;
    rows.push(...filtered);
  }

  return (
    <main className="page owner" style={{ display: "grid", gap: 20 }}>
      {/* Header card — identical to the Roster tab */}
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
        <div style={{ marginLeft: "auto" }}>
          <MyTeamClient rosterId={owner.roster_id} />
        </div>
      </div>

      <section>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col style={{ width: 80 }} />
            <col /> {/* Opponent */}
            <col style={{ width: 160 }} /> {/* Score */}
          </colgroup>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>Week</th>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>
                Opponent
              </th>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.week}>
                <td style={{ padding: "6px 8px" }}>{r.week}</td>
                <td style={{ padding: "6px 8px" }}>
                  {r.oppId != null ? (
                    <Link href={`/owners/${r.oppId}`} className="underline">
                      {r.oppName}
                    </Link>
                  ) : (
                    r.oppName
                  )}{" "}
                  <span style={{ color: "#6b7280" }}>{r.oppRecord}</span>
                </td>
                <td style={{ padding: "6px 8px" }}>
                  {r.myPts != null && r.oppPts != null
                    ? `${r.myPts.toFixed(2)} – ${r.oppPts.toFixed(2)}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p>
        <Link href="/owners">← Back to Owners</Link>
      </p>
    </main>
  );
}
