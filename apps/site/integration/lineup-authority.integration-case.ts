import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectionStore, type LeaguePeriodAuthorityInput, type ProjectionStore } from '../lib/projection-store';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

describe.sequential('lineup authority in isolated Neon', () => {
  let database: IndependentDatabase;
  let store: ProjectionStore;
  const base: LeaguePeriodAuthorityInput = {
    leagueKey: 'authority-integration', defaultSeason: 2026, defaultSeasonType: 'reg', defaultWeek: 2,
    activeSeason: 2026, activeSeasonType: 'reg', activeWeek: 1,
    leagueLifecycle: 'active', nflPhase: 'regular', sourceProvider: 'sleeper',
    sourceRevision: 'authority-1', sourceObservedAt: '2026-09-13T17:00:00.000Z',
    verifiedAt: '2026-09-13T17:00:01.000Z',
    lineupShape: { sourceExternalLeagueId: 'authority-source', expectedRosterCount: 2,
      expectedStarterSlotCount: 9, expectedRosterIds: ['20', '10'] },
    defaultPeriodCadence: { games: [{ kickoffAt: '2026-09-13T17:00:00.000Z', date: '2026-09-13' }],
      isCurrentRegularPeriod: true },
  };
  beforeAll(() => { database = createIndependentDatabase(); store = createProjectionStore(database.database); });
  afterAll(async () => { await database.close(); });

  it('stores exact shape, preserves generation on recheck and rejects newer period regressions', async () => {
    expect(await store.upsertLeaguePeriodAuthority(base)).toMatchObject({ kind: 'stored' });
    const first = await store.readLeagueLineupAuthorities([base.leagueKey, 'authority-missing']);
    expect(first).toMatchObject([
      { kind: 'available', authority: { authorityGeneration: 1,
        lineupShape: { sourceExternalLeagueId: 'authority-source', expectedRosterIds: ['10', '20'] } } },
      { kind: 'missing' },
    ]);
    expect(await store.upsertLeaguePeriodAuthority({ ...base,
      sourceObservedAt: '2026-09-13T17:01:00.000Z', verifiedAt: '2026-09-13T17:01:01.000Z',
    })).toMatchObject({ kind: 'stored' });
    expect((await store.readLeagueLineupAuthorities([base.leagueKey]))[0])
      .toMatchObject({ kind: 'available', authority: { authorityGeneration: 1 } });
    expect(await store.upsertLeaguePeriodAuthority({ ...base, defaultWeek: 1, sourceRevision: 'regression',
      sourceObservedAt: '2026-09-13T17:02:00.000Z', verifiedAt: '2026-09-13T17:02:01.000Z',
    })).toEqual({ kind: 'conflict' });
    expect((await store.readLeagueLineupAuthorities([base.leagueKey]))[0])
      .toMatchObject({ kind: 'available', authority: { defaultWeek: 2, authorityGeneration: 1 } });
  });

  it('advances ownership only on accepted semantic changes and refuses contradictory replay', async () => {
    const replacement = { ...base,
      sourceObservedAt: '2026-09-13T17:03:00.000Z', verifiedAt: '2026-09-13T17:03:01.000Z',
      lineupShape: { ...base.lineupShape!, expectedRosterIds: ['10', '30'] },
    };
    expect(await store.upsertLeaguePeriodAuthority(replacement)).toMatchObject({ kind: 'stored' });
    expect((await store.readLeagueLineupAuthorities([base.leagueKey]))[0])
      .toMatchObject({ kind: 'available', authority: { authorityGeneration: 2,
        lineupShape: { expectedRosterIds: ['10', '30'] } } });
    expect(await store.upsertLeaguePeriodAuthority({ ...replacement,
      verifiedAt: '2026-09-13T17:03:02.000Z', lineupShape: base.lineupShape,
    })).toEqual({ kind: 'conflict' });
    expect(await store.upsertLeaguePeriodAuthority(base)).toMatchObject({ kind: 'ignored' });
    const oldRuntime = { ...replacement, lineupShape: undefined, defaultPeriodCadence: undefined,
      sourceObservedAt: '2026-09-13T17:04:00.000Z', verifiedAt: '2026-09-13T17:04:01.000Z' };
    expect(await store.upsertLeaguePeriodAuthority(oldRuntime)).toMatchObject({ kind: 'stored' });
    expect((await store.readLeagueLineupAuthorities([base.leagueKey]))[0])
      .toMatchObject({ kind: 'available', authority: { authorityGeneration: 2,
        lineupShape: { expectedRosterIds: ['10', '30'] } } });
  });

  it('keeps legacy authority unreadable to watchers until complete metadata exists', async () => {
    await store.upsertLeaguePeriodAuthority({ ...base, leagueKey: 'authority-legacy', lineupShape: undefined, defaultPeriodCadence: undefined });
    expect(await store.readLeagueLineupAuthorities(['authority-legacy', base.leagueKey]))
      .toMatchObject([{ kind: 'malformed' }, { kind: 'available' }]);
    const before = await ownerQuery<{ source_revision: string }>(
      'SELECT source_revision FROM league_period_authorities WHERE league_key = $1', [base.leagueKey]);
    expect(before[0].source_revision).toBe(base.sourceRevision);
  });
});
