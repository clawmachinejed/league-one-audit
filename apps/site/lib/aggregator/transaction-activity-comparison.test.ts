import { describe, expect, it } from 'vitest';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import type { SleeperTransaction } from '../transform';
import type { TransactionCapture } from '../league-administration/transaction-capture-contracts';
import {
  compareTransactionActivity, compareTransactionActivityBatch, compareTransactionCapture, createTransactionActivityManifest,
  type TransactionComparisonManifest,
} from './transaction-activity-comparison';
import {
  comparisonTransaction as transaction, transactionComparisonCapture as capture,
  transactionComparisonDisplay as display, transactionComparisonSelection as selection,
  transactionComparisonTime as time,
  transactionComparisonUuid as uuid,
} from './transaction-activity-comparison.fixtures';

function compare(rows: SleeperTransaction[]) {
  const result = compareTransactionCapture(capture(rows), display);
  expect(result.status).toBe('available');
  if (result.status !== 'available') throw new Error(result.reason);
  expect(result.comparison).toEqual({ status: 'equal', fields: [] });
  expect(result.legacy).toEqual(result.proposed);
  return result;
}
function manifest() {
  const first = capture([transaction()], 10, 0);
  const corrected = capture([transaction({ status: 'failed', status_updated: time + 1_000 })], 20, 1);
  const third = capture([], 30, 2);
  const result = createTransactionActivityManifest(selection,
    [third, corrected, first].map(source => ({ capture: source, display })));
  expect(result.status).toBe('available');
  if (result.status !== 'available') throw new Error(result.reason);
  return result.manifest;
}
function resign(manifest: TransactionComparisonManifest) {
  const { id: _id, ...body } = manifest;
  void _id;
  return { ...body, id: compatibleRevision(JSON.stringify(body)) };
}

describe('B3 same-capture transaction presentation compatibility', () => {
  it('preserves distinct league pending exclusion and manager status mapping', () => {
    const statuses = ['complete', 'failed', 'pending', 'processing', 'queued', 'canceled', 'cancelled', 'rejected', 'expired', 'other', 'PENDING'];
    const result = compare(statuses.map((status, index) => transaction({ transaction_id: `status-${index}`, status })));
    const league = result.proposed.league[0];
    expect(league.kind).toBe('waiver');
    if (league.kind !== 'waiver') throw new Error('Expected waiver.');
    expect(league.claims).toHaveLength(7);
    expect(league.claims.some(claim => ['status-2', 'status-3', 'status-4', 'status-10'].includes(claim.id))).toBe(false);
    const manager = result.proposed.managers[0].transactions;
    expect(manager).toHaveLength(statuses.length);
    expect(manager.find(row => row.id === 'status-2')?.result).toBe('Pending');
    expect(manager.find(row => row.id === 'status-10')?.result).toBe('Unknown');
    expect(manager.find(row => row.id === 'status-0')?.result).toBe('Won');
    expect(manager.find(row => row.id === 'status-1')?.result).toBe('Lost');
  });

  it('keeps bid precedence, zero, invalid candidates, missing bids and supplied notes', () => {
    const result = compare([
      transaction({ transaction_id: 'zero', settings: { waiver_bid: 0 }, waiver_bid: 50, metadata: { waiver_bid: 60, notes: '  First note  ', note: 'Second note' } }),
      transaction({ transaction_id: 'root', settings: { waiver_bid: -1 }, waiver_bid: '7', metadata: { waiver_bid: 60, note: 'Explicit note' } }),
      transaction({ transaction_id: 'metadata', settings: { waiver_bid: null }, waiver_bid: 'bad', metadata: { waiver_bid: 9, reason: 'Reason' } }),
      transaction({ transaction_id: 'missing', status: 'failed', settings: {}, metadata: { failure_reason: 'No budget' } }),
    ]);
    const manager = result.proposed.managers[0].transactions;
    expect(manager.find(row => row.id === 'zero')).toMatchObject({ bid: 0, lines: expect.arrayContaining([{ label: 'Note', text: 'First note' }]) });
    expect(manager.find(row => row.id === 'root')?.bid).toBe(7);
    expect(manager.find(row => row.id === 'metadata')?.bid).toBe(9);
    expect(manager.find(row => row.id === 'missing')).toMatchObject({ bid: null, result: 'Lost', lines: expect.arrayContaining([{ label: 'Note', text: 'No budget' }]) });
    const group = result.proposed.league[0];
    expect(group.kind === 'waiver' && group.claims).toHaveLength(4);
  });

  it('retains directional players, picks, zero FAAB and destination-unknown assets', () => {
    const result = compare([transaction({ type: 'trade', roster_ids: [1, 2, 3],
      adds: { p1: 2, p2: 1 }, drops: { p1: 1, p2: 3, p3: 1 }, settings: null,
      draft_picks: [{ season: '2027', round: 2, roster_id: 3, previous_owner_id: 1, owner_id: 2 }],
      waiver_budget: [{ sender: 2, receiver: 3, amount: 0 }], metadata: { notes: 'Commissioner supplied note' } })]);
    const league = result.proposed.league[0];
    expect(league.kind).toBe('trade');
    if (league.kind !== 'trade') throw new Error('Expected trade.');
    expect(league.unassigned).toEqual([{ type: 'Player', text: 'Player Three (TE · BUF)' }]);
    expect(league.lines).toContainEqual({ label: 'Beta sent', text: '$0 FAAB' });
    const manager = result.proposed.managers[0].transactions[0];
    expect(manager.lines).toContainEqual({ label: 'Draft pick', text: '2027 round 2 (Gamma original pick): Alpha → Beta' });
    expect(manager.lines).toContainEqual({ label: 'FAAB transfer', text: '$0 · Beta → Gamma' });
    expect(manager.lines).toContainEqual({ label: 'Note', text: 'Commissioner supplied note' });
  });

  it('uses New York day boundaries and both repeated fall-back hours', () => {
    const result = compare([
      transaction({ transaction_id: 'spring-before', status_updated: Date.parse('2026-03-08T04:59:00Z') }),
      transaction({ transaction_id: 'spring-after', status_updated: Date.parse('2026-03-08T05:01:00Z') }),
      transaction({ transaction_id: 'fall-one', adds: { p2: 1 }, status_updated: Date.parse('2026-11-01T05:30:00Z') }),
      transaction({ transaction_id: 'fall-two', adds: { p2: 2 }, roster_ids: [2], status: 'failed', status_updated: Date.parse('2026-11-01T06:30:00Z') }),
    ]);
    expect(result.proposed.league.map(row => row.id)).toEqual(expect.arrayContaining([
      'league1:waiver:p1:2026-03-07', 'league1:waiver:p1:2026-03-08', 'league1:waiver:p2:2026-11-01',
    ]));
    const fall = result.proposed.league.find(row => row.id.endsWith('p2:2026-11-01'));
    expect(fall?.kind === 'waiver' && fall.claims).toHaveLength(2);
  });

  it('preserves unavailable time, unknown display fallbacks and losing-only visibility', () => {
    const source = capture([
      transaction({ transaction_id: 'lost-only', status: 'failed', created: 0, status_updated: 0, adds: { unknown: 9 }, roster_ids: [9], consenter_ids: [] }),
      transaction({ transaction_id: 'unknown-player', status: 'failed', adds: {}, roster_ids: [1], created: 0, status_updated: 0, settings: null }),
    ]);
    const result = compareTransactionCapture(source, { ...display, managerRosterIds: [9, 1] });
    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error(result.reason);
    expect(result.comparison.status).toBe('equal');
    const lost = result.proposed.league.find(row => row.id.endsWith('lost-only'));
    expect(lost).toMatchObject({ kind: 'waiver', timestamp: null, winners: [], claims: [{ team: 'Team 9', result: 'Lost' }] });
    expect(result.proposed.league.find(row => row.id.endsWith('unknown-player'))).toMatchObject({ kind: 'waiver', player: null });
    expect(result.mappingEvidence).toBe('unverified');
    expect(result.display.historicalApplicability).toBe('unverified');
  });

  it('keeps native Week 0, exact source times and separately timed current display evidence', () => {
    const result = compare([transaction()]);
    expect(result.source.provenance.sourceObservedAt).toBe('2026-12-01T12:00:00.123456Z');
    expect(result.source.recordedAt).toBe('2026-12-01T12:00:00.654321Z');
    expect(result.display.teamsObservation).toEqual(display.teamsObservation);
    expect(result.display.catalogObservation).toEqual(display.catalogObservation);
    expect(result.display.temporalContext).toBe('current-display');
  });

  it('keeps empty complete captures distinct from rejected or unavailable evidence', () => {
    const empty = compare([]);
    expect(empty.sourceCompleteness).toBe('complete');
    expect(empty.proposed.league).toEqual([]);
    expect(empty.proposed.managers.every(manager => manager.transactions.length === 0)).toBe(true);
    expect(compareTransactionCapture({ ...capture([]), contentHash: 'wrong' }, display).status).toBe('unavailable');
    const partial = compareTransactionCapture(capture([], 10, 0, 'partial'), display);
    expect(partial).toMatchObject({ status: 'available', sourceCompleteness: 'partial', proposed: { league: [] } });
  });

  it('rejects display scope drift, duplicate manager/team identity and invalid display observation time', () => {
    const source = capture([transaction()]);
    for (const invalid of [
      { ...display, leagueKey: 'league2' as const }, { ...display, leagueSeasonId: 'other' },
      { ...display, managerRosterIds: [1, 1] }, { ...display, teams: [display.teams[0], display.teams[0]] },
      { ...display, catalogObservation: { observationId: null, observedAt: 'invalid' } },
    ]) expect(compareTransactionCapture(source, invalid).status).toBe('unavailable');
  });
});

describe('B3 bounded frozen retained comparison', () => {
  it('preserves presentation-sensitive source object order through manifest freezing and restart', () => {
    const source = capture([transaction({ type: 'free_agent', adds: { p2: 1, p1: 1 } })]);
    const direct = compareTransactionCapture(source, display);
    if (direct.status !== 'available') throw new Error(direct.reason);
    const prepared = createTransactionActivityManifest(selection, [{ capture: source, display }]);
    if (prepared.status !== 'available') throw new Error(prepared.reason);
    const batch = compareTransactionActivityBatch(JSON.parse(JSON.stringify(prepared.manifest)));
    if (batch.status !== 'complete') throw new Error('Comparison unavailable.');
    expect(batch.entries[0].result.proposed).toEqual(direct.proposed);
  });

  it('freezes each captured mapping revision while older original observations remain unverified', () => {
    const original = capture([transaction()]);
    const mapped = (id: number, generation: number): TransactionCapture => ({ ...capture([transaction()], id),
      captureKind: 'receipt', mapping: { connectionId: uuid(500), leagueSeasonId: selection.leagueSeasonId,
        revisionId: uuid(500 + generation), generation, scope: selection.scope },
      receipt: { id: uuid(id), attemptId: uuid(600 + id), ordinal: 1, expectedGeneration: 0,
        provenance: original.envelope.provenance, acceptedGeneration: 1,
        coverage: { periodIds: ['sleeper:transaction-week:0'], interval: null, entitySet: 'full',
          fields: ['transaction_id'], pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] } } });
    const first = mapped(20, 1), newerRevision = mapped(30, 3);
    const prepared = createTransactionActivityManifest(selection,
      [original, first, newerRevision].map(source => ({ capture: source, display })));
    if (prepared.status !== 'available') throw new Error(prepared.reason);
    const result = compareTransactionActivityBatch(prepared.manifest);
    if (result.status !== 'complete') throw new Error('Comparison unavailable.');
    expect(result.entries.map(entry => 'mappingEvidence' in entry.result ? entry.result.mappingEvidence : null))
      .toEqual(['unverified', 'captured', 'captured']);
    expect(result.entries.map(entry => 'mapping' in entry.result ? entry.result.mapping?.revisionId ?? null : null))
      .toEqual([null, uuid(501), uuid(503)]);
    const changed = structuredClone(prepared.manifest);
    const entry = changed.entries[1];
    if (entry.input.kind === 'activity') throw new Error('Expected capture.');
    const replaced = { ...entry, input: { ...entry.input, capture: { ...entry.input.capture, mapping: newerRevision.mapping } } };
    expect(compareTransactionActivityBatch(resign({ ...changed, entries: [changed.entries[0], replaced, changed.entries[2]] })).status)
      .toBe('unavailable');
  });

  it('compares overlap/correction selection while explaining equal-time conflicts explicitly', () => {
    const nativeWeeks = [0, 1];
    const first = capture([transaction({ transaction_id: 'conflict', status: 'failed' }),
      transaction({ transaction_id: 'correction', status: 'pending', status_updated: time - 1_000 })], 10, 0);
    const second = capture([transaction({ transaction_id: 'conflict', status: 'complete' }),
      transaction({ transaction_id: 'correction', status: 'complete' })], 20, 1);
    const activity = { selection: { ...selection, nativeWeeks }, captures: [first, second] };
    const result = compareTransactionActivity(activity, display);
    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error(result.reason);
    expect(result.comparison.status).toBe('explained-difference');
    expect(result.comparison.explanations).toMatchObject([{ reason: 'equal_time_event_conflict',
      captureIds: [first.captureId, second.captureId] }]);
    expect(result.proposed.managers[0].transactions).toMatchObject([{ id: 'correction', result: 'Won' }]);
    expect(result.outputPagination).toEqual({ complete: true, count: 1 });
    expect(result.claimVisibility).toEqual({ visibility: 'supplied-only', losingClaimInventory: 'unknown' });
    const prepared = createTransactionActivityManifest(activity.selection, [{ kind: 'activity', activity, display }]);
    if (prepared.status !== 'available') throw new Error(prepared.reason);
    expect(compareTransactionActivityBatch(JSON.parse(JSON.stringify(prepared.manifest))))
      .toEqual(compareTransactionActivityBatch(prepared.manifest));
  });

  it('compares every bounded output page and deduplicates before applying a time window', () => {
    const sourceRows = Array.from({ length: 103 }, (_, index) => transaction({ transaction_id: `event-${index}`,
      type: 'free_agent', status_updated: time + index }));
    const activity = { selection: { ...selection, nativeWeeks: [0, 1] },
      captures: [capture(sourceRows, 10, 0), capture([transaction({ transaction_id: 'event-0',
        type: 'free_agent', status_updated: time + 500 })], 20, 1)] };
    const result = compareTransactionActivity(activity, display);
    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error(result.reason);
    expect(result.comparison.status).toBe('equal');
    expect(result.outputPagination.count).toBe(103);
    const windowed = compareTransactionActivity({ ...activity,
      window: { from: new Date(time).toISOString(), to: new Date(time + 200).toISOString() } }, display);
    if (windowed.status !== 'available') throw new Error(windowed.reason);
    expect(windowed.comparison.status).toBe('equal');
    expect(windowed.outputPagination.count).toBe(102);
    expect(windowed.proposed.managers[0].transactions.some(row => row.id === 'event-0')).toBe(false);
  });

  it('reports partial/missing/failed weeks separately from completed output pagination', () => {
    const source = capture([transaction()]);
    const result = compareTransactionActivity({ selection, captures: [source],
      failures: [{ week: 1, checkedAt: '2026-12-01T13:00:00Z', reason: 'source_unavailable' }] }, display);
    if (result.status !== 'available') throw new Error(result.reason);
    expect(result.comparison.status).toBe('equal');
    expect(result.sourceCoverage.completeness).toBe('partial');
    expect(result.sourceCoverage.weeks.map(week => week.state)).toEqual(['complete', 'failed', 'missing', 'missing']);
    expect(result.outputPagination.complete).toBe(true);
  });

  it('compares exact sub-millisecond inclusive/exclusive window boundaries without rounding them', () => {
    const result = compareTransactionActivity({ selection: { ...selection, nativeWeeks: [0] },
      captures: [capture([transaction({ transaction_id: 'before', status_updated: time }),
        transaction({ transaction_id: 'inside', status_updated: time + 1 })])],
      window: { from: '2026-09-09T12:00:00.000001Z', to: '2026-09-09T12:00:00.002000Z' } }, display);
    if (result.status !== 'available') throw new Error(result.reason);
    expect(result.comparison.status).toBe('equal');
    expect(result.outputPagination.count).toBe(1);
    expect(result.proposed.managers[0].transactions.map(row => row.id)).toEqual(['inside']);
  });

  it('retries and resumes serialized immutable captures with exact result hashes', () => {
    const frozen = manifest();
    const first = compareTransactionActivityBatch(frozen, undefined, 1);
    expect(first.status).toBe('more');
    if (first.status !== 'more') throw new Error('First batch unavailable.');
    const second = compareTransactionActivityBatch(JSON.parse(JSON.stringify(frozen)), JSON.parse(JSON.stringify(first.cursor)), 1);
    expect(second.status).toBe('more');
    if (second.status !== 'more') throw new Error('Second batch unavailable.');
    const third = compareTransactionActivityBatch(frozen, second.cursor, 1);
    expect(third.status).toBe('complete');
    if (third.status !== 'complete') throw new Error('Third batch unavailable.');
    const all = compareTransactionActivityBatch(frozen, undefined, 100);
    expect(all.status).toBe('complete');
    if (all.status !== 'complete') throw new Error('Whole comparison unavailable.');
    expect([...first.entries, ...second.entries, ...third.entries]).toEqual(all.entries);
    expect(compareTransactionActivityBatch(frozen, undefined, 1)).toEqual(first);
    expect(compareTransactionActivityBatch(frozen, third.cursor, 1)).toMatchObject({ status: 'complete', entries: [], durableReplay: false });
    expect(all.processing).toBe('read-only-comparison');
    expect(new Set(all.entries.map(entry => entry.entryId)).size).toBe(3);
    expect(all.entries[1].result.proposed.managers[0].transactions[0].result).toBe('Lost');
  });

  it('freezes raw source, mapping, teams/catalog and display metadata against later arrivals or mutation', () => {
    const source = capture([transaction()]);
    const currentDisplay = structuredClone(display);
    const inventory = [{ capture: source, display: currentDisplay }];
    const prepared = createTransactionActivityManifest(selection, inventory);
    if (prepared.status !== 'available') throw new Error(prepared.reason);
    const before = compareTransactionActivityBatch(prepared.manifest);
    inventory.push({ capture: capture([transaction({ transaction_id: 'later' })], 99, 3), display: currentDisplay });
    currentDisplay.catalog.p1.full_name = 'Changed name';
    currentDisplay.teams[0].name = 'Renamed team';
    (source.envelope.payload as unknown as SleeperTransaction[])[0].settings!.waiver_bid = 999;
    expect(compareTransactionActivityBatch(prepared.manifest)).toEqual(before);
    const frozenInput = prepared.manifest.entries[0].input;
    if (frozenInput.kind === 'activity') throw new Error('Expected capture entry.');
    expect(Object.isFrozen(frozenInput.capture.envelope.payload)).toBe(true);
    expect(Object.isFrozen(prepared.manifest.entries[0].input.display.catalog.p1)).toBe(true);
  });

  it('rejects empty/oversized/duplicate/out-of-scope inventories', () => {
    const input = { capture: capture([]), display };
    expect(createTransactionActivityManifest(selection, []).status).toBe('unavailable');
    expect(createTransactionActivityManifest(selection, Array(1_001).fill(input)).status).toBe('unavailable');
    expect(createTransactionActivityManifest(selection, [input, input]).status).toBe('unavailable');
    expect(createTransactionActivityManifest({ ...selection, nativeWeeks: [1] }, [input]).status).toBe('unavailable');
    expect(createTransactionActivityManifest({ ...selection, scope: { ...selection.scope, season: 2027 } }, [input]).status).toBe('unavailable');
  });

  it('rejects changed contents, nested hashes, versions, ordering and non-JSON evidence', () => {
    const frozen = manifest();
    const changed = structuredClone(frozen);
    changed.entries[0].input.display.catalog.p1.full_name = 'Changed';
    expect(compareTransactionActivityBatch(changed).status).toBe('unavailable');
    expect(compareTransactionActivityBatch(resign(changed)).status).toBe('unavailable');
    expect(compareTransactionActivityBatch(resign({ ...frozen, transformationVersion: 'new-version' })).status).toBe('unavailable');
    expect(compareTransactionActivityBatch(resign({ ...frozen, entries: [...frozen.entries].reverse() })).status).toBe('unavailable');
    const nonJson = structuredClone(frozen);
    (nonJson.entries[0].input.display.catalog.p1 as Record<string, unknown>).injury_status = Infinity;
    expect(compareTransactionActivityBatch(nonJson).status).toBe('unavailable');
    expect(createTransactionActivityManifest(selection, [nonJson.entries[0].input]).status).toBe('unavailable');
  });

  it.each([0, 101, -1, 1.5, NaN])('rejects invalid batch size %s', batchSize => {
    expect(compareTransactionActivityBatch(manifest(), undefined, batchSize).status).toBe('unavailable');
  });

  it('rejects foreign and out-of-range cursors without skipping source entries', () => {
    const frozen = manifest();
    for (const cursor of [{ manifestId: 'other', nextIndex: 0 }, { manifestId: frozen.id, nextIndex: -1 },
      { manifestId: frozen.id, nextIndex: 4 }, { manifestId: frozen.id, nextIndex: 0.5 }]) {
      expect(compareTransactionActivityBatch(frozen, cursor).status).toBe('unavailable');
    }
  });
});
