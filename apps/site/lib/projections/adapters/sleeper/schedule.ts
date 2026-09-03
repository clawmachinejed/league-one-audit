import { canonicalNflTeam } from '../../../nfl-teams';
import type { WeekSchedule } from '../../../nfl-schedule';
import type { LeaguePeriod, NflTeam, NflWeekSchedule, TeamWeek } from '../../domain/contracts';

export function sleeperRegularSeasonPeriod(season: string, week: number): LeaguePeriod {
  if (!/^20\d{2}$/u.test(season) || !Number.isInteger(week) || week < 1 || week > 18) {
    throw new Error('Sleeper returned an invalid projection season or week.');
  }
  return { season: Number(season), seasonType: 'regular', week };
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

