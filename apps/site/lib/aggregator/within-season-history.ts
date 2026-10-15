import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../league-administration/source-mapping';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { EXACT_MATCHUP_VALUES_VERSION, type ExactMatchupTeamValues, type ExactMatchupValuesRead } from './exact-matchup-values';
import { EXACT_PERIOD_CONTEXT_VERSION, type ExactPeriodContextRead } from './exact-period-context';
import { composeOfficialResults, OFFICIAL_RESULTS_VERSION, type OfficialResultsRead } from './official-results';

export const WITHIN_SEASON_HISTORY_VERSION = 'sleeper-within-season-history-v1' as const;
export type HistoryTask = Readonly<{
  provider: 'sleeper'; externalLeagueId: string; season: number; nativeWeek: number;
  ordinal: number; collection: string; failureCount: number; reason?: unknown;
}>;
export type HistoryPeriodDetail = HistoryTask & Readonly<{
  exactMatchupValues?: ExactMatchupValuesRead; periodContext?: ExactPeriodContextRead;
  resource: Readonly<{ status: string; reason?: string }>;
  acquisition: Readonly<{ sourceMapping: unknown; matchupsReceiptId: unknown; settingsReceiptId: unknown;
    configurationContentId: unknown }> | null;
}>;
export type HistoryGap = Readonly<{ reason: string; nativeWeek?: number; sourcePath?: string; nativePeriod?: number }>;
export type WithinSeasonHistoryInput = Readonly<{
  mapping: AdministrationSourceMapping; requestedWeeks: readonly number[];
  tasks: readonly HistoryTask[]; periods: readonly HistoryPeriodDetail[];
  bracketsRequested: boolean; officialResults: OfficialResultsRead;
  sourceGaps?: readonly HistoryGap[];
}>;
export type NativeHistoryGroup = Readonly<{
  identity: Readonly<{ kind: 'weekly-matchup'; provider: 'sleeper'; leagueSeasonId: string;
    externalLeagueId: string; season: 2026; nativeWeek: number; nativeMatchupId: string }>;
  /** An unambiguous tuple; native matchup IDs alone are never cross-period identities. */
  key: string; teams: readonly ExactMatchupTeamValues[];
}>;
export type HistoryPeriod = Readonly<{
  nativeWeek: number; ordinal: number; collection: string;
  values: ExactMatchupValuesRead; context: ExactPeriodContextRead;
  currentHead: Readonly<{ status: string; reason?: string }>;
  groups: readonly NativeHistoryGroup[]; unassigned: readonly ExactMatchupTeamValues[];
  officialOutcome: Readonly<{ status: 'unknown'; reason: 'weekly_result_evidence_unproved' }>;
  finality: Readonly<{ status: 'unknown'; reason: 'provider_finality_evidence_unproved' }>;
  series: Readonly<{ status: 'unknown'; reason: 'series_membership_unproved' }>;
  bye: Readonly<{ status: 'unknown'; reason: 'bye_evidence_unproved' }>;
}>;
export type WithinSeasonHistoryRead = Readonly<{
  status: 'available'; version: typeof WITHIN_SEASON_HISTORY_VERSION;
  identity: Readonly<{ provider: 'sleeper'; externalLeagueId: string; season: 2026; leagueSeasonId: string }>;
  mapping: AdministrationSourceMapping;
  coverage: Readonly<{
    requestedWeeks: readonly number[]; tasks: readonly HistoryTask[];
    selectedWeeks: readonly number[]; verifiedWeeks: readonly number[];
    unrequestedWeeks: readonly number[]; readCoverage: 'complete' | 'page';
    seasonCoverage: 'complete' | 'partial';
    gaps: readonly HistoryGap[];
    meaning: string;
  }>;
  periods: readonly HistoryPeriod[];
  brackets: Extract<OfficialResultsRead, { status: 'available' }>['brackets'];
  officialResults: OfficialResultsRead;
}> | Readonly<{ status: 'unavailable'; reason: string }>;

const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason });
const week = (value: number) => Number.isSafeInteger(value) && value >= 1 && value <= 18;
const identityMatches = (task: HistoryTask, mapping: AdministrationSourceMapping) =>
  task.provider === mapping.scope.provider && task.externalLeagueId === mapping.scope.externalLeagueId
  && task.season === mapping.scope.season;

/** Pure composition of already typed, receipt-bound facts. Never normalizes, scores,
 * fills missing opponents, joins bracket IDs, or turns observed settings into authority. */
export function composeWithinSeasonHistory(input: WithinSeasonHistoryInput): WithinSeasonHistoryRead {
  try {
    const { mapping, requestedWeeks, tasks, periods } = input;
    if (!isAdministrationSourceMapping(mapping) || mapping.scope.season !== 2026
      || requestedWeeks.length > 18 || new Set(requestedWeeks).size !== requestedWeeks.length
      || requestedWeeks.some(value => !week(value)) || tasks.length > 18 || periods.length > 18
      || new Set(tasks.map(task => task.nativeWeek)).size !== tasks.length
      || new Set(tasks.map(task => task.ordinal)).size !== tasks.length
      || new Set(periods.map(period => period.nativeWeek)).size !== periods.length
      || tasks.some(task => !identityMatches(task, mapping) || !requestedWeeks.includes(task.nativeWeek)
        || !week(task.nativeWeek) || !Number.isSafeInteger(task.ordinal) || task.ordinal < 1 || task.ordinal > 360
        || !['pending', 'complete', 'unavailable'].includes(task.collection)
        || !Number.isSafeInteger(task.failureCount) || task.failureCount < 0 || task.failureCount > 5)) {
      return unavailable('season-history-scope-mismatch');
    }
    const gaps: HistoryGap[] = [...(input.sourceGaps ?? [])];
    const selected: HistoryPeriod[] = [];
    for (const detail of periods) {
      const nativeWeek = detail.nativeWeek;
      const task = tasks.find(item => item.nativeWeek === nativeWeek && item.ordinal === detail.ordinal);
      if (!task || !identityMatches(detail, mapping) || detail.collection !== task.collection) {
        gaps.push({ reason: 'season-history-period-scope-mismatch', nativeWeek });
        continue;
      }
      const capture = detail.acquisition;
      let values: ExactMatchupValuesRead = detail.exactMatchupValues ?? unavailable('exact-matchup-values-not-recorded');
      let context: ExactPeriodContextRead = detail.periodContext ?? unavailable('period-context-not-recorded');
      if (task.collection !== 'complete') {
        values = unavailable('period-capture-not-complete'); context = unavailable('period-capture-not-complete');
      } else if (!capture || compatibleRevision(capture.sourceMapping) !== compatibleRevision(mapping)) {
        values = unavailable('season-history-source-mapping-mismatch'); context = unavailable('season-history-source-mapping-mismatch');
      } else {
        if (values.status === 'available' && (values.version !== EXACT_MATCHUP_VALUES_VERSION
          || values.selection !== 'receipt' || values.sourceMappingRevisionId !== mapping.revisionId
          || values.matchupsReceiptId !== capture.matchupsReceiptId || values.value.season !== 2026
          || values.value.nativeWeek !== nativeWeek)) values = unavailable('season-history-values-scope-mismatch');
        if (context.status === 'available' && (context.version !== EXACT_PERIOD_CONTEXT_VERSION
          || context.sourceMappingRevisionId !== mapping.revisionId || context.period.season !== 2026
          || context.period.nativeWeek !== nativeWeek || context.capture.matchupsReceiptId !== capture.matchupsReceiptId
          || context.capture.settingsReceiptId !== capture.settingsReceiptId
          || context.capture.configurationContentId !== capture.configurationContentId
          || context.observedConfiguration.contentId !== capture.configurationContentId
          || context.observedConfiguration.applicability !== 'observation-only')) context = unavailable('season-history-context-scope-mismatch');
      }
      if (values.status !== 'available') gaps.push({ reason: values.reason ?? values.status, nativeWeek });
      if (context.status !== 'available') gaps.push({ reason: context.reason ?? context.status, nativeWeek });
      else {
        // Native references beyond this supported range are evidence of a gap, never extra tasks.
        const settings = context.observedConfiguration.value;
        const references = [
          ...settings.periods.map(field => ({ sourcePath: field.sourcePath,
            value: field.state === 'known' ? Number(field.value.source.nativeId) : null })),
          ...[settings.competition.startPeriod, settings.competition.playoffStartPeriod]
            .map(field => ({ sourcePath: field.sourcePath, value: field.state === 'known' ? field.value : null })),
        ];
        for (const reference of references) if (typeof reference.value === 'number' && reference.value > 18) {
          gaps.push({ reason: 'native-period-outside-supported-range', nativeWeek,
            sourcePath: reference.sourcePath, nativePeriod: reference.value });
        }
      }
      const grouped = new Map<string, ExactMatchupTeamValues[]>(), unassigned: ExactMatchupTeamValues[] = [];
      if (values.status === 'available') for (const team of values.value.teams) {
        if (team.nativeMatchupId.state !== 'supplied') { unassigned.push(team); continue; }
        const id = team.nativeMatchupId.value;
        const members = grouped.get(id) ?? []; members.push(team); grouped.set(id, members);
      }
      const groups = [...grouped].map(([nativeMatchupId, teams]): NativeHistoryGroup => ({
        identity: { kind: 'weekly-matchup', provider: 'sleeper', leagueSeasonId: mapping.leagueSeasonId,
          externalLeagueId: mapping.scope.externalLeagueId, season: 2026, nativeWeek, nativeMatchupId },
        key: JSON.stringify(['sleeper', mapping.leagueSeasonId, mapping.scope.externalLeagueId, 2026, nativeWeek, nativeMatchupId]), teams,
      }));
      selected.push({ nativeWeek, ordinal: task.ordinal, collection: task.collection, values, context,
        currentHead: { status: detail.resource.status, ...(detail.resource.reason ? { reason: detail.resource.reason } : {}) },
        groups, unassigned, officialOutcome: { status: 'unknown', reason: 'weekly_result_evidence_unproved' },
        finality: { status: 'unknown', reason: 'provider_finality_evidence_unproved' },
        series: { status: 'unknown', reason: 'series_membership_unproved' },
        bye: { status: 'unknown', reason: 'bye_evidence_unproved' } });
    }
    for (const nativeWeek of requestedWeeks) {
      const task = tasks.find(item => item.nativeWeek === nativeWeek);
      if (!task) gaps.push({ nativeWeek, reason: 'requested-period-task-missing' });
      else if (task.collection !== 'complete') gaps.push({ nativeWeek, reason: task.collection === 'pending'
        ? 'period-pending' : typeof task.reason === 'string' ? task.reason : 'period-unavailable' });
      if (task && !selected.some(period => period.nativeWeek === nativeWeek)) gaps.push({ nativeWeek, reason: 'period-outside-selected-page' });
    }
    const unrequestedWeeks = Array.from({ length: 18 }, (_, index) => index + 1).filter(value => !requestedWeeks.includes(value));
    unrequestedWeeks.forEach(nativeWeek => gaps.push({ nativeWeek, reason: 'period-not-requested' }));
    let officialResults = input.officialResults;
    if (officialResults.status === 'available' && (officialResults.version !== OFFICIAL_RESULTS_VERSION
      || compatibleRevision(officialResults.mapping) !== compatibleRevision(mapping))) {
      officialResults = unavailable('season-history-results-scope-mismatch');
    }
    if (officialResults.status === 'available') {
      // The existing result composer validates nested identity without granting completeness.
      officialResults = composeOfficialResults(officialResults);
      if (officialResults.status === 'available' && officialResults.periods.some(period => {
        const original = selected.find(item => item.nativeWeek === period.nativeWeek);
        return !original || compatibleRevision(period.values) !== compatibleRevision(original.values)
          || compatibleRevision(period.context ?? null) !== compatibleRevision(original.context);
      })) officialResults = unavailable('season-history-results-period-mismatch');
    }
    const brackets = officialResults.status === 'available' ? officialResults.brackets : [];
    if (officialResults.status === 'available') {
      if (officialResults.standings.status !== 'available') gaps.push({ reason: 'official-standings-unavailable' });
      for (const report of officialResults.reports ?? []) if (report.resource.status !== 'available') {
        gaps.push({ nativeWeek: report.nativeWeek, reason: 'weekly-report-unavailable' });
      }
    }
    if (officialResults.status !== 'available') gaps.push({ reason: officialResults.reason });
    for (const family of ['winners_bracket', 'losers_bracket'] as const) {
      const bracket = brackets.find(item => item.family === family);
      if (!input.bracketsRequested) gaps.push({ reason: family + '-not-requested' });
      else if (!bracket || bracket.resource.status !== 'available') gaps.push({ reason: family + '-unavailable' });
    }
    const verifiedWeeks = selected.filter(period => period.values.status === 'available' && period.context.status === 'available')
      .map(period => period.nativeWeek);
    return structuredClone({ status: 'available', version: WITHIN_SEASON_HISTORY_VERSION,
      identity: { provider: 'sleeper', externalLeagueId: mapping.scope.externalLeagueId, season: 2026, leagueSeasonId: mapping.leagueSeasonId },
      mapping, coverage: { requestedWeeks, tasks: tasks.map(task => ({ provider: task.provider,
        externalLeagueId: task.externalLeagueId, season: task.season, nativeWeek: task.nativeWeek,
        ordinal: task.ordinal, collection: task.collection, failureCount: task.failureCount,
        ...(task.reason === undefined ? {} : { reason: task.reason }) })), selectedWeeks: selected.map(period => period.nativeWeek), verifiedWeeks,
        unrequestedWeeks, readCoverage: selected.length === tasks.length ? 'complete' : 'page',
        seasonCoverage: !gaps.length && verifiedWeeks.length === 18 ? 'complete' : 'partial', gaps,
        meaning: 'Complete verifies supported stored resources for this request only; it asserts neither season finality nor historical settings applicability. Unselected tasks are metadata, not verified receipts.' },
      periods: selected, brackets, officialResults });
  } catch { return unavailable('season-history-invalid-stored-evidence'); }
}
