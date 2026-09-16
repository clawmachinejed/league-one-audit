import { describe, expect, it } from 'vitest';
import {
  validateAllPlayerObservationEvidence, type AllPlayerStatEntry, type AllPlayerStatObservation,
} from './all-player-observation-evidence';
import type { AllPlayerAssumedNonParticipationEvidence } from './all-player-eligibility';

const entry: AllPlayerStatEntry = {
  // These tests vary participation evidence within an already mapped final game.
  // Missing game context has its own partial/unknown and strict rejection tests.
  entityKind: 'player', providerExternalId: 'player',
  nflGameId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nflTeam: 'NE', position: 'RB',
  gamePhase: 'final', stats: { st_snp: 1 }, eligibleGameCount: 1, appearanceGameCount: 1,
  eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', individualSnaps: { st_snp: 1 } },
};
function observation(candidate: AllPlayerStatEntry, version = 'fixture-weekly-stats-v3'): AllPlayerStatObservation {
  return {
    provider: 'fixture', season: 2026, seasonType: 'reg', week: 1, normalizerVersion: version,
    sourceRevision: 'retained-week', requestStartedAt: '2026-09-15T00:00:00.000Z',
    requestCompletedAt: '2026-09-15T00:00:00.000Z', observedAt: '2026-09-15T00:00:00.000Z',
    quality: 'partial', coverage: {}, warnings: [], entries: [candidate],
  };
}

describe('individual snap raw/evidence preflight concordance', () => {
  it('accepts positive snaps without manufacturing a raw gp flag', () => {
    expect(validateAllPlayerObservationEvidence(observation(entry))).toEqual([]);
    expect(entry.stats.gp).toBeUndefined();
    expect(entry.eligibilityEvidence).not.toHaveProperty('appearances');
  });

  it.each(['off_snp', 'def_snp', 'st_snp'] as const)('rejects omitted, invented and mismatched %s evidence', (key) => {
    const unknown: AllPlayerStatEntry = { ...entry, stats: { [key]: 1 },
      eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider' },
      eligibleGameCount: null, appearanceGameCount: null };
    expect(validateAllPlayerObservationEvidence(observation(unknown)))
      .toContain(`weekly-snap-evidence-mismatch:player:${key}`);
    expect(validateAllPlayerObservationEvidence(observation({ ...entry, stats: {},
      eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', individualSnaps: { [key]: 1 } } })))
      .toContain(`weekly-snap-evidence-mismatch:player:${key}`);
    expect(validateAllPlayerObservationEvidence(observation({ ...entry, stats: { [key]: 2 },
      eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', individualSnaps: { [key]: 1 } } })))
      .toContain(`weekly-snap-evidence-mismatch:player:${key}`);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1', null, false, [], {}])(
    'accepts faithful partial malformed snap %j and rejects inconsistent retained statistics', (flag) => {
      const candidate: AllPlayerStatEntry = { ...entry,
        stats: typeof flag === 'number' ? { off_snp: flag } : {},
        eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', rawFlags: { off_snp: flag } },
        eligibleGameCount: null, appearanceGameCount: null,
      };
      expect(validateAllPlayerObservationEvidence(observation(candidate))).toEqual([]);
      expect(validateAllPlayerObservationEvidence(observation({ ...candidate, stats: { off_snp: 1 } })))
        .toContain('weekly-snap-evidence-mismatch:player:off_snp');
    });

  it('preserves old histories without snap evidence while checking new fields regardless of version', () => {
    const prior: AllPlayerStatEntry = { ...entry, stats: { gms_active: 1, st_snp: 1 },
      eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1 },
      eligibleGameCount: null, appearanceGameCount: null };
    expect(validateAllPlayerObservationEvidence(observation(prior, 'fixture-weekly-stats-v2'))).toEqual([]);
    expect(validateAllPlayerObservationEvidence(observation(prior))).toContain('weekly-snap-evidence-mismatch:player:st_snp');
    expect(validateAllPlayerObservationEvidence(observation({ ...entry, stats: { st_snp: 2 } }, 'fixture-weekly-stats-v2')))
      .toContain('weekly-snap-evidence-mismatch:player:st_snp');
  });

  it('does not allow a provider row to hide participation under a missing-row or explicit-ineligible label', () => {
    const candidate: AllPlayerStatEntry = { ...entry, eligibleGameCount: null, appearanceGameCount: null,
      eligibilityEvidence: { kind: 'missing-provider-row', inventoryFingerprint: `sha256:${'a'.repeat(64)}` } };
    expect(validateAllPlayerObservationEvidence(observation(candidate))).toContain('missing-weekly-participation-evidence:player');
    expect(validateAllPlayerObservationEvidence(observation({ ...candidate,
      eligibleGameCount: 0, appearanceGameCount: 0,
      eligibilityEvidence: { kind: 'explicit-ineligible', reason: 'inactive', source: 'manual-review',
        sourceRevision: 'review', observedAt: '2026-09-15T00:00:00.000Z',
        effectivePeriod: { season: 2026, seasonType: 'reg', week: 1 } },
    }))).toContain('missing-weekly-participation-evidence:player');
  });

  it('rejects individual participation evidence on a canonical defense', () => {
    expect(validateAllPlayerObservationEvidence(observation({ ...entry, entityKind: 'team_defense', position: 'DEF' })))
      .toContain('invalid-individual-snap-entity:player');
    expect(validateAllPlayerObservationEvidence(observation({ ...entry, entityKind: 'team_defense', position: 'DEF',
      stats: {}, eligibleGameCount: null, appearanceGameCount: null,
      eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', rawFlags: { off_snp: null } },
    }))).toContain('invalid-individual-snap-entity:player');
  });

  it('does not use team snaps or nonzero fantasy statistics as appearance proof', () => {
    const candidate: AllPlayerStatEntry = { ...entry, stats: { tm_off_snp: 60, tm_st_snp: 20, rush_yd: 5, pts_half_ppr: 0.5 },
      eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider' },
      eligibleGameCount: null, appearanceGameCount: null };
    expect(validateAllPlayerObservationEvidence(observation(candidate))).toEqual([]);
    expect(validateAllPlayerObservationEvidence(observation({ ...candidate, eligibleGameCount: 1, appearanceGameCount: 1 })))
      .toContain('invalid-eligibility-evidence:player');
  });
});

describe('assumed nonparticipation observation boundary', () => {
  const missingBasis = { kind: 'missing-provider-row' as const, inventoryFingerprint: `sha256:${'a'.repeat(64)}` };
  function assumedEntry(basis: AllPlayerAssumedNonParticipationEvidence['basis'] = missingBasis): AllPlayerStatEntry {
    return { ...entry, stats: {}, eligibleGameCount: null, appearanceGameCount: 0,
      eligibilityEvidence: { kind: 'assumed-nonparticipation', policy: 'missing-participation-as-zero-v1',
        source: 'product-policy', effectivePeriod: { season: 2026, seasonType: 'reg', week: 1 }, basis } };
  }
  const v4 = (candidate = assumedEntry()) => observation(candidate, 'fixture-weekly-stats-v4');

  it('accepts unknown eligibility and assumed zero appearances only with explicit v4 provenance', () => {
    expect(validateAllPlayerObservationEvidence(v4())).toEqual([]);
    for (const version of ['fixture-weekly-stats-v2', 'fixture-weekly-stats-v3', 'fixture-weekly-stats-v5']) {
      expect(validateAllPlayerObservationEvidence(observation(assumedEntry(), version)))
        .toContain('invalid-assumption-context:player');
    }
    const active = { ...assumedEntry({ kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1 }),
      stats: { gms_active: 1 }, eligibleGameCount: 1 as const };
    expect(validateAllPlayerObservationEvidence(v4(active))).toEqual([]);
  });

  it.each([{ gp: 1 }, { off_snp: 1 }, { pass_yd: 5 }, { pts_half_ppr: 0 }] as readonly Record<string, number>[])(
    'rejects populated statistics hidden under an assumed missing row: %j', (stats) => {
      expect(validateAllPlayerObservationEvidence(v4({ ...assumedEntry(), stats })))
        .toContain('assumed-missing-row-has-statistics:player');
    });

  it('binds wrapped weekly raw evidence and disallows hiding positive or malformed snap statistics', () => {
    const active = { ...assumedEntry({ kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1 }),
      stats: { gms_active: 1 }, eligibleGameCount: 1 as const };
    expect(validateAllPlayerObservationEvidence(v4({ ...active, stats: { ...active.stats, gp: 1 } })))
      .toContain('weekly-flag-evidence-mismatch:player:gp');
    for (const off_snp of [1, -1, 0.5]) {
      expect(validateAllPlayerObservationEvidence(v4({ ...active, stats: { ...active.stats, off_snp } })))
        .toContain('weekly-snap-evidence-mismatch:player:off_snp');
    }
  });

  it('rejects defense and wrong-period assumptions without reinterpreting old observations', () => {
    expect(validateAllPlayerObservationEvidence(v4({ ...assumedEntry(), entityKind: 'team_defense', position: 'DEF' })))
      .toContain('invalid-assumption-context:player');
    expect(validateAllPlayerObservationEvidence({ ...v4(), week: 2 })).toContain('wrong-period-assumption:player');
    const legacy = { ...assumedEntry(), eligibilityEvidence: missingBasis, appearanceGameCount: null };
    expect(validateAllPlayerObservationEvidence(observation(legacy, 'fixture-weekly-stats-v3'))).toEqual([]);
    expect(validateAllPlayerObservationEvidence(v4(legacy))).toEqual([]);
  });
});
