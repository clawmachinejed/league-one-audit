// apps/site/app/page.tsx
export const dynamic = "force-dynamic";
import { getApp } from "../lib/app";
import { DateTime } from "luxon";
import { unstable_noStore as noStore } from "next/cache";

export const revalidate = 60;

function isLiveET(now = DateTime.now().setZone("America/New_York")): boolean {
  // Inclusive start, exclusive end
  const windows = [
    weeklyWindow(now, 4, { h: 19, m: 45 }, { h: 1, m: 15 }), // Thu → Fri
    weeklyWindow(now, 7, { h: 12, m: 30 }, { h: 0, m: 15 }), // Sun → Mon
    weeklyWindow(now, 1, { h: 19, m: 45 }, { h: 1, m: 15 }), // Mon → Tue
  ];
  return windows.some(({ start, end }) => now >= start && now < end);
}

function weeklyWindow(
  ref: DateTime,
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7,
  start: { h: number; m: number },
  end: { h: number; m: number },
) {
  let startDt = ref.set({
    // Luxon requires WeekdayNumbers union (1–7)
    weekday: weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7,
    hour: start.h,
    minute: start.m,
    second: 0,
    millisecond: 0,
  });
  if (startDt > ref) startDt = startDt.minus({ days: 7 });
  const endDt = startDt
    .plus({ days: 1 })
    .set({ hour: end.h, minute: end.m, second: 0, millisecond: 0 });
  return { start: startDt, end: endDt };
}

export default async function Page() {
  const season = new Date().getFullYear();

  // Live-aware caching: opt out during live, otherwise use ISR (revalidate = 60)
  const liveNow = isLiveET();
  if (liveNow) noStore();

  const data = await getApp().home(season, 1);

  // Inline script for ≤30s auto-refresh + aria-live flip during live windows.
  const POLL_MS = 30000;

  return (
    <div>
      {/* screen-reader status for score updates */}
      <div aria-live="polite" className="sr-only" id="scores-status">
        Scores static
      </div>

      <h1 className="text-2xl font-bold mb-2">Standings</h1>
      <ul className="space-y-1">
        {data.standings.map((row: any) => (
          <li
            key={row.team.id}
            className="flex justify-between border p-2 rounded"
          >
            <span>{row.team.name}</span>
            <span className="tabular-nums">
              {row.wins}-{row.losses}
            </span>
          </li>
        ))}
      </ul>

      {liveNow ? (
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function(){
  var POLL_MS = ${POLL_MS};
  var statusEl = document.getElementById('scores-status');
  function setStatus(s){ if(statusEl) statusEl.textContent = s; }
  function tick(){
    setStatus('Scores updating');
    fetch(location.href, { cache: 'no-store' })
      .then(function(){ setStatus('Scores static'); location.reload(); })
      .catch(function(){ setStatus('Scores static'); location.reload(); });
  }
  setTimeout(tick, POLL_MS);
  setInterval(tick, POLL_MS);
})();`,
          }}
        />
      ) : null}
    </div>
  );
}
