import type { Cadence, LeagueCadenceState, NflWeekSchedule, TeamWeek } from '../domain/contracts';
import type { ProjectionActivityWindow } from '../ports/projection-repository';

const HOURLY_WINDOW_MINUTES = 5;
const UPCOMING_SCHEDULE_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1_000;
const ACTIVITY_WINDOW_BEFORE_KICKOFF_MS = 2 * 60 * 60 * 1_000;
const ACTIVITY_WINDOW_AFTER_KICKOFF_MS = 7 * 60 * 60 * 1_000;

const easternDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function easternCalendarDate(value: Date): string {
  const parts = Object.fromEntries(
    easternDate.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function scheduleCadence(
  games: readonly TeamWeek[],
  now: Date,
  force: boolean,
): Cadence {
  if (force) return 'forced';
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return 'idle';

  for (const game of games) {
    if (game.kind !== 'scheduled') continue;
    if (game.kickoffAt) {
      const kickoffMs = Date.parse(game.kickoffAt);
      if (Number.isFinite(kickoffMs)
        && nowMs >= kickoffMs - ACTIVITY_WINDOW_BEFORE_KICKOFF_MS
        && nowMs <= kickoffMs + ACTIVITY_WINDOW_AFTER_KICKOFF_MS) return 'live-window';
    } else if (easternCalendarDate(now) === game.date && now.getUTCMinutes() % 2 === 0) {
      return 'live-window';
    }
  }

  return now.getUTCMinutes() === 0 ? 'hourly' : 'idle';
}

export function minuteBoundary(now: Date): string {
  const value = new Date(now);
  value.setUTCSeconds(0, 0);
  return value.toISOString();
}

export function hourBoundary(now: Date): string {
  const value = new Date(now);
  value.setUTCMinutes(0, 0, 0);
  return value.toISOString();
}

export function workerCadence(
  schedule: NflWeekSchedule,
  now: Date,
  force: boolean,
  allowHourly: boolean,
): Cadence {
  const cadence = scheduleCadence(Object.values(schedule), now, force);
  if (cadence === 'forced' || cadence === 'live-window') return cadence;
  if (!allowHourly) return 'idle';
  return cadence === 'hourly' || now.getUTCMinutes() < HOURLY_WINDOW_MINUTES
    ? 'hourly'
    : 'idle';
}

export function isCurrentNflPeriod(input: LeagueCadenceState): boolean {
  return input.currentPeriod.season !== null
    && input.currentPeriod.week !== null
    && input.period.season === input.currentPeriod.season
    && input.period.week === input.currentPeriod.week;
}

export function allowsHourlyFallback(input: LeagueCadenceState, now: Date): boolean {
  if (isCurrentNflPeriod(input) && input.currentPeriod.seasonType === 'regular') return true;
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return false;
  return Object.values(input.schedule).some((game) => {
    if (game.kind !== 'scheduled' || !game.kickoffAt) return false;
    const kickoffMs = Date.parse(game.kickoffAt);
    return Number.isFinite(kickoffMs)
      && kickoffMs >= nowMs
      && kickoffMs - nowMs <= UPCOMING_SCHEDULE_LOOKAHEAD_MS;
  });
}

export function activityWindowsForSchedule(
  schedule: NflWeekSchedule,
): ProjectionActivityWindow[] {
  const windows = new Map<string, ProjectionActivityWindow>();
  for (const game of Object.values(schedule)) {
    if (game.kind !== 'scheduled' || !game.kickoffAt) continue;
    const kickoff = Date.parse(game.kickoffAt);
    if (!Number.isFinite(kickoff)) continue;
    const window = {
      startsAt: new Date(kickoff - ACTIVITY_WINDOW_BEFORE_KICKOFF_MS).toISOString(),
      endsAt: new Date(kickoff + ACTIVITY_WINDOW_AFTER_KICKOFF_MS).toISOString(),
    };
    windows.set(`${window.startsAt}:${window.endsAt}`, window);
  }
  return [...windows.values()].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

export function highestCadence(values: readonly Cadence[]): Cadence {
  if (values.includes('forced')) return 'forced';
  if (values.includes('live-window')) return 'live-window';
  if (values.includes('hourly')) return 'hourly';
  return 'idle';
}
