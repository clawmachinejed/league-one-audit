"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";

type StarterRow = { slot: string; name: string; pts: number };
type Team = {
  rid: number;
  name: string;
  avatar: string;
  pts: number;
  starters: StarterRow[];
};
type MatchItem = { id: number; a: Team; b: Team };

// Desired order (must match server prep)
const ORDER: ("QB" | "RB" | "WR" | "TE" | "FLEX" | "DEF")[] = [
  "QB",
  "RB",
  "RB",
  "WR",
  "WR",
  "TE",
  "FLEX",
  "FLEX",
  "DEF",
];

// "Justin Jefferson" -> "J. Jefferson"
function formatName(full?: string) {
  if (!full) return "—";
  const parts = full.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0];
  const first = parts[0]!;
  const last = parts.slice(1).join(" ");
  return `${first[0]!.toUpperCase()}. ${last}`;
}

export default function ExpandableMatchups({ items }: { items: MatchItem[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="mx-matchups">
      {items.map((it) => {
        const expanded = open.has(it.id);

        return (
          <div className="mx-card" key={it.id}>
            {/* Header = 3-column grid so the VS centers with the QB row */}
            <button
              className="mx-head"
              onClick={() => toggle(it.id)}
              aria-expanded={expanded}
              aria-controls={`mx-${it.id}`}
            >
              {/* Left team */}
              <div className="mx-side mx-left">
                <Image
                  src={it.a.avatar}
                  alt=""
                  width={36}
                  height={36}
                  className="rounded-full object-cover"
                  style={{ borderRadius: "50%" }}
                />
                <div className="mx-team">
                  <Link href={`/owners/${it.a.rid}`} className="mx-name">
                    {it.a.name}
                  </Link>
                  <div className="mx-total">{it.a.pts.toFixed(2)}</div>
                </div>
              </div>

              {/* Center VS */}
              <div className="mx-center">VS</div>

              {/* Right team */}
              <div className="mx-side mx-right">
                <div className="mx-team mx-right-team">
                  <Link href={`/owners/${it.b.rid}`} className="mx-name">
                    {it.b.name}
                  </Link>
                  <div className="mx-total">{it.b.pts.toFixed(2)}</div>
                </div>
                <Image
                  src={it.b.avatar}
                  alt=""
                  width={36}
                  height={36}
                  className="rounded-full object-cover"
                  style={{ borderRadius: "50%" }}
                />
              </div>
            </button>

            {/* Expandable Starters Table */}
            {expanded && (
              <div id={`mx-${it.id}`} className="mx-detail">
                {/* table: left team | positions | right team */}
                <div className="mx-table">
                  {/* Left team column */}
                  <div className="mx-col">
                    {ORDER.map((slot, idx) => {
                      const r = it.a.starters[idx];
                      return (
                        <div className="mx-row" key={`a-${idx}`}>
                          <div className="mx-player">{formatName(r?.name)}</div>
                          <div className="mx-pts">
                            {(r?.pts ?? 0).toFixed(2)}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Position labels (only once) */}
                  <div className="mx-col mx-col-center">
                    {ORDER.map((slot, idx) => (
                      <div className="mx-row mx-row-center" key={`pos-${idx}`}>
                        {slot}
                      </div>
                    ))}
                  </div>

                  {/* Right team column */}
                  <div className="mx-col">
                    {ORDER.map((slot, idx) => {
                      const r = it.b.starters[idx];
                      return (
                        <div className="mx-row mx-row-right" key={`b-${idx}`}>
                          <div className="mx-pts">
                            {(r?.pts ?? 0).toFixed(2)}
                          </div>
                          <div className="mx-player">{formatName(r?.name)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <style>{`
        /* one column of matchups (desktop & mobile) */
        .mx-matchups {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }

        .mx-card {
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          overflow: hidden;
          background: #fff;
        }

        /* Header: 3 columns (left team | VS | right team) */
        .mx-head {
          all: unset;
          cursor: pointer;
          display: grid;
          grid-template-columns: 1fr 56px 1fr;
          align-items: center;
          gap: 8px;
          padding: 12px 14px;
        }
        .mx-head:hover { background: #f8fafc; }

        .mx-side {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .mx-left { justify-self: start; }
        .mx-right { justify-self: end; }

        .mx-team { display: grid; gap: 2px; min-width: 0; }
        .mx-right-team { text-align: right; }
        .mx-name { 
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; 
          font-weight: 600; color: #111827; 
        }
        .mx-total { font-weight: 700; font-variant-numeric: tabular-nums; }

        .mx-center { 
          text-align: center; font-weight: 700; color: #6b7280; 
          letter-spacing: 0.04em;
        }

        /* Detail */
        .mx-detail {
          border-top: 1px solid #e5e7eb;
          background: #fafafa;
          padding: 10px 12px;
        }

        .mx-table {
          display: grid;
          grid-template-columns: 1fr 70px 1fr; /* left | positions | right */
          gap: 8px;
        }

        .mx-col { display: grid; gap: 6px; }
        .mx-col-center { 
          display: grid; gap: 6px; 
        }

        .mx-row {
          display: grid; 
          grid-template-columns: 1fr 64px; /* name | pts (for left) */
          align-items: center;
          gap: 8px;
        }
        .mx-row-right { 
          grid-template-columns: 64px 1fr; /* pts | name (for right) */ 
        }

        .mx-row-center {
          grid-template-columns: 1fr;
          text-align: center;
          font-size: 12px;
          color: #6b7280;
          font-weight: 600;
        }

        .mx-player { 
          min-width: 0; 
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; 
        }
        .mx-pts { 
          text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; 
        }

        @media (max-width: 640px) {
          .mx-head { grid-template-columns: 1fr 40px 1fr; }
          .mx-table { grid-template-columns: 1fr 56px 1fr; }
          .mx-row { grid-template-columns: 1fr 56px; }
          .mx-row-right { grid-template-columns: 56px 1fr; }
        }
      `}</style>
    </div>
  );
}
