"use client";

import * as React from "react";

type Starter = {
  slot: string; // QB/RB/...
  name: string; // "Brock Purdy"
  pts: number;
};

type Side = {
  rid: number;
  name: string;
  avatar: string; // url
  pts: number;
  starters: Starter[];
};

export type Card = {
  id: number;
  a: Side;
  b: Side;
};

type Props = { cards?: Card[]; items?: Card[] };

/** Format "First Last" -> "F. Last". Keeps D/ST or DEF-style names intact. */
function formatName(n?: string, slot?: string) {
  const name = (n || "").trim();
  if (!name) return "—";
  if (slot === "DEF" || /D\/ST/i.test(name)) return name;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const last = parts[parts.length - 1];
  const initial = first[0];
  return `${initial}. ${last}`;
}

/** zip starters by the given order and pad if uneven */
function zipStarters(a: Starter[], b: Starter[]) {
  const max = Math.max(a.length, b.length);
  const rows: { al?: Starter; ar?: Starter; pos?: string }[] = [];
  for (let i = 0; i < max; i++) {
    const left = a[i];
    const right = b[i];
    rows.push({
      al: left,
      ar: right,
      pos: left?.slot ?? right?.slot ?? "",
    });
  }
  return rows;
}

export default function ExpandableMatchups({ cards, items }: Props) {
  const list = (cards ?? items ?? []) as Card[];
  const [open, setOpen] = React.useState<Record<number, boolean>>({});

  return (
    <div className="xm-wrap">
      {list.map((c) => {
        const isOpen = !!open[c.id];
        return (
          <section
            className={`xm-card ${isOpen ? "open" : ""}`}
            key={c.id}
            onClick={() => setOpen((s) => ({ ...s, [c.id]: !s[c.id] }))}
            role="button"
            aria-expanded={isOpen}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpen((s) => ({ ...s, [c.id]: !s[c.id] }));
              }
            }}
          >
            {/* ===================== SUMMARY ROW ===================== */}
            <div className="sum-row">
              <div className="sum-left">
                <img
                  className="av avL"
                  src={c.a.avatar}
                  alt=""
                  width={24}
                  height={24}
                />
                <div className="t-name t-left">{c.a.name}</div>
              </div>

              {/* Scores: both right-aligned so detail rows can match exactly */}
              <div className="t-score t-left">{c.a.pts.toFixed(2)}</div>
              <div className="vs">vs</div>
              <div className="t-score t-right">{c.b.pts.toFixed(2)}</div>

              <div className="sum-right">
                <div className="t-name t-right">{c.b.name}</div>
                <img
                  className="av avR"
                  src={c.b.avatar}
                  alt=""
                  width={24}
                  height={24}
                />
              </div>
            </div>

            {/* ===================== DETAILS (EXPANDABLE) ===================== */}
            {isOpen && (
              <div className="detail">
                <div className="line hdr">
                  <div className="col name left">Starters</div>
                  <div className="col score left">Pts</div>
                  <div className="col pos">POS</div>
                  <div className="col score right">Pts</div>
                  <div className="col name right">Starters</div>
                </div>

                {zipStarters(c.a.starters, c.b.starters).map((row, i) => (
                  <div className="line" key={i}>
                    <div className="col name left">
                      {row.al ? formatName(row.al.name, row.al.slot) : "—"}
                    </div>
                    <div className="col score left">
                      {row.al ? row.al.pts.toFixed(2) : "—"}
                    </div>
                    <div className="col pos">{row.pos ?? ""}</div>
                    <div className="col score right">
                      {row.ar ? row.ar.pts.toFixed(2) : "—"}
                    </div>
                    <div className="col name right">
                      {row.ar ? formatName(row.ar.name, row.ar.slot) : "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      <style>{`
        .xm-wrap{
          display:grid;
          gap:12px;
        }
        .xm-card{
          border:1px solid #e5e7eb;
          border-radius:12px;
          padding:10px 8px;
          background:#fff;
          cursor:pointer;
        }
        .xm-card:focus-visible{ outline:2px solid #2563eb; outline-offset:2px; }

        /* ===================== SUMMARY (STRICT GRID) ===================== */
        .sum-row{
          display:grid;
          align-items:center;
          gap:10px;
          /* 7 strict columns:
             [1] L avatar | [2] L name | [3] L score | [4] vs | [5] R score | [6] R name | [7] R avatar */
          grid-template-columns:
            28px
            minmax(0,1.35fr)
            72px
            20px
            72px
            minmax(0,1.35fr)
            28px;
        }

        .sum-left,
        .sum-right{
          display:grid;
          align-items:center;
          min-width:0;
          gap:8px;
        }
        .sum-left{  grid-column: 1 / span 2; grid-template-columns: 28px minmax(0,1fr); }
        .sum-right{ grid-column: 6 / span 2; grid-template-columns: minmax(0,1fr) 28px; }

        .av{
          width:24px; height:24px; border-radius:9999px; object-fit:cover; background:#f3f4f6;
        }
        .avL{ justify-self:start; }
        .avR{ justify-self:end; }

        .t-name{
          font-weight:500;
          line-height:1.2;
          min-width:0;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
        }
        .t-left{  text-align:left; }

        .t-name.t-right{
          text-align:left;
          margin-left:auto;
          width:-webkit-fit-content;
          width:-moz-fit-content;
          width:fit-content;
          max-width:100%;
          min-width:0;
        }

        /* SCORES — both right-aligned to match detail lines */
        .t-score{
          font-variant-numeric: tabular-nums;
          white-space:nowrap;
          text-align:right;
        }

        .vs{
          grid-column: 4;
          text-align:center;
          color:#6b7280;
          font-weight:600;
        }

        /* ===================== DETAILS ===================== */
        .detail{
          margin-top:10px;
          border-top:1px dashed #e5e7eb;
          padding-top:10px;
          display:grid;
          gap:6px;
        }

        /* IMPORTANT: columns mirror the summary middle widths exactly:
           name | score(72) | pos(20) | score(72) | name  */
        .line{
          display:grid;
          align-items:center;
          gap:8px;
          grid-template-columns:
            minmax(0,1fr)
            72px
            20px
            72px
            minmax(0,1fr);
        }

        .line.hdr{
          color:#6b7280;
          font-size:12px;
          text-transform:uppercase;
          letter-spacing:.04em;
          font-weight:600;
        }

        /* Alignment rules */
        .col.name{
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
          line-height:1.2;
          min-width:0;
        }
        .col.name.left{  text-align:left; }
        .col.name.right{ text-align:right; }

        .col.score{
          font-variant-numeric:tabular-nums;
          white-space:nowrap;
          text-align:right; /* BOTH score columns right-justified */
        }

        .col.pos{
          text-align:center;             /* aligns with 'vs' */
          font-weight:600;
          color:#6b7280;
        }

        /* ===================== MOBILE (≤480px) ===================== */
        @media (max-width: 480px){
          .xm-card { font-size: 0.8rem; padding:10px 6px; }

          .sum-row{
            gap:8px;
            grid-template-columns:
              24px
              minmax(0,1.4fr)
              64px
              18px
              64px
              minmax(0,1.4fr)
              24px;
          }
          .sum-left{  grid-template-columns: 24px minmax(0,1fr); }
          .sum-right{ grid-template-columns: minmax(0,1fr) 24px; }

          /* Details follow the same tighter widths as header.
             Fixed widths here prevent overlap and force truncation. */
          .line{
            grid-template-columns:
              minmax(0,1fr)
              64px
              18px
              64px
              minmax(0,1fr);
            gap:6px;
          }

          /* Ensure long names don't bleed into score/pos columns */
          .col.name{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        }
      `}</style>
    </div>
  );
}
