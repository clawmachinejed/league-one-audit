"use client";

import React, { useState } from "react";
import Image from "next/image";

type Starter = { slot: string; name: string; pts: number };
type Side = {
  rid: number;
  name: string;
  avatar: string;
  pts: number;
  starters: Starter[];
};
export type Card = { id: number; a: Side; b: Side };
type Props = { cards: Card[] } | { items: Card[] };

function ExpandableMatchups(props: Props) {
  const list: Card[] = "cards" in props ? props.cards : (props as any).items;

  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="m-grid">
      {list.map((c) => {
        const isOpen = open.has(c.id);
        const leftWins = c.a.pts > c.b.pts;
        const rightWins = c.b.pts > c.a.pts;
        const tie = c.a.pts === c.b.pts;

        const leftClass = tie ? "neutral" : leftWins ? "win" : "lose";
        const rightClass = tie ? "neutral" : rightWins ? "win" : "lose";

        const rowId = `matchup-${c.id}-rows`;

        return (
          <article key={c.id} className={`m-card${isOpen ? " open" : ""}`}>
            <button
              className="headButton"
              onClick={() => toggle(c.id)}
              aria-expanded={isOpen}
              aria-controls={rowId}
            >
              <div className="rowTop">
                <Image
                  className="av"
                  src={c.a.avatar || "/avatar-placeholder.png"}
                  alt=""
                  width={32}
                  height={32}
                  unoptimized
                />
                <span className="teamName teamNameLeft" title={c.a.name}>
                  {c.a.name}
                </span>
                <span className={`score scoreLeft ${leftClass}`}>
                  {c.a.pts.toFixed(2)}
                </span>
                <span className="vs">vs</span>
                <span className={`score scoreRight ${rightClass}`}>
                  {c.b.pts.toFixed(2)}
                </span>
                <span className="teamName teamNameRight" title={c.b.name}>
                  {c.b.name}
                </span>
                <Image
                  className="av"
                  src={c.b.avatar || "/avatar-placeholder.png"}
                  alt=""
                  width={32}
                  height={32}
                  unoptimized
                />
              </div>
            </button>

            <div
              id={rowId}
              className="rows"
              style={{ display: isOpen ? "block" : "none" }}
            >
              <div className="hdr">
                <span className="muted">STARTERS</span>
                <span className="muted ptsL">PTS</span>
                <span className="muted pos">POS</span>
                <span className="muted ptsR">PTS</span>
                <span className="muted">STARTERS</span>
              </div>

              {zipStarters(c.a.starters, c.b.starters).map((row, i) => (
                <div key={i} className="line">
                  <div className="pname left" title={row.a?.name || ""}>
                    {row.a?.name ?? ""}
                  </div>
                  <div className="ppts left">{fmt(row.a?.pts)}</div>
                  <div className="slot">{row.a?.slot ?? row.b?.slot ?? ""}</div>
                  <div className="ppts right">{fmt(row.b?.pts)}</div>
                  <div className="pname right" title={row.b?.name || ""}>
                    {row.b?.name ?? ""}
                  </div>
                </div>
              ))}
            </div>

            <style jsx>{`
              .m-grid {
                display: grid;
                gap: 12px;
              }
              .m-card {
                border: 1px solid #e5e7eb;
                border-radius: 12px;
                background: #fff;
                overflow: hidden;
              }
              .headButton {
                width: 100%;
                border: 0;
                padding: 0;
                background: transparent;
                cursor: pointer;
              }

              /* Header: avatars | name | score | vs | score | name | avatar */
              .rowTop {
                display: grid;
                grid-template-columns:
                  32px minmax(0, 1fr)
                  68px 22px 68px minmax(0, 1fr) 32px;
                align-items: center;
                column-gap: 8px;
                min-height: 64px;
                max-height: 64px;
                padding: 10px 12px;
                background: #fff;
                transition: background-color 120ms ease;
              }
              .headButton:hover .rowTop,
              .headButton:focus-visible .rowTop {
                background: #fafafa;
              }
              .av {
                border-radius: 9999px;
                width: 32px;
                height: 32px;
                object-fit: cover;
                flex: 0 0 auto;
              }

              /* CSS-only two-line clamp with ellipsis */
              .teamName {
                min-width: 0;
                font-weight: 700;
                color: #111827;
                line-height: 1.2;
                font-size: 14px; /* mobile smaller baseline */
                word-break: break-word;
                display: -webkit-box;
                -webkit-box-orient: vertical;
                -webkit-line-clamp: 2;
                overflow: hidden;
                text-overflow: ellipsis;
                max-height: calc(2 * 1.2em); /* Firefox cap */
              }
              .teamNameLeft {
                text-align: left;
              }
              .teamNameRight {
                text-align: right;
              }

              .score {
                font-variant-numeric: tabular-nums;
                font-weight: 700;
                font-size: 15px; /* mobile slightly smaller */
              }
              .scoreLeft {
                text-align: right;
              }
              .scoreRight {
                text-align: left;
              }
              .win {
                color: #059669;
              }
              .lose {
                color: #dc2626;
              }
              .neutral {
                color: #111827;
              }
              .vs {
                text-align: center;
                color: #6b7280;
                font-weight: 700;
              }

              /* Expanded section (unchanged) */
              .rows {
                border-top: 1px solid #e5e7eb;
                padding: 10px 12px 12px;
              }
              .hdr {
                display: grid;
                grid-template-columns: 1fr 70px 50px 70px 1fr;
                column-gap: 8px;
                align-items: center;
                margin: 2px 0 6px;
              }
              .muted {
                color: #6b7280;
                font-size: 12px;
                font-weight: 600;
                letter-spacing: 0.02em;
              }
              .ptsL {
                text-align: right;
              }
              .pos {
                text-align: center;
              }
              .ptsR {
                text-align: left;
              }
              .line {
                display: grid;
                grid-template-columns: 1fr 70px 50px 70px 1fr;
                column-gap: 8px;
                align-items: center;
                padding: 6px 0;
              }
              .pname {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              }
              .pname.left {
                text-align: left;
                padding-right: 6px;
              }
              .pname.right {
                text-align: right;
                padding-left: 6px;
              }
              .ppts {
                font-variant-numeric: tabular-nums;
                font-weight: 600;
              }
              .ppts.left {
                text-align: right;
              }
              .ppts.right {
                text-align: left;
              }
              .slot {
                text-align: center;
                color: #6b7280;
                font-weight: 600;
                width: 50px;
              }

              @media (min-width: 640px) {
                .rowTop {
                  grid-template-columns:
                    36px minmax(0, 1fr)
                    92px 28px 92px minmax(0, 1fr) 36px;
                  min-height: 72px;
                  max-height: 72px;
                  padding: 12px 14px;
                }
                .av {
                  width: 36px;
                  height: 36px;
                }
                .teamName {
                  font-size: 16px;
                }
                .score {
                  font-size: 16px;
                }
              }
            `}</style>
          </article>
        );
      })}
    </div>
  );
}

function zipStarters(a: Starter[], b: Starter[]) {
  const max = Math.max(a?.length ?? 0, b?.length ?? 0);
  const rows: { a?: Starter; b?: Starter }[] = [];
  for (let i = 0; i < max; i++) rows.push({ a: a?.[i], b: b?.[i] });
  return rows;
}

function fmt(n?: number) {
  if (n == null || Number.isNaN(n)) return "";
  return Number(n).toFixed(2);
}

export default ExpandableMatchups;
