import type { MatchupPeriodContext } from './matchup-period';
import { compareTeams, type SleeperMatchup } from './transform';
import type { MatchupsData, ProjectedStandingsBasis, StandingsData, StandingsTeam } from './types';

export type { ProjectedStandingsBasis } from './types';

type Unavailable = Extract<ProjectedStandingsBasis, { kind: 'unavailable' }>;
type ResultPair = readonly [{ id: number; points: number }, { id: number; points: number }];
export type ProjectedStandingsResult = {
  kind: 'projected'; teams: StandingsTeam[]; week: number;
  coverage: Readonly<{
    includedMatchups: number;
    totalMatchups: number;
    unresolvedTeamIds: readonly number[];
  }>;
} | Unavailable;

function unavailable(reason: string): Unavailable {
  return { kind: 'unavailable', reason };
}

function hundredths(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  // Matchups displays projected totals with toFixed(2). Derive exact units from
  // that display string, including binary midpoint and negative rounding cases.
  const displayed = value.toFixed(2);
  if (!/^-?\d+\.\d{2}$/u.test(displayed)) return null;
  const result = Number(displayed.replace('.', ''));
  return Number.isSafeInteger(result) ? result : null;
}

function validTeams(teams: readonly StandingsTeam[]): boolean {
  return teams.length >= 2 && teams.length % 2 === 0
    && new Set(teams.map((team) => team.id)).size === teams.length
    && teams.every((team) => Number.isSafeInteger(team.id) && team.id > 0
      && [team.wins, team.losses, team.ties].every((count) => Number.isSafeInteger(count) && count >= 0)
      && hundredths(team.pointsFor) !== null
      && (hundredths(team.pointsAgainst) !== null
        || (team.pointsAgainst === null && team.wins + team.losses + team.ties === 0 && team.pointsFor === 0)));
}

/** Official history requires the whole league; a projection may add only proved pairs. */
function addResults(
  teams: readonly StandingsTeam[],
  pairs: readonly ResultPair[],
  coverage: 'whole-league' | 'known-pairs' = 'whole-league',
): StandingsTeam[] | null {
  if (!validTeams(teams)) return null;
  const result = new Map(teams.map((team) => [team.id, { ...team }]));
  const seen = new Set<number>();
  for (const pair of pairs) {
    const scores = pair.map((side) => hundredths(side.points));
    if (scores.some((score) => score === null)) return null;
    for (let index = 0; index < 2; index += 1) {
      const side = pair[index];
      const team = result.get(side.id);
      if (!team || seen.has(side.id)) return null;
      seen.add(side.id);
      const own = scores[index]!;
      const opponent = scores[1 - index]!;
      const pointsFor = hundredths(team.pointsFor)! + own;
      const pointsAgainst = hundredths(team.pointsAgainst ?? 0)! + opponent;
      if (!Number.isSafeInteger(pointsFor) || !Number.isSafeInteger(pointsAgainst)) return null;
      team.pointsFor = pointsFor / 100;
      team.pointsAgainst = pointsAgainst / 100;
      if (own > opponent) team.wins += 1;
      else if (own < opponent) team.losses += 1;
      else team.ties += 1;
    }
  }
  return coverage === 'known-pairs' || seen.size === teams.length ? [...result.values()].sort(compareTeams) : null;
}

function officialPairs(rows: readonly SleeperMatchup[]): ResultPair[] | null {
  const groups = new Map<number, Array<{ id: number; points: number }>>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.matchup_id) || row.matchup_id === null || row.matchup_id < 1) return null;
    // Sleeper custom_points is the commissioner's official score override, including zero.
    const score = hundredths(row.custom_points ?? row.points);
    if (score === null) return null;
    const group = groups.get(row.matchup_id) ?? [];
    group.push({ id: row.roster_id, points: score / 100 });
    groups.set(row.matchup_id, group);
  }
  if ([...groups.values()].some((group) => group.length !== 2)) return null;
  return [...groups.values()].map((group) => [group[0], group[1]]);
}

/** Rebuild only completed regular-season weeks; aggregate timing cannot double-count the active week. */
export function buildCompletedStandingsBasis(
  teams: readonly StandingsTeam[],
  week: number,
  history: readonly (readonly SleeperMatchup[] | null)[],
): ProjectedStandingsBasis {
  if (!Number.isInteger(week) || week < 1 || week > 18 || !validTeams(teams)) {
    return unavailable('The official standings baseline is incomplete.');
  }
  if (history.length !== week - 1) return unavailable('Completed matchup history is incomplete.');
  let completed: StandingsTeam[] = teams.map((team) => ({ ...team, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }));
  for (let index = 0; index < history.length; index += 1) {
    const rows = history[index];
    const pairs = rows === null ? null : officialPairs(rows);
    const next = pairs === null ? null : addResults(completed, pairs);
    if (!next) return unavailable(`Official matchup results for Week ${index + 1} are incomplete.`);
    completed = next;
  }
  return { kind: 'ready', week, teams: completed.sort(compareTeams) };
}

/** Missing PA is equivalent to zero only before a team has played or scored. */
export function standingsTotalsMatch(left: readonly StandingsTeam[], right: readonly StandingsTeam[]): boolean {
  if (!validTeams(left) || !validTeams(right) || left.length !== right.length) return false;
  const expected = new Map(right.map((team) => [team.id, team]));
  return left.every((team) => {
    const other = expected.get(team.id);
    return other !== undefined && team.wins === other.wins && team.losses === other.losses && team.ties === other.ties
      && hundredths(team.pointsFor) === hundredths(other.pointsFor)
      && hundredths(team.pointsAgainst ?? 0) === hundredths(other.pointsAgainst ?? 0);
  });
}

/**
 * Sleeper's aggregate update boundary is not documented. Explain the entire league
 * using either completed history or that history plus the current official results.
 * Unexplained manual adjustments or partially updated aggregates remain unavailable.
 */
export function reconcileStandingsBasis(
  basis: ProjectedStandingsBasis,
  official: readonly StandingsTeam[],
  currentWeekRows: readonly SleeperMatchup[] | null = null,
): ProjectedStandingsBasis {
  if (basis.kind === 'unavailable' || standingsTotalsMatch(official, basis.teams)) return basis;
  const pairs = currentWeekRows === null ? null : officialPairs(currentWeekRows);
  const withCurrent = pairs === null ? null : addResults(basis.teams, pairs);
  return withCurrent && standingsTotalsMatch(official, withCurrent)
    ? basis : unavailable('Official standings and completed matchup history do not agree.');
}

/** The caller supplies the league-bound stored snapshot; this calculation never retrieves or writes data. */
export function projectStandings(
  data: StandingsData,
  matchups: MatchupsData,
  context: MatchupPeriodContext,
): ProjectedStandingsResult {
  const basis = data.projectionBasis;
  if (!basis) return unavailable('The official standings baseline is unavailable.');
  if (basis.kind === 'unavailable') return basis;
  if (!Number.isInteger(basis.week) || basis.week < 1 || basis.week > 18
    || context.lifecycle !== 'active' || context.temporalState !== 'active' || context.refreshDue
    || context.activeSeason !== Number(data.league.season)
    || matchups.league.season !== data.league.season
    || context.activeWeek !== basis.week || matchups.week !== basis.week) {
    return unavailable('Current-week projections are not ready for these standings.');
  }
  if (!validTeams(data.teams) || !validTeams(basis.teams)
    || data.teams.length !== basis.teams.length
    || !data.teams.every((team) => basis.teams.some((candidate) => candidate.id === team.id))
    || matchups.teams.length !== basis.teams.length
    || new Set(matchups.teams.map((team) => team.id)).size !== basis.teams.length
    || !matchups.teams.every((team) => basis.teams.some((candidate) => candidate.id === team.id))) {
    return unavailable('Current-week projections do not cover every league team.');
  }
  const ids = new Set<string>();
  const expectedTeamIds = new Set(basis.teams.map((team) => team.id));
  const seenTeamIds = new Set<number>();
  const unresolvedTeamIds: number[] = [];
  const pairs: ResultPair[] = [];
  for (const matchup of matchups.matchups) {
    if (!matchup.id || ids.has(matchup.id) || matchup.sides.length !== 2) {
      return unavailable('Current-week matchup pairings are incomplete.');
    }
    ids.add(matchup.id);
    const [left, right] = matchup.sides;
    // Validate even the unresolved sides. Skipping a missing projection must not
    // conceal a duplicate team, an unknown roster or a malformed numeric value.
    for (const side of matchup.sides) {
      if (!expectedTeamIds.has(side.team.id) || seenTeamIds.has(side.team.id)) {
        return unavailable('Current-week matchup pairings are incomplete.');
      }
      seenTeamIds.add(side.team.id);
      if (side.projectedPoints !== null && hundredths(side.projectedPoints) === null) {
        return unavailable('A current-week projected total is invalid.');
      }
    }
    if (left.projectedPoints === null || right.projectedPoints === null) {
      // Neither team's record or PF/PA changes without both sides of the result.
      unresolvedTeamIds.push(left.team.id, right.team.id);
      continue;
    }
    if (matchup.status === 'unknown') {
      return unavailable('Current-week matchup status is unknown.');
    }
    pairs.push([
      { id: left.team.id, points: left.projectedPoints! },
      { id: right.team.id, points: right.projectedPoints! },
    ]);
  }
  if (seenTeamIds.size !== expectedTeamIds.size) {
    return unavailable('Current-week projections do not cover every league team.');
  }
  const teams = addResults(basis.teams, pairs, 'known-pairs');
  return teams ? { kind: 'projected', week: basis.week, teams,
    coverage: { includedMatchups: pairs.length, totalMatchups: matchups.matchups.length,
      unresolvedTeamIds: unresolvedTeamIds.sort((left, right) => left - right) } }
    : unavailable('Current-week projections do not cover every league team.');
}
