"use client";

import * as React from "react";

type Starter = {
  slot: string; // QB/RB/...
  name: string; // "B. Purdy"
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
                  className="av"
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
                  className="av"
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
          padding:10px 12px;
          background:#fff;
          cursor:pointer;
        }
        .xm-card:focus-visible{ outline:2px solid #2563eb; outline-offset:2px; }

        /* SUMMARY */
        .sum-row{
          display:grid;
          align-items:center;
          gap:10px;
          grid-template-columns:
            auto minmax(0,1fr) /* left name block */
            auto                 /* left score */
            22px                 /* vs */
            auto                 /* right score */
            minmax(0,1fr) auto;  /* right name block */
        }
        .sum-left, .sum-right{
          display:flex;
          align-items:center;
          gap:8px;
          min-width:0;
        }
        .sum-left{ grid-column:1 / span 2; }
        .sum-right{ grid-column:6 / span 2; justify-content:flex-end; }

        .av{
          width:24px; height:24px; border-radius:9999px; object-fit:cover;
          background:#f3f4f6; flex:0 0 auto;
        }

        .t-name{
          font-weight:500;
          line-height:1.2;
          min-width:0;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
        }
        .t-left{ text-align:left; }
        .t-right{ text-align:right; }

        .t-score{
          font-variant-numeric: tabular-nums;
          white-space:nowrap;
        }
        .t-score.t-left{ text-align:left; }
        .t-score.t-right{ text-align:right; }

        .vs{
          text-align:center;
          color:#6b7280;
          font-weight:600;
        }

        /* DETAILS */
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
            minmax(0,1fr)  /* left name */
            auto           /* left score */
            44px           /* POS */
            auto           /* right score */
            minmax(0,1fr); /* right name */
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

        /* ---------- MOBILE FIXES ---------- */
        @media (max-width: 480px){
          /* Give *more* room to names, shrink scores & "vs" */
          .sum-row{
            grid-template-columns:
              auto minmax(0,1.25fr)  /* left name grows */
              auto                    /* left score (narrow) */
              18px                    /* vs tight */
              auto                    /* right score (narrow) */
              minmax(0,1.25fr) auto;  /* right name grows */
            gap:8px;
          }

          /* Allow long team names to wrap, no ellipsis on mobile */
          .t-name{
            white-space:normal;
            overflow:visible;
            text-overflow:clip;
          }

          /* Details: more room to names, keep POS narrow */
          .line{
            grid-template-columns:
              minmax(0,1.2fr)
              auto
              40px
              auto
              minmax(0,1.2fr);
            gap:6px;
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
    rows.push({
      al: left,
      ar: right,
      pos: left?.slot ?? right?.slot ?? "",
    });
  }
  return rows;
}
