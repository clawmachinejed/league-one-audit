import type {
  NflTeam,
  NflWeekSchedule,
  ProjectionSlate,
  ProjectionStats,
} from '../../domain/contracts';
import { hasCompleteProjectionStats } from '../../domain/scoring';
import { canonicalNflTeam } from '../../../nfl-teams';

const MIN_REGULAR_SEASON_TEAMS = 26;
const MAX_REGULAR_SEASON_TEAMS = 32;
const MISSING_TEAM_TOLERANCE = 2;
const CORE_OFFENSE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;

type ProjectionCoverageCategory = typeof CORE_OFFENSE_POSITIONS[number] | 'DEF';

export type ProjectionCoverageInput = Readonly<{
  nflTeam: unknown;
  position?: unknown;
  scoringStats: ProjectionStats;
}>;

type CoveredTeamSets = Record<ProjectionCoverageCategory, Set<NflTeam>>;

export type ProjectionSlateAssessment = Readonly<{
  complete: boolean;
  expectedTeams: number;
  requiredTeamsPerCategory: number;
  coveredTeams: Readonly<Record<ProjectionCoverageCategory, number>>;
}>;

function emptyCoverage(): Record<ProjectionCoverageCategory, number> {
  return { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 };
}

function categoryCoverage(
  players: readonly ProjectionCoverageInput[],
  defenses: readonly ProjectionCoverageInput[],
  expected?: ReadonlySet<NflTeam>,
): CoveredTeamSets {
  const covered = {
    QB: new Set<NflTeam>(),
    RB: new Set<NflTeam>(),
    WR: new Set<NflTeam>(),
    TE: new Set<NflTeam>(),
    DEF: new Set<NflTeam>(),
  };
  for (const projection of players) {
    if (projection.scoringStats.kind !== 'offense'
      || !hasCompleteProjectionStats(projection.scoringStats)) continue;
    const team = canonicalNflTeam(projection.nflTeam);
    const position = typeof projection.position === 'string'
      ? projection.position.trim().toUpperCase()
      : null;
    if (!team || (expected && !expected.has(team)) || !CORE_OFFENSE_POSITIONS.includes(
      position as typeof CORE_OFFENSE_POSITIONS[number],
    )) continue;
    covered[position as typeof CORE_OFFENSE_POSITIONS[number]].add(team);
  }
  for (const projection of defenses) {
    if (projection.scoringStats.kind !== 'defense'
      || !hasCompleteProjectionStats(projection.scoringStats)) continue;
    const team = canonicalNflTeam(projection.nflTeam);
    if (team && (!expected || expected.has(team))) covered.DEF.add(team);
  }
  return covered;
}

function coverageCounts(covered: CoveredTeamSets): Record<ProjectionCoverageCategory, number> {
  return {
    QB: covered.QB.size,
    RB: covered.RB.size,
    WR: covered.WR.size,
    TE: covered.TE.size,
    DEF: covered.DEF.size,
  };
}

function everyTeamHasOffenseCoverage(covered: CoveredTeamSets, expected: ReadonlySet<NflTeam>): boolean {
  return [...expected].every((team) => CORE_OFFENSE_POSITIONS.some((position) => (
    covered[position].has(team)
  )));
}

/**
 * Cheap raw-response guard used before the hour-long production cache. At least
 * 26 teams play in a regular-season week; the existing two-team tolerance gives
 * a conservative floor of 24 complete teams in every scoring category.
 */
export function hasPlausibleTank01ProjectionEnvelope(
  players: readonly ProjectionCoverageInput[],
  defenses: readonly ProjectionCoverageInput[],
): boolean {
  const minimumTeamsPerCategory = MIN_REGULAR_SEASON_TEAMS - MISSING_TEAM_TOLERANCE;
  return Object.values(coverageCounts(categoryCoverage(players, defenses)))
    .every((count) => count >= minimumTeamsPerCategory);
}

function scheduledTeams(schedule: NflWeekSchedule): Set<NflTeam> | null {
  const entries = Object.entries(schedule);
  if (entries.length < MIN_REGULAR_SEASON_TEAMS || entries.length > MAX_REGULAR_SEASON_TEAMS) {
    return null;
  }

  const scheduledEntries = entries.filter(([, game]) => game?.kind === 'scheduled');
  if (scheduledEntries.length < MIN_REGULAR_SEASON_TEAMS
    || scheduledEntries.length > MAX_REGULAR_SEASON_TEAMS
    || scheduledEntries.length % 2 !== 0) return null;

  const teams = new Set<NflTeam>();
  for (const [key, game] of entries) {
    const team = canonicalNflTeam(key);
    if (!team || team !== key || !game) return null;
    if (game.kind === 'bye') continue;
    const opponent = canonicalNflTeam(game.opponent);
    if (!opponent || opponent === team) return null;
    const reciprocal = schedule[opponent];
    if (reciprocal?.kind !== 'scheduled' || canonicalNflTeam(reciprocal.opponent) !== team
      || reciprocal.location === game.location || reciprocal.date !== game.date) return null;
    teams.add(team);
  }
  return teams.size === scheduledEntries.length ? teams : null;
}

/**
 * Certifies a crosswalked weekly slate before an isolated absent projection may
 * use the existing explicit-zero policy.
 */
export function assessProjectionSlate(
  slate: ProjectionSlate,
  schedule: NflWeekSchedule,
): ProjectionSlateAssessment {
  const expected = scheduledTeams(schedule);
  if (!expected) {
    return {
      complete: false,
      expectedTeams: 0,
      requiredTeamsPerCategory: 0,
      coveredTeams: emptyCoverage(),
    };
  }

  const players = slate.projections.filter((projection) => (
    projection.identity.primary.entityKind === 'player'
      // Preserve the existing crosswalk-completeness safety gate. Provider-native
      // unmatched rows are durable, but cannot prove an official player match.
      && projection.identity.aliases.length > 0
  ));
  const defenses = slate.projections.filter((projection) => {
    if (projection.identity.primary.entityKind !== 'team-defense') return false;
    const identityTeam = canonicalNflTeam(projection.identity.primary.externalId);
    const rowTeam = canonicalNflTeam(projection.nflTeam);
    return identityTeam !== null && rowTeam === identityTeam;
  });
  const requiredTeamsPerCategory = expected.size - MISSING_TEAM_TOLERANCE;
  const covered = categoryCoverage(players, defenses, expected);
  const coveredTeams = coverageCounts(covered);
  return {
    complete: Object.values(coveredTeams).every((count) => count >= requiredTeamsPerCategory)
      && everyTeamHasOffenseCoverage(covered, expected),
    expectedTeams: expected.size,
    requiredTeamsPerCategory,
    coveredTeams,
  };
}
