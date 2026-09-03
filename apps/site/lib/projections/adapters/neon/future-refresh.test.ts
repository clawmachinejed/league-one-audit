import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createFakeProjectionDatabase } from '../../../projection-store-test-support';
import { createFutureRefreshMethods } from './future-refresh';

const period = { season: 2026, seasonType: 'reg' as const, week: 2 };
const target = { period, weekDistance: 1 };
const attemptOne = '11111111-1111-4111-8111-111111111111';
const attemptTwo = '22222222-2222-4222-8222-222222222222';
const attemptThree = '55555555-5555-4555-8555-555555555555';
const observationId = '33333333-3333-4333-8333-333333333333';
const contentId = '44444444-4444-4444-8444-444444444444';

function marker(statement: string): string | null {
  return statement.match(/projection-store:([a-z0-9-]+)/u)?.[1] ?? null;
}

function planRow(leagueKey: string, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    season: 2026,
    season_type: 'reg',
    week: 2,
    week_distance: 1,
    projection_next_refresh_at: '2026-09-13T18:00:00.000Z',
    projection_last_attempted_at: null,
    projection_last_succeeded_at: null,
    projection_consecutive_failures: 0,
    projection_last_failure_code: null,
    projection_attempt_expires_at: null,
    projection_last_observation_id: null,
    projection_last_content_id: null,
    projection_due: true,
    current_observation_id: observationId,
    current_content_id: contentId,
    league_key: leagueKey,
    materialization_next_refresh_at: '2026-09-13T18:00:00.000Z',
    materialization_last_attempted_at: null,
    materialization_last_succeeded_at: null,
    last_source_revision: null,
    materialization_last_observation_id: null,
    materialization_last_content_id: null,
    last_snapshot_revision: null,
    materialization_consecutive_failures: 0,
    materialization_last_failure_code: null,
    materialization_attempt_expires_at: null,
    materialization_due: true,
    ...overrides,
  };
}

describe('durable future refresh persistence', () => {
  it('seeds by week distance, preserves same-tier due dates, and expedites closer tiers', async () => {
    const fake = createFakeProjectionDatabase(() => [{
      projection_count: 2,
      materialization_count: 4,
    }]);
    const store = createFutureRefreshMethods(fake.database);

    await expect(store.ensureFutureRefreshStates({
      projectionProvider: ' Tank01 ',
      normalizerVersion: 'tank01-week-v1',
      modelVersion: 'clock-v1',
      targets: [
        { period: { ...period, week: 3 }, weekDistance: 2 },
        target,
      ],
      leagueKeys: ['league2', 'league1', 'league1'],
      seededAt: '2026-09-13T17:00:00.000Z',
    })).resolves.toEqual({
      kind: 'stored',
      value: { projectionPeriodsInserted: 2, materializationsInserted: 4 },
    });

    expect(fake.calls[0].parameters).toEqual([
      JSON.stringify([
        { season: 2026, season_type: 'reg', week: 2, week_distance: 1 },
        { season: 2026, season_type: 'reg', week: 3, week_distance: 2 },
      ]),
      'tank01',
      'tank01-week-v1',
      'clock-v1',
      '2026-09-13T17:00:00.000Z',
      ['league1', 'league2'],
    ]);
    expect(fake.calls[0].statement).toContain("(week_distance - 1) * interval '15 minutes'");
    expect(fake.calls[0].statement).toContain(
      'week_distance IS DISTINCT FROM period.week_distance',
    );
    expect(fake.calls[0].statement).toContain(
      'WHEN period.week_distance < refresh.week_distance',
    );
    expect(fake.calls[0].statement).toContain(
      'THEN LEAST(refresh.next_refresh_at, $5::timestamptz)',
    );
  });

  it('reads complete per-period plans with content and observation lineage', async () => {
    const fake = createFakeProjectionDatabase(() => [
      planRow('league1'),
      planRow('league2', {
        materialization_last_succeeded_at: '2026-09-13T17:30:00.000Z',
        last_source_revision: 'source-r1',
        materialization_last_observation_id: observationId,
        materialization_last_content_id: contentId,
        last_snapshot_revision: 'snapshot-r1',
        materialization_due: false,
      }),
    ]);
    const store = createFutureRefreshMethods(fake.database);

    const result = await store.readFutureRefreshPlan({
      projectionProvider: 'tank01',
      normalizerVersion: 'tank01-week-v1',
      modelVersion: 'clock-v1',
      targets: [target],
      leagueKeys: ['league1', 'league2'],
      asOf: '2026-09-13T18:00:00.000Z',
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      period,
      weekDistance: 1,
      expectedMaterializations: 2,
      successfulMaterializations: 1,
      projection: {
        due: true,
        currentSlate: { observationId, contentId },
      },
      materializations: [
        { leagueKey: 'league1', due: true, lastSlate: null },
        { leagueKey: 'league2', due: false, lastSlate: { observationId, contentId } },
      ],
    });
    expect(fake.calls[0].statement).toContain('ORDER BY period.week_distance');
    expect(fake.calls[0].statement).toContain('current_observation.quality = \'complete\'');
  });

  it('fails closed when any requested league state is absent', async () => {
    const fake = createFakeProjectionDatabase(() => [planRow('league1')]);
    const store = createFutureRefreshMethods(fake.database);
    await expect(store.readFutureRefreshPlan({
      projectionProvider: 'tank01', normalizerVersion: 'v1', modelVersion: 'clock-v1',
      targets: [target], leagueKeys: ['league1', 'league2'],
      asOf: '2026-09-13T18:00:00.000Z',
    })).rejects.toThrow('Future refresh state is incomplete');
  });

  it('supports success, later failure with backoff, retry, and later success', async () => {
    let beginCount = 0;
    const fake = createFakeProjectionDatabase((call) => {
      const operation = marker(call.statement);
      if (operation === 'begin-future-projection-refresh') {
        beginCount += 1;
        const attemptId = [attemptOne, attemptTwo, attemptThree][beginCount - 1];
        return [{
          result_kind: 'acquired', attempt_count: beginCount,
          attempt_id: attemptId, lease_until: '2026-09-13T18:10:00.000Z',
          consecutive_failures: 0, next_refresh_at: '2026-09-13T18:10:00.000Z',
        }];
      }
      if (operation === 'complete-future-projection-refresh') return [{
        consecutive_failures: 0,
        next_refresh_at: '2026-09-13T19:00:00.000Z',
        materializations_woken: 2,
      }];
      if (operation === 'fail-future-projection-refresh') return [{
        consecutive_failures: 1,
        next_refresh_at: '2026-09-13T19:05:00.000Z',
        materializations_woken: 0,
      }];
      return [];
    });
    const store = createFutureRefreshMethods(fake.database);
    const key = { projectionProvider: 'tank01', normalizerVersion: 'v1', period };

    await store.beginFutureProjectionRefresh({
      ...key, attemptId: attemptOne, attemptedAt: '2026-09-13T17:00:00.000Z', leaseSeconds: 600,
    });
    await store.completeFutureProjectionRefresh({
      ...key, attemptId: attemptOne, completedAt: '2026-09-13T17:05:00.000Z',
      nextRefreshAt: '2026-09-13T18:00:00.000Z', slate: { observationId, contentId },
    });
    await store.beginFutureProjectionRefresh({
      ...key, attemptId: attemptTwo, attemptedAt: '2026-09-13T19:00:00.000Z', leaseSeconds: 600,
    });
    await expect(store.failFutureProjectionRefresh({
      ...key, attemptId: attemptTwo, failedAt: '2026-09-13T19:01:00.000Z',
      failureCode: 'projection-slate-incomplete',
    })).resolves.toMatchObject({
      kind: 'updated', consecutiveFailures: 1,
      nextRefreshAt: '2026-09-13T19:05:00.000Z',
    });
    await store.beginFutureProjectionRefresh({
      ...key, attemptId: attemptThree, attemptedAt: '2026-09-13T19:05:00.000Z', leaseSeconds: 600,
    });
    await store.completeFutureProjectionRefresh({
      ...key, attemptId: attemptThree, completedAt: '2026-09-13T19:06:00.000Z',
      nextRefreshAt: '2026-09-13T20:00:00.000Z', slate: { observationId, contentId },
    });

    const operations = fake.calls.map((call) => marker(call.statement));
    expect(operations).toEqual([
      'begin-future-projection-refresh',
      'complete-future-projection-refresh',
      'begin-future-projection-refresh',
      'fail-future-projection-refresh',
      'begin-future-projection-refresh',
      'complete-future-projection-refresh',
    ]);
    expect(fake.calls[3].statement).toContain("WHEN consecutive_failures = 0 THEN interval '5 minutes'");
    expect(fake.calls[3].statement).toContain("WHEN consecutive_failures = 1 THEN interval '15 minutes'");
    expect(fake.calls[3].statement).toContain("WHEN consecutive_failures = 2 THEN interval '1 hour'");
    expect(fake.calls[3].statement).toContain("ELSE interval '6 hours'");
  });

  it('validates periods, leases, completion ordering, and failure codes before SQL', async () => {
    const fake = createFakeProjectionDatabase();
    const store = createFutureRefreshMethods(fake.database);
    await expect(store.beginFutureProjectionRefresh({
      projectionProvider: 'tank01', normalizerVersion: 'v1',
      period: { ...period, week: 19 }, attemptId: attemptOne,
      attemptedAt: '2026-09-13T17:00:00.000Z', leaseSeconds: 60,
    })).rejects.toThrow('period is invalid');
    await expect(store.beginFutureProjectionRefresh({
      projectionProvider: 'tank01', normalizerVersion: 'v1', period,
      attemptId: attemptOne, attemptedAt: '2026-09-13T17:00:00.000Z', leaseSeconds: 901,
    })).rejects.toThrow('between 1 and 900');
    await expect(store.completeFutureProjectionRefresh({
      projectionProvider: 'tank01', normalizerVersion: 'v1', period,
      attemptId: attemptOne, completedAt: '2026-09-13T18:00:00.000Z',
      nextRefreshAt: '2026-09-13T18:00:00.000Z', slate: { observationId, contentId },
    })).rejects.toThrow('must follow completion time');
    await expect(store.failFutureProjectionRefresh({
      projectionProvider: 'tank01', normalizerVersion: 'v1', period,
      attemptId: attemptOne, failedAt: '2026-09-13T18:00:00.000Z',
      failureCode: 'raw provider error' as never,
    })).rejects.toThrow('failure code is invalid');
    expect(fake.calls).toEqual([]);
  });

  it('locks migration lineage, retryability, identities, and runtime grants', () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const migration = readFileSync(join(
      directory,
      '../../../../migrations/005_future_projection_refresh.sql',
    ), 'utf8');
    const slateMigration = readFileSync(join(
      directory,
      '../../../../migrations/004_durable_projection_slates.sql',
    ), 'utf8');
    const grants = readFileSync(join(directory, '../../../../scripts/provision-runtime-role.sql'), 'utf8');

    expect(migration).toMatch(
      /league_key,\s+projection_provider,\s+season,\s+season_type,\s+week,\s+normalizer_version,\s+model_version/u,
    );
    expect(migration).toMatch(
      /last_projection_slate_observation_id,\s+last_projection_slate_content_id,\s+projection_provider,\s+season,\s+season_type,\s+week,\s+normalizer_version/u,
    );
    expect(migration).not.toMatch(/ON DELETE SET NULL/iu);
    expect(migration).toContain('week_distance smallint NOT NULL CHECK (week_distance BETWEEN 1 AND 18)');
    expect(migration).toContain('last_succeeded_at IS NULL OR last_attempted_at IS NOT NULL');
    expect(migration).not.toContain('last_succeeded_at >= last_attempted_at');
    expect(migration).not.toMatch(/last_failure_(?:message|detail|error)/iu);
    expect(slateMigration.match(/week BETWEEN 1 AND 18/gu)).toHaveLength(3);
    expect(slateMigration).not.toContain('week BETWEEN 0 AND 30');
    expect(grants).toContain('projection_period_refresh_states');
    expect(grants).toContain('league_week_materialization_states');
  });
});
