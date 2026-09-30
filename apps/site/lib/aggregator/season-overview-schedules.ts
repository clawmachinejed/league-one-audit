import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../league-administration/source-mapping';
import { validateSleeperCalendarEvidence, type SleeperCalendarEvidence } from '../league-administration/period-mapping';
import { buildMyTeamScheduleWeeks, selectTeamSchedule, type ScheduleWeekCount } from '../my-team-schedule';
import { resolveSiteWeek } from '../site-week';
import { stableJson } from '../projections/shared/stable-json';
import type { SleeperMatchup } from '../transform';
import type { League, Team } from '../types';
import type { MatchupPeriodContext } from '../matchup-period';
import { exactMatchupsScope, type AcceptedExactMatchupsRead, type ExactMatchupValue } from './exact-matchups';
import type { RetainedMatchupProjection } from './retained-matchups';

/** Current display/record is deliberately separate from each historical matchup capture. */
export type SeasonOverviewTeamIdentity = Readonly<{
  seasonTeamId: string; externalRosterId: string; team: Team;
  currentRecord: Readonly<{ wins: number; losses: number; ties: number }> | null;
  leagueOneRank: number | null;
}>;
export type SeasonOverviewCalendarEvidence = Readonly<{
  leagueSeasonId: string; sourceMappingRevisionId: string; evidenceRef: string; evidence: SleeperCalendarEvidence;
}>;
export type SeasonOverviewMatchupCapture = AcceptedExactMatchupsRead | RetainedMatchupProjection;
export type SeasonOverviewWeek = Readonly<{
  week: number; value: ExactMatchupValue; rows: readonly SleeperMatchup[];
  source: Readonly<{ kind: 'accepted' | 'retained'; observationId: string; contentId: string;
    sourceObservedAt: string | null; checkedAt: string; limitations: readonly string[] }>;
}>;
export type SeasonOverviewHistory = Readonly<{
  weeks: readonly SeasonOverviewWeek[]; failures: readonly Readonly<{ week: number | null; reason: string }>[];
}>;

function rosterNumber(id: string): number | null {
  const number = Number(id);
  return Number.isSafeInteger(number) && number > 0 && String(number) === id ? number : null;
}
export function validSeasonOverviewTeams(teams: readonly SeasonOverviewTeamIdentity[]): boolean {
  return teams.length > 0 && new Set(teams.map(team => team.seasonTeamId)).size === teams.length
    && new Set(teams.map(team => team.externalRosterId)).size === teams.length
    && teams.every(team => !!team.seasonTeamId && rosterNumber(team.externalRosterId) === team.team.id);
}
function currentOverlay(identity: SeasonOverviewTeamIdentity) {
  return { seasonTeamId: identity.seasonTeamId, externalRosterId: identity.externalRosterId,
    display: { name: identity.team.name, managerName: identity.team.managerName, avatar: identity.team.avatar },
    currentRecord: identity.currentRecord, leagueOneRank: identity.leagueOneRank };
}

/** Reuses B1 values; a caller must select one retained capture per week before composition. */
export function seasonOverviewHistory(mapping: AdministrationSourceMapping,
  teams: readonly SeasonOverviewTeamIdentity[], captures: readonly SeasonOverviewMatchupCapture[]): SeasonOverviewHistory {
  const weeks: SeasonOverviewWeek[] = [], failures: Array<{ week: number | null; reason: string }> = [];
  if (!isAdministrationSourceMapping(mapping) || !validSeasonOverviewTeams(teams)) {
    return { weeks, failures: [{ week: null, reason: 'season_team_scope_invalid' }] };
  }
  const seen = new Set<number>(), duplicates = new Set<number>();
  for (const capture of captures) {
    if (capture.status !== 'available') {
      failures.push({ week: null, reason: capture.reason ?? 'matchup_capture_unavailable' }); continue;
    }
    const period = capture.value.period, week = period.nativeWeek;
    if (seen.has(week)) duplicates.add(week);
    seen.add(week);
    const retained = 'kind' in capture;
    const scoped = retained
      ? capture.scope.leagueSeasonId === mapping.leagueSeasonId && capture.scope.leagueKey === mapping.scope.leagueKey
        && capture.scope.provider === mapping.scope.provider && capture.scope.externalLeagueId === mapping.scope.externalLeagueId
        && capture.scope.season === mapping.scope.season && capture.scope.nativeWeek === week
        && capture.lineage.sourceConnectionId === mapping.connectionId
        && capture.lineage.sourceMappingRevisionId === mapping.revisionId && capture.lineage.mappingGeneration === mapping.generation
      : Number.isInteger(week) && week >= 1 && week <= 18
        && stableJson(capture.accepted.scope) === stableJson(exactMatchupsScope(mapping, week))
        && capture.accepted.sourceMappingRevisionId === mapping.revisionId;
    const valueTeams = capture.value.teams;
    if (!scoped || period.season !== mapping.scope.season || period.source.provider !== mapping.scope.provider
      || period.source.nativeNamespace !== mapping.scope.externalLeagueId || period.source.nativeId !== String(week)
      || period.source.resourceKind !== 'competition-period' || !Number.isInteger(week) || week < 1 || week > 18) {
      failures.push({ week, reason: 'matchup_scope_mismatch' }); continue;
    }
    if (valueTeams.length !== teams.length || new Set(valueTeams.map(team => team.seasonTeamId)).size !== teams.length
      || new Set(valueTeams.map(team => team.externalRosterId)).size !== teams.length
      || valueTeams.some(team => !teams.some(current => current.seasonTeamId === team.seasonTeamId
        && current.externalRosterId === team.externalRosterId))) {
      failures.push({ week, reason: 'matchup_team_scope_mismatch' }); continue;
    }
    const rows: SleeperMatchup[] = valueTeams.map(team => ({ roster_id: rosterNumber(team.externalRosterId)!,
      matchup_id: team.nativeMatchupId === null ? null : rosterNumber(team.nativeMatchupId),
      points: team.officialTeamPoints.raw === null ? null : Number(team.officialTeamPoints.raw),
      custom_points: team.officialTeamPoints.custom === null ? null : Number(team.officialTeamPoints.custom) }));
    if (rows.some((row, index) => (row.points !== null && !Number.isFinite(row.points))
      || (row.custom_points !== null && !Number.isFinite(row.custom_points))
      || (valueTeams[index].nativeMatchupId !== null && row.matchup_id === null)
      || (row.custom_points ?? row.points) !== (valueTeams[index].officialTeamPoints.effective === null
        ? null : Number(valueTeams[index].officialTeamPoints.effective)))) {
      failures.push({ week, reason: 'matchup_values_invalid' }); continue;
    }
    weeks.push({ week, value: capture.value, rows,
      source: retained ? { kind: 'retained', observationId: capture.lineage.observationId, contentId: capture.lineage.contentId,
        sourceObservedAt: capture.source.sourceObservedAt, checkedAt: capture.source.checkedAt, limitations: capture.limitations }
        : { kind: 'accepted', observationId: capture.receipt.legacyObservationId, contentId: capture.accepted.contentId,
          sourceObservedAt: capture.receipt.provenance.sourceObservedAt, checkedAt: capture.receipt.provenance.checkedAt,
          limitations: ['provider_finality_unproved', 'historical_slot_applicability_separate', 'dated_metadata_current_display_only'] } });
  }
  for (const week of duplicates) failures.push({ week, reason: 'multiple_captures_require_selection' });
  return { weeks: weeks.filter(item => !duplicates.has(item.week)).sort((a, b) => a.week - b.week), failures };
}

/** NFL completion supplies the existing local display decision, never provider fantasy finality. */
export function seasonOverviewCalendar(mapping: AdministrationSourceMapping, calendar: SeasonOverviewCalendarEvidence | null) {
  if (!calendar || calendar.leagueSeasonId !== mapping.leagueSeasonId
    || calendar.sourceMappingRevisionId !== mapping.revisionId || !calendar.evidenceRef) return null;
  const evidence = validateSleeperCalendarEvidence(calendar.evidence, String(mapping.scope.season));
  if (!evidence) return null;
  const resolution = resolveSiteWeek({ season: String(mapping.scope.season), seasonSchedule: evidence.schedule, evaluatedAt: evidence.evaluatedAt });
  const completedWeeks = Array.from({ length: 18 }, (_, i) => i + 1).filter(week => week <= resolution.week
    && evidence.schedule.filter(game => game.week === week).every(game => game.status === 'complete'));
  return { evidenceRef: calendar.evidenceRef, evidence, resolution, completedWeeks };
}

export type SeasonOverviewScheduleInput = Readonly<{
  mapping: AdministrationSourceMapping; teams: readonly SeasonOverviewTeamIdentity[]; league: League; updatedAt: string;
  captures: readonly SeasonOverviewMatchupCapture[]; seasonTeamId: string; range: 'my-team' | 'manager';
  calendar: SeasonOverviewCalendarEvidence | null; context: MatchupPeriodContext;
}>;

export function buildSeasonOverviewSchedule(input: SeasonOverviewScheduleInput) {
  const { mapping, teams, league } = input;
  const current = teams.find(team => team.seasonTeamId === input.seasonTeamId);
  if (!isAdministrationSourceMapping(mapping) || !validSeasonOverviewTeams(teams) || !current
    || league.season !== String(mapping.scope.season) || input.context.defaultSeason !== mapping.scope.season
    || (input.context.activeSeason !== null && input.context.activeSeason !== mapping.scope.season)) {
    return { status: 'unavailable' as const, reason: 'schedule_season_team_scope_mismatch' };
  }
  const throughWeek: ScheduleWeekCount = input.range === 'manager' ? 14 : 15;
  const history = seasonOverviewHistory(mapping, teams, input.captures), calendar = seasonOverviewCalendar(mapping, input.calendar);
  const data = { league, updatedAt: input.updatedAt, teams: teams.map(team => team.team),
    weeks: buildMyTeamScheduleWeeks(teams.map(team => team.team), Array.from({ length: throughWeek }, (_, index) =>
      history.weeks.find(item => item.week === index + 1)?.rows ?? null),
    { completedWeeks: calendar?.completedWeeks ?? [], activeWeek: input.context.activeWeek,
      preseason: input.context.lifecycle === 'preseason' }, throughWeek) };
  const selected = selectTeamSchedule(data, current.team.id, throughWeek);
  return { status: 'available' as const, leagueSeasonId: mapping.leagueSeasonId, sourceMappingRevisionId: mapping.revisionId,
    seasonTeamId: current.seasonTeamId, range: { fromWeek: 1 as const, throughWeek },
    currentTeam: currentOverlay(current), currentOverlayScope: 'current-season' as const,
    weeks: selected.weeks.map(entry => {
      const captured = history.weeks.find(item => item.week === entry.week);
      const official = captured?.value.teams.find(team => team.seasonTeamId === current.seasonTeamId);
      const opponent = teams.find(team => team.team.id === entry.opponent?.id) ?? null;
      return { week: entry.week, status: entry.status, points: entry.points, opponentPoints: entry.opponentPoints,
        result: entry.result, opponentSeasonTeamId: opponent?.seasonTeamId ?? null,
        currentOpponent: opponent ? currentOverlay(opponent) : null, exactOfficialPoints: official?.officialTeamPoints ?? null,
        source: captured?.source ?? null,
        finality: { provider: 'unknown' as const, local: entry.status, authority: 'nfl-calendar-interpretation' as const,
          evidenceRef: calendar?.evidenceRef ?? null },
        coverage: !captured ? { status: 'missing' as const, reason: history.failures.find(failure => failure.week === entry.week)?.reason ?? 'week_capture_missing' }
          : !opponent ? { status: 'limited' as const, reason: 'paired_opponent_unavailable' }
            : entry.points === null || entry.opponentPoints === null ? { status: 'partial' as const, reason: 'official_score_missing' }
              : { status: 'complete' as const, reason: null } };
    }), failures: history.failures,
    limitations: ['provider_finality_unproved', ...(calendar ? [] : ['calendar_completion_unproved'])] };
}
