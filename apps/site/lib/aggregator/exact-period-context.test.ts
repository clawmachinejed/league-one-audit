import { describe, expect, it } from 'vitest';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { JsonValue } from '../league-administration/contracts';
import type { ExactPeriodMappingQualification } from './exact-matchups';
import { deriveExactPeriodPhase, EXACT_PERIOD_PHASE_POLICY, type PeriodConfigurationContext } from './exact-period-context';

const at = '2026-10-10T12:00:00.123456+00:00';
const scope = { leagueKey: 'unrelated', provider: 'sleeper' as const, externalLeagueId: '123456', season: 2026 };
function calendar(week: number): Extract<ExactPeriodMappingQualification, { status: 'mapped' }> {
  return { status: 'mapped', purpose: 'native-period-identity', evidenceRef: 'calendar', policyVersion: 'sleeper-native-week-to-nfl-regular-v1',
    scheduleRevision: 'a'.repeat(64), evaluatedAt: at, retrievalStartedAt: at, retrievalCompletedAt: at,
    sourceObservedAt: null, season: 2026, seasonType: 'regular', week };
}
function fixture(week = 14, settings: Record<string, JsonValue> = { start_week: 2, playoff_week_start: 15 },
  lifecycle = 'complete'): Extract<PeriodConfigurationContext['competition'], { status: 'known' }> {
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope, family: 'league', week: null, completeness: 'complete',
    provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at },
    payload: { league_id: scope.externalLeagueId, season: '2026', sport: 'nfl', season_type: 'regular', status: lifecycle,
      settings: { leg: 18, last_scored_leg: 17, ...settings } } });
  if (!normalized.leagueSettings?.value || normalized.value?.family !== 'league') throw new Error('Invalid settings fixture.');
  const value = normalized.leagueSettings.value;
  return { status: 'known', basis: 'latest-evidenced-decision', activationRef: 'activation', range: { seasonType: 'regular', fromWeek: 1, throughWeek: 18 },
    binding: { leagueSeasonId: 'season', component: 'competition', period: { season: 2026, seasonType: 'regular', week },
      componentHash: normalized.value.components.find(component => component.name === 'competition')!.hash,
      configurationVersionId: 'version', generation: 3, recordedAt: at,
      evidence: { kind: 'owner_confirmed', reference: 'fixture evidence: explicit component range' } },
    source: { configurationContentId: 'content', rawContentHash: normalized.contentHash },
    fields: { competition: value.competition, rosterRules: value.rosterRules, waivers: value.waivers } };
}

describe('period-applicable competition boundary classification', () => {
  it.each([[1, 'before-start'], [2, 'regular-window'], [14, 'regular-window'], [15, 'on-or-after-playoff-start'],
    [18, 'on-or-after-playoff-start']] as const)('classifies exact week %i without inventing active rounds', (week, value) => {
    expect(deriveExactPeriodPhase(calendar(week), fixture(week))).toEqual({ status: 'derived', value,
      policyVersion: EXACT_PERIOD_PHASE_POLICY, basis: 'owner-confirmed-applicable-settings', activationRef: 'activation',
      componentHash: fixture(week).binding.componentHash, generation: 3, recordedAt: at, periodMappingRef: 'calendar',
      boundaries: { startPeriod: 2, playoffStartPeriod: 15 }, round: { status: 'unknown', reason: 'round_evidence_missing' },
      leg: { status: 'unknown', reason: 'leg_evidence_missing' }, end: { status: 'unknown', reason: 'competition_end_evidence_missing' } });
  });
  it('permits equal evidenced boundaries without inventing a regular-season interval', () => {
    for (const [week, value] of [[14, 'before-start'], [15, 'on-or-after-playoff-start']] as const) {
      expect(deriveExactPeriodPhase(calendar(week), fixture(week, { start_week: 15, playoff_week_start: 15 })))
        .toMatchObject({ status: 'derived', value });
    }
  });
  it.each(['pre_draft', 'drafting', 'in_season', 'complete'])('does not use current lifecycle %s or leg as period applicability', lifecycle => {
    const observed = fixture(4, { start_week: 1, playoff_week_start: 15, leg: 18 }, lifecycle);
    expect(deriveExactPeriodPhase(calendar(4), { status: 'unknown', reason: 'no_binding' }))
      .toMatchObject({ status: 'unknown', reason: 'competition_applicability_unknown' });
    expect(deriveExactPeriodPhase(calendar(4), observed)).toMatchObject({ status: 'derived', value: 'regular-window' });
  });
  it.each(['no_binding', 'missing_version', 'inconsistent_binding', 'invalid_applicability_evidence', 'applicability_inventory_overflow'] as const)(
    'keeps %s unknown without an older fallback', reason => {
      expect(deriveExactPeriodPhase(calendar(14), { status: 'unknown', reason }))
        .toMatchObject({ status: 'unknown', reason: 'competition_applicability_unknown' });
    });
  it('requires independent native-to-NFL identity proof', () => {
    expect(deriveExactPeriodPhase({ status: 'unmapped', reason: 'calendar_evidence_missing' }, fixture()))
      .toMatchObject({ status: 'unknown', reason: 'period_mapping_unproved' });
    expect(deriveExactPeriodPhase({ ...calendar(14), season: 2025 }, fixture()))
      .toMatchObject({ status: 'unknown', reason: 'period_mapping_unproved' });
  });
  it.each(['startPeriod', 'playoffStartPeriod'] as const)('preserves absent/null/invalid/zero/out-of-range %s', field => {
    const sourceKey = field === 'startPeriod' ? 'start_week' : 'playoff_week_start';
    for (const [value, reason] of [[undefined, 'absent'], [null, 'null'], ['15', 'invalid'], [false, 'invalid'],
      [{}, 'invalid'], [1.5, 'invalid'], [0, 'zero'], [19, 'out-of-range']] as const) {
      const settings: Record<string, JsonValue> = { start_week: 1, playoff_week_start: 15 };
      if (value === undefined) delete settings[sourceKey]; else settings[sourceKey] = value;
      const component = fixture(14, settings);
      const before = JSON.stringify(component.fields);
      expect(deriveExactPeriodPhase(calendar(14), component)).toMatchObject({ status: 'unknown',
        reason: 'competition_boundaries_unproved', boundaryGaps: [{ field, reason }] });
      expect(JSON.stringify(component.fields)).toBe(before);
      if (reason === 'invalid') expect(component.fields.competition[field]).toMatchObject({ state: 'invalid', raw: value });
    }
  });
  it('retains two distinct missing states and contradictory known boundaries', () => {
    expect(deriveExactPeriodPhase(calendar(14), fixture(14, { playoff_week_start: null }))).toMatchObject({
      status: 'unknown', boundaryGaps: [{ field: 'startPeriod', reason: 'absent' }, { field: 'playoffStartPeriod', reason: 'null' }] });
    expect(deriveExactPeriodPhase(calendar(14), fixture(14, { start_week: 16, playoff_week_start: 15 })))
      .toMatchObject({ status: 'unknown', reason: 'contradictory_competition_boundaries' });
  });
  it.each(['component', 'season', 'seasonType', 'week', 'range', 'generation', 'emptyEvidence', 'sourceEffective'] as const)(
    'refuses an inconsistent or unsupported %s binding', change => {
      const candidate = { ...structuredClone(fixture()) };
      if (change === 'component') candidate.binding = { ...candidate.binding, component: 'roster' };
      if (change === 'season') candidate.binding = { ...candidate.binding, period: { ...candidate.binding.period, season: 2025 } };
      if (change === 'seasonType') candidate.binding = { ...candidate.binding, period: { ...candidate.binding.period, seasonType: 'post' } };
      if (change === 'week') candidate.binding = { ...candidate.binding, period: { ...candidate.binding.period, week: 15 } };
      if (change === 'range') candidate.range = { seasonType: 'regular', fromWeek: 15, throughWeek: 18 };
      if (change === 'generation') candidate.binding = { ...candidate.binding, generation: 0 };
      if (change === 'emptyEvidence') candidate.binding = { ...candidate.binding, evidence: { kind: 'owner_confirmed', reference: '' } };
      if (change === 'sourceEffective') candidate.binding = { ...candidate.binding, evidence: { kind: 'source_effective', reference: 'unimplemented producer' } };
      expect(deriveExactPeriodPhase(calendar(14), candidate)).toMatchObject({ status: 'unknown', reason: 'inconsistent_competition_binding' });
    });
  it('exposes later owner decisions without rewriting an earlier result or claiming capture-time proof', () => {
    const old = fixture(14, { start_week: 1, playoff_week_start: 15 });
    const oldResult = deriveExactPeriodPhase(calendar(14), old);
    const correction = fixture(14, { start_week: 1, playoff_week_start: 14 });
    const latest = { ...correction, activationRef: 'correction', binding: { ...correction.binding,
      generation: 4, recordedAt: '2026-10-11T12:00:00.000Z' } };
    expect(deriveExactPeriodPhase(calendar(14), latest)).toMatchObject({ status: 'derived', value: 'on-or-after-playoff-start',
      generation: 4, recordedAt: '2026-10-11T12:00:00.000Z', basis: 'owner-confirmed-applicable-settings' });
    expect(oldResult).toMatchObject({ status: 'derived', value: 'regular-window', generation: 3, recordedAt: at });
    expect(deriveExactPeriodPhase(calendar(14), old)).toEqual(oldResult);
  });
});
