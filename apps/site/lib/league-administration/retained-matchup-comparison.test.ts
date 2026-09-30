import { afterEach, describe, expect, it, vi } from 'vitest';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { retainedMatchupFixture, retainedMatchupId, retainedMatchupSelection } from '../aggregator/retained-matchups.fixtures';
import { createRetainedMatchupComparison, isRetainedMatchupManifest,
  type RetainedMatchupComparisonEntry, type RetainedMatchupCursor, type RetainedMatchupManifest } from './retained-matchup-comparison';
import type { RetainedMatchupEvidence, RetainedMatchupMappingCandidate } from './retained-matchups-contracts';

vi.mock('server-only', () => ({}));
afterEach(() => vi.unstubAllGlobals());

function fixture(count = 5) {
  const evidence = Array.from({ length: count }, (_, index) => retainedMatchupFixture({ observationNumber: 10 + index }));
  const scanRetainedMatchups = vi.fn(async () => ({ status: 'available' as const, evidence: [...evidence].reverse() }));
  const readRetainedMatchups = vi.fn(async (_selection, ids: readonly string[]) => ({ status: 'available' as const,
    evidence: evidence.filter(item => ids.includes(item.observation.id)).reverse() }));
  return { evidence, scanRetainedMatchups, readRetainedMatchups,
    service: createRetainedMatchupComparison({ scanRetainedMatchups, readRetainedMatchups }) };
}
async function manifestOf(run: ReturnType<typeof fixture>) {
  const result = await run.service.createManifest(retainedMatchupSelection);
  expect(result.status).toBe('available');
  if (result.status !== 'available') throw new Error('Fixture manifest unavailable.');
  return result.manifest;
}
function mappingCandidate(evidence: RetainedMatchupEvidence, id: number, revisionId = 4): RetainedMatchupMappingCandidate {
  return { kind: 'matchup-receipt', id: retainedMatchupId(id), observationId: evidence.observation.id,
    contentId: evidence.observation.contentId, family: 'matchups', nativePeriodId: 'sleeper:matchup-week:3',
    provenance: evidence.observation.provenance,
    sourceMapping: { connectionId: retainedMatchupId(5), leagueSeasonId: retainedMatchupSelection.leagueSeasonId,
      revisionId: retainedMatchupId(revisionId), generation: 1, scope: retainedMatchupSelection.scope },
    revision: { id: retainedMatchupId(revisionId), connectionId: retainedMatchupId(5),
      leagueSeasonId: retainedMatchupSelection.leagueSeasonId, provider: 'sleeper', externalLeagueId: 'source-2026',
      sourceNamespace: 'nfl:2026', generation: 1 } };
}
async function finish(run: ReturnType<typeof fixture>, manifest: RetainedMatchupManifest, batchSize: number,
  cursor?: RetainedMatchupCursor) {
  const entries: RetainedMatchupComparisonEntry[] = [];
  for (;;) {
    const batch = await run.service.compareBatch({ manifest, cursor, batchSize });
    if ('reason' in batch) throw new Error(batch.reason);
    entries.push(...batch.entries);
    if (batch.status === 'complete') return entries;
    cursor = batch.cursor;
  }
}

describe('immutable retained matchup comparison manifest', () => {
  it('freezes versions, original source IDs/hashes/mapping and microsecond order from one inventory', async () => {
    const run = fixture(2);
    run.evidence[0] = retainedMatchupFixture({ observationNumber: 10, capturedMapping: true });
    const manifest = await manifestOf(run);
    expect(isRetainedMatchupManifest(manifest)).toBe(true);
    expect(run.scanRetainedMatchups).toHaveBeenCalledTimes(1);
    expect(manifest.entries.map(item => item.observationId)).toEqual([retainedMatchupId(10), retainedMatchupId(11)]);
    expect(manifest.entries[0]).toMatchObject({ contentId: retainedMatchupId(3), mappingRevisionId: retainedMatchupId(4),
      orderingAt: '2026-09-29T12:00:01.000123Z', expectedRawHash: run.evidence[0].content!.contentHash,
      expectedLegacySemanticHash: run.evidence[0].content!.semanticHash });
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.selection.scope)).toBe(true);
    expect(Object.isFrozen(manifest.entries[0])).toBe(true);
    expect(manifest.entries[0].expectedEvidenceHash).toBe(compatibleRevision(run.evidence[0]));
    expect((await finish(run, manifest, 1)).every(item => item.result.status === 'available')).toBe(true);
  });

  it('sorts sub-millisecond differences without rounding original timestamps', async () => {
    const run = fixture(2);
    run.evidence[0] = { ...run.evidence[0], observation: { ...run.evidence[0].observation,
      orderingAt: '2026-09-29T12:00:01.000124Z' } };
    expect((await manifestOf(run)).entries.map(item => item.observationId)).toEqual([retainedMatchupId(11), retainedMatchupId(10)]);
  });

  it('has identical semantic and lineage results across every batch size and interruption boundary', async () => {
    const run = fixture(); const manifest = await manifestOf(run);
    const expected = await finish(run, manifest, 100);
    expect(expected).toHaveLength(5);
    expect(new Set(expected.map(item => item.observationId)).size).toBe(5);
    for (const size of [1, 2, 3, 4, 5, 100]) expect(await finish(run, manifest, size)).toEqual(expected);
    for (let boundary = 0; boundary <= expected.length; boundary++) {
      const cursor = { manifestId: manifest.id, nextIndex: boundary };
      expect([...expected.slice(0, boundary), ...await finish(run, manifest, 2, cursor)]).toEqual(expected);
    }
    for (const item of expected) {
      expect(item.resultHash).toBe(compatibleRevision(item.result));
      if (item.result.status === 'available') expect(item.projectionSemanticHash).toBe(compatibleRevision(item.result.value));
    }
  });

  it('retries a lost response identically and roundtrips manifest/cursor artifacts without process state', async () => {
    const run = fixture(); const manifest = await manifestOf(run);
    const first = await run.service.compareBatch({ manifest, batchSize: 2 });
    expect(await run.service.compareBatch({ manifest, batchSize: 2 })).toEqual(first);
    if (first.status !== 'more') throw new Error('Expected more.');
    const restarted = createRetainedMatchupComparison(run);
    expect(await restarted.compareBatch({ manifest: JSON.parse(JSON.stringify(manifest)),
      cursor: JSON.parse(JSON.stringify(first.cursor)), batchSize: 2 }))
      .toEqual(await run.service.compareBatch({ manifest, cursor: first.cursor, batchSize: 2 }));
  });

  it('new observations require a new manifest and never enter a resumed batch', async () => {
    const run = fixture(2); const manifest = await manifestOf(run);
    run.evidence.push(retainedMatchupFixture({ observationNumber: 99 }));
    expect((await finish(run, manifest, 1)).map(item => item.observationId))
      .toEqual([retainedMatchupId(10), retainedMatchupId(11)]);
    const next = await manifestOf(run);
    expect(next.id).not.toBe(manifest.id); expect(next.entries).toHaveLength(3);
    expect(run.scanRetainedMatchups).toHaveBeenCalledTimes(2);
  });

  it('freezes namespaced mapping association membership as later same-provenance captures append', async () => {
    const run = fixture(1);
    const first = mappingCandidate(run.evidence[0], 600);
    run.evidence[0] = { ...run.evidence[0], mappingCandidates: [first] };
    const manifest = await manifestOf(run); const expected = await finish(run, manifest, 1);
    expect(manifest.entries[0].mappingEvidence).toEqual([{ kind: 'matchup-receipt', id: retainedMatchupId(600), revisionId: retainedMatchupId(4) }]);
    const later = { ...mappingCandidate(run.evidence[0], 601, 9), kind: 'calculation-input' as const };
    run.evidence[0] = { ...run.evidence[0], mappingCandidates: [later, first] };
    expect(await finish(run, manifest, 1)).toEqual(expected);
    const next = await manifestOf(run);
    expect(next.id).not.toBe(manifest.id);
    expect((await finish(run, next, 1))[0].result.status).toBe('rejected');
    run.evidence[0] = { ...run.evidence[0], mappingCandidates: [later] };
    expect((await finish(run, manifest, 1))[0].result).toEqual({ status: 'rejected', reason: 'retained_evidence_changed' });
  });

  it('does not backdate a newly attached mapping into a manifest that captured none', async () => {
    const run = fixture(1); const manifest = await manifestOf(run); const expected = await finish(run, manifest, 1);
    run.evidence[0] = { ...run.evidence[0], mappingCandidates: [mappingCandidate(run.evidence[0], 600)] };
    expect(await finish(run, manifest, 1)).toEqual(expected);
    expect(manifest.entries[0].mappingEvidence).toEqual([]);
  });

  it('detects replacement or duplicate delivery of a frozen mapping association', async () => {
    const run = fixture(1); const first = mappingCandidate(run.evidence[0], 600);
    run.evidence[0] = { ...run.evidence[0], mappingCandidates: [first] }; const manifest = await manifestOf(run);
    for (const candidates of [[{ ...first, revision: { ...first.revision!, generation: 2 } }], [first, first]]) {
      run.evidence[0] = { ...run.evidence[0], mappingCandidates: candidates };
      expect((await finish(run, manifest, 1))[0].result).toEqual({ status: 'rejected', reason: 'retained_evidence_changed' });
    }
  });

  it('makes no provider request or writer call, including retries and completion', async () => {
    const provider = vi.fn(() => { throw new Error('Provider access forbidden.'); }); vi.stubGlobal('fetch', provider);
    const writes = vi.fn(() => { throw new Error('Writes forbidden.'); });
    const run = fixture(2);
    const service = createRetainedMatchupComparison({ ...run, recordObservation: writes,
      beginExactMatchupAttempt: writes } as Parameters<typeof createRetainedMatchupComparison>[0]);
    const created = await service.createManifest(retainedMatchupSelection);
    if (created.status !== 'available') throw new Error('Expected available.');
    const result = await service.compareBatch({ manifest: created.manifest, batchSize: 100 });
    if (result.status !== 'complete') throw new Error('Expected complete.');
    const calls = run.readRetainedMatchups.mock.calls.length;
    expect(await service.compareBatch({ manifest: created.manifest, cursor: result.cursor, batchSize: 100 }))
      .toMatchObject({ status: 'complete', entries: [], cursor: result.cursor });
    expect(run.readRetainedMatchups).toHaveBeenCalledTimes(calls);
    expect(provider).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
  });

  it('does not advance after cancellation or transient store failure', async () => {
    const run = fixture(2); const manifest = await manifestOf(run); const abort = new AbortController();
    run.readRetainedMatchups.mockImplementationOnce(async () => { abort.abort(); return { status: 'available', evidence: run.evidence }; });
    await expect(run.service.compareBatch({ manifest, batchSize: 2, signal: abort.signal })).rejects.toThrow();
    expect(await finish(run, manifest, 2)).toHaveLength(2);
    const failed = createRetainedMatchupComparison({ ...run,
      readRetainedMatchups: async () => ({ status: 'unavailable', reason: 'retained_matchup_database_unavailable' }) });
    expect(await failed.compareBatch({ manifest, batchSize: 2 })).toEqual({ status: 'unavailable', reason: 'retained_matchup_database_unavailable' });
    expect(await finish(run, manifest, 2)).toHaveLength(2);
  });

  it('rejects changes to fixed evidence without substituting current data', async () => {
    const run = fixture(2); const manifest = await manifestOf(run);
    run.evidence[0] = { ...run.evidence[0], content: { ...run.evidence[0].content!, contentHash: 'a'.repeat(64) } };
    const entries = await finish(run, manifest, 2);
    expect(entries[0]).toMatchObject({ result: { status: 'rejected', reason: 'retained_evidence_changed' }, projectionSemanticHash: null });
    expect(entries[1].result.status).toBe('available');
    expect(await finish(run, manifest, 1)).toEqual(entries);
  });

  it('records stable missing-observation rejection, never another observation sharing its content', async () => {
    const run = fixture(2); const manifest = await manifestOf(run); run.evidence.shift();
    expect((await finish(run, manifest, 2))[0].result).toEqual({ status: 'rejected', reason: 'retained_observation_missing' });
  });

  it('freezes corrupt retained input and returns its precise same-source rejection', async () => {
    const run = fixture(1);
    run.evidence[0] = { ...run.evidence[0], content: { ...run.evidence[0].content!, semanticHash: 'b'.repeat(64) } };
    const manifest = await manifestOf(run);
    expect((await finish(run, manifest, 1))[0].result).toEqual({ status: 'rejected', reason: 'retained_semantic_hash_mismatch' });
  });

  it.each(['duplicate', 'unexpected'] as const)('refuses %s batch membership without cursor advancement', async mode => {
    const run = fixture(2); const manifest = await manifestOf(run);
    run.readRetainedMatchups.mockImplementationOnce(async () => ({ status: 'available', evidence: mode === 'duplicate'
      ? [run.evidence[0], run.evidence[0]] : [retainedMatchupFixture({ observationNumber: 999 })] }));
    expect(await run.service.compareBatch({ manifest, batchSize: 2 })).toEqual({ status: 'unavailable', reason: 'retained_batch_membership_mismatch' });
  });

  it('rejects a previously valid v1 transformation manifest before reading or reusing its cursor', async () => {
    const run = fixture(1); const current = await manifestOf(run);
    expect(current.transformationVersion).toBe('sleeper-retained-matchups-v2');
    const { id: _id, ...body } = current;
    void _id;
    const oldBody = { ...body, transformationVersion: 'sleeper-retained-matchups-v1' };
    // Recompute the old-version digest so rejection is about semantic version, not a corrupt hash.
    const oldManifest = { ...oldBody, id: compatibleRevision(oldBody) } as RetainedMatchupManifest;
    expect(isRetainedMatchupManifest(oldManifest)).toBe(false);
    expect(await run.service.compareBatch({ manifest: oldManifest,
      cursor: { manifestId: oldManifest.id, nextIndex: 0 }, batchSize: 1 }))
      .toEqual({ status: 'unavailable', reason: 'invalid_retained_manifest' });
    expect(run.readRetainedMatchups).not.toHaveBeenCalled();
  });
  it('rejects tampered membership, scope, hashes, versions and order before reading', async () => {
    const run = fixture(2); const manifest = await manifestOf(run);
    const mutations = [
      { ...manifest, entries: manifest.entries.slice(1) },
      { ...manifest, entries: [...manifest.entries].reverse() },
      { ...manifest, transformationVersion: 'unknown' },
      { ...manifest, selectionVersion: 'unknown' },
      { ...manifest, selection: { ...manifest.selection, nativeWeeks: [4] } },
      { ...manifest, entries: [{ ...manifest.entries[0], expectedRawHash: 'a'.repeat(64) }, manifest.entries[1]] },
    ];
    for (const mutated of mutations) expect(await run.service.compareBatch({ manifest: mutated as RetainedMatchupManifest, batchSize: 1 }))
      .toEqual({ status: 'unavailable', reason: 'invalid_retained_manifest' });
    expect(run.readRetainedMatchups).not.toHaveBeenCalled();
  });

  it.each([0, -1, 101, 1.5, NaN])('rejects invalid batch bound %s', async batchSize => {
    const run = fixture(); const manifest = await manifestOf(run);
    expect(await run.service.compareBatch({ manifest, batchSize })).toEqual({ status: 'unavailable', reason: 'invalid_retained_batch_size' });
    expect(run.readRetainedMatchups).not.toHaveBeenCalled();
  });

  it('rejects wrong-manifest, negative, fractional and past-end cursors', async () => {
    const run = fixture(2); const manifest = await manifestOf(run);
    for (const cursor of [{ manifestId: 'wrong', nextIndex: 0 }, ...[-1, 0.5, 3].map(nextIndex => ({ manifestId: manifest.id, nextIndex }))]) {
      expect(await run.service.compareBatch({ manifest, cursor, batchSize: 1 })).toEqual({ status: 'unavailable', reason: 'invalid_retained_cursor' });
    }
    expect(run.readRetainedMatchups).not.toHaveBeenCalled();
  });

  it('handles an explicitly empty inventory without inventing coverage or doing a batch read', async () => {
    const run = fixture(0); const manifest = await manifestOf(run);
    expect(await finish(run, manifest, 100)).toEqual([]);
    expect(run.readRetainedMatchups).not.toHaveBeenCalled();
  });

  it('fails closed on over-cap or duplicate inventory and never silently truncates', async () => {
    const run = fixture(1001);
    expect(await run.service.createManifest(retainedMatchupSelection)).toEqual({ status: 'unavailable', reason: 'retained_inventory_limit_exceeded' });
    run.evidence.splice(2); run.evidence[1] = run.evidence[0];
    expect(await run.service.createManifest(retainedMatchupSelection)).toEqual({ status: 'unavailable', reason: 'invalid_retained_inventory' });
  });

  it('detaches the selected scope before an asynchronous scan', async () => {
    const selection = structuredClone(retainedMatchupSelection);
    const run = fixture(1);
    run.scanRetainedMatchups.mockImplementationOnce(async () => { (selection.scope as { season: number }).season = 2027;
      return { status: 'available', evidence: run.evidence }; });
    const result = await run.service.createManifest(selection);
    if (result.status !== 'available') throw new Error('Expected available.');
    expect(result.manifest.selection.scope.season).toBe(2026);
  });

  it('does not inspect evidence or perform batch work when the read store is disabled', async () => {
    const run = fixture(1);
    const service = createRetainedMatchupComparison({ ...run, scanRetainedMatchups: async () => ({ status: 'disabled', reason: 'persistence_disabled' }) });
    expect(await service.createManifest(retainedMatchupSelection)).toEqual({ status: 'disabled', reason: 'persistence_disabled' });
    expect(run.readRetainedMatchups).not.toHaveBeenCalled();
  });
});
