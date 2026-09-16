import { selectMyTeamMatchup } from './my-team-matchup';
import type { SleeperMatchup } from './transform';
import type { OverviewData, Team } from './types';

export const MY_TEAM_SCHEDULE_WEEKS = 15;
export type MyTeamScheduleStatus = 'final' | 'upcoming' | 'unknown';
type ScheduleSide = { team: Team; points: number | null };
export type MyTeamScheduleMatchup = { id: string; sides: [ScheduleSide, ScheduleSide] };
export type MyTeamScheduleWeek = {
  week: number;
  status: MyTeamScheduleStatus;
  matchups: MyTeamScheduleMatchup[];
};
export interface MyTeamScheduleData extends OverviewData {
  weeks: MyTeamScheduleWeek[];
}
export type MyTeamScheduleEntry = {
  week: number;
  status: MyTeamScheduleStatus;
  opponent: Team | null;
  points: number | null;
  opponentPoints: number | null;
  result: 'W' | 'L' | 'T' | null;
};

function officialPoints(row: SleeperMatchup): number | null {
  const value = row.custom_points ?? row.points;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Team-level schedule evidence does not depend on a published starting lineup. */
export function buildMyTeamScheduleWeeks(
  teams: readonly Team[],
  history: readonly (readonly SleeperMatchup[] | null)[],
  context: { completedWeeks: readonly number[]; activeWeek: number | null; preseason: boolean },
): MyTeamScheduleWeek[] {
  const byTeam = new Map(teams.map(team => [team.id, team]));
  return Array.from({ length: MY_TEAM_SCHEDULE_WEEKS }, (_, index) => {
    const week = index + 1;
    const rows = history[index] ?? [];
    const counts = new Map<number, number>();
    const groups = new Map<number, SleeperMatchup[]>();
    for (const row of rows) {
      counts.set(row.roster_id, (counts.get(row.roster_id) ?? 0) + 1);
      if (row.matchup_id === null || !Number.isSafeInteger(row.matchup_id) || row.matchup_id < 1) continue;
      const group = groups.get(row.matchup_id) ?? [];
      group.push(row);
      groups.set(row.matchup_id, group);
    }
    const matchups: MyTeamScheduleMatchup[] = [];
    for (const [id, group] of groups) {
      if (group.length !== 2 || group.some(row => counts.get(row.roster_id) !== 1 || !byTeam.has(row.roster_id))) continue;
      const side = (row: SleeperMatchup): ScheduleSide => ({ team: byTeam.get(row.roster_id)!, points: officialPoints(row) });
      matchups.push({ id: String(id), sides: [side(group[0]), side(group[1])] });
    }
    const status = context.completedWeeks.includes(week) ? 'final'
      : context.preseason || (context.activeWeek !== null && week > context.activeWeek) ? 'upcoming' : 'unknown';
    return { week, status, matchups };
  });
}

/** The same league-scoped selection/default as My Team, without persisting a fallback. */
export function selectMyTeamSchedule(data: MyTeamScheduleData, selected: number | null): {
  team: Team | null; weeks: MyTeamScheduleEntry[];
} {
  const { team } = selectMyTeamMatchup(data.teams, [], selected);
  const weeks = Array.from({ length: MY_TEAM_SCHEDULE_WEEKS }, (_, index): MyTeamScheduleEntry => {
    const week = index + 1;
    const source = data.weeks.find(candidate => candidate.week === week);
    const matches = source?.matchups.filter(matchup => matchup.sides.some(side => side.team.id === team?.id)) ?? [];
    const matchup = matches.length === 1 ? matches[0] : null;
    const own = matchup?.sides.find(side => side.team.id === team?.id);
    const other = matchup?.sides.find(side => side.team.id !== team?.id);
    const points = own?.points ?? null;
    const opponentPoints = other?.points ?? null;
    const status = source?.status ?? 'unknown';
    // Formatting never changes the official result, including a narrow margin.
    const result = status !== 'final' || points === null || opponentPoints === null ? null
      : points > opponentPoints ? 'W' : points < opponentPoints ? 'L' : 'T';
    return { week, status, opponent: other?.team ?? null, points, opponentPoints, result };
  });
  return { team, weeks };
}
