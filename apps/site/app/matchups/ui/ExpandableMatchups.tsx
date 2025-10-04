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
            {/* SUMMARY ROW */}
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

            {/* DETAILS (expandable) */}
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
                    <div className="col name left">{row.al?.name ?? "—"}</div>
                    <div className="col score left">
                      {row.al ? row.al.pts.toFixed(2) : "—"}
                    </div>
                    <div className="col pos">{row.pos ?? ""}</div>
                    <div className="col score right">
                      {row.ar ? row.ar.pts.toFixed(2) : "—"}
                    </div>
                    <div className="col name right">{row.ar?.name ?? "—"}</div>
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
          padding:10px 8px;            /* was 10px 12px — tighten sides to reduce wasted edge space */
          background:#fff;
          cursor:pointer;
        }
        .xm-card:focus-visible{ outline:2px solid #2563eb; outline-offset:2px; }

        /* ===================== SUMMARY (STRICT GRID) ===================== */
        .sum-row{
          display:grid;
          align-items:center;
          gap:10px;
          /* 7 strict columns — NO 'auto'
             [1] avatar | [2] left name | [3] left score | [4] vs | [5] right score | [6] right name | [7] avatar */
          grid-template-columns:
            28px                 /* [1] left avatar col */
            minmax(0,1.35fr)     /* [2] left name */
            72px                 /* [3] left score (right-aligned) */
            20px                 /* [4] vs */
            72px                 /* [5] right score (left-aligned) */
            minmax(0,1.35fr)     /* [6] right name */
            28px;                /* [7] right avatar col */
        }

        /* wrappers: mini 2-col grids so avatars live in their fixed cells; no extra edge gap */
        .sum-left,
        .sum-right{
          display:grid;
          align-items:center;
          min-width:0;
          gap:8px;
        }
        .sum-left{  grid-column: 1 / span 2; grid-template-columns: 28px minmax(0,1fr); }
        .sum-right{ grid-column: 6 / span 2; grid-template-columns: minmax(0,1fr) 28px; }

        /* avatars aligned to OUTER edges to reclaim space */
        .av{
          width:24px; height:24px; border-radius:9999px; object-fit:cover; background:#f3f4f6;
        }
        .avL{ justify-self:start; }  /* left avatar hugs the left edge */
        .avR{ justify-self:end;   }  /* right avatar hugs the right edge */

        /* names: desktop/tablet single line; align left/right appropriately */
        .t-name{
          font-weight:500;
          line-height:1.2;
          min-width:0;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
        }
        .t-left{  text-align:left; }
        .t-right{ text-align:right; }

        /* SCORES — strict alignment so digits line up down the column */
        .t-score{
          font-variant-numeric: tabular-nums;
          white-space:nowrap;
        }
        .t-score.t-left{  text-align:right; }
        .t-score.t-right{ text-align:left;  }

        /* 'vs' column is fixed and centered */
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
        .line{
          display:grid;
          align-items:center;
          gap:8px;
          grid-template-columns:
            minmax(0,1fr)
            70px
            44px
            70px
            minmax(0,1fr);
        }
        .line.hdr{
          color:#6b7280;
          font-size:12px;
          text-transform:uppercase;
          letter-spacing:.04em;
          font-weight:600;
        }
        .col.name.left{ text-align:right; }
        .col.name.right{ text-align:left; }
        .col.score{ font-variant-numeric:tabular-nums; }
        .col.score.left{ text-align:left; }
        .col.score.right{ text-align:right; }
        .col.pos{
          text-align:center;
          font-weight:600;
          color:#6b7280;
        }

        /* ===================== MOBILE (≤480px) ===================== */
        @media (max-width: 480px){
          .xm-card { font-size: 0.8rem; padding:10px 6px; } /* shrink text & sides a bit more */

          /* keep strict columns, but tighten values */
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

          /* FORCE 2-line clamp with ellipsis on mobile; defeat any upstream nowrap */
          .t-name{
            white-space:normal !important;
            overflow:hidden;
            text-overflow:ellipsis;
            display:-webkit-box !important;
            -webkit-box-orient:vertical;
            -webkit-line-clamp:2;
            max-height:calc(2 * 1.2em); /* Firefox hard cap */
          }
        }
      `}</style>
    </div>
  );
}

/** zip starters by the given order and pad if uneven */
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
