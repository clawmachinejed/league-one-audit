import { describe, expect, it } from 'vitest';
import type { JsonObject } from '../league-administration/contracts';
import { activityCapture, activityId, activityScope } from './transaction-activity.fixtures';
import { buildTransactionActivity, projectTransactionCapture, type TransactionActivityInput } from './transaction-activity';

const base = { transaction_id: 't', type: 'waiver', status: 'complete', created: 1790769600000, status_updated: 1790769601000,
  roster_ids: [1], adds: { player: 1 }, drops: {}, draft_picks: [], waiver_budget: [], settings: { waiver_bid: 0 } };
const input = (captures = [activityCapture([base])], weeks = [0]): TransactionActivityInput => ({
  selection: { leagueSeasonId: activityId(90), scope: activityScope, nativeWeeks: weeks }, captures });
function projected(rows: JsonObject[] = [base]) {
  const result = projectTransactionCapture(activityCapture(rows));
  if (result.status !== 'available') throw new Error(result.reason); return result;
}
function page(value = input(), request: Parameters<typeof buildTransactionActivity>[1] = {}) {
  const result = buildTransactionActivity(value, request);
  if (result.status !== 'available') throw new Error(result.reason); return result;
}

describe('transaction activity facts over the existing capture', () => {
  it.each(['complete', 'failed', 'pending', 'processing', 'queued', 'canceled', 'cancelled', 'rejected', 'expired', 'future-status', 'PENDING'])
  ('preserves native status %s and its current mapping', status => {
    const event = projected([{ ...base, status }]).events[0];
    expect(event.nativeStatus.value).toBe(status);
    expect(event.result).toBe(status === 'complete' ? 'Won' : status === 'failed' ? 'Lost'
      : ['pending', 'processing', 'queued'].includes(status) ? 'Pending'
        : ['canceled', 'cancelled', 'rejected', 'expired'].includes(status) ? 'Failed' : 'Unknown');
    expect(event.evidence.sourceMappingRevisionId).toBeNull();
  });

  it('keeps absent, null, empty and zero separate without fabricating losing claims', () => {
    const event = projected([{ transaction_id: 't', type: 'waiver', adds: null, drops: {}, roster_ids: [],
      created: 0, metadata: { waiver_bid: '0', notes: '', note: null, failure_reason: 9 }, settings: { waiver_bid: 'bad' } }]).events[0];
    expect(event.adds.state).toBe('null'); expect(event.drops).toMatchObject({ state: 'known', value: [] });
    expect(event.rosterIds).toMatchObject({ state: 'known', value: [] }); expect(event.consenterIds.state).toBe('absent');
    expect(event.createdAtMilliseconds).toMatchObject({ state: 'known', value: 0 }); expect(event.timestamp).toBeNull();
    expect(event.claim).toMatchObject({ bid: 0, visibility: 'supplied-only', losingClaimInventory: 'unknown',
      bids: { settings: { state: 'invalid' }, direct: { state: 'absent' }, metadata: { state: 'known', value: 0, raw: '0' } },
      notes: { notes: { state: 'known', value: '' }, note: { state: 'null' }, failure_reason: { state: 'invalid' } } });
  });

  it.each([
    [{ settings: { waiver_bid: 0 }, waiver_bid: 4, metadata: { waiver_bid: 5 } }, 0],
    [{ settings: { waiver_bid: -1 }, waiver_bid: '4', metadata: { waiver_bid: 5 } }, 4],
    [{ settings: { waiver_bid: null }, waiver_bid: false, metadata: { waiver_bid: 5 } }, 5],
    [{ settings: { waiver_bid: 1.5 }, metadata: {} }, null],
  ] as const)('uses existing bid precedence without changing raw evidence (%j)', (fields, expected) => {
    expect(projected([{ ...base, ...fields }]).events[0].claim.bid).toBe(expected);
  });

  it('preserves player/pick/FAAB direction, exact amounts, participants and unknown destinations', () => {
    const event = projected([{ transaction_id: 'trade', type: 'trade', status: 'complete', adds: { p1: 2, p2: 9 }, drops: { p1: 1, p3: 3 },
      draft_picks: [{ season: '2028', round: 2, roster_id: 3, previous_owner_id: 2, owner_id: 1 }],
      waiver_budget: [{ sender: 1, receiver: 2, amount: 0 }, { sender: 2, receiver: 3, amount: 1.25 }],
      metadata: { note: ' exact note ', claim_id: 'native-claim', private_extension: { supplied: true } } }]).events[0];
    expect(event.adds.value?.map(move => [move.player.nativeId, move.team.externalRosterId])).toEqual([['p1', '2'], ['p2', '9']]);
    expect(event.drops.value?.map(move => [move.player.nativeId, move.team.externalRosterId])).toEqual([['p1', '1'], ['p3', '3']]);
    expect(event.picks.value?.[0]).toMatchObject({ season: 2028, round: 2, originalTeam: { externalRosterId: '3' },
      from: { externalRosterId: '2' }, to: { externalRosterId: '1' } });
    expect(event.budget.value?.map(move => move.amount)).toEqual([0, 1.25]);
    expect(event.participants.find(team => team.externalRosterId === '9')).toMatchObject({ seasonTeamId: null, mappingEvidence: 'unresolved' });
    expect(event.metadata.value?.claim_id).toBe('native-claim'); expect(event.claim.notes.note.value).toBe(' exact note ');
    expect(event.limitations).toContain('mapping_revision_not_captured');
  });

  it('reports unsupported type and malformed evidence independently from a complete empty week', () => {
    expect(projected([{ transaction_id: 't', type: 'new-provider-action' }]).events[0].typeSupport).toBe('unsupported');
    expect(projected([]).sourceCompleteness).toBe('complete');
    expect(projectTransactionCapture(activityCapture([{ transaction_id: 't', adds: { p: 'bad' } }]))).toMatchObject({ status: 'unavailable' });
  });

  it.each(['contentHash', 'semanticHash', 'normalizedValue', 'contentId', 'week'] as const)('rejects corrupt %s', field => {
    const capture = activityCapture([base]);
    expect(projectTransactionCapture({ ...capture, [field]: field === 'week' ? 18 : 'corrupt' })).toMatchObject({ status: 'unavailable' });
  });

  it('does not accept today’s mapping grafted onto a legacy observation', () => {
    const capture = activityCapture([base]);
    expect(projectTransactionCapture({ ...capture, mapping: { connectionId: activityId(80), leagueSeasonId: activityId(90),
      revisionId: activityId(81), generation: 2, scope: activityScope } })).toMatchObject({ status: 'unavailable' });
  });

  it('binds mapped receipt provenance, period coverage and acceptance generation', () => {
    const source = activityCapture([base]);
    const mapped = { ...source, mapping: { connectionId: activityId(80), leagueSeasonId: activityId(90),
      revisionId: activityId(81), generation: 2, scope: activityScope },
    receipt: { id: activityId(50), attemptId: activityId(51), ordinal: 2, expectedGeneration: 1,
      provenance: source.envelope.provenance, acceptedGeneration: 2,
      coverage: { periodIds: ['sleeper:transaction-week:0'], interval: null, entitySet: 'full' as const,
        fields: ['transaction_id'], pagination: 'complete' as const, nextCursor: null, completeness: 'complete' as const, reasons: [] } } };
    const result = projectTransactionCapture(mapped);
    expect(result).toMatchObject({ status: 'available', mappingEvidence: 'captured' });
    if (result.status === 'available') expect(result.events[0].participants[0].mappingEvidence).toBe('captured');
    for (const receipt of [
      { ...mapped.receipt, acceptedGeneration: 3 },
      { ...mapped.receipt, coverage: { ...mapped.receipt.coverage, periodIds: ['sleeper:transaction-week:1'] } },
      { ...mapped.receipt, provenance: { ...mapped.receipt.provenance, sourceObservedAt: '2026-09-30T12:00:00.000001Z' } },
    ]) expect(projectTransactionCapture({ ...mapped, receipt })).toMatchObject({ status: 'unavailable' });
  });

  it('freezes source facts without freezing or mutating caller-owned source objects', () => {
    const capture = activityCapture([base]); const result = projectTransactionCapture(capture);
    expect(Object.isFrozen(capture)).toBe(false); expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe('bounded league and manager activity', () => {
  it('preserves complete empty Week 0 and 18 and explicitly missing intervening scope', () => {
    const result = page(input([activityCapture([], { week: 0 }), activityCapture([], { id: 2, week: 18 })], [0, 1, 18]));
    expect(result.sourceCoverage.weeks.map(week => week.state)).toEqual(['complete', 'missing', 'complete']);
    expect(result.sourceCoverage.completeness).toBe('partial'); expect(result.pagination).toMatchObject({ total: 0, state: 'complete' });
    expect(result.claimVisibility.losingClaimInventory).toBe('unknown');
  });

  it('keeps last complete evidence visible while reporting a later partial, invalid or failed attempt', () => {
    const complete = activityCapture([base]); const partial = activityCapture([], { id: 2, at: '2026-09-30T13:00:00Z', completeness: 'partial' });
    const result = page(input([complete, partial]));
    expect(result.events).toHaveLength(1); expect(result.sourceCoverage.weeks[0]).toMatchObject({ state: 'partial', lastGood: true });
    const failed = page({ ...input([complete]), failures: [{ week: 0, checkedAt: '2026-09-30T14:00:00Z', reason: 'provider_unavailable' }] });
    expect(failed.events).toHaveLength(1); expect(failed.sourceCoverage.weeks[0]).toMatchObject({ state: 'failed', lastGood: true });
    const invalid = activityCapture([{ transaction_id: 't', adds: [] }], { id: 3, at: '2026-09-30T14:00:00Z' });
    expect(page(input([complete, invalid])).sourceCoverage.weeks[0]).toMatchObject({ state: 'invalid', lastGood: true });
  });

  it('selects corrections by source observation time, independent of stale arrival order', () => {
    const older = activityCapture([base]); const correction = activityCapture([{ ...base, status: 'failed' }], { id: 2, at: '2026-09-30T14:00:00Z' });
    const a = page(input([older, correction])); const b = page(input([correction, older]));
    expect(a).toEqual(b); expect(a.events[0].result).toBe('Lost');
  });

  it('withholds contradictory same-time complete weekly captures', () => {
    const result = page(input([activityCapture([base]), activityCapture([{ ...base, status: 'failed' }], { id: 2 })]));
    expect(result.events).toEqual([]); expect(result.sourceCoverage.weeks[0].state).toBe('conflict');
  });

  it('deduplicates overlapping weekly events, uses newer correction and quarantines equal-time conflicts', () => {
    const duplicate = page(input([activityCapture([base]), activityCapture([base], { id: 2, week: 1 })], [0, 1]));
    expect(duplicate.events).toHaveLength(1);
    const correction = page(input([activityCapture([base]), activityCapture([{ ...base, status: 'failed', status_updated: base.status_updated + 1 }], { id: 2, week: 1 })], [0, 1]));
    expect(correction.events[0].result).toBe('Lost');
    const conflict = page(input([activityCapture([base]), activityCapture([{ ...base, status: 'failed' }], { id: 2, week: 1 })], [0, 1]));
    expect(conflict.events).toHaveLength(0); expect(conflict.conflicts).toHaveLength(1);
    expect(conflict.sourceCoverage.completeness).toBe('complete'); expect(conflict.windowCoverage.completeness).toBe('partial');
  });

  it('binds stable pagination to frozen source, team/type filters and interval', () => {
    const source = input([activityCapture(Array.from({ length: 5 }, (_, i) => ({ ...base, transaction_id: String(i),
      type: i === 0 ? 'trade' : 'waiver', roster_ids: [i === 1 ? 2 : 1], adds: {} })))]);
    const first = page(source, { limit: 1, teamId: activityId(901), types: ['waiver'] });
    expect(first.pagination).toMatchObject({ total: 3, state: 'more' });
    const next = page(JSON.parse(JSON.stringify(source)), { limit: 2, cursor: first.pagination.nextCursor, teamId: activityId(901), types: ['waiver'] });
    expect(next.pagination.state).toBe('complete');
    expect(new Set([...first.events, ...next.events].map(event => event.id)).size).toBe(3);
    expect(buildTransactionActivity(source, { cursor: first.pagination.nextCursor, teamId: activityId(902), types: ['waiver'] })).toMatchObject({ status: 'unavailable' });
    expect(buildTransactionActivity({ ...source, window: { from: '2026-01-01T00:00:00Z', to: null } }, { cursor: first.pagination.nextCursor })).toMatchObject({ status: 'unavailable' });
  });

  it('uses inclusive/exclusive window boundaries and reports unknown event time separately', () => {
    const at = '2026-09-30T12:00:00Z'; const end = '2026-09-30T13:00:00Z';
    const result = page({ ...input([activityCapture([
      { transaction_id: 'from', created: Date.parse(at) }, { transaction_id: 'to', created: Date.parse(end) }, { transaction_id: 'unknown' },
    ])]), window: { from: at, to: end } });
    expect(result.events.map(event => event.externalTransactionId)).toEqual(['from']);
    expect(result.windowCoverage).toEqual({ completeness: 'partial', unknownTimestampEvents: 1 });
    expect(result.sourceCoverage.completeness).toBe('complete');
  });

  it.each([0, -1, 101, 1.5])('rejects unbounded or invalid page size %s', limit => {
    expect(buildTransactionActivity(input(), { limit })).toMatchObject({ status: 'unavailable' });
  });

  it('rejects wrong league, season, selected week, duplicate capture, and cursor', () => {
    const source = input();
    for (const wrong of [
      { ...source, selection: { ...source.selection, leagueSeasonId: activityId(99) } },
      { ...source, selection: { ...source.selection, scope: { ...activityScope, season: 2025 } } },
      { ...source, selection: { ...source.selection, nativeWeeks: [1] } },
      { ...source, captures: [...source.captures, ...source.captures] },
    ]) expect(buildTransactionActivity(wrong)).toMatchObject({ status: 'unavailable' });
    expect(buildTransactionActivity(source, { cursor: 'wrong.0' })).toMatchObject({ status: 'unavailable' });
  });
});
