import { describe, expect, it } from 'vitest';
import { resolveConfigurationComponent, validateAnnualSourceContinuity } from './applicability';
import type { CanonicalSeasonSourceIdentity, ConfigurationBinding, ConfigurationComponent } from './contracts';

const leagueId = '00000000-0000-5000-8000-000000000001';
const leagueSeasonId = '00000000-0000-5000-8000-000000000002';
const previousSeasonId = '00000000-0000-5000-8000-000000000003';
const period = { season: 2026, seasonType: 'regular', week: 1 };
const scoring: ConfigurationComponent = { name: 'scoring', hash: 'scoring-a', value: { scoring_settings: { rec: 0.5 } } };
const binding: ConfigurationBinding = {
  leagueSeasonId, component: 'scoring', period, componentHash: scoring.hash, configurationVersionId: 'config-a', generation: 1,
  recordedAt: '2026-09-12T16:30:00.000Z', evidence: { kind: 'owner_confirmed', reference: 'approved-period-binding' },
};
const version = { id: 'config-a', leagueSeasonId, components: [scoring] };

describe('component-scoped configuration applicability', () => {
  it('keeps historical applicability unknown when only a current configuration exists', () => {
    expect(resolveConfigurationComponent({ leagueSeasonId, component: 'scoring', period, bindings: [], versions: [version] }))
      .toEqual({ status: 'unknown', reason: 'no_binding' });
  });

  it('resolves the exact source-backed or owner-confirmed period binding', () => {
    expect(resolveConfigurationComponent({ leagueSeasonId, component: 'scoring', period, bindings: [binding], versions: [version] }))
      .toEqual({ status: 'known', binding, component: scoring });
  });

  it.each([
    { ...binding, period: { ...period, week: 2 } },
    { ...binding, period: { ...period, season: 2025 } },
    { ...binding, period: { ...period, seasonType: 'postseason' } },
    { ...binding, component: 'roster' as const },
    { ...binding, leagueSeasonId: previousSeasonId },
  ])('does not borrow a binding from another component, period, or league season %#', (other) => {
    expect(resolveConfigurationComponent({ leagueSeasonId, component: 'scoring', period, bindings: [other], versions: [version] }))
      .toEqual({ status: 'unknown', reason: 'no_binding' });
  });

  it('honors a fenced new generation even when reverting to previously seen component content', () => {
    const b = { ...binding, configurationVersionId: 'config-b', componentHash: 'scoring-b', generation: 2 };
    const again = { ...binding, generation: 3 };
    const result = resolveConfigurationComponent({ leagueSeasonId, component: 'scoring', period, bindings: [binding, b, again], versions: [version] });
    expect(result).toEqual({ status: 'known', binding: again, component: scoring });
  });

  it('refuses duplicate/forked generations, missing content, and mismatched component hashes', () => {
    expect(resolveConfigurationComponent({ leagueSeasonId, component: 'scoring', period, bindings: [binding, binding], versions: [version] }))
      .toEqual({ status: 'unknown', reason: 'inconsistent_binding' });
    expect(resolveConfigurationComponent({ leagueSeasonId, component: 'scoring', period, bindings: [binding], versions: [] }))
      .toEqual({ status: 'unknown', reason: 'missing_version' });
    expect(resolveConfigurationComponent({ leagueSeasonId, component: 'scoring', period, bindings: [{ ...binding, componentHash: 'wrong' }], versions: [version] }))
      .toEqual({ status: 'unknown', reason: 'inconsistent_binding' });
  });

  it('requires actual applicability evidence instead of a retrieval timestamp', () => {
    expect(resolveConfigurationComponent({ leagueSeasonId, component: 'scoring', period, bindings: [{ ...binding, evidence: { kind: 'owner_confirmed', reference: '' } }], versions: [version] }))
      .toEqual({ status: 'unknown', reason: 'inconsistent_binding' });
  });
});

describe('explicit annual source mapping', () => {
  const current: CanonicalSeasonSourceIdentity = { leagueId, leagueSeasonId, season: 2026, provider: 'sleeper', externalLeagueId: 'renewed-2026' };
  const previous: CanonicalSeasonSourceIdentity = { leagueId, leagueSeasonId: previousSeasonId, season: 2025, provider: 'sleeper', externalLeagueId: 'prior-2025' };

  it('validates renewed external league identity under one canonical league and distinct seasons', () => {
    expect(validateAnnualSourceContinuity({ current, previous, reportedPreviousExternalLeagueId: previous.externalLeagueId })).toEqual({ status: 'valid', current, previous });
  });

  it('does not infer continuity from a missing mapping or missing provider predecessor evidence', () => {
    expect(validateAnnualSourceContinuity({ current, previous: null, reportedPreviousExternalLeagueId: previous.externalLeagueId }))
      .toEqual({ status: 'unknown', reason: 'missing_previous_mapping' });
    expect(validateAnnualSourceContinuity({ current, previous, reportedPreviousExternalLeagueId: null }))
      .toEqual({ status: 'unknown', reason: 'missing_source_evidence' });
  });

  it.each([
    [{ ...current, leagueId: previousSeasonId }, previous.externalLeagueId, 'different_league'],
    [{ ...current, leagueSeasonId: previousSeasonId }, previous.externalLeagueId, 'reused_identity'],
    [{ ...current, externalLeagueId: previous.externalLeagueId }, previous.externalLeagueId, 'reused_identity'],
    [{ ...current, season: 2028 }, previous.externalLeagueId, 'nonadjacent_season'],
    [current, 'unrelated-source', 'source_predecessor_mismatch'],
    [{ ...current, leagueSeasonId: 'source-roster-1' }, previous.externalLeagueId, 'invalid_identity'],
  ])('rejects an invalid canonical or provider continuity claim %#', (mapped, predecessor, reason) => {
    expect(validateAnnualSourceContinuity({ current: mapped, previous, reportedPreviousExternalLeagueId: predecessor })).toEqual({ status: 'rejected', reason });
  });
});
