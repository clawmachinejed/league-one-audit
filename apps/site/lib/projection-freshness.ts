import type { MatchupPeriodContext } from './matchup-period';
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
  context: MatchupPeriodContext;
}> | Readonly<{
  kind: 'stale';
  context: MatchupPeriodContext;
}> | Readonly<{ kind: 'missing' }>;

export type ProjectionFreshnessOptions = Readonly<{
  futureRefreshDue?: boolean;
}>;

function time(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function easternCalendarDate(value: Date): string {
  const parts = Object.fromEntries(
    easternDate.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isActiveWindow(snapshot: StoredProjectionSnapshot, now: Date): boolean {
  const { payload: data } = snapshot;
  if (data.matchups.some((matchup) => matchup.status === 'live')) return true;
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return true;
  if (snapshot.activityWindows.some((window) => {
    const startsAt = time(window.startsAt);
    const endsAt = time(window.endsAt);
    return startsAt !== null && endsAt !== null && nowMs >= startsAt && nowMs <= endsAt;
  })) return true;
  for (const player of data.matchups.flatMap((matchup) => matchup.sides)
    .flatMap((side) => side.starters)) {
    if (player.game?.kind !== 'scheduled') continue;
    if (!player.game.kickoffAt) {
      if (player.game.date === easternCalendarDate(now)) return true;
      continue;
    }
    const kickoff = time(player.game.kickoffAt);
    if (kickoff !== null && nowMs >= kickoff - TWO_HOURS_MS && nowMs <= kickoff + SEVEN_HOURS_MS) {
      return true;
    }
  }
  return false;
}

function refreshDue(
  snapshot: StoredProjectionSnapshot,
  context: MatchupPeriodContext,
  now: Date,
): boolean {
  if (context.temporalState === 'past') return false;
  const verifiedAt = time(snapshot.verifiedAt);
  const nowMs = now.getTime();
  if (verifiedAt === null || !Number.isFinite(nowMs)) return true;
  const age = nowMs - verifiedAt;
  if (age < -FUTURE_CLOCK_TOLERANCE_MS) return true;
  const maxAge = context.temporalState === 'active' && isActiveWindow(snapshot, now)
    ? ACTIVE_MAX_AGE_MS : IDLE_MAX_AGE_MS;
  return age > maxAge;
}

/** Past is durable, active fails closed, and future remains last-known-good. */
export function selectStoredMatchups(
  snapshot: StoredProjectionSnapshot | null,
  context: MatchupPeriodContext,
  now = new Date(),
  options: ProjectionFreshnessOptions = {},
): StoredMatchupsSelection {
  if (!snapshot || snapshot.payload.week !== snapshot.week) return { kind: 'missing' };
  const due = context.temporalState === 'future'
    && options.futureRefreshDue !== undefined
    ? options.futureRefreshDue
    : refreshDue(snapshot, context, now);
  const resolvedContext = { ...context, refreshDue: due };
  if (context.temporalState === 'active' && due) {
    return { kind: 'stale', context: resolvedContext };
  }
  const verifiedAt = time(snapshot.verifiedAt) ?? 0;
  const payloadUpdatedAt = time(snapshot.payload.updatedAt) ?? 0;
  const payload = context.temporalState === 'past' || verifiedAt <= payloadUpdatedAt
    ? snapshot.payload
    : { ...snapshot.payload, updatedAt: snapshot.verifiedAt };
  return {
    kind: 'usable',
    historical: context.temporalState === 'past',
    context: resolvedContext,
    payload,
  };
}
