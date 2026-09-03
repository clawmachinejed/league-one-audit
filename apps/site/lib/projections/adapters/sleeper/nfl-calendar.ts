import type { ProjectionCadenceInput } from '../../../sleeper';
import { canonicalNflTeam } from '../../../nfl-teams';
import type { WeekSchedule } from '../../../nfl-schedule';
import type {
  LeagueCadenceState,
  LeagueConfiguration,
  LeaguePeriodAuthority,
  LeaguePeriod,
  NflPhase,
  NflTeam,
  NflWeekSchedule,
  TeamWeek,
} from '../../domain/contracts';
import type { NflCalendarPort } from '../../ports/nfl-calendar';
import { compatibleRevision } from '../../shared/revision-compatibility';
import { validLineupShape } from '../../domain/lineup-observation';
import { sleeperLineupObservationShape } from './lineup-observation';

export type SleeperCadenceLoader = (
  leagueId: string,
) => Promise<ProjectionCadenceInput>;

export function sleeperRegularSeasonPeriod(season: string, week: number): LeaguePeriod {
  if (!/^20\d{2}$/u.test(season) || !Number.isInteger(week) || week < 1 || week > 18) {
    throw new Error('Sleeper returned an invalid projection season or week.');
  }
  return { season: Number(season), seasonType: 'regular', week };
}

function currentSeasonNumber(value: string | null): number | null {
  return value !== null && /^\d{4}$/u.test(value) ? Number(value) : null;
}

function nflPhase(value: string | null): NflPhase {
  if (value === 'pre') return 'preseason';
  if (value === 'regular') return 'regular';
  if (value === 'post') return 'postseason';
  return 'unknown';
}

export function sleeperPeriodAuthority(
  configuration: LeagueConfiguration,
  source: ProjectionCadenceInput,
): LeaguePeriodAuthority {
  const defaultDisplayPeriod = sleeperRegularSeasonPeriod(source.season, source.defaultDisplayWeek);
  const activeScoringPeriod = source.activeScoringWeek === null
    ? null
    : sleeperRegularSeasonPeriod(source.season, source.activeScoringWeek);
  if (source.leagueLifecycle === 'active' && activeScoringPeriod === null) {
    throw new Error('Sleeper did not return a valid active scoring week.');
  }
  if (source.leagueLifecycle !== 'active' && activeScoringPeriod !== null) {
    throw new Error('Sleeper returned a scoring week outside an active league season.');
  }
  const phase = nflPhase(source.currentNflSeasonType);
  const sourceRevision = compatibleRevision({
    leagueId: source.sleeperLeagueId,
    defaultDisplayPeriod,
    activeScoringPeriod,
    lifecycle: source.leagueLifecycle,
    nflPhase: phase,
  });
  return {
    configuration,
    defaultDisplayPeriod,
    activeScoringPeriod,
    lifecycle: source.leagueLifecycle,
    nflPhase: phase,
    source: configuration.leagueRef.provider,
    sourceRevision,
    observedAt: source.requestCompletedAt,
    verifiedAt: source.verifiedAt,
  };
}

/**
 * Converts the already-normalized Sleeper schedule into the provider-neutral
 * domain shape. Invalid team relationships are rejected rather than entering
 * projection persistence under an ambiguous identity.
 */
export function translateSleeperWeekSchedule(schedule: WeekSchedule): NflWeekSchedule {
  const translated: Partial<Record<NflTeam, TeamWeek>> = {};

  for (const [sourceTeam, game] of Object.entries(schedule)) {
    const team = canonicalNflTeam(sourceTeam);
    if (!team || translated[team]) {
      throw new Error('Sleeper returned an invalid NFL schedule.');
    }
    if (game.kind === 'bye') {
      translated[team] = { kind: 'bye' };
      continue;
    }
    const opponent = canonicalNflTeam(game.opponent);
    if (!opponent || opponent === team) {
      throw new Error('Sleeper returned an invalid NFL schedule.');
    }
    translated[team] = {
      kind: 'scheduled',
      opponent,
      location: game.location,
      date: game.date,
      kickoffAt: game.kickoffAt,
    };
  }

  return translated as NflWeekSchedule;
}

/** Adapts the existing cached Sleeper calendar loader without adding requests. */
export function createSleeperNflCalendar(
  loadCadence: SleeperCadenceLoader,
): NflCalendarPort {
  return {
    async getCadenceState(configuration: LeagueConfiguration): Promise<LeagueCadenceState> {
      const leagueId = String(configuration.leagueRef.externalId);
      const source = await loadCadence(leagueId);
      if (source.sleeperLeagueId !== leagueId) {
        throw new Error('Sleeper returned cadence data for a different league.');
      }
      const lineupShape = sleeperLineupObservationShape(configuration.leagueRef, source.matchupShape);
      if (!validLineupShape(lineupShape)) throw new Error('Sleeper did not return a valid authoritative lineup shape.');
      const schedule = translateSleeperWeekSchedule(source.schedule);
      const isDefaultPeriod = source.defaultDisplayWeek === source.week;

      return {
        configuration,
        period: sleeperRegularSeasonPeriod(source.season, source.week),
        periodAuthority: sleeperPeriodAuthority(configuration, source),
        currentPeriod: {
          season: currentSeasonNumber(source.currentNflSeason),
          week: source.currentNflWeek,
          seasonType: source.currentNflSeasonType,
        },
        schedule,
        lineupShape,
        defaultPeriodCadence: {
          isCurrentRegularPeriod: isDefaultPeriod && source.currentNflSeasonType === 'regular'
            && source.currentNflSeason === source.season && source.currentNflWeek === source.week,
          // An advanced display week does not borrow the active scoring week's timing.
          games: isDefaultPeriod ? Object.values(schedule).flatMap((game) => game.kind === 'scheduled'
            ? [{ kickoffAt: game.kickoffAt, date: game.date }] : []) : [],
        },
      };
    },
  };
}
