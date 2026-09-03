import 'server-only';

import { projectionSyncCadenceForSchedule, type ProjectionSyncCadence } from '../../projection-window';
import type { ProjectionCadenceInput, ProjectionSyncInput } from '../../sleeper';

const HOURLY_WINDOW_MINUTES = 5;
const UPCOMING_SCHEDULE_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1_000;
const ACTIVITY_WINDOW_BEFORE_KICKOFF_MS = 2 * 60 * 60 * 1_000;
const ACTIVITY_WINDOW_AFTER_KICKOFF_MS = 7 * 60 * 60 * 1_000;

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
  schedule: ProjectionCadenceInput['schedule'],
  now: Date,
  force: boolean,
  allowHourly: boolean,
): ProjectionSyncCadence {
  const cadence = projectionSyncCadenceForSchedule(schedule, now, force);
  if (cadence === 'forced' || cadence === 'live-window') return cadence;
  if (!allowHourly) return 'idle';
  return cadence === 'hourly' || now.getUTCMinutes() < HOURLY_WINDOW_MINUTES
    ? 'hourly'
    : 'idle';
}

export function isCurrentNflPeriod(input: ProjectionCadenceInput): boolean {
  return input.currentNflSeason !== null
    && input.currentNflWeek !== null
    && input.season === input.currentNflSeason
    && input.week === input.currentNflWeek;
}

export function allowsHourlyFallback(input: ProjectionCadenceInput, now: Date): boolean {
  if (isCurrentNflPeriod(input) && input.currentNflSeasonType === 'regular') return true;
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

export function activityWindowsForSchedule(schedule: ProjectionSyncInput['schedule']): Array<Readonly<{
  startsAt: string;
  endsAt: string;
}>> {
  const windows = new Map<string, Readonly<{ startsAt: string; endsAt: string }>>();
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

export function highestCadence(values: readonly ProjectionSyncCadence[]): ProjectionSyncCadence {
  if (values.includes('forced')) return 'forced';
  if (values.includes('live-window')) return 'live-window';
  if (values.includes('hourly')) return 'hourly';
  return 'idle';
}

