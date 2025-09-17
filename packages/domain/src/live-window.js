import { DateTime, Interval } from "luxon";
// Thu 7:45pm–1:15am, Sun 12:30pm–12:15am, Mon 7:45pm–1:15am ET
export function isLiveNowISO(nowISO, zone = "America/New_York") {
    const now = DateTime.fromISO(nowISO, { zone });
    const day = now.weekday; // 1 Mon .. 7 Sun
    function windowFor(d) {
        const startEnd = (sh, sm, eh, em, dayOffsetEnd = 0) => {
            const start = now.set({
                hour: sh,
                minute: sm,
                second: 0,
                millisecond: 0,
            });
            const end = start
                .plus({ days: dayOffsetEnd })
                .set({ hour: eh, minute: em, second: 0, millisecond: 0 });
            return Interval.fromDateTimes(start, end);
        };
        if (d === 4)
            return startEnd(19, 45, 1, 15, 1); // Thu
        if (d === 7)
            return startEnd(12, 30, 0, 15, 1); // Sun
        if (d === 1)
            return startEnd(19, 45, 1, 15, 1); // Mon
        return null;
    }
    const w = windowFor(day);
    return w ? w.contains(now) : false;
}
