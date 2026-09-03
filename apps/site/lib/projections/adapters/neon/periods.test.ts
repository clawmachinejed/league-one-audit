import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { DatabaseRow } from '../../../database';
import {
  createFakeProjectionDatabase,
  projectionStoreSnapshotRow,
} from '../../../projection-store-test-support';
import type { LeaguePeriodAuthorityInput } from './contracts';
import { createPeriodMethods } from './periods';

const input: LeaguePeriodAuthorityInput = {
  leagueKey: 'league1', defaultSeason: 2026, defaultSeasonType: 'reg', defaultWeek: 2,
  activeSeason: 2026, activeSeasonType: 'reg', activeWeek: 1,
  leagueLifecycle: 'active', nflPhase: 'regular', sourceProvider: 'Sleeper',
  sourceRevision: 'revision-2', sourceObservedAt: '2026-09-13T18:00:00.000Z',
  verifiedAt: '2026-09-13T18:00:01.000Z',
};

const projectionIdentity = {
  projectionProvider: 'tank01',
  normalizerVersion: 'canonical-projection-slate-v1',
  modelVersion: 'clock-v1',
} as const;

function authorityRow(overrides: Readonly<Record<string, unknown>> = {}): DatabaseRow {
  return {
    league_key: 'league1', default_season: 2026, default_season_type: 'reg', default_week: 2,
    active_season: 2026, active_season_type: 'reg', active_week: 1,
    league_lifecycle: 'active', nfl_phase: 'regular', source_provider: 'sleeper',
    source_revision: 'revision-2', source_observed_at: '2026-09-13T18:00:00.000Z',
    period_verified_at: '2026-09-13T18:00:01.000Z', result_kind: 'stored',
    ...overrides,
  };
}

describe('Neon period authority methods', () => {
  it('writes a normalized monotonic authority record with a fixed parameter contract', async () => {
    const fake = createFakeProjectionDatabase(() => [authorityRow()]);
    const methods = createPeriodMethods(fake.database);

    await expect(methods.upsertLeaguePeriodAuthority(input)).resolves.toEqual({
      kind: 'stored',
      value: { ...input, sourceProvider: 'sleeper' },
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].parameters).toEqual([
      'league1', 2026, 'reg', 2, 2026, 'reg', 1, 'active', 'regular', 'sleeper',
      'revision-2', '2026-09-13T18:00:00.000Z', '2026-09-13T18:00:01.000Z',
    ]);
    expect(fake.calls[0].statement).toContain(
      'EXCLUDED.source_observed_at > league_period_authorities.source_observed_at',
    );
    expect(fake.calls[0].statement).toContain(
      'EXCLUDED.source_revision = league_period_authorities.source_revision',
    );
  });

  it.each(['verified', 'ignored'] as const)('returns the database monotonic %s outcome', async (kind) => {
    const fake = createFakeProjectionDatabase(() => [authorityRow({ result_kind: kind })]);
    await expect(createPeriodMethods(fake.database).upsertLeaguePeriodAuthority(input))
      .resolves.toMatchObject({ kind, value: { defaultWeek: 2, activeWeek: 1 } });
  });

  it('fails closed on a same-observation conflicting revision', async () => {
    const fake = createFakeProjectionDatabase(() => [authorityRow({ result_kind: 'conflict' })]);
    await expect(createPeriodMethods(fake.database).upsertLeaguePeriodAuthority(input))
      .resolves.toEqual({ kind: 'conflict' });
  });

  it('resolves the default or requested exact week through the current pointer without latest-week ordering', async () => {
    const fake = createFakeProjectionDatabase(({ parameters }) => [{
      ...authorityRow(),
      ...(parameters[1] === 1 ? projectionStoreSnapshotRow() : { snapshot_id: null }),
    }]);
    const methods = createPeriodMethods(fake.database);

    await expect(methods.readMatchupSnapshotByLeagueKey('league1', undefined, projectionIdentity))
      .resolves.toMatchObject({ authority: { defaultWeek: 2 }, snapshot: null });
    await expect(methods.readMatchupSnapshotByLeagueKey('league1', 1, projectionIdentity))
      .resolves.toMatchObject({ authority: { activeWeek: 1 }, snapshot: { week: 1 } });
    expect(fake.calls.map((call) => call.parameters)).toEqual([
      ['league1', null, 'tank01', 'canonical-projection-slate-v1', 'clock-v1'],
      ['league1', 1, 'tank01', 'canonical-projection-slate-v1', 'clock-v1'],
    ]);
    expect(fake.calls[0].statement).toContain('COALESCE($2::smallint, authority.default_week)');
    expect(fake.calls[0].statement).toContain('current.week = target.target_week');
    expect(fake.calls[0].statement).toContain('snapshot.model_version = $5');
    expect(fake.calls[0].statement).not.toMatch(/ORDER BY[^;]*week/iu);
  });

  it('returns the matching durable future materialization lineage without multiplying rows', async () => {
    const fake = createFakeProjectionDatabase(() => [{
      ...authorityRow(),
      ...projectionStoreSnapshotRow(),
      future_next_refresh_at: '2026-09-14T00:00:00.000Z',
      future_last_succeeded_at: '2026-09-13T18:00:00.000Z',
      future_attempt_expires_at: null,
      future_last_slate_content_id: 'slate-content-1',
      future_current_slate_content_id: 'slate-content-1',
      future_last_snapshot_revision: 'snapshot-revision',
    }]);
    const result = await createPeriodMethods(fake.database)
      .readMatchupSnapshotByLeagueKey('league1', 1, projectionIdentity);

    expect(result?.futureRefresh).toEqual({
      nextRefreshAt: '2026-09-14T00:00:00.000Z',
      lastSucceededAt: '2026-09-13T18:00:00.000Z',
      activeAttemptExpiresAt: null,
      lastProjectionSlateContentId: 'slate-content-1',
      currentProjectionSlateContentId: 'slate-content-1',
      lastSnapshotRevision: 'snapshot-revision',
    });
    expect(fake.calls[0].statement).toContain('LEFT JOIN LATERAL');
    expect(fake.calls[0].statement).toContain('material.projection_provider = $3');
    expect(fake.calls[0].statement).toContain('material.normalizer_version = $4');
    expect(fake.calls[0].statement).toContain('material.model_version = $5');
    expect(fake.calls[0].statement).not.toContain('ORDER BY');
  });

  it('rejects malformed active-period rows', async () => {
    const fake = createFakeProjectionDatabase(() => [authorityRow({ active_week: 19 })]);
    await expect(createPeriodMethods(fake.database)
      .readMatchupSnapshotByLeagueKey('league1', 1, projectionIdentity))
      .rejects.toThrow('Active week is invalid.');
  });
});
