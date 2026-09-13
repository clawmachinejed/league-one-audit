/** Shared display/collection schedule. No provider or database dependencies. */
export const ALL_PLAYER_REFRESH_TIME_ZONE = 'America/New_York';
export const ALL_PLAYER_REFRESH_INTERVAL_MS = 3_600_000;
export const ALL_PLAYER_REQUESTS_PER_24_HOURS = 13;

const easternHour = new Intl.DateTimeFormat('en-US', {
  timeZone: ALL_PLAYER_REFRESH_TIME_ZONE, hour: 'numeric', hourCycle: 'h23',
});

/** Noon through midnight Eastern, inclusive, including daylight saving time. */
export function getAllPlayerRefreshSlot(now: Date): string | null {
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) return null;
  const hour = Number(easternHour.format(now));
  if (hour !== 0 && hour < 12) return null;
  return new Date(Math.floor(timestamp / ALL_PLAYER_REFRESH_INTERVAL_MS)
    * ALL_PLAYER_REFRESH_INTERVAL_MS).toISOString();
}

/** Minute zero starts capture; minute one allows a bounded retry after shared work. */
export function isAllPlayerRefreshOpportunity(now: Date): boolean {
  return now.getUTCMinutes() <= 1 && getAllPlayerRefreshSlot(now) !== null;
}

/** First scheduled hour strictly after now; UTC stepping handles both DST changes. */
export function nextAllPlayerRefreshAt(now: Date): Date {
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) throw new Error('All-player refresh time is invalid.');
  const nextHour = (Math.floor(timestamp / ALL_PLAYER_REFRESH_INTERVAL_MS) + 1)
    * ALL_PLAYER_REFRESH_INTERVAL_MS;
  for (let offset = 0; offset < 26; offset += 1) {
    const candidate = new Date(nextHour + offset * ALL_PLAYER_REFRESH_INTERVAL_MS);
    if (getAllPlayerRefreshSlot(candidate) !== null) return candidate;
  }
  throw new Error('All-player refresh schedule is unavailable.');
}
