import { describe, expect, it } from 'vitest';
import { gameState, gameStates, matchupData, PERIOD, player, source } from '../../live-projection-worker.fixtures';
import { SLEEPER_LIVE_DEFENSE_MAPPING } from '../adapters/sleeper/scoring-profile';
import type { LiveDefenseStatResult } from '../ports/live-defense-stat-source';
import { externalPlayerRef, providerKey } from '../shared/provider-identity';
import { liveBoxScoresForLeague } from './live-box-scores';

function fixture() {
  const data = matchupData();
  data.matchups[0].sides[0].starters[1] = player('11586', 'Blake Corum', 'RB', 'LAC', 1.9);
  const league = source('l1', data);
  const first = league.matchups[0].sides[0];
  const slot = first.starters[1];
  if (slot.kind !== 'occupied') throw new Error('Fixture must contain Corum.');
  Object.assign(first, { bench: [{ ...slot, slot: 'BN', entity: { ...slot.entity,
    externalRef: externalPlayerRef(providerKey('sleeper'), '12048'), displayName: 'Bench Player' } }] });
  const stats: Extract<LiveDefenseStatResult, { status: 'available' }> = {
    status: 'available', mapping: SLEEPER_LIVE_DEFENSE_MAPPING, capture: {
      period: PERIOD, requestStartedAt: '2026-09-13T18:00:02.000Z',
      requestCompletedAt: '2026-09-13T18:00:03.000Z', observedAt: '2026-09-13T18:00:03.000Z',
      sourceRevision: 'sha256:' + 'a'.repeat(64), bodyHash: 'sha256:' + 'b'.repeat(64), entries: [],
      boxScoreRows: { 'player:11586': { rush_att: 3, rush_yd: 19 },
        'player:12048': { rush_att: 0, rush_yd: 0 }, 'player:99999': { rush_yd: 500 } },
    },
  };
  return { league, stats };
}

describe('compact league live box-score evidence', () => {
  it('keeps only rostered official starters and bench rows, with original provenance and real zero', () => {
    const { league, stats } = fixture();
    const result = liveBoxScoresForLeague(league, gameStates(), stats);
    expect(result).toMatchObject({ period: PERIOD, observedAt: stats.capture.observedAt,
      bodyHash: stats.capture.bodyHash, entries: expect.arrayContaining([
        { entityKind: 'player', providerExternalId: '11586', gamePhase: 'live', stats: { rush_att: 3, rush_yd: 19 } },
        { entityKind: 'player', providerExternalId: '12048', gamePhase: 'live', stats: { rush_att: 0, rush_yd: 0 } },
      ]) });
    expect(result?.entries).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('99999');
  });

  it('retains reported final records and omits scheduled records instead of inventing participation', () => {
    const { league, stats } = fixture();
    const final = gameStates({ ...gameState(), statusCode: 2, phase: 'final', remainingFraction: 0 });
    expect(liveBoxScoresForLeague(league, final, stats)?.entries.every(entry => entry.gamePhase === 'final')).toBe(true);
    const pregame = gameStates({ ...gameState(), statusCode: 0, phase: 'pregame', remainingFraction: 1 });
    expect(liveBoxScoresForLeague(league, pregame, stats)?.entries ?? []).toHaveLength(0);
  });

  it('does not turn missing rows into zeros or reuse defensive evidence as a new offensive capture', () => {
    const { league, stats } = fixture();
    expect(liveBoxScoresForLeague(league, gameStates(), { ...stats, capture: { ...stats.capture,
      boxScoreRows: { 'player:11586': { rush_att: 3, rush_yd: 19 } } } })?.entries).toHaveLength(1);
    expect(liveBoxScoresForLeague(league, gameStates(), { ...stats, capture: { ...stats.capture,
      bodyHash: undefined } })).toBeNull();
    expect(liveBoxScoresForLeague(league, gameStates(), undefined)).toBeNull();
  });

  it('rejects wrong periods and stale or malformed detail without vetoing score publication', () => {
    const { league, stats } = fixture();
    expect(liveBoxScoresForLeague(league, gameStates(), { ...stats, capture: { ...stats.capture,
      period: { ...PERIOD, week: 2 } } })).toBeNull();
    expect(liveBoxScoresForLeague(league, gameStates(), { ...stats, capture: { ...stats.capture,
      requestStartedAt: '2026-09-13T17:58:00.000Z' } })).toBeNull();
    expect(liveBoxScoresForLeague(league, gameStates(), { ...stats, capture: { ...stats.capture,
      boxScoreRows: { 'player:11586': { rush_yd: Infinity } } } })).toBeNull();
  });
});
