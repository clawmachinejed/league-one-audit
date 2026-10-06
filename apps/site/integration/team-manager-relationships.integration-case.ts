import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import { TEAM_MANAGERS_POLICY, TEAM_MANAGER_EVIDENCE_POLICY, teamManagersScope, teamManagerEvidenceScope, type RosterCaptureAttempts } from '../lib/aggregator/team-managers';
import type { RosterAttempt, RosterPopulationEvidence } from '../lib/aggregator/current-roster';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import { createProjectionStore } from '../lib/projection-store';
import { compatibleScoringRulesHash } from '../lib/projections/shared/revision-compatibility';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, runtimeQuery, type IndependentDatabase } from './neon-integration-harness';

const initial = [{ roster_id: 1, owner_id: 'manager-a', co_owners: ['co-a'], players: ['p-a'] },
  { roster_id: 2, owner_id: 'manager-b', co_owners: null, players: [] }];
const rules = { rec: 0.5 };
const version = TEAM_MANAGERS_POLICY.canonicalNormalizerVersion;
const instant = (value: unknown) => (value instanceof Date ? value : new Date(String(value))).toISOString();

describe.sequential('current primary ownership and independent optional co-manager evidence', () => {
  let connection: IndependentDatabase;
  let store: ReturnType<typeof createLeagueAdministrationMethods>;
  beforeAll(() => { connection = createIndependentDatabase(); store = createLeagueAdministrationMethods(connection.database); });
  afterAll(async () => connection.close());
  async function fixture(season = 2170, leagueKey = `manager-relationships-${randomUUID()}`) {
    const externalLeagueId = `manager-source-${randomUUID()}`;
    const result = await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey, leagueName: 'Synthetic managers',
      season, sleeperLeagueId: externalLeagueId, scoringRules: rules });
    if (result.kind !== 'stored') throw new Error('Isolated persistence disabled.');
    await ownerQuery(`INSERT INTO league_administration_enrollments(league_id,provider,evidence)
      VALUES($1,'sleeper','synthetic manager fixture') ON CONFLICT DO NOTHING`, [result.value.leagueId]);
    await ownerQuery(`INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence)
      VALUES($1,$2,'sleeper','synthetic manager fixture')`, [result.value.leagueId, season]);
    const mapping = await store.readSourceMapping(externalLeagueId);
    if (!mapping) throw new Error('Missing fixture mapping.');
    return { ...result.value, mapping, leagueKey, externalLeagueId, season };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function capture(f: Fixture, payload: JsonValue = initial, family: 'league' | 'rosters' = 'rosters',
    options: { completeness?: 'complete' | 'partial'; origin?: 'network' | 'cache' } = {}) {
    const [clock] = await ownerQuery('SELECT clock_timestamp() AS at');
    const at = instant(clock.at);
    const origin = options.origin ?? 'network';
    return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: f.mapping.scope, family, week: null, completeness: options.completeness ?? 'complete', payload,
      provenance: { origin, requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: origin === 'network' ? at : null, checkedAt: at } });
  }
  async function population(f: Fixture): Promise<RosterPopulationEvidence> {
    const input = await capture(f, { league_id: f.externalLeagueId, season: String(f.season), sport: 'nfl',
      total_rosters: 2, roster_positions: ['QB', 'BN'], scoring_settings: rules }, 'league');
    const result = await store.recordObservation(input);
    if (!result.observationId) throw new Error('Missing population observation.');
    return { observationId: result.observationId, contentHash: input.contentHash, envelope: input.envelope };
  }
  const reserve = (f: Fixture, fence?: AdministrationWriteFence) => store.beginRosterCapture(f.mapping, randomUUID(), randomUUID(), fence);
  const write = (f: Fixture, input: NormalizedAdministrationObservation, attempts: RosterCaptureAttempts,
    proof?: RosterPopulationEvidence, fence?: AdministrationWriteFence) => store.recordObservation(input, fence, f.mapping,
    { attempt: attempts.players, ...(proof ? { population: proof } : {}) },
    { attempt: attempts.managers, ...(proof ? { population: proof } : {}) });
  async function read(f: Fixture) {
    const result = await store.readAcceptedTeamManagers(f.mapping);
    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('Missing manager resource.');
    return result;
  }
  async function seed(selected?: Fixture) {
    const f = selected ?? await fixture();
    const proof = await population(f); const attempts = await reserve(f); const input = await capture(f);
    const result = await write(f, input, attempts, proof);
    expect(result.rosterAcceptance?.status).toBe('accepted'); expect(result.teamManagerAcceptance?.status).toBe('accepted');
    return { f, proof, attempts, input, result, current: await read(f) };
  }
  async function history(f: Fixture) {
    return ownerQuery(`SELECT (SELECT jsonb_agg(to_jsonb(e) ORDER BY content_id,team_id)
      FROM league_team_manager_entries e WHERE league_season_id=$1) AS entries,
      (SELECT jsonb_agg(to_jsonb(m) ORDER BY content_id,team_id,manager_id,role)
      FROM league_team_manager_memberships m WHERE league_season_id=$1) AS memberships`, [f.leagueSeasonId]);
  }

  it('accepts ordinary null-co-owner live shapes after v1 sealing with independently scoped primary coverage', async () => {
    const { f, input, result, current } = await seed();
    expect(current.accepted).toMatchObject({ scope: teamManagersScope(f.mapping), canonicalNormalizerVersion: version,
      acceptedGeneration: 1, effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' });
    expect(current.teams[0]).toMatchObject({ primaryOwner: { state: 'owned', manager: { sourceManager: { provider: 'sleeper', nativeId: 'manager-a' } } },
      coManagers: { state: 'known', completeness: 'complete', managers: [{ sourceManager: { nativeId: 'co-a' } }], sourceRefs: [current.receipt.id] }, assurance: 'provider-observed' });
    expect(current.teams[1].coManagers).toMatchObject({ state: 'unknown', managers: null, completeness: 'unknown', reason: 'co_managers_null' });
    expect(await ownerQuery('SELECT coverage FROM league_roster_capture_receipts WHERE id=$1', [current.receipt.id]))
      .toEqual([{ coverage: { periodIds: [], interval: null, entitySet: 'full', fields: ['owner_id'], pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] } }]);
    expect(await ownerQuery(`SELECT payload,normalized_value,accepted FROM league_administration_contents WHERE id=$1`, [current.accepted.contentId]))
      .toEqual([{ payload: initial, normalized_value: input.value, accepted: true }]);
    expect(current.receipt.legacyObservationId).toBe(result.observationId);
  });

  it('keeps team IDs on transfer/removal, supports one manager on several teams, and retains co-owner history without blending', async () => {
    const { f, proof, current: original } = await seed();
    const before = await history(f);
    const replacement = [{ roster_id: 1, owner_id: 'manager-b', co_owners: [], players: [] },
      { roster_id: 2, owner_id: 'manager-b', co_owners: ['co-new'], players: [] }];
    await write(f, await capture(f, replacement), await reserve(f), proof);
    const transferred = await read(f);
    expect(transferred.teams.map(t => t.seasonTeamId)).toEqual(original.teams.map(t => t.seasonTeamId));
    expect(transferred.teams[0].primaryOwner).toEqual(transferred.teams[1].primaryOwner);
    expect(transferred.teams[0].coManagers).toMatchObject({ state: 'known', managers: [] });
    await write(f, await capture(f, [{ roster_id: 1, owner_id: null, co_owners: null, players: [] },
      { roster_id: 2, owner_id: 'manager-b', players: [] }]), await reserve(f), proof);
    const vacant = await read(f);
    expect(vacant.teams[0].primaryOwner).toEqual({ state: 'unowned', manager: null });
    expect(vacant.teams[0].coManagers).toMatchObject({ state: 'unknown', managers: null });
    expect(vacant.teams[1].coManagers).toMatchObject({ state: 'unknown', reason: 'co_managers_absent' });
    const retained = await ownerQuery('SELECT source_value FROM league_team_manager_entries WHERE content_id=$1 ORDER BY team_id', [original.accepted.contentId]);
    expect(retained).toHaveLength(2); expect(before[0].entries).toHaveLength(2);
    expect(await ownerQuery('SELECT count(*)::integer AS count FROM league_team_manager_entries WHERE league_season_id=$1', [f.leagueSeasonId]))
      .toEqual([{ count: 6 }]);
  });

  it.each([
    ['unrelated players', { players: 5 }, 'known'], ['invalid co shape', { co_owners: 5 }, 'unknown'],
    ['duplicate co ID', { co_owners: ['co-a', 'co-a'] }, 'unknown'], ['primary also co', { co_owners: ['manager-a'] }, 'unknown'],
    ['NBSP co ID', { co_owners: ['\u00a0co-a'] }, 'unknown'], ['BOM co ID', { co_owners: ['\ufeffco-a'] }, 'unknown'],
  ])('accepts primary owners when v1 rejects %s without rewriting v1 or its sealed entries', async (_label, change, state) => {
    const { f, proof, current } = await seed();
    const legacy = await store.readSource({ ...f.mapping.scope, family: 'rosters', week: null });
    const input = await capture(f, [{ ...initial[0], ...(change as object) }, initial[1]]);
    expect(input.status).toBe('rejected');
    const result = await write(f, input, await reserve(f), proof);
    expect(result.status).toBe('rejected'); expect(result.teamManagerAcceptance?.status).toBe('accepted');
    expect(result.rosterAcceptance?.status).toBe('preserved');
    const next = await read(f);
    expect(next.teams[0].seasonTeamId).toBe(current.teams[0].seasonTeamId);
    expect(next.teams[0].coManagers.state).toBe(state);
    expect(await ownerQuery('SELECT accepted,normalized_value FROM league_administration_contents WHERE id=$1', [next.accepted.contentId]))
      .toEqual([{ accepted: false, normalized_value: null }]);
    expect(await ownerQuery('SELECT * FROM league_administration_memberships WHERE content_id=$1', [next.accepted.contentId])).toEqual([]);
    const legacyAfter = await store.readSource({ ...f.mapping.scope, family: 'rosters', week: null });
    expect(legacy.status).toBe('available'); expect(legacyAfter.status).toBe('available');
    if (legacy.status !== 'available' || legacyAfter.status !== 'available') throw new Error('Missing legacy fixture.');
    expect(legacyAfter.observationId).toBe(legacy.observationId);
    expect(legacyAfter.envelope).toEqual(legacy.envelope);
    expect(legacyAfter.verifiedAt).toBe(legacy.verifiedAt);
    expect(legacyAfter.generation).toBe(legacy.generation + 1);
  });

  it.each(['co\u0085manager', 'Co.Mixed/0007', 'co\u00a0manager'])('preserves opaque valid co-manager ID %j under the exact JS identifier policy', async nativeId => {
    const { f, proof } = await seed();
    const input = await capture(f, [{ ...initial[0], co_owners: [nativeId] }, initial[1]]);
    expect(input.teamManagers?.teams?.[0].coManagers.state).toBe('known');
    expect((await write(f, input, await reserve(f), proof)).teamManagerAcceptance?.status).toBe('accepted');
    expect((await read(f)).teams[0].coManagers).toMatchObject({ state: 'known', managers: [{ sourceManager: { nativeId } }] });
  });

  it.each([
    ['missing primary', [{ roster_id: 1, co_owners: [], players: [] }, initial[1]], true],
    ['invalid primary', [{ ...initial[0], owner_id: 123 }, initial[1]], false],
    ['duplicate teams', [initial[0], initial[0]], false],
    ['foreign league', [{ ...initial[0], league_id: 'foreign' }, initial[1]], true],
    ['incomplete teams', [initial[0]], false],
  ] as const)('preserves current primary relationships for %s, independently from the original players rule', async (_label, rows, players) => {
    const { f, proof, current } = await seed();
    const input = await capture(f, rows as unknown as JsonValue);
    const result = await write(f, input, await reserve(f), proof);
    expect(result.teamManagerAcceptance).toMatchObject({ status: 'preserved', reason: 'complete_primary_owner_population_unproved' });
    expect(result.rosterAcceptance?.status).toBe(players ? 'accepted' : 'preserved');
    expect(await read(f)).toEqual(current);
  });

  it.each(['older-first', 'newer-first'] as const)('orders two same-fetch policies independently under %s completion', async order => {
    const { f, proof, current } = await seed();
    const older = await reserve(f); const olderInput = await capture(f, [{ ...initial[0], owner_id: 'older' }, initial[1]]);
    const newer = await reserve(f); const newerInput = await capture(f, [{ ...initial[0], owner_id: 'newer' }, initial[1]]);
    const completeOld = () => write(f, olderInput, older, proof);
    const completeNew = () => write(f, newerInput, newer, proof);
    let oldResult;
    if (order === 'older-first') { oldResult = await completeOld(); expect(await read(f)).toEqual(current); await completeNew(); }
    else { await completeNew(); oldResult = await completeOld(); }
    expect(oldResult.teamManagerAcceptance?.reason).toBe('newer_network_attempt_reserved');
    expect((await read(f)).teams[0].primaryOwner).toMatchObject({ manager: { sourceManager: { nativeId: 'newer' } } });
  });

  it('keeps latest failed reservations fencing both resources and permits a new restart capture', async () => {
    const { f, proof, current } = await seed();
    const older = await reserve(f); await reserve(f);
    expect((await write(f, await capture(f), older, proof)).teamManagerAcceptance?.reason).toBe('newer_network_attempt_reserved');
    expect(await read(f)).toEqual(current);
    const restarted = createIndependentDatabase();
    try {
      const fresh = createLeagueAdministrationMethods(restarted.database);
      const attempts = await fresh.beginRosterCapture(f.mapping, randomUUID(), randomUUID());
      expect((await write(f, await capture(f), attempts, proof)).teamManagerAcceptance?.status).toBe('accepted');
    } finally { await restarted.close(); }
  });

  it('retains exact fresh receipt provenance for unchanged v1 observations and rejects changed retries atomically', async () => {
    const { f, proof, current, input: prior, result: priorResult } = await seed();
    const oldObservation = await ownerQuery('SELECT * FROM league_administration_observations WHERE id=$1', [priorResult.observationId]);
    const attempts = await reserve(f); const input = await capture(f);
    const result = await write(f, input, attempts, proof);
    expect(result).toMatchObject({ status: 'unchanged', observationId: priorResult.observationId });
    const latest = await read(f);
    expect(latest.accepted.contentId).toBe(current.accepted.contentId); expect(latest.receipt.id).not.toBe(current.receipt.id);
    expect(latest.receipt.provenance).toEqual(input.envelope.provenance);
    expect(input.envelope.provenance).not.toEqual(prior.envelope.provenance);
    const saved = await history(f);
    expect((await write(f, input, attempts, proof)).teamManagerAcceptance).toMatchObject({ status: 'accepted', reason: 'exact_receipt_replay', receiptId: latest.receipt.id });
    await expect(write(f, await capture(f, [{ ...initial[0], owner_id: 'tampered-retry' }, initial[1]]), attempts, proof)).rejects.toThrow(/receipt conflict/);
    expect(await history(f)).toEqual(saved); expect(await read(f)).toEqual(latest);
    expect(await ownerQuery('SELECT * FROM league_administration_observations WHERE id=$1', [priorResult.observationId])).toEqual(oldObservation);
  });

  it('keeps unknown/partial captures from clearing accepted evidence and supports same-revision population reuse', async () => {
    const { f, proof, current } = await seed();
    const partial = await capture(f, initial, 'rosters', { completeness: 'partial' });
    expect((await write(f, partial, await reserve(f), proof)).teamManagerAcceptance?.status).toBe('preserved');
    expect(await read(f)).toEqual(current);
    expect((await write(f, await capture(f), await reserve(f))).teamManagerAcceptance?.status).toBe('accepted');
  });

  it('fences source revisions including A-B-A and preserves immutable older evidence', async () => {
    const { f, proof, current } = await seed(); const attempts = await reserve(f); const input = await capture(f);
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'synthetic remap')", [f.leagueSeasonId, f.mapping.revisionId, 'remap-b']);
    const middle = await store.readSourceMapping('remap-b');
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'synthetic return')", [f.leagueSeasonId, middle!.revisionId, f.externalLeagueId]);
    const latest = await store.readSourceMapping(f.externalLeagueId);
    expect(await store.readAcceptedTeamManagers(latest!)).toEqual({ status: 'missing' });
    await expect(write(f, input, attempts, proof)).rejects.toThrow(/mapping.*(?:stale|mismatch)|source mapping/);
    expect(await ownerQuery('SELECT source_mapping_revision_id FROM league_roster_resource_acceptances WHERE receipt_id=$1', [current.receipt.id]))
      .toEqual([{ source_mapping_revision_id: f.mapping.revisionId }]);
    const next = { ...f, mapping: latest! };
    const currentProof = await population(next);
    expect((await write(next, await capture(next), await reserve(next), currentProof)).teamManagerAcceptance?.status).toBe('accepted');
    expect((await read(next)).teams[0].seasonTeamId).toBe(current.teams[0].seasonTeamId);
  });

  it('isolates same native team IDs across leagues and annual seasons while provider-manager identities remain stable', async () => {
    const first = await seed(); const second = await seed();
    const season = first.f.season + 1; const externalLeagueId = `manager-annual-${randomUUID()}`;
    const [annualRow] = await ownerQuery<{ id: string }>(`SELECT connect_league_administration_season(
      $1,$2::smallint,$3,$4,$5,$6::jsonb,'synthetic manager annual continuity')::text AS id`,
    [first.f.leagueId, season, first.f.externalLeagueId, externalLeagueId, compatibleScoringRulesHash(rules), JSON.stringify(rules)]);
    const mapping = await store.readSourceMapping(externalLeagueId);
    if (!mapping) throw new Error('Missing annual mapping.');
    const annual = await seed({ ...first.f, leagueSeasonId: annualRow.id, externalLeagueId, season, mapping });
    expect(new Set([first.current, second.current, annual.current].map(r => r.teams[0].seasonTeamId)).size).toBe(3);
    expect(first.current.teams[0].primaryOwner).toEqual(second.current.teams[0].primaryOwner);
    expect(annual.current.teams[0].sourceTeam.nativeNamespace).not.toBe(first.current.teams[0].sourceTeam.nativeNamespace);
    await expect(write(second.f, first.input, first.attempts, first.proof)).rejects.toThrow(/scope mismatch/);
    expect(await read(first.f)).toEqual(first.current); expect(await read(second.f)).toEqual(second.current);
  });

  it('keeps original callers and cache observations outside manager acceptance ordering', async () => {
    const { f, proof, current } = await seed(); const attempts = await reserve(f);
    const input = await capture(f, [{ ...initial[0], owner_id: 'old-caller' }, initial[1]]);
    const oldInput = { ...input }; delete oldInput.teamManagers;
    const old = await store.recordObservation(oldInput, undefined, f.mapping, { attempt: attempts.players, population: proof });
    expect(old.teamManagerAcceptance).toBeUndefined(); expect(old.rosterAcceptance?.status).toBe('accepted');
    expect(await read(f)).toEqual(current);
    const next = await reserve(f); const cached = await capture(f, initial, 'rosters', { origin: 'cache' });
    await store.recordObservation(cached, undefined, f.mapping);
    expect(await ownerQuery('SELECT latest_ordinal FROM league_roster_resource_heads WHERE scope_id=$1', [next.managers.scopeId]))
      .toEqual([{ latest_ordinal: String(next.managers.ordinal) }]);
    await expect(write(f, cached, next, proof)).rejects.toThrow(/network capture/);
  });

  it('allows manager completion when an old caller independently supersedes only the players attempt', async () => {
    const { f, proof } = await seed();
    const paired = await reserve(f);
    const pairedInput = await capture(f, [{ ...initial[0], owner_id: 'paired-owner' }, initial[1]]);
    const playersOnly = await store.beginRosterAttempt(f.mapping, randomUUID());
    const oldResult = await store.recordObservation(await capture(f, [{ ...initial[0], players: ['old-caller-player'] }, initial[1]]),
      undefined, f.mapping, { attempt: playersOnly, population: proof });
    expect(oldResult.rosterAcceptance?.status).toBe('accepted'); expect(oldResult.teamManagerAcceptance).toBeUndefined();
    const result = await write(f, pairedInput, paired, proof);
    expect(result.rosterAcceptance).toMatchObject({ status: 'preserved', reason: 'newer_network_attempt_reserved' });
    expect(result.teamManagerAcceptance?.status).toBe('accepted');
    expect((await read(f)).teams[0].primaryOwner).toMatchObject({ state: 'owned', manager: { sourceManager: { nativeId: 'paired-owner' } } });
    const players = await store.readAcceptedCurrentRoster(f.mapping);
    expect(players).toMatchObject({ status: 'available', teams: [{ players: [{ sourceEntity: { nativeId: 'old-caller-player' } }] }, {}] });
  });

  it('rolls back first-loop players publication when the second manager head blocks past the worker deadline', async () => {
    const { f, proof, current } = await seed();
    const owner = await createPinnedIntegrationDatabase('owner'); const writer = await createPinnedIntegrationDatabase('runtime');
    let completion: Promise<{ error?: unknown }> | undefined;
    try {
      const [ownerPid] = await owner.database.query('SELECT pg_backend_pid() AS pid');
      const [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid');
      const jobKey = `manager-block:${randomUUID()}`; const workerId = randomUUID();
      await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
        VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '5 minutes',1)`, [jobKey, workerId]);
      const [clock] = await ownerQuery("SELECT clock_timestamp()+interval '8 seconds' AS at");
      const fence = { jobKey, workerId, generation: 1, deadlineAt: instant(clock.at) };
      const attempts = await reserve(f, fence);
      const input = await capture(f, [{ ...initial[0], owner_id: 'blocked-owner', players: ['blocked-player'] }, initial[1]]);
      const previousPlayers = await store.readAcceptedCurrentRoster(f.mapping);
      const previousHistory = await history(f);
      await owner.database.query('BEGIN');
      await owner.database.query('SELECT scope_id FROM league_roster_resource_heads WHERE scope_id=$1 FOR UPDATE', [attempts.managers.scopeId]);
      let settled = false;
      completion = createLeagueAdministrationMethods(writer.database).recordObservation(input, fence, f.mapping,
        { attempt: attempts.players, population: proof }, { attempt: attempts.managers, population: proof })
        .then(() => ({}), error => ({ error })).finally(() => { settled = true; });
      let blocked = false;
      for (let poll = 0; poll < 50; poll++) {
        const [row] = await owner.database.query('SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS blocked', [ownerPid.pid, writerPid.pid]);
        if (row.blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true); expect(settled).toBe(false);
      await owner.database.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)', [fence.deadlineAt]);
      await owner.database.query('COMMIT');
      expect(String((await completion).error)).toMatch(/writer fence.*(?:stale|expired)/);
      expect(await read(f)).toEqual(current); expect(await store.readAcceptedCurrentRoster(f.mapping)).toEqual(previousPlayers);
      expect(await history(f)).toEqual(previousHistory);
      expect(await ownerQuery('SELECT id FROM league_roster_capture_receipts WHERE attempt_id=ANY($1::uuid[])', [[attempts.players.id, attempts.managers.id]])).toEqual([]);
    } finally {
      await owner.database.query('ROLLBACK').catch(() => undefined); await completion; await writer.close(); await owner.close();
    }
  });

  it('binds manager scope, worker generation and deadline without a tokenless fallback', async () => {
    const { f, proof, current } = await seed(); const jobKey = `manager-fence:${randomUUID()}`; const workerId = randomUUID();
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
      VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '5 minutes',1)`, [jobKey, workerId]);
    const [clock] = await ownerQuery("SELECT clock_timestamp()+interval '5 minutes' AS at");
    const fence = { jobKey, workerId, generation: 1, deadlineAt: instant(clock.at) };
    const attempts = await reserve(f, fence); const input = await capture(f);
    await expect(write(f, input, attempts, proof)).rejects.toThrow(/scope mismatch/);
    await ownerQuery("UPDATE projection_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE job_key=$1", [jobKey]);
    await expect(write(f, input, attempts, proof, fence)).rejects.toThrow(/fence.*(?:expired|stale)|lease/);
    expect(await read(f)).toEqual(current);
    const fresh = await reserve(f);
    await expect(store.recordObservation(input, undefined, f.mapping, undefined, { attempt: fresh.players, population: proof }))
      .rejects.toThrow(/policy mismatch/);
  });

  it.each(['status', 'false-unknown', 'foreign-owner', 'invented-co'] as const)('refuses forged %s projection without granting a new primary head', async variant => {
    const { f, proof, current } = await seed(); const input = structuredClone(await capture(f)); const attempts = await reserve(f);
    const projection = input.teamManagers as unknown as { status?: string; teams: { primaryOwner: unknown; coManagers: unknown }[] };
    if (variant === 'status') delete projection.status;
    if (variant === 'false-unknown') projection.teams[0].coManagers = { state: 'unknown', externalManagerIds: null, reason: 'co_managers_absent' };
    if (variant === 'foreign-owner') projection.teams[0].primaryOwner = { state: 'owned', externalManagerId: 'foreign' };
    if (variant === 'invented-co') projection.teams[0].coManagers = { state: 'known', externalManagerIds: ['foreign'] };
    expect((await write(f, input, attempts, proof)).teamManagerAcceptance?.status).toBe('preserved');
    expect(await read(f)).toEqual(current);
  });

  it('retains immutable scoped links and denies runtime/account mutations and helper execution, including late provisioning', async () => {
    const { f, current } = await seed();
    for (const table of ['league_team_manager_entries', 'league_team_manager_memberships']) {
      await expect(runtimeQuery(`DELETE FROM public.${table} WHERE content_id=$1`, [current.accepted.contentId])).rejects.toThrow(/permission denied/);
      await expect(ownerQuery(`DELETE FROM public.${table} WHERE content_id=$1`, [current.accepted.contentId])).rejects.toThrow(/immutable/);
      expect(await ownerQuery(`SELECT has_table_privilege('league_one_auth',$1,'SELECT') AS auth_select,
        has_table_privilege('league_one_runtime',$1,'SELECT') AS runtime_select`, [`public.${table}`]))
        .toEqual([{ auth_select: false, runtime_select: true }]);
    }
    await expect(runtimeQuery('SELECT qualify_team_manager_projection(NULL,NULL,NULL,NULL)')).rejects.toThrow(/permission denied/);
    const owner = await createPinnedIntegrationDatabase('owner');
    try {
      await owner.database.query('BEGIN');
      await owner.database.query('REVOKE ALL ON league_team_manager_entries,league_team_manager_memberships FROM league_one_runtime');
      await owner.database.query(await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'));
      const rights = await owner.database.query(`SELECT c.relname,
        has_table_privilege('league_one_runtime',c.oid,'SELECT') AS read,
        has_table_privilege('league_one_runtime',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS mutate,
        EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0) AS public
        FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('league_team_manager_entries','league_team_manager_memberships')`);
      expect(rights).toHaveLength(2); for (const row of rights) expect(row).toMatchObject({ read: true, mutate: false, public: false });
    } finally { await owner.database.query('ROLLBACK'); await owner.close(); }
    expect(await read(f)).toEqual(current);
  });
  // AUTHORED ONLY: genuine restricted-LOGIN SQL coverage; not an offline unit test.
  type EvidenceAttempts = RosterCaptureAttempts & { evidence: RosterAttempt };
  const completeEvidenceRows: JsonValue = [{ ...initial[0] }, { ...initial[1], co_owners: [] }];
  async function reserveEvidence(f: Fixture, fence?: AdministrationWriteFence): Promise<EvidenceAttempts> {
    const paired = await reserve(f, fence);
    if (!store.beginTeamManagerEvidenceAttempt) throw new Error('Missing v2 reservation capability.');
    return { ...paired, evidence: await store.beginTeamManagerEvidenceAttempt(f.mapping, randomUUID(), fence) };
  }
  async function captureEvidence(f: Fixture, payload: JsonValue = completeEvidenceRows,
    options: { completeness?: 'complete' | 'partial'; origin?: 'network' | 'cache' } = {}) {
    const original = await capture(f, payload, 'rosters', options);
    return normalizeAdministrationObservation(original.envelope, { expectedRosterCount: 2, managerEvidenceVersion: 'v2' });
  }
  const writeEvidence = (f: Fixture, input: NormalizedAdministrationObservation, attempts: EvidenceAttempts,
    proof?: RosterPopulationEvidence, fence?: AdministrationWriteFence, selected = store) => selected.recordObservation(input, fence, f.mapping,
    { attempt: attempts.players, ...(proof ? { population: proof } : {}) },
    { attempt: attempts.managers, ...(proof ? { population: proof } : {}) },
    undefined, undefined, undefined, undefined, undefined,
    { attempt: attempts.evidence, ...(proof ? { population: proof } : {}) });
  async function readEvidence(f: Fixture) {
    if (!store.readAcceptedTeamManagerEvidence) throw new Error('Missing v2 reader capability.');
    const result = await store.readAcceptedTeamManagerEvidence(f.mapping);
    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('Missing v2 manager evidence.');
    return result;
  }
  async function seedEvidence() {
    const f = await fixture(); const proof = await population(f); const attempts = await reserveEvidence(f);
    const input = await captureEvidence(f); const result = await writeEvidence(f, input, attempts, proof);
    expect(result.rosterAcceptance?.status).toBe('accepted'); expect(result.teamManagerAcceptance?.status).toBe('accepted');
    expect(result.teamManagerEvidenceAcceptance?.status).toBe('accepted');
    return { f, proof, attempts, input, result, current: await readEvidence(f), primary: await read(f) };
  }

  it('keeps v1 identities while v2 advances complete to adverse partial and back without merging prior fields', async () => {
    expect((await connection.database.query('SELECT session_user AS role'))[0]?.role).toBe('league_one_runtime');
    const { f, proof, input, attempts, current, primary } = await seedEvidence();
    const original = normalizeAdministrationObservation(input.envelope, { expectedRosterCount: 2 });
    const oldShape = { ...input }; delete oldShape.teamManagerEvidence;
    expect(oldShape).toEqual(original);
    const delegatedInput = { ...oldShape, sourceMapping: f.mapping,
      rosterAcceptance: { attempt: attempts.players, population: proof }, teamManagerAcceptance: { attempt: attempts.managers, population: proof } };
    expect(await ownerQuery(`SELECT evidence_hash=encode(digest(convert_to($1::jsonb::text,'UTF8'),'sha256'),'hex') AS same_hash
      FROM league_roster_capture_receipts WHERE attempt_id=ANY($2::uuid[]) ORDER BY attempt_id`,
    [JSON.stringify(delegatedInput), [attempts.players.id, attempts.managers.id]])).toEqual([{ same_hash: true }, { same_hash: true }]);
    expect(current).toMatchObject({ evidenceCompleteness: 'complete', evidenceReasons: [],
      accepted: { scope: teamManagerEvidenceScope(f.mapping), canonicalNormalizerVersion: TEAM_MANAGER_EVIDENCE_POLICY.canonicalNormalizerVersion } });
    expect(current.receipt.id).not.toBe(primary.receipt.id);
    const immutableV1 = await ownerQuery('SELECT * FROM league_administration_contents WHERE id=$1', [primary.accepted.contentId]);
    const immutableV2 = await ownerQuery(`SELECT * FROM league_team_manager_entries WHERE content_id=$1
      AND normalizer_version=$2 ORDER BY team_id`, [current.accepted.contentId, TEAM_MANAGER_EVIDENCE_POLICY.canonicalNormalizerVersion]);
    const adverseAttempts = await reserveEvidence(f);
    const adverse = await captureEvidence(f, [
      { ...initial[0], owner_id: 42, co_owners: ['co-new', 'co-new', null, '', ' padded ', 'co-last'] },
      { ...initial[1], co_owners: ['manager-b', 'co-independent'] },
    ]);
    expect(adverse.status).toBe('rejected');
    const changed = await writeEvidence(f, adverse, adverseAttempts, proof);
    expect(changed.teamManagerAcceptance?.status).toBe('preserved');
    expect(changed.teamManagerEvidenceAcceptance?.status).toBe('accepted');
    const partial = await readEvidence(f);
    expect(partial).toMatchObject({ evidenceCompleteness: 'partial',
      evidenceReasons: ['co_managers_invalid_members', 'primary_owner_invalid'],
      accepted: { acceptedGeneration: current.accepted.acceptedGeneration + 1 } });
    expect(partial.teams[0]).toMatchObject({ primaryOwner: { state: 'unknown', manager: null, reason: 'primary_owner_invalid' },
      coManagers: { state: 'partial', completeness: 'partial', reason: 'co_managers_invalid_members',
        managers: [{ sourceManager: { nativeId: 'co-new' } }, { sourceManager: { nativeId: 'co-last' } }] } });
    expect(partial.teams[1].coManagers).toMatchObject({ state: 'partial', managers: [{ sourceManager: { nativeId: 'co-independent' } }] });
    expect(await read(f)).toEqual(primary);
    expect(await ownerQuery('SELECT accepted,normalized_value FROM league_administration_contents WHERE id=$1', [partial.accepted.contentId]))
      .toEqual([{ accepted: false, normalized_value: null }]);
    expect(await ownerQuery('SELECT * FROM league_administration_contents WHERE id=$1', [primary.accepted.contentId])).toEqual(immutableV1);
    const restoredAttempts = await reserveEvidence(f);
    expect((await writeEvidence(f, await captureEvidence(f, [
      { ...initial[0], owner_id: 'manager-new', co_owners: [] }, { ...initial[1], owner_id: null, co_owners: [] },
    ]), restoredAttempts, proof)).teamManagerEvidenceAcceptance?.status).toBe('accepted');
    const restored = await readEvidence(f);
    expect(restored).toMatchObject({ evidenceCompleteness: 'complete', evidenceReasons: [],
      accepted: { acceptedGeneration: current.accepted.acceptedGeneration + 2 } });
    expect(restored.teams[0]).toMatchObject({ primaryOwner: { state: 'owned', manager: { sourceManager: { nativeId: 'manager-new' } } },
      coManagers: { state: 'known', managers: [] } });
    expect(restored.teams[1].primaryOwner).toEqual({ state: 'unowned', manager: null });
    expect(await ownerQuery(`SELECT * FROM league_team_manager_entries WHERE content_id=$1
      AND normalizer_version=$2 ORDER BY team_id`, [current.accepted.contentId, TEAM_MANAGER_EVIDENCE_POLICY.canonicalNormalizerVersion])).toEqual(immutableV2);
  });

  it.each([
    { label: 'absent', owner: {}, state: 'unknown', reason: 'primary_owner_absent' },
    { label: 'empty', owner: { owner_id: '' }, state: 'unknown', reason: 'primary_owner_invalid' },
    { label: 'null', owner: { owner_id: null }, state: 'unowned', reason: undefined },
  ] as const)('distinguishes $label primary from vacancy and retains independently valid co-manager identity', async ({ owner, state, reason }) => {
    const { f, proof } = await seedEvidence(); const attempts = await reserveEvidence(f);
    const primaryRow: Record<string, JsonValue> = { roster_id: 1, players: [], co_owners: ['co-only'] };
    if ('owner_id' in owner && owner.owner_id !== undefined) primaryRow.owner_id = owner.owner_id;
    const input = await captureEvidence(f, [primaryRow, { ...initial[1], co_owners: [] }]);
    expect((await writeEvidence(f, input, attempts, proof)).teamManagerEvidenceAcceptance?.status).toBe('accepted');
    const read = await readEvidence(f);
    expect(read.teams[0].primaryOwner).toEqual({ state, manager: null, ...(reason ? { reason } : {}) });
    expect(read.teams[0].coManagers).toMatchObject({ state: 'known', managers: [{ sourceManager: { nativeId: 'co-only' } }] });
    expect(read.evidenceCompleteness).toBe(reason ? 'partial' : 'complete');
    expect(await ownerQuery(`SELECT member.role,manager.external_manager_id FROM league_team_manager_memberships member
      JOIN league_source_manager_accounts manager ON manager.id=member.manager_id
      WHERE member.content_id=$1 AND member.normalizer_version=$2 AND member.team_id=$3`,
    [read.accepted.contentId, TEAM_MANAGER_EVIDENCE_POLICY.canonicalNormalizerVersion, read.teams[0].seasonTeamId]))
      .toEqual([{ role: 'co_owner', external_manager_id: 'co-only' }]);
  });

  it.each([
    ['missing team', [initial[0]], 'complete'], ['duplicate team', [initial[0], initial[0]], 'complete'],
    ['foreign team', [{ ...initial[0], league_id: 'foreign' }, initial[1]], 'complete'],
    ['partial response', completeEvidenceRows, 'partial'],
  ] as const)('preserves v2 accepted evidence for %s without fabricating full team coverage', async (_label, rows, completeness) => {
    const { f, proof, current } = await seedEvidence(); const attempts = await reserveEvidence(f);
    const result = await writeEvidence(f, await captureEvidence(f, rows as JsonValue, { completeness }), attempts, proof);
    expect(result.teamManagerEvidenceAcceptance).toMatchObject({ status: 'preserved', reason: 'complete_manager_evidence_population_unproved' });
    expect(await readEvidence(f)).toEqual(current);
  });

  it('binds the sibling policy and exact retry bytes while original callers leave v2 heads alone', async () => {
    const { f, proof, attempts, input, current, primary } = await seedEvidence(); const saved = await history(f);
    expect((await writeEvidence(f, input, attempts, proof)).teamManagerEvidenceAcceptance)
      .toMatchObject({ status: 'accepted', reason: 'exact_receipt_replay', receiptId: current.receipt.id });
    const changed = structuredClone(input);
    if (!changed.teamManagerEvidence?.teams) throw new Error('Missing v2 projection.');
    const forged = changed.teamManagerEvidence as unknown as { teams: { coManagers: unknown }[] };
    forged.teams[0].coManagers = { state: 'known', externalManagerIds: ['invented-co-manager'] };
    await expect(writeEvidence(f, changed, attempts, proof)).rejects.toThrow(/receipt conflict/);
    expect(await history(f)).toEqual(saved); expect(await readEvidence(f)).toEqual(current);
    const fresh = await reserveEvidence(f); const freshInput = await captureEvidence(f);
    await expect(store.recordObservation(freshInput, undefined, f.mapping, undefined,
      { attempt: fresh.evidence, population: proof })).rejects.toThrow(/policy mismatch/);
    await expect(store.recordObservation(freshInput, undefined, f.mapping, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, { attempt: fresh.managers, population: proof })).rejects.toThrow(/policy mismatch/);
    expect(await read(f)).toEqual(primary); expect(await readEvidence(f)).toEqual(current);
    const legacyOnly = await reserve(f); const legacyInput = await capture(f, completeEvidenceRows);
    expect((await write(f, legacyInput, legacyOnly, proof)).teamManagerEvidenceAcceptance).toBeUndefined();
    expect(await readEvidence(f)).toEqual(current);
  });

  it.each(['older-first', 'newer-first'] as const)('orders v2 field evidence independently under %s completion', async order => {
    const { f, proof, current } = await seedEvidence();
    const older = await reserveEvidence(f); const olderInput = await captureEvidence(f, [{ ...initial[0], co_owners: ['older-co'] }, { ...initial[1], co_owners: [] }]);
    const newer = await reserveEvidence(f); const newerInput = await captureEvidence(f, [{ roster_id: 1, players: [], co_owners: ['newer-co'] }, { ...initial[1], co_owners: [] }]);
    let oldResult;
    if (order === 'older-first') {
      oldResult = await writeEvidence(f, olderInput, older, proof); expect(await readEvidence(f)).toEqual(current);
      await writeEvidence(f, newerInput, newer, proof);
    } else { await writeEvidence(f, newerInput, newer, proof); oldResult = await writeEvidence(f, olderInput, older, proof); }
    expect(oldResult.teamManagerEvidenceAcceptance?.reason).toBe('newer_network_attempt_reserved');
    const latest = await readEvidence(f);
    expect(latest.teams[0]).toMatchObject({ primaryOwner: { state: 'unknown', reason: 'primary_owner_absent' },
      coManagers: { state: 'known', managers: [{ sourceManager: { nativeId: 'newer-co' } }] } });
    expect(latest.evidenceCompleteness).toBe('partial');
  });

  it('does not turn pre-reservation or cache bytes into a fresh v2 acquisition', async () => {
    const { f, proof, current } = await seedEvidence();
    const old = await captureEvidence(f); const attempts = await reserveEvidence(f);
    expect((await writeEvidence(f, old, attempts, proof)).teamManagerEvidenceAcceptance?.status).toBe('preserved');
    expect(await readEvidence(f)).toEqual(current);
    const cached = await captureEvidence(f, completeEvidenceRows, { origin: 'cache' });
    await expect(writeEvidence(f, cached, await reserveEvidence(f), proof)).rejects.toThrow(/network capture/);
    expect(await readEvidence(f)).toEqual(current);
  });

  it('keeps v2 mapping revisions distinct through A-B-A remaps and permits only new-revision acquisition', async () => {
    const { f, proof, current } = await seedEvidence(); const pending = await reserveEvidence(f); const input = await captureEvidence(f);
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'synthetic v2 remap')", [f.leagueSeasonId, f.mapping.revisionId, 'v2-remap-b']);
    const middle = await store.readSourceMapping('v2-remap-b');
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'synthetic v2 return')", [f.leagueSeasonId, middle!.revisionId, f.externalLeagueId]);
    const latest = await store.readSourceMapping(f.externalLeagueId);
    if (!latest || !store.readAcceptedTeamManagerEvidence) throw new Error('Missing remapped v2 fixture.');
    expect(await store.readAcceptedTeamManagerEvidence(latest)).toEqual({ status: 'missing' });
    await expect(writeEvidence(f, input, pending, proof)).rejects.toThrow(/mapping.*(?:stale|mismatch)|source mapping/);
    expect(await ownerQuery('SELECT source_mapping_revision_id FROM league_roster_resource_acceptances WHERE receipt_id=$1', [current.receipt.id]))
      .toEqual([{ source_mapping_revision_id: f.mapping.revisionId }]);
    const next = { ...f, mapping: latest }; const nextProof = await population(next); const attempts = await reserveEvidence(next);
    expect((await writeEvidence(next, await captureEvidence(next), attempts, nextProof)).teamManagerEvidenceAcceptance?.status).toBe('accepted');
    expect((await readEvidence(next)).teams[0].seasonTeamId).toBe(current.teams[0].seasonTeamId);
    const reused = await reserveEvidence(next);
    expect((await writeEvidence(next, await captureEvidence(next), reused)).teamManagerEvidenceAcceptance?.status).toBe('accepted');
  });

  it('rolls back both earlier v1 publications when the v2 sibling head waits past the same worker deadline', async () => {
    const { f, proof, current, primary } = await seedEvidence();
    const owner = await createPinnedIntegrationDatabase('owner'); const writer = await createPinnedIntegrationDatabase('runtime');
    let completion: Promise<{ error?: unknown }> | undefined;
    try {
      const [ownerPid] = await owner.database.query('SELECT pg_backend_pid() AS pid');
      const [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
      expect(writerPid.role).toBe('league_one_runtime');
      const jobKey = `manager-v2-block:${randomUUID()}`; const workerId = randomUUID();
      await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
        VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '5 minutes',1)`, [jobKey, workerId]);
      const [clock] = await ownerQuery("SELECT clock_timestamp()+interval '8 seconds' AS at");
      const fence = { jobKey, workerId, generation: 1, deadlineAt: instant(clock.at) };
      const attempts = await reserveEvidence(f, fence);
      const input = await captureEvidence(f, [{ ...initial[0], owner_id: 'blocked-v2', players: ['blocked-player'] }, { ...initial[1], co_owners: [] }]);
      const previousPlayers = await store.readAcceptedCurrentRoster(f.mapping); const previousHistory = await history(f);
      await owner.database.query('BEGIN');
      await owner.database.query('SELECT scope_id FROM league_roster_resource_heads WHERE scope_id=$1 FOR UPDATE', [attempts.evidence.scopeId]);
      let settled = false;
      completion = writeEvidence(f, input, attempts, proof, fence, createLeagueAdministrationMethods(writer.database))
        .then(() => ({}), error => ({ error })).finally(() => { settled = true; });
      let blocked = false;
      for (let poll = 0; poll < 50; poll++) {
        const [row] = await owner.database.query('SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS blocked', [ownerPid.pid, writerPid.pid]);
        if (row.blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true); expect(settled).toBe(false);
      await owner.database.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)', [fence.deadlineAt]);
      await owner.database.query('COMMIT');
      expect(String((await completion).error)).toMatch(/writer fence.*(?:stale|expired)/);
      expect(await read(f)).toEqual(primary); expect(await readEvidence(f)).toEqual(current);
      expect(await store.readAcceptedCurrentRoster(f.mapping)).toEqual(previousPlayers);
      expect(await history(f)).toEqual(previousHistory);
      expect(await ownerQuery('SELECT id FROM league_roster_capture_receipts WHERE attempt_id=ANY($1::uuid[])',
        [[attempts.players.id, attempts.managers.id, attempts.evidence.id]])).toEqual([]);
    } finally {
      await owner.database.query('ROLLBACK').catch(() => undefined); await completion; await writer.close(); await owner.close();
    }
  });

  it('rejects missing and changed v2 worker fences and forged field evidence without replacing its accepted head', async () => {
    const { f, proof, current } = await seedEvidence(); const jobKey = `manager-v2-fence:${randomUUID()}`; const workerId = randomUUID();
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
      VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '5 minutes',1)`, [jobKey, workerId]);
    const [clock] = await ownerQuery("SELECT clock_timestamp()+interval '5 minutes' AS at");
    const fence = { jobKey, workerId, generation: 1, deadlineAt: instant(clock.at) };
    const attempts = await reserveEvidence(f, fence); const input = await captureEvidence(f);
    await expect(writeEvidence(f, input, attempts, proof)).rejects.toThrow(/scope mismatch/);
    await expect(writeEvidence(f, input, attempts, proof, { ...fence, generation: 2 })).rejects.toThrow(/fence.*(?:stale|expired)|scope mismatch/);
    await ownerQuery("UPDATE projection_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE job_key=$1", [jobKey]);
    await expect(writeEvidence(f, input, attempts, proof, fence)).rejects.toThrow(/fence.*(?:stale|expired)/);
    const fresh = await reserveEvidence(f); const forged = structuredClone(await captureEvidence(f));
    const projection = forged.teamManagerEvidence as unknown as { teams: { primaryOwner: unknown }[] };
    projection.teams[0].primaryOwner = { state: 'unknown', externalManagerId: null, reason: 'primary_owner_absent' };
    expect((await writeEvidence(f, forged, fresh, proof)).teamManagerEvidenceAcceptance?.status).toBe('preserved');
    expect(await readEvidence(f)).toEqual(current);
  });

  it('keeps the new projection helpers and delegated writer owner-only and v2 history immutable after late role provisioning', async () => {
    const { f, current } = await seedEvidence();
    await expect(runtimeQuery('SELECT public.project_team_manager_evidence_fields(NULL,NULL)')).rejects.toThrow(/permission denied/);
    await expect(runtimeQuery('SELECT public.qualify_team_manager_evidence_projection(NULL,NULL,NULL,NULL)')).rejects.toThrow(/permission denied/);
    await expect(runtimeQuery('SELECT public.record_league_administration_observation_v34(NULL)')).rejects.toThrow(/permission denied/);
    for (const table of ['league_team_manager_entries', 'league_team_manager_memberships']) {
      await expect(runtimeQuery(`DELETE FROM public.${table} WHERE content_id=$1 AND normalizer_version=$2`,
        [current.accepted.contentId, TEAM_MANAGER_EVIDENCE_POLICY.canonicalNormalizerVersion])).rejects.toThrow(/permission denied/);
      await expect(ownerQuery(`DELETE FROM public.${table} WHERE content_id=$1 AND normalizer_version=$2`,
        [current.accepted.contentId, TEAM_MANAGER_EVIDENCE_POLICY.canonicalNormalizerVersion])).rejects.toThrow(/immutable/);
    }
    const owner = await createPinnedIntegrationDatabase('owner');
    try {
      await owner.database.query('BEGIN');
      await owner.database.query(await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'));
      for (const helper of ['public.project_team_manager_evidence_fields(jsonb,text)',
        'public.qualify_team_manager_evidence_projection(jsonb,jsonb,text,integer)', 'public.record_league_administration_observation_v34(jsonb)']) {
        expect(await owner.database.query(`SELECT has_function_privilege('league_one_runtime',$1,'EXECUTE') AS runtime,
          has_function_privilege('league_one_auth',$1,'EXECUTE') AS auth`, [helper])).toEqual([{ runtime: false, auth: false }]);
      }
    } finally { await owner.database.query('ROLLBACK'); await owner.close(); }
    expect(await readEvidence(f)).toEqual(current);
  });

});
