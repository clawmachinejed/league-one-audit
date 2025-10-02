// apps/site/app/matchups/ui/ExpandableMatchups.tsx
"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * Extremely permissive typing so it won't block your build if the parent shape tweaks.
 */
type AnyCard = any;

export default function ExpandableMatchups({
  cards,
  items,
}: {
  cards?: AnyCard[];
  items?: AnyCard[];
}) {
  // allow either prop name; prefer `cards`
  const list = (cards ?? items ?? []) as AnyCard[];

  return (
    <div className="mx-wrap">
      {list.map((card: AnyCard) => (
        <Card key={String(card?.id ?? Math.random())} card={card} />
      ))}
      <style>{styles}</style>
    </div>
  );
}

function Card({ card }: { card: AnyCard }) {
  const [open, setOpen] = useState(false);

  const left = normalizeSide(card?.left ?? card?.a);
  const right = normalizeSide(card?.right ?? card?.b);

  const headerLabel =
    (card?.state?.label as string) ||
    "VS";

  const rows = pairStarters(left.starters, right.starters);

  return (
    <div className="mx-card">
      <button
        className="mx-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="mx-head5">
          <div className="mx-team-left mx-teamcell mx-justify-end">
            {left.avatar && (
              <Image
                src={left.avatar}
                alt=""
                width={20}
                height={20}
                className="mx-avatar"
              />
            )}
            <span className="mx-teamname">{left.name}</span>
          </div>

          <div className="mx-pts-left">{fmtPts(left.points)}</div>

          <div className="mx-pos">{headerLabel}</div>

          <div className="mx-pts-right">{fmtPts(right.points)}</div>

          <div className="mx-team-right mx-teamcell mx-justify-start">
            <span className="mx-teamname">{right.name}</span>
            {right.avatar && (
              <Image
                src={right.avatar}
                alt=""
                width={20}
                height={20}
                className="mx-avatar"
              />
            )}
          </div>
        </div>
      </button>

      {open && (
        <div className="mx-detail" role="region">
          {rows.map((r, i) => (
            <div className="mx-line5" key={i}>
              <div className="mx-name-left">{r.left?.name ?? "—"}</div>
              <div className="mx-pts-left">{fmtPts(r.left?.points)}</div>
              <div className="mx-pos">{r.pos}</div>
              <div className="mx-pts-right">{fmtPts(r.right?.points)}</div>
              <div className="mx-name-right">{r.right?.name ?? "—"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- helpers ---------- */

function fmtPts(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function normalizeSide(side: any) {
  return {
    name: (side?.name as string) || "—",
    avatar: (side?.avatar as string) || undefined,
    points: side?.points ?? side?.pts ?? 0,
    starters: Array.isArray(side?.starters) ? side.starters : [],
  };
}

type PairRow = {
  pos: string;
  left?: { name: string; points?: number };
  right?: { name: string; points?: number };
};

const ORDER = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "DEF"];

function pairStarters(left: any[], right: any[]): PairRow[] {
  const L = bucket(left);
  const R = bucket(right);
  const rows: PairRow[] = [];

  for (const pos of ORDER) {
    const l = shiftFirst(L, pos);
    const r = shiftFirst(R, pos);
    rows.push({
      pos,
      left: l ? { name: shortName(l.name), points: l.points } : undefined,
      right: r ? { name: shortName(r.name), points: r.points } : undefined,
    });
  }

  return rows;
}

function bucket(arr: any[]) {
  const m = new Map<string, any[]>();
  for (const it of arr || []) {
    const p = (String(it?.pos || it?.slot || it?.position || "") || "FLEX").toUpperCase();
    const k = normalizePos(p);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  return m;
}

function shiftFirst(map: Map<string, any[]>, pos: string) {
  const list = map.get(pos);
  if (!list || list.length === 0) return undefined;
  const x = list.shift();
  return {
    name: String(x?.name ?? x?.player ?? "—"),
    points: x?.points ?? x?.pts ?? 0,
  };
}

function normalizePos(p: string) {
  if (p.startsWith("WR")) return "WR";
  if (p.startsWith("RB")) return "RB";
  if (p.startsWith("TE")) return "TE";
  if (p.startsWith("QB")) return "QB";
  if (p.includes("FLEX")) return "FLEX";
  if (p.includes("DST") || p.includes("DEF")) return "DEF";
  return p;
}

function shortName(full: string) {
  const s = (full || "").trim();
  if (!s) return "—";
  const parts = s.split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts.pop()!;
  const first = parts[0] || "";
  const initial = first ? first[0].toUpperCase() + "." : "";
  return `${initial} ${last}`;
}

/* ---------- styles ---------- */

const styles = `
  .mx-wrap {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .mx-card {
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    background: #fff;
    overflow: hidden;
  }

  .mx-head { all: unset; cursor: pointer; width: 100%; }

  .mx-head5, .mx-line5 {
    display: grid;
    grid-template-columns: minmax(0,1fr) 90px 56px 90px minmax(0,1fr);
    align-items: center;
    gap: 6px;
  }

  .mx-head5 { padding: 12px 14px; }
  .mx-head5:hover { background: #f8fafc; }

  .mx-team-left, .mx-team-right { min-width: 0; }
  .mx-teamcell { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .mx-justify-end { justify-content: flex-end; }
  .mx-justify-start { justify-content: flex-start; }

  .mx-teamname {
    min-width: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font-weight: 600; color: #111827;
  }

  .mx-avatar { border-radius: 9999px; object-fit: cover; flex: 0 0 auto; width: 20px; height: 20px; }

  .mx-pts-left  { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
  .mx-pts-right { text-align: left;  font-variant-numeric: tabular-nums; font-weight: 700; }

  .mx-pos {
    text-align: center; font-size: 11px; color: #6b7280; font-weight: 600; letter-spacing: 0.02em;
  }

  .mx-detail { border-top: 1px solid #e5e7eb; background: #fafafa; padding: 8px 12px 10px; }
  .mx-line5 { padding: 6px 0; }
  .mx-line5 + .mx-line5 { border-top: 1px dashed #f3f4f6; }

  .mx-name-left, .mx-name-right {
    min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .mx-name-left  { text-align: right; }
  .mx-name-right { text-align: left;  }

  /* Mobile tweaks — give names more space */
  @media (max-width: 520px) {
    .mx-head5, .mx-line5 {
      grid-template-columns: minmax(0,1fr) 64px 40px 64px minmax(0,1fr);
      gap: 4px;
    }
    .mx-avatar  { width: 16px; height: 16px; }
    .mx-teamname { font-size: 14px; }
  }
`;
