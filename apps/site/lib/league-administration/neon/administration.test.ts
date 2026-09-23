import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { normalizeAdministrationObservation } from '../normalize';
import { createLeagueAdministrationMethods } from './administration';

vi.mock('server-only', () => ({}));

function database(respond: (sql: string, parameters: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, parameters: readonly unknown[] = []) {
    return respond(sql, parameters) as readonly Row[];
  } };
}

const scope = { leagueKey: 'league1', provider: 'sleeper' as const, externalLeagueId: 'source', season: 2026 };
const row = {
  league_key: 'league1', season: 2026, provider: 'sleeper', external_league_id: 'source', observed_external_league_id: 'source',
  generation: 1, checked_at: '2026-09-12T12:00:02.000Z', read_conflict: null, observation_id: 'observation',
  verified_at: '2026-09-12T12:00:01.000Z',
  origin: 'network', request_started_at: '2026-09-12T12:00:00.000Z', request_completed_at: '2026-09-12T12:00:01.000Z',
  source_observed_at: '2026-09-12T12:00:01.000Z', configuration_version_id: null,
  normalizer_version: 'sleeper-administration-v1', completeness: 'complete', payload: [], family: 'transactions', week: 0,
};

describe('administration Neon adapter boundaries', () => {
  it('reconstructs transaction week zero separately from season-only scope', async () => {
    const store = createLeagueAdministrationMethods(database(() => [row]));
    expect(await store.readSource({ ...scope, family: 'transactions', week: 0 }))
      .toMatchObject({ status: 'available', envelope: { family: 'transactions', week: 0, payload: [] } });
  });

  it('separates database unavailability from corrupt stored heads and explicit scoring conflicts', async () => {
    expect(await createLeagueAdministrationMethods(database(() => { throw new Error('connection unavailable'); }))
      .readSource({ ...scope, family: 'league', week: null })).toMatchObject({ status: 'unavailable' });
    for (const corrupted of [{ ...row, checked_at: 'bad-time' }, { ...row, payload: { wrong: 'shape' } },
      { ...row, read_conflict: 'scoring_profile_change_requires_explicit_compatibility_and_period_review' }]) {
      expect(await createLeagueAdministrationMethods(database(() => [corrupted]))
        .readSource({ ...scope, family: 'transactions', week: 0 })).toMatchObject({ status: 'conflict' });
    }
  });

  it('does not return evidence from another source connection and recognizes a historical remap', async () => {
    expect(await createLeagueAdministrationMethods(database(() => [{ ...row, external_league_id: 'different' }]))
      .readSource({ ...scope, family: 'transactions', week: 0 })).toMatchObject({ status: 'conflict' });
    const store = createLeagueAdministrationMethods(database(sql => sql.includes('connection_history') ? [{ exists: 1 }] : []));
    expect(await store.readSourceByConnection({ provider: 'sleeper', externalLeagueId: 'retired-source', family: 'league', week: null }))
      .toMatchObject({ status: 'conflict', reason: 'source_connection_is_not_current_or_enrolled' });
  });

  it('fails closed for empty and partially registered enrollment groups', async () => {
    await expect(createLeagueAdministrationMethods(database(() => [])).listEnrollments()).rejects.toThrow(/no active enrollments/u);
    const incomplete = { league_id: 'league', league_key: 'league1', name: 'Name', league_season_id: null,
      season: 2026, provider: 'sleeper', external_league_id: null, scoring_profile_id: null };
    await expect(createLeagueAdministrationMethods(database(() => [incomplete])).listEnrollments(2026)).rejects.toThrow(/Missing administration/u);
  });

  it('reproduces the strict fleet failure when one unrelated intended member is not registered', async () => {
    const healthy = { league_id: 'healthy', league_key: 'league1', name: 'Healthy', league_season_id: 'season',
      season: 2026, intended_season: 2026, provider: 'sleeper', external_league_id: 'source', scoring_profile_id: 'profile' };
    const broken = { ...healthy, league_id: 'broken', league_key: 'another', league_season_id: null };
    await expect(createLeagueAdministrationMethods(database(() => [healthy, broken])).listEnrollments())
      .rejects.toThrow();
    const inventory = await createLeagueAdministrationMethods(database(() => [healthy, broken])).listEnrollmentInventory();
    expect(inventory.entries).toMatchObject([
      { status: 'ready', enrollment: { leagueKey: 'league1', externalLeagueId: 'source' } },
      { status: 'unavailable', intended: { leagueId: 'broken', leagueKey: 'another', season: 2026 }, reason: 'unregistered-season' },
    ]);
  });

  it('scopes current and historical lookup before validating unrelated enrollment rows', async () => {
    const healthy = { league_id: 'healthy', league_key: 'league1', name: 'Healthy', league_season_id: 'season',
      season: 2026, intended_season: 2026, provider: 'sleeper', external_league_id: 'source', scoring_profile_id: 'profile' };
    const queries: { sql: string; parameters: readonly unknown[] }[] = [];
    const methods = createLeagueAdministrationMethods(database((sql, parameters) => {
      queries.push({ sql, parameters });
      return [healthy];
    }));
    expect(await methods.readEnrollment({ leagueKey: 'league1' })).toMatchObject({ status: 'ready' });
    expect(queries[0]).toMatchObject({ parameters: ['league1'] });
    expect(queries[0].sql).toContain('AND league.league_key=$1');
    await methods.readEnrollment({ leagueKey: 'league1' }, 2026);
    expect(queries[1]).toMatchObject({ parameters: [2026, 'league1'] });
    expect(queries[1].sql).toContain('AND league.league_key=$2');
    await methods.readEnrollment({ provider: 'sleeper', externalLeagueId: 'source' });
    expect(queries[2].sql).toContain("AND connection.external_league_id=$1 AND connection.provider='sleeper'");
  });

  it('reports every implicated duplicate as unavailable without rejecting unrelated valid entries', async () => {
    const row = { league_id: 'one', league_key: 'one', name: 'One', league_season_id: 'season',
      season: 2026, intended_season: 2026, provider: 'sleeper', external_league_id: 'shared', scoring_profile_id: 'profile' };
    const result = await createLeagueAdministrationMethods(database(() => [row,
      { ...row, league_id: 'two', league_key: 'two' },
      { ...row, league_id: 'three', league_key: 'three', external_league_id: 'other' }])).listEnrollmentInventory();
    expect(result.entries.map(entry => entry.status)).toEqual(['unavailable', 'unavailable', 'ready']);
    expect(result.entries.slice(0, 2)).toMatchObject([{ reason: 'ambiguous-registration' }, { reason: 'ambiguous-registration' }]);
  });

  it('passes an explicit write fence intact into the sole SQL entry point', async () => {
    let captured: Record<string, unknown> | undefined;
    const store = createLeagueAdministrationMethods(database((sql, parameters) => {
      expect(sql).toContain('public.record_league_administration_observation');
      captured = JSON.parse(String(parameters[0])) as Record<string, unknown>;
      return [{ result: { status: 'changed', observationId: 'observation', generation: 1 } }];
    }));
    const input = normalizeAdministrationObservation({
      schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
      scope, family: 'transactions', week: 0, completeness: 'complete', payload: [],
      provenance: { origin: 'network', requestStartedAt: row.request_started_at, requestCompletedAt: row.request_completed_at,
        sourceObservedAt: row.source_observed_at, checkedAt: row.checked_at },
    });
    const fence = { jobKey: 'job', workerId: 'worker', generation: 2, deadlineAt: row.checked_at };
    await store.recordObservation(input, fence);
    expect(captured?.writeFence).toEqual(fence);
  });
});
