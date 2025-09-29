// apps/site/app/owners/[id]/transactions/page.tsx
import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
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
type WaiverBudgetMove = { sender: number; receiver: number; amount: number };

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
  status_updated?: number;
  created?: number;
  leg?: number;
  roster_ids?: number[];
  creator?: string;
  consenter_ids?: number[];
  waiver_bid?: number | string | null;
  adds?: Record<string, number>;
  drops?: Record<string, number>;
  draft_picks?: any[];
  metadata?: Record<string, any>;
  settings?: Record<string, any> | null;
  waiver_budget?: WaiverBudgetMove[];
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
    t.waiver_bid, // sometimes mirrored
    t.metadata && (t.metadata as any).waiver_bid, // occasional
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

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

  // Pull all-season transactions (0..18)
  const weeks = Array.from({ length: 19 }, (_, i) => i);
  const txSettled = await Promise.allSettled(
    weeks.map((w) => j<Transaction[]>(`/league/${lid}/transactions/${w}`, 180)),
  );
  const allTx: Transaction[] = txSettled.flatMap((s) =>
    s.status === "fulfilled" ? s.value || [] : [],
  );

  // Filter to my roster
  const myTx = allTx.filter((t) => involvesMyRoster(t, myRosterId));

  // Build set of needed player_ids (so we read only what we need)
  const neededIds = new Set<string>();
  for (const t of myTx) {
    if (t.adds) for (const pid in t.adds) neededIds.add(String(pid));
    if (t.drops) for (const pid in t.drops) neededIds.add(String(pid));
  }

  // Load players map once. Fall back to ids if it fails.
  let playersById: Map<string, SleeperPlayer> = new Map();
  try {
    const allPlayers = await j<Record<string, SleeperPlayer>>(
      `/players/nfl`,
      86400,
    );
    playersById = new Map(
      Array.from(neededIds).map((pid) => [pid, allPlayers[pid]] as const),
    );
  } catch {
    // fall back to ids
  }

  // Helpers for trade lines
  const namesForRosterAdds = (t: Transaction, rid: number) => {
    const list = t.adds
      ? Object.entries(t.adds)
          .filter(([, r]) => Number(r) === rid)
          .map(([pid]) => playerName(playersById.get(String(pid)), String(pid)))
      : [];
    return list;
  };

  type Row = {
    when: string;
    type: string;
    details: ReactNode;
    faab: string;
    result: string;
    sortKey: number;
  };

  const rows: Row[] = myTx
    .map((t) => {
      const when = fmtDate((t as any).created ?? t.status_updated);
      const type = normTypeLabel(t.type);

      const addNamesMine = t.adds
        ? Object.entries(t.adds)
            .filter(([, rid]) => Number(rid) === myRosterId)
            .map(([pid]) =>
              playerName(playersById.get(String(pid)), String(pid)),
            )
        : [];
      const dropNamesMine = t.drops
        ? Object.entries(t.drops)
            .filter(([, rid]) => Number(rid) === myRosterId)
            .map(([pid]) =>
              playerName(playersById.get(String(pid)), String(pid)),
            )
        : [];

      const lines: ReactNode[] = [];

      if (t.type === "trade") {
        // Owner (this page) receives:
        const meReceive = namesForRosterAdds(t, myRosterId);
        if (meReceive.length) {
          lines.push(
            <div key="me-r">
              {owner.display_name} receives: {meReceive.join(", ")}
            </div>,
          );
        }

        // Other partners, alphabetically by team name
        const others: number[] = Array.from(new Set<number>(t.roster_ids || []))
          .filter((rid) => Number(rid) !== myRosterId)
          .sort((a, b) => {
            const an = (
              nameByRosterId.get(Number(a)) || `Team #${a}`
            ).toLowerCase();
            const bn = (
              nameByRosterId.get(Number(b)) || `Team #${b}`
            ).toLowerCase();
            return an.localeCompare(bn);
          });

        for (const rid of others) {
          const partnerGets = namesForRosterAdds(t, Number(rid));
          if (partnerGets.length) {
            const nm = nameByRosterId.get(Number(rid)) || `Team #${rid}`;
            lines.push(
              <div key={`p-${rid}`}>
                {nm} receives: {partnerGets.join(", ")}
              </div>,
            );
          }
        }

        // FAAB transfers (append as their own lines)
        if (Array.isArray(t.waiver_budget) && t.waiver_budget.length) {
          for (let i = 0; i < t.waiver_budget.length; i++) {
            const wb = t.waiver_budget[i];
            const from =
              nameByRosterId.get(Number(wb.sender)) ?? `Team #${wb.sender}`;
            const to =
              nameByRosterId.get(Number(wb.receiver)) ?? `Team #${wb.receiver}`;
            lines.push(
              <div key={`wb-${i}`}>
                FAAB {wb.amount} from {from} to {to}
              </div>,
            );
          }
        }

        if (lines.length === 0) {
          // Fallback (no adds mapped): at least list partners
          const partnerNames = others.map(
            (rid) => nameByRosterId.get(Number(rid)) || `Team #${rid}`,
          );
          lines.push(
            <div key="trade-fallback">
              TRADE with {partnerNames.join(", ") || "unknown"}
            </div>,
          );
        }
      } else {
        // Non-trade: two lines (ADD, DROP) if present
        if (addNamesMine.length)
          lines.push(<div key="add">ADD {addNamesMine.join(", ")}</div>);
        if (dropNamesMine.length)
          lines.push(<div key="drop">DROP {dropNamesMine.join(", ")}</div>);
        if (!lines.length)
          lines.push(<div key="noop">{type.toUpperCase()}</div>);
      }

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
        details: <div className="tx-lines">{lines}</div>,
        faab,
        result,
        sortKey: (t as any).created ?? t.status_updated ?? 0,
      };
    })
    .sort((a, b) => b.sortKey - a.sortKey);

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

        {/* Desktop table */}
        <div className="tx-table">
          <table>
            <colgroup>
              <col style={{ width: "140px" }} />
              <col style={{ width: "130px" }} />
              <col />
              <col style={{ width: "110px" }} />
              <col style={{ width: "90px" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Transaction</th>
                <th>FAAB</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No transactions yet.
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.when}</td>
                    <td>{r.type}</td>
                    <td>{r.details}</td>
                    <td>{r.faab}</td>
                    <td>
                      {r.result === "Won" ? (
                        <span className="won">Won</span>
                      ) : r.result === "Lost" ? (
                        <span className="lost">Lost</span>
                      ) : r.result === "Pending" ? (
                        <span className="pending">Pending</span>
                      ) : (
                        <span>Complete</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="tx-cards">
          {rows.length === 0 ? (
            <div className="card muted">No transactions yet.</div>
          ) : (
            rows.map((r, i) => (
              <div className="card" key={i}>
                <div className="row">
                  <span className="label">Date</span>
                  <span>{r.when}</span>
                </div>
                <div className="row">
                  <span className="label">Type</span>
                  <span>{r.type}</span>
                </div>
                <div className="row">
                  <span className="label">Transaction</span>
                  <span>{r.details}</span>
                </div>
                <div className="row">
                  <span className="label">FAAB</span>
                  <span>{r.faab}</span>
                </div>
                <div className="row">
                  <span className="label">Result</span>
                  <span
                    className={
                      r.result === "Won"
                        ? "won"
                        : r.result === "Lost"
                          ? "lost"
                          : r.result === "Pending"
                            ? "pending"
                            : ""
                    }
                  >
                    {r.result}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        <p style={{ marginTop: 12 }}>
          <Link href={`/owners/${myRosterId}`}>← Back to Owner</Link>
        </p>
      </section>

      {/* plain <style> so this works in a Server Component */}
      <style>{`
        .muted { color: #6b7280; }
        .won { font-weight: 700; color: #16a34a; }
        .lost { font-weight: 700; color: #dc2626; }
        .pending { color: #6b7280; }

        .tx-lines > div { margin: 2px 0; }

        .tx-table table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }
        .tx-table th, .tx-table td {
          text-align: left;
          padding: 8px 8px;
          vertical-align: top;
          word-break: break-word;
        }
        .tx-table thead th {
          padding: 6px 8px;
        }

        .tx-cards { display: none; }

        @media (max-width: 640px) {
          .tx-table { display: none; }
          .tx-cards { display: grid; gap: 10px; }

          .card {
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 10px 12px;
          }
          .row {
            display: grid;
            grid-template-columns: 100px 1fr;
            gap: 8px;
            margin: 4px 0;
          }
          .label {
            color: #6b7280;
            font-size: 12px;
          }
        }
      `}</style>
    </main>
  );
}
