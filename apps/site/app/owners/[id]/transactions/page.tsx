// apps/site/app/owners/[id]/transactions/page.tsx
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

type SleeperUser = {
  user_id: string;
  display_name?: string;
  metadata?: { team_name?: string };
};
type SleeperRoster = { roster_id: number; owner_id: string | null };
type SleeperPlayer = {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string;
};

type Transaction = {
  transaction_id: string;
  type:
    | "free_agent"
    | "waiver"
    | "trade"
    | "commissioner"
    | "ir"
    | "reversal"
    | string;
  status: "complete" | "failed" | "pending" | string;
  status_updated?: number; // epoch ms
  created?: number; // epoch ms
  leg?: number; // week
  roster_ids?: number[];
  creator?: string;
  consenter_ids?: number[];
  waiver_bid?: number | null; // sometimes present
  adds?: Record<string, number>; // player_id -> roster_id
  drops?: Record<string, number>; // player_id -> roster_id
  draft_picks?: any[];
  metadata?: Record<string, any>;
  settings?: Record<string, any> | null; // documented place for waiver_bid
  waiver_budget?: Array<{ sender: number; receiver: number; amount: number }>; // FAAB moved in trades
};

const asNum = (v: unknown, d = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : d;

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

// URL id may be roster_id or user_id; resolve to THIS league's roster_id
function resolveMyRosterId(
  idParam: string,
  rosters: SleeperRoster[],
): number | undefined {
  const maybeRid = Number(idParam);
  if (
    Number.isFinite(maybeRid) &&
    rosters.some((r) => Number(r.roster_id) === maybeRid)
  )
    return maybeRid;
  const byUser = rosters.find((r) => r.owner_id === idParam);
  return byUser ? Number(byUser.roster_id) : undefined;
}

function fmtDate(epochMs?: number | null, tz = "America/Indiana/Indianapolis") {
  if (!epochMs || epochMs <= 0) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(new Date(epochMs));
  } catch {
    return new Date(epochMs).toISOString().slice(0, 10);
  }
}

function normTypeLabel(t: string) {
  const s = t.replace(/_/g, " ");
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}

function playerName(p: SleeperPlayer | undefined, id: string) {
  if (!p) return id;
  if (p.full_name && p.full_name.trim()) return p.full_name;
  const fn = (p.first_name || "").trim();
  const ln = (p.last_name || "").trim();
  const base = fn || ln ? `${fn} ${ln}`.trim() : id;
  const suffix = p.position && p.team ? ` (${p.position}-${p.team})` : "";
  return `${base}${suffix}`;
}

function transactionResult(
  t: Transaction,
): "Won" | "Lost" | "Complete" | "Pending" {
  if (t.type === "waiver") {
    if (t.status === "complete") return "Won";
    if (t.status === "failed") return "Lost";
    return "Pending";
  }
  if (t.status === "pending") return "Pending";
  return "Complete";
}

/** Canonical (per Sleeper docs) and robust waiver bid extraction. */
function extractWaiverBid(t: Transaction): number | null {
  if (t.type !== "waiver") return null;

  const candidates: unknown[] = [
    t.settings && (t.settings as any).waiver_bid, // documented
    (t as any).waiver_bid, // sometimes mirrored
    t.metadata && (t.metadata as any).waiver_bid, // occasional
  ];

  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null; // don't render $0 unless we truly know it's zero
}

/** My roster is involved if roster_ids includes it OR adds/drops touch it. */
function involvesMyRoster(t: Transaction, myRosterId: number): boolean {
  if (
    Array.isArray(t.roster_ids) &&
    t.roster_ids.some((rid) => Number(rid) === myRosterId)
  )
    return true;
  if (t.adds && Object.values(t.adds).some((rid) => Number(rid) === myRosterId))
    return true;
  if (
    t.drops &&
    Object.values(t.drops).some((rid) => Number(rid) === myRosterId)
  )
    return true;
  return false;
}

export default async function OwnerTransactionsPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  const lid =
    process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;
  if (!lid) {
    return (
      <main className="page owner">
        <p>
          <strong>Missing league id.</strong> Set <code>SLEEPER_LEAGUE_ID</code>{" "}
          or <code>NEXT_PUBLIC_SLEEPER_LEAGUE_ID</code>.
        </p>
        <p>
          <Link href="/owners">← Back to Owners</Link>
        </p>
      </main>
    );
  }

  // Users/Rosters for names + header
  const [users, rosters] = await Promise.all([
    j<SleeperUser[]>(`/league/${lid}/users`, 600),
    j<SleeperRoster[]>(`/league/${lid}/rosters`, 600),
  ]);
  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const nameByRosterId = new Map<number, string>();
  for (const r of rosters) {
    const rid = Number(r.roster_id);
    const u = r.owner_id ? usersById.get(r.owner_id) : undefined;
    nameByRosterId.set(rid, pickTeamName(u, rid));
  }

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

  // Pull all-season transactions (0..18 to catch preseason moves)
  const weeks = Array.from({ length: 19 }, (_, i) => i);
  const txSettled = await Promise.allSettled(
    weeks.map((w) => j<Transaction[]>(`/league/${lid}/transactions/${w}`, 180)),
  );
  const allTx: Transaction[] = txSettled.flatMap((s) =>
    s.status === "fulfilled" ? s.value || [] : [],
  );

  // Filter to my roster
  const myTx = allTx.filter((t) => involvesMyRoster(t, myRosterId));

  // Load players map (long cache). If it fails, we fall back to IDs.
  let playersById: Map<string, SleeperPlayer> = new Map();
  try {
    const players = await j<Record<string, SleeperPlayer>>(
      `/players/nfl`,
      86400,
    );
    playersById = new Map(Object.entries(players));
  } catch {
    // fall back to player_id
  }

  type Row = {
    when: string;
    type: string;
    details: string;
    faab: string;
    result: string;
    sortKey: number;
  };

  const rows: Row[] = myTx
    .map((t) => {
      // Prefer creation time; fall back to status_updated
      const when = fmtDate((t as any).created ?? t.status_updated);
      const type = normTypeLabel(t.type);

      // details only for lines that touch THIS roster
      const addLines = t.adds
        ? Object.entries(t.adds)
            .filter(([, rid]) => Number(rid) === myRosterId)
            .map(
              ([pid]) =>
                `ADD ${playerName(playersById.get(String(pid)), String(pid))}`,
            )
        : [];
      const dropLines = t.drops
        ? Object.entries(t.drops)
            .filter(([, rid]) => Number(rid) === myRosterId)
            .map(
              ([pid]) =>
                `DROP ${playerName(playersById.get(String(pid)), String(pid))}`,
            )
        : [];

      let details = [...addLines, ...dropLines].join("; ");

      // Trades: name partners + FAAB transfers if any
      if (t.type === "trade") {
        if (!details) {
          const others = (t.roster_ids || [])
            .filter((rid) => Number(rid) !== myRosterId)
            .map((rid) => nameByRosterId.get(Number(rid)) || `Team #${rid}`);
          details = `TRADE with ${others.join(", ") || "unknown"}`;
        }
        if (Array.isArray(t.waiver_budget) && t.waiver_budget.length) {
          const parts = t.waiver_budget.map((wb) => {
            const from =
              nameByRosterId.get(Number(wb.sender)) ?? `Team #${wb.sender}`;
            const to =
              nameByRosterId.get(Number(wb.receiver)) ?? `Team #${wb.receiver}`;
            return `FAAB ${wb.amount} from ${from} to ${to}`;
          });
          details = details
            ? `${details}; ${parts.join("; ")}`
            : parts.join("; ");
        }
      }

      if (!details) details = type.toUpperCase();

      // Result + FAAB
      const result = transactionResult(t);
      let faab = "—";
      if (t.type === "waiver") {
        const bid = extractWaiverBid(t);
        if (result === "Won") faab = bid != null ? `$${bid}` : "—";
        else if (result === "Lost")
          faab = bid != null ? `Bid $${bid}` : "Bid —";
        else faab = bid != null ? `Bid $${bid}` : "—";
      } else if (t.type === "free_agent") {
        faab = "$0";
      }

      return {
        when,
        type,
        details,
        faab,
        result,
        sortKey: (t as any).created ?? t.status_updated ?? 0,
      };
    })
    .sort((a, b) => b.sortKey - a.sortKey); // newest first

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
        <h2 style={{ margin: "8px 0 12px", fontSize: 18 }}>Transactions</h2>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col style={{ width: "120px" }} />
            <col style={{ width: "120px" }} />
            <col />
            <col style={{ width: "100px" }} />
            <col style={{ width: "90px" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>Date</th>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>Type</th>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>
                Transaction
              </th>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>FAAB</th>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  style={{ padding: "10px 8px", color: "#6b7280" }}
                >
                  No transactions yet.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: "8px 8px", whiteSpace: "nowrap" }}>
                    {r.when}
                  </td>
                  <td style={{ padding: "8px 8px" }}>{r.type}</td>
                  <td style={{ padding: "8px 8px" }}>{r.details}</td>
                  <td style={{ padding: "8px 8px" }}>{r.faab}</td>
                  <td style={{ padding: "8px 8px" }}>
                    {r.result === "Won" ? (
                      <span style={{ fontWeight: 700, color: "#16a34a" }}>
                        Won
                      </span>
                    ) : r.result === "Lost" ? (
                      <span style={{ fontWeight: 700, color: "#dc2626" }}>
                        Lost
                      </span>
                    ) : r.result === "Pending" ? (
                      <span style={{ color: "#6b7280" }}>Pending</span>
                    ) : (
                      <span>Complete</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <p style={{ marginTop: 12 }}>
          <Link href={`/owners/${myRosterId}`}>← Back to Owner</Link>
        </p>
      </section>
    </main>
  );
}

// prod-touch:7107b61d-b5a7-4174-8409-080818eca521
