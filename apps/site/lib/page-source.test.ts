import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAGUE_IDS } from './config';
import type { AdministrationEnvelope } from './league-administration/contracts';
import type { LeagueAdministrationStoreRead } from './league-administration/store-contracts';

vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: <T,>(value: T) => value }));
vi.mock('./league-administration/store', () => ({ getLeagueAdministrationStore: vi.fn() }));

import { AdministrationSourceConflictError, createPageAdministrationReader } from './page-source';

const scope = { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: LEAGUE_IDS.league1, season: 2026 } as const;
const provenance = { origin: 'cache', requestStartedAt: '2026-09-15T16:00:00.000Z',
  requestCompletedAt: '2026-09-15T16:00:01.000Z', sourceObservedAt: null, checkedAt: '2026-09-15T17:00:00.000Z' } as const;
function available(family: AdministrationEnvelope['family'] = 'league', week: number | null = null): LeagueAdministrationStoreRead {
  return { status: 'available', observationId: 'observation', versionId: 'version', generation: 1,
    checkedAt: provenance.checkedAt, verifiedAt: provenance.checkedAt, envelope: {
      schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
      scope, family, week, provenance, completeness: 'complete', payload: family === 'league' ? { season: '2026' } : [],
    } };
}
const store = { readSourceByConnection: vi.fn<() => Promise<LeagueAdministrationStoreRead>>(),
  readSource: vi.fn<(input: unknown) => Promise<LeagueAdministrationStoreRead>>() };
const request = { externalLeagueId: LEAGUE_IDS.league1, family: 'matchups', week: 2, season: 2026 } as const;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-15T17:00:30.000Z'));
  store.readSourceByConnection.mockReset().mockResolvedValue(available());
  store.readSource.mockReset().mockResolvedValue(available('matchups', 2));
});
afterEach(() => vi.useRealTimers());

describe('accepted administration page source', () => {
  it('pins exact source identity and week, preserving original observation times without a provider or writer', async () => {
    const read = createPageAdministrationReader(() => store);
    expect(await read(request)).toEqual({ status: 'available', payload: [], origin: 'cache', sourceObservedAt: null,
      requestStartedAt: provenance.requestStartedAt, requestCompletedAt: provenance.requestCompletedAt });
    expect(store.readSource).toHaveBeenCalledWith({ ...scope, family: 'matchups', week: 2 });
  });

  it('accepts an owner-registered annual source ID for the same permanent routed league', async () => {
    const annualScope = { ...scope, externalLeagueId: 'annual-league-one-2027', season: 2027 };
    const configuration = available();
    const matchups = available('matchups', 2);
    if (configuration.status !== 'available' || matchups.status !== 'available') throw new Error('Fixture unavailable');
    store.readSourceByConnection.mockResolvedValue({ ...configuration, envelope: { ...configuration.envelope, scope: annualScope } });
    store.readSource.mockResolvedValue({ ...matchups, envelope: { ...matchups.envelope, scope: annualScope } });
    expect((await createPageAdministrationReader(() => store)({ ...request, ...annualScope })).status).toBe('available');
    expect(store.readSource).toHaveBeenCalledWith({ ...annualScope, family: 'matchups', week: 2 });
  });

  it.each(['bootstrap', 'unrouted', 'requested'])('rejects a conflicting %s permanent league identity', async mismatch => {
    const configuration = available();
    if (configuration.status !== 'available') throw new Error('Fixture unavailable');
    const externalLeagueId = mismatch === 'bootstrap' ? scope.externalLeagueId : 'annual-source';
    store.readSourceByConnection.mockResolvedValue({ ...configuration, envelope: { ...configuration.envelope,
      scope: { ...scope, externalLeagueId, leagueKey: mismatch === 'unrouted' ? 'unsupported-route' : 'league2' } } });
    await expect(createPageAdministrationReader(() => store)({ ...request, externalLeagueId,
      ...(mismatch === 'requested' ? { leagueKey: 'league1' } : {}) })).rejects.toThrow(AdministrationSourceConflictError);
  });

  it.each(['missing', 'disabled', 'unavailable'] as const)('distinguishes %s bootstrap fallback from an accepted empty document', async status => {
    store.readSourceByConnection.mockResolvedValue({ status });
    expect(await createPageAdministrationReader(() => store)(request)).toEqual({ status: 'fallback', reason: status });
    expect(store.readSource).not.toHaveBeenCalled();
  });

  it('does not use another season when configuration advances during a page read', async () => {
    await expect(createPageAdministrationReader(() => store)({ ...request, season: 2025 }))
      .rejects.toThrow(AdministrationSourceConflictError);
    expect(store.readSource).not.toHaveBeenCalled();
  });

  it.each(['connection', 'document'])('does not hide a stored %s conflict with fallback', async location => {
    if (location === 'connection') store.readSourceByConnection.mockResolvedValue({ status: 'conflict' });
    else store.readSource.mockResolvedValue({ status: 'conflict' });
    await expect(createPageAdministrationReader(() => store)(request)).rejects.toThrow(AdministrationSourceConflictError);
  });

  it.each(['league', 'season', 'week', 'family', 'partial', 'timestamp'])('rejects mismatched %s evidence', async mismatch => {
    const result = available('matchups', 2);
    if (result.status !== 'available') throw new Error('Fixture unavailable');
    const envelope = structuredClone(result.envelope) as { -readonly [K in keyof AdministrationEnvelope]: AdministrationEnvelope[K] };
    if (mismatch === 'league') envelope.scope = { ...scope, externalLeagueId: LEAGUE_IDS.league2 };
    if (mismatch === 'season') envelope.scope = { ...scope, season: 2025 };
    if (mismatch === 'week') envelope.week = 1;
    if (mismatch === 'family') envelope.family = 'transactions';
    if (mismatch === 'partial') envelope.completeness = 'partial';
    if (mismatch === 'timestamp') envelope.provenance = { ...provenance, checkedAt: 'invalid' };
    store.readSource.mockResolvedValue({ ...result, envelope });
    await expect(createPageAdministrationReader(() => store)(request)).rejects.toThrow(AdministrationSourceConflictError);
  });

  it('distinguishes transport failure and falls back without manufacturing stored evidence', async () => {
    store.readSource.mockRejectedValue(new Error('Unavailable connection'));
    expect(await createPageAdministrationReader(() => store)(request)).toEqual({ status: 'fallback', reason: 'unavailable' });
  });

  it.each(['stale', 'unknown-cache', 'future', 'uncached-request'] as const)('preserves the source TTL for %s evidence', async reason => {
    const result = available('matchups', 2);
    if (result.status !== 'available') throw new Error('Fixture unavailable');
    store.readSource.mockResolvedValue({ ...result, verifiedAt: reason === 'unknown-cache' ? null
      : reason === 'future' ? '2026-09-15T17:01:00.000Z'
        : reason === 'stale' ? '2026-09-15T16:59:00.000Z' : provenance.checkedAt });
    expect(await createPageAdministrationReader(() => store)({ ...request,
      ...(reason === 'uncached-request' ? { maxAgeSeconds: 0 } : {}) })).toEqual({ status: 'fallback', reason: 'stale' });
  });

  it('uses later proven network verification without restamping the original content observation', async () => {
    const result = await createPageAdministrationReader(() => store)(request);
    expect(result).toMatchObject({ status: 'available', requestCompletedAt: provenance.requestCompletedAt,
      sourceObservedAt: null });
  });

  it('rejects a known document conflict even when configuration has become stale', async () => {
    vi.setSystemTime(new Date('2026-09-15T18:00:00.000Z'));
    store.readSource.mockResolvedValue({ status: 'conflict' });
    await expect(createPageAdministrationReader(() => store)(request)).rejects.toThrow(AdministrationSourceConflictError);
  });
});
