import { afterEach, describe, expect, it, vi } from 'vitest';
import { retainedMatchupFixture, retainedMatchupId as id, retainedMatchupSelection } from '../aggregator/retained-matchups.fixtures';
import type { AdministrationSourceMapping } from './source-mapping';
import { composeOfficialResults } from '../aggregator/official-results';
import { readPublicSeasonHistory, validatePublicSeasonHistoryOptions, type PublicSeasonHistoryInput } from './public-season-history-reader';
import type { PublicIntakeReadOptions, PublicSeasonHistoryRetained } from './public-intake-contracts';
import type { RetainedMatchupManifest } from './retained-matchup-comparison';
import type { RetainedMatchupEvidence } from './retained-matchups-contracts';

vi.mock('server-only', () => ({}));
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const mapping: AdministrationSourceMapping = { connectionId: id(5), leagueSeasonId: retainedMatchupSelection.leagueSeasonId,
    revisionId: id(4), generation: 1, scope: retainedMatchupSelection.scope };
  const evidence = [10, 11, 12].map(observationNumber => retainedMatchupFixture({ observationNumber }));
  const reads = {
    readSourceMapping: vi.fn(async () => mapping),
    scanRetainedMatchups: vi.fn(async () => ({ status: 'available' as const, evidence })),
    readRetainedMatchups: vi.fn(async (_selection: unknown, ids: readonly string[]) => ({ status: 'available' as const,
      evidence: evidence.filter(item => ids.includes(item.observation.id)) })),
  };
  const input: PublicSeasonHistoryInput = { requestId: id(20),
    candidates: [{ external_league_id: mapping.scope.externalLeagueId, league_season_id: mapping.leagueSeasonId, season: 2026, stage: 'complete' }],
    selection: [{ season: 2026, nativeWeek: 3 }], periods: [], bracketsRequested: false,
    officialResults: [{ externalLeagueId: mapping.scope.externalLeagueId, season: 2026,
      resource: composeOfficialResults({ mapping, standings: { status: 'unavailable', reason: 'not-captured' }, periods: [], brackets: [] }) }],
    retained: { selection: retainedMatchupSelection, batchSize: 1 } };
  return { mapping, reads, evidence, input };
}
async function retained(f: ReturnType<typeof fixture>, input = f.input) {
  const read = await readPublicSeasonHistory(f.reads, input);
  if (read.status !== 'available' || read.retainedHistory?.status !== 'available') throw new Error('Expected retained comparison.');
  return read.retainedHistory;
}

describe('bounded public season history orchestration', () => {
  it('uses one frozen manifest across pages, preserves clocks and keeps retained limitations separate from acceptance', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Provider reads prohibited.'); }));
    const f = fixture();
    const first = await retained(f);
    const second = await retained(f, { ...f.input, retained: { ...f.input.retained!,
      manifest: first.manifest, cursor: first.batch.cursor } });
    const third = await retained(f, { ...f.input, retained: { ...f.input.retained!,
      manifest: first.manifest, cursor: second.batch.cursor } });
    expect(f.reads.scanRetainedMatchups).toHaveBeenCalledTimes(1);
    expect(f.reads.readRetainedMatchups).toHaveBeenCalledTimes(3);
    expect([first, second, third].flatMap(page => page.batch.entries.map(entry => entry.observationId))).toEqual([id(10), id(11), id(12)]);
    expect(third.batch.status).toBe('complete');
    expect(third.coverage.readCoverage).toBe('page');
    expect(first.acceptance).toBe('not-typed-acceptance');
    expect(first.batch.entries[0].result).toMatchObject({ status: 'available', source: {
      sourceObservedAt: '2026-09-29T12:00:01.000123Z' },
      limitations: expect.arrayContaining(['mapping_revision_not_captured', 'v2_acceptance_not_qualified']) });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('exposes rejected observations even when the manifest cursor is exhausted', async () => {
    const f = fixture();
    f.evidence[1] = { ...f.evidence[1], content: null };
    const result = await retained(f, { ...f.input, retained: { ...f.input.retained!, batchSize: 3 } });
    expect(result.batch.status).toBe('complete');
    expect(result.coverage).toMatchObject({ inventoryCount: 3, selectedCount: 3, rejectedCount: 1 });
    expect(result.batch.entries[1].result).toEqual({ status: 'rejected', reason: 'retained_content_missing' });
    expect(result.batch.entries[2].result.status).toBe('available');
  });

  it.each(['identity', 'week'] as const)('rejects retained %s outside this request without scanning', async corruption => {
    const f = fixture();
    const selection = { ...retainedMatchupSelection,
      ...(corruption === 'identity' ? { leagueSeasonId: id(999) } : { nativeWeeks: [4] }) };
    const read = await readPublicSeasonHistory(f.reads, { ...f.input, retained: { selection } });
    expect(read).toMatchObject({ status: 'available', retainedHistory: { status: 'unavailable', reason: 'season-history-retained-request-scope-mismatch' } });
    expect(f.reads.scanRetainedMatchups).not.toHaveBeenCalled();
  });

  it('keeps old retained source lineage queryable while a remap makes typed source composition unavailable', async () => {
    const f = fixture();
    f.reads.readSourceMapping.mockResolvedValue({ ...f.mapping, leagueSeasonId: id(999), revisionId: id(998) });
    const result = await readPublicSeasonHistory(f.reads, f.input);
    expect(result).toMatchObject({ status: 'available', leagues: [{ resource: { status: 'unavailable', reason: 'season-history-source-mapping-unavailable' } }],
      retainedHistory: { status: 'available', acceptance: 'not-typed-acceptance' } });
  });

  it('fences a mapping change during composition without hiding an unaffected league', async () => {
    const f = fixture();
    const sibling = { ...f.mapping, leagueSeasonId: id(80), revisionId: id(81),
      scope: { ...f.mapping.scope, externalLeagueId: 'other-native', leagueKey: 'other-generic' } };
    let calls = 0;
    f.reads.readSourceMapping.mockImplementation(async (externalId?: string) => {
      if (externalId === sibling.scope.externalLeagueId) return sibling;
      return ++calls === 1 ? f.mapping : { ...f.mapping, revisionId: id(99) };
    });
    const result = await readPublicSeasonHistory(f.reads, { ...f.input, retained: undefined,
      candidates: [...f.input.candidates, { external_league_id: sibling.scope.externalLeagueId,
        league_season_id: sibling.leagueSeasonId, season: 2026, stage: 'complete' }] });
    expect(result).toMatchObject({ status: 'available', leagues: [
      { resource: { status: 'unavailable' } }, { resource: { status: 'available' } },
    ] });
  });

  it('rejects tampered manifests and cursors before stored reads, and detects changed immutable evidence', async () => {
    const f = fixture(); const first = await retained(f);
    const badManifest = { ...first.manifest, entries: [] } as RetainedMatchupManifest;
    for (const option of [
      { selection: retainedMatchupSelection, manifest: badManifest },
      { selection: retainedMatchupSelection, cursor: first.batch.cursor },
      { selection: retainedMatchupSelection, manifest: first.manifest, cursor: { manifestId: 'wrong', nextIndex: 1 } },
      { selection: retainedMatchupSelection, manifest: first.manifest, cursor: { manifestId: first.manifest.id, nextIndex: 4 } },
      { selection: { ...retainedMatchupSelection, nativeWeeks: [4] }, manifest: first.manifest },
    ] satisfies PublicSeasonHistoryRetained[]) {
      f.reads.readSourceMapping.mockClear();
      await expect(readPublicSeasonHistory(f.reads, { ...f.input, retained: option })).rejects.toThrow();
      expect(f.reads.readSourceMapping).not.toHaveBeenCalled();
    }
    f.evidence[1] = { ...f.evidence[1], observation: { ...f.evidence[1].observation, outcome: 'changed-again' } };
    const next = await retained(f, { ...f.input, retained: { ...f.input.retained!, manifest: first.manifest, cursor: first.batch.cursor } });
    expect(next.batch.entries[0].result).toEqual({ status: 'rejected', reason: 'retained_evidence_changed' });
  });

  it.each([0, 101, 1.5])('rejects invalid retained batch size %s before any read', async batchSize => {
    const f = fixture();
    await expect(readPublicSeasonHistory(f.reads, { ...f.input, retained: { selection: retainedMatchupSelection, batchSize } })).rejects.toThrow();
    expect(f.reads.readSourceMapping).not.toHaveBeenCalled();
  });

  it('validates opt-in and 2026 scope without changing omitted-option behavior', () => {
    expect(() => validatePublicSeasonHistoryOptions({})).not.toThrow();
    expect(() => validatePublicSeasonHistoryOptions({ seasonHistoryRetained: { selection: retainedMatchupSelection } })).toThrow();
    expect(() => validatePublicSeasonHistoryOptions({ seasonHistoryVersion: 'v2' } as unknown as PublicIntakeReadOptions)).toThrow();
    expect(() => validatePublicSeasonHistoryOptions({ seasonHistoryVersion: 'v1',
      seasonHistoryRetained: { selection: { ...retainedMatchupSelection, scope: { ...retainedMatchupSelection.scope, season: 2025 } } } })).toThrow();
  });

  it('never substitutes a retained good observation for a failed typed request', async () => {
    const f = fixture();
    const read = await readPublicSeasonHistory(f.reads, f.input);
    expect(read).toMatchObject({ status: 'available', leagues: [{ resource: { status: 'available',
      periods: [], coverage: { verifiedWeeks: [], seasonCoverage: 'partial',
        gaps: expect.arrayContaining([{ reason: 'requested-period-task-missing', nativeWeek: 3 }]) } } }],
      retainedHistory: { status: 'available' } });
    const typedOnly = await readPublicSeasonHistory(f.reads, { ...f.input, retained: undefined });
    expect(typedOnly).not.toHaveProperty('retainedHistory');
  });

  it('rejects a fan-out beyond twenty admitted canonical leagues before any mapping read', async () => {
    const f = fixture();
    const candidates = Array.from({ length: 21 }, (_, index) => ({ season: 2026, stage: 'complete',
      league_season_id: id(100 + index), external_league_id: String(100 + index) }));
    expect(await readPublicSeasonHistory(f.reads, { ...f.input, candidates })).toEqual({
      status: 'unavailable', reason: 'season-history-request-scope-mismatch' });
    expect(f.reads.readSourceMapping).not.toHaveBeenCalled();
  });
  it('does not silently accept an oversized retained scan', async () => {
    const f = fixture();
    f.reads.scanRetainedMatchups.mockResolvedValue({ status: 'available', evidence: Array.from({ length: 1001 }, () => f.evidence[0]) as RetainedMatchupEvidence[] });
    expect(await readPublicSeasonHistory(f.reads, f.input)).toMatchObject({ retainedHistory: {
      status: 'unavailable', reason: 'retained_inventory_limit_exceeded' } });
    expect(f.reads.readRetainedMatchups).not.toHaveBeenCalled();
  });
});
