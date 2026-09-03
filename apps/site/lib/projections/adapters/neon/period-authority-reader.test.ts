import { describe, expect, it, vi } from 'vitest';
import type { StoredLeagueAuthorityRead, StoredLeagueLineupAuthority } from './contracts';
import { externalLeagueRef } from '../../shared/provider-identity';
vi.mock('server-only', () => ({}));
import { createNeonPeriodAuthorityReader } from './period-authority-reader';

const asOf = new Date('2026-09-03T12:00:00Z');
const configurations = ['alpha', 'beta'].map((key) => ({ key, displayName: key,
  leagueRef: externalLeagueRef('sleeper', `source-${key}`), matchupWeekRange: { firstWeek: 1, lastWeek: 18 } }));
function stored(leagueKey = 'alpha', overrides: Partial<StoredLeagueLineupAuthority> = {}): StoredLeagueAuthorityRead {
  return { kind: 'available', leagueKey, authority: {
    leagueKey, defaultSeason: 2026, defaultSeasonType: 'reg', defaultWeek: 2,
    activeSeason: 2026, activeSeasonType: 'reg', activeWeek: 1, leagueLifecycle: 'active', nflPhase: 'regular',
    sourceProvider: 'sleeper', sourceRevision: 'fixture-source-revision', sourceObservedAt: asOf.toISOString(), verifiedAt: asOf.toISOString(),
    authorityGeneration: 7, defaultPeriodCadence: { games: [], isCurrentRegularPeriod: true },
    lineupShape: { sourceExternalLeagueId: `source-${leagueKey}`, expectedRosterCount: 2, expectedStarterSlotCount: 3, expectedRosterIds: ['roster-a', 'roster-b'] },
    ...overrides,
  } };
}
function reader(rows: readonly StoredLeagueAuthorityRead[], now = asOf) {
  const readLeagueLineupAuthorities = vi.fn(async () => rows);
  return {
    readLeagueLineupAuthorities,
    adapter: createNeonPeriodAuthorityReader({ readLeagueLineupAuthorities }, { listActiveLeagues: () => configurations }, { now: () => now }),
  };
}

describe('canonical durable period authority reader', () => {
  it('uses each registered league horizon rather than an independent scheduling range', async () => {
    const adapter = createNeonPeriodAuthorityReader({ readLeagueLineupAuthorities: async () => [stored()] },
      { listActiveLeagues: () => [{ ...configurations[0], matchupWeekRange: { firstWeek: 1, lastWeek: 1 } }] }, { now: () => asOf });
    expect(await adapter.readAuthorities(['alpha'], asOf, 600_000)).toEqual([{ kind: 'malformed', leagueKey: 'alpha' }]);
  });
  it('reads all requested authorities once and converts provider-scoped identities without losing the active period', async () => {
    const { adapter, readLeagueLineupAuthorities } = reader([stored('beta'), stored('alpha')]);
    const result = await adapter.readAuthorities(['alpha', 'beta'], asOf, 600_000);
    expect(readLeagueLineupAuthorities).toHaveBeenCalledExactlyOnceWith(['alpha', 'beta']);
    expect(result.map((item) => item.leagueKey)).toEqual(['alpha', 'beta']);
    expect(result[0]).toMatchObject({ kind: 'present', value: {
      authorityGeneration: 7, authority: { defaultDisplayPeriod: { season: 2026, seasonType: 'regular', week: 2 }, activeScoringPeriod: { season: 2026, seasonType: 'regular', week: 1 } },
      shape: { expectedRosterCount: 2, expectedStarterSlotCount: 3 },
    } });
    if (result[0].kind !== 'present') throw new Error('Expected available fixture.');
    expect(result[0].value.shape.expectedRosterRefs.map((ref) => [ref.resource, ref.provider, ref.league.externalId, ref.externalId]))
      .toEqual([['roster', 'sleeper', 'source-alpha', 'roster-a'], ['roster', 'sleeper', 'source-alpha', 'roster-b']]);
  });
  it('deduplicates requested keys without repeating database work', async () => {
    const { adapter, readLeagueLineupAuthorities } = reader([stored()]);
    expect(await adapter.readAuthorities(['alpha', 'alpha'], asOf, 600_000)).toHaveLength(1);
    expect(readLeagueLineupAuthorities).toHaveBeenCalledExactlyOnceWith(['alpha']);
  });
  it('keeps missing and malformed outcomes isolated from healthy leagues', async () => {
    for (const kind of ['missing', 'malformed'] as const) {
      const { adapter } = reader([{ kind, leagueKey: 'beta' }, stored()]);
      expect((await adapter.readAuthorities(['alpha', 'beta'], asOf, 600_000)).map((item) => item.kind)).toEqual(['present', kind]);
    }
  });
  it('returns missing for absent database rows and unregistered league keys', async () => {
    expect(await reader([]).adapter.readAuthorities(['alpha'], asOf, 600_000)).toEqual([{ kind: 'missing', leagueKey: 'alpha' }]);
    expect(await reader([stored('unknown')]).adapter.readAuthorities(['unknown'], asOf, 600_000)).toEqual([{ kind: 'missing', leagueKey: 'unknown' }]);
  });
  it('maps database failures without exposing their raw error text', async () => {
    const adapter = createNeonPeriodAuthorityReader({ readLeagueLineupAuthorities: async () => { throw new Error('postgres://credential@private'); } }, { listActiveLeagues: () => configurations }, { now: () => asOf });
    expect(await adapter.readAuthorities(['alpha', 'beta'], asOf, 600_000)).toEqual([{ kind: 'database-error', leagueKey: 'alpha' }, { kind: 'database-error', leagueKey: 'beta' }]);
  });
  it('rejects unexpected and duplicate response keys for the entire batch', async () => {
    for (const rows of [[stored(), stored()], [stored(), stored('unexpected')]]) {
      expect(await reader(rows).adapter.readAuthorities(['alpha', 'beta'], asOf, 600_000)).toEqual([{ kind: 'malformed', leagueKey: 'alpha' }, { kind: 'malformed', leagueKey: 'beta' }]);
    }
  });
  it('rejects mismatched embedded authority identity without losing a healthy sibling', async () => {
    const result = await reader([stored('alpha', { leagueKey: 'beta' }), stored('beta')]).adapter.readAuthorities(['alpha', 'beta'], asOf, 600_000);
    expect(result.map((item) => item.kind)).toEqual(['malformed', 'present']);
  });
  it('rejects both provider replacement and source league replacement', async () => {
    for (const overrides of [
      { sourceProvider: 'different-provider' },
      { lineupShape: { sourceExternalLeagueId: 'different-league', expectedRosterCount: 2, expectedStarterSlotCount: 3, expectedRosterIds: ['a', 'b'] } },
    ]) {
      const result = await reader([stored('alpha', overrides), stored('beta')]).adapter.readAuthorities(['alpha', 'beta'], asOf, 600_000);
      expect(result.map((item) => item.kind)).toEqual(['provider-mismatch', 'present']);
    }
  });
  it('uses the post-read clock so an authority verified while waiting does not look future dated', async () => {
    const verifiedLater = new Date(asOf.getTime() + 1_000);
    const laterClock = new Date(asOf.getTime() + 2_000);
    const result = await reader([stored('alpha', { sourceObservedAt: verifiedLater.toISOString(), verifiedAt: verifiedLater.toISOString() })], laterClock).adapter.readAuthorities(['alpha'], asOf, 600_000);
    expect(result[0].kind).toBe('present');
  });
  it('rejects genuinely future-dated and non-finite clock values', async () => {
    expect((await reader([stored('alpha', { verifiedAt: '2026-09-03T12:00:01Z' })]).adapter.readAuthorities(['alpha'], asOf, 600_000))[0].kind).toBe('malformed');
    expect((await reader([stored()], new Date('invalid')).adapter.readAuthorities(['alpha'], asOf, 600_000))[0].kind).toBe('malformed');
  });
  it('caps authority age at ten minutes even if a caller asks for more', async () => {
    const result = await reader([stored('alpha', { sourceObservedAt: '2026-09-03T11:49:59Z' }), stored('beta')]).adapter.readAuthorities(['alpha', 'beta'], asOf, 3_600_000);
    expect(result.map((item) => item.kind)).toEqual(['stale', 'present']);
  });
  it('honors a shorter caller age limit and accepts the exact age boundary', async () => {
    const { adapter } = reader([stored('alpha', { sourceObservedAt: '2026-09-03T11:59:00Z' })]);
    expect((await adapter.readAuthorities(['alpha'], asOf, 60_000))[0].kind).toBe('present');
    expect((await adapter.readAuthorities(['alpha'], asOf, 59_999))[0].kind).toBe('stale');
  });
  it('rejects invalid input before touching the store', async () => {
    const { adapter, readLeagueLineupAuthorities } = reader([stored()]);
    expect((await adapter.readAuthorities([' alpha'], asOf, 600_000))[0].kind).toBe('malformed');
    expect((await adapter.readAuthorities(['alpha'], new Date('invalid'), 600_000))[0].kind).toBe('malformed');
    expect((await adapter.readAuthorities(['alpha'], asOf, -1))[0].kind).toBe('malformed');
    expect(readLeagueLineupAuthorities).not.toHaveBeenCalled();
  });
  it('preserves preseason and completed lifecycle meanings', async () => {
    for (const leagueLifecycle of ['preseason', 'complete'] as const) {
      const result = await reader([stored('alpha', { leagueLifecycle, activeSeason: null, activeSeasonType: null, activeWeek: null })]).adapter.readAuthorities(['alpha'], asOf, 600_000);
      expect(result[0]).toMatchObject({ kind: 'present', value: { authority: { lifecycle: leagueLifecycle, activeScoringPeriod: null } } });
    }
  });
});
