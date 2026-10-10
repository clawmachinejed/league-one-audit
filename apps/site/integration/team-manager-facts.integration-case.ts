import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RosterPopulationEvidence } from '../lib/aggregator/current-roster';
import { TEAM_MANAGER_EVIDENCE_POLICY, type RosterCaptureAttempts } from '../lib/aggregator/team-managers';
import type { AdministrationEnvelope, AdministrationWriteFence, JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from '../lib/league-administration/store';
import { runPublicIntakeStep, runPublicDataRefreshStep } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
import { PUBLIC_INTAKE_JOB } from '../lib/league-administration/public-intake-contracts';
import { createProjectionStore } from '../lib/projection-store';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

type Fixture = { leagueKey: string; leagueId: string; leagueSeasonId: string; externalLeagueId: string;
  mapping: AdministrationSourceMapping; population: RosterPopulationEvidence };
type Attempts = RosterCaptureAttempts & { evidence: RosterCaptureAttempts['managers'] };
const fixtureScoringRules = { rec: 0.5 };
const initialRosters: JsonValue = [
  { roster_id: 1, owner_id: 'owner-a', co_owners: ['co-a'], players: [], starters: [] },
  { roster_id: 2, owner_id: 'owner-b', co_owners: [], players: [], starters: [] },
  { roster_id: 3, owner_id: null, co_owners: ['vacant-co'], players: [], starters: [] },
];
const initialUsers: JsonValue = [
  { user_id: 'owner-a', display_name: 'Same Name', is_owner: false },
  { user_id: 'co-a', display_name: 'Same Name', is_owner: true },
  { user_id: 'directory-only', is_owner: true },
  { user_id: 'absent', display_name: 'Commissioner' },
  { user_id: 'null', is_owner: null },
  { user_id: 'invalid', is_owner: 'false' },
];
const instant = (value: unknown) => (value instanceof Date ? value : new Date(String(value))).toISOString();

/** AUTHORED / UNEXECUTED CP7 SQL qualification. Synthetic 2026 fixtures use the
 * existing restricted LOGIN and immutable writers; ordinary composition uses
 * fixture HTTP through the actual adapter and real minute admission spacing.
 * Eight 60-second cases plus one 15-minute case and existing 120-second hooks
 * total 27 minutes, leaving three minutes within the original work envelope.
 * This arithmetic is not measured SQL timing or a worst-case lifecycle guarantee.
 * No live capture, new harness, admission-time rewrite, retry or release. */
describe.sequential('current season manager and commissioner facts through restricted PostgreSQL', () => {
  let connection: IndependentDatabase;
  let store: ReturnType<typeof createLeagueAdministrationStore>;
  const activeOwners = new Set<() => Promise<void>>();
  beforeAll(async () => {
    connection = createIndependentDatabase(); store = createLeagueAdministrationStore(connection.database);
    expect((await connection.database.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb
      FROM pg_roles WHERE rolname=current_user`))[0]).toEqual({ current_user: 'league_one_runtime',
      session_user: 'league_one_runtime', rolsuper: false, rolcreaterole: false, rolcreatedb: false });
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      for (const finish of [...activeOwners]) await finish();
      const until = Date.now() + 85_000;
      while (true) {
        const [clock] = await connection.database.query(`SELECT
          NOT EXISTS(SELECT 1 FROM public.public_data_dispatches WHERE admitted_at>clock_timestamp()-interval '60 seconds')
          AND NOT EXISTS(SELECT 1 FROM public.projection_jobs WHERE job_key=$1
            AND (state='running' OR completed_at>clock_timestamp()-interval '60 seconds')) AS ready`, [PUBLIC_INTAKE_JOB]);
        if (clock.ready === true) break;
        if (Date.now() >= until) throw new Error('CP7 shared minute cleanup did not settle.');
        await delay(250);
      }
    } finally { await connection.close(); }
  });
  async function databaseNow() {
    const [row] = await connection.database.query('SELECT clock_timestamp() AS at'); return instant(row.at);
  }
  async function claim(deadlineMs = 20_000) {
    const jobs = createProjectionStore(connection.database), workerId = randomUUID(), jobKey = 'cp7-manager:' + randomUUID();
    const at = await databaseNow();
    const acquired = await jobs.acquireJob({ jobKey, jobType: 'league-administration', workerId, scheduledFor: at, leaseSeconds: 25, payload: {} });
    if (acquired.kind !== 'acquired') throw new Error('CP7 fixture owner unavailable.');
    const fence: AdministrationWriteFence = { jobKey, workerId, generation: acquired.attempt,
      deadlineAt: new Date(Date.parse(at) + deadlineMs).toISOString() };
    const finish = async () => {
      if (!await jobs.completeJob(jobKey, workerId)) await jobs.failJob(jobKey, workerId, 'CP7 fixture owner closure');
      activeOwners.delete(finish);
    };
    activeOwners.add(finish); return { fence, finish };
  }
  async function capture(f: Pick<Fixture, 'leagueKey' | 'externalLeagueId'>, payload: JsonValue,
    family: 'league' | 'rosters' | 'users' = 'rosters', completeness: 'complete' | 'partial' = 'complete') {
    const at = await databaseNow();
    const envelope: AdministrationEnvelope = { schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: { leagueKey: f.leagueKey, provider: 'sleeper', externalLeagueId: f.externalLeagueId, season: 2026 },
      family, week: null, completeness, payload,
      provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } };
    return normalizeAdministrationObservation(envelope, { expectedRosterCount: 3, managerEvidenceVersion: 'v2' });
  }
  async function population(f: Pick<Fixture, 'leagueKey' | 'externalLeagueId'>): Promise<RosterPopulationEvidence> {
    const input = await capture(f, { league_id: f.externalLeagueId, season: '2026', sport: 'nfl', total_rosters: 3,
      scoring_settings: fixtureScoringRules, roster_positions: ['QB', 'BN'] }, 'league');
    const result = await store.recordObservation(input);
    expect(result, 'CP7 population publication: ' + JSON.stringify(result)).toMatchObject({
      status: expect.stringMatching(/^(?:changed|unchanged|replayed)$/u), observationId: expect.any(String),
    });
    if (!result.observationId) throw new Error('Missing CP7 population evidence.');
    expect(await store.readSource({ ...input.envelope.scope, family: 'league', week: null }),
      'CP7 population must be the accepted legacy configuration before roster publication.').toMatchObject({
      status: 'available', observationId: result.observationId,
    });
    return { observationId: result.observationId, contentHash: input.contentHash, envelope: input.envelope };
  }
  async function fixture(): Promise<Fixture> {
    const leagueKey = 'cp7-' + randomUUID(), externalLeagueId = '8' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
    const result = await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey, leagueName: 'CP7 isolated DATA fixture',
      season: 2026, sleeperLeagueId: externalLeagueId, scoringRules: fixtureScoringRules });
    if (result.kind !== 'stored') throw new Error('Missing CP7 canonical registration.');
    await ownerQuery(`INSERT INTO public.league_administration_enrollments(league_id,provider,evidence)
      VALUES($1,'sleeper','CP7 isolated enrollment prerequisite')`, [result.value.leagueId]);
    await ownerQuery(`INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence)
      VALUES($1,2026,'sleeper','CP7 isolated enrollment prerequisite')`, [result.value.leagueId]);
    const mapping = await store.readSourceMapping(externalLeagueId); if (!mapping) throw new Error('Missing CP7 source mapping.');
    const base = { leagueKey, externalLeagueId, ...result.value, mapping }; return { ...base, population: await population(base) };
  }
  async function reserve(f: Fixture, fence?: AdministrationWriteFence): Promise<Attempts> {
    const paired = await store.beginRosterCapture(f.mapping, randomUUID(), randomUUID(), fence);
    if (!store.beginTeamManagerEvidenceAttempt) throw new Error('Missing CP7 v2 capability.');
    return { ...paired, evidence: await store.beginTeamManagerEvidenceAttempt(f.mapping, randomUUID(), fence) };
  }
  const publish = (f: Fixture, input: NormalizedAdministrationObservation, attempts: Attempts,
    fence?: AdministrationWriteFence, writer = store) => writer.recordObservation(input, fence, f.mapping,
    { attempt: attempts.players, population: f.population }, { attempt: attempts.managers, population: f.population },
    undefined, undefined, undefined, undefined, undefined, { attempt: attempts.evidence, population: f.population });
  async function roster(f: Fixture, rows: JsonValue = initialRosters) {
    const attempts = await reserve(f); const input = await capture(f, rows); const result = await publish(f, input, attempts);
    if (rows === initialRosters) {
      expect(result, 'CP7 initial roster publication: ' + JSON.stringify(result)).toMatchObject({
        rosterAcceptance: { status: 'accepted', receiptId: expect.any(String) },
        teamManagerAcceptance: { status: 'accepted', receiptId: expect.any(String) },
        teamManagerEvidenceAcceptance: { status: 'accepted', receiptId: expect.any(String) },
      });
    }
    return { attempts, input, result };
  }
  async function managers(f: Fixture, evidence = true) {
    if (!store.readAcceptedTeamManagerEvidence) throw new Error('Missing CP7 v2 reader.');
    const read = evidence ? await store.readAcceptedTeamManagerEvidence(f.mapping) : await store.readAcceptedTeamManagers(f.mapping);
    if (read.status !== 'available') throw new Error('CP7 managers unavailable: ' + read.status); return read;
  }
  async function directory(f: Fixture, rows: JsonValue = initialUsers, completeness: 'complete' | 'partial' = 'complete') {
    const input = await capture(f, rows, 'users', completeness); const result = await store.recordObservation(input);
    if (!result.observationId) throw new Error('Missing CP7 directory observation.');
    return { input, result, observationId: result.observationId };
  }
  async function facts(observationId: string) {
    return connection.database.query(`SELECT entry.content_id,entry.normalizer_version,entry.league_season_id,
      entry.manager_id,manager.external_manager_id,entry.commissioner_state,entry.commissioner_value,entry.invalid_raw,entry.source_value
      FROM public.league_administration_observations observation
      JOIN public.league_manager_directory_entries entry ON entry.content_id=observation.content_id
      JOIN public.league_source_manager_accounts manager ON manager.id=entry.manager_id
      WHERE observation.id=$1 ORDER BY manager.external_manager_id`, [observationId]);
  }
  async function history(f: Fixture) {
    return connection.database.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(e) ORDER BY content_id,normalizer_version,team_id) FROM league_team_manager_entries e WHERE league_season_id=$1) AS entries,
      (SELECT jsonb_agg(to_jsonb(m) ORDER BY content_id,normalizer_version,team_id,manager_id,role) FROM league_team_manager_memberships m WHERE league_season_id=$1) AS memberships,
      (SELECT jsonb_agg(to_jsonb(d) ORDER BY content_id,normalizer_version,manager_id) FROM league_manager_directory_entries d WHERE league_season_id=$1) AS directory`, [f.leagueSeasonId]);
  }
  async function state(f: Fixture) {
    return connection.database.query(`SELECT
      (SELECT count(*)::int FROM league_administration_contents WHERE league_season_id=$1) AS contents,
      (SELECT count(*)::int FROM league_administration_observations WHERE league_season_id=$1) AS observations,
      (SELECT count(*)::int FROM league_roster_capture_receipts receipt JOIN league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
        JOIN league_roster_resource_scopes scope ON scope.id=attempt.scope_id WHERE scope.league_season_id=$1) AS receipts,
      (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.scope_id) FROM league_roster_resource_heads h
        JOIN league_roster_resource_scopes scope ON scope.id=h.scope_id WHERE scope.league_season_id=$1) AS heads`, [f.leagueSeasonId]);
  }
  async function readOnly<T>(body: (reader: ReturnType<typeof createLeagueAdministrationStore>, database: DatabaseClient) => Promise<T>) {
    const queries: string[] = [];
    const database: DatabaseClient = { enabled: true,
      query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        queries.push(sql); expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu);
        return connection.database.query<Row>(sql, parameters, options);
      } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP7 stored read must not acquire source.'));
    try { const result = await body(createLeagueAdministrationStore(database), database);
      expect(fetch).not.toHaveBeenCalled(); expect(queries.length).toBeGreaterThan(0); return result; } finally { fetch.mockRestore(); }
  }

  it('stores commissioner presence independently from owners coowners and vacancies', async () => {
    const f = await fixture(); await roster(f); const source = await directory(f); const rows = await facts(source.observationId);
    const byNative = Object.fromEntries(rows.map(row => [String(row.external_manager_id), row]));
    expect(byNative['owner-a']).toMatchObject({ commissioner_state: 'known', commissioner_value: false, invalid_raw: null });
    expect(byNative['co-a']).toMatchObject({ commissioner_state: 'known', commissioner_value: true });
    expect(byNative['directory-only']).toMatchObject({ commissioner_state: 'known', commissioner_value: true });
    expect(byNative.absent).toMatchObject({ commissioner_state: 'absent', commissioner_value: null });
    expect(byNative.null).toMatchObject({ commissioner_state: 'null', commissioner_value: null });
    expect(byNative.invalid).toMatchObject({ commissioner_state: 'invalid', commissioner_value: null, invalid_raw: 'false' });
    expect(rows.map(row => row.source_value)).toEqual([...source.input.managerDirectory!.managers!]
      .sort((a, b) => a.externalManagerId.localeCompare(b.externalManagerId)));
    expect(rows.every(row => row.league_season_id === f.leagueSeasonId)).toBe(true);
    const read = await managers(f);
    expect(read.teams[0].primaryOwner).toMatchObject({ state: 'owned', manager: { sourceManager: { nativeId: 'owner-a' } } });
    expect(read.teams[0].coManagers).toMatchObject({ state: 'known', managers: [{ sourceManager: { nativeId: 'co-a' } }] });
    expect(read.teams[2]).toMatchObject({ primaryOwner: { state: 'unowned', manager: null },
      coManagers: { state: 'known', managers: [{ sourceManager: { nativeId: 'vacant-co' } }] } });
    expect(await connection.database.query(`SELECT member.role FROM league_team_manager_memberships member
      JOIN league_source_manager_accounts manager ON manager.id=member.manager_id
      WHERE member.league_season_id=$1 AND manager.external_manager_id='directory-only'`, [f.leagueSeasonId])).toEqual([]);
    expect(read.accepted).toMatchObject({ effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' });
    const unrelated = await fixture(); await roster(unrelated); const other = await managers(unrelated);
    expect(other.teams[0].seasonTeamId).not.toBe(read.teams[0].seasonTeamId);
    expect(other.teams[0].primaryOwner).toEqual(read.teams[0].primaryOwner);
  }, 60_000);

  it('preserves identities corrections immutable history unchanged captures and exact replay', async () => {
    const f = await fixture(); const first = await roster(f); const original = await managers(f);
    const source = await directory(f); const oldFacts = await facts(source.observationId);
    const rows: JsonValue = [{ roster_id: 1, owner_id: 'owner-b', co_owners: [], players: [] },
      { roster_id: 2, owner_id: null, co_owners: ['co-a'], players: [] },
      { roster_id: 3, owner_id: 'owner-b', co_owners: [], players: [] }];
    const changed = await roster(f, rows); const current = await managers(f);
    expect(current.teams.map(team => team.seasonTeamId)).toEqual(original.teams.map(team => team.seasonTeamId));
    expect(current.teams[0].primaryOwner).toEqual(current.teams[2].primaryOwner);
    expect(current.teams[1].primaryOwner).toEqual({ state: 'unowned', manager: null });
    const corrected = await directory(f, [{ user_id: 'owner-a', is_owner: true }, { user_id: 'co-a', is_owner: false }]);
    expect((await facts(corrected.observationId)).map(row => [row.external_manager_id, row.commissioner_value]))
      .toEqual([['co-a', false], ['owner-a', true]]);
    expect(await facts(source.observationId)).toEqual(oldFacts);
    const unchanged = await roster(f, rows); const verified = await managers(f);
    expect(verified.accepted.contentId).toBe(current.accepted.contentId); expect(verified.receipt.id).not.toBe(current.receipt.id);
    expect(verified.accepted.acceptedGeneration).toBe(current.accepted.acceptedGeneration + 1);
    const before = await history(f), counts = await state(f);
    expect((await publish(f, unchanged.input, unchanged.attempts)).teamManagerEvidenceAcceptance)
      .toMatchObject({ status: 'accepted', reason: 'exact_receipt_replay', receiptId: verified.receipt.id });
    expect((await store.recordObservation(corrected.input)).status).toBe('replayed');
    expect(await history(f)).toEqual(before); expect(await state(f)).toEqual(counts); expect(await managers(f)).toEqual(verified);
    expect(first.result.teamManagerEvidenceAcceptance?.receiptId).toBe(original.receipt.id);
    expect(changed.result.teamManagerEvidenceAcceptance?.receiptId).toBe(current.receipt.id);
    const oldEntries = await connection.database.query(`SELECT source_value FROM league_team_manager_entries
      WHERE content_id=$1 AND normalizer_version=$2 ORDER BY team_id`, [original.accepted.contentId, TEAM_MANAGER_EVIDENCE_POLICY.canonicalNormalizerVersion]);
    expect(oldEntries).toHaveLength(3);
  }, 60_000);

  it('retains valid coowners beside unknown primary ownership without inventing directory roles', async () => {
    const f = await fixture(); await roster(f); const primary = await managers(f, false); await directory(f);
    const result = await roster(f, [{ roster_id: 1, players: [], co_owners: ['independent-co', 'independent-co', '', null] },
      { roster_id: 2, owner_id: 42, players: [], co_owners: ['co-a'] },
      { roster_id: 3, owner_id: null, players: [], co_owners: [] }]);
    expect(result.result.teamManagerAcceptance?.status).toBe('preserved');
    expect(result.result.teamManagerEvidenceAcceptance?.status).toBe('accepted');
    const evidence = await managers(f);
    expect(evidence).toMatchObject({ evidenceCompleteness: 'partial', teams: [
      { primaryOwner: { state: 'unknown', manager: null, reason: 'primary_owner_absent' },
        coManagers: { state: 'partial', managers: [{ sourceManager: { nativeId: 'independent-co' } }] } },
      { primaryOwner: { state: 'unknown', manager: null, reason: 'primary_owner_invalid' },
        coManagers: { state: 'known', managers: [{ sourceManager: { nativeId: 'co-a' } }] } },
      { primaryOwner: { state: 'unowned', manager: null }, coManagers: { state: 'known', managers: [] } },
    ] });
    expect(await managers(f, false)).toEqual(primary);
    const saved = await history(f); const before = await managers(f);
    await directory(f, []); expect(await managers(f)).toEqual(before);
    expect((await history(f))[0].memberships).toEqual(saved[0].memberships);
    const empty = await store.readSource({ ...f.mapping.scope, family: 'users', week: null });
    expect(empty).toMatchObject({ status: 'available', envelope: { payload: [] } });
    if (empty.status !== 'available') throw new Error('Missing empty directory.');
    expect(await connection.database.query(`SELECT version.manager_count FROM league_manager_directory_versions version
      JOIN league_administration_observations observation ON observation.content_id=version.content_id WHERE observation.id=$1`, [empty.observationId]))
      .toEqual([{ manager_count: 0 }]);
  }, 60_000);

  it('orders manager reservations and source revisions without regressing immutable evidence', async () => {
    const f = await fixture(); await roster(f); const initial = await managers(f); const source = await directory(f);
    const oldFacts = await facts(source.observationId);
    const older = await reserve(f), olderInput = await capture(f, initialRosters);
    const newer = await reserve(f), newerInput = await capture(f, [{ roster_id: 1, owner_id: 'new-owner', players: [], co_owners: [] },
      { roster_id: 2, owner_id: 'owner-b', players: [], co_owners: [] }, { roster_id: 3, owner_id: null, players: [], co_owners: [] }]);
    expect((await publish(f, olderInput, older)).teamManagerEvidenceAcceptance?.reason).toBe('newer_network_attempt_reserved');
    expect(await managers(f)).toEqual(initial); await publish(f, newerInput, newer); const newest = await managers(f);
    expect((await publish(f, olderInput, older)).teamManagerEvidenceAcceptance?.reason).toBe('exact_receipt_replay');
    expect(await managers(f)).toEqual(newest);
    const failed = await reserve(f); const late = await reserve(f);
    await publish(f, await capture(f, [{ roster_id: 1, players: [] }]), late);
    expect((await publish(f, await capture(f, initialRosters), failed)).teamManagerEvidenceAcceptance?.reason).toBe('newer_network_attempt_reserved');
    expect(await managers(f)).toEqual(newest);
    const pending = await reserve(f), pendingInput = await capture(f, initialRosters);
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'CP7 source remap')", [f.leagueSeasonId, f.mapping.revisionId, 'cp7-b-' + randomUUID()]);
    const [middle] = await ownerQuery('SELECT external_league_id FROM league_source_connections WHERE league_season_id=$1', [f.leagueSeasonId]);
    const mapped = await store.readSourceMapping(String(middle.external_league_id)); if (!mapped) throw new Error('Missing CP7 middle mapping.');
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'CP7 source return')", [f.leagueSeasonId, mapped.revisionId, f.externalLeagueId]);
    const latest = await store.readSourceMapping(f.externalLeagueId); if (!latest) throw new Error('Missing CP7 return mapping.');
    await expect(publish(f, pendingInput, pending)).rejects.toThrow(/mapping|source/i);
    expect(await store.readAcceptedTeamManagerEvidence!(latest)).toEqual({ status: 'missing' });
    expect(await facts(source.observationId)).toEqual(oldFacts);
    const remapped = { ...f, mapping: latest, population: await population(f) }; await roster(remapped);
    expect((await managers(remapped)).teams.map(team => team.seasonTeamId)).toEqual(initial.teams.map(team => team.seasonTeamId));
    expect(await connection.database.query('SELECT source_mapping_revision_id FROM league_roster_resource_acceptances WHERE receipt_id=$1', [initial.receipt.id]))
      .toEqual([{ source_mapping_revision_id: f.mapping.revisionId }]);
  }, 60_000);

  it('preserves manager facts through independent partial malformed and unavailable directory evidence', async () => {
    const f = await fixture(); await roster(f); const first = await directory(f), preserved = await facts(first.observationId);
    const read = await managers(f), primary = await managers(f, false);
    for (const [rows, completeness] of [[[{ user_id: 'partial', is_owner: true }], 'partial'],
      [[{ user_id: 'duplicate' }, { user_id: 'duplicate' }], 'complete'], [[{ user_id: 42, is_owner: true }], 'complete']] as const) {
      const rejected = await directory(f, rows as unknown as JsonValue, completeness);
      expect(rejected.result.status).toBe('rejected'); expect(await facts(rejected.observationId)).toEqual([]);
      const current = await store.readSource({ ...f.mapping.scope, family: 'users', week: null });
      expect(current).toMatchObject({ status: 'available', observationId: first.observationId });
      expect(await facts(first.observationId)).toEqual(preserved);
      expect(await managers(f)).toEqual(read); expect(await managers(f, false)).toEqual(primary);
    }
    const broken: DatabaseClient = { enabled: true, query: async () => { throw new Error('Synthetic independent directory read failure.'); } };
    expect(await createLeagueAdministrationStore(broken).readSource({ ...f.mapping.scope, family: 'users', week: null }))
      .toEqual({ status: 'unavailable', reason: 'administration_database_unavailable' });
    expect(await managers(f)).toEqual(read); expect(await facts(first.observationId)).toEqual(preserved);
    const changed: JsonValue = [{ roster_id: 1, owner_id: 'changed-despite-directory-failure', co_owners: [], players: [] },
      { roster_id: 2, owner_id: null, co_owners: [], players: [] }, { roster_id: 3, owner_id: null, co_owners: [], players: [] }];
    await roster(f, changed);
    expect((await managers(f)).teams[0].primaryOwner).toMatchObject({ state: 'owned', manager: { sourceManager: { nativeId: 'changed-despite-directory-failure' } } });
    expect(await facts(first.observationId)).toEqual(preserved);
  }, 60_000);

  it('rejects forged directory facts source mappings and worker fences atomically', async () => {
    const f = await fixture(); await roster(f); const first = await directory(f); const saved = await history(f), before = await state(f);
    const input = await capture(f, initialUsers, 'users');
    const forged = structuredClone(input);
    const projection = forged.managerDirectory as unknown as { managers: { commissioner: unknown }[] };
    projection.managers[0].commissioner = { sourcePath: 'is_owner', state: 'known', value: true };
    await expect(store.recordObservation(forged)).rejects.toThrow(/manager directory|commissioner|projection/i);
    expect(await history(f)).toEqual(saved); expect(await state(f)).toEqual(before);
    await expect(store.recordObservation(input, undefined, { ...f.mapping, revisionId: randomUUID() })).rejects.toThrow(/mapping|source/i);
    expect(await history(f)).toEqual(saved); expect(await state(f)).toEqual(before);
    const owner = await claim();
    try {
      const attempts = await reserve(f, owner.fence), fresh = await capture(f, initialRosters), checkpoint = await state(f);
      await expect(publish(f, fresh, attempts)).rejects.toThrow(/scope mismatch|fence/i);
      await expect(publish(f, fresh, attempts, { ...owner.fence, generation: owner.fence.generation + 1 })).rejects.toThrow(/scope mismatch|fence|lease/i);
      expect(await state(f)).toEqual(checkpoint); expect(await history(f)).toEqual(saved);
      const conflicting = structuredClone(first.input);
      const sibling = conflicting.managerDirectory as unknown as { managers: { externalManagerId: string }[] };
      sibling.managers[0].externalManagerId = 'forged-manager';
      await expect(store.recordObservation(conflicting)).rejects.toThrow(/manager directory|projection|conflict/i);
      expect(await history(f)).toEqual(saved);
    } finally { await owner.finish(); }
  }, 60_000);

  it('rolls back relationship and directory publications after observed locks outlive worker deadlines', async () => {
    const f = await fixture(); await roster(f); await directory(f); const oldManagers = await managers(f), oldPrimary = await managers(f, false);
    const oldPlayers = await store.readAcceptedCurrentRoster(f.mapping), savedHistory = await history(f);
    const blocker = await createPinnedIntegrationDatabase('owner'), writer = await createPinnedIntegrationDatabase('runtime');
    const owner = await claim(15_000); let pending: Promise<{ error?: unknown }> | undefined, open = false;
    try {
      const [blockerPid] = await blocker.database.query('SELECT pg_backend_pid() AS pid');
      const [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
      expect(writerPid.role).toBe('league_one_runtime');
      const attempts = await reserve(f, owner.fence), input = await capture(f, [
        { roster_id: 1, owner_id: 'blocked-new-manager', co_owners: ['blocked-new-co'], players: [] },
        { roster_id: 2, owner_id: null, co_owners: [], players: [] }, { roster_id: 3, owner_id: null, co_owners: [], players: [] }]);
      const before = await state(f);
      await blocker.database.query('BEGIN'); open = true;
      await blocker.database.query('SELECT scope_id FROM league_roster_resource_heads WHERE scope_id=$1 FOR UPDATE', [attempts.evidence.scopeId]);
      let settled = false;
      pending = publish(f, input, attempts, owner.fence, createLeagueAdministrationStore(writer.database))
        .then(() => ({}), error => ({ error })).finally(() => { settled = true; });
      let blocked = false;
      for (let poll = 0; poll < 50; poll++) {
        const [row] = await blocker.database.query('SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS blocked', [blockerPid.pid, writerPid.pid]);
        if (row.blocked) { blocked = true; break; } await delay(20);
      }
      expect(blocked).toBe(true); expect(settled).toBe(false);
      await blocker.database.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)', [owner.fence.deadlineAt]);
      await blocker.database.query('COMMIT'); open = false;
      expect(String((await pending).error)).toMatch(/writer fence.*(?:stale|expired)/);
      expect(await state(f)).toEqual(before); expect(await history(f)).toEqual(savedHistory);
      expect(await managers(f)).toEqual(oldManagers); expect(await managers(f, false)).toEqual(oldPrimary);
      expect(await store.readAcceptedCurrentRoster(f.mapping)).toEqual(oldPlayers);
      expect(await connection.database.query('SELECT id FROM league_roster_capture_receipts WHERE attempt_id=ANY($1::uuid[])',
        [[attempts.players.id, attempts.managers.id, attempts.evidence.id]])).toEqual([]);
      expect(await connection.database.query("SELECT id FROM league_source_manager_accounts WHERE external_manager_id=ANY($1::text[])",
        [['blocked-new-manager', 'blocked-new-co']])).toEqual([]);
    } finally {
      if (open) await blocker.database.query('ROLLBACK');
      await pending; await owner.finish(); await writer.close(); await blocker.close();
    }
    // This lock is on the new typed table, so the shared v42 writer has already
    // returned before the new CP7 INSERT waits. No fixture history is mutated.
    const users = await capture(f, [{ user_id: 'late-directory-manager', is_owner: false }], 'users');
    const legacy = { ...users }; delete legacy.managerDirectory;
    const unprojected = await store.recordObservation(legacy);
    if (!unprojected.observationId) throw new Error('Missing CP7 older-caller premise.');
    expect(await facts(unprojected.observationId)).toEqual([]);
    const priorSource = await store.readSource({ ...f.mapping.scope, family: 'users', week: null });
    const typedBlocker = await createPinnedIntegrationDatabase('owner'), typedWriter = await createPinnedIntegrationDatabase('runtime');
    const typedOwner = await claim(15_000); let typedPending: Promise<{ error?: unknown }> | undefined, typedOpen = false;
    try {
      const [blockerPid] = await typedBlocker.database.query('SELECT pg_backend_pid() AS pid');
      const [writerPid] = await typedWriter.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
      expect(writerPid.role).toBe('league_one_runtime');
      const fresh = await capture(f, [{ user_id: 'late-directory-manager', is_owner: false }], 'users');
      const checkpoint = await state(f), historical = await history(f);
      await typedBlocker.database.query('BEGIN'); typedOpen = true;
      await typedBlocker.database.query('LOCK TABLE public.league_manager_directory_versions IN SHARE MODE');
      let settled = false;
      typedPending = createLeagueAdministrationStore(typedWriter.database).recordObservation(fresh, typedOwner.fence)
        .then(() => ({}), error => ({ error })).finally(() => { settled = true; });
      let blocked = false;
      for (let poll = 0; poll < 50; poll++) {
        const [row] = await typedBlocker.database.query(`SELECT $1::integer=ANY(pg_blocking_pids($2::integer))
          AND EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2::integer AND relation='public.league_manager_directory_versions'::regclass
            AND mode='RowExclusiveLock' AND NOT granted) AS blocked`, [blockerPid.pid, writerPid.pid]);
        if (row.blocked) { blocked = true; break; } await delay(20);
      }
      expect(blocked).toBe(true); expect(settled).toBe(false);
      await typedBlocker.database.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)', [typedOwner.fence.deadlineAt]);
      await typedBlocker.database.query('COMMIT'); typedOpen = false;
      expect(String((await typedPending).error)).toMatch(/manager directory writer fence expired/);
      expect(await state(f)).toEqual(checkpoint); expect(await history(f)).toEqual(historical);
      expect(await store.readSource({ ...f.mapping.scope, family: 'users', week: null })).toEqual(priorSource);
      expect(await facts(unprojected.observationId)).toEqual([]);
      expect(await connection.database.query(`SELECT version.content_id FROM league_manager_directory_versions version
        JOIN league_administration_observations observation ON observation.content_id=version.content_id WHERE observation.id=$1`,
      [unprojected.observationId])).toEqual([]);
    } finally {
      if (typedOpen) await typedBlocker.database.query('ROLLBACK');
      await typedPending; await typedOwner.finish(); await typedWriter.close(); await typedBlocker.close();
    }
  }, 60_000);

  it('denies direct history mutations and private helpers through actual restricted privileges', async () => {
    const f = await fixture(); await roster(f); const source = await directory(f); const saved = await history(f);
    const [content] = await connection.database.query('SELECT content_id FROM league_administration_observations WHERE id=$1', [source.observationId]);
    for (const table of ['league_manager_directory_versions', 'league_manager_directory_entries', 'league_team_manager_entries', 'league_team_manager_memberships']) {
      await expect(connection.database.query(`DELETE FROM public.${table} WHERE content_id=$1`, [content.content_id])).rejects.toThrow(/permission denied/);
      expect(await ownerQuery(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE') AS write,
        has_table_privilege('league_one_auth',$1,'SELECT,INSERT,UPDATE,DELETE') AS auth`, ['public.' + table]))
        .toEqual([{ read: true, write: false, auth: false }]);
    }
    for (const table of ['league_manager_directory_entries', 'league_manager_directory_versions']) {
      await expect(ownerQuery(`DELETE FROM public.${table} WHERE content_id=$1`, [content.content_id])).rejects.toThrow(/immutable/);
    }
    for (const helper of ['public.project_manager_commissioner_fact(jsonb)', 'public.validate_manager_directory_lineage()',
      'public.validate_manager_directory_population()', 'public.record_league_administration_observation_v42(jsonb)']) {
      expect(await ownerQuery(`SELECT has_function_privilege('league_one_runtime',$1,'EXECUTE') AS runtime,
        has_function_privilege('league_one_auth',$1,'EXECUTE') AS auth`, [helper])).toEqual([{ runtime: false, auth: false }]);
    }
    await expect(connection.database.query('SELECT public.project_manager_commissioner_fact($1::jsonb)', ['{}'])).rejects.toThrow(/permission denied/);
    await expect(connection.database.query('SELECT public.record_league_administration_observation_v42(NULL)')).rejects.toThrow(/permission denied/);
    const owner = await createPinnedIntegrationDatabase('owner');
    try {
      await owner.database.query('BEGIN');
      await owner.database.query(await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'));
      expect(await owner.database.query(`SELECT has_table_privilege('league_one_runtime','public.league_manager_directory_entries','SELECT') AS read,
        has_table_privilege('league_one_runtime','public.league_manager_directory_entries','INSERT,UPDATE,DELETE') AS write,
        has_function_privilege('league_one_runtime','public.record_league_administration_observation_v42(jsonb)','EXECUTE') AS delegated`))
        .toEqual([{ read: true, write: false, delegated: false }]);
    } finally { await owner.database.query('ROLLBACK'); await owner.close(); }
    expect(await history(f)).toEqual(saved);
  }, 60_000);

  it('composes ordinary intake directory failure recovery and changed ownership refresh with stored readers', async () => {
    const id = randomUUID(), manager = '9' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
    const external = '8' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15)), username = 'cp7_manager_' + manager;
    const league = { league_id: external, season: '2026', sport: 'nfl', name: 'CP7 ordinary DATA league', total_rosters: 3,
      settings: {}, scoring_settings: {}, roster_positions: ['QB', 'BN'] };
    let rosters: JsonValue = [{ roster_id: 1, owner_id: manager, co_owners: ['co-a'], players: [], starters: [] },
      { roster_id: 2, owner_id: 'owner-b', co_owners: [], players: [], starters: [] },
      { roster_id: 3, owner_id: null, co_owners: ['vacant-co'], players: [], starters: [] }];
    let users: JsonValue = [{ user_id: manager, display_name: 'Same Name', is_owner: false },
      { user_id: 'co-a', display_name: 'Same Name', is_owner: true }, { user_id: 'directory-only', is_owner: true },
      { user_id: 'absent', display_name: 'Commissioner' }, { user_id: 'null', is_owner: null }, { user_id: 'invalid', is_owner: 'false' }];
    let failedUsers = false; const requestUrls: string[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); requestUrls.push(url);
      if (url === 'https://api.sleeper.app/v1/user/' + username || url === 'https://api.sleeper.app/v1/user/' + manager)
        return new Response(JSON.stringify({ user_id: manager, username }));
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return new Response(JSON.stringify([league]));
      if (url === 'https://api.sleeper.app/v1/league/' + external) return new Response(JSON.stringify(league));
      if (url === 'https://api.sleeper.app/v1/league/' + external + '/rosters') return new Response(JSON.stringify(rosters));
      if (url === 'https://api.sleeper.app/v1/league/' + external + '/users') return failedUsers
        ? new Response('{}', { status: 503 }) : new Response(JSON.stringify(users));
      throw new Error('Unexpected CP7 ordinary provider scope.');
    });
    const intake = createPublicIntakeStore(connection.database), refresh = createPublicDataRefreshStore(connection.database);
    const dependencies = { intake, administration: store, jobs: createProjectionStore(connection.database), managerEvidenceVersion: 'v2' as const };
    let target: { targetId: string; configurationRevision: number } | undefined;
    const configuration = { id: randomUUID(), expectedRevision: 0, identityRequestId: id, seasons: [2026], cadenceSeconds: 60,
      expiresAt: new Date(Date.now() + 25 * 60_000).toISOString(), paused: false };
    async function progress(recurring: boolean, resource: string, status = 'progress') {
      const until = Date.now() + 150_000;
      do {
        const outcome = recurring ? await runPublicDataRefreshStep({ ...dependencies, refresh }, AbortSignal.timeout(20_000))
          : await runPublicIntakeStep(id, dependencies, AbortSignal.timeout(20_000));
        if (['busy', 'backoff', 'idle'].includes(outcome.status)) { await delay(1_000); continue; }
        expect(outcome).toMatchObject({ status, resource, providerRequests: resource === 'core' ? 2 : 1 }); return;
      } while (Date.now() < until);
      throw new Error('CP7 ordinary stage did not complete within its existing admission allowance.');
    }
    try {
      await intake.submit({ id, username, seasons: [2026] });
      for (const resource of ['identity', 'leagues', 'bootstrap', 'core', 'users']) await progress(false, resource);
      expect(await intake.next(id)).toBe('complete'); expect(requestUrls).toHaveLength(6);
      const mapping = await store.readSourceMapping(external); if (!mapping) throw new Error('Missing ordinary CP7 mapping.');
      if (!store.readManagerDirectoryCapture) throw new Error('Missing typed directory capability.');
      const [candidate] = await connection.database.query('SELECT users_capture_id,users_observation_id FROM public_data_league_candidates WHERE intake_id=$1', [id]);
      const first = await store.readManagerDirectoryCapture(mapping, String(candidate.users_capture_id));
      if (first.status !== 'available') throw new Error('Missing ordinary CP7 first directory.');
      const expected = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
        dialect: 'sleeper-nfl-v1', family: 'users', scope: mapping.scope, week: null, completeness: 'complete', payload: users,
        provenance: { origin: 'network', requestStartedAt: first.capture.requestStartedAt, requestCompletedAt: first.capture.requestCompletedAt,
          sourceObservedAt: first.capture.sourceObservedAt, checkedAt: first.capture.sourceObservedAt } }).managerDirectory!;
      expect(first.managers.map(row => ({ externalManagerId: row.sourceManager.nativeId, commissioner: row.commissioner })))
        .toEqual(expected.managers);
      expect(first).toMatchObject({ captureBinding: 'intake-directory-capture', capture: { id: candidate.users_capture_id,
        intakeId: id, legacyObservationId: candidate.users_observation_id }, sourceMapping: mapping, leagueSeasonId: mapping.leagueSeasonId });
      const firstPrimary = await store.readAcceptedTeamManagers(mapping), firstEvidence = await store.readAcceptedTeamManagerEvidence!(mapping);
      expect(firstPrimary).toMatchObject({ status: 'available', teams: [{ primaryOwner: { state: 'owned', manager: { sourceManager: { nativeId: manager } } } }, {},
        { primaryOwner: { state: 'unowned', manager: null } }] });
      target = await refresh.configure(configuration);
      rosters = [{ roster_id: 1, owner_id: 'co-a', co_owners: [], players: [], starters: [] },
        { roster_id: 2, owner_id: null, co_owners: ['vacant-co'], players: [], starters: [] },
        { roster_id: 3, owner_id: null, co_owners: [], players: [], starters: [] }];
      users = []; failedUsers = true;
      for (const resource of ['identity', 'leagues', 'bootstrap', 'core']) await progress(true, resource);
      await progress(true, 'users', 'unavailable'); expect(requestUrls).toHaveLength(12);
      const afterFailure = await readPublicDataRefresh(connection.database, store, target.targetId, { managerEvidenceVersion: 'v2' });
      expect(afterFailure).toMatchObject({ status: 'available', intake: { leagues: [{ resources: {
        teamManagers: { status: 'available', teams: [
          { sourceTeam: { nativeId: '1' }, primaryOwner: { state: 'owned', manager: { sourceManager: { nativeId: 'co-a' } } },
            coManagers: { state: 'known', managers: [] } },
          { sourceTeam: { nativeId: '2' }, primaryOwner: { state: 'unowned', manager: null },
            coManagers: { state: 'known', managers: [{ sourceManager: { nativeId: 'vacant-co' } }] } },
          { sourceTeam: { nativeId: '3' }, primaryOwner: { state: 'unowned', manager: null },
            coManagers: { state: 'known', managers: [] } },
        ] },
        teamManagerEvidence: { status: 'available', captureBinding: 'latest-for-current-source-mapping' },
        directory: { status: 'unavailable', reason: 'intake-capture-not-current-head' }, managerDirectory: { status: 'unavailable', reason: 'intake-directory-capture-unavailable' },
      } }] } });
      expect(await store.readManagerDirectoryCapture(mapping, first.capture.id)).toEqual(first);
      failedUsers = false; await progress(true, 'users'); expect(requestUrls).toHaveLength(13);
      expect(requestUrls[6]).toBe('https://api.sleeper.app/v1/user/' + manager); fetch.mockRestore();
      await readOnly(async (reader, database) => {
        const current = await readPublicDataRefresh(database, reader, target!.targetId, { managerEvidenceVersion: 'v2' });
        expect(current).toMatchObject({ status: 'available', intake: { status: 'available', leagues: [{ resources: {
          managerDirectory: { status: 'available', managers: [] }, directory: { status: 'available', envelope: { payload: [] } },
          teamManagers: { status: 'available' }, teamManagerEvidence: { status: 'available', captureBinding: 'latest-for-current-source-mapping' },
        } }] } });
        expect(await reader.readManagerDirectoryCapture!(mapping, first.capture.id)).toEqual(first);
        const original = await readPublicSleeperIntake(database, reader, id, { managerEvidenceVersion: 'v2' });
        expect(original).toMatchObject({ leagues: [{ resources: {
          directory: { status: 'unavailable', reason: 'intake-capture-not-current-head' }, managerDirectory: first,
          teamManagers: { status: 'unavailable', reason: 'intake-capture-not-current-head' },
          teamManagerEvidence: { status: 'available', captureBinding: 'latest-for-current-source-mapping' },
        } }] });
        expect(await reader.readManagerDirectoryCapture!(mapping, randomUUID())).toMatchObject({ status: 'missing' });
        expect(await reader.readManagerDirectoryCapture!({ ...mapping, revisionId: randomUUID() }, first.capture.id))
          .toMatchObject({ status: 'missing' });
      });
      expect(firstPrimary).toMatchObject({ status: 'available' }); expect(firstEvidence).toMatchObject({ status: 'available' });
      const unrelated = await fixture();
      expect(await store.readManagerDirectoryCapture(unrelated.mapping, first.capture.id)).toMatchObject({ status: 'missing' });
      const originalFacts = await facts(String(candidate.users_observation_id)); expect(originalFacts).toHaveLength(6);
      const [receipt] = await connection.database.query(`SELECT capture.source_mapping=$2::jsonb AS same_mapping,
        dispatch.resource='users' AND dispatch.work->>'externalLeagueId'=$3 AND (dispatch.work->>'season')::integer=2026 AS same_work,
        capture.recorded_at>=dispatch.admitted_at AS server_order
        FROM public_data_directory_captures capture JOIN public_data_dispatches dispatch
          ON dispatch.intake_id=capture.intake_id AND dispatch.worker_id=capture.worker_id AND dispatch.generation=capture.generation
        WHERE capture.id=$1`, [first.capture.id, JSON.stringify(mapping), external]);
      expect(receipt).toEqual({ same_mapping: true, same_work: true, server_order: true });
      await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'CP7 typed directory mapping fence')",
        [mapping.leagueSeasonId, mapping.revisionId, 'cp7-directory-remap-' + randomUUID()]);
      expect(await store.readManagerDirectoryCapture(mapping, first.capture.id)).toEqual({ status: 'missing' });
      expect(await facts(String(candidate.users_observation_id))).toEqual(originalFacts);
    } finally {
      fetch.mockRestore();
      if (target) await refresh.configure({ ...configuration, expectedRevision: target.configurationRevision,
        expiresAt: new Date(Date.now() + 60_000).toISOString(), paused: true });
    }
  }, 15 * 60_000);
});
