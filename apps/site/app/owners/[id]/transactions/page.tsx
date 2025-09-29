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
  roster_ids?: number[]; // rosters involved
  creator?: string; // user_id
  consenter_ids?: string[]; // for trades
  waiver_bid?: number | null; // FAAB bid if waiver
  adds?: Record<string, number>; // player_id -> roster_id
  drops?: Record<string, number>; // player_id -> roster_id
  draft_picks?: any[];
  metadata?: Record<string, any>;
  leg?: number; // week
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

/**
 * A transaction "involves" my roster if:
 * - roster_ids includes myRosterId, or
 * - adds/drops map to myRosterId, or
 * - (trade) consenter_ids contain my user_id (covered by roster_ids once we map user->roster),
 * We evaluate primarily via roster_ids/adds/drops to be robust for waiver losses.
 */
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

  // League id (required)
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

  // Fetch users/rosters for mapping and owner header
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

  // Resolve this page's roster
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

  // Pull all season transactions (weeks 0..18 to include preseason moves)
  const weekRange = Array.from({ length: 19 }, (_, i) => i); // 0..18
  const txSettled = await Promise.allSettled(
    weekRange.map((w) =>
      j<Transaction[]>(`/league/${lid}/transactions/${w}`, 120),
    ),
  );
  const allTx: Transaction[] = txSettled.flatMap((s) =>
    s.status === "fulfilled" ? s.value || [] : [],
  );

  // Filter to this owner’s roster
  const myTx = allTx.filter((t) => involvesMyRoster(t, myRosterId));

  // Optional: load players map (cached longer; this endpoint is big, so keep revalidate high)
  // If it ever becomes too heavy, swap to a tiny on-demand player lookup microservice.
  let playersById: Map<string, SleeperPlayer> = new Map();
  try {
    const players = await j<Record<string, SleeperPlayer>>(
      `/players/nfl`,
      86400,
    );
    playersById = new Map(Object.entries(players));
  } catch {
    // fall back silently; we’ll display player_id when names missing
  }

  // Build presentable rows
  type Row = {
    when: string; // date only
    type: string;
    details: string;
    faab: string;
    result: string;
  };

  const rows: Row[] = myTx
    .map((t) => {
      const date = fmtDate(t.status_updated);
      const type = t.type;

      // Build details string
      const addList =
        t.adds && Object.keys(t.adds).length
          ? Object.keys(t.adds)
              .filter((pid) => {
                // only list lines that touched THIS roster (for clarity)
                return Number(t.adds?.[pid]) === myRosterId;
              })
              .map((pid) => `ADD ${playerName(playersById.get(pid), pid)}`)
          : [];

      const dropList =
        t.drops && Object.keys(t.drops).length
          ? Object.keys(t.drops)
              .filter((pid) => {
                return Number(t.drops?.[pid]) === myRosterId;
              })
              .map((pid) => `DROP ${playerName(playersById.get(pid), pid)}`)
          : [];

      let details = [...addList, ...dropList].join("; ");

      // Trades: if nothing in adds/drops specifically for my roster, still show a generic marker
      if (type === "trade" && !details) {
        const others = (t.roster_ids || [])
          .filter((rid) => Number(rid) !== myRosterId)
          .map((rid) => nameByRosterId.get(Number(rid)) || `Team #${rid}`);
        details = `TRADE with ${others.join(", ") || "unknown"}`;
      }

      if (!details) details = type.toUpperCase();

      // FAAB & result
      let faab = "—";
      let result = transactionResult(t);

      if (type === "waiver") {
        const bid = asNum(t.waiver_bid, 0);
        if (t.status === "complete") {
          faab = bid ? `$${bid}` : "$0";
        } else if (t.status === "failed") {
          faab = bid ? `Bid $${bid}` : "Bid $0";
        } else {
          faab = bid ? `Bid $${bid}` : "—";
        }
      }

      return {
        when: date,
        type,
        details,
        faab,
        result,
      };
    })
    // newest first
    .sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));

  return (
    <main className="page owner" style={{ display: "grid", gap: 20 }}>
      {/* Header (consistent with other owner subpages) */}
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

      {/* Transactions table */}
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
            <col style={{ width: "110px" }} />
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
                  <td
                    style={{ padding: "8px 8px", textTransform: "capitalize" }}
                  >
                    {r.type}
                  </td>
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
