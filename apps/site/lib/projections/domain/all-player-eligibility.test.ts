import { describe, expect, it } from 'vitest';
import {
  allPlayerEligibilityCounts, validateAllPlayerEligibility,
  type AllPlayerEligibilityEvidence, type AllPlayerPeriodParticipationEvidence,
} from './all-player-eligibility';

const periodEvidence: AllPlayerPeriodParticipationEvidence = {
  kind: 'period-participation', decision: 'dressed-unused', source: 'gamebook',
  sourceRevision: 'https://example.invalid/synthetic-gamebook.pdf#page=1',
  observedAt: '2026-09-15T00:00:00.000Z',
  effectivePeriod: { season: 2026, seasonType: 'reg', week: 1 },
  reason: 'Synthetic requested-game DNP list, distinct from the inactive list.',
};

describe('exact-period all-player eligibility evidence', () => {
  it.each([
    [undefined, undefined, null, null], [undefined, 0, null, null], [undefined, 1, 1, 1],
    [0, undefined, 0, 0], [0, 0, 0, 0], [0, 1, null, null],
    [1, undefined, null, null], [1, 0, 1, 0], [1, 1, 1, 1],
  ] as const)('derives active %s / appearances %s as %s / %s', (active, appearances, eligible, count) => {
    const eligibilityEvidence: AllPlayerEligibilityEvidence = {
      kind: 'weekly-stat', source: 'weekly-stat-provider',
      ...(active === undefined ? {} : { gmsActive: active }),
      ...(appearances === undefined ? {} : { appearances }),
    };
    expect(allPlayerEligibilityCounts(eligibilityEvidence)).toEqual({
      eligibleGameCount: eligible, appearanceGameCount: count,
    });
    expect(validateAllPlayerEligibility({ eligibilityEvidence,
      eligibleGameCount: eligible, appearanceGameCount: count })).toBe(true);
  });

  it.each([2, -1, 0.5, null, '1', true, [], {}, ''])('retains malformed flag %j as valid unknown evidence', (flag) => {
    expect(allPlayerEligibilityCounts({ kind: 'weekly-stat', source: 'weekly-stat-provider',
      gmsActive: 1, rawFlags: { gp: flag } })).toEqual({
      eligibleGameCount: null, appearanceGameCount: null,
    });
  });

  it('requires period provenance and refuses catalog status without it', () => {
    expect(allPlayerEligibilityCounts({ kind: 'explicit-ineligible', reason: 'inactive',
      source: 'player-status-provider', sourceRevision: 'current-catalog' })).toBeNull();
    expect(allPlayerEligibilityCounts({ ...periodEvidence, observedAt: 'not-a-date' })).toBeNull();
    expect(allPlayerEligibilityCounts({ ...periodEvidence, effectivePeriod: { ...periodEvidence.effectivePeriod, week: 19 } })).toBeNull();
  });

  it('allows proven dressed-but-unused activity and retains contradictory counts as unknown', () => {
    expect(allPlayerEligibilityCounts({ ...periodEvidence,
      weekly: { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1 } })).toEqual({
      eligibleGameCount: 1, appearanceGameCount: 0,
    });
    for (const weekly of [
      { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1, appearances: 1 },
      { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 0, appearances: 1 },
      { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1, rawFlags: { gp: '1' } },
    ]) expect(allPlayerEligibilityCounts({ ...periodEvidence, weekly })).toEqual({
      eligibleGameCount: null, appearanceGameCount: null,
    });
  });

  it('retains ambiguous reviewed activity without a denominator', () => {
    expect(allPlayerEligibilityCounts({ ...periodEvidence, decision: 'ambiguous',
      weekly: { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1 } })).toEqual({
      eligibleGameCount: null, appearanceGameCount: null,
    });
  });

  it('rejects invented conflict labels, malformed evidence, and disguised valid raw flags', () => {
    const ineligibility = { kind: 'explicit-ineligible', reason: 'inactive', source: 'manual-review',
      sourceRevision: 'review', observedAt: periodEvidence.observedAt, effectivePeriod: periodEvidence.effectivePeriod };
    expect(allPlayerEligibilityCounts({ kind: 'conflict', ineligibility,
      weekly: { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 0 } })).toBeNull();
    expect(allPlayerEligibilityCounts({ kind: 'weekly-stat', source: 'weekly-stat-provider', rawFlags: { gp: 1 } })).toBeNull();
    expect(allPlayerEligibilityCounts({ kind: 'weekly-stat', source: 'weekly-stat-provider', rawFlags: { gp: undefined } })).toBeNull();
    expect(allPlayerEligibilityCounts({ kind: 'weekly-stat', source: 'weekly-stat-provider', rawFlags: { gp: NaN } })).toBeNull();
    expect(allPlayerEligibilityCounts({ kind: 'weekly-stat', source: 'weekly-stat-provider', extra: true })).toBeNull();
    expect(allPlayerEligibilityCounts({ ...periodEvidence, weekly: { kind: 'unknown-weekly-stat', source: 'weekly-stat-provider' } })).toBeNull();
  });
});
