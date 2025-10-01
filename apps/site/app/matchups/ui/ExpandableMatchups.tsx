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
  starters: StarterRow[]; // already ordered as QB, RB, RB, WR, WR, TE, FLEX, FLEX, DEF
};
type MatchItem = { id: number; a: Team; b: Team };

const ORDER: Array<"QB" | "RB" | "WR" | "TE" | "FLEX" | "DEF"> = [
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

function fmtPts(n?: number | null) {
  return Number(n ?? 0).toFixed(2);
}

// "Justin Jefferson" -> "J. Jefferson"
function formatName(full?: string) {
  if (!full) return "—";
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!;
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
    <div className="mx-wrap">
      {items.map((it) => {
        const expanded = open.has(it.id);

        // pair starters by index/slot (assumes page.tsx created ordered arrays)
        const paired = ORDER.map((pos, i) => ({
          pos,
          left: it.a.starters[i] ?? null,
          right: it.b.starters[i] ?? null,
        }));

        return (
          <section className="mx-card" key={it.id}>
            {/* Header uses the same 5-col grid as rows */}
            <button
              className="mx-head mx-head5"
              onClick={() => toggle(it.id)}
              aria-expanded={expanded}
              aria-controls={`mx-${it.id}`}
            >
              {/* 1) Left team name (right-aligned). Avatar included but kept tidy */}
              <div className="mx-team-left">
                <div className="mx-teamcell mx-justify-end">
                  <span className="mx-teamname">
                    <Link href={`/owners/${it.a.rid}`} title={it.a.name}>
                      {it.a.name}
                    </Link>
                  </span>
                  <Image
                    src={it.a.avatar}
                    alt=""
                    width={20}
                    height={20}
                    className="mx-avatar"
                  />
                </div>
              </div>

              {/* 2) Left total (right-aligned) */}
              <div className="mx-pts-left">{fmtPts(it.a.pts)}</div>

              {/* 3) POS column shows VS in header */}
              <div className="mx-pos">VS</div>

              {/* 4) Right total (left-aligned) */}
              <div className="mx-pts-right">{fmtPts(it.b.pts)}</div>

              {/* 5) Right team name (left-aligned). Avatar before name on the right */}
              <div className="mx-team-right">
                <div className="mx-teamcell mx-justify-start">
                  <Image
                    src={it.b.avatar}
                    alt=""
                    width={20}
                    height={20}
                    className="mx-avatar"
                  />
                  <span className="mx-teamname">
                    <Link href={`/owners/${it.b.rid}`} title={it.b.name}>
                      {it.b.name}
                    </Link>
                  </span>
                </div>
              </div>
            </button>

            {/* Expanded player rows */}
            {expanded && (
              <div id={`mx-${it.id}`} className="mx-detail">
                {paired.map((row, idx) => (
                  <div className="mx-line5" key={idx}>
                    {/* 1) Left player name (right) */}
                    <div className="mx-name-left">
                      {formatName(row.left?.name)}
                    </div>

                    {/* 2) Left score (right) */}
                    <div className="mx-pts-left">
                      {row.left ? fmtPts(row.left.pts) : "—"}
                    </div>

                    {/* 3) POS center */}
                    <div className="mx-pos">{row.pos}</div>

                    {/* 4) Right score (left) */}
                    <div className="mx-pts-right">
                      {row.right ? fmtPts(row.right.pts) : "—"}
                    </div>

                    {/* 5) Right player name (left) */}
                    <div className="mx-name-right">
                      {formatName(row.right?.name)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      <style>{`
        /* one clean column of matchups */
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

        /* Header button reset + spacing */
        .mx-head {
          all: unset;
          cursor: pointer;
          width: 100%;
        }

        /* Shared 5-col grid for header and rows */
        .mx-head5, .mx-line5 {
          display: grid;
          grid-template-columns: 1fr 90px 56px 90px 1fr; /* name | score | POS | score | name */
          align-items: center;
          gap: 6px;
        }

        .mx-head5 {
          padding: 12px 14px;
        }
        .mx-head5:hover { background: #f8fafc; }

        /* Team name cells */
        .mx-team-left,
        .mx-team-right {
          min-width: 0; /* allow children to truncate */
        }

        /* Inner flex to arrange avatar + text while preserving truncation */
        .mx-teamcell {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .mx-justify-end { justify-content: flex-end; }
        .mx-justify-start { justify-content: flex-start; }

        .mx-teamname {
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-weight: 600;
          color: #111827;
        }

        .mx-avatar {
          border-radius: 9999px;
          object-fit: cover;
          flex: 0 0 auto;
        }

        /* Scores (align with their side) */
        .mx-pts-left {
          text-align: right;
          font-variant-numeric: tabular-nums;
          font-weight: 700;
        }
        .mx-pts-right {
          text-align: left;
          font-variant-numeric: tabular-nums;
          font-weight: 700;
        }

        /* POS center cell */
        .mx-pos {
          text-align: center;
          font-size: 11px;
          color: #6b7280; /* gray-500 */
          font-weight: 600;
          letter-spacing: 0.02em;
        }

        /* Detail area (rows) */
        .mx-detail {
          border-top: 1px solid #e5e7eb;
          background: #fafafa;
          padding: 8px 12px 10px;
        }

        .mx-line5 {
          padding: 6px 0;
        }
        .mx-line5 + .mx-line5 {
          border-top: 1px dashed #f3f4f6;
        }

        /* Player name cells */
        .mx-name-left,
        .mx-name-right {
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .mx-name-left { text-align: right; }
        .mx-name-right { text-align: left; }

        @media (max-width: 520px) {
          /* tighten fixed columns slightly on small screens */
          .mx-head5, .mx-line5 {
            grid-template-columns: 1fr 76px 48px 76px 1fr;
          }
        }
      `}</style>
    </div>
  );
}
