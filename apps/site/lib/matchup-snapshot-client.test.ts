import { describe, expect, it, vi } from 'vitest';
import { MATCHUP_PERIOD_HEADERS } from './matchup-period';
import { SNAPSHOT_REVISION_HEADER, SNAPSHOT_VERIFIED_AT_HEADER } from './matchup-snapshot-metadata';
import { checkMatchupSnapshot, initialClientSnapshot, reconcileServerSnapshot, type ClientMatchupSnapshot } from './matchup-snapshot-client';
import { contextFixture, snapshotFixture, snapshotHeaders, SNAPSHOT_A, SNAPSHOT_B, SNAPSHOT_C,
  SNAPSHOT_TIME, NEXT_SNAPSHOT_TIME } from '../test-support/matchup-snapshot-fixtures';

const scope = { leagueKey: 'league1', season: '2026', week: 5 };
const adopted = (): ClientMatchupSnapshot => initialClientSnapshot(snapshotFixture(), contextFixture(), SNAPSHOT_A, SNAPSHOT_TIME);
function compact(revision = SNAPSHOT_B, verifiedAt = NEXT_SNAPSHOT_TIME, context = contextFixture()) {
  return Response.json({ status: 'ok', revision, verifiedAt }, { headers: snapshotHeaders(revision, verifiedAt, context) });
}
function full(revision = SNAPSHOT_B, verifiedAt = NEXT_SNAPSHOT_TIME, data = snapshotFixture(5, 'Updated Alpha')) {
  return Response.json(data, { headers: snapshotHeaders(revision, verifiedAt) });
}
function execute(responses: Response[], current = adopted(), controller = new AbortController()) {
  const request = vi.fn<typeof fetch>();
  for (const response of responses) request.mockResolvedValueOnce(response);
  return { request, result: checkMatchupSnapshot({ scope, adopted: current, signal: controller.signal, request }) };
}

describe('matchup snapshot revision transport', () => {
  it('uses a no-store compact request and updates only freshness for identical content', async () => {
    const current = adopted();
    const { request, result } = execute([compact(SNAPSHOT_A)], current);
    expect(await result).toEqual({ kind: 'accepted', snapshot: { ...current, verifiedAt: NEXT_SNAPSHOT_TIME } });
    expect(request).toHaveBeenCalledExactlyOnceWith('/api/matchups/league1/revision?week=5', {
      cache: 'no-store', redirect: 'error', headers: { accept: 'application/json' }, signal: expect.any(AbortSignal),
    });
  });
  it('accepts a period transition on the same revision without regressing verification time', async () => {
    const current = adopted();
    const { result, request } = execute([compact(SNAPSHOT_A, '2026-09-03T11:59:00.000Z', contextFixture('past'))], current);
    const checked = await result;
    expect(checked).toMatchObject({ kind: 'accepted', snapshot: { context: { temporalState: 'past' }, verifiedAt: SNAPSHOT_TIME } });
    if (checked.kind === 'accepted') expect(checked.snapshot.data).toBe(current.data);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('requests changed content by revision and adopts the actual response lineage', async () => {
    const { result, request } = execute([compact(SNAPSHOT_B), full(SNAPSHOT_C)]);
    expect(await result).toMatchObject({ kind: 'accepted', snapshot: { revision: SNAPSHOT_C, verifiedAt: NEXT_SNAPSHOT_TIME,
      data: { teams: [{ name: 'Updated Alpha' }, { name: 'Fixture Beta' }] } } });
    expect(request.mock.calls[1][0]).toBe(`/api/matchups/league1?week=5&rev=${SNAPSHOT_B}`);
    expect(request.mock.calls[1][1]).not.toHaveProperty('cache');
  });
  it('uses compact freshness only when the returned full content has that exact revision', async () => {
    const same = execute([compact(SNAPSHOT_B), full(SNAPSHOT_B, SNAPSHOT_TIME)]);
    expect(await same.result).toMatchObject({ kind: 'accepted', snapshot: { verifiedAt: NEXT_SNAPSHOT_TIME } });
    const different = execute([compact(SNAPSHOT_B), full(SNAPSHOT_C, SNAPSHOT_TIME)]);
    expect(await different.result).toMatchObject({ kind: 'accepted', snapshot: { revision: SNAPSHOT_C, verifiedAt: SNAPSHOT_TIME } });
  });
  it('does not let a newer compact time disguise older content under another revision', async () => {
    expect(await execute([compact(SNAPSHOT_B), full(SNAPSHOT_C, '2026-09-03T11:59:00.000Z')]).result).toEqual({ kind: 'failed' });
  });
  it('downloads the first trusted payload from null fallback lineage despite a newer fallback load timestamp', async () => {
    const fallback = initialClientSnapshot({ ...snapshotFixture(), updatedAt: '2026-09-03T15:00:00.000Z' }, contextFixture(), null, null);
    const { request, result } = execute([compact(SNAPSHOT_A), full(SNAPSHOT_A)], fallback);
    expect(await result).toMatchObject({ kind: 'accepted', snapshot: { revision: SNAPSHOT_A } });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('repeats the compact check once after 409 and follows the newly selected revision', async () => {
    const { request, result } = execute([compact(SNAPSHOT_B), new Response(null, { status: 409 }), compact(SNAPSHOT_C), full(SNAPSHOT_C)]);
    expect(await result).toMatchObject({ kind: 'accepted', snapshot: { revision: SNAPSHOT_C } });
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      '/api/matchups/league1/revision?week=5', `/api/matchups/league1?week=5&rev=${SNAPSHOT_B}`,
      '/api/matchups/league1/revision?week=5', `/api/matchups/league1?week=5&rev=${SNAPSHOT_C}`,
    ]);
  });
  it('stops after the second 409 rather than looping', async () => {
    const { request, result } = execute([compact(), new Response(null, { status: 409 }), compact(SNAPSHOT_C), new Response(null, { status: 409 })]);
    expect(await result).toEqual({ kind: 'failed' });
    expect(request).toHaveBeenCalledTimes(4);
  });
  it('can finish the single race retry without a full request if the revision returns to adopted content', async () => {
    const { request, result } = execute([compact(), new Response(null, { status: 409 }), compact(SNAPSHOT_A)]);
    expect(await result).toMatchObject({ kind: 'accepted', snapshot: { revision: SNAPSHOT_A } });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it.each([
    { status: 'wrong', revision: SNAPSHOT_B, verifiedAt: NEXT_SNAPSHOT_TIME },
    { status: 'ok', revision: 'B'.repeat(64), verifiedAt: NEXT_SNAPSHOT_TIME },
    { status: 'ok', revision: 'short', verifiedAt: NEXT_SNAPSHOT_TIME },
    { status: 'ok', revision: SNAPSHOT_B, verifiedAt: 'bad-time' },
    { status: 'ok', revision: SNAPSHOT_B, verifiedAt: 'September 3, 2026' },
    null, [],
  ])('rejects malformed compact metadata %j without downloading a body', async (value) => {
    const { result, request } = execute([Response.json(value, { headers: snapshotHeaders() })]);
    expect(await result).toEqual({ kind: 'failed' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([MATCHUP_PERIOD_HEADERS.defaultSeason, MATCHUP_PERIOD_HEADERS.defaultWeek, MATCHUP_PERIOD_HEADERS.temporalState,
    MATCHUP_PERIOD_HEADERS.refreshDue, MATCHUP_PERIOD_HEADERS.activeWeek])('rejects missing protocol header %s', async (header) => {
    const response = compact(); response.headers.delete(header);
    expect(await execute([response]).result).toEqual({ kind: 'failed' });
  });
  it.each([SNAPSHOT_REVISION_HEADER, SNAPSHOT_VERIFIED_AT_HEADER])('rejects full responses missing %s', async (header) => {
    const response = full(); response.headers.delete(header);
    expect(await execute([compact(), response]).result).toEqual({ kind: 'failed' });
  });
  it.each(['week', 'league-week', 'season', 'nested-player'] as const)('rejects invalid full payload %s', async (issue) => {
    const payload = snapshotFixture();
    if (issue === 'week') payload.week = 6;
    if (issue === 'league-week') payload.league.week = 6;
    if (issue === 'season') payload.league.season = '2027';
    if (issue === 'nested-player') payload.matchups[0].sides[0].starters[0].name = null as never;
    expect(await execute([compact(), full(SNAPSHOT_B, NEXT_SNAPSHOT_TIME, payload)]).result).toEqual({ kind: 'failed' });
  });
  it('rejects a response redirected or resolved to another league route', async () => {
    const otherLeague = compact(); Object.defineProperty(otherLeague, 'url', { value: 'https://example.test/api/matchups/league2/revision?week=5' });
    expect(await execute([otherLeague]).result).toEqual({ kind: 'failed' });
    const redirected = compact(); Object.defineProperty(redirected, 'redirected', { value: true });
    expect(await execute([redirected]).result).toEqual({ kind: 'failed' });
  });
  it('rejects malformed JSON, failed statuses, and network failures without leaking errors', async () => {
    expect(await execute([new Response('{broken', { headers: snapshotHeaders() })]).result).toEqual({ kind: 'failed' });
    expect(await execute([new Response(null, { status: 503 })]).result).toEqual({ kind: 'failed' });
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('private-error'));
    expect(await checkMatchupSnapshot({ scope, adopted: adopted(), signal: new AbortController().signal, request })).toEqual({ kind: 'failed' });
  });
  it('ignores a late response even when the mocked transport does not honor cancellation', async () => {
    const controller = new AbortController();
    const request = vi.fn<typeof fetch>().mockImplementation(async () => { controller.abort(); return compact(); });
    expect(await checkMatchupSnapshot({ scope, adopted: adopted(), signal: controller.signal, request })).toEqual({ kind: 'cancelled' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not apply a local clock-age policy to usable future snapshots', async () => {
    const old = '2020-01-01T00:00:00.000Z';
    const fallback = initialClientSnapshot(snapshotFixture(), contextFixture(), null, null);
    const context = { ...contextFixture(), refreshDue: true };
    const response = full(SNAPSHOT_B, old); response.headers.set(MATCHUP_PERIOD_HEADERS.refreshDue, 'true');
    expect(await execute([compact(SNAPSHOT_B, old, context), response], fallback).result)
      .toMatchObject({ kind: 'accepted', snapshot: { verifiedAt: old, context: { refreshDue: true } } });
  });
});

describe('server refresh reconciliation', () => {
  it('keeps a newer adopted snapshot against unrelated older SSR or null-lineage fallback', () => {
    const current = { ...adopted(), verifiedAt: NEXT_SNAPSHOT_TIME };
    const older = { ...adopted(), revision: SNAPSHOT_B };
    expect(reconcileServerSnapshot(current, older, false)).toBe(current);
    expect(reconcileServerSnapshot(current, { ...older, revision: null, verifiedAt: null }, false)).toBe(current);
  });
  it('accepts intentional official fallback and clears both Neon lineage fields', () => {
    const fallback = initialClientSnapshot(snapshotFixture(5, 'Official fallback'), contextFixture('active'), null, null);
    expect(reconcileServerSnapshot(adopted(), fallback, true)).toBe(fallback);
  });
  it('does not let intentional fallback accept an older valid Neon response', () => {
    const current = { ...adopted(), verifiedAt: NEXT_SNAPSHOT_TIME };
    expect(reconcileServerSnapshot(current, { ...adopted(), revision: SNAPSHOT_B }, true)).toBe(current);
  });
  it('does not let stale same-revision SSR restart polling after a completed period', () => {
    const completed = { ...adopted(), context: contextFixture('past'), verifiedAt: NEXT_SNAPSHOT_TIME };
    expect(reconcileServerSnapshot(completed, adopted(), false).context.temporalState).toBe('past');
    expect(reconcileServerSnapshot(adopted(), completed, false).context.temporalState).toBe('past');
  });
  it('keeps same-revision data while advancing verification and accepts a newer server revision', () => {
    const current = adopted();
    const next = { ...adopted(), verifiedAt: NEXT_SNAPSHOT_TIME };
    expect(reconcileServerSnapshot(current, next, false)).toEqual({ ...current, verifiedAt: NEXT_SNAPSHOT_TIME });
    expect(reconcileServerSnapshot(current, { ...next, revision: SNAPSHOT_B }, false).revision).toBe(SNAPSHOT_B);
  });
});
