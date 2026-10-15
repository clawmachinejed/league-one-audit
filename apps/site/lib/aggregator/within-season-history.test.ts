import { describe, expect, it } from 'vitest';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { AdministrationFamily, AdministrationSourceMapping, JsonValue } from '../league-administration/contracts';
import { EXACT_MATCHUP_VALUES_VERSION, projectExactMatchupValues, type ExactMatchupValuesRead } from './exact-matchup-values';
import { EXACT_PERIOD_CONTEXT_VERSION, deriveExactPeriodPhase, type ExactPeriodContextRead } from './exact-period-context';
import { BRACKET_VALUE_VERSION, projectPlayoffBracket, type BracketFamily } from './playoff-brackets';
import { composeOfficialResults } from './official-results';
import { composeWithinSeasonHistory, type HistoryPeriodDetail, type WithinSeasonHistoryInput } from './within-season-history';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const provenance = { origin: 'network' as const, requestStartedAt: '2026-10-14T10:00:00Z',
  requestCompletedAt: '2026-10-14T10:00:01Z', sourceObservedAt: '2026-10-14T10:00:01Z', checkedAt: '2026-10-14T10:00:02Z' };
function fixture(league = 1, weeks = Array.from({ length: 18 }, (_, index) => index + 1)) {
  const mapping: AdministrationSourceMapping = { connectionId: id(league * 100), leagueSeasonId: id(league * 100 + 1),
    revisionId: id(league * 100 + 2), generation: 1,
    scope: { provider: 'sleeper', leagueKey: 'unrelated-' + league, externalLeagueId: String(9000 + league), season: 2026 } };
  const normalize = (family: AdministrationFamily, payload: JsonValue, nativeWeek: number | null = null) =>
    normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: mapping.scope, family, week: nativeWeek, completeness: 'complete', payload, provenance });
  const settings = normalize('league', { league_id: mapping.scope.externalLeagueId, season: '2026', sport: 'nfl',
    settings: { type: league - 1, start_week: 1, playoff_week_start: 15, playoff_round_type: 2 } });
  if (!settings.leagueSettings?.value) throw new Error('Invalid settings fixture.');
  const configurationContentId = id(league * 100 + 3), settingsReceiptId = id(league * 100 + 4);
  const periods: HistoryPeriodDetail[] = weeks.map(nativeWeek => {
    const matchupsReceiptId = id(league * 1000 + nativeWeek);
    const values: ExactMatchupValuesRead = { status: 'available', version: EXACT_MATCHUP_VALUES_VERSION, selection: 'receipt',
      contentId: id(league * 10000 + nativeWeek), matchupsReceiptId, acceptanceId: id(5), acceptedGeneration: 1,
      sourceMappingRevisionId: mapping.revisionId, provenance,
      value: projectExactMatchupValues(normalize('matchups', [
        { roster_id: 1, matchup_id: 7, points: 120.375, custom_points: 0 },
        { roster_id: 2, matchup_id: 7, points: -0.125 }, { roster_id: 3, matchup_id: null, points: null },
        { roster_id: 4, points: 0 },
      ], nativeWeek), [1, 2, 3, 4].map(number => ({ externalRosterId: String(number), seasonTeamId: id(league * 100 + number + 10) }))) };
    const calendar = { status: 'unmapped' as const, reason: 'calendar_evidence_missing' as const };
    const competition = { status: 'unknown' as const, reason: 'no_binding' as const };
    const context: ExactPeriodContextRead = { status: 'available', version: EXACT_PERIOD_CONTEXT_VERSION,
      period: { season: 2026, nativeWeek }, sourceMappingRevisionId: mapping.revisionId,
      capture: { matchupsReceiptId, settingsReceiptId, configurationContentId },
      observedConfiguration: { contentId: configurationContentId, configurationVersionId: null,
        rawContentHash: settings.contentHash, provenance, value: settings.leagueSettings!.value!, applicability: 'observation-only' },
      calendar, configuration: { scoring: competition, roster: competition, competition },
      nativeOfficialPhase: { status: 'unknown', reason: 'native-period-phase-not-exposed' },
      phase: deriveExactPeriodPhase(calendar, competition) };
    return { provider: 'sleeper', externalLeagueId: mapping.scope.externalLeagueId, season: 2026,
      nativeWeek, ordinal: nativeWeek, collection: 'complete', failureCount: 0, reason: null,
      resource: { status: 'available' }, exactMatchupValues: values, periodContext: context,
      acquisition: { sourceMapping: mapping, matchupsReceiptId, settingsReceiptId, configurationContentId } };
  });
  const brackets = (['winners_bracket', 'losers_bracket'] as const).map((family: BracketFamily) => {
    const bracket = projectPlayoffBracket(normalize(family, [{ r: 1, m: 7, t1: 1, t2: 2, w: 1, l: 2 }]));
    if (bracket.status !== 'accepted') throw new Error('Invalid bracket fixture.');
    return { family, resource: { status: 'available' as const, version: BRACKET_VALUE_VERSION, selection: 'receipt' as const,
      contentId: id(6), bracketReceiptId: id(family === 'winners_bracket' ? 7 : 8), acceptanceId: id(9),
      acceptedGeneration: 1, sourceMappingRevisionId: mapping.revisionId, provenance, value: bracket.value } };
  });
  const officialResults = composeOfficialResults({ mapping, standings: { status: 'unavailable', reason: 'not-captured' },
    periods: periods.map(period => ({ nativeWeek: period.nativeWeek, values: period.exactMatchupValues!, context: period.periodContext })), brackets });
  const input: WithinSeasonHistoryInput = { mapping, requestedWeeks: weeks, tasks: periods, periods, bracketsRequested: true, officialResults };
  return { input, periods, mapping };
}
function available(input: WithinSeasonHistoryInput) {
  const result = composeWithinSeasonHistory(input);
  expect(result.status).toBe('available');
  if (result.status !== 'available') throw new Error(result.reason);
  return result;
}

describe('generic stored within-season composition', () => {
  it('keeps all 18 independent periods and both bracket namespaces for three unrelated league formats', () => {
    const results = [1, 2, 3].map(league => available(fixture(league).input));
    expect(new Set(results.flatMap(result => result.periods.flatMap(period => period.groups.map(group => group.key)))).size).toBe(54);
    for (const result of results) {
      expect(result.periods.map(period => period.nativeWeek)).toEqual(Array.from({ length: 18 }, (_, index) => index + 1));
      expect(result.coverage).toMatchObject({ seasonCoverage: 'partial', readCoverage: 'complete', gaps: [{ reason: 'official-standings-unavailable' }] });
      const first = result.periods[0];
      expect(first.groups[0].teams[0]).toMatchObject({ rawPoints: { value: '120.375' },
        customPoints: { value: '0' }, effectivePoints: { value: '0', source: 'custom-override' } });
      expect(first.groups[0].teams[1].effectivePoints.value).toBe('-0.125');
      expect(first.unassigned.map(team => team.nativeMatchupId.state)).toEqual(['null', 'missing']);
      expect(first).toMatchObject({ officialOutcome: { status: 'unknown' }, finality: { status: 'unknown' },
        series: { status: 'unknown' }, bye: { status: 'unknown' } });
      expect(result.brackets.map(bracket => bracket.family)).toEqual(['winners_bracket', 'losers_bracket']);
      expect(result.brackets.every(bracket => bracket.reportedResults[0].finality.status === 'provider-reported-played')).toBe(true);
      expect(first.context).toMatchObject({ observedConfiguration: { applicability: 'observation-only' },
        configuration: { competition: { status: 'unknown' } } });
    }
  });

  it('accounts for bounded page union exactly once without converting metadata into verified season coverage', () => {
    const f = fixture();
    const pages = [0, 5, 10, 15].map(offset => available({ ...f.input, periods: f.periods.slice(offset, offset + 5) }));
    expect(pages.flatMap(page => page.coverage.selectedWeeks)).toEqual(f.input.requestedWeeks);
    for (const page of pages) {
      expect(page.coverage.tasks).toHaveLength(18);
      expect(page.coverage.seasonCoverage).toBe('partial');
      expect(page.coverage.readCoverage).toBe('page');
      expect(page.coverage.verifiedWeeks).toHaveLength(page.periods.length);
    }
    expect(pages.at(-1)!.periods.map(period => period.nativeWeek)).toEqual([16, 17, 18]);
  });

  it('distinguishes pending, unavailable, unrequested and out-of-range evidence and keeps zero separate from missing', () => {
    const f = fixture(1, [1, 2, 3]);
    const periods = f.periods.map((period, index) => index === 0 ? period : { ...period, collection: index === 1 ? 'pending' : 'unavailable',
      reason: index === 1 ? null : 'invalid-source', acquisition: null });
    const result = available({ ...f.input, tasks: periods, periods, bracketsRequested: false,
      sourceGaps: [{ reason: 'native-period-outside-supported-range', sourcePath: 'settings.leg', nativePeriod: 19 }] });
    expect(result.coverage.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'period-pending', nativeWeek: 2 }),
      expect.objectContaining({ reason: 'invalid-source', nativeWeek: 3 }),
      expect.objectContaining({ reason: 'period-not-requested', nativeWeek: 18 }),
      expect.objectContaining({ reason: 'native-period-outside-supported-range', nativePeriod: 19 }),
    ]));
    expect(result.periods[1].groups).toEqual([]);
    expect(result.periods[0].unassigned[1].rawPoints).toEqual({ state: 'supplied', value: '0' });
  });

  it('keeps original receipt provenance despite a newer accepted head and preserves empty captures', () => {
    const f = fixture(1, [1]);
    const original = f.periods[0];
    const result = available({ ...f.input, periods: [{ ...original,
      resource: { status: 'unavailable', reason: 'intake-capture-not-current-head' } }] });
    expect(result.periods[0].values).toEqual(original.exactMatchupValues);
    expect(result.coverage.verifiedWeeks).toEqual([1]);
    expect(result.periods[0].currentHead.status).toBe('unavailable');
    expect(result.coverage.tasks[0]).not.toHaveProperty('resource');
    expect(result.coverage.tasks[0]).not.toHaveProperty('exactMatchupValues');
    const values = original.exactMatchupValues!;
    if (values.status !== 'available') throw new Error('Fixture');
    const empty = available({ ...f.input, periods: [{ ...original, exactMatchupValues: { ...values, value: { ...values.value, teams: [] } } }] });
    expect(empty.periods[0]).toMatchObject({ groups: [], unassigned: [], values: { status: 'available' }, bye: { status: 'unknown' } });
  });

  it.each(['receipt', 'week', 'mapping', 'context', 'capture'] as const)('fails closed for a wrong %s without hiding a sibling period', corruption => {
    const f = fixture(1, [1, 2]); const original = f.periods[0];
    if (original.exactMatchupValues?.status !== 'available' || original.periodContext?.status !== 'available') throw new Error('Fixture');
    const values = original.exactMatchupValues, context = original.periodContext;
    const altered = { ...original,
      ...(corruption === 'receipt' ? { exactMatchupValues: { ...values, matchupsReceiptId: id(999) } } : {}),
      ...(corruption === 'week' ? { exactMatchupValues: { ...values, value: { ...values.value, nativeWeek: 2 } } } : {}),
      ...(corruption === 'mapping' ? { exactMatchupValues: { ...values, sourceMappingRevisionId: id(999) } } : {}),
      ...(corruption === 'context' ? { periodContext: { ...context, period: { season: 2026 as const, nativeWeek: 2 } } } : {}),
      ...(corruption === 'capture' ? { acquisition: { ...original.acquisition!, sourceMapping: { ...f.mapping, revisionId: id(999) } } } : {}) };
    const result = available({ ...f.input, periods: [altered, f.periods[1]] });
    expect(result.coverage.verifiedWeeks).toEqual([2]);
    expect(result.periods[1].values).toEqual(f.periods[1].exactMatchupValues);
    expect(result.coverage.gaps.some(gap => gap.nativeWeek === 1 && gap.reason.includes('mismatch'))).toBe(true);
  });

  it('preserves latest independent applicability decisions while leaving original capture untouched', () => {
    const f = fixture(1, [1]); const context = f.periods[0].periodContext;
    if (context?.status !== 'available') throw new Error('Fixture');
    const corrected: ExactPeriodContextRead = { ...context, configuration: { ...context.configuration,
      scoring: { status: 'unknown', reason: 'inconsistent_binding' }, roster: { status: 'unknown', reason: 'invalid_applicability_evidence' } } };
    const result = available({ ...f.input, periods: [{ ...f.periods[0], periodContext: corrected }] });
    expect(result.periods[0].context).toEqual(corrected);
    expect(result.periods[0].context).toMatchObject({ observedConfiguration: context.observedConfiguration,
      configuration: { scoring: { reason: 'inconsistent_binding' }, roster: { reason: 'invalid_applicability_evidence' } } });
  });

  it('exposes unavailable nested results even when the selected-result composition is structurally available', () => {
    const f = fixture();
    if (f.input.officialResults.status !== 'available') throw new Error('Fixture');
    const result = available({ ...f.input, officialResults: { ...f.input.officialResults,
      reports: [{ nativeWeek: 18, resource: { status: 'unavailable', reason: 'capture-failed' } }] } });
    expect(result.coverage.seasonCoverage).toBe('partial');
    expect(result.coverage.gaps).toEqual(expect.arrayContaining([
      { reason: 'official-standings-unavailable' }, { nativeWeek: 18, reason: 'weekly-report-unavailable' },
    ]));
    expect(result.periods).toHaveLength(18);
    expect(result.brackets).toHaveLength(2);
  });
  it('rejects prior seasons and duplicate inventory without modifying inputs', () => {
    const f = fixture(); const before = structuredClone(f.input);
    expect(composeWithinSeasonHistory({ ...f.input, mapping: { ...f.mapping, scope: { ...f.mapping.scope, season: 2025 } } }).status).toBe('unavailable');
    expect(composeWithinSeasonHistory({ ...f.input, tasks: [f.periods[0], f.periods[0]] }).status).toBe('unavailable');
    expect(available(f.input)).not.toBe(f.input);
    expect(f.input).toEqual(before);
  });
});
