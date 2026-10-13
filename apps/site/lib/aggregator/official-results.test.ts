import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import weeklyReportSource from '../../test-support/fixtures/cp13-live-source-2026/weekly-reports.json';
import { WEEKLY_REPORT_VERSION, projectWeeklyReport, type AcceptedWeeklyReportRead } from './weekly-reports';
import priorPeriods from '../../test-support/fixtures/cp13-live-source-2026/prior-periods.json';
import liveSource from '../../test-support/fixtures/cp13-live-source-2026/source.json';
import completed2025Source from '../../test-support/fixtures/cp13-live-source-2025/source.json';
import type { AdministrationFamily, JsonValue } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import { EXACT_MATCHUP_VALUES_VERSION, projectExactMatchupValues, type ExactMatchupValuesRead } from './exact-matchup-values';
import { deriveExactPeriodPhase, EXACT_PERIOD_CONTEXT_VERSION, type ExactPeriodContextRead,
  type PeriodConfigurationContext } from './exact-period-context';
import { projectExactMatchups, type ExactPeriodMappingQualification } from './exact-matchups';
import { BRACKET_VALUE_VERSION, bracketScope, projectPlayoffBracket, type AcceptedBracketRead, type BracketFamily } from './playoff-brackets';
import { OFFICIAL_STANDINGS_VERSION, projectOfficialStandings, type OfficialStandingsRead } from './official-standings';
import { composeOfficialResults, interpretBracketPlayedResult, OFFICIAL_RESULTS_VERSION, type OfficialResultsInput } from './official-results';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const mapping: AdministrationSourceMapping = { connectionId: id(1), leagueSeasonId: id(2), revisionId: id(3), generation: 1,
  scope: { provider: 'sleeper', leagueKey: 'unrelated-2026', externalLeagueId: '987654321098765432', season: 2026 } };
const provenance = { origin: 'network' as const, requestStartedAt: '2026-10-11T10:00:00Z', requestCompletedAt: '2026-10-11T10:00:01Z',
  sourceObservedAt: '2026-10-11T10:00:01Z', checkedAt: '2026-10-11T10:00:02Z' };
const identities = [1, 2, 3].map(number => ({ seasonTeamId: id(number + 10), externalRosterId: String(number) }));
function normalize(payload: JsonValue, family: AdministrationFamily, week: number | null = null, sourceProvenance = provenance) {
  return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, family, week, completeness: 'complete', payload, provenance: sourceProvenance });
}
function scores(nativeWeek: number, custom = 0): Extract<ExactMatchupValuesRead, { status: 'available' }> {
  return { status: 'available', version: EXACT_MATCHUP_VALUES_VERSION, selection: 'receipt', contentId: id(21),
    matchupsReceiptId: id(nativeWeek + 30), acceptanceId: id(23), acceptedGeneration: 1, sourceMappingRevisionId: mapping.revisionId,
    provenance, value: projectExactMatchupValues(normalize([
      { roster_id: 1, matchup_id: 7, points: 200, custom_points: custom },
      { roster_id: 2, matchup_id: 7, points: 0 }, { roster_id: 3, matchup_id: null, points: 0 },
    ], 'matchups', nativeWeek), identities) };
}
function bracket(family: BracketFamily = 'winners_bracket', payload: JsonValue = [
  { r: 2, m: 7, t1: 1, t2: 2, w: 1, l: 2, p: 1 },
]): Extract<AcceptedBracketRead, { status: 'available' }> {
  // Synthetic reported outcomes test documented meaning, not observed availability in a real league.
  const normalized = projectPlayoffBracket(normalize(payload, family));
  if (normalized.status !== 'accepted') throw new Error('Invalid bracket fixture.');
  return { status: 'available', version: BRACKET_VALUE_VERSION, selection: 'receipt', contentId: id(51),
    bracketReceiptId: id(52), acceptanceId: id(53), acceptedGeneration: 1, sourceMappingRevisionId: mapping.revisionId,
    provenance: { ...provenance, sourceObservedAt: '2026-10-11T09:00:01Z' }, value: normalized.value };
}
function standings(): Extract<OfficialStandingsRead, { status: 'available' }> {
  const projection = projectOfficialStandings(normalize([{ roster_id: 1, settings: { wins: 1, losses: 0, ties: 0, fpts: 200 } }], 'rosters'));
  return { status: 'available', version: OFFICIAL_STANDINGS_VERSION, selection: 'receipt', mapping,
    capture: { rosterReceiptId: id(61), attemptId: id(62), ordinal: 2, contentId: id(63), legacyObservationId: id(64),
      provenance, configurationContentId: null, expectedTeamCount: null }, temporalContext: 'season-to-date',
    historicalApplicability: 'unverified', freshness: 'unknown',
    coverage: { entitySet: 'unknown', recordCompleteness: 'complete', population: 'unproved', reasons: ['population_unproved'] },
    teams: projection.teams.map(team => ({ ...team, seasonTeamId: id(11) })) };
}
function context(nativeWeek: number, settings: Record<string, JsonValue> = {}, lifecycle = 'in_season', generation = 1)
  : Extract<ExactPeriodContextRead, { status: 'available' }> {
  const minute = String(generation - 1).padStart(2, '0');
  const sourceProvenance = { ...provenance, requestStartedAt: `2026-10-11T10:${minute}:00Z`,
    requestCompletedAt: `2026-10-11T10:${minute}:01Z`, sourceObservedAt: `2026-10-11T10:${minute}:01Z`,
    checkedAt: `2026-10-11T10:${minute}:02Z` };
  const source = normalize({ league_id: mapping.scope.externalLeagueId, season: '2026', sport: 'nfl',
    season_type: 'regular', status: lifecycle, settings: { type: 1, start_week: 1, playoff_week_start: 15,
      playoff_round_type: 2, leg: 18, last_scored_leg: 17, ...settings } }, 'league', null, sourceProvenance);
  if (!source.leagueSettings?.value || source.value?.family !== 'league') throw new Error('Invalid result settings fixture.');
  const value = source.leagueSettings.value, configurationContentId = id(200 + generation);
  // Synthetic owner/calendar evidence exercises existing interpretation. It is not provider availability proof.
  const calendar: ExactPeriodMappingQualification = { status: 'mapped', purpose: 'native-period-identity',
    evidenceRef: 'CP13 synthetic calendar', policyVersion: 'sleeper-native-week-to-nfl-regular-v1', scheduleRevision: 'a'.repeat(64),
    evaluatedAt: sourceProvenance.checkedAt, retrievalStartedAt: sourceProvenance.requestStartedAt, retrievalCompletedAt: sourceProvenance.requestCompletedAt,
    sourceObservedAt: null, season: 2026, seasonType: 'regular', week: nativeWeek };
  const competition: PeriodConfigurationContext['competition'] = { status: 'known', basis: 'latest-evidenced-decision',
    activationRef: id(300 + generation), range: { seasonType: 'regular', fromWeek: 1, throughWeek: 18 },
    binding: { leagueSeasonId: mapping.leagueSeasonId, component: 'competition',
      period: { season: 2026, seasonType: 'regular', week: nativeWeek },
      componentHash: source.value.components.find(component => component.name === 'competition')!.hash,
      configurationVersionId: id(400 + generation), generation, recordedAt: sourceProvenance.checkedAt,
      evidence: { kind: 'owner_confirmed', reference: 'CP13 synthetic applicability decision' } },
    source: { configurationContentId, rawContentHash: source.contentHash },
    fields: { competition: value.competition, rosterRules: value.rosterRules, waivers: value.waivers } };
  return { status: 'available', version: EXACT_PERIOD_CONTEXT_VERSION, period: { season: 2026, nativeWeek },
    sourceMappingRevisionId: mapping.revisionId,
    capture: { matchupsReceiptId: scores(nativeWeek).matchupsReceiptId, settingsReceiptId: id(100 + generation), configurationContentId },
    observedConfiguration: { contentId: configurationContentId, configurationVersionId: id(400 + generation),
      rawContentHash: source.contentHash, provenance: sourceProvenance, value, applicability: 'observation-only' }, calendar,
    configuration: { scoring: { status: 'unknown', reason: 'no_binding' }, roster: { status: 'unknown', reason: 'no_binding' }, competition },
    nativeOfficialPhase: { status: 'unknown', reason: 'native-period-phase-not-exposed' }, phase: deriveExactPeriodPhase(calendar, competition) };
}
function input(): OfficialResultsInput {
  return { mapping, standings: standings(), periods: [{ nativeWeek: 15, values: scores(15) }, { nativeWeek: 16, values: scores(16, -4.5) }],
    brackets: [{ family: 'winners_bracket', resource: bracket() }] };
}
function available(source = input()) {
  const result = composeOfficialResults(source);
  if (result.status !== 'available') throw new Error('Expected composed facts.');
  return result;
}

describe('stored official result composition', () => {
  it('preserves custom zero, tied totals and unpaired rows without inferring a weekly result or series', () => {
    const source = input(), before = JSON.stringify(source), result = available(source);
    expect(result.version).toBe(OFFICIAL_RESULTS_VERSION);
    expect(result.scope).toBe('selected-resources');
    expect(result.periods.map(period => period.identity)).toEqual([
      { kind: 'native-period', season: 2026, nativeWeek: 15 }, { kind: 'native-period', season: 2026, nativeWeek: 16 },
    ]);
    for (const period of result.periods) {
      expect(period.officialOutcome).toEqual({ status: 'unknown', reason: 'weekly_result_evidence_unproved' });
      expect(period.finality.status).toBe('unknown');
      expect(period.series.status).toBe('unknown');
      expect(period.values).toEqual(source.periods.find(item => item.nativeWeek === period.nativeWeek)!.values);
      expect(period).not.toHaveProperty('aggregateScore');
      expect(period).not.toHaveProperty('winner');
      expect(period).not.toHaveProperty('bye');
    }
    expect(result.standings).toEqual(source.standings); // Current record is not overlaid onto either past period.
    expect(result.standings).not.toBe(source.standings);
    expect(JSON.stringify(source)).toBe(before);
  });

  it.each(['winners_bracket', 'losers_bracket'] as const)(
    'interprets synthetic supplied %s outcomes as played within their own match and observation', family => {
      const resource = bracket(family, [{ r: 1, m: 1, t1: 3, t2: null, w: null, l: null },
        { r: 2, m: 7, t1: '1', t2: 2, w: 1, l: '2', p: 1 }]);
      const source = { ...input(), brackets: [{ family, resource }] }, before = JSON.stringify(source), result = available(source);
      expect(result.brackets[0].reportedResults[1]).toEqual({
        identity: { kind: 'bracket-match', season: 2026, family, externalMatchupId: '7' },
        source: { bracketReceiptId: id(52), sourceOrdinal: 1, winnerPath: 'w', loserPath: 'l' },
        winner: { state: 'supplied', raw: 1, value: '1' }, loser: { state: 'supplied', raw: '2', value: '2' },
        finality: { status: 'provider-reported-played', reason: 'bracket_outcomes_match_resolved_entrants' },
      });
      expect(result.brackets[0].reportedResults[0].finality.status).toBe('unknown');
      for (const field of ['nativeWeek', 'rank', 'seed', 'tie', 'bye', 'series', 'aggregateScore']) {
        expect(result.brackets[0].reportedResults[1]).not.toHaveProperty(field);
      }
      expect(result.brackets[0].resource).toEqual(resource);
      expect(result.brackets[0].resource).not.toBe(resource);
      expect(result.periods.every(period => period.finality.status === 'unknown')).toBe(true);
      expect(JSON.stringify(source)).toBe(before);
    });

  it.each([
    ['missing outcomes', { t1: 1, t2: 2 }],
    ['winner only', { t1: 1, t2: 2, w: 1 }],
    ['loser only', { t1: 1, t2: 2, l: 2 }],
    ['null winner', { t1: 1, t2: 2, w: null, l: 2 }],
    ['null loser', { t1: 1, t2: 2, w: 1, l: null }],
    ['null outcomes', { t1: 1, t2: 2, w: null, l: null }],
    ['missing entrant', { t1: 1, w: 1, l: 2 }],
    ['null entrant', { t1: 1, t2: null, w: 1, l: 2 }],
    ['unresolved entrant', { t1: 1, t2: { w: 99 }, w: 1, l: 2 }],
    ['unsupported entrant', { t1: 1, t2: { future: 99 }, w: 1, l: 2 }],
  ] satisfies [string, JsonValue][])('retains unknown bracket finality for synthetic %s', (_name, fields) => {
    const resource = bracket('winners_bracket', [{ r: 2, m: 7, ...(fields as Record<string, JsonValue>) }]);
    const result = available({ ...input(), brackets: [{ family: 'winners_bracket', resource }] });
    expect(result.brackets[0].resource).toEqual(resource);
    expect(result.brackets[0].reportedResults[0]).toMatchObject({ winner: resource.value.matches[0].winner,
      loser: resource.value.matches[0].loser, finality: { status: 'unknown', reason: 'provider_finality_evidence_unproved' } });
    expect(result.brackets[0].reportedResults[0]).not.toHaveProperty('bye');
  });

  it.each(['winner', 'loser'] as const)('does not promote a typed unsupported %s outcome to played', field => {
    const resource = bracket(), match = resource.value.matches[0];
    const unsupported = { ...resource, value: { ...resource.value, matches: [{ ...match,
      [field]: { state: 'unsupported' as const, raw: { future: 1 }, value: null } }] } };
    const result = available({ ...input(), brackets: [{ family: 'winners_bracket', resource: unsupported }] });
    expect(result.brackets[0].reportedResults[0].finality.status).toBe('unknown');
  });

  it.each(['missing', 'single', 'duplicate-slot', 'extra'] as const)(
    'does not promote an incomplete typed entrant structure (%s) to played', mode => {
      const resource = bracket(), match = resource.value.matches[0], [first, second] = match.entrants;
      const entrants = mode === 'missing' ? [] : mode === 'single' ? [first]
        : mode === 'duplicate-slot' ? [first, { ...second, slot: 1 as const }] : [first, second, first];
      const incomplete = { ...resource, value: { ...resource.value, matches: [{ ...match, entrants }] } };
      const result = available({ ...input(), brackets: [{ family: 'winners_bracket', resource: incomplete }] });
      expect(result.brackets[0].reportedResults[0].finality.status).toBe('unknown');
    });

  it.each([
    ['duplicate entrants', { t1: 1, t2: '1', w: 1, l: 2 }, 'duplicate_bracket_entrant'],
    ['same winner and loser', { t1: 1, t2: 2, w: 1, l: '1' }, 'conflicting_bracket_results'],
    ['foreign winner', { t1: 1, t2: 2, w: 3, l: 2 }, 'bracket_result_outside_entrants'],
    ['foreign loser', { t1: 1, t2: 2, w: 1, l: 3 }, 'bracket_result_outside_entrants'],
  ] satisfies [string, JsonValue, string][])(
    'keeps synthetic %s rejected by the existing bracket projector', (_name, fields, code) => {
      const projection = projectPlayoffBracket(normalize([{ r: 2, m: 7, ...(fields as Record<string, JsonValue>) }], 'winners_bracket'));
      expect(projection).toMatchObject({ status: 'rejected', value: null, diagnostics: [{ code }] });
    });

  it('retains a keeper multi-entrant group and an unpaired team without inventing tied or bye outcomes', () => {
    const payload: JsonValue = [{ roster_id: 1, matchup_id: 7, points: 200, custom_points: 0 },
      { roster_id: 2, matchup_id: 7, points: 0 }, { roster_id: 3, matchup_id: 7, points: 0 },
      { roster_id: 4, matchup_id: null, points: 0 }];
    const values = { ...scores(15), value: projectExactMatchupValues(normalize(payload, 'matchups', 15),
      [...identities, { seasonTeamId: id(14), externalRosterId: '4' }]) };
    const periodContext = context(15), result = available({ ...input(), periods: [{ nativeWeek: 15, values, context: periodContext }] });
    expect(result.periods[0].context?.status).toBe('available');
    expect(periodContext.observedConfiguration.value.competition.leagueType).toMatchObject({ state: 'known', value: 1 });
    expect(result.periods[0].values).toEqual(values);
    expect(values.value.teams.map(team => [team.externalRosterId, team.nativeMatchupId, team.effectivePoints])).toEqual([
      ['1', { state: 'supplied', value: '7' }, { value: '0', source: 'custom-override' }],
      ['2', { state: 'supplied', value: '7' }, { value: '0', source: 'raw' }],
      ['3', { state: 'supplied', value: '7' }, { value: '0', source: 'raw' }],
      ['4', { state: 'null' }, { value: '0', source: 'raw' }],
    ]);
    expect(result.periods[0]).toMatchObject({ officialOutcome: { status: 'unknown' }, finality: { status: 'unknown' }, series: { status: 'unknown' } });
    for (const field of ['winner', 'tie', 'bye', 'aggregateScore']) expect(result.periods[0]).not.toHaveProperty(field);
  });

  it('does not finalize weekly contests when a later league observation reports complete and a last-scored leg', () => {
    const observed = context(15), completed = context(15, {}, 'complete', 2);
    const original = available({ ...input(), periods: [{ nativeWeek: 15, values: scores(15), context: observed }] });
    const recapturedValues = { ...scores(15), matchupsReceiptId: id(75), provenance: completed.observedConfiguration.provenance };
    const recapturedContext = { ...completed, capture: { ...completed.capture, matchupsReceiptId: recapturedValues.matchupsReceiptId } };
    const current = available({ ...input(), periods: [{ nativeWeek: 15, values: recapturedValues, context: recapturedContext }] });
    expect(completed.observedConfiguration.value.lifecycle).toMatchObject({ state: 'known', value: 'complete' });
    expect(completed.observedConfiguration.value.periods).toContainEqual(expect.objectContaining({
      sourcePath: 'settings.last_scored_leg', value: expect.objectContaining({ purpose: 'last-scored', source: expect.objectContaining({ nativeId: '17' }) }),
    }));
    expect(current.periods[0].context).toEqual(recapturedContext);
    expect(current.periods[0].values).toEqual(recapturedValues);
    expect(current.periods[0].officialOutcome).toEqual(original.periods[0].officialOutcome);
    expect(current.periods[0].finality).toEqual(original.periods[0].finality);
    expect(current.periods[0].series).toEqual(original.periods[0].series);
    expect(current.brackets[0].reportedResults).toEqual(original.brackets[0].reportedResults);
    expect(current.brackets[0].reportedResults[0].finality.status).toBe('provider-reported-played');
    expect(original.periods[0].context).toEqual(observed);
  });

  it('keeps changed and contradictory applicability on the exact score receipt without rewriting observed settings', () => {
    const originalContext = context(15, { type: 2, playoff_week_start: 16 });
    const originalInput = { ...input(), periods: [{ nativeWeek: 15, values: scores(15), context: originalContext }] };
    const original = available(originalInput), before = JSON.stringify(originalInput);
    expect(originalContext.phase).toMatchObject({ status: 'derived', value: 'regular-window' });
    for (const [decision, expectedPhase] of [[context(15, { type: 2, playoff_week_start: 15 }, 'in_season', 2),
      { status: 'derived', value: 'on-or-after-playoff-start' }],
    [context(15, { type: 2, start_week: 16, playoff_week_start: 15 }, 'in_season', 3),
      { status: 'unknown', reason: 'contradictory_competition_boundaries' }]] as const) {
      const correctedContext = { ...originalContext,
        configuration: { ...originalContext.configuration, competition: decision.configuration.competition },
        phase: deriveExactPeriodPhase(originalContext.calendar, decision.configuration.competition) };
      const corrected = available({ ...originalInput, periods: [{ nativeWeek: 15, values: scores(15), context: correctedContext }] });
      expect(corrected.periods[0].context).toEqual(correctedContext);
      expect(correctedContext.phase).toMatchObject(expectedPhase);
      expect(correctedContext.observedConfiguration).toEqual(originalContext.observedConfiguration);
      expect(correctedContext.capture).toEqual(originalContext.capture);
      expect(corrected.periods[0]).toMatchObject({ officialOutcome: { status: 'unknown' }, finality: { status: 'unknown' }, series: { status: 'unknown' } });
      expect(composeOfficialResults({ ...originalInput, periods: [{ nativeWeek: 15, values: scores(15),
        context: { ...correctedContext, capture: { ...correctedContext.capture, matchupsReceiptId: scores(16).matchupsReceiptId } } }] }))
        .toEqual({ status: 'unavailable', reason: 'official_results_scope_mismatch' });
    }
    expect(JSON.stringify(originalInput)).toBe(before);
    expect(available(originalInput)).toEqual(original);
  });

  it('preserves missing components, null/unpublished brackets and explicit empty selection separately', () => {
    const result = available({ mapping, standings: { status: 'unavailable', reason: 'latest_roster_attempt_has_no_capture' },
      periods: [{ nativeWeek: 1, values: { status: 'missing' }, context: { status: 'missing' } }],
      brackets: [{ family: 'winners_bracket', resource: bracket('winners_bracket', null) },
        { family: 'losers_bracket', resource: { status: 'missing' } }] });
    expect(result.standings).toEqual({ status: 'unavailable', reason: 'latest_roster_attempt_has_no_capture' });
    expect(result.brackets[0].reportedResults).toEqual([]);
    expect(result.brackets[0].resource).toMatchObject({ status: 'available', value: { publication: 'unpublished' } });
    expect(result.brackets[1].resource.status).toBe('missing');
    expect(available({ mapping, standings: standings(), periods: [], brackets: [] }).periods).toEqual([]);
  });

  it.each(['winners_bracket', 'losers_bracket'] as const)(
    'retains synthetic %s played corrections and outcome removal with immutable original receipts and clocks', family => {
      const originalInput = { ...input(), brackets: [{ family, resource: bracket(family) }] };
      const correctedBracket = { ...bracket(family, [{ r: 2, m: 7, t1: 1, t2: 2, w: 2, l: 1 }]),
        bracketReceiptId: id(72), provenance: { ...provenance, sourceObservedAt: '2026-10-11T10:30:00Z' } };
      const removedBracket = { ...bracket(family, [{ r: 2, m: 7, t1: 1, t2: 2, w: null, l: null }]),
        bracketReceiptId: id(73), provenance: { ...provenance, sourceObservedAt: '2026-10-11T11:00:00Z' } };
      const correctedInput = { ...input(), brackets: [{ family, resource: correctedBracket }] };
      const removedInput = { ...input(), brackets: [{ family, resource: removedBracket }] };
      const before = JSON.stringify([originalInput, correctedInput, removedInput]);
      const original = available(originalInput), corrected = available(correctedInput), removed = available(removedInput);
      expect(original.brackets[0].reportedResults[0]).toMatchObject({ winner: { value: '1' }, loser: { value: '2' },
        source: { bracketReceiptId: id(52) }, finality: { status: 'provider-reported-played' } });
      expect(corrected.brackets[0].reportedResults[0]).toMatchObject({ winner: { value: '2' }, loser: { value: '1' },
        source: { bracketReceiptId: id(72) }, finality: { status: 'provider-reported-played' } });
      expect(removed.brackets[0].reportedResults[0]).toMatchObject({ winner: { state: 'null', value: null },
        loser: { state: 'null', value: null }, source: { bracketReceiptId: id(73) },
        finality: { status: 'unknown', reason: 'provider_finality_evidence_unproved' } });
      for (const [result, source] of [[original, originalInput], [corrected, correctedInput], [removed, removedInput]] as const) {
        expect(result.brackets[0].resource).toEqual(source.brackets[0].resource);
        expect(result.periods).toEqual(original.periods);
        expect(result.standings).toEqual(original.standings);
        expect(available(source)).toEqual(result);
      }
      expect(JSON.stringify([originalInput, correctedInput, removedInput])).toBe(before);
    });

  it.each(['season', 'mapping', 'score-mapping', 'score-week', 'bracket-mapping', 'bracket-family', 'duplicate-week', 'duplicate-bracket'] as const)(
    'rejects %s scope confusion before returning composed facts', mode => {
      let source = input();
      if (mode === 'season') source = { ...source, mapping: { ...mapping, scope: { ...mapping.scope, season: 2025 } } };
      if (mode === 'mapping') source = { ...source, standings: { ...standings(), mapping: { ...mapping, generation: 2 } } };
      if (mode === 'score-mapping') source = { ...source, periods: [{ nativeWeek: 15, values: { ...scores(15), sourceMappingRevisionId: id(99) } }] };
      if (mode === 'score-week') source = { ...source, periods: [{ nativeWeek: 14, values: scores(15) }] };
      if (mode === 'bracket-mapping') source = { ...source, brackets: [{ family: 'winners_bracket', resource: { ...bracket(), sourceMappingRevisionId: id(99) } }] };
      if (mode === 'bracket-family') source = { ...source, brackets: [{ family: 'losers_bracket', resource: bracket() }] };
      if (mode === 'duplicate-week') source = { ...source, periods: [source.periods[0], source.periods[0]] };
      if (mode === 'duplicate-bracket') source = { ...source, brackets: [source.brackets[0], source.brackets[0]] };
      expect(composeOfficialResults(source)).toEqual({ status: 'unavailable', reason: 'official_results_scope_mismatch' });
    });

  it('rejects a period context from a different score receipt instead of borrowing its applicability', () => {
    // Deliberately incomplete adversarial context: receipt validation must fail before any interpretation.
    const context = { status: 'available', version: EXACT_PERIOD_CONTEXT_VERSION, sourceMappingRevisionId: mapping.revisionId,
      period: { season: 2026, nativeWeek: 15 }, capture: { matchupsReceiptId: id(99) } } as ExactPeriodContextRead;
    expect(composeOfficialResults({ ...input(), periods: [{ nativeWeek: 15, values: scores(15), context }] }))
      .toEqual({ status: 'unavailable', reason: 'official_results_scope_mismatch' });
  });

  it('returns all eighteen selected periods and both bracket families without truncation or implying season completion', () => {
    const periods = Array.from({ length: 18 }, (_, index) => ({ nativeWeek: index + 1, values: scores(index + 1) }));
    const brackets = (['winners_bracket', 'losers_bracket'] as const).map(family => ({ family, resource: bracket(family) }));
    const source = { mapping, standings: standings(), periods, brackets }, result = available(source);
    expect(result.scope).toBe('selected-resources');
    expect(result.periods.map(period => period.values)).toEqual(periods.map(period => period.values));
    expect(result.periods.map(period => period.identity.nativeWeek)).toEqual(Array.from({ length: 18 }, (_, index) => index + 1));
    expect(result.brackets.map(item => [item.family, item.resource])).toEqual(brackets.map(item => [item.family, item.resource]));
    expect(composeOfficialResults({ ...source, periods: [...periods, periods[0]] }))
      .toEqual({ status: 'unavailable', reason: 'official_results_scope_mismatch' });
    expect(composeOfficialResults({ ...source, brackets: [...brackets, brackets[0]] }))
      .toEqual({ status: 'unavailable', reason: 'official_results_scope_mismatch' });
  });

  it.each([0, 19, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid selected native week %s even without stored values', nativeWeek => {
    expect(composeOfficialResults({ ...input(), periods: [{ nativeWeek, values: { status: 'missing' } }] }))
      .toEqual({ status: 'unavailable', reason: 'official_results_scope_mismatch' });
  });
});

describe('retained public 2025 bracket facts for test-only interpretation', () => {
  const observed = {
    winners_bracket: [['1', '1', '5', '5', '1'], ['2', '4', '7', '4', '7'],
      ['3', '5', '4', '5', '4'], ['4', '1', '7', '1', '7']],
    losers_bracket: [['1', '8', '9', '8', '9'], ['2', '3', '6', '3', '6'],
      ['3', '8', '3', '8', '3'], ['4', '9', '6', '9', '6']],
  };
  function retained(family: BracketFamily) {
    const sample = completed2025Source.samples.find(value => value.key === 'dynasty');
    const resource = sample?.resources.find(value => value.family === family);
    if (!sample || !resource) throw new Error('Missing retained 2025 bracket evidence.');
    const document = resource.document;
    if (document.origin !== 'network' || document.family !== family || document.week !== null) {
      throw new Error('Unexpected retained 2025 bracket capture.');
    }
    const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
      scope: { provider: 'sleeper', leagueKey: sample.key, externalLeagueId: sample.externalLeagueId, season: sample.season },
      family, week: null, completeness: 'complete', payload: document.payload as JsonValue,
      provenance: { origin: document.origin, requestStartedAt: document.requestStartedAt,
        requestCompletedAt: document.requestCompletedAt, sourceObservedAt: document.sourceObservedAt,
        checkedAt: document.requestCompletedAt } });
    if (normalized.status !== 'accepted'
      || normalized.value?.family !== 'winners_bracket' && normalized.value?.family !== 'losers_bracket'
      || normalized.value.family !== family) {
      throw new Error('Retained bracket facts were rejected by the existing normalizer.');
    }
    return { sample, resource, normalized, matches: normalized.value.matches };
  }

  it.each(['winners_bracket', 'losers_bracket'] as const)(
    'interprets four genuine 2025 %s outcomes without changing native identity payload or clocks', family => {
      const before = JSON.stringify(completed2025Source), { sample, resource, normalized, matches } = retained(family);
      expect(sample.season).toBe(2025);
      const league = sample.resources.find(value => value.family === 'league');
      expect(league?.document.payload).toMatchObject({ league_id: sample.externalLeagueId, season: '2025', sport: 'nfl' });
      expect(normalized.envelope.scope).toEqual({ provider: 'sleeper', leagueKey: sample.key,
        externalLeagueId: sample.externalLeagueId, season: 2025 });
      expect(normalized.envelope.payload).toEqual(resource.document.payload);
      expect(normalized.envelope.provenance).toEqual({ origin: 'network',
        requestStartedAt: resource.document.requestStartedAt, requestCompletedAt: resource.document.requestCompletedAt,
        sourceObservedAt: resource.document.sourceObservedAt, checkedAt: resource.document.requestCompletedAt });
      expect(matches.map(match => [match.externalMatchupId, match.teamOneExternalRosterId, match.teamTwoExternalRosterId,
        match.winnerExternalRosterId, match.loserExternalRosterId])).toEqual(observed[family]);
      for (const match of matches) {
        expect(interpretBracketPlayedResult(match)).toEqual({ status: 'provider-reported-played',
          reason: 'bracket_outcomes_match_resolved_entrants' });
      }
      expect(JSON.stringify(completed2025Source)).toBe(before);
    });

  it.each(['winners_bracket', 'losers_bracket'] as const)(
    'keeps genuine 2025 %s evidence outside runtime bracket scopes projection and composition', family => {
      const { normalized } = retained(family);
      // Canonical mapping IDs here are synthetic guard inputs, never enrollment or stored-2025 proof.
      const priorMapping = { ...mapping, scope: normalized.envelope.scope };
      expect(() => bracketScope(priorMapping, family)).toThrow('current-season');
      expect(projectPlayoffBracket(normalized)).toMatchObject({ status: 'rejected', value: null,
        diagnostics: [{ code: 'invalid_bracket_scope', path: 'envelope' }] });
      expect(composeOfficialResults({ mapping: priorMapping, standings: { status: 'missing' }, periods: [], brackets: [] }))
        .toEqual({ status: 'unavailable', reason: 'official_results_scope_mismatch' });
    });

  it.each(['winners_bracket', 'losers_bracket'] as const)(
    'interprets explicitly synthetic %s correction and removal variants without altering the observed 2025 fixture', family => {
      const before = JSON.stringify(completed2025Source), { matches } = retained(family), original = matches[0];
      // These changed facts are unit-test inventions, not another provider observation or correction chain.
      const syntheticCorrection = { ...original, winnerExternalRosterId: original.loserExternalRosterId,
        loserExternalRosterId: original.winnerExternalRosterId };
      const syntheticRemoval = { ...original, winnerExternalRosterId: null, loserExternalRosterId: null };
      expect(interpretBracketPlayedResult(syntheticCorrection).status).toBe('provider-reported-played');
      expect(interpretBracketPlayedResult(syntheticRemoval)).toEqual({ status: 'unknown', reason: 'provider_finality_evidence_unproved' });
      expect(interpretBracketPlayedResult(original).status).toBe('provider-reported-played');
      expect(JSON.stringify(completed2025Source)).toBe(before);
    });

  it('preserves genuine 2025 weeks 16 and 17 separately while the reported bracket winner differs from the higher last-leg score', () => {
    const before = JSON.stringify(completed2025Source), { sample, matches } = retained('winners_bracket');
    const sourceLeague = sample.resources.find(resource => resource.family === 'league');
    expect(sourceLeague?.document.payload).toMatchObject({ season: '2025', status: 'complete',
      settings: { playoff_week_start: 15, playoff_teams: 4, playoff_round_type: 1, leg: 17, last_scored_leg: 17 },
      metadata: { latest_league_winner_roster_id: '5' } });
    const periods = [16, 17].map(nativeWeek => {
      const resource = sample.resources.find(value => value.family === 'matchups' && value.nativeWeek === nativeWeek);
      if (!resource || resource.document.origin !== 'network' || resource.document.family !== 'matchups'
        || resource.document.week !== nativeWeek || !Array.isArray(resource.document.payload)) {
        throw new Error('Missing exact retained 2025 period.');
      }
      const document = resource.document;
      const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
        normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
        scope: { provider: 'sleeper', leagueKey: sample.key, externalLeagueId: sample.externalLeagueId, season: sample.season },
        family: 'matchups', week: nativeWeek, completeness: 'complete', payload: document.payload as JsonValue,
        provenance: { origin: 'network', requestStartedAt: document.requestStartedAt,
          requestCompletedAt: document.requestCompletedAt, sourceObservedAt: document.sourceObservedAt,
          checkedAt: document.requestCompletedAt } });
      if (normalized.status !== 'accepted' || normalized.value?.family !== 'matchups') {
        throw new Error('Retained period rejected by the existing normalizer.');
      }
      // Canonical IDs are synthetic pure-projector inputs; no historical enrollment or SQL write is claimed.
      const teams = normalized.value.matchups.map((team, index) => ({ seasonTeamId: id(500 + index), externalRosterId: team.externalRosterId }));
      const values = projectExactMatchupValues(normalized, teams), exact = projectExactMatchups(normalized, teams);
      expect(normalized.envelope.payload).toEqual(document.payload);
      expect(normalized.envelope.provenance).toEqual({ origin: 'network', requestStartedAt: document.requestStartedAt,
        requestCompletedAt: document.requestCompletedAt, sourceObservedAt: document.sourceObservedAt, checkedAt: document.requestCompletedAt });
      expect(values).toMatchObject({ season: 2025, nativeWeek }); expect(values.teams).toHaveLength(10);
      expect(exact.state).toEqual({ provider: 'unknown', local: 'unknown', reason: 'no_matchup_finality_evidence' });
      for (const field of ['series', 'bracketMatchId', 'aggregateScore', 'winner']) {
        expect(values).not.toHaveProperty(field); expect(exact).not.toHaveProperty(field);
      }
      return values;
    });
    expect(periods.map(period => ({ nativeWeek: period.nativeWeek, teams: period.teams
      .filter(team => team.externalRosterId === '4' || team.externalRosterId === '5')
      .map(team => ({ roster: team.externalRosterId, matchup: team.nativeMatchupId,
        points: team.rawPoints, custom: team.customPoints, effective: team.effectivePoints })) }))).toEqual([
      { nativeWeek: 16, teams: [
        { roster: '4', matchup: { state: 'supplied', value: '1' }, points: { state: 'supplied', value: '136.2' },
          custom: { state: 'null' }, effective: { value: '136.2', source: 'raw' } },
        { roster: '5', matchup: { state: 'supplied', value: '1' }, points: { state: 'supplied', value: '159.38' },
          custom: { state: 'null' }, effective: { value: '159.38', source: 'raw' } },
      ] },
      { nativeWeek: 17, teams: [
        { roster: '4', matchup: { state: 'supplied', value: '1' }, points: { state: 'supplied', value: '158.2' },
          custom: { state: 'null' }, effective: { value: '158.2', source: 'raw' } },
        { roster: '5', matchup: { state: 'supplied', value: '1' }, points: { state: 'supplied', value: '136.42' },
          custom: { state: 'null' }, effective: { value: '136.42', source: 'raw' } },
      ] },
    ]);
    const reported = matches.find(match => match.externalMatchupId === '3');
    if (!reported) throw new Error('Missing retained championship bracket match.');
    expect(reported).toMatchObject({ round: 2, teamOneExternalRosterId: '5', teamTwoExternalRosterId: '4',
      winnerExternalRosterId: '5', loserExternalRosterId: '4' });
    expect(interpretBracketPlayedResult(reported).status).toBe('provider-reported-played');
    expect(reported.externalMatchupId).not.toBe('1'); // Native bracket and weekly IDs are separate namespaces.
    // Derived corroboration of the asserted source decimals only. These sums are not provider aggregate fields or runtime output.
    expect({ roster5Cents: 15938 + 13642, roster4Cents: 13620 + 15820 }).toEqual({ roster5Cents: 29580, roster4Cents: 29440 });
    expect(JSON.stringify(completed2025Source)).toBe(before);
  });
});

describe('retained public 2026 bracket evidence', () => {
  it.each(liveSource.samples.flatMap(sample => (['winners_bracket', 'losers_bracket'] as const).map(family => ({ sample, family }))))
  ('keeps $sample.key $family null outcomes unknown with its original source clock', ({ sample, family }) => {
    // Canonical identities and receipt wrappers are synthetic; the native payload and clocks are retained source evidence.
    const sourceMapping = { ...mapping, scope: { ...mapping.scope, leagueKey: sample.key, externalLeagueId: sample.externalLeagueId } };
    const { document } = sample.resources[family];
    const sourceProvenance = { origin: 'network' as const, requestStartedAt: document.requestStartedAt,
      requestCompletedAt: document.requestCompletedAt, sourceObservedAt: document.sourceObservedAt, checkedAt: document.requestCompletedAt };
    const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: sourceMapping.scope,
      family, week: null, completeness: 'complete', payload: document.payload as JsonValue, provenance: sourceProvenance });
    const projection = projectPlayoffBracket(normalized);
    if (projection.status !== 'accepted') throw new Error('Expected retained native bracket.');
    const resource: AcceptedBracketRead = { status: 'available', version: BRACKET_VALUE_VERSION, selection: 'receipt',
      contentId: id(51), bracketReceiptId: id(52), acceptanceId: id(53), acceptedGeneration: 1,
      sourceMappingRevisionId: sourceMapping.revisionId, provenance: sourceProvenance, value: projection.value };
    const source: OfficialResultsInput = { mapping: sourceMapping, standings: { status: 'missing' }, periods: [], brackets: [{ family, resource }] };
    const before = JSON.stringify(source), result = available(source);
    expect(result.brackets[0].resource).toEqual(resource);
    expect(result.brackets[0].reportedResults).toHaveLength(document.payload?.length ?? 0);
    for (const [sourceOrdinal, reported] of result.brackets[0].reportedResults.entries()) {
      expect(document.payload![sourceOrdinal]).toMatchObject({ w: null, l: null });
      expect(reported).toEqual({ identity: { kind: 'bracket-match', season: 2026, family,
        externalMatchupId: String(document.payload![sourceOrdinal].m) },
      source: { bracketReceiptId: id(52), sourceOrdinal, winnerPath: 'w', loserPath: 'l' },
      winner: { state: 'null', raw: null, value: null }, loser: { state: 'null', raw: null, value: null },
      finality: { status: 'unknown', reason: 'provider_finality_evidence_unproved' } });
    }
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe('retained public 2026 prior-period score evidence', () => {
  type Sample = typeof priorPeriods.samples[number];
  type Capture = Sample['resources']['league']['document'] | Sample['resources']['matchups'][number]['document'];
  function sourceInput(sample: Sample): OfficialResultsInput {
    // Canonical IDs and receipt/content wrappers are synthetic test inputs, never SQL identity or intake proof.
    const base = 1000 + priorPeriods.samples.indexOf(sample) * 100;
    const sourceMapping: AdministrationSourceMapping = { connectionId: id(base), leagueSeasonId: id(base + 1),
      revisionId: id(base + 2), generation: 1, scope: { provider: 'sleeper', leagueKey: sample.key,
        externalLeagueId: sample.externalLeagueId, season: 2026 } };
    const captured = (document: Capture) => {
      if (document.origin !== 'network' || document.family !== 'league' && document.family !== 'matchups') {
        throw new Error('Unexpected retained capture.');
      }
      return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
        normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: sourceMapping.scope,
        family: document.family, week: document.week, completeness: 'complete', payload: document.payload,
        provenance: { origin: document.origin, requestStartedAt: document.requestStartedAt,
          requestCompletedAt: document.requestCompletedAt, sourceObservedAt: document.sourceObservedAt,
          checkedAt: document.requestCompletedAt } });
    };
    const league = captured(sample.resources.league.document);
    if (!league.leagueSettings?.value) throw new Error('Missing retained league settings.');
    const observedConfiguration = { contentId: id(base + 3), configurationVersionId: null,
      rawContentHash: league.contentHash, provenance: league.envelope.provenance,
      value: league.leagueSettings.value, applicability: 'observation-only' as const };
    const calendar: ExactPeriodMappingQualification = { status: 'unmapped', reason: 'calendar_evidence_missing' };
    const unknown = { status: 'unknown', reason: 'period_mapping_unproved' } as const;
    return { mapping: sourceMapping, standings: { status: 'missing' }, brackets: [],
      periods: sample.resources.matchups.map(({ document }, index) => {
        const normalized = captured(document), matchupsReceiptId = id(base + 10 + index);
        const values: ExactMatchupValuesRead = { status: 'available', version: EXACT_MATCHUP_VALUES_VERSION,
          selection: 'receipt', contentId: id(base + 20 + index), matchupsReceiptId,
          acceptanceId: id(base + 30 + index), acceptedGeneration: 1, sourceMappingRevisionId: sourceMapping.revisionId,
          provenance: normalized.envelope.provenance,
          value: projectExactMatchupValues(normalized, document.payload.map(row => ({
            seasonTeamId: id(base + 50 + row.roster_id), externalRosterId: String(row.roster_id) }))) };
        const periodContext: ExactPeriodContextRead = { status: 'available', version: EXACT_PERIOD_CONTEXT_VERSION,
          period: { season: 2026, nativeWeek: document.week }, sourceMappingRevisionId: sourceMapping.revisionId,
          capture: { matchupsReceiptId, settingsReceiptId: null, configurationContentId: observedConfiguration.contentId },
          observedConfiguration, calendar, configuration: { scoring: unknown, roster: unknown, competition: unknown },
          nativeOfficialPhase: { status: 'unknown', reason: 'native-period-phase-not-exposed' },
          phase: deriveExactPeriodPhase(calendar, unknown) };
        return { nativeWeek: document.week, values, context: periodContext };
      }) };
  }

  it('binds 25 minimized captures and the original row-key inventory to their source clocks and digests', () => {
    expect(createHash('sha256').update(JSON.stringify(priorPeriods)).digest('hex'))
      .toBe('2aa76dd22eafd07756f08f9a68bed390847c55f6d5453b49520f1452081db52c');
    expect(priorPeriods.acquisition).toMatchObject({ sourceRevision: '0525bff09a29124e01b92eb69969082eae6997a2',
      manifestSha256: 'ad6b99a4dd63355715d2193080a476f1534e96922e4b9ef99a4e19832e073c02',
      totalNetworkRequests: 25, serializedDocumentBytes: 143817, databaseAccess: false, credentialsLoaded: false });
    let documents = 0, rows = 0;
    for (const sample of priorPeriods.samples) {
      expect(sample.resources.league.document.payload).toMatchObject({ league_id: sample.externalLeagueId,
        sport: 'nfl', season: '2026', status: 'in_season', settings: { leg: 5, last_scored_leg: 4 } });
      expect(sample.resources.matchups.map(resource => resource.document.week)).toEqual([1, 2, 3, 4]);
      for (const resource of [sample.resources.league, ...sample.resources.matchups]) {
        const { document, source } = resource;
        expect(source.endpoint).toBe(`https://api.sleeper.app/v1/league/${sample.externalLeagueId}`
          + (document.week === null ? '' : `/matchups/${document.week}`));
        expect(source.responseUrl).toBe(source.endpoint);
        expect(source.httpStatus).toBe(200);
        expect(createHash('sha256').update(JSON.stringify(document)).digest('hex')).toBe(resource.sliceSha256);
        expect(document.origin).toBe('network');
        expect(document.sourceObservedAt).toBe(document.requestCompletedAt);
        expect(Date.parse(document.requestStartedAt)).toBeLessThanOrEqual(Date.parse(source.networkRequestStartedAt));
        expect(Date.parse(source.networkRequestStartedAt)).toBeLessThanOrEqual(Date.parse(document.sourceObservedAt));
        documents += 1;
      }
      for (const resource of sample.resources.matchups) {
        expect(resource.source.originalRowKeyInventory).toEqual([{
          keys: ['points', 'players', 'roster_id', 'custom_points', 'matchup_id', 'starters', 'starters_points', 'players_points'],
          sourceOrdinals: resource.document.payload.map((_, index) => index),
        }]);
        rows += resource.document.payload.length;
      }
    }
    expect(documents).toBe(25);
    expect(rows).toBe(232);
  });

  it.each(priorPeriods.samples)('preserves every $key score and group in four independently observed native periods', sample => {
    const source = sourceInput(sample), before = JSON.stringify(source), result = available(source);
    expect(result.mapping.scope.externalLeagueId).toBe(sample.externalLeagueId);
    expect(result.periods.map(period => period.identity)).toEqual([1, 2, 3, 4].map(nativeWeek => ({
      kind: 'native-period', season: 2026, nativeWeek })));
    expect(result.standings).toEqual({ status: 'missing' });
    expect(result.brackets).toEqual([]);
    const receiptIds = [], observedAt = [];
    for (const [index, period] of result.periods.entries()) {
      const document = sample.resources.matchups[index].document, values = period.values, context = period.context;
      if (values.status !== 'available' || context?.status !== 'available') throw new Error('Missing composed source facts.');
      expect(values).toEqual(source.periods[index].values);
      expect(values).not.toBe(source.periods[index].values);
      expect(values.provenance).toEqual({ origin: 'network', requestStartedAt: document.requestStartedAt,
        requestCompletedAt: document.requestCompletedAt, sourceObservedAt: document.sourceObservedAt,
        checkedAt: document.requestCompletedAt });
      expect(context.observedConfiguration.provenance.sourceObservedAt).toBe(sample.resources.league.document.sourceObservedAt);
      expect(context.observedConfiguration.provenance.sourceObservedAt).not.toBe(values.provenance.sourceObservedAt);
      expect(context.observedConfiguration.applicability).toBe('observation-only');
      expect(context.configuration.competition.status).toBe('unknown');
      expect(context.phase.status).toBe('unknown');
      expect(values.value.teams).toHaveLength(document.payload.length);
      for (const [sourceOrdinal, native] of document.payload.entries()) {
        expect(Object.keys(native)).toEqual(['roster_id', 'matchup_id', 'points', 'custom_points']);
        expect(native.custom_points).toBeNull();
        expect(values.value.teams[sourceOrdinal]).toMatchObject({ externalRosterId: String(native.roster_id), sourceOrdinal,
          nativeMatchupId: { state: 'supplied', value: String(native.matchup_id) },
          rawPoints: { state: 'supplied', value: String(native.points) }, customPoints: { state: 'null' },
          effectivePoints: { value: String(native.points), source: 'raw' } });
      }
      expect(period.officialOutcome).toEqual({ status: 'unknown', reason: 'weekly_result_evidence_unproved' });
      expect(period.finality).toEqual({ status: 'unknown', reason: 'provider_finality_evidence_unproved' });
      expect(period.series).toEqual({ status: 'unknown', reason: 'series_membership_unproved' });
      for (const field of ['winner', 'tie', 'bye', 'rank', 'aggregateScore']) expect(period).not.toHaveProperty(field);
      receiptIds.push(values.matchupsReceiptId);
      observedAt.push(values.provenance.sourceObservedAt);
    }
    expect(new Set(receiptIds).size).toBe(4);
    expect(new Set(observedAt).size).toBe(4);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('retains the observed 110.2 equality for keeper week one without declaring an official tie or final result', () => {
    const sample = priorPeriods.samples.find(sample => sample.key === 'keeper-sample')!;
    const native = sample.resources.matchups[0].document.payload.filter(row => row.matchup_id === 1);
    expect(native).toEqual([{ roster_id: 10, matchup_id: 1, points: 110.2, custom_points: null },
      { roster_id: 12, matchup_id: 1, points: 110.2, custom_points: null }]);
    const period = available(sourceInput(sample)).periods[0];
    if (period.values.status !== 'available') throw new Error('Missing observed scores.');
    expect(period.values.value.teams.filter(team => team.nativeMatchupId.state === 'supplied' && team.nativeMatchupId.value === '1')
      .map(team => [team.externalRosterId, team.effectivePoints])).toEqual([
      ['10', { value: '110.2', source: 'raw' }], ['12', { value: '110.2', source: 'raw' }],
    ]);
    expect(period).toMatchObject({ identity: { season: 2026, nativeWeek: 1 }, officialOutcome: { status: 'unknown' },
      finality: { status: 'unknown' }, series: { status: 'unknown' } });
    expect(period).not.toHaveProperty('tie');
  });
});


describe('separate selected report facts', () => {
  function reportInput(): OfficialResultsInput {
    const source = weeklyReportSource.observations[0];
    const scoped = { ...mapping, scope: { ...mapping.scope, externalLeagueId: source.externalLeagueId } };
    const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', family: 'weekly_report', week: 1,
      scope: scoped.scope, completeness: 'complete', payload: source.report.document,
      provenance: { origin: 'network', requestStartedAt: source.report.source.requestStartedAt,
        requestCompletedAt: source.report.source.requestCompletedAt, sourceObservedAt: source.report.source.sourceObservedAt,
        checkedAt: source.report.source.requestCompletedAt } });
    const report = projectWeeklyReport(normalized);
    if (report.status !== 'accepted') throw new Error('Expected retained report');
    // Canonical IDs and receipts are synthetic; native report values and clocks are real retained evidence.
    const resource: AcceptedWeeklyReportRead = { status: 'available', version: WEEKLY_REPORT_VERSION, selection: 'receipt',
      contentId: id(801), reportReceiptId: id(802), acceptanceId: id(803), acceptedGeneration: 1,
      sourceMappingRevisionId: scoped.revisionId, provenance: normalized.envelope.provenance,
      freshness: 'unknown', historicalApplicability: 'report-only',
      value: { ...report.value, teams: report.value.teams.map(team => ({ ...team, seasonTeamId: id(900 + Number(team.externalRosterId)) })) } };
    return { mapping: scoped, standings: { status: 'missing' }, periods: [], brackets: [], reports: [{ nativeWeek: 1, resource }] };
  }
  it('preserves selected report receipt, native values and clocks without replacing other components', () => {
    const input = reportInput(), before = JSON.stringify(input), result = composeOfficialResults(input);
    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('Unavailable');
    expect(result.reports).toEqual(input.reports); expect(result.reports).not.toBe(input.reports);
    expect(result.periods).toEqual([]); expect(result.standings).toEqual({ status: 'missing' }); expect(result.brackets).toEqual([]);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('keeps omitted report output absent and an explicit missing report visible', () => {
    const input = reportInput(); delete (input as { reports?: unknown }).reports;
    expect(composeOfficialResults(input)).not.toHaveProperty('reports');
    expect(composeOfficialResults({ ...input, reports: [{ nativeWeek: 4, resource: { status: 'missing' } }] }))
      .toMatchObject({ reports: [{ nativeWeek: 4, resource: { status: 'missing' } }] });
  });
  it.each(['duplicate', 'week', 'mapping', 'key', 'season', 'version'] as const)('rejects cross-scope report composition: %s', field => {
    const input = structuredClone(reportInput());
    const reports = input.reports as { nativeWeek: number; resource: Extract<AcceptedWeeklyReportRead, { status: 'available' }> }[];
    if (field === 'duplicate') reports.push(reports[0]);
    if (field === 'week') reports[0].nativeWeek = 2;
    if (field === 'mapping') reports[0].resource = { ...reports[0].resource, sourceMappingRevisionId: id(999) };
    if (field === 'key') reports[0].resource = { ...reports[0].resource, value: { ...reports[0].resource.value, reportKey: 'another-league_1' } };
    if (field === 'season') reports[0].resource = { ...reports[0].resource, value: { ...reports[0].resource.value, season: 2025 as 2026 } };
    if (field === 'version') reports[0].resource = { ...reports[0].resource, version: 'wrong' as typeof WEEKLY_REPORT_VERSION };
    expect(composeOfficialResults(input)).toEqual({ status: 'unavailable', reason: 'official_results_scope_mismatch' });
  });
});
