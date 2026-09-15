import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { handleMatchupBoxScoresRequest } from './matchup-box-scores-http';
import type { AllPlayerBoxScoreReadInput, StoredAllPlayerBoxScores } from './matchup-box-score-types';
import { validationPayload } from './matchups-validation-test-support';
import { createProjectionStore, type ProjectionStore, type StoredLeaguePeriodAuthority,
  type StoredProjectionSnapshot } from './projection-store';

const now = new Date('2026-09-13T19:02:00Z');
const verifiedAt = '2026-09-13T19:00:00.000Z';
const statsObservedAt = '2026-09-13T18:00:31.000Z';
const revision = 'b'.repeat(64);

function fixture(leagueKey = 'league1', week = 1, activeWeek = 1) {
  const payload = validationPayload();
  payload.week = week;
  payload.league.week = week;
  const starter = payload.matchups[0].sides[0].starters[0];
  starter.id = '5859';
  starter.position = 'WR';
  starter.slot = 'WR';
  payload.matchups[0].sides[0].starters = [
    starter,
    { ...starter, id: 'PHI', position: 'DEF', slot: 'DEF' },
    { ...starter, id: 'empty-RB-2', position: 'RB', slot: 'RB' },
  ];
  const snapshot: StoredProjectionSnapshot = {
    snapshotId: 'snapshot', leagueSeasonId: 'season', week,
    revisionKey: 'a'.repeat(64), modelVersion: 'clock-v1',
    calculatedAt: verifiedAt, publishedAt: verifiedAt, verifiedAt,
    isCurrent: true, activityWindows: [], payload,
  };
  const authority: StoredLeaguePeriodAuthority = {
    leagueKey, defaultSeason: 2026, defaultSeasonType: 'reg', defaultWeek: activeWeek,
    activeSeason: 2026, activeSeasonType: 'reg', activeWeek,
    leagueLifecycle: 'active', nflPhase: 'regular', sourceProvider: 'sleeper',
    sourceRevision: 'period', sourceObservedAt: verifiedAt, verifiedAt,
  };
  const stored = { authority, snapshot, futureRefresh: null };
  const snapshotRead = vi.fn(async () => stored);
  const values: StoredAllPlayerBoxScores = {
    status: 'available', observedAt: statsObservedAt, revision,
    players: {
      'player:5859': { stats: { rec: 0, rec_yd: 0 }, gamePhase: 'live' },
      'defense:PHI': { stats: { sack: 2 }, gamePhase: 'final' },
    },
  };
  const boxRead = vi.fn(async (input: AllPlayerBoxScoreReadInput) => { void input; return values; });
  const store = { enabled: true, readMatchupSnapshotByLeagueKey: snapshotRead,
    readAllPlayerBoxScores: boxRead } as unknown as ProjectionStore;
  return { store, snapshotRead, boxRead, values, stored, payload };
}

function request(query = 'season=2026&week=1') {
  return new Request(`https://example.test/api/matchups/league1/box-scores?${query}`);
}

describe('Matchups box-score HTTP boundary', () => {
  it('includes exact-week bench identities in the existing single bounded read', async () => {
    const test = fixture();
    const side = test.payload.matchups[0].sides[0];
    side.bench = [{ ...side.starters[0], id: '7527', slot: 'BN', position: 'QB' }];
    test.values.players['player:7527'] = { stats: { pass_att: 0 }, gamePhase: 'final' };
    const response = await handleMatchupBoxScoresRequest(request(), 'league1', test.store, now);
    expect(response.status).toBe(200);
    expect(test.boxRead).toHaveBeenCalledOnce();
    expect(test.boxRead.mock.calls[0][0].identities).toContainEqual({ entityKind: 'player', providerExternalId: '7527' });
    expect((await response.json()).players['player:7527'].stats).toEqual({ pass_att: 0 });
    side.bench = null;
    test.boxRead.mockClear();
    const unknown = await handleMatchupBoxScoresRequest(request(), 'league1', test.store, now);
    expect((await unknown.json()).players['player:7527']).toBeUndefined();
    expect(test.boxRead.mock.calls[0][0].identities).not.toContainEqual({ entityKind: 'player', providerExternalId: '7527' });
  });
  it.each(['league1', 'league2'])('scopes one bulk read to %s displayed starter identities and preserves source freshness', async (league) => {
    const test = fixture(league);
    const original = JSON.stringify(test.stored.snapshot);
    const response = await handleMatchupBoxScoresRequest(request(), league, test.store, now);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      leagueKey: league, season: '2026', week: 1, ...test.values,
    });
    expect(test.snapshotRead).toHaveBeenCalledOnce();
    expect(test.snapshotRead).toHaveBeenCalledWith(league, 1, expect.any(Object));
    expect(test.boxRead).toHaveBeenCalledOnce();
    expect(test.boxRead).toHaveBeenCalledWith({ season: 2026, week: 1, identities: [
      { entityKind: 'player', providerExternalId: '5859' },
      { entityKind: 'team_defense', providerExternalId: 'PHI' },
    ] });
    expect(JSON.stringify(test.stored.snapshot)).toBe(original);
  });

  it('reads historical statistics for the selected week instead of the active week', async () => {
    const test = fixture('league1', 1, 2);
    const response = await handleMatchupBoxScoresRequest(request(), 'league1', test.store, now);
    expect(response.status).toBe(200);
    expect(test.boxRead.mock.calls[0][0]).toMatchObject({ season: 2026, week: 1 });
  });

  it('does not cache a former lineup under the same season/week URL', async () => {
    const test = fixture();
    const first = await handleMatchupBoxScoresRequest(request(), 'league1', test.store, now);
    expect(first.headers.get('cache-control')).toBe('no-store');
    test.payload.matchups[0].sides[0].starters[0] = {
      ...test.payload.matchups[0].sides[0].starters[0], id: '11292',
    };
    test.values.players['player:11292'] = { stats: { pass_att: 0 }, gamePhase: 'final' };
    const next = await handleMatchupBoxScoresRequest(request(), 'league1', test.store, now);
    expect(next.headers.get('cache-control')).toBe('no-store');
    const result = await next.json();
    expect(result.players['player:11292']).toEqual({ stats: { pass_att: 0 }, gamePhase: 'final' });
    expect(result.players['player:5859']).toBeUndefined();
    expect(test.boxRead).toHaveBeenCalledTimes(2);
  });

  it('does not read actuals for a future selection or a requested different season', async () => {
    const future = fixture('league1', 2, 1);
    const response = await handleMatchupBoxScoresRequest(request('season=2026&week=2'), 'league1', future.store, now);
    expect(await response.json()).toMatchObject({ status: 'unavailable', week: 2, players: {} });
    expect(future.boxRead).not.toHaveBeenCalled();
    const mismatch = fixture();
    expect((await handleMatchupBoxScoresRequest(request('season=2025&week=1'),
      'league1', mismatch.store, now)).status).toBe(409);
    expect(mismatch.boxRead).not.toHaveBeenCalled();
  });

  it.each([
    '', 'week=1', 'season=2026', 'season=2026&week=0', 'season=2026&week=19',
    'season=2026&week=01', 'season=2026&week=1.5', 'season=26&week=1',
    'season=2026&week=1&week=2', 'season=2026&season=2025&week=1',
  ])('rejects malformed period parameters before any read (%s)', async (query) => {
    const test = fixture();
    const response = await handleMatchupBoxScoresRequest(request(query), 'league1', test.store, now);
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(test.snapshotRead).not.toHaveBeenCalled();
    expect(test.boxRead).not.toHaveBeenCalled();
  });

  it('rejects an unknown league without a read', async () => {
    const test = fixture();
    const response = await handleMatchupBoxScoresRequest(request(), '__proto__', test.store, now);
    expect(response.status).toBe(404);
    expect(test.snapshotRead).not.toHaveBeenCalled();
  });

  it('keeps disabled and older stores silent', async () => {
    const disabled = createProjectionStore({ enabled: false, reason: 'missing-database-url' });
    const disabledRead = vi.spyOn(disabled, 'readMatchupSnapshotByLeagueKey');
    expect(await (await handleMatchupBoxScoresRequest(request(), 'league1', disabled, now)).json())
      .toMatchObject({ status: 'unavailable', players: {} });
    expect(disabledRead).not.toHaveBeenCalled();
    const old = fixture();
    await handleMatchupBoxScoresRequest(request(), 'league1',
      { ...old.store, readAllPlayerBoxScores: undefined }, now);
    expect(old.snapshotRead).not.toHaveBeenCalled();
  });

  it('preserves no-capture and empty partial observations without inventing player statistics', async () => {
    const test = fixture();
    test.values.players = {};
    let response = await handleMatchupBoxScoresRequest(request(), 'league1', test.store, now);
    expect(await response.json()).toMatchObject({ status: 'available', observedAt: statsObservedAt, players: {} });
    test.values.status = 'unavailable';
    response = await handleMatchupBoxScoresRequest(request(), 'league1', test.store, now);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ status: 'unavailable', observedAt: null, revision: null, players: {} });
  });

  it('redacts database errors and never queries stats from an unaccepted snapshot', async () => {
    const test = fixture();
    test.boxRead.mockRejectedValueOnce(new Error('postgresql://secret@private'));
    let response = await handleMatchupBoxScoresRequest(request(), 'league1', test.store, now);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toMatch(/secret|postgresql|private/u);
    test.boxRead.mockClear();
    test.stored.snapshot = { ...test.stored.snapshot, verifiedAt: '2026-09-01T00:00:00Z' };
    response = await handleMatchupBoxScoresRequest(request(), 'league1', test.store, now);
    expect(response.status).toBe(503);
    expect(test.boxRead).not.toHaveBeenCalled();
  });

  it('deduplicates repeated starters and strips nonlineup/private fields from the DTO', async () => {
    const test = fixture();
    test.payload.matchups[0].sides[0].starters.push(test.payload.matchups[0].sides[0].starters[0]);
    test.values.players['player:99999'] = { stats: { rec: 5 }, gamePhase: 'final' };
    test.values.players['player:5859'].stats = { rec: 0, pts_ppr: 999, gp: 1, rec_yd: Number.NaN };
    const response = await handleMatchupBoxScoresRequest(request(), 'league1', test.store, now);
    expect(test.boxRead.mock.calls[0][0].identities).toHaveLength(2);
    expect((await response.json()).players).toEqual({
      'player:5859': { stats: { rec: 0 }, gamePhase: 'live' },
      'defense:PHI': { stats: { sack: 2 }, gamePhase: 'final' },
    });
  });

  it('refuses a wrong-kind defense identity before the statistics read', async () => {
    const test = fixture();
    test.payload.matchups[0].sides[0].starters[1].id = '5859';
    const response = await handleMatchupBoxScoresRequest(request(), 'league1', test.store, now);
    expect(response.status).toBe(503);
    expect(test.boxRead).not.toHaveBeenCalled();
  });
});
