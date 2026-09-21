import { validatedSleeperSeasonGames } from './nfl-schedule';
import { compatibleRevision } from './projections/shared/revision-compatibility';

export const SITE_WEEK_POLICY_VERSION = 'nfl-complete-next-day-eastern-noon-v1';
export const SITE_WEEK_TIME_ZONE = 'America/New_York';

export type SiteWeekResolution = Readonly<{
  week: number;
  /** Known boundary, retained when overdue until complete-game evidence arrives. */
  nextRolloverAt: string | null;
  policyVersion: string;
  scheduleRevision: string;
  /** Contiguous weeks whose complete-game evidence and noon boundary both passed. */
  lastCompletedWeek: number;
  holdReason: string | null;
}>;

const easternParts = new Intl.DateTimeFormat('en-US', {
  timeZone: SITE_WEEK_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function calendarDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return NaN;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : NaN;
}

/** Both 4 AM and noon are unambiguous after Eastern daylight-saving transitions. */
function followingEasternHour(lastGameDate: string, hour: 4 | 12): number {
  const nextDate = calendarDate(lastGameDate) + 86_400_000;
  // Measure the offset at noon UTC, after either transition, even for the 4 AM release.
  const offsetAnchor = nextDate + 12 * 3_600_000;
  const desiredLocalTime = nextDate + hour * 3_600_000;
  const parts = Object.fromEntries(easternParts.formatToParts(new Date(offsetAnchor))
    .map((part) => [part.type, part.value]));
  const representedLocalTime = Date.UTC(Number(parts.year), Number(parts.month) - 1,
    Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return desiredLocalTime + (offsetAnchor - representedLocalTime);
}

type ScheduleBoundaryInput = Readonly<{ season: string; seasonSchedule: unknown; evaluatedAt: string }>;

export type WeeklyPlayerMetricWindow = Readonly<{
  throughWeek: number;
  asOf: string | null;
  nextRefreshAt: string | null;
  holdReason: string | null;
}>;

/**
 * Site period policy from a complete, canonical Sleeper season schedule. This
 * changes ownership/display timing only; it never proves fantasy score parity.
 * League lifecycle and explicit requested-week selection remain caller policy.
 */
export function resolveSiteWeek(input: ScheduleBoundaryInput): SiteWeekResolution {
  const { week, nextRolloverAt, policyVersion, scheduleRevision, lastCompletedWeek, holdReason }
    = resolveScheduleBoundary(input, 12);
  return { week, nextRolloverAt, policyVersion, scheduleRevision, lastCompletedWeek, holdReason };
}

/** Display-only weekly statistics cutoff. Never changes active-week ownership. */
export function resolveWeeklyPlayerMetrics(input: ScheduleBoundaryInput): WeeklyPlayerMetricWindow {
  const resolution = resolveScheduleBoundary(input, 4);
  return { throughWeek: resolution.lastCompletedWeek, asOf: resolution.lastCutoffAt,
    nextRefreshAt: resolution.nextRolloverAt, holdReason: resolution.holdReason };
}

function resolveScheduleBoundary(input: ScheduleBoundaryInput, hour: 4 | 12): SiteWeekResolution & {
  lastCutoffAt: string | null;
} {
  if (!/^20\d{2}$/u.test(input.season)) throw new Error('Site week requires a valid regular-season year.');
  const now = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(now) || !Number.isFinite(calendarDate(input.evaluatedAt.slice(0, 10)))
    || !/T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(input.evaluatedAt)) {
    throw new Error('Site week evaluation requires a valid timestamp with a time zone.');
  }
  const games = validatedSleeperSeasonGames(input.seasonSchedule);
  if (!games) throw new Error('Site week requires a complete, nonconflicting NFL season schedule.');
  const season = Number(input.season);
  for (const game of games) {
    const at = calendarDate(game.date);
    if (!Number.isFinite(at)) throw new Error(`Site week schedule has an invalid game date: ${game.gameId}.`);
    const year = new Date(at).getUTCFullYear();
    if (year !== season && (year !== season + 1 || new Date(at).getUTCMonth() > 1)) {
      throw new Error(`Site week schedule game is outside the requested season: ${game.gameId}.`);
    }
  }
  const scheduleRevision = compatibleRevision({
    policyVersion: SITE_WEEK_POLICY_VERSION, season: input.season,
    games: [...games].sort((a, b) => a.week - b.week || a.gameId.localeCompare(b.gameId)),
  });
  let lastCutoffAt: string | null = null;
  const result = (week: number, lastCompletedWeek: number, nextRolloverAt: number | null,
    holdReason: string | null): SiteWeekResolution & { lastCutoffAt: string | null } => ({
    week, lastCompletedWeek, nextRolloverAt: nextRolloverAt === null ? null : new Date(nextRolloverAt).toISOString(),
    policyVersion: SITE_WEEK_POLICY_VERSION, scheduleRevision, holdReason, lastCutoffAt,
  });
  let lastCompletedWeek = 0;
  for (let week = 1; week <= 18; week += 1) {
    const weeklyGames = games.filter((game) => game.week === week);
    const lastGameDate = weeklyGames.reduce((latest, game) => game.date > latest ? game.date : latest, '');
    const cutoff = followingEasternHour(lastGameDate, hour);
    const complete = weeklyGames.every((game) => game.status === 'complete');
    if (now < cutoff) return result(week, lastCompletedWeek, cutoff, 'rollover-time-pending');
    if (!complete) return result(week, lastCompletedWeek, cutoff, `week-${week}-game-completion-unconfirmed`);
    lastCompletedWeek = week;
    lastCutoffAt = new Date(cutoff).toISOString();
  }
  return result(18, lastCompletedWeek, null, null);
}
