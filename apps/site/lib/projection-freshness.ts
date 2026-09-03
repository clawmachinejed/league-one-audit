import type { MatchupPeriodContext } from './matchup-period';
import type { SnapshotFreshnessMetadata } from './matchup-snapshot-metadata';
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

export type ProjectionFreshnessOptions = Readonly<{
  futureRefreshDue?: boolean;
}>;

export type SnapshotMetadataSelection = Readonly<{
  kind: 'usable';
  context: MatchupPeriodContext;
}> | Readonly<{
  kind: 'stale';
  context: MatchupPeriodContext;
}> | Readonly<{ kind: 'missing' }>;

export function snapshotFreshnessMetadata(snapshot: StoredProjectionSnapshot): SnapshotFreshnessMetadata {
  const games = snapshot.payload.matchups.flatMap((matchup) => matchup.sides)
    .flatMap((side) => side.starters).flatMap((player) => (
      player.game?.kind === 'scheduled' ? [player.game] : []
    ));
  return {
    week: snapshot.week,
    payloadWeek: snapshot.payload.week,
    payloadLeagueWeek: snapshot.payload.league.week,
    payloadSeason: snapshot.payload.league.season,
    payloadUpdatedAt: snapshot.payload.updatedAt,
    verifiedAt: snapshot.verifiedAt,
    activityWindows: snapshot.activityWindows,
    matchupStatuses: snapshot.payload.matchups.map((matchup) => matchup.status),
    scheduledKickoffs: [...new Set(games.flatMap((game) => game.kickoffAt ? [game.kickoffAt] : []))],
    scheduledDatesWithoutKickoff: [...new Set(games.flatMap((game) => !game.kickoffAt ? [game.date] : []))],
  };
}

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

function isActiveWindow(snapshot: SnapshotFreshnessMetadata, now: Date): boolean {
  if (snapshot.matchupStatuses.some((status) => status === 'live')) return true;
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return true;
  if (snapshot.activityWindows.some((window) => {
    const startsAt = time(window.startsAt);
    const endsAt = time(window.endsAt);
    return startsAt !== null && endsAt !== null && nowMs >= startsAt && nowMs <= endsAt;
  })) return true;
  if (snapshot.scheduledDatesWithoutKickoff.includes(easternCalendarDate(now))) return true;
  for (const value of snapshot.scheduledKickoffs) {
    const kickoff = time(value);
    if (kickoff !== null && nowMs >= kickoff - TWO_HOURS_MS && nowMs <= kickoff + SEVEN_HOURS_MS) {
      return true;
    }
  }
  return false;
}

function refreshDue(
  snapshot: SnapshotFreshnessMetadata,
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
export function selectSnapshotMetadata(
  snapshot: SnapshotFreshnessMetadata | null,
  context: MatchupPeriodContext,
  now = new Date(),
  options: ProjectionFreshnessOptions = {},
): SnapshotMetadataSelection {
  if (!snapshot || snapshot.payloadWeek !== snapshot.week) return { kind: 'missing' };
  const due = context.temporalState === 'future' && options.futureRefreshDue !== undefined
    ? options.futureRefreshDue : refreshDue(snapshot, context, now);
  const resolvedContext = { ...context, refreshDue: due };
  return context.temporalState === 'active' && due
    ? { kind: 'stale', context: resolvedContext }
    : { kind: 'usable', context: resolvedContext };
}

export function snapshotPayloadAtVerification(
  snapshot: StoredProjectionSnapshot,
  context: MatchupPeriodContext,
): MatchupsData {
  const verifiedAt = time(snapshot.verifiedAt) ?? 0;
  const payloadUpdatedAt = time(snapshot.payload.updatedAt) ?? 0;
  return context.temporalState === 'past' || verifiedAt <= payloadUpdatedAt
    ? snapshot.payload
    : { ...snapshot.payload, updatedAt: snapshot.verifiedAt };
}
