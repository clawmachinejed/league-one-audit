import { beforeEach, describe, expect, it, vi } from 'vitest';

const workers = vi.hoisted(() => ({ lineup: vi.fn(), future: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./lineup-observation-worker', () => ({ runLineupObservationSync: workers.lineup }));
vi.mock('./future-projection-worker', () => ({ runFutureProjectionSync: workers.future }));

import { handleLineupObservationCronRequest } from './lineup-observation-http';
import { handleFutureProjectionCronRequest } from './future-projection-http';
import type { LineupObservationSyncResult } from './lineup-observation-worker';
import type { FutureProjectionSyncResult } from './future-projection-worker';

const counts = { checked: 14, changed: 2, unchanged: 10, notReady: 1, skipped: 1, failed: 0, pending: 2 };
const future = {
  status: 'completed' as const, action: 'materialize' as const,
  period: { season: 2026, seasonType: 'regular' as const, week: 5 },
  publishedLeagues: 1, unchangedLeagues: 1, failedLeagues: 0,
};

function request(path: string, query = '', authorized = true): Request {
  return new Request(`https://example.test/api/cron/${path}${query}`, {
    headers: authorized ? { authorization: 'Bearer private-value' } : {},
  });
}

async function expectResponse(result: Response, status: number, body: unknown): Promise<void> {
  expect(result.status).toBe(status);
  expect(result.headers.get('Cache-Control')).toBe('no-store');
  expect(await result.json()).toEqual(body);
}

beforeEach(() => { workers.lineup.mockReset(); workers.future.mockReset(); });

describe('lineup-observation cron HTTP boundary', () => {
  it('authenticates before invoking default or supplied workers', async () => {
    const run = vi.fn();
    await expectResponse(await handleLineupObservationCronRequest(request('lineup-observations', '', false), {
      secret: 'private-value', run,
    }), 401, { status: 'unauthorized' });
    await expectResponse(await handleLineupObservationCronRequest(request('lineup-observations'), {
      secret: '', run,
    }), 503, { status: 'unavailable' });
    expect(run).not.toHaveBeenCalled();
    expect(workers.lineup).not.toHaveBeenCalled();
  });

  it.each([
    { result: { status: 'unavailable' }, status: 503, body: { status: 'unavailable' } },
    { result: { status: 'failed' }, status: 500, body: { status: 'failed' } },
    { result: { status: 'skipped', reason: 'idle' }, status: 200, body: { status: 'skipped', reason: 'idle' } },
    { result: { status: 'skipped', reason: 'busy' }, status: 200, body: { status: 'skipped', reason: 'busy' } },
  ])('maps worker result $result to the approved response', async ({ result, status, body }) => {
    const run = vi.fn(async () => result as LineupObservationSyncResult);
    await expectResponse(await handleLineupObservationCronRequest(request('lineup-observations'), {
      secret: 'private-value', run,
    }), status, body);
    expect(run.mock.calls).toEqual([[]]);
  });

  it.each([0, 1, 14])('whitelists aggregate counts and surfaces $failed failed observations', async (failed) => {
    const result = { status: failed > 0 ? 'partial' as const : 'completed' as const, ...counts, failed,
      rawProviderPayload: 'private-payload', databaseUrl: 'private-connection', runId: 'not-public' };
    const run = vi.fn(async () => result);
    await expectResponse(await handleLineupObservationCronRequest(request('lineup-observations'), {
      secret: 'private-value', run,
    }), failed > 0 ? 503 : 200, { status: failed > 0 ? 'partial' : 'completed', ...counts, failed });
    expect(workers.future).not.toHaveBeenCalled();
  });

  it('ignores force parameters and calls the default facade without options', async () => {
    workers.lineup.mockResolvedValue({ status: 'completed', ...counts });
    await expectResponse(await handleLineupObservationCronRequest(request('lineup-observations', '?force=1'), {
      secret: 'private-value',
    }), 200, { status: 'completed', ...counts });
    expect(workers.lineup.mock.calls).toEqual([[]]);
  });

  it('returns only a safe failure when the worker throws', async () => {
    const run = vi.fn(async () => { throw new Error('Authorization: Bearer private-key postgres://private-connection'); });
    await expectResponse(await handleLineupObservationCronRequest(request('lineup-observations'), {
      secret: 'private-value', run,
    }), 500, { status: 'failed' });
  });
});

describe('future-projection cron HTTP boundary', () => {
  it('authenticates before invoking default or supplied workers', async () => {
    const run = vi.fn();
    await expectResponse(await handleFutureProjectionCronRequest(request('future-projections', '', false), {
      secret: 'private-value', run,
    }), 401, { status: 'unauthorized' });
    await expectResponse(await handleFutureProjectionCronRequest(request('future-projections'), {
      secret: '', run,
    }), 503, { status: 'unavailable' });
    expect(run).not.toHaveBeenCalled();
    expect(workers.future).not.toHaveBeenCalled();
  });

  it.each([
    { result: { status: 'disabled' }, status: 503, body: { status: 'unavailable' } },
    { result: { status: 'failed' }, status: 500, body: { status: 'failed' } },
    ...['idle', 'busy', 'deadline'].map((reason) => ({
      result: { status: 'skipped', reason }, status: 200, body: { status: 'skipped', reason },
    })),
  ])('maps worker result $result to the approved response', async ({ result, status, body }) => {
    const run = vi.fn(async () => result as FutureProjectionSyncResult);
    await expectResponse(await handleFutureProjectionCronRequest(request('future-projections'), {
      secret: 'private-value', run,
    }), status, body);
    expect(run.mock.calls).toEqual([[]]);
  });

  it.each([
    { action: 'projection-ingest' as const, failedLeagues: 0 },
    { action: 'materialize' as const, failedLeagues: 0 },
    { action: 'materialize' as const, failedLeagues: 1 },
  ])('flattens canonical period and whitelists action $action with failures $failedLeagues', async ({ action, failedLeagues }) => {
    const run = vi.fn(async () => ({ ...future, action, failedLeagues,
      rawError: 'private-provider-error', providerId: 'not-public', lease: 'not-public' }));
    await expectResponse(await handleFutureProjectionCronRequest(request('future-projections'), {
      secret: 'private-value', run,
    }), failedLeagues > 0 ? 503 : 200, {
      status: 'completed', action, season: 2026, seasonType: 'regular', week: 5,
      publishedLeagues: 1, unchangedLeagues: 1, failedLeagues,
    });
    expect(workers.lineup).not.toHaveBeenCalled();
  });

  it('ignores force parameters and calls the default facade without options', async () => {
    workers.future.mockResolvedValue(future);
    await expectResponse(await handleFutureProjectionCronRequest(request('future-projections', '?force=1'), {
      secret: 'private-value',
    }), 200, { status: 'completed', action: 'materialize', season: 2026, seasonType: 'regular', week: 5,
      publishedLeagues: 1, unchangedLeagues: 1, failedLeagues: 0 });
    expect(workers.future.mock.calls).toEqual([[]]);
  });

  it('returns only a safe failure when the worker throws', async () => {
    const run = vi.fn(async () => { throw new Error('Authorization: Bearer private-key postgres://private-connection'); });
    await expectResponse(await handleFutureProjectionCronRequest(request('future-projections'), {
      secret: 'private-value', run,
    }), 500, { status: 'failed' });
  });
});
