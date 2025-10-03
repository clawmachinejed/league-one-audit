"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

/** Minimal local types so this file is self-contained */
type Starter = { slot: string; name: string; pts: number };
type Side = {
  rid: number;
  name: string;
  avatar: string;
  pts: number;
  starters: Starter[];
};
export type Card = { id: number; a: Side; b: Side };

// Allow either prop name to avoid page.tsx mismatch during rollouts
type Props = { cards: Card[] } | { items: Card[] };

/** Fit a name to ≤ 2 lines inside its allocated box by shrinking font-size. */
function useTwoLineAutosize() {
  const targets = useRef<HTMLElement[]>([]);
  const register = (el: HTMLElement | null) => {
    if (!el) return;
    targets.current.push(el);
  };

  useEffect(() => {
    const els = targets.current;
    const MAX_LINES = 2;
    const MAX_FS = 15; // px (mobile base)
    const MIN_FS = 10; // px floor so it never becomes unreadable
    const LINE_HEIGHT = 1.15;

    const fitOne = (el: HTMLElement) => {
      // Reset to max before measuring
      el.style.fontSize = `${MAX_FS}px`;
      el.style.lineHeight = `${LINE_HEIGHT}`;
      el.style.whiteSpace = "normal";
      el.style.overflow = "visible";

      // Compute the max allowed height in px for two lines
      // We'll recompute each try because font size varies.
      let lo = MIN_FS;
      let hi = MAX_FS;
      let best = MAX_FS;

      // Binary search the largest font-size that still fits ≤ 2 lines
      for (let i = 0; i < 8; i++) {
        const mid = Math.round((lo + hi) / 2);
        el.style.fontSize = `${mid}px`;
        // Force layout read
        const linePx = mid * LINE_HEIGHT;
        const maxHeight = linePx * MAX_LINES + 0.5; // small buffer
        const fits = el.scrollHeight <= maxHeight + 1; // tolerance

        if (fits) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      el.style.fontSize = `${best}px`;

      // After fit, prevent accidental overflow(just in case)
      // but WITHOUT ellipses; it should never trigger now.
      el.style.overflow = "hidden";
    };

    const fitAll = () => {
      // Run left→right to avoid layout thrash
      for (const el of els) fitOne(el);
    };

    fitAll();

    // Refit on resize/orientation
    const ro = new ResizeObserver(() => fitAll());
    for (const el of els) ro.observe(el);
    const onResize = () => fitAll();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      targets.current = [];
    };
  }, []);

  return register;
}

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

  // ONLY header changes: introduce two-line autosize
  const registerName = useTwoLineAutosize();

  return (
    <div className="m-grid">
      {list.map((c) => {
        const isOpen = open.has(c.id);

        // header-only: winner/loser coloring
        const leftWins = c.a.pts > c.b.pts;
        const rightWins = c.b.pts > c.a.pts;
        const tie = c.a.pts === c.b.pts;

        const rowId = `matchup-${c.id}-rows`;

        return (
          <article key={c.id} className={`m-card${isOpen ? " open" : ""}`}>
            {/* TOP ROW (HEADER) */}
            <button
              className="rowTop"
              onClick={() => toggle(c.id)}
              aria-expanded={isOpen}
              aria-controls={rowId}
            >
              {/* Left avatar (Sleeper-style round, consistent) */}
              <Image
                className="av"
                src={c.a.avatar || "/avatar-placeholder.png"}
                alt=""
                width={28}
                height={28}
                unoptimized
                priority={false}
              />

              {/* Left team name */}
              <span
                className="teamName teamNameLeft"
                title={c.a.name}
                ref={registerName as any}
              >
                {c.a.name}
              </span>

              {/* Left score */}
              <span
                className={
                  "scoreLeft " + (tie ? "neutral" : leftWins ? "win" : "lose")
                }
              >
                {c.a.pts.toFixed(2)}
              </span>

              {/* VS */}
              <span className="vs">vs</span>

              {/* Right score */}
              <span
                className={
                  "scoreRight " + (tie ? "neutral" : rightWins ? "win" : "lose")
                }
              >
                {c.b.pts.toFixed(2)}
              </span>

              {/* Right team name */}
              <span
                className="teamName teamNameRight"
                title={c.b.name}
                ref={registerName as any}
              >
                {c.b.name}
              </span>

              {/* Right avatar */}
              <Image
                className="av"
                src={c.b.avatar || "/avatar-placeholder.png"}
                alt=""
                width={28}
                height={28}
                unoptimized
                priority={false}
              />
            </button>

            {/* EXPANDED STARTERS (unchanged) */}
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

              /* ---------- TEAM HEADER ROW ---------- */
              .rowTop {
                width: 100%;
                display: grid;
                align-items: center;
                column-gap: 8px;

                /* avatars | name | score | vs | score | name | avatar */
                grid-template-columns:
                  28px minmax(0, 1fr)
                  72px 20px 72px minmax(0, 1fr) 28px;

                /* Fixed header height for uniformity across all cards */
                min-height: 64px;
                max-height: 64px;

                padding: 10px 12px;
                cursor: pointer;
                background: #fff;
                transition:
                  background-color 120ms ease,
                  box-shadow 120ms ease;
              }
              .rowTop:hover,
              .rowTop:focus-visible {
                background: #fafafa;
              }

              .av {
                border-radius: 9999px; /* round like Sleeper */
                width: 28px;
                height: 28px;
                object-fit: cover;
                flex: 0 0 auto;
              }

              /* NAMES — always wrap, never ellipsize, autosized via JS to 2 lines */
              .teamName {
                min-width: 0;
                overflow: visible; /* allow measuring, hidden after fit */
                white-space: normal;
                word-break: break-word;
                line-height: 1.15;
                font-weight: 600;

                /* JS will set font-size between 10px and 15px to fit ≤ 2 lines */
                font-size: 15px;
                color: #111827;
              }
              .teamNameLeft {
                text-align: left;
              }
              .teamNameRight {
                text-align: right;
              }

              .scoreLeft,
              .scoreRight {
                font-variant-numeric: tabular-nums;
                font-weight: 600;
                color: #111827;
                transition: color 120ms ease;
              }
              .scoreLeft {
                text-align: right;
              }
              .scoreRight {
                text-align: left;
              }

              /* header: winner/loser coloring */
              .win {
                color: #059669; /* emerald-600 */
              }
              .lose {
                color: #dc2626; /* red-600 */
              }
              .neutral {
                color: #111827;
              }

              .vs {
                text-align: center;
                color: #6b7280;
                font-weight: 600;
              }

              /* ---------- EXPANDED: headers ---------- */
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

              /* ---------- EXPANDED: player rows ---------- */
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

              /* ---------- responsive tweaks ---------- */
              @media (max-width: 360px) {
                .teamName {
                  /* JS still sizes within [10,15]; this just nudges defaults */
                  font-size: 14px;
                }
              }
              @media (min-width: 640px) {
                .rowTop {
                  grid-template-columns:
                    36px minmax(0, 1fr) 88px 24px 88px minmax(0, 1fr)
                    36px;
                  padding: 12px 14px;
                  min-height: 72px;
                  max-height: 72px;
                }
                .av {
                  width: 36px;
                  height: 36px;
                }
                /* Keep 2-line guarantee even on larger screens for consistency */
              }
            `}</style>
          </article>
        );
      })}
    </div>
  );
}

/** Pair up rows safely (QB,RB,RB,WR,WR,TE,FLEX,FLEX,DEF). */
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
