import { canonicalNflTeam, type NflTeam } from './nfl-teams';
import type { WeekSchedule } from './nfl-schedule';
import type { Tank01AvailableResult } from './tank01';

const MIN_REGULAR_SEASON_TEAMS = 26;
const MAX_REGULAR_SEASON_TEAMS = 32;
const MISSING_TEAM_TOLERANCE = 2;
const CORE_OFFENSE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;

type ProjectionCoverageCategory = typeof CORE_OFFENSE_POSITIONS[number] | 'DEF';
type ProjectionIdentity = Readonly<{ team: unknown; position: unknown }>;

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
  players: readonly ProjectionIdentity[],
  defenseTeams: readonly unknown[],
  expected?: ReadonlySet<NflTeam>,
): Record<ProjectionCoverageCategory, number> {
  const covered = {
    QB: new Set<NflTeam>(),
    RB: new Set<NflTeam>(),
    WR: new Set<NflTeam>(),
    TE: new Set<NflTeam>(),
    DEF: new Set<NflTeam>(),
  };
  for (const projection of players) {
    const team = canonicalNflTeam(projection.team);
    const position = typeof projection.position === 'string'
      ? projection.position.trim().toUpperCase()
      : null;
    if (!team || (expected && !expected.has(team)) || !CORE_OFFENSE_POSITIONS.includes(
      position as typeof CORE_OFFENSE_POSITIONS[number],
    )) continue;
    covered[position as typeof CORE_OFFENSE_POSITIONS[number]].add(team);
  }
  for (const value of defenseTeams) {
    const team = canonicalNflTeam(value);
    if (team && (!expected || expected.has(team))) covered.DEF.add(team);
  }
  return {
    QB: covered.QB.size,
    RB: covered.RB.size,
    WR: covered.WR.size,
    TE: covered.TE.size,
    DEF: covered.DEF.size,
  };
}

/**
 * Cheap raw-response guard used before the hour-long production cache. In the
 * 18-week NFL format at least 26 teams play in a regular-season week; applying
 * the same two-team omission tolerance gives a deliberately conservative floor.
 */
export function hasPlausibleTank01ProjectionEnvelope(
  players: readonly ProjectionIdentity[],
  defenseTeams: readonly unknown[],
): boolean {
  const minimumTeamsPerCategory = MIN_REGULAR_SEASON_TEAMS - MISSING_TEAM_TOLERANCE;
  return Object.values(categoryCoverage(players, defenseTeams))
    .every((count) => count >= minimumTeamsPerCategory);
}

/**
 * Returns the teams in one structurally complete NFL week. This establishes an
 * independent envelope for Tank01 rather than guessing a fixed player-row count.
 */
function scheduledTeams(schedule: WeekSchedule): Set<NflTeam> | null {
  const entries = Object.entries(schedule);
  if (entries.length < MIN_REGULAR_SEASON_TEAMS || entries.length > MAX_REGULAR_SEASON_TEAMS
    || entries.length % 2 !== 0) return null;

  const teams = new Set<NflTeam>();
  for (const [key, game] of entries) {
    const team = canonicalNflTeam(key);
    if (!team || team !== key || game.kind !== 'scheduled') return null;
    const opponent = canonicalNflTeam(game.opponent);
    if (!opponent || opponent === team) return null;
    const reciprocal = schedule[opponent];
    if (reciprocal?.kind !== 'scheduled' || canonicalNflTeam(reciprocal.opponent) !== team
      || reciprocal.location === game.location || reciprocal.date !== game.date) return null;
    teams.add(team);
  }
  return teams.size === entries.length ? teams : null;
}

/**
 * Verifies that an available Tank01 response represents a broadly complete weekly
 * slate before callers may interpret an absent individual projection as zero.
 *
 * Every scheduled NFL offense should be represented at each core fantasy position,
 * and every scheduled defense should be represented. A two-team tolerance permits
 * isolated provider omissions (including one missing starter or D/ST) without
 * allowing a one-row or broadly truncated response to replace a good snapshot.
 */
export function assessTank01ProjectionSlate(
  result: Tank01AvailableResult,
  schedule: WeekSchedule,
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

  const validDefenseTeams = Object.entries(result.projections.byDefenseTeam).flatMap(([key, projection]) => {
    const keyTeam = canonicalNflTeam(key);
    const rowTeam = canonicalNflTeam(projection.team);
    return keyTeam && rowTeam === keyTeam ? [keyTeam] : [];
  });

  const requiredTeamsPerCategory = expected.size - MISSING_TEAM_TOLERANCE;
  const coveredTeams = categoryCoverage(
    Object.values(result.projections.bySleeperId),
    validDefenseTeams,
    expected,
  );
  return {
    complete: Object.values(coveredTeams).every((count) => count >= requiredTeamsPerCategory),
    expectedTeams: expected.size,
    requiredTeamsPerCategory,
    coveredTeams,
  };
}
