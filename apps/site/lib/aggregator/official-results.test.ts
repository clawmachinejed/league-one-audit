import { describe, expect, it } from 'vitest';
import type { AdministrationFamily, JsonValue } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import { EXACT_MATCHUP_VALUES_VERSION, projectExactMatchupValues, type ExactMatchupValuesRead } from './exact-matchup-values';
import { deriveExactPeriodPhase, EXACT_PERIOD_CONTEXT_VERSION, type ExactPeriodContextRead,
  type PeriodConfigurationContext } from './exact-period-context';
import type { ExactPeriodMappingQualification } from './exact-matchups';
import { BRACKET_VALUE_VERSION, projectPlayoffBracket, type AcceptedBracketRead, type BracketFamily } from './playoff-brackets';
import { OFFICIAL_STANDINGS_VERSION, projectOfficialStandings, type OfficialStandingsRead } from './official-standings';
import { composeOfficialResults, OFFICIAL_RESULTS_VERSION, type OfficialResultsInput } from './official-results';

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
  // Synthetic reported outcomes test preservation, not observed availability in a real league.
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

  it('returns supplied bracket outcomes in their own namespace with unknown finality and opaque position', () => {
    const result = available();
    expect(result.brackets[0].reportedResults).toEqual([{
      identity: { kind: 'bracket-match', season: 2026, family: 'winners_bracket', externalMatchupId: '7' },
      source: { bracketReceiptId: id(52), sourceOrdinal: 0, winnerPath: 'w', loserPath: 'l' },
      winner: { state: 'supplied', raw: 1, value: '1' }, loser: { state: 'supplied', raw: 2, value: '2' },
      finality: { status: 'unknown', reason: 'provider_finality_evidence_unproved' },
    }]);
    expect(result.brackets[0].reportedResults[0]).not.toHaveProperty('nativeWeek');
    expect(result.brackets[0].reportedResults[0]).not.toHaveProperty('rank');
    expect(result.brackets[0].resource).toEqual(bracket());
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

  it('does not finalize contests when a later league observation reports complete and a last-scored leg', () => {
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
    expect(current.brackets[0].reportedResults[0]).toMatchObject({ winner: { value: '1' }, finality: { status: 'unknown' } });
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

  it('keeps corrected supplied outcomes and scores separate from retained receipts and clocks', () => {
    const original = available(), correctedBracket = { ...bracket('winners_bracket', [{ r: 2, m: 7, t1: 1, t2: 2, w: 2, l: 1 }]),
      bracketReceiptId: id(72), provenance: { ...provenance, sourceObservedAt: '2026-10-11T10:30:00Z' } };
    const corrected = available({ ...input(), brackets: [{ family: 'winners_bracket', resource: correctedBracket }] });
    expect(corrected.brackets[0].reportedResults[0].winner.value).toBe('2');
    expect(corrected.brackets[0].reportedResults[0].source.bracketReceiptId).toBe(id(72));
    expect(original.brackets[0].reportedResults[0].winner.value).toBe('1');
    expect(corrected.periods).toEqual(original.periods);
    expect(corrected.standings).toEqual(original.standings);
    expect(available()).toEqual(original);
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
