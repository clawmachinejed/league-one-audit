"use client";

import * as React from "react";
import Image from "next/image";

type Starter = {
  slot: string; // QB/RB/WR/TE/FLEX/DEF
  name: string; // already shortened (e.g., "C. Olave")
  pts: number; // fantasy points
};

type Team = {
  rid: number;
  name: string;
  avatar: string; // absolute url or /placeholder
  pts: number;
  starters: Starter[];
};

type Card = {
  id: number;
  a: Team;
  b: Team;
};

export default function ExpandableMatchups({ cards }: { cards: Card[] }) {
  const [open, setOpen] = React.useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="xm-list">
      {cards.map((m) => {
        const isOpen = open.has(m.id);
        return (
          <section
            key={m.id}
            className={`xm-card ${isOpen ? "open" : ""}`}
            onClick={() => toggle(m.id)}
          >
            {/* Collapsed header row */}
            <div className="xm-head" role="button" aria-expanded={isOpen}>
              <div className="xm-team xm-left">
                <Image
                  src={m.a.avatar || "/avatar-placeholder.png"}
                  alt=""
                  width={24}
                  height={24}
                  className="rounded-full"
                />
                <div className="xm-name">{m.a.name}</div>
              </div>

              <div className="xm-pts xm-left-pts">{m.a.pts.toFixed(2)}</div>
              <div className="xm-vs">vs</div>
              <div className="xm-pts xm-right-pts">{m.b.pts.toFixed(2)}</div>

              <div className="xm-team xm-right">
                <div className="xm-name">{m.b.name}</div>
                <Image
                  src={m.b.avatar || "/avatar-placeholder.png"}
                  alt=""
                  width={24}
                  height={24}
                  className="rounded-full"
                />
              </div>
            </div>

            {/* Expandable: 5-column mirrored starters */}
            {isOpen && (
              <div
                className="xm-body"
                onClick={(e) => {
                  // allow clicking inside without collapsing parent
                  e.stopPropagation();
                }}
              >
                <div className="xm-grid5">
                  {m.a.starters.map((la, i) => {
                    const ra = m.b.starters[i];
                    return (
                      <React.Fragment key={`${m.id}-${i}-${la.slot}`}>
                        {/* Left name (right-justified) */}
                        <div className="xm-cell xm-name left">{la.name}</div>
                        {/* Left score (right-justified) */}
                        <div className="xm-cell xm-num left">
                          {isFinite(la.pts) ? la.pts.toFixed(2) : "0.00"}
                        </div>
                        {/* POS center */}
                        <div className="xm-cell xm-pos">{la.slot}</div>
                        {/* Right score (left-justified) */}
                        <div className="xm-cell xm-num right">
                          {isFinite(ra?.pts) ? ra.pts.toFixed(2) : "0.00"}
                        </div>
                        {/* Right name (left-justified) */}
                        <div className="xm-cell xm-name right">
                          {ra?.name ?? "—"}
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        );
      })}

      <style jsx>{`
        /* Container */
        .xm-list {
          display: grid;
          gap: 12px;
        }

        .xm-card {
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          background: #fff;
          overflow: hidden;
        }

        /* Header (collapsed row) */
        .xm-head {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto 22px auto minmax(0, 1fr);
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          cursor: pointer;
        }

        .xm-team {
          display: grid;
          grid-auto-flow: column;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .xm-left {
          justify-self: start;
        }

        .xm-right {
          justify-self: end;
        }

        .xm-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 600;
          color: #111827;
        }

        .xm-pts {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          color: #111827;
          min-width: 4.5ch;
        }

        .xm-left-pts {
          text-align: right;
        }

        .xm-right-pts {
          text-align: left;
        }

        .xm-vs {
          text-align: center;
          color: #6b7280;
          font-weight: 600;
        }

        /* Body with 5-column mirrored starters */
        .xm-body {
          padding: 8px 12px 12px;
          border-top: 1px solid #e5e7eb;
          background: #fafafa;
        }

        .xm-grid5 {
          display: grid;
          grid-template-columns:
            minmax(0, 1fr) minmax(48px, auto) 36px minmax(48px, auto)
            minmax(0, 1fr);
          column-gap: 12px;
          row-gap: 8px;
        }

        .xm-cell {
          min-width: 0;
        }

        .xm-cell.xm-name.left {
          text-align: right;
          font-weight: 600;
          color: #111827;
        }

        .xm-cell.xm-name.right {
          text-align: left;
          font-weight: 600;
          color: #111827;
        }

        .xm-cell.xm-num.left {
          text-align: right;
          font-variant-numeric: tabular-nums;
          color: #111827;
        }

        .xm-cell.xm-num.right {
          text-align: left;
          font-variant-numeric: tabular-nums;
          color: #111827;
        }

        .xm-cell.xm-pos {
          text-align: center;
          color: #6b7280;
          font-weight: 600;
        }

        /* ===== Mobile refinements ===== */

        /* 440–520px: tighten middle columns a bit */
        @media (max-width: 520px) {
          .xm-head {
            grid-template-columns: minmax(0, 1fr) auto 20px auto minmax(0, 1fr);
            gap: 8px;
          }
          .xm-grid5 {
            grid-template-columns:
              minmax(0, 1fr) minmax(44px, auto) 30px minmax(44px, auto)
              minmax(0, 1fr);
            column-gap: 10px;
          }
        }

        /* <= 420px: maximize name space + allow two-line clamp in header */
        @media (max-width: 420px) {
          .xm-head {
            grid-template-columns: minmax(0, 1fr) auto 18px auto minmax(0, 1fr);
            gap: 6px;
          }
          .xm-pts {
            min-width: 4ch;
          }
          /* Let long names wrap to two lines in the header, then clamp */
          .xm-name {
            white-space: normal;
            display: -webkit-box;
            -webkit-line-clamp: 2; /* <= Two lines max */
            -webkit-box-orient: vertical;
            overflow: hidden;
            line-height: 1.15;
          }
          .xm-grid5 {
            grid-template-columns:
              minmax(0, 1fr) minmax(42px, auto) 28px minmax(42px, auto)
              minmax(0, 1fr);
            column-gap: 8px;
          }
        }
      `}</style>
    </div>
  );
}
