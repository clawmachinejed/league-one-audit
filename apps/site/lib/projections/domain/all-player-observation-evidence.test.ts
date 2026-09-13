import { describe, expect, it } from 'vitest';
import {
  validateAllPlayerObservationEvidence, type AllPlayerStatEntry, type AllPlayerStatObservation,
} from './all-player-observation-evidence';

const entry: AllPlayerStatEntry = {
  entityKind: 'player', providerExternalId: 'player', nflGameId: null, nflTeam: 'NE', position: 'RB',
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
