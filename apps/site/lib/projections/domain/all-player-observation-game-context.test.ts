import { describe, expect, it } from 'vitest';
import { validateAllPlayerObservationEvidence, type AllPlayerStatObservation } from './all-player-observation-evidence';

const source: AllPlayerStatObservation = {
  provider: 'sleeper', season: 2026, seasonType: 'reg', week: 1,
  normalizerVersion: 'sleeper-weekly-stats-v4', sourceRevision: 'synthetic-context-contract',
  requestStartedAt: '2026-09-16T00:00:00.000Z', requestCompletedAt: '2026-09-16T00:00:00.000Z',
  observedAt: '2026-09-16T00:00:00.000Z', quality: 'partial', coverage: { complete: false }, warnings: [],
  entries: [{ entityKind: 'player', providerExternalId: 'participant', position: 'WR',
    nflTeam: null, nflGameId: null, gamePhase: 'unknown', eligibleGameCount: 1, appearanceGameCount: 1,
    stats: { gp: 1 }, eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', appearances: 1 } }],
};

describe('partial game context evidence boundary', () => {
  it('preserves observed participation with explicitly unknown context', () => {
    expect(validateAllPlayerObservationEvidence(source)).toEqual([]);
  });

  it.each(['live', 'final'] as const)('rejects an eligible player claiming %s without a canonical game', (gamePhase) => {
    expect(validateAllPlayerObservationEvidence({ ...source,
      entries: [{ ...source.entries[0], gamePhase }] }))
      .toContain('invalid-missing-game-context:participant');
  });

  it('requires a game for complete observations and canonical defenses', () => {
    expect(validateAllPlayerObservationEvidence({ ...source, quality: 'complete' }))
      .toContain('invalid-missing-game-context:participant');
    expect(validateAllPlayerObservationEvidence({ ...source,
      entries: [{ ...source.entries[0], entityKind: 'team_defense', position: 'DEF', nflTeam: 'CAR' }] }))
      .toContain('invalid-missing-game-context:participant');
  });

  it('rejects a supplied game without its team, even when eligibility is unknown', () => {
    expect(validateAllPlayerObservationEvidence({ ...source, entries: [{ ...source.entries[0],
      nflGameId: '11111111-1111-4111-8111-111111111111', stats: {}, eligibleGameCount: null,
      appearanceGameCount: null, eligibilityEvidence: { kind: 'unknown-weekly-stat', source: 'weekly-stat-provider' } }] }))
      .toContain('missing-game-team:participant');
  });
});
