import { assertInstant } from '../aggregator/validation';
import { validatedSleeperSeasonGames } from '../nfl-schedule';
import { SLEEPER_NATIVE_WEEK_MAPPING_POLICY_VERSION, sleeperRegularSeasonPeriod } from '../projections/adapters/sleeper/schedule';
import { resolveSiteWeek, SITE_WEEK_POLICY_VERSION } from '../site-week';

export type SleeperCalendarEvidence = Readonly<{
  schemaVersion: 'sleeper-calendar-evidence-v1';
  mappingPolicyVersion: typeof SLEEPER_NATIVE_WEEK_MAPPING_POLICY_VERSION;
  source: Readonly<{ provider: 'sleeper'; resource: 'schedule/nfl/regular'; season: string }>;
  policyVersion: typeof SITE_WEEK_POLICY_VERSION;
  scheduleRevision: string;
  evaluatedAt: string;
  /** This interval measures retrieval from the existing framework-managed cache. */
  retrievalStartedAt: string;
  retrievalCompletedAt: string;
  /** The cache does not expose the original provider acquisition time. */
  sourceObservedAt: null;
  schedule: readonly Readonly<{
    game_id: string; week: number; home: string; away: string; date: string; status: string | null;
  }>[];
}>;

type CalendarEvidenceInput = Readonly<{
  season: string; seasonSchedule: unknown; evaluatedAt: string;
  retrievalStartedAt: string; retrievalCompletedAt: string;
}>;

/** Retains the existing calendar's minimal validated source shape without another acquisition. */
export function createSleeperCalendarEvidence(input: CalendarEvidenceInput): SleeperCalendarEvidence | null {
  try {
    assertInstant(input.evaluatedAt);
    assertInstant(input.retrievalStartedAt);
    assertInstant(input.retrievalCompletedAt);
    const completedAt = Date.parse(input.retrievalCompletedAt);
    // A shared invocation evaluation can precede each league's schedule retrieval.
    if (Date.parse(input.evaluatedAt) > completedAt || Date.parse(input.retrievalStartedAt) > completedAt) return null;
    sleeperRegularSeasonPeriod(input.season, 1);
    const games = validatedSleeperSeasonGames(input.seasonSchedule);
    if (!games) return null;
    const schedule = [...games].sort((left, right) => left.week - right.week || left.gameId.localeCompare(right.gameId))
      .map(game => ({ game_id: game.gameId, week: game.week, home: game.home, away: game.away,
        date: game.date, status: game.status }));
    // Reuse the full calendar boundary for real dates, season coverage and revision.
    const resolution = resolveSiteWeek({ season: input.season, seasonSchedule: schedule, evaluatedAt: input.evaluatedAt });
    return {
      schemaVersion: 'sleeper-calendar-evidence-v1',
      mappingPolicyVersion: SLEEPER_NATIVE_WEEK_MAPPING_POLICY_VERSION,
      source: { provider: 'sleeper', resource: 'schedule/nfl/regular', season: input.season },
      policyVersion: SITE_WEEK_POLICY_VERSION,
      scheduleRevision: resolution.scheduleRevision,
      evaluatedAt: input.evaluatedAt,
      retrievalStartedAt: input.retrievalStartedAt,
      retrievalCompletedAt: input.retrievalCompletedAt,
      sourceObservedAt: null,
      schedule,
    };
  } catch { return null; }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Revalidates retained evidence; neither read time nor a mutable current authority supplies proof. */
export function validateSleeperCalendarEvidence(input: unknown, season: string): SleeperCalendarEvidence | null {
  if (!record(input) || input.schemaVersion !== 'sleeper-calendar-evidence-v1'
    || input.mappingPolicyVersion !== SLEEPER_NATIVE_WEEK_MAPPING_POLICY_VERSION
    || !record(input.source) || input.source.provider !== 'sleeper'
    || input.source.resource !== 'schedule/nfl/regular' || input.source.season !== season
    || input.policyVersion !== SITE_WEEK_POLICY_VERSION || input.sourceObservedAt !== null
    || typeof input.evaluatedAt !== 'string' || typeof input.retrievalStartedAt !== 'string'
    || typeof input.retrievalCompletedAt !== 'string' || !Array.isArray(input.schedule)) return null;
  // The retained DTO contains the canonical source shape, not another raw-provider normalization surface.
  if (input.schedule.some(row => !record(row) || typeof row.game_id !== 'string'
    || typeof row.week !== 'number' || typeof row.home !== 'string' || typeof row.away !== 'string'
    || typeof row.date !== 'string' || (row.status !== null && typeof row.status !== 'string'))) return null;
  const evidence = createSleeperCalendarEvidence({ season, seasonSchedule: input.schedule, evaluatedAt: input.evaluatedAt,
    retrievalStartedAt: input.retrievalStartedAt, retrievalCompletedAt: input.retrievalCompletedAt });
  return evidence?.scheduleRevision === input.scheduleRevision ? evidence : null;
}
