import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from '../lib/league-administration/store';
import { runPublicIntakeStep, runPublicDataRefreshStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
import { PUBLIC_INTAKE_JOB, PUBLIC_PERIOD_INVENTORY, type PublicIntakeStore } from '../lib/league-administration/public-intake-contracts';
import { createProjectionStore } from '../lib/projection-store';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

const weeks = Array.from({ length: 18 }, (_, index) => index + 1);
const requestedPeriods = weeks.map(nativeWeek => ({ season: 2026, nativeWeek }));
const numericId = () => '8' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const inventoryTables = ['public_data_period_inventory_plans', 'public_data_period_inventory_sources'] as const;
const leagueDocument = (id: string) => ({ league_id: id, season: '2026', sport: 'nfl', name: 'CP8 synthetic DATA league',
  total_rosters: 2, roster_positions: ['QB', 'BN'], scoring_settings: { rec: 0.5 },
  settings: { leg: 2, last_scored_leg: 0, start_week: 1, playoff_week_start: 15 } });

/** AUTHORED / UNEXECUTED CP8 SQL qualification. All 18 durable tasks are checked;
 * synthetic HTTP acquires only weeks 1/2 in each of two pending intakes. No all-18
 * elapsed acquisition, terminal full-mode cycle, live provider availability,
 * phase classification or fresh-role provisioning claim. Three 60s, two 180s and
 * one 840s case plus two existing 120s hooks total 27min: an unmeasured authored
 * allowance, not a lifecycle guarantee. Original 20s worker, 60s admission and
 * 30/40/50min work/lifecycle/CI bounds remain unchanged. */
describe.sequential('bounded current season period inventory through restricted PostgreSQL', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationStore>;
  let intake: PublicIntakeStore;
  let refresh: ReturnType<typeof createPublicDataRefreshStore>;
  let capacityId: string, originalId: string, cycleId: string, targetId: string;
  let mapping: AdministrationSourceMapping;
  let retained: Awaited<ReturnType<typeof history>>;
  let replay: Parameters<PublicIntakeStore['completeExactPeriod']>;
  beforeAll(async () => {
    connection = createIndependentDatabase(); administration = createLeagueAdministrationStore(connection.database);
    intake = createPublicIntakeStore(connection.database); refresh = createPublicDataRefreshStore(connection.database);
    expect((await connection.database.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb
      FROM pg_roles WHERE rolname=current_user`))[0]).toEqual({ current_user: 'league_one_runtime',
      session_user: 'league_one_runtime', rolsuper: false, rolcreaterole: false, rolcreatedb: false });
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      const until = Date.now() + 85_000;
      while (true) {
        const [row] = await connection.database.query(`SELECT
          NOT EXISTS(SELECT 1 FROM public.public_data_dispatches WHERE admitted_at>clock_timestamp()-interval '60 seconds')
          AND NOT EXISTS(SELECT 1 FROM public.projection_jobs WHERE job_key=$1
            AND (state='running' OR completed_at>clock_timestamp()-interval '60 seconds')) AS ready`, [PUBLIC_INTAKE_JOB]);
        if (row.ready === true) break;
        if (Date.now() >= until) throw new Error('CP8 shared minute cleanup did not settle.');
        await delay(250);
      }
    } finally { await connection.close(); }
  });
  const dependencies = (): PublicIntakeDependencies => ({ intake, administration, jobs: createProjectionStore(connection.database) });
  async function progress(id: string, resource: string, status = 'progress', override = dependencies(), recurring = false) {
    const until = Date.now() + 150_000;
    do {
      const outcome = recurring ? await runPublicDataRefreshStep({ ...override, refresh }, AbortSignal.timeout(20_000))
        : await runPublicIntakeStep(id, override, AbortSignal.timeout(20_000));
      if (['busy', 'backoff', 'idle'].includes(outcome.status)) { await delay(1_000); continue; }
      expect(outcome).toMatchObject({ status, resource, providerRequests: resource === 'exact-matchups' ? 2 : 1 }); return;
    } while (Date.now() < until);
    throw new Error('CP8 stage did not complete within its existing admission allowance.');
  }
  const submit = (id: string, username: string) => intake.submit({ id, username, seasons: [2026], periodInventory: PUBLIC_PERIOD_INVENTORY });
  async function history(id: string) {
    return connection.database.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY season,external_league_id) FROM public_data_period_inventory_plans p WHERE intake_id=$1) AS plans,
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY season,external_league_id,source_kind,source_ordinal) FROM public_data_period_inventory_sources s WHERE intake_id=$1) AS sources,
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY ordinal) FROM public_data_exact_period_tasks t WHERE intake_id=$1) AS tasks,
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY task_ordinal) FROM public_data_exact_period_checkpoints c WHERE intake_id=$1) AS checkpoints`, [id]);
  }
  async function checkpointState(id: string) {
    return connection.database.query(`SELECT
      (SELECT to_jsonb(i) FROM public_data_intakes i WHERE id=$1) AS intake,
      (SELECT jsonb_agg(to_jsonb(l) ORDER BY season) FROM public_data_league_lists l WHERE intake_id=$1) AS lists,
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY season,external_league_id) FROM public_data_league_candidates c WHERE intake_id=$1) AS candidates,
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.worker_id,o.generation) FROM public_data_dispatch_outcomes o
        JOIN public_data_dispatches d USING(worker_id,generation) WHERE d.intake_id=$1) AS outcomes`, [id]);
  }
  async function readOnly<T>(body: (database: DatabaseClient, store: ReturnType<typeof createLeagueAdministrationStore>) => Promise<T>) {
    const queries: string[] = [];
    const database: DatabaseClient = { enabled: true,
      query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        queries.push(sql); expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu);
        return connection.database.query<Row>(sql, parameters, options);
      } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP8 stored reads must not acquire source.'));
    try { const result = await body(database, createLeagueAdministrationStore(database));
      expect(fetch).not.toHaveBeenCalled(); expect(queries.length).toBeGreaterThan(0); return result;
    } finally { fetch.mockRestore(); }
  }

  it('validates full inventory scope and preserves legacy omitted empty and exact selectors before admission', async () => {
    const runtime = await createPinnedIntegrationDatabase('runtime'); let open = false;
    try {
      await runtime.database.query('BEGIN'); open = true;
      const id = randomUUID(), base = { id, username: 'cp8_sql_scope', seasons: [2026] };
      const sqlSubmit = (input: unknown) => runtime.database.query('SELECT public.submit_public_data_intake($1::jsonb)', [JSON.stringify(input)]);
      for (const input of [
        { ...base, periodInventory: null }, { ...base, periodInventory: 'unknown' },
        { ...base, periodInventory: PUBLIC_PERIOD_INVENTORY, seasons: [2025] },
        { ...base, periodInventory: PUBLIC_PERIOD_INVENTORY, seasons: [2026, 2027] },
        { ...base, periodInventory: PUBLIC_PERIOD_INVENTORY, exactPeriods: [] },
        { ...base, exactPeriods: [{ season: 2026, nativeWeek: 1 }, { season: 2026, nativeWeek: 2 }] },
      ]) {
        await runtime.database.query('SAVEPOINT invalid_scope');
        try { await expect(sqlSubmit(input)).rejects.toThrow(); }
        finally { await runtime.database.query('ROLLBACK TO SAVEPOINT invalid_scope'); }
        expect(await runtime.database.query('SELECT id FROM public_data_intakes WHERE id=$1', [id])).toEqual([]);
      }
      await sqlSubmit(base); await sqlSubmit({ ...base, exactPeriods: [] });
      expect(await runtime.database.query('SELECT period_inventory,exact_periods FROM public_data_intakes WHERE id=$1', [id]))
        .toEqual([{ period_inventory: null, exact_periods: [] }]);
      const full = { ...base, id: randomUUID(), periodInventory: PUBLIC_PERIOD_INVENTORY };
      await sqlSubmit(full); await sqlSubmit(full);
      expect(await runtime.database.query('SELECT period_inventory,exact_periods FROM public_data_intakes WHERE id=$1', [full.id]))
        .toEqual([{ period_inventory: PUBLIC_PERIOD_INVENTORY, exact_periods: requestedPeriods }]);
      const exact = { ...base, id: randomUUID(), exactPeriods: [{ season: 2026, nativeWeek: 18 }] };
      await sqlSubmit(exact); await sqlSubmit(exact);
      for (const input of [{ ...base, periodInventory: PUBLIC_PERIOD_INVENTORY }, { ...full, periodInventory: undefined },
        { ...exact, exactPeriods: [{ season: 2026, nativeWeek: 17 }] }]) {
        await runtime.database.query('SAVEPOINT mismatched_replay');
        try { await expect(sqlSubmit(input)).rejects.toThrow(/replay mismatch/); }
        finally { await runtime.database.query('ROLLBACK TO SAVEPOINT mismatched_replay'); }
      }
      expect(await runtime.database.query('SELECT * FROM public_data_dispatches WHERE intake_id=ANY($1::uuid[])', [[id, full.id, exact.id]])).toEqual([]);
    } finally { if (open) await runtime.database.query('ROLLBACK'); await runtime.close(); }
  }, 60_000);

  it('rolls back a witnessed late inventory write then accounts for one thousand leagues and all admitted period tasks', async () => {
    capacityId = randomUUID(); const manager = numericId(), username = 'cp8_capacity_' + manager;
    const leagues = Array.from({ length: 1000 }, (_, index) => leagueDocument(String(BigInt(manager) + BigInt(1000 - index))));
    const urls: string[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      if (url === 'https://api.sleeper.app/v1/user/' + username) return new Response(JSON.stringify({ user_id: manager, username }));
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return new Response(JSON.stringify(leagues));
      throw new Error('CP8 capacity discovery must not fan out to league or period requests.');
    });
    const blocker = await createPinnedIntegrationDatabase('owner'), writer = await createPinnedIntegrationDatabase('runtime');
    let open = false, pending: Promise<{ error?: unknown }> | undefined, rollbackProved = false;
    try {
      await submit(capacityId, username); await progress(capacityId, 'identity');
      await progress(capacityId, 'leagues', 'unavailable', { ...dependencies(), intake: { ...intake, recordLeagues: async (work, capture, fence) => {
        const before = await checkpointState(capacityId), oldHistory = await history(capacityId);
        const [ownerPid] = await blocker.database.query('SELECT pg_backend_pid() AS pid');
        const [runtimePid] = await writer.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
        expect(runtimePid.role).toBe('league_one_runtime');
        await blocker.database.query('BEGIN'); open = true;
        await blocker.database.query('LOCK TABLE public.public_data_period_inventory_plans IN SHARE MODE');
        let settled = false;
        pending = createPublicIntakeStore(writer.database).recordLeagues(work, capture, fence)
          .then(() => ({}), error => ({ error })).finally(() => { settled = true; });
        let observed = false;
        for (let poll = 0; poll < 120; poll++) {
          const [row] = await blocker.database.query(`SELECT $1::integer=ANY(pg_blocking_pids($2::integer))
            AND EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2::integer AND relation='public.public_data_period_inventory_plans'::regclass
              AND mode='RowExclusiveLock' AND NOT granted) AND clock_timestamp()<$3::timestamptz AS blocked`,
          [ownerPid.pid, runtimePid.pid, fence.deadlineAt]);
          if (row.blocked) { observed = true; break; } await delay(25);
        }
        expect(observed, 'New CP8 INSERT must wait after delegated checkpoint under its original live fence.').toBe(true);
        expect(settled).toBe(false);
        await blocker.database.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)', [fence.deadlineAt]);
        await blocker.database.query('COMMIT'); open = false;
        const result = await pending; expect(String(result.error)).toMatch(/lease lost|deadline|fence|expired/);
        expect(await checkpointState(capacityId)).toEqual(before); expect(await history(capacityId)).toEqual(oldHistory);
        rollbackProved = true; throw result.error;
      } } });
      expect(rollbackProved).toBe(true);
      await progress(capacityId, 'leagues'); expect(urls).toHaveLength(3);
      const saved = await history(capacityId); await submit(capacityId, username); expect(await history(capacityId)).toEqual(saved);
      fetch.mockRestore();
      await readOnly(async (database, store) => {
        const read = await readPublicSleeperIntake(database, store, capacityId);
        expect(read).toMatchObject({ status: 'pending', reason: 'period-page-not-fully-verified', periodInventory: {
          policy: PUBLIC_PERIOD_INVENTORY, discovery: 'complete', coverage: 'limited', collection: 'pending', readCoverage: 'page',
          summary: { observedLeagues: 1000, admittedLeagues: 20, capacityLeagues: 980, requestedPeriods: 18000,
            admittedPeriods: 360, capacityPeriods: 17640, pendingPeriods: 360, completePeriods: 0, unavailablePeriods: 0 },
          page: { afterOrdinal: 0, limit: 20, nextAfterOrdinal: 20 }, gaps: [],
        } });
        if (read.status === 'missing' || !read.periodInventory) throw new Error('Missing CP8 inventory read.');
        const admitted = leagues.slice(0, 20).map(league => league.league_id).sort();
        expect(read.periodInventory.tasks.map(task => [task.externalLeagueId, task.nativeWeek, task.ordinal]))
          .toEqual(admitted.flatMap((native, index) => weeks.map(week => [native, week, index * 18 + week])));
        expect(read.periodInventory.sources).toHaveLength(1000); expect(read.exactPeriods).toHaveLength(20);
        expect(read.periodInventory.tasks.every(task => task.phase.status === 'unknown' && task.collection === 'pending')).toBe(true);
        const tail = await readPublicSleeperIntake(database, store, capacityId, { periodInventoryPage: { afterOrdinal: 340, limit: 20 } });
        expect(tail).toMatchObject({ periodInventory: { collection: 'pending', page: { nextAfterOrdinal: null } } });
        if (tail.status === 'missing') throw new Error('Missing CP8 tail.');
        expect(tail.exactPeriods?.map(period => period.ordinal)).toEqual(Array.from({ length: 20 }, (_, index) => 341 + index));
      });
      expect(await connection.database.query('SELECT * FROM public_data_exact_period_checkpoints WHERE intake_id=$1', [capacityId])).toEqual([]);
      expect((await connection.database.query(`SELECT count(*)::integer AS count FROM public_data_dispatch_outcomes outcome
        JOIN public_data_dispatches dispatch USING(worker_id,generation) WHERE dispatch.intake_id=$1 AND dispatch.resource='leagues'
        AND outcome.outcome='checkpoint-committed'`, [capacityId]))[0].count).toBe(1);
    } finally { fetch.mockRestore(); if (open) await blocker.database.query('ROLLBACK'); await pending; await writer.close(); await blocker.close(); }
  }, 180_000);

  it('records an ordinary empty discovery as zero inventory without invented period availability', async () => {
    const id = randomUUID(), manager = numericId(), username = 'cp8_empty_' + manager; const urls: string[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      if (url === 'https://api.sleeper.app/v1/user/' + username) return new Response(JSON.stringify({ user_id: manager, username }));
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return new Response('[]');
      throw new Error('Unexpected CP8 empty discovery request.');
    });
    try {
      await submit(id, username); await progress(id, 'identity'); await progress(id, 'leagues');
      expect(await intake.next(id)).toBe('complete'); expect(urls).toHaveLength(2); fetch.mockRestore();
      await readOnly(async (database, store) => {
        expect(await readPublicSleeperIntake(database, store, id)).toMatchObject({ status: 'available', request: { terminal: true }, leagues: [], exactPeriods: [], periodInventory: {
          discovery: 'complete', coverage: 'complete', collection: 'complete', readCoverage: 'complete', tasks: [], sources: [], gaps: [],
          summary: { observedLeagues: 0, admittedLeagues: 0, capacityLeagues: 0, requestedPeriods: 0,
            admittedPeriods: 0, capacityPeriods: 0, pendingPeriods: 0, completePeriods: 0, unavailablePeriods: 0 },
        } });
      });
      expect(await history(id)).toEqual([{ plans: null, sources: null, tasks: null, checkpoints: null }]);
    } finally { fetch.mockRestore(); }
  }, 180_000);

  it('resumes representative ordinary captures and refresh while retaining the full eighteen task inventories', async () => {
    originalId = randomUUID(); const manager = numericId(), external = numericId(), username = 'cp8_periods_' + manager;
    const league = leagueDocument(external);
    const duplicate = { ...league, settings: { ...league.settings, leg: 19 } }; // exact duplicate identity, distinct raw clue
    let correction = false, failSecond = false; const urls: string[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      if (url === 'https://api.sleeper.app/v1/user/' + username || url === 'https://api.sleeper.app/v1/user/' + manager)
        return new Response(JSON.stringify({ user_id: manager, username }));
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return new Response(JSON.stringify([league, duplicate]));
      if (url === 'https://api.sleeper.app/v1/league/' + external) return new Response(JSON.stringify(league));
      for (const week of [1, 2]) if (url === 'https://api.sleeper.app/v1/league/' + external + '/matchups/' + week) {
        if (week === 2 && failSecond) return new Response('{}', { status: 503 });
        return new Response(JSON.stringify([{ roster_id: 1, matchup_id: 1, points: correction ? 21 : 10, players: [], starters: [] },
          { roster_id: 2, matchup_id: 1, points: 8, players: [], starters: [] }]));
      }
      throw new Error('Unexpected CP8 representative request: ' + url);
    });
    let target: { targetId: string; configurationRevision: number } | undefined;
    const configuration = { id: randomUUID(), expectedRevision: 0, identityRequestId: originalId, seasons: [2026],
      periodInventory: PUBLIC_PERIOD_INVENTORY, cadenceSeconds: 60, expiresAt: new Date(Date.now() + 25 * 60_000).toISOString(), paused: false };
    try {
      await submit(originalId, username);
      for (const resource of ['identity', 'leagues', 'bootstrap']) await progress(originalId, resource);
      const source = await administration.readSourceMapping(external); if (!source) throw new Error('Missing CP8 source mapping.'); mapping = source;
      expect(await intake.next(originalId)).toMatchObject({ kind: 'exact-matchups', nativeWeek: 1 });
      let acknowledgmentProved = false;
      await progress(originalId, 'exact-matchups', 'unavailable', { ...dependencies(), intake: { ...intake,
        completeExactPeriod: async (work, selected, checkpoint, fence) => {
          expect(work.nativeWeek).toBe(1);
          await expect(intake.completeExactPeriod({ ...work, nativeWeek: 2 }, selected, checkpoint, fence)).rejects.toThrow();
          await expect(intake.completeExactPeriod(work, { ...selected, revisionId: randomUUID() }, checkpoint, fence)).rejects.toThrow();
          await expect(intake.completeExactPeriod(work, selected, { ...checkpoint, receipts: { ...checkpoint.receipts, matchups: randomUUID() } }, fence)).rejects.toThrow();
          await intake.completeExactPeriod(work, selected, checkpoint, fence);
          replay = [work, selected, checkpoint, fence];
          await expect(intake.completeExactPeriod(...replay)).rejects.toThrow();
          acknowledgmentProved = true; throw new Error('CP8 genuine checkpoint committed; acknowledgment lost.');
        } } });
      expect(acknowledgmentProved).toBe(true);
      expect(await intake.next(originalId)).toMatchObject({ kind: 'exact-matchups', nativeWeek: 2 });
      failSecond = true; await progress(originalId, 'exact-matchups', 'unavailable');
      expect(await connection.database.query('SELECT native_week,status,failure_count FROM public_data_exact_period_tasks WHERE intake_id=$1 AND native_week<=2 ORDER BY native_week', [originalId]))
        .toEqual([{ native_week: 1, status: 'complete', failure_count: 0 }, { native_week: 2, status: 'pending', failure_count: 1 }]);
      failSecond = false; await progress(originalId, 'exact-matchups'); expect(urls).toHaveLength(9);
      retained = await history(originalId);
      const first = await readPublicSleeperIntake(connection.database, administration, originalId);
      expect(first).toMatchObject({ status: 'pending', periodInventory: { coverage: 'limited', collection: 'pending', readCoverage: 'complete',
        summary: { observedLeagues: 1, admittedPeriods: 18, completePeriods: 2, pendingPeriods: 16, unavailablePeriods: 0 } } });
      if (first.status === 'missing' || !first.periodInventory) throw new Error('Missing CP8 first period read.');
      expect(first.periodInventory.tasks.map(task => task.nativeWeek)).toEqual(weeks);
      expect(first.exactPeriods?.slice(0, 2).map(period => period.resource.status)).toEqual(['available', 'available']);
      expect(first.periodInventory.gaps).toEqual([expect.objectContaining({ externalLeagueId: external, season: 2026,
        sourceKind: 'leagues', sourcePath: 'settings.leg', nativePeriod: 19, reason: 'native-period-outside-supported-range' })]);
      expect(first.periodInventory.sources).toHaveLength(3);
      expect(first.periodInventory.sources.filter(source => source.sourceKind === 'leagues')
        .map(source => source.references.find(reference => reference.sourcePath === 'settings.leg')?.value)).toEqual([2, 19]);
      expect(first.periodInventory.sources.every(source => source.references.some(reference => reference.sourcePath === 'settings.last_scored_leg'
        && reference.state === 'known' && reference.value === 0))).toBe(true);
      target = await refresh.configure(configuration); targetId = target.targetId;
      expect(await refresh.configure(configuration)).toMatchObject({ status: 'replayed', targetId });
      correction = true;
      for (const resource of ['identity', 'leagues', 'bootstrap', 'exact-matchups', 'exact-matchups']) await progress(originalId, resource, 'progress', dependencies(), true);
      expect(urls).toHaveLength(16); expect(urls[9]).toBe('https://api.sleeper.app/v1/user/' + manager);
      expect(urls.some(url => /\/matchups\/(?:[3-9]|1[0-9])$/u.test(url))).toBe(false);
      fetch.mockRestore();
      await readOnly(async (database, store) => {
        const current = await readPublicDataRefresh(database, store, targetId);
        expect(current).toMatchObject({ status: 'available', target: { periodInventory: PUBLIC_PERIOD_INVENTORY },
          cycle: { periodInventory: PUBLIC_PERIOD_INVENTORY, exactPeriods: requestedPeriods, outcome: null },
          intake: { status: 'pending', periodInventory: { discovery: 'complete', coverage: 'limited', collection: 'pending',
            summary: { admittedPeriods: 18, completePeriods: 2, pendingPeriods: 16 } } } });
        if (current.status !== 'available' || !current.cycle || !current.intake || current.intake.status === 'missing') throw new Error('Missing CP8 refresh cycle.');
        cycleId = current.cycle.requestId;
        expect(current.intake.exactPeriods?.slice(0, 2).map(period => period.resource.status)).toEqual(['available', 'available']);
        const old = await readPublicSleeperIntake(database, store, originalId);
        if (old.status === 'missing') throw new Error('Missing old CP8 intake.');
        expect(old.exactPeriods?.slice(0, 2).map(period => period.resource)).toEqual([
          expect.objectContaining({ status: 'unavailable', reason: 'intake-capture-not-current-head' }),
          expect.objectContaining({ status: 'unavailable', reason: 'intake-capture-not-current-head' }),
        ]);
        expect(old.periodInventory?.summary).toMatchObject({ completePeriods: 2, pendingPeriods: 16 });
      });
      expect(cycleId).not.toBe(originalId); expect(await history(originalId)).toEqual(retained);
      expect(await intake.next(originalId)).toMatchObject({ kind: 'exact-matchups', nativeWeek: 3 });
      expect(await intake.next(cycleId)).toMatchObject({ kind: 'exact-matchups', nativeWeek: 3 });
      const witnessed = await connection.database.query(`SELECT checkpoint.intake_id,checkpoint.task_ordinal,
        dispatch.work->>'kind'='exact-matchups' AND (dispatch.work->>'nativeWeek')::integer=task.native_week AS same_work,
        checkpoint.source_mapping=attempt.source_mapping AS same_mapping,
        receipt.provenance->'acquisition'->>'dispatchNonce'=dispatch.capture_nonce::text
          AND receipt.provenance->'acquisition'->'work'=dispatch.work
          AND receipt.provenance->'acquisition'->'fence'=attempt.write_fence AS witnessed,
        attempt.reserved_at>=dispatch.admitted_at AND receipt.recorded_at>=attempt.reserved_at AS database_order
        FROM public_data_exact_period_checkpoints checkpoint
        JOIN public_data_exact_period_tasks task ON task.intake_id=checkpoint.intake_id AND task.ordinal=checkpoint.task_ordinal
        JOIN public_data_dispatches dispatch ON dispatch.worker_id=checkpoint.worker_id AND dispatch.generation=checkpoint.generation
        JOIN league_roster_capture_receipts receipt ON receipt.id IN(checkpoint.settings_receipt_id,checkpoint.matchups_receipt_id)
        JOIN league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
        WHERE checkpoint.intake_id=ANY($1::uuid[])`, [[originalId, cycleId]]);
      expect(witnessed).toHaveLength(8);
      for (const row of witnessed) expect(row).toMatchObject({ same_work: true, same_mapping: true, witnessed: true, database_order: true });
      expect((await connection.database.query('SELECT count(*)::integer AS count FROM public_data_exact_period_tasks WHERE intake_id=ANY($1::uuid[])', [[originalId, cycleId]]))[0].count).toBe(36);
    } finally {
      fetch.mockRestore();
      if (target) await refresh.configure({ ...configuration, expectedRevision: target.configurationRevision,
        expiresAt: new Date(Date.now() + 60_000).toISOString(), paused: true });
    }
  }, 14 * 60_000);

  it('preserves immutable task capture and cycle history across replay scope CAS and current source fences', async () => {
    expect(originalId).toBeTruthy(); expect(cycleId).toBeTruthy();
    const cycleHistory = await history(cycleId);
    await expect(intake.completeExactPeriod(...replay)).rejects.toThrow();
    const [configuration] = await connection.database.query(`SELECT target.configuration_revision,configuration.expires_at
      FROM public_data_refresh_targets target JOIN public_data_refresh_configurations configuration
      ON configuration.target_id=target.id AND configuration.revision=target.configuration_revision WHERE target.id=$1`, [targetId]);
    const revision = Number(configuration.configuration_revision);
    const expiry = configuration.expires_at instanceof Date ? configuration.expires_at.getTime() : Date.parse(String(configuration.expires_at));
    const base = { id: targetId, expectedRevision: revision, identityRequestId: originalId, seasons: [2026], cadenceSeconds: 60,
      expiresAt: new Date(expiry + 60_000).toISOString(), paused: true };
    const configurationHistory = await connection.database.query('SELECT * FROM public_data_refresh_configurations WHERE target_id=$1 ORDER BY revision', [targetId]);
    for (const invalid of [
      { ...base, periodInventory: null }, { ...base, periodInventory: 'unknown' },
      { ...base, periodInventory: PUBLIC_PERIOD_INVENTORY, exactPeriods: [] },
      { ...base, periodInventory: PUBLIC_PERIOD_INVENTORY, seasons: [2025] },
      { ...base, periodInventory: PUBLIC_PERIOD_INVENTORY, seasons: [2026, 2027] },
    ]) await expect(connection.database.query('SELECT public.configure_public_data_refresh($1::jsonb)', [JSON.stringify(invalid)]))
      .rejects.toThrow(/period inventory/);
    await expect(refresh.configure({ ...base, exactPeriods: [{ season: 2026, nativeWeek: 1 }] })).rejects.toThrow(/unfinished refresh cycle/);
    await expect(refresh.configure({ ...base, expectedRevision: revision - 1, periodInventory: PUBLIC_PERIOD_INVENTORY })).rejects.toThrow(/revision changed/);
    expect(await connection.database.query('SELECT * FROM public_data_refresh_configurations WHERE target_id=$1 ORDER BY revision', [targetId])).toEqual(configurationHistory);
    for (const table of [...inventoryTables, 'public_data_exact_period_checkpoints', 'public_data_exact_period_tasks']) {
      await expect(ownerQuery(`DELETE FROM public.${table} WHERE intake_id=$1`, [originalId])).rejects.toThrow(/immutable|history/);
    }
    await expect(ownerQuery('UPDATE public.public_data_intakes SET period_inventory=NULL WHERE id=$1', [originalId])).rejects.toThrow();
    await expect(ownerQuery("UPDATE public.public_data_league_candidates SET bootstrap_payload='{}' WHERE intake_id=$1", [originalId])).rejects.toThrow(/immutable/);
    await expect(ownerQuery(`INSERT INTO public.public_data_exact_period_tasks(intake_id,ordinal,season,external_league_id,native_week)
      SELECT intake_id,ordinal,season,external_league_id,native_week FROM public.public_data_exact_period_tasks WHERE intake_id=$1 AND ordinal=1`, [originalId])).rejects.toThrow();
    await expect(ownerQuery(`INSERT INTO public.public_data_exact_period_tasks(intake_id,ordinal,season,external_league_id,native_week)
      VALUES($1,361,2026,'999',1)`, [originalId])).rejects.toThrow();
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'CP8 current mapping qualification fence')",
      [mapping.leagueSeasonId, mapping.revisionId, 'cp8-remap-' + randomUUID()]);
    await readOnly(async (database, store) => {
      for (const id of [originalId, cycleId]) {
        const read = await readPublicSleeperIntake(database, store, id);
        if (read.status === 'missing') throw new Error('Missing remapped CP8 inventory.');
        expect(read.exactPeriods?.slice(0, 2).map(period => period.resource.status)).toEqual(['unavailable', 'unavailable']);
        expect(read.periodInventory?.summary).toMatchObject({ completePeriods: 2, pendingPeriods: 16 });
      }
    });
    expect(await history(originalId)).toEqual(retained); expect(await history(cycleId)).toEqual(cycleHistory);
  }, 60_000);

  it('denies direct inventory mutations and private helpers and preserves restricted grants through reprovisioning', async () => {
    const saved = await history(capacityId);
    for (const table of inventoryTables) {
      await expect(connection.database.query(`DELETE FROM public.${table} WHERE intake_id=$1`, [capacityId])).rejects.toThrow(/permission denied/);
      expect(await ownerQuery(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS write,
        has_table_privilege('league_one_auth',$1,'SELECT,INSERT,UPDATE,DELETE') AS auth`, ['public.' + table]))
        .toEqual([{ read: true, write: false, auth: false }]);
    }
    const helpers = ['public.public_data_inventory_periods()', 'public.canonical_public_data_period_scope(jsonb,integer[],text)',
      'public.public_data_inventory_native_fields(jsonb)', 'public.bind_public_data_inventory_task()',
      'public.validate_public_data_inventory_plan()', 'public.validate_public_data_inventory_source()',
      'public.validate_public_data_inventory_population()', 'public.preserve_public_data_inventory_bootstrap()',
      'public.checkpoint_public_data_intake_v43(jsonb,jsonb,jsonb)'];
    for (const signature of helpers) expect(await ownerQuery(`SELECT has_function_privilege('league_one_runtime',$1,'EXECUTE') AS runtime,
      has_function_privilege('league_one_auth',$1,'EXECUTE') AS auth`, [signature])).toEqual([{ runtime: false, auth: false }]);
    await expect(connection.database.query('SELECT public.public_data_inventory_periods()')).rejects.toThrow(/permission denied/);
    await expect(connection.database.query('SELECT public.checkpoint_public_data_intake_v43(NULL,NULL,NULL)')).rejects.toThrow(/permission denied/);
    const owner = await createPinnedIntegrationDatabase('owner');
    try {
      await owner.database.query('BEGIN');
      await owner.database.query(await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'));
      expect(await owner.database.query(`SELECT has_table_privilege('league_one_runtime','public.public_data_period_inventory_sources','SELECT') AS read,
        has_table_privilege('league_one_runtime','public.public_data_period_inventory_sources','INSERT,UPDATE,DELETE') AS write,
        has_function_privilege('league_one_runtime','public.checkpoint_public_data_intake_v43(jsonb,jsonb,jsonb)','EXECUTE') AS delegated`))
        .toEqual([{ read: true, write: false, delegated: false }]);
    } finally { await owner.database.query('ROLLBACK'); await owner.close(); }
    expect(await history(capacityId)).toEqual(saved);
  }, 60_000);
});
