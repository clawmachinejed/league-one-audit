import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../database';
import type { StoredAllPlayerBoxScores } from '../matchup-box-score-types';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { readAcceptedExactMatchupsRows } from '../league-administration/neon/exact-matchups';
import { createAllPlayerBoxScoreMethods } from '../projections/adapters/neon/all-player-box-scores';
import { projectExactMatchups } from './exact-matchups';
import { readAcceptedExactMatchupBoxScores, type ExactMatchupBoxScoresInput } from './exact-matchup-box-scores';
import { b1CaptureEnvelope, b1CompatibilityFixture, b1CompatibilityInput, b1Mapping, b1Uuid } from './b1-acceptance.fixtures';

vi.mock('server-only', () => ({}));
type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
const revision = 'a'.repeat(64), at = '2026-09-28T12:00:00.000Z';
function fixture() {
  const row = b1CompatibilityFixture();
  const original = readAcceptedExactMatchupsRows(row.accepted_rows, b1Mapping, 4);
  if (original.status !== 'available') throw new Error('Bad fixture.');
  const normalized = normalizeAdministrationObservation({ ...b1CaptureEnvelope(row), payload: [
    { roster_id: 1, matchup_id: 4, players: ['101', '202', 'IND'], starters: ['101', '0'], players_points: { '101': 0 }, points: 1, custom_points: 0 },
    { roster_id: 2, matchup_id: 4, players: ['303'], starters: ['303'], points: 2 },
  ] }, { expectedRosterCount: 2 });
  const input = structuredClone({ accepted: { ...original, value: projectExactMatchups(normalized, original.value.teams) },
    mapping: b1Mapping, leagueKey: 'league1', context: b1CompatibilityInput.context }) as Mutable<ExactMatchupBoxScoresInput>;
  const stored: StoredAllPlayerBoxScores = { status: 'available', observedAt: at, revision, players: {
    'player:101': { stats: { pass_yd: 0, pass_td: 2 }, gamePhase: 'live' },
    'player:202': { stats: { rush_yd: 12 }, gamePhase: 'final' },
    'defense:IND': { stats: { pts_allow: 0, sack: 2 }, gamePhase: 'live' },
  } };
  return { input, stored, store: { readAllPlayerBoxScores: vi.fn(async () => stored) } };
}

describe('exact accepted box-score references', () => {
  it('uses one existing period read with independent player/defense identities, missing versus zero and original stat age', async () => {
    const { input, store } = fixture(); const before = structuredClone(input);
    const result = await readAcceptedExactMatchupBoxScores(input, store);
    expect(store.readAllPlayerBoxScores).toHaveBeenCalledExactlyOnceWith({ leagueKey: 'league1', season: 2026, week: 4,
      identities: [{ entityKind: 'team_defense', providerExternalId: 'IND' },
        { entityKind: 'player', providerExternalId: '101' }, { entityKind: 'player', providerExternalId: '202' },
        { entityKind: 'player', providerExternalId: '303' }] });
    expect(result).toMatchObject({ status: 'available', reference: { season: 2026, week: 4, revision, observedAt: at }, coverage: { status: 'partial' } });
    if (result.status !== 'available') throw new Error('Missing result.');
    expect(result.players.find(player => player.sourceEntity.nativeId === '101')).toMatchObject({ status: 'available', stats: { pass_yd: 0, pass_td: 2 } });
    expect(result.players.find(player => player.sourceEntity.nativeId === 'IND')).toMatchObject({ entityKind: 'team_defense', stats: { pts_allow: 0 } });
    expect(result.players.find(player => player.sourceEntity.nativeId === '303')).toMatchObject({ status: 'missing', stats: null });
    expect(result.players.find(player => player.sourceEntity.nativeId === '101')!.stats).not.toHaveProperty('pass_int');
    expect(input).toEqual(before);
  });

  it('composes the actual all-player adapter with the existing exact SQL period and identity filters', async () => {
    const { input } = fixture();
    const query = vi.fn(async () => [{ source_kind: 'hourly', observed_at: at, semantic_hash: revision,
      entity_kind: 'player', provider_external_id: '101', game_phase: 'live', stats: { pass_yd: 0, fantasy_points: 999 } }]);
    const result = await readAcceptedExactMatchupBoxScores(input, createAllPlayerBoxScoreMethods({ query } as unknown as DatabaseClient));
    expect(query).toHaveBeenCalledOnce();
    const call = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(call[0]).toContain('observation.season = $1::smallint');
    expect(call[0]).toContain("observation.season_type = 'reg' AND observation.week = $2::smallint");
    expect(call[1].slice(0, 2)).toEqual([2026, 4]); expect(call[1][4]).toBe('league1');
    expect(result).toMatchObject({ status: 'available', players: expect.arrayContaining([
      expect.objectContaining({ sourceEntity: expect.objectContaining({ nativeId: '101' }), stats: { pass_yd: 0 } }),
    ]) });
  });

  it.each(['future', 'wrong native week', 'wrong season', 'wrong league', 'wrong mapping', 'unmapped', 'wrong nfl week', 'wrong context'] as const)(
    'does not access statistics for %s evidence', async kind => {
      const { input, store } = fixture(); if (input.accepted.status !== 'available') throw new Error('Bad fixture.');
      if (kind === 'future') { input.context.activeWeek = 3; input.context.temporalState = 'future'; }
      if (kind === 'wrong native week') input.accepted.value.period.nativeWeek = 5;
      if (kind === 'wrong season') input.mapping.scope.season = 2027;
      if (kind === 'wrong league') input.leagueKey = 'league2';
      if (kind === 'wrong mapping') input.mapping.revisionId = b1Uuid(999);
      if (kind === 'unmapped') input.accepted.periodMapping = { status: 'unmapped', reason: 'calendar_evidence_missing' };
      if (kind === 'wrong nfl week' && input.accepted.periodMapping.status === 'mapped') input.accepted.periodMapping.week = 5;
      if (kind === 'wrong context') input.context.temporalState = 'past';
      expect((await readAcceptedExactMatchupBoxScores(input, store)).status).toBe('unavailable');
      expect(store.readAllPlayerBoxScores).not.toHaveBeenCalled();
    });

  it.each(['wrong player', 'wrong defense kind', 'bad revision', 'bad date', 'nonfinite stat', 'bad phase'] as const)(
    'rejects %s without changing official facts', async kind => {
      const { input, store, stored } = fixture(); const before = structuredClone(input.accepted);
      if (kind === 'wrong player') stored.players['player:999'] = { stats: { pass_yd: 1 }, gamePhase: 'live' };
      if (kind === 'wrong defense kind') stored.players['player:IND'] = { stats: { pts_allow: 0 }, gamePhase: 'live' };
      if (kind === 'bad revision') stored.revision = 'unverified';
      if (kind === 'bad date') stored.observedAt = 'yesterday';
      if (kind === 'nonfinite stat') stored.players['player:101'].stats.pass_yd = Number.NaN;
      if (kind === 'bad phase') stored.players['player:101'].gamePhase = 'future';
      expect((await readAcceptedExactMatchupBoxScores(input, store)).status).toBe('unavailable');
      expect(input.accepted).toEqual(before);
    });

  it('preserves empty/missing inventory distinctions and partial inventory known identities', async () => {
    const { input, store, stored } = fixture(); if (input.accepted.status !== 'available') throw new Error('Bad fixture.');
    input.accepted.value.teams[0].players = null;
    delete stored.players['player:202']; delete stored.players['defense:IND'];
    const partial = await readAcceptedExactMatchupBoxScores(input, store);
    expect(partial).toMatchObject({ status: 'available', coverage: { status: 'partial', reasons: expect.arrayContaining([
      `player_inventory_missing:${b1Uuid(19)}`,
    ]) } });
    for (const team of input.accepted.value.teams) { team.players = []; team.starters = []; }
    expect(await readAcceptedExactMatchupBoxScores(input, store)).toMatchObject({ status: 'unavailable', reason: 'player_inventory_empty' });
    input.accepted.value.teams[0].players = null;
    expect(await readAcceptedExactMatchupBoxScores(input, store)).toMatchObject({ status: 'unavailable', reason: 'player_inventory_missing' });
  });

  it('preserves late corrections independently from immutable matchup/forecast revisions and repeats deterministically', async () => {
    const { input, store, stored } = fixture(); const official = structuredClone(input.accepted);
    const first = await readAcceptedExactMatchupBoxScores(input, store);
    stored.revision = 'b'.repeat(64); stored.observedAt = '2026-09-29T11:00:00.000Z'; stored.players['player:101'].stats.pass_yd = 7;
    const corrected = await readAcceptedExactMatchupBoxScores(input, store);
    expect(first).toMatchObject({ reference: { revision, observedAt: at } });
    expect(corrected).toMatchObject({ reference: { revision: 'b'.repeat(64), observedAt: stored.observedAt },
      players: expect.arrayContaining([expect.objectContaining({ stats: { pass_yd: 7, pass_td: 2 } })]) });
    expect(input.accepted).toEqual(official);
    expect(await readAcceptedExactMatchupBoxScores(input, store)).toEqual(corrected);
  });

  it.each(['unavailable', 'failure', 'empty statistics'] as const)('keeps %s distinct from observed zero', async kind => {
    const { input, stored, store } = fixture();
    if (kind === 'unavailable') store.readAllPlayerBoxScores.mockResolvedValue({ status: 'unavailable', observedAt: null, revision: null, players: {} });
    if (kind === 'failure') store.readAllPlayerBoxScores.mockRejectedValue(new Error('Source unavailable.'));
    if (kind === 'empty statistics') stored.players = { 'player:101': { stats: {}, gamePhase: null } };
    const result = await readAcceptedExactMatchupBoxScores(input, store);
    expect(result.status).toBe(kind === 'empty statistics' ? 'available' : 'unavailable');
    if (result.status === 'available') expect(result.players.every(player => player.stats === null && player.status === 'missing')).toBe(true);
  });
});
