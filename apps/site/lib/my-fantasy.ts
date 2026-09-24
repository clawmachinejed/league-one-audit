import type { MatchupPeriodContext } from './matchup-period';
import { selectMyTeamMatchup } from './my-team-matchup';
import { projectStandings } from './projected-standings';
import { startingSlots } from './sleeper-lineup';
import { compareTeams } from './transform';
import type { Matchup, MatchupsData, Player, StandingsData, Team } from './types';

export type MyFantasyAttentionIssue = Readonly<{
  kind: 'out' | 'empty' | 'bye';
  playerId: string;
  playerName: string;
  slot: string;
  message: string;
}>;

export type MyFantasyAttention = Readonly<{
  /** Verified describes coverage; known issues may coexist with incomplete coverage. */
  status: 'verified' | 'unknown' | 'completed';
  issues: readonly MyFantasyAttentionIssue[];
  reason: string | null;
}>;

export type MyFantasyLeagueSummary = Readonly<{
  team: Team | null;
  matchup: Matchup | null;
  currentRank: number | null;
  projectedRank: number | null;
  projectedRankStatus: 'available' | 'unavailable';
  projectedRankReason: string | null;
  projectedOutcome: 'win' | 'loss' | 'tie' | 'unavailable';
  attention: MyFantasyAttention;
}>;

/** Only evidence that official standings may have changed; live scoring itself is insufficient. */
export function myFantasyStandingsEvidence(data: MatchupsData): string {
  return JSON.stringify({
    season: data.league.season,
    week: data.week,
    records: data.teams.map(team => [team.id, team.wins, team.losses, team.ties])
      .sort((left, right) => left[0] - right[0]),
    completed: data.matchups.map(matchup => [matchup.id, matchup.status === 'final'] as const)
      .sort((left, right) => left[0].localeCompare(right[0])),
  });
}

function isActivePeriod(data: MatchupsData, context: MatchupPeriodContext): boolean {
  return context.lifecycle === 'active' && context.temporalState === 'active'
    && !context.refreshDue && context.activeSeason === Number(data.league.season)
    && context.activeWeek === data.week;
}

function attentionIssue(player: Player, kind: MyFantasyAttentionIssue['kind'], message: string): MyFantasyAttentionIssue {
  return { kind, playerId: player.id, playerName: player.name, slot: player.slot, message };
}

function lineupAttention(
  data: MatchupsData, context: MatchupPeriodContext, matchup: Matchup | null, evaluatedAt: Date,
): MyFantasyAttention {
  if (context.temporalState === 'past' || context.lifecycle === 'complete' || matchup?.status === 'final') {
    return { status: 'completed', issues: [], reason: 'This matchup is complete.' };
  }
  if (!isActivePeriod(data, context) || !matchup || matchup.status === 'unknown' || !Number.isFinite(evaluatedAt.getTime())) {
    return { status: 'unknown', issues: [], reason: 'Current lineup status is unavailable.' };
  }
  const starters = matchup.sides[0]?.starters;
  const slots = startingSlots(data.league.rosterPositions);
  if (!starters || !slots.length || starters.length !== slots.length
    || starters.some((player, index) => player.slot !== slots[index])) {
    return { status: 'unknown', issues: [], reason: 'The complete starting lineup is unavailable.' };
  }
  const issues: MyFantasyAttentionIssue[] = [];
  // Warnings may include incomplete player metadata. A null injury designation
  // cannot prove a healthy lineup when the source itself reports missing data.
  let complete = !data.warning;
  for (const player of starters) {
    if (player.id.startsWith('empty-')) {
      issues.push(attentionIssue(player, 'empty', `${player.slot} starting position is empty.`));
      continue;
    }
    const game = player.game;
    if (game?.kind === 'bye') {
      issues.push(attentionIssue(player, 'bye', `${player.name} has a bye this week.`));
      continue;
    }
    if (!game) {
      complete = false;
      continue;
    }
    // Current injury metadata cannot establish a problem that preceded kickoff.
    if (game.liveScore || game.finalScore) continue;
    const kickoff = game.kickoffAt === null ? Number.NaN : Date.parse(game.kickoffAt);
    if (!Number.isFinite(kickoff)) {
      complete = false;
      continue;
    }
    if (kickoff <= evaluatedAt.getTime()) continue;
    if (player.injuryStatus?.trim().toUpperCase() === 'OUT') {
      issues.push(attentionIssue(player, 'out', `${player.name} is OUT and in the starting lineup.`));
    }
  }
  return { status: complete ? 'verified' : 'unknown', issues,
    reason: complete ? null : data.warning ? 'Some current league information is unavailable.'
      : 'Some player game information is unavailable.' };
}

function validOfficialTeams(teams: readonly Team[]): boolean {
  return teams.length > 0 && new Set(teams.map(team => team.id)).size === teams.length
    && teams.every(team => Number.isSafeInteger(team.id) && team.id > 0
      && [team.wins, team.losses, team.ties].every(value => Number.isSafeInteger(value) && value >= 0)
      && Number.isFinite(team.pointsFor)
      && (team.pointsAgainst === null || Number.isFinite(team.pointsAgainst)));
}

function projectedOutcome(
  data: MatchupsData, context: MatchupPeriodContext, matchup: Matchup | null,
): MyFantasyLeagueSummary['projectedOutcome'] {
  if (!isActivePeriod(data, context) || !matchup || matchup.status === 'unknown' || matchup.sides.length !== 2) return 'unavailable';
  const values = matchup.sides.map(side => side.projectedPoints);
  if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) return 'unavailable';
  // Compare the same two-decimal totals the matchup presents, including displayed ties.
  const [own, opponent] = values.map(value => Number(value!.toFixed(2)));
  return own > opponent ? 'win' : own < opponent ? 'loss' : 'tie';
}

/** Presentation only: official scores and shared standings calculations remain authoritative. */
export function getMyFantasyLeagueSummary(
  data: MatchupsData,
  periodContext: MatchupPeriodContext,
  standingsData: StandingsData | null,
  selected: number | null,
  evaluatedAt = new Date(),
): MyFantasyLeagueSummary {
  const selection = selectMyTeamMatchup(data.teams, data.matchups, selected);
  const official = standingsData?.league.season === data.league.season
    && validOfficialTeams(standingsData.teams)
    && standingsData.teams.length === data.teams.length
    && data.teams.every(team => standingsData.teams.some(candidate => candidate.id === team.id))
    ? [...standingsData.teams].sort(compareTeams) : null;
  const currentIndex = official?.findIndex(team => team.id === selection.team?.id) ?? -1;
  const team = currentIndex >= 0 ? official![currentIndex] : selection.team;
  const projection = standingsData ? projectStandings(standingsData, data, periodContext) : null;
  const projectionComplete = projection?.kind === 'projected'
    && projection.coverage.includedMatchups === projection.coverage.totalMatchups
    && projection.coverage.unresolvedTeamIds.length === 0;
  const projectedIndex = projectionComplete ? projection.teams.findIndex(candidate => candidate.id === team?.id) : -1;
  const projectedRank = projectedIndex >= 0 ? projectedIndex + 1 : null;
  return {
    team,
    matchup: selection.matchup,
    currentRank: currentIndex >= 0 ? currentIndex + 1 : null,
    projectedRank,
    projectedRankStatus: projectedRank === null ? 'unavailable' : 'available',
    projectedRankReason: projectedRank !== null ? null : projection?.kind === 'unavailable' ? projection.reason
      : projection?.kind === 'projected' ? 'Projected results do not cover every league matchup.'
        : 'The official standings baseline is unavailable.',
    projectedOutcome: projectedOutcome(data, periodContext, selection.matchup),
    attention: lineupAttention(data, periodContext, selection.matchup, evaluatedAt),
  };
}
