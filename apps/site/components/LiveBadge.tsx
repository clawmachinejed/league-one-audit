// apps/site/components/LiveBadge.tsx
"use client";

import React from "react";
import { DateTime } from "luxon";

/**
 * Shows a pulsing "LIVE" pill during league live windows (America/New_York):
 * - Thu 7:45 PM to Fri 1:15 AM
 * - Sun 12:30 PM to Mon 12:15 AM
 * - Mon 7:45 PM to Tue 1:15 AM
 * Also honors NEXT_PUBLIC_FORCE_LIVE=1|true to force-enable.
 */
export default function LiveBadge() {
  const [isLive, setIsLive] = React.useState<boolean>(false);

  React.useEffect(() => {
    const tick = () => setIsLive(checkLive());
    tick();
    const id = 60000; // 60s
    const t = window.setInterval(tick, id);
    return () => window.clearInterval(t);
  }, []);

  if (!isLive) return null;

  return (
    <span
      aria-label="Live scoring window"
      className="ml-3 inline-flex items-center rounded-full bg-red-600 px-2 py-1 text-xs font-semibold text-white animate-pulse"
    >
      LIVE
    </span>
  );
}

function checkLive(): boolean {
  try {
    const force = (process.env.NEXT_PUBLIC_FORCE_LIVE ?? "")
      .toString()
      .toLowerCase();
    if (force === "1" || force === "true") return true;
  } catch {}
  const zone = "America/New_York";
  const now = DateTime.now().setZone(zone);

  const windows = [
    weeklyWindow(now, 4, { h: 19, m: 45 }, { h: 1, m: 15 }),
    weeklyWindow(now, 7, { h: 12, m: 30 }, { h: 0, m: 15 }),
    weeklyWindow(now, 1, { h: 19, m: 45 }, { h: 1, m: 15 }),
  ];

  return windows.some(({ start, end }) => now >= start && now < end);
}

/**
 * Build the current week's window that most recently started on the given weekday.
 * weekday: (1 as any)) = Monday to 7 = Sunday
 * start: {h,m} on that weekday
 * end: {h,m} on next day (crosses midnight)
 */
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
