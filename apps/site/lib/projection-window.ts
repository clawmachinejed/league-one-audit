import type { MatchupsData, NflGame } from './types';
import type { WeekSchedule } from './nfl-schedule';

export type ProjectionSyncCadence = 'forced' | 'live-window' | 'hourly' | 'idle';

const BEFORE_KICKOFF_MS = 2 * 60 * 60 * 1_000;
const AFTER_KICKOFF_MS = 7 * 60 * 60 * 1_000;

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

type ScheduledNflGame = Extract<NflGame, { kind: 'scheduled' }>;

function uniqueScheduledGames(data: MatchupsData): ScheduledNflGame[] {
  const games = new Map<string, ScheduledNflGame>();
  for (const player of data.matchups.flatMap((matchup) => matchup.sides)
    .flatMap((side) => side.starters)) {
    if (player.game?.kind !== 'scheduled') continue;
    const game = player.game;
    const key = `${game.date}:${game.location}:${game.opponent}:${game.kickoffAt ?? ''}`;
    games.set(key, game);
  }
  return [...games.values()];
}

/**
 * Keeps the minute cron inexpensive outside NFL windows. Hourly observations keep
 * pregame baselines and lineup snapshots warm; kickoff windows receive minute data.
 */
export function projectionSyncCadence(
  data: MatchupsData,
  now = new Date(),
  force = false,
): ProjectionSyncCadence {
  return cadenceForGames(uniqueScheduledGames(data), now, force);
}

/** Uses the complete NFL slate so a league with no starter in the first game cannot miss kickoff. */
export function projectionSyncCadenceForSchedule(
  schedule: WeekSchedule,
  now = new Date(),
  force = false,
): ProjectionSyncCadence {
  const games = Object.values(schedule)
    .filter((game): game is ScheduledNflGame => game.kind === 'scheduled');
  return cadenceForGames(games, now, force);
}

function cadenceForGames(
  games: readonly ScheduledNflGame[],
  now: Date,
  force: boolean,
): ProjectionSyncCadence {
  if (force) return 'forced';
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return 'idle';

  for (const game of games) {
    if (game.kickoffAt) {
      const kickoffMs = Date.parse(game.kickoffAt);
      if (Number.isFinite(kickoffMs)
        && nowMs >= kickoffMs - BEFORE_KICKOFF_MS
        && nowMs <= kickoffMs + AFTER_KICKOFF_MS) return 'live-window';
    } else if (easternCalendarDate(now) === game.date && now.getUTCMinutes() % 2 === 0) {
      // A missing kickoff is already an upstream-degraded state. Poll every two
      // minutes on the game date so live behavior recovers without exceeding the
      // Tank01 Pro daily allowance through a full calendar day.
      return 'live-window';
    }
  }

  return now.getUTCMinutes() === 0 ? 'hourly' : 'idle';
}
