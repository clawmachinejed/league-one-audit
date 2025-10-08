"use client";

import * as React from "react";

type Starter = {
  slot: string;
  name: string;
  pts: number;
  pid?: string;
  team?: string; // used for "POS - TEAM"
};
type Side = {
  rid: number;
  name: string;
  avatar: string;
  pts: number;
  starters: Starter[];
};
export type Card = { id: number; a: Side; b: Side };

type StatsMap = Record<
  string,
  Partial<{
    // QB
    pass_yds: number;
    pass_td: number;
    pass_int: number;
    rush_yds: number;
    fum_lost: number;
    // RB / WR / TE
    carries: number;
    rec: number;
    rec_yds: number;
    targets: number;
    rec_td: number;
    rush_td: number;
    // K
    fg_made: number;
    fg_att: number;
    xp_made: number;
    fg_yards: number; // if available
    // DEF
    def_pa: number; // points allowed
    def_sacks: number;
    def_to: number; // turnovers
    def_td: number;
    // Game meta (optional)
    game_state: string; // "Final", "Q3 07:21", "Sun 1:00p"
    opp: string; // "DAL"
    venue: "home" | "away";
  }>
>;

type Props = {
  cards?: Card[];
  items?: Card[];
  myRid?: number;
  statsByPlayerId?: StatsMap; // optional, enables blips when provided
};

function cls(...parts: Array<string | false | undefined | null>) {
  return parts.filter(Boolean).join(" ");
}

/** "First Last" -> "F. Last"; keep DEF/D/ST names as-is */
function formatName(n?: string, slot?: string) {
  const name = (n || "").trim();
  if (!name) return "—";
  if (slot === "DEF" || /D\/ST/i.test(name)) return name;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

/** Build the "POS - TEAM" label (TEAM omitted if unknown) */
function posTeam(st?: Starter) {
  if (!st) return "";
  const pos = (st.slot || "").toUpperCase();
  const team = (st.team || "").toUpperCase();
  return team ? `${pos} - ${team}` : pos;
}

/** LEFT: "Name  POS - TEAM"  |  RIGHT: "POS - TEAM  Name" */
function renderNameCell(st: Starter | undefined, side: "L" | "R") {
  const nm = formatName(st?.name, st?.slot);
  const meta = posTeam(st);
  if (side === "L") {
    return (
      <>
        <span className="pname">{nm}</span>
        {meta ? <span className="meta"> {meta}</span> : null}
      </>
    );
  }
  // Right side: meta first, then name
  return (
    <>
      {meta ? <span className="meta">{meta} </span> : null}
      <span className="pname">{nm}</span>
    </>
  );
}

/** Compact, one-line blip by position with graceful omissions */
function formatStatBlip(slot: string, s?: StatsMap[string]): string {
  if (!s) return "";
  const pick = (v?: number | null) =>
    typeof v === "number" && Number.isFinite(v) && v !== 0 ? v : null;

  const chips: string[] = [];

  if (slot === "QB") {
    const py = pick(s.pass_yds);
    const ry = pick(s.rush_yds);
    const td = pick(s.pass_td);
    const inte = pick(s.pass_int);
    const fl = pick(s.fum_lost);
    if (py != null) chips.push(`${py} PY`);
    if (ry != null) chips.push(`${ry} RY`);
    if (td != null) chips.push(`${td} TD`);
    if (inte != null) chips.push(`${inte} INT`);
    if (fl != null) chips.push(`${fl} FL`);
  } else if (slot === "RB") {
    const car = pick(s.carries);
    const rY = pick(s.rush_yds);
    const rTD = pick(s.rush_td);
    const rec = pick(s.rec);
    const yds = pick(s.rec_yds);
    const fl = pick(s.fum_lost);
    const rush =
      car != null || rY != null || rTD != null
        ? `${car ?? 0}-${rY ?? 0}${rTD != null ? `-${rTD}` : ""}`
        : null;
    const recv = rec != null || yds != null ? `${rec ?? 0}-${yds ?? 0}` : null;
    if (rush) chips.push(rush);
    if (recv) chips.push(recv);
    if (fl != null) chips.push(`${fl} FL`);
  } else if (slot === "WR" || slot === "TE") {
    const tgt = pick(s.targets);
    const rec = pick(s.rec);
    const yds = pick(s.rec_yds);
    const td = pick(s.rec_td);
    const fl = pick(s.fum_lost);
    if (tgt != null) chips.push(`${tgt} tgt`);
    if (rec != null || yds != null || td != null) {
      let core = `${rec ?? 0}-${yds ?? 0}`;
      if (td != null) core += `-${td}`;
      chips.push(core);
    }
    if (fl != null) chips.push(`${fl} FL`);
  } else if (slot === "K") {
    const fgm = pick(s.fg_made);
    const fga = pick(s.fg_att);
    const xpm = pick(s.xp_made);
    const fgy = pick(s.fg_yards);
    if (fgm != null || fga != null) chips.push(`${fgm ?? 0}/${fga ?? 0} FG`);
    if (xpm != null) chips.push(`${xpm} XP`);
    if (fgy != null) chips.push(`${fgy} FGyds`);
  } else if (slot === "DEF") {
    const pa = pick(s.def_pa);
    const sk = pick(s.def_sacks);
    const to = pick(s.def_to);
    const td = pick(s.def_td);
    if (pa != null) chips.push(`${pa} PA`);
    if (sk != null) chips.push(`${sk} SCK`);
    if (to != null) chips.push(`${to} TO`);
    if (td != null) chips.push(`${td} TD`);
  }

  // Optional game meta
  const meta: string[] = [];
  if (s.game_state) meta.push(s.game_state);
  if (s.opp) meta.push((s.venue === "away" ? "@ " : "vs ") + s.opp);

  const core = chips.join(" · ");
  if (!core && meta.length) return meta.join(" · ");
  if (core && meta.length) return `${meta.join(" · ")} · ${core}`;
  return core;
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

/** Per-card expansion state with "all open" default and per-row exceptions */
type CardOpenState = {
  cardOpen: boolean;
  allOpen: boolean;
  // row exceptions: when allOpen=true => exception means "close"; when false => "open"
  exceptions: Set<string>; // rowKey = `${side}-${index}`
};

export default function ExpandableMatchups({
  cards,
  items,
  myRid,
  statsByPlayerId,
}: Props) {
  const initial = (cards ?? items ?? []) as Card[];

  // Float "My Team" to the top
  const list = React.useMemo(() => {
    if (!Number.isFinite(myRid as number)) return initial;
    const idx = initial.findIndex(
      (c) => c.a.rid === myRid || c.b.rid === myRid,
    );
    if (idx < 0) return initial;
    const picked = initial[idx];
    const rest = initial.filter((_, i) => i !== idx);
    return [picked, ...rest];
  }, [initial, myRid]);

  // Per-card state
  const [openMap, setOpenMap] = React.useState<Record<number, CardOpenState>>(
    {},
  );

  const toggleCard = (cid: number) => {
    setOpenMap((s) => {
      const cur = s[cid] ?? {
        cardOpen: false,
        allOpen: false,
        exceptions: new Set(),
      };
      if (cur.cardOpen) {
        // collapsing resets all rows
        return {
          ...s,
          [cid]: { cardOpen: false, allOpen: false, exceptions: new Set() },
        };
      }
      return {
        ...s,
        [cid]: { cardOpen: true, allOpen: false, exceptions: new Set() },
      };
    });
  };

  const toggleAllRows = (cid: number) => {
    setOpenMap((s) => {
      const cur = s[cid] ?? {
        cardOpen: false,
        allOpen: false,
        exceptions: new Set(),
      };
      if (!cur.cardOpen) return s; // ignore if closed
      // if already "all open" with no exceptions -> close all
      const allOpen = !(cur.allOpen && cur.exceptions.size === 0);
      return {
        ...s,
        [cid]: { cardOpen: true, allOpen, exceptions: new Set() },
      };
    });
  };

  const toggleRow = (cid: number, side: "L" | "R", index: number) => {
    setOpenMap((s) => {
      const cur = s[cid] ?? {
        cardOpen: false,
        allOpen: false,
        exceptions: new Set(),
      };
      if (!cur.cardOpen) return s;
      const key = `${side}-${index}`;
      const next = new Set(cur.exceptions);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...s, [cid]: { ...cur, exceptions: next } };
    });
  };

  const isRowOpen = (cid: number, side: "L" | "R", index: number) => {
    const cur = openMap[cid];
    if (!cur?.cardOpen) return false;
    const key = `${side}-${index}`;
    const flipped = cur.exceptions.has(key);
    return cur.allOpen ? !flipped : flipped;
  };

  return (
    <div className="xm-wrap">
      {list.map((c) => {
        const st = openMap[c.id];
        const cardOpen = !!st?.cardOpen;
        const isMy =
          Number.isFinite(myRid as number) &&
          (c.a.rid === myRid || c.b.rid === myRid);

        return (
          <section
            key={c.id}
            className={cls("xm-card", isMy && "myteam")}
            role="group"
          >
            {/* ===================== HEADER ===================== */}
            <div className="sum-row">
              <div className="sum-left">
                <img
                  className="av avL"
                  src={c.a.avatar}
                  alt=""
                  width={24}
                  height={24}
                />
                <div className="t-name t-left" data-rid={c.a.rid}>
                  <span className="t-link">{c.a.name}</span>
                </div>
              </div>

              {/* center band toggles the entire card */}
              <button
                type="button"
                className="head-toggle t-score t-left"
                onClick={() => toggleCard(c.id)}
                aria-expanded={cardOpen}
                aria-controls={`card-${c.id}`}
              >
                {c.a.pts.toFixed(2)}
              </button>

              <button
                type="button"
                className="head-toggle vs"
                onClick={() => toggleCard(c.id)}
                aria-expanded={cardOpen}
                aria-controls={`card-${c.id}`}
              >
                {cardOpen ? "▼ vs ▼" : "▶ vs ◀"}
              </button>

              <button
                type="button"
                className="head-toggle t-score t-right"
                onClick={() => toggleCard(c.id)}
                aria-expanded={cardOpen}
                aria-controls={`card-${c.id}`}
              >
                {c.b.pts.toFixed(2)}
              </button>

              <div className="sum-right">
                <div className="t-name t-right" data-rid={c.b.rid}>
                  <span className="t-link">{c.b.name}</span>
                </div>
                <img
                  className="av avR"
                  src={c.b.avatar}
                  alt=""
                  width={24}
                  height={24}
                />
              </div>
            </div>

            {/* ===================== DETAILS ===================== */}
            {cardOpen && (
              <div id={`card-${c.id}`} className="detail">
                {zipStarters(c.a.starters, c.b.starters).map((row, i) => {
                  const leftOpen = isRowOpen(c.id, "L", i);
                  const rightOpen = isRowOpen(c.id, "R", i);
                  const anyOpen =
                    leftOpen ||
                    rightOpen ||
                    (st?.allOpen && (st?.exceptions.size ?? 0) === 0);

                  const leftBlip =
                    formatStatBlip(
                      row.al?.slot ?? "",
                      row.al?.pid ? statsByPlayerId?.[row.al.pid] : undefined,
                    ) || "";
                  const rightBlip =
                    formatStatBlip(
                      row.ar?.slot ?? "",
                      row.ar?.pid ? statsByPlayerId?.[row.ar.pid] : undefined,
                    ) || "";

                  return (
                    <React.Fragment key={i}>
                      <div className="line">
                        {/* Left name (toggle just this side's row) */}
                        <button
                          type="button"
                          className="col name left row-toggle"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRow(c.id, "L", i);
                          }}
                          aria-expanded={leftOpen}
                        >
                          {renderNameCell(row.al, "L")}
                        </button>

                        <div className="col score left">
                          {row.al ? row.al.pts.toFixed(2) : "—"}
                        </div>

                        {/* Center POS (toggle ALL rows for this card) */}
                        <button
                          type="button"
                          className="col pos all-toggle"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleAllRows(c.id);
                          }}
                          aria-pressed={
                            !!st?.allOpen && (st?.exceptions.size ?? 0) === 0
                          }
                          title="Show/Hide all player stats"
                        >
                          {row.pos ?? ""}
                        </button>

                        <div className="col score right">
                          {row.ar ? row.ar.pts.toFixed(2) : "—"}
                        </div>

                        {/* Right name (toggle just this side's row) */}
                        <button
                          type="button"
                          className="col name right row-toggle"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRow(c.id, "R", i);
                          }}
                          aria-expanded={rightOpen}
                        >
                          {renderNameCell(row.ar, "R")}
                        </button>
                      </div>

                      {/* SINGLE subrow spanning the grid, with left & right blips on ONE line */}
                      {anyOpen && (
                        <div className="subrow">
                          <div className="sub sub-left" title={leftBlip}>
                            {leftBlip || "Schedule info"}
                          </div>
                          <div className="sub-center" />
                          <div className="sub sub-right" title={rightBlip}>
                            {rightBlip || "Schedule info"}
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            )}

            <style>{`
              .xm-card{
                border:1px solid #e5e7eb; border-radius:12px; background:#fff;
                padding:10px 8px;
              }
              .xm-card.myteam{
                border-color:#3b82f6;
                box-shadow:0 0 0 1px rgba(59,130,246,.15) inset;
              }
              .xm-wrap{ display:grid; gap:12px; }
              .xm-card:focus-visible{ outline:2px solid #2563eb; outline-offset:2px; }

              /* ===================== HEADER ===================== */
              .sum-row{
                display:grid; align-items:center; gap:10px;
                grid-template-columns:
                  28px
                  minmax(0,1.35fr)
                  72px
                  44px
                  72px
                  minmax(0,1.35fr)
                  28px;
              }
              .sum-left,.sum-right{ display:grid; align-items:center; min-width:0; gap:8px; }
              .sum-left{  grid-column:1 / span 2;  grid-template-columns:28px minmax(0,1fr); }
              .sum-right{ grid-column:6 / span 2;  grid-template-columns:minmax(0,1fr) 28px; }
              .av{ width:24px; height:24px; border-radius:9999px; object-fit:cover; background:#f3f4f6; }
              .avL{ justify-self:start; } .avR{ justify-self:end; }
              .t-name{ font-weight:500; line-height:1.2; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
              .t-name.t-right{ text-align:left; margin-left:auto; width:fit-content; max-width:100%; min-width:0; }
              .t-link{ text-decoration:none; color:inherit; cursor:default; }

              .t-score{ font-variant-numeric:tabular-nums; white-space:nowrap; }
              .t-score.t-left{ text-align:right; }
              .t-score.t-right{ text-align:left; }
              .vs{ text-align:center; color:#6b7280; font-weight:600; white-space:nowrap; }

              .head-toggle{ appearance:none; background:none; border:0; padding:4px 2px; cursor:pointer; }

              /* ===================== DETAILS ===================== */
              .detail{ margin-top:10px; border-top:1px dashed #e5e7eb; padding-top:10px; display:grid; gap:6px; }
              .line{
                display:grid; align-items:center; gap:8px;
                grid-template-columns:
                  minmax(0,1fr)
                  72px
                  44px
                  72px
                  minmax(0,1fr);
              }
              .col.name{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; line-height:1.2; min-width:0; }
              .col.name.left{ text-align:left; }
              .col.name.right{ text-align:right; }
              .row-toggle{ appearance:none; background:none; border:0; padding:0; cursor:pointer; text-align:inherit; }

              /* NEW: smaller, grey meta ("POS - TEAM"); name unchanged */
              .col.name .meta{
                color:#6b7280;
                font-size:.85em;
              }

              .col.score{ font-variant-numeric:tabular-nums; white-space:nowrap; }
              .col.score.left{ text-align:right; }
              .col.score.right{ text-align:left; }
              .col.pos{ text-align:center; white-space:nowrap; font-weight:600; color:#6b7280; }
              .all-toggle{ appearance:none; background:none; border:0; padding:2px 0; cursor:pointer; }

              /* ---- SINGLE subrow with left & right blips on one line ---- */
              .subrow{
                display:grid;
                grid-template-columns:
                  minmax(0,1fr)
                  72px
                  44px
                  72px
                  minmax(0,1fr);
                grid-column:1 / -1;
                gap:8px;
              }
              .sub{
                margin:2px 0 6px 0;
                padding:6px 8px;
                border-radius:8px;
                background:#f9fafb;
                font-size:.8rem;
                line-height:1.2;
                overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
              }
              .sub-left{ grid-column:1 / span 2; text-align:left; }
              .sub-center{ grid-column:3; } /* keeps the POS column perfectly centered */
              .sub-right{ grid-column:4 / span 2; text-align:right; }

              /* ===================== MOBILE ===================== */
              @media (max-width: 480px){
                .xm-card { font-size:.8rem; padding:10px 6px; }
                .sum-row{
                  gap:8px;
                  grid-template-columns:
                    24px
                    minmax(0,1.4fr)
                    64px
                    36px
                    64px
                    minmax(0,1.4fr)
                    24px;
                }
                .sum-left{  grid-template-columns:24px minmax(0,1fr); }
                .sum-right{ grid-template-columns:minmax(0,1fr) 24px; }
                .line{
                  grid-template-columns:
                    minmax(0,1fr)
                    64px
                    36px
                    64px
                    minmax(0,1fr);
                  gap:6px;
                }
                .subrow{
                  grid-template-columns:
                    minmax(0,1fr)
                    64px
                    36px
                    64px
                    minmax(0,1fr);
                  gap:6px;
                }
              }
            `}</style>
          </section>
        );
      })}
    </div>
  );
}
