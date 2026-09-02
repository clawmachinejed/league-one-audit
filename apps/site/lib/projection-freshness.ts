import type { StoredProjectionSnapshot } from './projection-store';
import type { MatchupsData } from './types';

const ACTIVE_MAX_AGE_MS = 3 * 60 * 1_000;
const IDLE_MAX_AGE_MS = 75 * 60 * 1_000;
const FUTURE_CLOCK_TOLERANCE_MS = 5 * 60 * 1_000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1_000;
const SEVEN_HOURS_MS = 7 * 60 * 60 * 1_000;
const easternDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

export type StoredMatchupsSelection = Readonly<{
  kind: 'usable';
  payload: MatchupsData;
  historical: boolean;
}> | Readonly<{
  kind: 'missing' | 'stale';
}>;

function time(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function seasonNumber(value: string): number | null {
  return /^\d{4}$/u.test(value) ? Number(value) : null;
}

function easternCalendarDate(value: Date): string {
  const parts = Object.fromEntries(
    easternDate.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isOlderThanLatest(
  snapshot: StoredProjectionSnapshot,
  latest: StoredProjectionSnapshot | null,
): boolean {
  if (!latest || latest.snapshotId === snapshot.snapshotId) return false;
  const selectedSeason = seasonNumber(snapshot.payload.league.season);
  const latestSeason = seasonNumber(latest.payload.league.season);
  if (selectedSeason !== null && latestSeason !== null && selectedSeason !== latestSeason) {
    return selectedSeason < latestSeason;
  }
  return snapshot.payload.league.season === latest.payload.league.season
    && snapshot.week < latest.week;
}

function isHistorical(
  snapshot: StoredProjectionSnapshot,
  latest: StoredProjectionSnapshot | null,
): boolean {
  return snapshot.week < snapshot.payload.league.week
    || isOlderThanLatest(snapshot, latest);
}

function isActiveWindow(snapshot: StoredProjectionSnapshot, now: Date): boolean {
  const { payload: data } = snapshot;
  if (data.matchups.some((matchup) => matchup.status === 'live')) return true;
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return true;

  // These windows come from the complete NFL slate rather than only the
  // displayed starters. A Thursday kickoff therefore gets minute-level
  // freshness even when neither fantasy lineup starts a player in that game.
  if (snapshot.activityWindows.some((window) => {
    const startsAt = time(window.startsAt);
    const endsAt = time(window.endsAt);
    return startsAt !== null && endsAt !== null && nowMs >= startsAt && nowMs <= endsAt;
  })) return true;

  // Keep a conservative fallback for degraded schedule rows that lack a
  // kickoff timestamp and therefore cannot produce a persisted window.
  for (const player of data.matchups.flatMap((matchup) => matchup.sides)
    .flatMap((side) => side.starters)) {
    if (player.game?.kind !== 'scheduled') continue;
    if (!player.game.kickoffAt) {
      // A missing kickoff on today's slate is already degraded upstream data.
      // Treat it as active rather than accepting an hour-old official score.
      if (player.game.date === easternCalendarDate(now)) {
        return true;
      }
      continue;
    }
    const kickoff = time(player.game.kickoffAt);
    if (kickoff !== null && nowMs >= kickoff - TWO_HOURS_MS && nowMs <= kickoff + SEVEN_HOURS_MS) {
      return true;
    }
  }
  return false;
}

function isFresh(snapshot: StoredProjectionSnapshot, now: Date): boolean {
  const verifiedAt = time(snapshot.verifiedAt);
  const nowMs = now.getTime();
  if (verifiedAt === null || !Number.isFinite(nowMs)) return false;
  const age = nowMs - verifiedAt;
  if (age < -FUTURE_CLOCK_TOLERANCE_MS) return false;
  return age <= (isActiveWindow(snapshot, now) ? ACTIVE_MAX_AGE_MS : IDLE_MAX_AGE_MS);
}

function currentLeagueWeek(
  payload: MatchupsData,
  latest: StoredProjectionSnapshot | null,
): MatchupsData {
  if (!latest || latest.payload.league.season !== payload.league.season) return payload;
  const latestWeek = Math.max(latest.week, latest.payload.league.week);
  if (latestWeek <= payload.league.week) return payload;
  return { ...payload, league: { ...payload.league, week: latestWeek } };
}

/**
 * Selects a database snapshot without allowing a stopped sync worker to mask
 * current Sleeper scores. Weeks superseded by a later stored week remain
 * durable, even if every timestamp in that historical snapshot is old. A verified
 * current snapshot reports its most recent successful check as `updatedAt`,
 * which also lets a recovered snapshot replace a newer direct-fallback render.
 */
export function selectStoredMatchups(
  snapshot: StoredProjectionSnapshot | null,
  latest: StoredProjectionSnapshot | null,
  requestedWeek: number | undefined,
  now = new Date(),
): StoredMatchupsSelection {
  if (!snapshot
    || (requestedWeek !== undefined && snapshot.week !== requestedWeek)
    || snapshot.payload.week !== snapshot.week) return { kind: 'missing' };

  const historical = isHistorical(snapshot, latest);
  if (!historical && !isFresh(snapshot, now)) return { kind: 'stale' };

  const payload = currentLeagueWeek(snapshot.payload, latest);
  const checkedAt = (time(snapshot.verifiedAt) ?? 0) >= (time(payload.updatedAt) ?? 0)
    ? snapshot.verifiedAt
    : payload.updatedAt;
  return {
    kind: 'usable',
    historical,
    payload: historical || payload.updatedAt === checkedAt
      ? payload
      : { ...payload, updatedAt: checkedAt },
  };
}
