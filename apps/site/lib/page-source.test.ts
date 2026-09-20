import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAGUE_IDS } from './config';
import type { AdministrationEnvelope } from './league-administration/contracts';
import type { LeagueAdministrationStoreRead } from './league-administration/store-contracts';

vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: <T,>(value: T) => value }));
vi.mock('./league-administration/store', () => ({ getLeagueAdministrationStore: vi.fn() }));

import { AdministrationSourceConflictError, createPageAdministrationReader, type PageAdministrationRequest } from './page-source';

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

describe('accepted completed prior-season page source', () => {
  const historicalScope = { ...scope, externalLeagueId: 'annual-league-one-2025', season: 2025 };
  const historicalRequest: PageAdministrationRequest = { ...historicalScope, family: 'matchups', week: 2, historicalSeason: true };
  const historicalProvenance = { origin: 'bootstrap', requestStartedAt: null, requestCompletedAt: null,
    sourceObservedAt: null, checkedAt: '2026-01-15T17:00:00.000Z' } as const;
  function historical(family: AdministrationEnvelope['family'] = 'league', week: number | null = null):
  Extract<LeagueAdministrationStoreRead, { status: 'available' }> {
    const read = available(family, week);
    if (read.status !== 'available') throw new Error('Fixture unavailable');
    return { ...read, checkedAt: historicalProvenance.checkedAt, verifiedAt: historicalProvenance.checkedAt,
      envelope: { ...read.envelope, scope: historicalScope, provenance: historicalProvenance,
        payload: family === 'league' ? { league_id: historicalScope.externalLeagueId, season: '2025', status: 'complete' } : [] } };
  }
  beforeEach(() => {
    store.readSourceByConnection.mockResolvedValue(historical());
    store.readSource.mockResolvedValue(historical('matchups', 2));
  });

  it('uses accepted old completed-season documents without a fabricated verification or provider call', async () => {
    const configuration = historical();
    const document = historical('matchups', 2);
    store.readSourceByConnection.mockResolvedValue(configuration);
    store.readSource.mockResolvedValue(document);
    const original = JSON.stringify({ configuration, document });
    expect(await createPageAdministrationReader(() => store)(historicalRequest)).toEqual({ status: 'available', payload: [],
      origin: 'bootstrap', requestStartedAt: historicalProvenance.checkedAt, requestCompletedAt: historicalProvenance.checkedAt,
      sourceObservedAt: null });
    expect(store.readSource).toHaveBeenCalledWith({ ...historicalScope, family: 'matchups', week: 2 });
    expect(JSON.stringify({ configuration, document })).toBe(original);
  });

  it.each(['configuration', 'document'] as const)('requires proven network verification for historical %s, not just a cache check', async location => {
    const read = location === 'configuration' ? historical() : historical('matchups', 2);
    const unverified = { ...read, verifiedAt: null };
    if (location === 'configuration') store.readSourceByConnection.mockResolvedValue(unverified);
    else store.readSource.mockResolvedValue(unverified);
    expect(await createPageAdministrationReader(() => store)(historicalRequest)).toEqual({ status: 'fallback', reason: 'stale' });
  });

  it.each([
    ['2026-01-15T16:59:59.999Z', 'fallback'],
    ['2026-01-15T17:00:00.000Z', 'available'],
    ['2026-01-15T17:00:00.001Z', 'available'],
  ] as const)('requires the document verification %s to meet the completed configuration observation boundary', async (verifiedAt, status) => {
    store.readSource.mockResolvedValue({ ...historical('matchups', 2), verifiedAt });
    const result = await createPageAdministrationReader(() => store)(historicalRequest);
    expect(result.status).toBe(status);
    if (status === 'fallback') expect(result).toEqual({ status: 'fallback', reason: 'stale' });
  });

  it('uses the completed configuration observation time, not a later cache check, as the finality boundary', async () => {
    const configuration = historical();
    store.readSourceByConnection.mockResolvedValue({ ...configuration, checkedAt: '2026-08-01T00:00:00Z',
      envelope: { ...configuration.envelope, provenance: { ...historicalProvenance,
        requestStartedAt: '2026-01-15T16:59:59Z', requestCompletedAt: '2026-01-15T17:00:00Z',
        checkedAt: '2026-08-01T00:00:00Z' } } });
    store.readSource.mockResolvedValue({ ...historical('matchups', 2), verifiedAt: '2026-01-16T00:00:00Z' });
    expect((await createPageAdministrationReader(() => store)(historicalRequest)).status).toBe('available');
  });

  it('does not substitute a later cached request timestamp for pre-final provider verification', async () => {
    const document = historical('matchups', 2);
    store.readSource.mockResolvedValue({ ...document, verifiedAt: '2025-12-01T00:00:00Z',
      envelope: { ...document.envelope, provenance: { ...historicalProvenance, origin: 'cache',
        requestStartedAt: '2026-02-01T00:00:00Z', requestCompletedAt: '2026-02-01T00:00:01Z' } } });
    expect(await createPageAdministrationReader(() => store)(historicalRequest)).toEqual({ status: 'fallback', reason: 'stale' });
  });

  it('retains the original document clocks after a later verified unchanged retrieval proves finality', async () => {
    const document = historical('matchups', 2);
    const originalProvenance = { ...historicalProvenance, origin: 'cache' as const,
      requestStartedAt: '2025-12-01T00:00:00Z', requestCompletedAt: '2025-12-01T00:00:01Z' };
    store.readSource.mockResolvedValue({ ...document, verifiedAt: '2026-01-16T00:00:00Z',
      envelope: { ...document.envelope, provenance: originalProvenance } });
    expect(await createPageAdministrationReader(() => store)(historicalRequest)).toMatchObject({ status: 'available',
      requestStartedAt: originalProvenance.requestStartedAt, requestCompletedAt: originalProvenance.requestCompletedAt,
      origin: 'cache', sourceObservedAt: null });
  });

  it.each(['league', 'users', 'rosters', 'matchups'] as const)('allows only the supported historical %s scope', async family => {
    const week = family === 'matchups' ? 14 : null;
    store.readSource.mockResolvedValue(historical(family, week));
    expect((await createPageAdministrationReader(() => store)({ ...historicalRequest, family, week })).status).toBe('available');
    if (family === 'league') expect(store.readSource).not.toHaveBeenCalled();
  });

  it.each([
    { season: undefined }, { season: 2026 }, { season: 2027 }, { season: 2025.5 }, { season: 1919 },
    { leagueKey: undefined }, { leagueKey: 'unsupported-route' }, { externalLeagueId: '' },
    { family: 'transactions', week: 2 }, { family: 'drafts', week: null }, { family: 'traded_picks', week: null },
    { family: 'winners_bracket', week: null }, { family: 'losers_bracket', week: null },
    { week: 0 }, { week: 15 }, { week: 18 }, { week: null }, { week: 1.5 },
    { family: 'users', week: 1 }, { family: 'rosters', week: 1 }, { family: 'league', week: 1 },
  ] satisfies Partial<PageAdministrationRequest>[])('rejects an unproved or out-of-scope historical request: %j', async overrides => {
    await expect(createPageAdministrationReader(() => store)({ ...historicalRequest, ...overrides }))
      .rejects.toThrow(AdministrationSourceConflictError);
    expect(store.readSourceByConnection).not.toHaveBeenCalled();
  });

  it('uses the current UTC year for the prior-season boundary', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:30:00.000Z'));
    // Locally still December 31; only the UTC year determines whether 2025 is prior.
    const oldTime = '2025-12-01T00:00:00.000Z';
    const configuration = historical();
    const document = historical('matchups', 2);
    for (const [mock, read] of [[store.readSourceByConnection, configuration], [store.readSource, document]] as const) {
      mock.mockResolvedValue({ ...read, checkedAt: oldTime, verifiedAt: oldTime, envelope: { ...read.envelope,
        provenance: { ...historicalProvenance, checkedAt: oldTime } } });
    }
    expect((await createPageAdministrationReader(() => store)(historicalRequest)).status).toBe('available');
    vi.setSystemTime(new Date('2025-12-31T23:30:00.000Z'));
    await expect(createPageAdministrationReader(() => store)(historicalRequest)).rejects.toThrow(AdministrationSourceConflictError);
  });

  it.each([
    null, [], {}, { league_id: 'wrong', season: '2025', status: 'complete' },
    { league_id: historicalScope.externalLeagueId, season: '2024', status: 'complete' },
    { league_id: historicalScope.externalLeagueId, season: 2025, status: 'complete' },
    { league_id: historicalScope.externalLeagueId, season: '2025', status: 'in_season' },
    { league_id: historicalScope.externalLeagueId, season: '2025' },
  ])('does not weaken configuration identity or completion proof: %j', async payload => {
    const configuration = historical();
    store.readSourceByConnection.mockResolvedValue({ ...configuration, envelope: { ...configuration.envelope,
      payload: payload as AdministrationEnvelope['payload'] } });
    await expect(createPageAdministrationReader(() => store)(historicalRequest)).rejects.toThrow(AdministrationSourceConflictError);
    expect(store.readSource).not.toHaveBeenCalled();
  });

  it.each(['configuration', 'document'] as const)('preserves every envelope guard for historical %s', async location => {
    const base = location === 'configuration' ? historical() : historical('matchups', 2);
    const corruptions: Partial<AdministrationEnvelope>[] = [
      { schemaVersion: 'unknown' as AdministrationEnvelope['schemaVersion'] },
      { normalizerVersion: 'unknown' as AdministrationEnvelope['normalizerVersion'] },
      { dialect: 'unknown' as AdministrationEnvelope['dialect'] },
      { scope: { ...historicalScope, provider: 'unknown' as AdministrationEnvelope['scope']['provider'] } },
      { scope: { ...historicalScope, externalLeagueId: 'wrong' } },
      { scope: { ...historicalScope, season: 2024 } },
      { scope: { ...historicalScope, leagueKey: 'league2' } },
      { completeness: 'partial' }, { family: 'transactions' }, { week: 15 },
      { provenance: { ...historicalProvenance, checkedAt: 'invalid' } },
      { provenance: { ...historicalProvenance, origin: 'unknown' as AdministrationEnvelope['provenance']['origin'] } },
      { provenance: { ...historicalProvenance, requestStartedAt: '2026-01-16T00:00:00Z', requestCompletedAt: '2026-01-15T00:00:00Z' } },
    ];
    for (const corruption of corruptions) {
      const read = { ...base, envelope: { ...base.envelope, ...corruption } };
      if (location === 'configuration') store.readSourceByConnection.mockResolvedValue(read);
      else store.readSource.mockResolvedValue(read);
      await expect(createPageAdministrationReader(() => store)(historicalRequest)).rejects.toThrow(AdministrationSourceConflictError);
    }
  });

  it.each(['configuration', 'document'] as const)('retains a known historical %s conflict as an error', async location => {
    if (location === 'configuration') store.readSourceByConnection.mockResolvedValue({ status: 'conflict' });
    else store.readSource.mockResolvedValue({ status: 'conflict' });
    await expect(createPageAdministrationReader(() => store)(historicalRequest)).rejects.toThrow(AdministrationSourceConflictError);
  });

  it.each(['missing', 'disabled', 'unavailable'] as const)('retains %s historical fallback for absent storage evidence', async status => {
    store.readSourceByConnection.mockResolvedValue({ status });
    expect(await createPageAdministrationReader(() => store)(historicalRequest)).toEqual({ status: 'fallback', reason: status });
    store.readSourceByConnection.mockResolvedValue(historical());
    store.readSource.mockResolvedValue({ status });
    expect(await createPageAdministrationReader(() => store)(historicalRequest)).toEqual({ status: 'fallback', reason: status });
  });

  it.each(['configuration', 'document'] as const)('keeps invalid or future %s timestamps unusable despite the age exception', async location => {
    const base = location === 'configuration' ? historical() : historical('matchups', 2);
    for (const overrides of [{ checkedAt: 'invalid' }, { verifiedAt: 'invalid' },
      { checkedAt: '2027-01-01T00:00:00Z' }, { verifiedAt: '2027-01-01T00:00:00Z' }]) {
      const read = { ...base, ...overrides };
      if (location === 'configuration') store.readSourceByConnection.mockResolvedValue(read);
      else store.readSource.mockResolvedValue(read);
      expect(await createPageAdministrationReader(() => store)(historicalRequest)).toEqual({ status: 'fallback', reason: 'stale' });
    }
  });

  it.each([undefined, false])('leaves the existing freshness rule unchanged when historicalSeason is %s', async historicalSeason => {
    expect(await createPageAdministrationReader(() => store)({ ...historicalRequest, historicalSeason }))
      .toEqual({ status: 'fallback', reason: 'stale' });
  });
});

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
