import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import type { MatchupPeriodContext } from '../matchup-period';
import { buildCompletedStandingsBasis, reconcileStandingsBasis, projectStandings } from '../projected-standings';
import { stableJson } from '../projections/shared/stable-json';
import type { League, MatchupsData, StandingsTeam } from '../types';
import type { ExactMatchupCompatibilityRead } from './exact-matchup-compatibility';
import { exactMatchupReferenceFailure, hasExactNflMapping } from './exact-matchup-reference-scope';
import { leagueSettingsScope, type AcceptedLeagueSettingsRead } from './league-settings';
import type { SeasonOverviewSourceRead } from './season-overview-source';
import { seasonOverviewCalendar, seasonOverviewHistory, validSeasonOverviewTeams,
  type SeasonOverviewCalendarEvidence, type SeasonOverviewMatchupCapture, type SeasonOverviewTeamIdentity } from './season-overview-schedules';

export type SeasonOverviewProjectionInput = Readonly<{
  mapping: AdministrationSourceMapping; source: SeasonOverviewSourceRead;
  teams: readonly SeasonOverviewTeamIdentity[]; league: League; updatedAt: string;
  settings: AcceptedLeagueSettingsRead; captures: readonly SeasonOverviewMatchupCapture[];
  compatibility: ExactMatchupCompatibilityRead | null; context: MatchupPeriodContext;
  calendar: SeasonOverviewCalendarEvidence | null;
}>;
const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason,
  officialFactsPreserved: true as const });

/** Internal composition over existing arithmetic. This never labels a rounded projection baseline
 * as an exact official record and never retrieves, scores, publishes, or alters a stored snapshot. */
export function buildSeasonOverviewProjection(input: SeasonOverviewProjectionInput) {
  const { source, mapping, teams, compatibility, context, settings } = input;
  const week = context.activeWeek;
  if (source.status !== 'available' || stableJson(source.mapping) !== stableJson(mapping)
    || !validSeasonOverviewTeams(teams) || input.league.season !== String(mapping.scope.season)
    || source.teams.length !== teams.length || source.teams.some(team => !teams.some(display =>
      display.seasonTeamId === team.seasonTeamId && display.externalRosterId === team.externalRosterId))) {
    return unavailable('standings_season_team_scope_mismatch');
  }
  if (week === null || context.activeSeason !== mapping.scope.season || context.lifecycle !== 'active'
    || context.temporalState !== 'active' || context.refreshDue) return unavailable('active_period_unavailable');
  if (settings.status !== 'available' || settings.leagueSeasonId !== mapping.leagueSeasonId
    || settings.accepted.sourceMappingRevisionId !== mapping.revisionId
    || stableJson(settings.accepted.scope) !== stableJson(leagueSettingsScope(mapping))
    || settings.value.season !== mapping.scope.season || settings.value.sourceLeague.provider !== mapping.scope.provider
    || settings.value.sourceLeague.nativeId !== mapping.scope.externalLeagueId) return unavailable('league_settings_scope_mismatch');
  const competition = settings.value.competition;
  const playoff = competition.playoffStartPeriod;
  if (competition.startPeriod.state !== 'known' || competition.startPeriod.value !== 1
    || competition.additionalMatch.state !== 'known' || competition.additionalMatch.value !== 0
    || competition.bestBall.state !== 'known' || competition.bestBall.value !== 0
    || (competition.divisionCount.state !== 'absent'
      && (competition.divisionCount.state !== 'known' || competition.divisionCount.value !== 0))
    || source.teams.some(team => !['known', 'absent', 'null'].includes(team.division.state)
      || (team.division.state === 'known' && team.division.value !== 0))
    || playoff.state !== 'known' || typeof playoff.value !== 'number' || !Number.isInteger(playoff.value)
    || playoff.value < 0 || playoff.value > 18 || (playoff.value > 0 && week >= playoff.value)) {
    return unavailable('projected_standings_format_unsupported');
  }
  if (!compatibility || compatibility.official.status !== 'available') return unavailable('exact_period_compatibility_missing');
  const { official, forecast, gameState, sourceHistory } = compatibility;
  const referenceFailure = exactMatchupReferenceFailure(official, mapping, context);
  if (referenceFailure || !hasExactNflMapping(official) || official.value.period.nativeWeek !== week
    || settings.accepted.contentId !== official.receipt.configurationContentId) {
    return unavailable(referenceFailure ?? 'exact_period_configuration_or_mapping_mismatch');
  }
  if (forecast.status !== 'available') return unavailable(`forecast:${forecast.reason}`);
  if (gameState.status !== 'available') return unavailable(`game_state:${gameState.reason}`);
  if (forecast.reference.refreshDue || gameState.reference.refreshDue) return unavailable('stored_projection_stale');
  if (sourceHistory.status !== 'available' || sourceHistory.scope.leagueSeasonId !== mapping.leagueSeasonId
    || sourceHistory.scope.season !== mapping.scope.season || sourceHistory.scope.week !== week
    || sourceHistory.scope.modelVersion !== 'clock-v1'
    || forecast.reference.snapshotId !== sourceHistory.scope.snapshotId
    || forecast.reference.modelVersion !== 'clock-v1' || stableJson(forecast.reference) !== stableJson(gameState.reference)) {
    return unavailable('stored_projection_reference_mismatch');
  }
  const calendar = seasonOverviewCalendar(mapping, input.calendar);
  if (!calendar || calendar.resolution.week !== week
    || Array.from({ length: week - 1 }, (_, i) => i + 1).some(value => !calendar.completedWeeks.includes(value))) {
    return unavailable('completed_history_calendar_unproved');
  }
  const current = seasonOverviewHistory(mapping, teams, [official]);
  if (current.weeks.length !== 1 || current.failures.length) return unavailable('current_matchup_scope_mismatch');
  const history = seasonOverviewHistory(mapping, teams, input.captures);
  if (history.failures.some(failure => failure.week === null || failure.week < week)) {
    return unavailable('completed_history_capture_invalid');
  }
  // All exact official facts must be available before presenting the legacy derived arithmetic.
  // The source's exact decimals remain on source.teams. Preserve normalizeTeams' PF/PA rounding
  // before the existing projector's distinct toFixed(2) boundary (midpoints can differ).
  if (source.teams.some(team => Object.values(team.record).some(fact => fact.state !== 'known')
    || team.pointsFor.state !== 'known' || (team.pointsAgainst.state !== 'known'
      && !(team.record.wins.value === 0 && team.record.losses.value === 0 && team.record.ties.value === 0
        && team.pointsFor.value === '0' && ['absent', 'null'].includes(team.pointsAgainst.state))))) {
    return unavailable('official_standings_incomplete');
  }
  const officialTeams: StandingsTeam[] = source.teams.map(team => ({
    ...teams.find(display => display.seasonTeamId === team.seasonTeamId)!.team,
    wins: team.record.wins.value!, losses: team.record.losses.value!, ties: team.record.ties.value!,
    waiverOrder: null, waiverBudgetRemaining: null,
  }));
  const completed = buildCompletedStandingsBasis(officialTeams, week,
    Array.from({ length: week - 1 }, (_, i) => history.weeks.find(captured => captured.week === i + 1)?.rows ?? null));
  const basis = reconcileStandingsBasis(completed, officialTeams, current.weeks[0].rows);
  if (basis.kind === 'unavailable') return unavailable(basis.reason);
  if (forecast.teams.length !== teams.length || new Set(forecast.teams.map(team => team.seasonTeamId)).size !== teams.length
    || forecast.teams.some(team => !teams.some(display => display.seasonTeamId === team.seasonTeamId
      && display.externalRosterId === team.externalRosterId))
    || gameState.groups.length !== official.value.groups.length
    || new Set(gameState.groups.map(group => group.identity)).size !== gameState.groups.length
    || official.value.groups.some(group => group.format !== 'paired' || group.participantTeamIds.length !== 2
      || !gameState.groups.some(state => state.identity === group.identity))) {
    return unavailable('stored_projection_team_scope_mismatch');
  }
  const matchups: MatchupsData = { league: input.league, updatedAt: forecast.reference.calculatedAt, week,
    teams: officialTeams, matchups: official.value.groups.map(group => ({ id: group.nativeMatchupId!,
      status: gameState.groups.find(state => state.identity === group.identity)!.status,
      sides: group.participantTeamIds.map(id => {
        const team = official.value.teams.find(candidate => candidate.seasonTeamId === id)!;
        return { team: officialTeams.find(candidate => String(candidate.id) === team.externalRosterId)!,
          points: team.officialTeamPoints.effective === null ? null : Number(team.officialTeamPoints.effective),
          projectedPoints: forecast.teams.find(candidate => candidate.seasonTeamId === id)!.projectedPoints,
          starters: [] };
      }) })) };
  const result = projectStandings({ league: input.league, updatedAt: input.updatedAt, teams: officialTeams, projectionBasis: basis }, matchups, context);
  if (result.kind === 'unavailable') return unavailable(result.reason);
  const allProjected = result.coverage.unresolvedTeamIds.length === 0;
  return { status: 'available' as const, leagueSeasonId: mapping.leagueSeasonId, sourceMappingRevisionId: mapping.revisionId,
    week, authority: 'league-one-estimate' as const, reference: forecast.reference,
    basis: { ...basis, authority: 'existing-projector-derived' as const,
      policy: 'display-hundredths-compatibility' as const,
      sources: history.weeks.filter(captured => captured.week < week).map(captured => ({ week: captured.week, ...captured.source })),
      calendarEvidenceRef: calendar.evidenceRef },
    coverage: result.coverage,
    teams: result.teams.map((projected, index) => {
      const identity = teams.find(team => team.team.id === projected.id)!;
      const projectedRank = allProjected ? index + 1 : null;
      return { seasonTeamId: identity.seasonTeamId, externalRosterId: identity.externalRosterId,
        projected, currentRank: identity.leagueOneRank, projectedRank,
        rankMovement: projectedRank !== null && identity.leagueOneRank !== null ? identity.leagueOneRank - projectedRank : null };
    }), limitations: ['provider_finality_unproved', 'projection_baseline_uses_existing_hundredths_not_exact_official_records',
      ...(!allProjected ? ['cross_league_projected_rank_unavailable'] : [])] };
}
