import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  query: vi.fn(async () => []),
  neon: vi.fn(),
  fetch: vi.fn(async () => { throw new Error('Unexpected external request'); }),
  official: vi.fn(),
  calendar: vi.fn(),
  cadence: vi.fn(),
  lineup: vi.fn(),
  projectionSource: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@neondatabase/serverless', () => ({ neon: calls.neon }));
vi.mock('next/cache', () => ({ unstable_cache: <Value,>(value: Value) => value }));
vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('./sleeper', () => ({
  getCurrentMatchupPeriodContext: calls.calendar,
  getOfficialMatchups: calls.official,
  getProjectionCadenceInput: calls.cadence,
  getRawLineupMatchups: calls.lineup,
  getProjectionSyncInput: calls.projectionSource,
  getOverview: vi.fn(),
  getManager: vi.fn(),
  getTransactions: vi.fn(),
}));
vi.mock('../components/matchups-view', () => ({ MatchupsView: () => null }));
vi.mock('../components/manager-view', () => ({ ManagerView: () => null }));
vi.mock('../components/managers-view', () => ({ ManagersView: () => null }));
vi.mock('../components/standings-view', () => ({ StandingsView: () => null }));
vi.mock('../components/transactions-view', () => ({ TransactionsView: () => null }));

import { LeagueMatchupsPage } from '../components/league-pages';
import { LEAGUE_IDS } from './config';
import { createDatabase, getDatabase } from './database';
import { runFutureProjectionSync } from './future-projection-worker';
import { runLineupObservationSync } from './lineup-observation-worker';
import { runLiveProjectionSync } from './live-projection-worker';
import { handleMatchupsRevisionRequest, handleMatchupsSnapshotRequest } from './projection-http';
import { getProjectionStore } from './projection-store';
import type { MatchupsData } from './types';

// Deliberately fictional credentials and hostnames; no environment files or network access.
const remoteFixture = 'postgresql://fixture_runtime:fixture_password@ep-production-fixture.example.test/neondb?sslmode=require&application_name=fixture';
const localFixture = 'postgresql://fixture_runtime:fixture_password@localhost/fixture';
const disabled = { enabled: false, reason: 'preview-persistence-disabled' } as const;
let diagnosticCounts: (() => number)[];

beforeEach(() => {
  vi.clearAllMocks();
  calls.neon.mockImplementation(() => ({ query: calls.query }));
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('DATABASE_URL', undefined);
  vi.stubEnv('TANK01_API_KEY', undefined);
  vi.stubGlobal('fetch', calls.fetch);
  diagnosticCounts = (['debug', 'log', 'info', 'warn', 'error'] as const).map((method) => {
    const spy = vi.spyOn(console, method).mockImplementation(() => {});
    return () => spy.mock.calls.length;
  });
});

afterEach(() => {
  // Count-only assertions cannot print a connection fixture even if diagnostics regress.
  const emitted = diagnosticCounts.reduce((total, count) => total + count(), 0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  expect(emitted).toBe(0);
});

function expectNoDatabaseOrProviderWork(): void {
  for (const spy of [calls.neon, calls.query, calls.fetch, calls.cadence, calls.lineup, calls.projectionSource]) {
    expect(spy.mock.calls.length).toBe(0);
  }
}

describe('Preview persistence is intentionally disabled', () => {
  it.each([
    { label: 'absent', value: undefined },
    { label: 'blank', value: '   ' },
    { label: 'malformed', value: 'invalid database fixture' },
    { label: 'controlled Production-shaped', value: remoteFixture },
    { label: 'pooled', value: remoteFixture.replace('ep-production-fixture.', 'ep-production-fixture-pooler.') },
    { label: 'local', value: localFixture },
  ])('disables $label configuration before URL parsing or client construction', ({ value }) => {
    vi.stubEnv('DATABASE_URL', value);
    const parse = vi.fn(() => { throw new Error('Unexpected URL parsing'); });
    vi.stubGlobal('URL', parse);

    expect(createDatabase()).toEqual(disabled);
    expect(createDatabase(value)).toEqual(disabled);
    expect(getDatabase()).toEqual(disabled);
    expect(getProjectionStore().enabled).toBe(false);
    expect(parse.mock.calls.length).toBe(0);
    expectNoDatabaseOrProviderWork();
  });

  it('replaces an enabled cached database and store when the same configuration enters Preview', () => {
    vi.stubEnv('DATABASE_URL', remoteFixture);
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(getDatabase().enabled).toBe(true);
    expect(getProjectionStore().enabled).toBe(true);
    const constructed = calls.neon.mock.calls.length;

    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(getDatabase()).toEqual(disabled);
    expect(getProjectionStore().enabled).toBe(false);
    expect(calls.neon.mock.calls.length).toBe(constructed);

    vi.stubEnv('VERCEL_ENV', 'production');
    expect(getDatabase().enabled).toBe(true);
    expect(getProjectionStore().enabled).toBe(true);
    expect(calls.neon.mock.calls.length).toBe(constructed + 1);
    expect(calls.query.mock.calls.length).toBe(0);
  });

  it('keeps canonical store writes and all three worker lanes inert with a configured database', async () => {
    vi.stubEnv('DATABASE_URL', remoteFixture);
    vi.stubEnv('TANK01_API_KEY', 'configured-provider-fixture');
    const store = getProjectionStore();
    expect(store.enabled).toBe(false);
    await expect(store.publishSnapshot(undefined as never)).resolves.toEqual({ kind: 'disabled' });
    await expect(store.recordGameStates(undefined as never)).resolves.toEqual({ kind: 'disabled' });
    await expect(store.acquireJob(undefined as never)).resolves.toEqual({ kind: 'disabled' });
    await expect(runLiveProjectionSync()).resolves.toEqual({ status: 'disabled' });
    await expect(runLiveProjectionSync({ force: true })).resolves.toEqual({ status: 'disabled' });
    await expect(runFutureProjectionSync()).resolves.toEqual({ status: 'disabled' });
    await expect(runLineupObservationSync()).resolves.toEqual({ status: 'unavailable' });
    expect(calls.official.mock.calls.length).toBe(0);
    expect(calls.calendar.mock.calls.length).toBe(0);
    expectNoDatabaseOrProviderWork();
  });

  it.each(['league1', 'league2'] as const)('preserves official Sleeper fallback and unavailable snapshot APIs for %s', async (leagueKey) => {
    vi.stubEnv('DATABASE_URL', remoteFixture);
    const official: MatchupsData = {
      league: { season: '2026', rosterPositions: ['QB'], week: 2, maxWeek: 18 },
      teams: [], matchups: [], week: 2, updatedAt: '2026-09-06T12:00:00.000Z',
    };
    calls.calendar.mockResolvedValue({
      defaultSeason: 2026, defaultWeek: 2, activeSeason: 2026, activeWeek: 2,
      lifecycle: 'active', nflPhase: 'regular', temporalState: 'active', refreshDue: false,
    });
    calls.official.mockResolvedValue(official);
    const rendered = await LeagueMatchupsPage({
      leagueKey, leagueId: LEAGUE_IDS[leagueKey], searchParams: Promise.resolve({ week: '2' }),
    }) as ReactElement<{ data: MatchupsData; snapshotRevision: string | null; verifiedAt: string | null }>;
    expect(rendered.props.data).toBe(official);
    expect(rendered.props.snapshotRevision).toBeNull();
    expect(rendered.props.verifiedAt).toBeNull();
    expect(calls.official).toHaveBeenCalledExactlyOnceWith(LEAGUE_IDS[leagueKey], 2);
    expect(calls.calendar).toHaveBeenCalledExactlyOnceWith(LEAGUE_IDS[leagueKey], 2);

    for (const handler of [handleMatchupsRevisionRequest, handleMatchupsSnapshotRequest]) {
      const response = await handler(new Request('https://example.test/api/matchups?week=2'), leagueKey);
      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({ status: 'unavailable' });
    }
    expectNoDatabaseOrProviderWork();
  });
});

describe('non-Preview compatibility', () => {
  it.each([
    { label: 'Production', environment: 'production', value: remoteFixture },
    { label: 'Vercel development', environment: 'development', value: remoteFixture },
    { label: 'local development', environment: undefined, value: localFixture },
  ])('preserves enabled $label behavior with controlled fixtures', ({ environment, value }) => {
    vi.stubEnv('VERCEL_ENV', environment);
    vi.stubEnv('DATABASE_URL', value);
    expect(createDatabase().enabled).toBe(true);
    expect(calls.neon.mock.calls.length).toBe(1);
    expect(calls.query.mock.calls.length).toBe(0);
    expect(calls.fetch.mock.calls.length).toBe(0);
  });

  it.each(['production', 'development', undefined])('preserves missing and invalid configuration outside Preview (%s)', (environment) => {
    vi.stubEnv('VERCEL_ENV', environment);
    expect(createDatabase()).toEqual({ enabled: false, reason: 'missing-database-url' });
    expect(createDatabase('invalid database fixture')).toEqual({ enabled: false, reason: 'invalid-database-url' });
    expectNoDatabaseOrProviderWork();
  });
});
