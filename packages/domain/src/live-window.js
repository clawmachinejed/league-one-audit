// packages/domain/src/live-window.ts
import { DateTime } from "luxon";
/**
 * Live windows in America/New_York
 * Inclusive of the start minute, exclusive of the end minute.
 */
export function isLiveET(now = DateTime.now().setZone("America/New_York")) {
    return getLiveWindows(now).some(({ start, end }) => now >= start && now < end);
}
export function getLiveWindows(ref = DateTime.now().setZone("America/New_York")) {
    return [
        weeklyWindow(ref, 4, { h: 19, m: 45 }, { h: 1, m: 15 }), // Thu → Fri
        weeklyWindow(ref, 7, { h: 12, m: 30 }, { h: 0, m: 15 }), // Sun → Mon
        weeklyWindow(ref, 1, { h: 19, m: 45 }, { h: 1, m: 15 }), // Mon → Tue
    ];
}
/**
 * Build the current week's window that most recently started on the given weekday.
 * weekday: 1 = Monday … 7 = Sunday
 * start: {h,m} on that weekday
 * end: {h,m} on next day (crosses midnight)
 */
export function weeklyWindow(ref, weekday, start, end) {
    let startDt = ref.set({
        weekday: weekday, // satisfy Luxon's WeekdayNumbers type
        hour: start.h,
        minute: start.m,
        second: 0,
        millisecond: 0,
    });
    if (startDt > ref)
        startDt = startDt.minus({ days: 7 });
    const endDt = startDt
        .plus({ days: 1 })
        .set({ hour: end.h, minute: end.m, second: 0, millisecond: 0 });
    return { start: startDt, end: endDt };
}
