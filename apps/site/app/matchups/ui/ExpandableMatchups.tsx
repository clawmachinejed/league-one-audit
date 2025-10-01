// apps/site/app/matchups/ui/ExpandableMatchups.tsx
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
    <div className="m-grid">
      {items.map((it) => {
        const expanded = open.has(it.id);

        return (
          <div className="m-card" key={it.id}>
            {/* Header row (always visible) */}
            <button
              className="m-head"
              onClick={() => toggle(it.id)}
              aria-expanded={expanded}
            >
              {/* Team A */}
              <div className="m-side">
                <Image
                  src={it.a.avatar}
                  alt=""
                  width={36}
                  height={36}
                  className="rounded-full object-cover"
                  style={{ borderRadius: "50%" }}
                />
                <div className="m-namewrap">
                  <Link href={`/owners/${it.a.rid}`} className="m-name">
                    {it.a.name}
                  </Link>
                </div>
              </div>

              {/* Middle (scores + VS) */}
              <div className="m-mid">
                <div className="m-points">{it.a.pts.toFixed(2)}</div>
                <div className="m-vs">VS</div>
                <div className="m-points">{it.b.pts.toFixed(2)}</div>
              </div>

              {/* Team B */}
              <div className="m-side m-right">
                <div className="m-namewrap m-rightname">
                  <Link href={`/owners/${it.b.rid}`} className="m-name">
                    {it.b.name}
                  </Link>
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

            {/* Expandable starter rows */}
            {expanded && (
              <div className="m-detail">
                {/* Two columns: team A left, team B right; aligned by slot order */}
                <div className="m-table">
                  <div className="m-tcol">
                    {it.a.starters.map((r, idx) => (
                      <div className="m-row" key={`a-${idx}`}>
                        <div className="m-slot">{r.slot}</div>
                        <div className="m-player">{r.name}</div>
                        <div className="m-pts">{r.pts.toFixed(2)}</div>
                      </div>
                    ))}
                  </div>

                  <div className="m-divider" />

                  <div className="m-tcol">
                    {it.b.starters.map((r, idx) => (
                      <div className="m-row" key={`b-${idx}`}>
                        <div className="m-slot">{r.slot}</div>
                        <div className="m-player">{r.name}</div>
                        <div className="m-pts">{r.pts.toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <style>{`
        .m-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(460px,1fr));gap:12px}
        @media (max-width:640px){ .m-grid{grid-template-columns:1fr} }

        .m-card{border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#fff}
        .m-head{
          all:unset; cursor:pointer; display:grid; grid-template-columns:1fr auto 1fr;
          align-items:center; gap:8px; padding:12px 14px;
        }
        .m-head:hover{ background:#f8fafc; }
        .m-side{display:flex; align-items:center; gap:10px; min-width:0}
        .m-right{ justify-self:end }
        .m-namewrap{ min-width:0 }
        .m-rightname{ text-align:right }
        .m-name{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600; color:#111827 }
        .m-mid{ display:flex; align-items:center; gap:10px; font-variant-numeric:tabular-nums }
        .m-points{ font-weight:700 }
        .m-vs{ font-size:12px; color:#6b7280; font-weight:700; letter-spacing:0.04em }

        .m-detail{ border-top:1px solid #e5e7eb; background:#fafafa; }
        .m-table{ display:grid; grid-template-columns:1fr 1px 1fr; gap:0; }
        .m-tcol{ padding:10px 12px; display:grid; gap:6px }
        .m-divider{ background:#e5e7eb }
        .m-row{ display:grid; grid-template-columns:56px 1fr 64px; gap:8px; align-items:center }
        .m-slot{ font-size:12px; color:#6b7280; font-weight:600 }
        .m-player{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
        .m-pts{ text-align:right; font-variant-numeric:tabular-nums; font-weight:600 }
      `}</style>
    </div>
  );
}
