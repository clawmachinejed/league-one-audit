import { beforeEach, describe, expect, it, vi } from 'vitest';

const scoreProjectionMock = vi.hoisted(() => vi.fn());

vi.mock('../domain/scoring', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/scoring')>();
  scoreProjectionMock.mockImplementation(actual.scoreProjection);
  return { ...actual, scoreProjection: scoreProjectionMock };
});

import { normalizeSleeperScoringProfile } from '../adapters/sleeper/scoring-profile';
import type {
  ProjectionObservation,
  ProjectionSlate,
  SourceScoringSettings,
} from '../domain/contracts';
import {
  externalPlayerRef,
  externalTeamDefenseRef,
  providerKey,
} from '../shared/provider-identity';
import { createProviderGroupScoringCache } from './scoring-cache';

const officialProvider = providerKey('official-source');
const projectionProvider = providerKey('projection-source');
const period = { season: 2026, seasonType: 'regular', week: 1 } as const;

const playerProjection: ProjectionObservation = {
  identity: {
    primary: externalPlayerRef(projectionProvider, 'player-1'),
    aliases: [externalPlayerRef(officialProvider, 'player-1')],
  },
  nflTeam: 'PHI',
  position: 'WR',
  stats: { rawReceivingYards: '50.0' },
  scoringStats: { kind: 'offense', receivingYards: 50 },
  missingFields: [],
};

const defenseProjection: ProjectionObservation = {
  identity: {
    primary: externalTeamDefenseRef(projectionProvider, 'BUF'),
    aliases: [],
  },
  nflTeam: 'BUF',
  position: 'DEF',
  stats: { rawSacks: '3.0' },
  scoringStats: { kind: 'defense', sacks: 3 },
  missingFields: [],
};

const slate: ProjectionSlate = {
  source: projectionProvider,
  period,
  quality: 'complete',
  requestStartedAt: '2026-09-13T15:59:59.000Z',
  requestCompletedAt: '2026-09-13T16:00:00.000Z',
  observedAt: '2026-09-13T16:00:00.000Z',
  sourceRevision: 'projection-revision',
  projections: [playerProjection, defenseProjection],
  coverage: {
    crosswalkRows: 2,
    crosswalkEntries: 2,
    malformedCrosswalkRows: 0,
    ambiguousCrosswalkRows: 0,
    playerRows: 1,
    matchedPlayers: 1,
    unmatchedPlayers: 0,
    malformedPlayers: 0,
    incompletePlayers: 0,
    defenseRows: 1,
    usableDefenses: 1,
    malformedDefenses: 0,
    incompleteDefenses: 0,
  },
  warnings: [],
};

function settings(rawRules: Readonly<Record<string, number>>): SourceScoringSettings {
  return { provider: officialProvider, rawRules };
}

beforeEach(() => {
  scoreProjectionMock.mockClear();
});

describe('provider-group scoring cache', () => {
  it('scores the full trusted slate once for the same raw profile hash', () => {
    const cache = createProviderGroupScoringCache(slate, normalizeSleeperScoringProfile);

    const first = cache.resolve(settings({ rec_yd: 0.1, sack: 1 }));
    const reordered = cache.resolve(settings({ sack: 1, rec_yd: 0.1 }));

    expect(first.status).toBe('available');
    expect(reordered.status).toBe('available');
    if (first.status !== 'available' || reordered.status !== 'available') return;
    expect(reordered.profileHash).toBe(first.profileHash);
    expect(reordered.scores).toBe(first.scores);
    expect([...first.scores.values()].map((score) => score.points)).toEqual([5, 3]);
    expect(scoreProjectionMock).toHaveBeenCalledTimes(slate.projections.length);
    expect(scoreProjectionMock.mock.calls.map(([projection]) => projection)).toEqual([
      playerProjection.scoringStats,
      defenseProjection.scoringStats,
    ]);
  });

  it('scores the full slate separately for different raw profile hashes', () => {
    const cache = createProviderGroupScoringCache(slate, normalizeSleeperScoringProfile);

    const supported = cache.resolve(settings({ rec_yd: 0.1, sack: 1 }));
    const unsupportedDifference = cache.resolve(settings({
      rec_yd: 0.1,
      sack: 1,
      unsupported_bonus: 2,
    }));

    expect(supported.status).toBe('available');
    expect(unsupportedDifference.status).toBe('available');
    if (supported.status !== 'available' || unsupportedDifference.status !== 'available') return;
    expect(unsupportedDifference.profile.rules).toEqual(supported.profile.rules);
    expect(unsupportedDifference.profileHash).not.toBe(supported.profileHash);
    expect(unsupportedDifference.scores).not.toBe(supported.scores);
    expect([...unsupportedDifference.scores.values()].map((score) => score.points))
      .toEqual([...supported.scores.values()].map((score) => score.points));
    expect(scoreProjectionMock).toHaveBeenCalledTimes(slate.projections.length * 2);
  });

  it('does not score an untrusted partial slate', () => {
    const cache = createProviderGroupScoringCache(
      { ...slate, quality: 'partial' },
      normalizeSleeperScoringProfile,
    );

    const result = cache.resolve(settings({ rec_yd: 0.1, sack: 1 }));

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.scores.size).toBe(0);
    expect(scoreProjectionMock).not.toHaveBeenCalled();
  });
});
