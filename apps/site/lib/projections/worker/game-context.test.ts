import { describe, expect, it } from 'vitest';
import type { GameStateObservation, GameStateSlate, ScoringEntity } from '../domain/contracts';
import { externalGameRef, externalPlayerRef, providerKey } from '../shared/provider-identity';
import {
  applicableSourceSkewSeconds,
  MAX_SOURCE_SKEW_MS,
  stateForEntity,
} from './game-context';

const provider = providerKey('game-source');

function game(requestCompletedAt: string): GameStateObservation {
  return {
    gameRef: externalGameRef(provider, 'game-1'),
    period: { season: 2026, seasonType: 'regular', week: 1 },
    homeTeam: 'PHI',
    awayTeam: 'DAL',
    statusCode: 0,
    statusText: 'Scheduled',
    sourcePeriod: null,
    gameClock: null,
    phase: 'pregame',
    clockSeconds: null,
    remainingFraction: 1,
    homeScore: null,
    awayScore: null,
    requestStartedAt: requestCompletedAt,
    requestCompletedAt,
    observedAt: requestCompletedAt,
    sourceRevision: 'game-revision',
  };
}

describe('applicable projection source skew', () => {
  it('includes the league observation, relevant game observations, and calculation time', () => {
    const earliest = '2026-09-01T12:00:00.000Z';
    const latest = new Date(Date.parse(earliest) + MAX_SOURCE_SKEW_MS).toISOString();

    expect(applicableSourceSkewSeconds(earliest, [game(latest)], latest)).toBe(90);
    expect(applicableSourceSkewSeconds(earliest, [], latest)).toBe(90);
  });

  it('does not invent a measurement from an invalid timestamp', () => {
    expect(applicableSourceSkewSeconds('invalid', [game('2026-09-01T12:00:00.000Z')],
      '2026-09-01T12:00:00.000Z')).toBeNull();
  });

  it('never assigns provider game data to a team the official schedule marks on bye', () => {
    const observation = game('2026-09-01T12:00:00.000Z');
    const games: GameStateSlate = {
      source: provider,
      period: observation.period,
      requestStartedAt: observation.requestStartedAt,
      requestCompletedAt: observation.requestCompletedAt,
      observedAt: observation.observedAt,
      games: [observation],
    };
    const entity: ScoringEntity = {
      kind: 'player',
      externalRef: externalPlayerRef(providerKey('official-source'), 'player-1'),
      displayName: 'Bye Player',
      nflTeam: 'PHI',
      position: 'WR',
      injuryStatus: null,
    };

    expect(stateForEntity(entity, games, { PHI: { kind: 'bye' } })).toBeNull();
    expect(stateForEntity(entity, games, {
      PHI: {
        kind: 'scheduled',
        opponent: 'DAL',
        location: 'home',
        date: '2026-09-01',
        kickoffAt: '2026-09-01T12:00:00.000Z',
      },
    })).toBe(observation);
  });
});
