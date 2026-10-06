import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { runPublicIntakeStep } from '../public-intake';
import { createPublicIntakeStore } from './public-intake';
import { createLeagueAdministrationStore } from '../store';
import { LEAGUE_SETTINGS_POLICY, LEAGUE_SETTINGS_FIELDS, leagueSettingsScope } from '../../aggregator/league-settings';
import type { NormalizedAdministrationObservation } from '../contracts';
import type { PublicIntakeWork } from '../public-intake-contracts';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { normalizeAdministrationObservation } from '../normalize';
import { createLeagueAdministrationMethods } from './administration';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));

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
  it('reserves source history with the real SQL argument order and preserves submillisecond database time', async () => {
    const mapping = { connectionId: '11111111-1111-4111-8111-111111111111', leagueSeasonId: '22222222-2222-4222-8222-222222222222',
      revisionId: '33333333-3333-4333-8333-333333333333', generation: 1, scope };
    const capture = { id: '44444444-4444-4444-8444-444444444444', reservedAt: '2026-09-16T17:59:59.123456+00:00' };
    const respond = vi.fn((sql: string, parameters: readonly unknown[]) => {
      expect(sql).toContain('begin_league_calculation_source_capture($1::jsonb,$2::integer,$3::uuid)');
      expect(parameters).toEqual([JSON.stringify(mapping), 3, capture.id]);
      return [{ result: capture }];
    });
    expect(await createLeagueAdministrationMethods(database(respond)).beginCalculationSourceCapture(mapping, 3, capture.id)).toEqual(capture);
    expect(respond).toHaveBeenCalledOnce();
  });

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


it('serializes sibling v2 evidence into the same atomic writer while preserving the v1 input', async () => {
  const input = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope, family: 'rosters', week: null,
    completeness: 'complete', payload: [{ roster_id: 1, owner_id: 0, co_owners: ['co'] }],
    provenance: { origin: 'network', requestStartedAt: row.request_started_at, requestCompletedAt: row.request_completed_at,
      sourceObservedAt: row.source_observed_at, checkedAt: row.checked_at } }, { expectedRosterCount: 1, managerEvidenceVersion: 'v2' });
  const players = { attempt: { id: 'players', scopeId: 'players', ordinal: 1, expectedGeneration: 0 } };
  const managers = { attempt: { id: 'managers', scopeId: 'managers', ordinal: 1, expectedGeneration: 0 } };
  const evidence = { attempt: { id: 'evidence', scopeId: 'evidence', ordinal: 1, expectedGeneration: 0 } };
  const query = vi.fn((_sql: string, parameters: readonly unknown[]) => {
    expect(JSON.parse(String(parameters[0]))).toEqual({ ...input, rosterAcceptance: players,
      teamManagerAcceptance: managers, teamManagerEvidenceAcceptance: evidence });
    return [{ result: { status: 'rejected', teamManagerEvidenceAcceptance: { status: 'accepted', receiptId: 'receipt', acceptedGeneration: 1 } } }];
  });
  const result = await createLeagueAdministrationMethods(database(query)).recordObservation(input, undefined, undefined,
    players, managers, undefined, undefined, undefined, undefined, undefined, evidence);
  expect(query).toHaveBeenCalledOnce();
  expect(result.teamManagerEvidenceAcceptance).toMatchObject({ status: 'accepted' });
});


describe('official-only bootstrap and typed settings through the existing worker', () => {
  it.each(['absent', 'null', 'empty'] as const)('preserves all three native field states (%s) and later scoring without profile activation', async state => {
    const requestId = randomUUID(); const leagueId = randomUUID();
    const native = '98765432109876543210';
    const mapping = { connectionId: randomUUID(), leagueSeasonId: randomUUID(), revisionId: randomUUID(), generation: 1,
      scope: { leagueKey: 'sleeper-' + native, provider: 'sleeper' as const, externalLeagueId: native, season: 2026 } };
    let payload: Record<string, unknown> = { league_id: native, season: '2026', sport: 'nfl', name: 'Preconfiguration', total_rosters: 1 };
    if (state !== 'absent') payload = { ...payload, settings: state === 'null' ? null : {},
      scoring_settings: state === 'null' ? null : {}, roster_positions: state === 'null' ? null : [] };
    const originalPayload = structuredClone(payload);
    let work: PublicIntakeWork = { requestId, revision: 2, kind: 'bootstrap', externalLeagueId: native, season: 2026 };
    let registered = false;
    const checkpoints: Record<string, unknown>[] = [];
    const writes: (NormalizedAdministrationObservation & Record<string, unknown>)[] = [];
    const events: string[] = [];
    const receipt = () => ({ status: 'accepted', receiptId: randomUUID(), acceptedGeneration: 1 });
    let settingsRow: DatabaseRow | undefined;
    const query = vi.fn(async (sql: string, parameters: readonly unknown[] = []): Promise<readonly DatabaseRow[]> => {
      if (sql.includes('public-data-intake:next')) return [{ result: work }];
      if (sql.includes('public-data-intake:admit-dispatch')) return [{ admitted: true }];
      if (sql.includes('public-data-intake:recover')) return [];
      if (sql.includes('public-data-intake:resolve-registration')) return registered ? [{
        league_key: mapping.scope.leagueKey, season: 2026, league_id: leagueId, league_season_id: mapping.leagueSeasonId }] : [];
      if (sql.includes('public-data-intake:checkpoint')) {
        const checkpoint = JSON.parse(String(parameters[1])) as Record<string, unknown>; checkpoints.push(checkpoint);
        expect(checkpoint).not.toHaveProperty('failed'); expect(checkpoint).not.toHaveProperty('diagnostic');
        work = { requestId, revision: work.revision + 1, kind: 'core', externalLeagueId: native, season: 2026 }; return [];
      }
      if (sql.includes('read-source-mapping')) return [{ connection_id: mapping.connectionId, league_season_id: mapping.leagueSeasonId,
        revision_id: mapping.revisionId, mapping_generation: 1, league_key: mapping.scope.leagueKey,
        season: 2026, provider: 'sleeper', external_league_id: native }];
      if (sql.includes('begin-roster-capture')) {
        events.push('reserve-rosters');
        return [{ players: { id: parameters[1], scopeId: randomUUID(), ordinal: 1, expectedGeneration: 0 },
          managers: { id: parameters[5], scopeId: randomUUID(), ordinal: 1, expectedGeneration: 0 } }];
      }
      if (sql.includes('begin-league-settings')) {
        events.push('reserve-settings');
        return [{ result: { id: parameters[1], scopeId: randomUUID(), ordinal: 1, expectedGeneration: 0 } }];
      }
      if (sql.includes('record-observation')) {
        const input = JSON.parse(String(parameters[0])) as NormalizedAdministrationObservation & Record<string, unknown>;
        writes.push(input); expect(input.status).toBe('accepted'); expect(input.sourceMapping).toEqual(mapping);
        const observationId = randomUUID();
        if (input.envelope.family === 'league') {
          const accepted = receipt(); const contentId = randomUUID();
          settingsRow = { identity: { scope: leagueSettingsScope(mapping), policy: LEAGUE_SETTINGS_POLICY }, generation: 1,
            source_mapping_revision_id: mapping.revisionId, source_mapping: mapping, league_id: leagueId,
            league_season_id: mapping.leagueSeasonId, provider: 'sleeper', external_league_id: native,
            normalizer_version: input.envelope.normalizerVersion, completeness: 'complete', receipt_id: accepted.receiptId,
            attempt_id: (input.leagueSettingsAcceptance as { attempt: { id: string } }).attempt.id,
            legacy_observation_id: observationId, ordinal: 1, provenance: input.envelope.provenance,
            payload: input.envelope.payload, normalized_value: input.value, content_id: contentId,
            configuration_content_id: contentId, content_hash: input.contentHash, semantic_hash: input.semanticHash,
            configuration_version_id: randomUUID(), population_evidence: null, expected_team_count: null,
            coverage: { periodIds: [], interval: null, entitySet: 'full', fields: LEAGUE_SETTINGS_FIELDS,
              pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] } };
          return [{ result: { status: 'changed', observationId, leagueSettingsAcceptance: accepted } }];
        }
        const leagueWrite = writes.at(-2)!;
        expect(input.rosterAcceptance).toMatchObject({ population: { contentHash: leagueWrite.contentHash,
          envelope: leagueWrite.envelope } });
        return [{ result: { status: 'changed', observationId, rosterAcceptance: receipt(), teamManagerAcceptance: receipt() } }];
      }
      if (sql.includes('read-accepted-league-settings')) return settingsRow ? [settingsRow] : [];
      throw new Error('Unexpected database path: ' + sql.slice(0, 70));
    });
    const queryAfterLock = vi.fn(async (sql: string, parameters: readonly unknown[], lock: {
      statement: string; parameters?: readonly unknown[]; verifyAfter?: { statement: string };
    }) => {
      expect(sql).toContain('projection-store:register-league-season');
      expect(parameters.slice(0, 2)).toEqual([null, null]);
      expect(lock.statement).toContain('guard_public_data_intake');
      expect(JSON.parse(String(lock.parameters?.[1]))).toMatchObject({ reserveCollection: true });
      expect(lock.verifyAfter?.statement).toContain('guard_public_data_intake');
      registered = true;
      return [[], [{ league_id: leagueId, league_season_id: mapping.leagueSeasonId, scoring_profile_id: null }]];
    });
    const client = { enabled: true, query, queryAfterLock } as unknown as DatabaseClient;
    const administration = createLeagueAdministrationStore(client);
    const intake = createPublicIntakeStore(client);
    const jobs = { acquireJob: vi.fn(async () => ({ kind: 'acquired' as const, attempt: 1,
      leaseUntil: new Date(Date.now() + 25_000).toISOString() })), completeJob: vi.fn(async () => true), failJob: vi.fn(async () => true) };
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url); events.push(path.endsWith('/rosters') ? 'fetch-rosters' : 'fetch-league');
      expect(path).toMatch(new RegExp('/league/' + native + '(/rosters)?$'));
      return new Response(JSON.stringify(path.endsWith('/rosters')
        ? [{ roster_id: 1, owner_id: '55', co_owners: [], players: [], starters: [], reserve: [], taxi: [] }] : payload));
    });
    vi.stubGlobal('fetch', fetcher);
    try {
      // Real producer/normalizer/registrar/writer/reader; storage behavior is simulated, not PostgreSQL proof.
      expect(await runPublicIntakeStep(requestId, { intake, administration, jobs }, new AbortController().signal))
        .toMatchObject({ status: 'progress', resource: 'bootstrap', providerRequests: 1 });
      expect(queryAfterLock).toHaveBeenCalledOnce();
      expect(checkpoints[0]).toMatchObject({ leagueId, leagueSeasonId: mapping.leagueSeasonId, payload: originalPayload });
      events.length = 0;
      expect(await runPublicIntakeStep(requestId, { intake, administration, jobs }, new AbortController().signal))
        .toMatchObject({ status: 'progress', resource: 'core', providerRequests: 2 });
      expect(events).toEqual(['reserve-rosters', 'reserve-settings', 'fetch-league', 'fetch-rosters']);
      const read = await administration.readAcceptedLeagueSettings(mapping);
      expect(read).toMatchObject({ status: 'available', leagueId, leagueSeasonId: mapping.leagueSeasonId,
        value: { nativeSettings: { fields: { state } }, scoring: { rules: { state } }, slots: { state } } });
      const previous = structuredClone(writes[0]);
      payload = { ...payload, scoring_settings: { rec: 0, penalty: -2, unsupported_bonus: 1.25 } };
      expect(await runPublicIntakeStep(requestId, { intake, administration, jobs }, new AbortController().signal))
        .toMatchObject({ status: 'progress', resource: 'core', providerRequests: 2 });
      expect(await administration.readAcceptedLeagueSettings(mapping)).toMatchObject({ status: 'available', value: {
        scoring: { rules: { state: 'known', value: payload.scoring_settings } } } });
      expect(writes[0]).toEqual(previous); expect(writes[2].contentHash).not.toBe(previous.contentHash);
      expect(queryAfterLock).toHaveBeenCalledOnce(); // Later official evidence never invokes season/profile registration.
      expect(fetcher).toHaveBeenCalledTimes(5); expect(jobs.failJob).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
