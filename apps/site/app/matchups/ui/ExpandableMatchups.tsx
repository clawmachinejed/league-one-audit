"use client";

import * as React from "react";

type Starter = { slot: string; name: string; pts: number };
type Side = {
  rid: number;
  name: string;
  avatar: string;
  pts: number;
  starters: Starter[];
};
export type Card = { id: number; a: Side; b: Side };
type Props = { cards?: Card[]; items?: Card[] };

/** "First Last" -> "F. Last"; keep DEF/D/ST names as-is */
function formatName(n?: string, slot?: string) {
  const name = (n || "").trim();
  if (!name) return "—";
  if (slot === "DEF" || /D\/ST/i.test(name)) return name;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

/** zip starters by order and pad if uneven */
function zipStarters(a: Starter[], b: Starter[]) {
  const max = Math.max(a.length, b.length);
  const rows: { al?: Starter; ar?: Starter; pos?: string }[] = [];
  for (let i = 0; i < max; i++) {
    const left = a[i];
    const right = b[i];
    rows.push({ al: left, ar: right, pos: left?.slot ?? right?.slot ?? "" });
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

              {/* Scores: left = right-justified, right = left-justified */}
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
        /* IMPORTANT: POS column width matches detail rows exactly (44px desktop / 36px mobile) */
        .sum-row{
          display:grid;
          align-items:center;
          gap:10px;
          grid-template-columns:
            28px
            minmax(0,1.35fr)
            72px          /* left score */
            44px          /* POS / 'vs' */
            72px          /* right score */
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

        .av{ width:24px; height:24px; border-radius:9999px; object-fit:cover; background:#f3f4f6; }
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
        .t-left{ text-align:left; }
        .t-name.t-right{
          text-align:left;
          margin-left:auto;
          width:-webkit-fit-content; width:-moz-fit-content; width:fit-content;
          max-width:100%;
          min-width:0;
        }

        .t-score{
          font-variant-numeric: tabular-nums;
          white-space:nowrap;
        }
        .t-score.t-left{  text-align:right; }
        .t-score.t-right{ text-align:left;  }

        .vs{
          grid-column: 4;
          text-align:center;      /* centered 'vs' */
          color:#6b7280;
          font-weight:600;
          white-space:nowrap;
        }

        /* ===================== DETAILS ===================== */
        .detail{
          margin-top:10px;
          border-top:1px dashed #e5e7eb;
          padding-top:10px;
          display:grid;
          gap:6px;
        }

        /* Mirrors header exactly: name | 72 | 44 | 72 | name */
        .line{
          display:grid;
          align-items:center;
          gap:8px;
          grid-template-columns:
            minmax(0,1fr)
            72px
            44px
            72px
            minmax(0,1fr);
        }

        .col.name{
          overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
          line-height:1.2; min-width:0;
        }
        .col.name.left{  text-align:left; }
        .col.name.right{ text-align:right; }

        .col.score{
          font-variant-numeric:tabular-nums; white-space:nowrap;
        }
        .col.score.left{  text-align:right; }
        .col.score.right{ text-align:left;  }

        .col.pos{
          text-align:center; white-space:nowrap;   /* centered & cannot wrap */
          font-weight:600; color:#6b7280;
        }

        /* ===================== MOBILE (≤480px) ===================== */
        @media (max-width: 480px){
          .xm-card { font-size: 0.8rem; padding:10px 6px; }

          .sum-row{
            gap:8px;
            grid-template-columns:
              24px
              minmax(0,1.4fr)
              64px        /* left score */
              36px        /* POS / 'vs' */
              64px        /* right score */
              minmax(0,1.4fr)
              24px;
          }
          .sum-left{  grid-template-columns: 24px minmax(0,1fr); }
          .sum-right{ grid-template-columns: minmax(0,1fr) 24px; }

          .line{
            grid-template-columns:
              minmax(0,1fr)
              64px
              36px
              64px
              minmax(0,1fr);
            gap:6px;
          }

          .col.name{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        }
      `}</style>
    </div>
  );
}
