import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { DatabaseRow } from '../../../database';
import type { AllPlayerBoxScoreReadInput } from '../../../matchup-box-score-types';
import { createProjectionStore } from '../../../projection-store';
import { createFakeProjectionDatabase } from '../../../projection-store-test-support';
import { createAllPlayerBoxScoreMethods } from './all-player-box-scores';
import { buildLiveBoxScoreEvidence } from '../../shared/live-box-score-evidence';

const observedAt = '2026-09-13T19:00:31.378Z';
const revision = 'b'.repeat(64);
const input: AllPlayerBoxScoreReadInput = {
  leagueKey: 'league1', season: 2026, week: 1,
  identities: [
    { entityKind: 'player', providerExternalId: '5859' },
    { entityKind: 'team_defense', providerExternalId: 'PHI' },
  ],
};

function row(overrides: DatabaseRow = {}): DatabaseRow {
  return { observed_at: observedAt, semantic_hash: revision,
    entity_kind: 'player', provider_external_id: '5859', game_phase: 'live',
    stats: { rec: 1, rec_yd: 8, rec_td: 0 }, ...overrides };
}

function reader(rows: readonly DatabaseRow[]) {
  const fake = createFakeProjectionDatabase(() => rows);
  const read = createAllPlayerBoxScoreMethods(fake.database).readAllPlayerBoxScores;
  return { fake, read };
}

function compactRow(at = '2026-09-13T19:01:31.378Z', overrides: DatabaseRow = {}): DatabaseRow {
  return { source_kind: 'compact', database_now_ms: Date.parse(at) + 1_000,
    evidence: buildLiveBoxScoreEvidence({
      period: { season: 2026, seasonType: 'regular', week: 1 }, sourceRevision: 'minute-capture',
      bodyHash: `sha256:${'d'.repeat(64)}`, observedAt: at, requestStartedAt: at, requestCompletedAt: at,
      entries: [
        { entityKind: 'player', providerExternalId: '5859', gamePhase: 'live', stats: { rec: 2, rec_yd: 15 } },
        { entityKind: 'player', providerExternalId: '11586', gamePhase: 'final', stats: { rush_att: 3, rush_yd: 19 } },
      ],
    }), ...overrides };
}

describe('stored weekly box-score reader', () => {
  it('reads one exact shared observation in one bulk query and retains zero/negative actual statistics', async () => {
    const { fake, read } = reader([
      row({ stats: { rec: 0, rush_yd: -2, pts_ppr: 100, pos_rank_ppr: 1, off_snp: 5 } }),
      row({ entity_kind: 'team_defense', provider_external_id: 'PHI',
        game_phase: 'final', stats: { sack: 3, pts_allow: 0, fan_pts_allow: 100 } }),
    ]);
    expect(await read(input)).toEqual({
      status: 'available', observedAt, revision,
      players: {
        'player:5859': { stats: { rec: 0, rush_yd: -2 }, gamePhase: 'live' },
        'defense:PHI': { stats: { sack: 3, pts_allow: 0 }, gamePhase: 'final' },
      },
    });
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call.parameters.slice(0, 2)).toEqual([2026, 1]);
    expect(JSON.parse(String(call.parameters[2]))).toEqual([
      { entity_kind: 'team_defense', provider_external_id: 'PHI' },
      { entity_kind: 'player', provider_external_id: '5859' },
    ]);
    expect(call.statement).toContain("observation.provider = 'sleeper'");
    expect(call.statement).toContain("observation.season_type = 'reg'");
    expect(call.statement).toContain("observation.quality IN ('complete', 'partial')");
    expect(call.statement).toContain('content.quality = observation.quality');
    expect(call.statement).toContain('observation.request_completed_at DESC');
    expect(call.statement).toContain('LIMIT 1');
    expect(call.statement).not.toMatch(/current_all_player_score_sets|external_scoring_entity_ids/u);
  });

  it('keeps accepted partial source data independent of eligibility and score publication', async () => {
    const { read } = reader([row({ stats: { rec: 1, rec_yd: 6 },
      eligible_game_count: null, appearance_game_count: null,
      eligibility_evidence: { kind: 'weekly-stat' }, quality: 'partial' })]);
    expect(await read(input)).toMatchObject({
      status: 'available', observedAt, players: { 'player:5859': { stats: { rec: 1, rec_yd: 6 } } },
    });
  });

  it('selects a newer compact league capture as a whole and filters to accepted roster identities', async () => {
    const compact = compactRow();
    const { read, fake } = reader([compact, row(), row({ entity_kind: 'team_defense', provider_external_id: 'PHI',
      game_phase: 'final', stats: { sack: 3 } })]);
    expect(await read(input)).toEqual({ status: 'available',
      observedAt: '2026-09-13T19:01:31.378Z', revision: (compact.evidence as { revision: string }).revision,
      players: { 'player:5859': { stats: { rec: 2, rec_yd: 15 }, gamePhase: 'live' } } });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].parameters[4]).toBe('league1');
    expect(fake.calls[0].statement).toContain('league.league_key = $5::text');
    expect(fake.calls[0].statement).toContain("observation.source_data ->> 'leagueKey' = $5::text");
    expect(fake.calls[0].statement).toContain('observation.league_season_id = season.id');
  });

  it('supports Dynasty without defenses and keeps reported final bench stats from the same capture', async () => {
    const compact = compactRow();
    const result = await reader([compact]).read({ ...input, leagueKey: 'dynasty', identities: [
      { entityKind: 'player', providerExternalId: '11586' },
    ] });
    expect(result.players).toEqual({ 'player:11586': { stats: { rush_att: 3, rush_yd: 19 }, gamePhase: 'final' } });
  });

  it('prefers newer or equal-time hourly history and does not relabel an old compact source as fresh', async () => {
    for (const time of [observedAt, '2026-09-13T18:59:00.000Z']) {
      expect(await reader([compactRow(time), row()]).read(input)).toMatchObject({ observedAt, revision,
        players: { 'player:5859': { stats: { rec: 1, rec_yd: 8, rec_td: 0 } } } });
    }
    expect(await reader([compactRow()]).read(input)).toMatchObject({ observedAt: '2026-09-13T19:01:31.378Z' });
  });

  it.each(['hash', 'period', 'future', 'oversize'])('falls back to hourly data for invalid compact %s evidence', async (mode) => {
    let compact = compactRow();
    const evidence = compact.evidence as Record<string, unknown>;
    if (mode === 'hash') evidence.revision = 'f'.repeat(64);
    if (mode === 'period') evidence.period = { season: 2026, seasonType: 'regular', week: 2 };
    if (mode === 'future') compact = { ...compact, database_now_ms: Date.parse('2026-09-13T19:00:00.000Z') };
    if (mode === 'oversize') evidence.sourceRevision = 'a'.repeat(300_000);
    expect(await reader([compact, row()]).read(input)).toMatchObject({ observedAt, revision });
    expect(await reader([compact]).read(input)).toEqual({ status: 'unavailable', observedAt: null, revision: null, players: {} });
  });

  it.each([{}, { pos_rank_ppr: 1, gp: 0 }])('does not invent a box score from an empty/rank-only row (%j)', async (stats) => {
    const { read } = reader([row({ stats })]);
    expect(await read(input)).toEqual({ status: 'available', observedAt, revision, players: {} });
  });

  it('distinguishes no capture from a capture missing all requested identities', async () => {
    expect(await reader([]).read(input)).toEqual({
      status: 'unavailable', observedAt: null, revision: null, players: {},
    });
    expect(await reader([row({ entity_kind: null, provider_external_id: null,
      game_phase: null, stats: {} })]).read(input)).toEqual({
      status: 'available', observedAt, revision, players: {},
    });
  });

  it('deduplicates identical requested identities and uses exact historical period parameters', async () => {
    const { fake, read } = reader([row()]);
    await read({ ...input, season: 2025, week: 17,
      identities: [...input.identities, input.identities[0]] });
    expect(fake.calls[0].parameters.slice(0, 2)).toEqual([2025, 17]);
    expect(JSON.parse(String(fake.calls[0].parameters[2]))).toHaveLength(2);
  });

  it('filters nonfinite, nonnumeric, unknown and prototype-like stat keys', async () => {
    const stats = JSON.parse('{"rec":0,"private":99,"__proto__":99,"pass_td":"2"}');
    stats.rush_yd = Number.POSITIVE_INFINITY;
    stats.rec_yd = Number.NaN;
    expect(await reader([row({ stats })]).read(input)).toMatchObject({
      players: { 'player:5859': { stats: { rec: 0 } } },
    });
  });

  it.each([
    { provider_external_id: '99999' },
    { entity_kind: 'team_defense', provider_external_id: '5859' },
    { semantic_hash: 'invalid' },
    { observed_at: 'not a date' },
    { game_phase: 'scheduled' },
  ])('rejects malformed source metadata or an unexpected identity (%j)', async (change) => {
    await expect(reader([row(change)]).read(input)).rejects.toThrow();
  });

  it('rejects duplicate returned identities and mixed observation metadata', async () => {
    await expect(reader([row(), row()]).read(input)).rejects.toThrow('identities disagree');
    await expect(reader([row(), row({ observed_at: '2026-09-13T20:00:00Z' })]).read(input))
      .rejects.toThrow('sources disagree');
  });

  it.each([
    { leagueKey: '' }, { leagueKey: '__proto__' },
    { season: 1919 }, { week: 0 }, { week: 19 },
    { identities: [{ entityKind: 'player', providerExternalId: 'bad-id' }] },
    { identities: [{ entityKind: 'player', providerExternalId: '0' }] },
    { identities: [{ entityKind: 'player', providerExternalId: '05859' }] },
    { identities: [{ entityKind: 'player', providerExternalId: 5859 }] },
    { identities: [{ entityKind: 'team_defense', providerExternalId: 'JAC' }] },
    { identities: Array.from({ length: 513 }, () => input.identities[0]) },
  ])('rejects invalid input before any SQL (%j)', async (change) => {
    const { fake, read } = reader([]);
    await expect(read({ ...input, ...change } as AllPlayerBoxScoreReadInput)).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });

  it('keeps empty inventory and disabled stores silent without inspecting disabled inputs', async () => {
    const { fake, read } = reader([]);
    expect(await read({ ...input, identities: [] })).toMatchObject({ status: 'unavailable' });
    expect(fake.calls).toHaveLength(0);
    const disabled = createProjectionStore({ enabled: false, reason: 'missing-database-url' });
    await expect(disabled.readAllPlayerBoxScores!(undefined as never)).resolves.toEqual({
      status: 'unavailable', observedAt: null, revision: null, players: {},
    });
  });
});
