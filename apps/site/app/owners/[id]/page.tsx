// apps/site/app/owners/[id]/page.tsx
import Link from "next/link";
import Image from "next/image";
import MyTeamClient from "../../../components/MyTeamClient";
import { getOwner } from "../../../lib/owners";

// Next 15 dynamic params must be awaited
export default async function OwnerDetail(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const owner = await getOwner(Number(id));

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

  // Build a single table with “Starters” section then “Bench”
  type Row =
    | { kind: "sep"; label: string }
    | {
        kind: "player";
        slot: string;
        name: string;
        pos: string;
        team: string | null;
        key: string;
      };

  const rows: Row[] = [
    { kind: "sep", label: "Starters" },
    ...owner.starters.map((p) => ({
      kind: "player" as const,
      slot: p.slot ?? "-",
      name: p.name,
      pos: p.pos,
      team: p.nfl ?? null,
      key: `starter-${p.id}-${p.slot ?? ""}`,
    })),
    { kind: "sep", label: "Bench" },
    ...owner.bench.map((p) => ({
      kind: "player" as const,
      slot: "-",
      name: p.name,
      pos: p.pos,
      team: p.nfl ?? null,
      key: `bench-${p.id}`,
    })),
  ];

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
            <col style={{ width: "80px" }} />
            <col />
            <col style={{ width: "80px" }} />
            <col style={{ width: "80px" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>Slot</th>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>Player</th>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>Pos</th>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>Team</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
              r.kind === "sep" ? (
                <tr key={`sep-${r.label}`}>
                  <td
                    colSpan={4}
                    style={{
                      padding: "10px 8px 6px",
                      fontSize: 12,
                      fontWeight: 600,
                      opacity: 0.7,
                    }}
                  >
                    {r.label}
                  </td>
                </tr>
              ) : (
                <tr key={r.key}>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>
                    {r.slot}
                  </td>
                  <td style={{ padding: "6px 8px" }}>{r.name}</td>
                  <td style={{ padding: "6px 8px" }}>{r.pos}</td>
                  <td style={{ padding: "6px 8px" }}>{r.team ?? "—"}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </section>

      <p>
        <Link href="/owners">← Back to Owners</Link>
      </p>
    </main>
  );
}
