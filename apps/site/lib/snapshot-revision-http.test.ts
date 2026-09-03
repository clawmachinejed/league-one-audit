import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <Value,>(value: Value) => value }));
vi.mock('./live-projection-worker', () => ({ runLiveProjectionSync: vi.fn() }));

import { validationPayload } from './matchups-validation-test-support';
import { SNAPSHOT_REVISION_HEADER, SNAPSHOT_VERIFIED_AT_HEADER } from './matchup-snapshot-metadata';
import { snapshotFreshnessMetadata } from './projection-freshness';
import { handleMatchupsRevisionRequest, handleMatchupsSnapshotRequest } from './projection-http';
import { readStoredMatchupRevision, readStoredMatchups } from './projection-reader';
import { InvalidStoredProjectionSnapshotError, type ProjectionStore, type StoredLeaguePeriodAuthority, type StoredProjectionSnapshot } from './projection-store';

const revision = 'a'.repeat(64);
const verifiedAt = '2026-09-13T18:00:00.000Z';
const now = new Date('2026-09-13T18:02:00.000Z');

function fixture(week = 1, activeWeek = 1) {
  const payload = validationPayload();
  payload.week = week;
  payload.league.week = week;
  const snapshot: StoredProjectionSnapshot = {
    snapshotId: `snapshot-${week}`, leagueSeasonId: 'season-1', week,
    revisionKey: revision, modelVersion: 'clock-v1',
    calculatedAt: verifiedAt, publishedAt: verifiedAt, verifiedAt,
    isCurrent: true, activityWindows: [], payload,
  };
  const authority: StoredLeaguePeriodAuthority = {
    leagueKey: 'league1', defaultSeason: 2026, defaultSeasonType: 'reg', defaultWeek: activeWeek,
    activeSeason: 2026, activeSeasonType: 'reg', activeWeek, leagueLifecycle: 'active',
    nflPhase: 'regular', sourceProvider: 'sleeper', sourceRevision: 'period',
    sourceObservedAt: verifiedAt, verifiedAt,
  };
  const stored = { authority, snapshot, futureRefresh: null };
  const full = vi.fn(async () => stored);
  const compact = vi.fn(async () => ({ ...stored, snapshot: {
    ...snapshot, ...snapshotFreshnessMetadata(snapshot), payload: undefined,
  } }));
  const store = {
    enabled: true, readMatchupSnapshotByLeagueKey: full,
    readMatchupSnapshotRevisionByLeagueKey: compact,
  } as unknown as ProjectionStore;
  return { store, stored, full, compact };
}

function request(week = '1', suffix = ''): Request {
  return new Request(`https://example.test/api/matchups/league1/revision?week=${week}${suffix}`);
}

async function expectError(response: Response, status: number, body: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({ status: body });
}

describe('compact revision HTTP protocol', () => {
  it.each([
    { week: 1, activeWeek: 1, state: 'active' },
    { week: 5, activeWeek: 1, state: 'future' },
    { week: 1, activeWeek: 2, state: 'past' },
  ])('returns only revision metadata and period headers for $state', async ({ week, activeWeek, state }) => {
    const data = fixture(week, activeWeek);
    const result = await handleMatchupsRevisionRequest(request(String(week)), 'league1', data.store, now);
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(result.headers.get('X-Matchup-Temporal-State')).toBe(state);
    expect(result.headers.get('X-League-Default-Week')).toBe(String(activeWeek));
    expect(await result.json()).toEqual({ status: 'ok', revision, verifiedAt });
    expect(data.compact).toHaveBeenCalledOnce();
    expect(data.full).not.toHaveBeenCalled();
  });

  it.each(['', '0', '19', '1.5', 'abc'])('rejects invalid week %s before any database work', async (week) => {
    const data = fixture();
    await expectError(await handleMatchupsRevisionRequest(request(week), 'league1', data.store, now), 400, 'invalid-week');
    expect(data.compact).not.toHaveBeenCalled();
  });

  it('preserves the complete no-store error matrix', async () => {
    const unknown = fixture();
    await expectError(await handleMatchupsRevisionRequest(request(), 'unknown', unknown.store, now), 404, 'not-found');
    expect(unknown.compact).not.toHaveBeenCalled();
    const disabled = fixture();
    Object.assign(disabled.store, { enabled: false });
    await expectError(await handleMatchupsRevisionRequest(request(), 'league1', disabled.store, now), 503, 'unavailable');
    expect(disabled.compact).not.toHaveBeenCalled();
    const missing = fixture();
    missing.compact.mockResolvedValue(null as never);
    await expectError(await handleMatchupsRevisionRequest(request(), 'league1', missing.store, now), 404, 'not-found');
    for (const error of [new Error('database unavailable'), new InvalidStoredProjectionSnapshotError(new Error('nested malformed JSON'))]) {
      const failed = fixture();
      failed.compact.mockRejectedValue(error);
      await expectError(await handleMatchupsRevisionRequest(request(), 'league1', failed.store, now), 503, 'unavailable');
    }
    const stale = fixture();
    await expectError(await handleMatchupsRevisionRequest(request(), 'league1', stale.store,
      new Date('2026-09-13T18:03:00.001Z')), 503, 'unavailable');
    await expectError(await handleMatchupsRevisionRequest(request(), 'league1', stale.store,
      new Date('2026-09-13T18:10:00.001Z')), 503, 'unavailable');
  });

  it('keeps missing snapshot precedence over stale authority', async () => {
    const data = fixture();
    data.compact.mockResolvedValue({ ...data.stored, snapshot: null } as never);
    await expectError(await handleMatchupsRevisionRequest(request(), 'league1', data.store,
      new Date('2026-09-13T18:10:00.001Z')), 404, 'not-found');
  });

  it('reports advancing verification time without changing the content revision', async () => {
    const data = fixture();
    Object.assign(data.stored.snapshot, { verifiedAt: '2026-09-13T18:01:00.000Z' });
    const result = await handleMatchupsRevisionRequest(request(), 'league1', data.store, now);
    expect(await result.json()).toEqual({ status: 'ok', revision, verifiedAt: '2026-09-13T18:01:00.000Z' });
  });

  it('does not expose invalid historical revision or timestamp as usable compact lineage', async () => {
    for (const override of [{ revisionKey: 'opaque-legacy' }, { verifiedAt: 'infinity' }]) {
      const data = fixture(1, 2);
      Object.assign(data.stored.snapshot, override);
      await expectError(await handleMatchupsRevisionRequest(request(), 'league1', data.store, now), 503, 'unavailable');
      const unversioned = await handleMatchupsSnapshotRequest(request(), 'league1', data.store, now);
      expect(unversioned.status).toBe(200);
      expect(await unversioned.json()).toEqual(data.stored.snapshot.payload);
    }
  });
});

describe('full snapshot revision fencing', () => {
  it.each(['', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 'revision-1'])('rejects invalid revision %s before a query', async (invalid) => {
    const data = fixture();
    await expectError(await handleMatchupsSnapshotRequest(request('1', `&rev=${invalid}`), 'league1', data.store, now), 400, 'invalid-revision');
    expect(data.full).not.toHaveBeenCalled();
  });

  it('returns no-store conflict when publication overtakes the requested revision', async () => {
    const data = fixture();
    await expectError(await handleMatchupsSnapshotRequest(request('1', `&rev=${'b'.repeat(64)}`), 'league1', data.store, now), 409, 'revision-mismatch');
    expect(data.full).toHaveBeenCalledOnce();
    expect(data.compact).not.toHaveBeenCalled();
  });

  it.each([
    { week: 1, activeWeek: 1, cache: 'public, s-maxage=15, stale-while-revalidate=30' },
    { week: 5, activeWeek: 1, cache: 'public, s-maxage=300, stale-while-revalidate=300' },
    { week: 1, activeWeek: 2, cache: 'public, s-maxage=300, stale-while-revalidate=3600' },
  ])('preserves full payload and cache for week $week with authority $activeWeek', async ({ week, activeWeek, cache }) => {
    const data = fixture(week, activeWeek);
    const result = await handleMatchupsSnapshotRequest(request(String(week), `&rev=${revision}`), 'league1', data.store, now);
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe(cache);
    expect(result.headers.get(SNAPSHOT_REVISION_HEADER)).toBe(revision);
    expect(result.headers.get(SNAPSHOT_VERIFIED_AT_HEADER)).toBe(verifiedAt);
    expect(await result.json()).toEqual(data.stored.snapshot.payload);
  });
});

describe('full and compact reader selection parity', () => {
  it.each([
    { week: 1, activeWeek: 1, age: '2026-09-13T18:03:00Z' },
    { week: 1, activeWeek: 1, age: '2026-09-13T18:03:00.001Z' },
    { week: 1, activeWeek: 1, age: '2026-09-13T18:10:00.001Z' },
    { week: 5, activeWeek: 1, age: '2026-09-13T18:05:00Z' },
    { week: 1, activeWeek: 2, age: '2026-09-13T18:05:00Z' },
  ])('matches usability and headers for week $week at $age', async ({ week, activeWeek, age }) => {
    const data = fixture(week, activeWeek);
    const options = { store: data.store, now: new Date(age) };
    const full = await readStoredMatchups('league1', week, options);
    const compact = await readStoredMatchupRevision('league1', week, options);
    if (full.kind === 'usable') {
      const { payload, ...metadata } = full;
      expect(payload).toEqual(data.stored.snapshot.payload);
      expect(compact).toEqual(metadata);
    } else expect(compact).toEqual(full);
    expect(data.full).toHaveBeenCalledOnce();
    expect(data.compact).toHaveBeenCalledOnce();
  });
});
