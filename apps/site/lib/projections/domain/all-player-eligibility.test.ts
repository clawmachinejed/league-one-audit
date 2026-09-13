import { describe, expect, it } from 'vitest';
import {
  allPlayerEligibilityCounts, validateAllPlayerEligibility,
  ALL_PLAYER_INDIVIDUAL_SNAP_KEYS,
  allPlayerWeeklyEligibilityEvidence, allPlayerMissingRowEvidence,
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

describe('explicit product nonparticipation assumption', () => {
  const assumed = (basis: unknown) => ({ kind: 'assumed-nonparticipation',
    policy: 'missing-participation-as-zero-v1', source: 'product-policy',
    effectivePeriod: { season: 2026, seasonType: 'reg', week: 1 }, basis });
  const weekly = (fields: Record<string, unknown> = {}) => ({
    kind: 'weekly-stat', source: 'weekly-stat-provider', ...fields,
  });

  it.each([
    [weekly(), null], [weekly({ appearances: 0 }), null],
    [weekly({ individualSnaps: { off_snp: 0, st_snp: 0 } }), null],
    [weekly({ gmsActive: 1 }), 1], [weekly({ gmsActive: 1, individualSnaps: { off_snp: 0 } }), 1],
    [{ kind: 'missing-provider-row', inventoryFingerprint: `sha256:${'f'.repeat(64)}` }, null],
  ])('separates assumed appearance zero from eligibility in %j', (basis, eligible) => {
    const evidence = assumed(basis);
    expect(allPlayerEligibilityCounts(evidence)).toEqual({ eligibleGameCount: eligible, appearanceGameCount: 0 });
    expect(evidence.basis).toBe(basis);
    expect(evidence).not.toHaveProperty('observedAt');
  });

  it.each([
    weekly({ appearances: 1 }), weekly({ individualSnaps: { st_snp: 1 } }),
    weekly({ gmsActive: 0 }), weekly({ gmsActive: 1, appearances: 0 }),
    weekly({ gmsActive: 0, appearances: 1 }), weekly({ appearances: 0, individualSnaps: { off_snp: 1 } }),
    weekly({ rawFlags: { gp: '1' } }), weekly({ rawFlags: { st_snp: -1 } }),
    weekly({ gmsActive: 1, rawFlags: { gp: null } }),
    { ...periodEvidence, decision: 'ambiguous' }, { kind: 'unknown-weekly-stat', source: 'weekly-stat-provider' },
    { kind: 'missing-provider-row', inventoryFingerprint: 'invented' },
  ])('rejects hiding positive, known, malformed or contradictory evidence under an assumption: %j', (basis) => {
    expect(allPlayerEligibilityCounts(assumed(basis))).toBeNull();
  });

  it('preserves old unknown semantics and extracts unchanged bases for concordance', () => {
    const basis = weekly({ gmsActive: 1 });
    expect(allPlayerEligibilityCounts(basis)).toEqual({ eligibleGameCount: null, appearanceGameCount: null });
    expect(allPlayerWeeklyEligibilityEvidence(assumed(basis))).toBe(basis);
    const missing = { kind: 'missing-provider-row', inventoryFingerprint: `sha256:${'a'.repeat(64)}` };
    expect(allPlayerEligibilityCounts(missing)).toEqual({ eligibleGameCount: null, appearanceGameCount: null });
    expect(allPlayerMissingRowEvidence(assumed(missing))).toBe(missing);
    for (const malformed of [{ ...assumed(basis), policy: 'unreviewed' },
      { ...assumed(basis), source: 'weekly-stat-provider' },
      { ...assumed(basis), effectivePeriod: { season: 2026, seasonType: 'reg', week: 19 } },
      { ...assumed(basis), injury: 'Out' }, { ...assumed(basis), basis: null }]) {
      expect(allPlayerEligibilityCounts(malformed)).toBeNull();
    }
  });
});

describe('provider individual snap participation', () => {
  it.each([
    [undefined, undefined, 1, 1], [undefined, 0, null, null], [undefined, 1, 1, 1],
    [0, undefined, null, null], [0, 0, null, null], [0, 1, null, null],
    [1, undefined, 1, 1], [1, 0, null, null], [1, 1, 1, 1],
  ] as const)('combines positive individual snaps with active %s / gp %s as %s / %s',
    (active, appearances, eligible, count) => {
      for (const key of ALL_PLAYER_INDIVIDUAL_SNAP_KEYS) {
        expect(allPlayerEligibilityCounts({ kind: 'weekly-stat', source: 'weekly-stat-provider',
          ...(active === undefined ? {} : { gmsActive: active }),
          ...(appearances === undefined ? {} : { appearances }), individualSnaps: { [key]: 1 },
        })).toEqual({ eligibleGameCount: eligible, appearanceGameCount: count });
      }
    });

  it.each([
    [undefined, undefined, null, null], [undefined, 0, null, null], [undefined, 1, 1, 1],
    [0, undefined, 0, 0], [0, 0, 0, 0], [0, 1, null, null],
    [1, undefined, null, null], [1, 0, 1, 0], [1, 1, 1, 1],
  ] as const)('zero snaps do not invent absence with active %s / gp %s',
    (active, appearances, eligible, count) => {
      expect(allPlayerEligibilityCounts({ kind: 'weekly-stat', source: 'weekly-stat-provider',
        ...(active === undefined ? {} : { gmsActive: active }),
        ...(appearances === undefined ? {} : { appearances }),
        individualSnaps: { off_snp: 0, def_snp: 0, st_snp: 0 },
      })).toEqual({ eligibleGameCount: eligible, appearanceGameCount: count });
    });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, null, '1', true, [], {}, ''])(
    'retains malformed individual snaps %j as unknown even beside positive gp/snaps', (flag) => {
      for (const key of ALL_PLAYER_INDIVIDUAL_SNAP_KEYS) {
        expect(allPlayerEligibilityCounts({ kind: 'weekly-stat', source: 'weekly-stat-provider',
          appearances: 1, rawFlags: { [key]: flag },
        })).toEqual({ eligibleGameCount: null, appearanceGameCount: null });
      }
      expect(allPlayerEligibilityCounts({ kind: 'weekly-stat', source: 'weekly-stat-provider',
        individualSnaps: { off_snp: 3 }, rawFlags: { st_snp: flag },
      })).toEqual({ eligibleGameCount: null, appearanceGameCount: null });
    });

  it('rejects invalid snap evidence instead of accepting coerced or disguised valid counts', () => {
    for (const individualSnaps of [{}, { tm_off_snp: 60 }, { off_snp: -1 }, { st_snp: 0.5 },
      { def_snp: Number.MAX_SAFE_INTEGER + 1 }, { off_snp: '1' }, { off_snp: null }]) {
      expect(allPlayerEligibilityCounts({ kind: 'weekly-stat', source: 'weekly-stat-provider',
        individualSnaps })).toBeNull();
    }
    for (const rawFlags of [{ off_snp: 0 }, { off_snp: 1 }, { st_snp: Number.MAX_SAFE_INTEGER },
      { def_snp: undefined }, { off_snp: NaN }, { tm_off_snp: -1 }]) {
      expect(allPlayerEligibilityCounts({ kind: 'weekly-stat', source: 'weekly-stat-provider', rawFlags })).toBeNull();
    }
    expect(allPlayerEligibilityCounts({ kind: 'weekly-stat', source: 'weekly-stat-provider',
      individualSnaps: { off_snp: 1 }, rawFlags: { off_snp: '1' } })).toBeNull();
    expect(allPlayerEligibilityCounts({ kind: 'weekly-stat', source: 'weekly-stat-provider',
      appearances: 1, rawFlags: { gp: '1' } })).toBeNull();
    expect(allPlayerEligibilityCounts({ kind: 'weekly-stat', source: 'weekly-stat-provider',
      individualSnaps: { st_snp: Number.MAX_SAFE_INTEGER } })).toEqual({ eligibleGameCount: 1, appearanceGameCount: 1 });
  });

  it.each(['appearance', 'dressed-unused', 'ineligible'] as const)(
    'keeps positive-snap conflicts unknown under reviewed %s evidence', (decision) => {
      for (const negative of [{ appearances: 0 }, { gmsActive: 0 }]) {
        const weekly = { kind: 'weekly-stat' as const, source: 'weekly-stat-provider' as const,
          ...negative, individualSnaps: { st_snp: 1 } };
        expect(allPlayerEligibilityCounts({ ...periodEvidence, decision, weekly })).toEqual({
          eligibleGameCount: null, appearanceGameCount: null,
        });
        const ineligibility = { kind: 'explicit-ineligible', reason: 'inactive', source: 'manual-review',
          sourceRevision: 'review', observedAt: periodEvidence.observedAt, effectivePeriod: periodEvidence.effectivePeriod };
        expect(allPlayerEligibilityCounts({ kind: 'conflict', ineligibility, weekly })).toEqual({
          eligibleGameCount: null, appearanceGameCount: null,
        });
        expect(allPlayerEligibilityCounts({ kind: 'combined-ineligible', ineligibility, weekly })).toBeNull();
      }
    });
});
