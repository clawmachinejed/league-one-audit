import { DateTime } from "luxon";
import type { ClockPort } from "@l1/ports";

export function createLuxonClock(zone = "America/New_York"): ClockPort {
  return {
    nowISO: () =>
      DateTime.now().setZone(zone).toISO() ?? new Date().toISOString(),
    tz: () => zone,
    within: (startISO: string, endISO: string) => {
      const now = DateTime.now().setZone(zone);
      const start = DateTime.fromISO(startISO, { zone });
      const end = DateTime.fromISO(endISO, { zone });
      return now >= start && now < end;
    },
  };
}
