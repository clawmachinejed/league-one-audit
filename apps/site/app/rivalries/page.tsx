// apps/site/app/rivalries/page.tsx
import { getApp } from "../../lib/app";
import { DateTime } from "luxon";

export const metadata = { title: "Rivalries • League One" };
export const revalidate = 300;

function isLiveNowET(): boolean {
  const zone = "America/New_York";
  const now = DateTime.now().setZone(zone);

  const windows = [
    weeklyWindow(now, 4, { h: 19, m: 45 }, { h: 1, m: 15 }),
    weeklyWindow(now, 7, { h: 12, m: 30 }, { h: 0, m: 15 }),
    weeklyWindow(now, 1, { h: 19, m: 45 }, { h: 1, m: 15 }),
  ];

  const liveByWindow = windows.some(
    ({ start, end }) => now >= start && now < end,
  );
  const force = (process.env.NEXT_PUBLIC_FORCE_LIVE ?? "")
    .toString()
    .toLowerCase();
  const liveForced = force === "1" || force === "true";
  return liveForced || liveByWindow;
}

function weeklyWindow(
  ref: DateTime,
  weekday: any,
  start: { h: number; m: number },
  end: { h: number; m: number },
) {
  let startDt = ref.set({
    weekday,
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

export default async function RivalriesPage() {
  const app = getApp();
  const pairs = await app.rivalries();
  const isLive = isLiveNowET();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Rivalries</h1>
      {isLive ? (
        <p className="mb-4 text-sm text-gray-600">
          Heavy visuals deferred during live windows.
        </p>
      ) : (
        <div
          className="mb-4 grid grid-cols-4 gap-1"
          role="img"
          aria-label="Rivalries heatmap"
        >
          {pairs.map(([a, b, score]) => (
            <div
              key={a + b}
              className="h-6"
              title={`${a} vs ${b}: ${score.toFixed(0)}`}
              style={{
                background: `rgba(235,28,36,${Math.min(1, score / 100)})`,
              }}
            />
          ))}
        </div>
      )}
      <ul className="space-y-1">
        {pairs.map(([a, b, score]) => (
          <li key={a + b} className="flex justify-between border p-2 rounded">
            <span>
              {a} vs {b}
            </span>
            <span className="tabular-nums">{score.toFixed(0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
