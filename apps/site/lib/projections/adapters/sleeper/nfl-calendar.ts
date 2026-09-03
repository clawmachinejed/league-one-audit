import type { ProjectionCadenceInput } from '../../../sleeper';
import type {
  LeagueCadenceState,
  LeagueConfiguration,
  LeaguePeriodAuthority,
  NflPhase,
} from '../../domain/contracts';
import type { NflCalendarPort } from '../../ports/nfl-calendar';
import { compatibleRevision } from '../../shared/revision-compatibility';
import { validLineupShape } from '../../domain/lineup-observation';
import { sleeperLineupObservationShape } from './lineup-observation';
import { sleeperRegularSeasonPeriod, translateSleeperWeekSchedule } from './schedule';

export type SleeperCadenceLoader = (
  leagueId: string,
) => Promise<ProjectionCadenceInput>;

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
