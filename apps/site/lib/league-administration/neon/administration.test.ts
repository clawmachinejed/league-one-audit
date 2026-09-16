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
