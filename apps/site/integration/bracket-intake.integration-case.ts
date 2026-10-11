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
import { PUBLIC_INTAKE_JOB, PUBLIC_PERIOD_INVENTORY, PUBLIC_PLAYOFF_BRACKETS, type PublicIntakeStore } from '../lib/league-administration/public-intake-contracts';
import type { PublicDataRefreshOutcome } from '../lib/league-administration/public-refresh-contracts';
import { createProjectionStore } from '../lib/projection-store';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

const numericId = () => '8' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const bracketTables = ['public_data_bracket_tasks', 'public_data_bracket_checkpoints'] as const;
const leagueDocument = (id: string) => ({ league_id: id, season: '2026', sport: 'nfl', name: 'CP12 synthetic DATA league',
  total_rosters: 2, roster_positions: ['QB', 'BN'], scoring_settings: { rec: 0.5 },
  settings: { playoff_week_start: 15, playoff_teams: 2 } });
const winners = (corrected: boolean) => [{ m: 1, r: 1, t1: 1, t2: 2, w: corrected ? 2 : 1, l: corrected ? 1 : 2 },
  { m: 2, r: 2, t1: { w: 1 }, t2: null }];

/** AUTHORED / UNEXECUTED CP12 SQL qualification. Synthetic HTTP uses the ordinary
 * transport, witness, paired reservation, writer, checkpoint and stored readers.
 * Three 60s, one 180s and one 1080s case plus two existing 120s hooks total 28min:
 * an unmeasured allowance, not proof of elapsed fit. Original 20s worker, 60s
 * admission and 30/40/50min work/lifecycle/CI limits are unchanged. This profile
 * covers recovered terminal success, not five-failure exhaustion, maximum league
 * capacity, combined period acquisition, live provider data or bracket finality. */
describe.sequential('ordinary paired playoff bracket intake through restricted PostgreSQL', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationStore>;
  let intake: PublicIntakeStore;
  let refresh: ReturnType<typeof createPublicDataRefreshStore>;
  let originalId: string, cycleId: string, targetId: string;
  let mapping: AdministrationSourceMapping;
  let retained: Awaited<ReturnType<typeof history>>;
  let replay: Parameters<NonNullable<PublicIntakeStore['completeBrackets']>>;
  beforeAll(async () => {
    connection = createIndependentDatabase(); administration = createLeagueAdministrationStore(connection.database);
    intake = createPublicIntakeStore(connection.database); refresh = createPublicDataRefreshStore(connection.database);
    expect((await connection.database.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb
      FROM pg_roles WHERE rolname=current_user`))[0]).toEqual({ current_user: 'league_one_runtime',
      session_user: 'league_one_runtime', rolsuper: false, rolcreaterole: false, rolcreatedb: false });
    expect(intake.completeBrackets).toBeTypeOf('function');
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
        if (Date.now() >= until) throw new Error('CP12 shared minute cleanup did not settle.');
        await delay(250);
      }
    } finally { await connection.close(); }
  });
  const dependencies = (): PublicIntakeDependencies => ({ intake, administration, jobs: createProjectionStore(connection.database) });
  async function progress(id: string, resource: string, status = 'progress', override = dependencies(), recurring = false, observe?: (outcome: PublicDataRefreshOutcome) => void) {
    const until = Date.now() + 150_000;
    do {
      const outcome = recurring ? await runPublicDataRefreshStep({ ...override, refresh }, AbortSignal.timeout(20_000))
        : await runPublicIntakeStep(id, override, AbortSignal.timeout(20_000));
      observe?.(outcome);
      if (['busy', 'backoff', 'idle'].includes(outcome.status)) { await delay(1_000); continue; }
      expect(outcome).toMatchObject({ status, resource, providerRequests: ['core', 'playoff-brackets'].includes(resource) ? 2 : 1 }); return;
    } while (Date.now() < until);
    throw new Error('CP12 stage did not complete within its existing admission allowance.');
  }
  const submit = (id: string, username: string) => intake.submit({ id, username, seasons: [2026], playoffBrackets: PUBLIC_PLAYOFF_BRACKETS });
  async function history(id: string) {
    return connection.database.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY ordinal) FROM public_data_bracket_tasks t WHERE intake_id=$1) AS tasks,
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY task_ordinal) FROM public_data_bracket_checkpoints c WHERE intake_id=$1) AS checkpoints`, [id]);
  }
  async function checkpointState(id: string) {
    return connection.database.query(`SELECT
      (SELECT to_jsonb(request) FROM public_data_intakes request WHERE id=$1) AS request,
      (SELECT jsonb_agg(to_jsonb(task) ORDER BY ordinal) FROM public_data_bracket_tasks task WHERE intake_id=$1) AS tasks,
      (SELECT jsonb_agg(to_jsonb(outcome) ORDER BY outcome.worker_id,outcome.generation)
        FROM public_data_dispatch_outcomes outcome JOIN public_data_dispatches dispatch USING(worker_id,generation)
        WHERE dispatch.intake_id=$1) AS outcomes`, [id]);
  }
  const checkpoints = (id: string) => connection.database.query('SELECT * FROM public_data_bracket_checkpoints WHERE intake_id=$1 ORDER BY task_ordinal', [id]);
  async function readOnly<T>(body: (database: DatabaseClient, store: ReturnType<typeof createLeagueAdministrationStore>) => Promise<T>) {
    const queries: string[] = [];
    const database: DatabaseClient = { enabled: true,
      query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        queries.push(sql); expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu);
        return connection.database.query<Row>(sql, parameters, options);
      } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP12 stored reads must not acquire source.'));
    try { const result = await body(database, createLeagueAdministrationStore(database));
      expect(fetch).not.toHaveBeenCalled(); expect(queries.length).toBeGreaterThan(0); return result;
    } finally { fetch.mockRestore(); }
  }
  async function bracket(family: 'winners_bracket' | 'losers_bracket', receipt?: string,
    store = administration) {
    const value = await store.readAcceptedBracket!(mapping, { family, ...(receipt ? { bracketReceiptId: receipt } : {}) });
    expect(value.status).toBe('available');
    if (value.status !== 'available') throw new Error('CP12 accepted bracket unavailable.');
    return value;
  }

  it('validates selected bracket scope and preserves unselected request compatibility before admission', async () => {
    const runtime = await createPinnedIntegrationDatabase('runtime'); let open = false;
    try {
      await runtime.database.query('BEGIN'); open = true;
      const id = randomUUID(), base = { id, username: 'cp12_sql_scope', seasons: [2026] };
      const sqlSubmit = (input: unknown) => runtime.database.query('SELECT public.submit_public_data_intake($1::jsonb)', [JSON.stringify(input)]);
      for (const input of [
        { ...base, playoffBrackets: null }, { ...base, playoffBrackets: 'unknown' },
        { ...base, playoffBrackets: PUBLIC_PLAYOFF_BRACKETS, seasons: [2025] },
        { ...base, playoffBrackets: PUBLIC_PLAYOFF_BRACKETS, seasons: [2026, 2027] },
        { ...base, playoffBrackets: PUBLIC_PLAYOFF_BRACKETS, periodInventory: PUBLIC_PERIOD_INVENTORY, exactPeriods: [] },
      ]) {
        await runtime.database.query('SAVEPOINT invalid_scope');
        try { await expect(sqlSubmit(input)).rejects.toThrow(); }
        finally { await runtime.database.query('ROLLBACK TO SAVEPOINT invalid_scope'); }
        expect(await runtime.database.query('SELECT id FROM public_data_intakes WHERE id=$1', [id])).toEqual([]);
      }
      await sqlSubmit(base); await sqlSubmit({ ...base, exactPeriods: [] });
      expect(await runtime.database.query('SELECT playoff_brackets,exact_periods FROM public_data_intakes WHERE id=$1', [id]))
        .toEqual([{ playoff_brackets: null, exact_periods: [] }]);
      const legacy = await readPublicSleeperIntake(runtime.database, createLeagueAdministrationStore(runtime.database), id);
      expect(Object.hasOwn(legacy, 'brackets')).toBe(false);
      const selected = { ...base, id: randomUUID(), playoffBrackets: PUBLIC_PLAYOFF_BRACKETS };
      await sqlSubmit(selected); await sqlSubmit(selected);
      const exact = { ...selected, id: randomUUID(), exactPeriods: [{ season: 2026, nativeWeek: 18 }] };
      const inventory = { ...selected, id: randomUUID(), periodInventory: PUBLIC_PERIOD_INVENTORY };
      await sqlSubmit(exact); await sqlSubmit(inventory);
      expect(await runtime.database.query('SELECT playoff_brackets FROM public_data_intakes WHERE id=ANY($1::uuid[])', [[selected.id, exact.id, inventory.id]]))
        .toEqual(Array.from({ length: 3 }, () => ({ playoff_brackets: PUBLIC_PLAYOFF_BRACKETS })));
      for (const input of [{ ...base, playoffBrackets: PUBLIC_PLAYOFF_BRACKETS }, { ...selected, playoffBrackets: undefined }]) {
        await runtime.database.query('SAVEPOINT mismatched_replay');
        try { await expect(sqlSubmit(input)).rejects.toThrow(/replay mismatch/); }
        finally { await runtime.database.query('ROLLBACK TO SAVEPOINT mismatched_replay'); }
      }
      expect(await runtime.database.query('SELECT * FROM public_data_dispatches WHERE intake_id=ANY($1::uuid[])', [[id, selected.id, exact.id, inventory.id]])).toEqual([]);
      expect(await runtime.database.query('SELECT * FROM public_data_bracket_tasks WHERE intake_id=ANY($1::uuid[])', [[id, selected.id, exact.id, inventory.id]])).toEqual([]);
    } finally { if (open) await runtime.database.query('ROLLBACK'); await runtime.close(); }
  }, 60_000);

  it('completes ordinary empty discovery without inventing bracket tasks or source availability', async () => {
    const id = randomUUID(), manager = numericId(), username = 'cp12_empty_' + manager, urls: string[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      if (url === 'https://api.sleeper.app/v1/user/' + username) return new Response(JSON.stringify({ user_id: manager, username }));
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return new Response('[]');
      throw new Error('Unexpected CP12 empty discovery request.');
    });
    try {
      await submit(id, username); await progress(id, 'identity'); await progress(id, 'leagues');
      expect(await intake.next(id)).toBe('complete'); expect(urls).toHaveLength(2); fetch.mockRestore();
      await readOnly(async (database, store) => {
        expect(await readPublicSleeperIntake(database, store, id)).toMatchObject({ status: 'available', request: { terminal: true }, leagues: [], brackets: [] });
      });
      expect(await history(id)).toEqual([{ tasks: null, checkpoints: null }]);
      expect((await connection.database.query('SELECT count(*)::integer AS count FROM public_data_dispatches WHERE intake_id=$1', [id]))[0].count).toBe(2);
    } finally { fetch.mockRestore(); }
  }, 180_000);

  it('composes ordinary paired bracket recovery and changed refresh through witnessed immutable receipts', async () => {
    originalId = randomUUID(); const manager = numericId(), external = numericId(), username = 'cp12_brackets_' + manager;
    const league = leagueDocument(external), urls: string[] = [];
    let correction = false, failLosers = false, admissions = 0, claims = 0, observedClaims = 0;
    const zeroRequestClaims: PublicDataRefreshOutcome[] = [];
    const observe = (outcome: PublicDataRefreshOutcome) => {
      const acquired = claims - observedClaims; expect(acquired).toBeLessThanOrEqual(1);
      if (acquired && outcome.providerRequests === 0) zeroRequestClaims.push(outcome);
      observedClaims = claims;
    };
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      if (url === 'https://api.sleeper.app/v1/user/' + username || url === 'https://api.sleeper.app/v1/user/' + manager)
        return new Response(JSON.stringify({ user_id: manager, username }));
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return new Response(JSON.stringify([league]));
      if (url === 'https://api.sleeper.app/v1/league/' + external) return new Response(JSON.stringify(league));
      if (url === 'https://api.sleeper.app/v1/league/' + external + '/winners_bracket') return new Response(JSON.stringify(winners(correction)));
      if (url === 'https://api.sleeper.app/v1/league/' + external + '/losers_bracket')
        return failLosers ? new Response('{}', { status: 503 }) : new Response(correction ? '[]' : 'null');
      if (url === 'https://api.sleeper.app/v1/league/' + external + '/rosters') return new Response(JSON.stringify([1, 2].map(roster_id => ({ roster_id,
        owner_id: roster_id === 1 ? manager : null, co_owners: [], players: [], starters: [], reserve: [], taxi: [] }))));
      if (url === 'https://api.sleeper.app/v1/league/' + external + '/users') return new Response(JSON.stringify([{ user_id: manager, display_name: username }]));
      throw new Error('Unexpected CP12 synthetic acquisition: ' + url);
    });
    const jobs = createProjectionStore(connection.database);
    const ordinary: PublicIntakeDependencies = { intake: { ...intake, admit: async (...args) => {
      const admitted = await intake.admit(...args); if (admitted) admissions++; return admitted;
    } }, administration, jobs: { ...jobs, acquireJob: async (...args) => {
      const claim = await jobs.acquireJob(...args); if (claim.kind === 'acquired') claims++; return claim;
    } } };
    let target: { targetId: string; configurationRevision: number } | undefined;
    const configuration = { id: randomUUID(), expectedRevision: 0, identityRequestId: originalId, seasons: [2026],
      playoffBrackets: PUBLIC_PLAYOFF_BRACKETS, cadenceSeconds: 60, expiresAt: new Date(Date.now() + 25 * 60_000).toISOString(), paused: false };
    try {
      await submit(originalId, username);
      for (const resource of ['identity', 'leagues', 'bootstrap']) await progress(originalId, resource, 'progress', ordinary, false, observe);
      const source = await administration.readSourceMapping(external); if (!source) throw new Error('Missing CP12 mapping.'); mapping = source;
      expect(await intake.next(originalId)).toMatchObject({ kind: 'playoff-brackets', externalLeagueId: external, season: 2026 });
      let interrupted: Parameters<NonNullable<PublicIntakeStore['completeBrackets']>> | undefined, lateRollbackProved = false;
      await progress(originalId, 'playoff-brackets', 'unavailable', { ...ordinary, intake: { ...ordinary.intake,
        completeBrackets: async (...args) => {
          interrupted = args; const [work, , , fence] = args;
          const before = await checkpointState(originalId), writer = await createPinnedIntegrationDatabase('runtime'); let open = false;
          try {
            expect((await writer.database.query('SELECT current_user,session_user'))[0])
              .toEqual({ current_user: 'league_one_runtime', session_user: 'league_one_runtime' });
            await writer.database.query('BEGIN'); open = true;
            await createPublicIntakeStore(writer.database).fail(work, fence);
            expect((await writer.database.query('SELECT clock_timestamp()<$1::timestamptz AS live', [fence.deadlineAt]))[0].live).toBe(true);
            // This pinned connection has no AbortSignal. The genuine failure returns
            // while live; only COMMIT may reject after the unchanged original deadline.
            await writer.database.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.05)', [fence.deadlineAt]);
            let rejected: unknown;
            try { await writer.database.query('COMMIT'); } catch (error) { rejected = error; }
            expect(rejected).toMatchObject({ code: 'P0001' });
            expect(String((rejected as { message?: string }).message)).toMatch(/roster player link writer fence expired/);
            expect(String((rejected as { where?: string }).where)).toContain('validate_public_data_bracket_task_fence');
            await writer.database.query('ROLLBACK'); open = false;
            expect(await checkpointState(originalId)).toEqual(before);
            expect(await checkpoints(originalId)).toEqual([]); lateRollbackProved = true;
          } finally { if (open) await writer.database.query('ROLLBACK'); await writer.close(); }
          // The coordinator awaits and drains this callback. Its expired cleanup
          // cannot mutate the task; the next ordinary owner must recover the dispatch.
          throw new Error('CP12 deferred task failure rolled back; original dispatch needs fresh-owner recovery.');
        } } }, false, observe);
      expect(lateRollbackProved).toBe(true); expect(interrupted).toBeDefined(); expect(await checkpoints(originalId)).toEqual([]);
      const firstWinner = await bracket('winners_bracket'), firstLoser = await bracket('losers_bracket');
      expect(firstLoser.value).toMatchObject({ publication: 'unpublished', matches: [] });
      expect(await readPublicSleeperIntake(connection.database, administration, originalId)).toMatchObject({ status: 'pending',
        brackets: [{ collection: 'pending', resource: { status: 'unavailable' }, acquisition: null }] });
      failLosers = true; await progress(originalId, 'playoff-brackets', 'unavailable', ordinary, false, observe);
      expect(await checkpoints(originalId)).toEqual([]);
      const interruptedFence = interrupted![3];
      expect(await connection.database.query('SELECT outcome FROM public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2',
        [interruptedFence.workerId, interruptedFence.generation])).toEqual([{ outcome: 'recovered' }]);
      const partialWinner = await bracket('winners_bracket');
      expect(partialWinner.bracketReceiptId).not.toBe(firstWinner.bracketReceiptId); expect(partialWinner.value).toEqual(firstWinner.value);
      expect(await bracket('losers_bracket')).toEqual(firstLoser);
      const [partialWinnerReceipt] = await connection.database.query(
        'SELECT legacy_observation_id FROM league_roster_capture_receipts WHERE id=$1', [partialWinner.bracketReceiptId]);
      expect(partialWinnerReceipt.legacy_observation_id).toBeTypeOf('string');
      expect(await connection.database.query('SELECT status,failure_count FROM public_data_bracket_tasks WHERE intake_id=$1', [originalId]))
        .toEqual([{ status: 'pending', failure_count: 2 }]);
      failLosers = false; let lostAcknowledgment = false;
      await progress(originalId, 'playoff-brackets', 'unavailable', { ...ordinary, intake: { ...ordinary.intake,
        completeBrackets: async (work, selected, checkpoint, fence) => {
          await expect(intake.completeBrackets!({ ...work, externalLeagueId: numericId() }, selected, checkpoint, fence)).rejects.toThrow();
          await expect(intake.completeBrackets!(work, { ...selected, revisionId: randomUUID() }, checkpoint, fence)).rejects.toThrow();
          // A coherent earlier receipt/observation pair still belongs to another dispatch fence.
          await expect(intake.completeBrackets!(work, selected, { ...checkpoint,
            observations: { ...checkpoint.observations, winners_bracket: String(partialWinnerReceipt.legacy_observation_id) },
            receipts: { ...checkpoint.receipts, winners_bracket: partialWinner.bracketReceiptId } }, fence))
            .rejects.toThrow(/public bracket observation mismatch/);
          await expect(intake.completeBrackets!(work, selected, { ...checkpoint, receipts: { winners_bracket: checkpoint.receipts.losers_bracket,
            losers_bracket: checkpoint.receipts.winners_bracket } }, fence)).rejects.toThrow();
          await intake.completeBrackets!(work, selected, checkpoint, fence); replay = [work, selected, checkpoint, fence];
          lostAcknowledgment = true; throw new Error('CP12 genuine paired checkpoint committed; acknowledgment lost.');
        } } }, false, observe);
      expect(lostAcknowledgment).toBe(true); expect(await checkpoints(originalId)).toHaveLength(1);
      expect(await intake.next(originalId)).toMatchObject({ kind: 'core' });
      expect(await connection.database.query('SELECT status,failure_count FROM public_data_bracket_tasks WHERE intake_id=$1', [originalId]))
        .toEqual([{ status: 'complete', failure_count: 2 }]);
      for (const resource of ['core', 'users']) await progress(originalId, resource, 'progress', ordinary, false, observe);
      expect(await intake.next(originalId)).toBe('complete'); retained = await history(originalId);
      const originalCheckpoints = await checkpoints(originalId), checkpoint = originalCheckpoints[0];
      const originalWinners = await bracket('winners_bracket', String(checkpoint.winners_bracket_receipt_id));
      const originalLosers = await bracket('losers_bracket', String(checkpoint.losers_bracket_receipt_id));
      target = await refresh.configure(configuration); targetId = target.targetId;
      expect(await refresh.configure(configuration)).toMatchObject({ status: 'replayed', targetId }); correction = true;
      for (const resource of ['identity', 'leagues', 'bootstrap', 'playoff-brackets', 'core', 'users'])
        await progress(originalId, resource, 'progress', ordinary, true, observe);
      const base = 'https://api.sleeper.app/v1/league/' + external;
      const pair = [base + '/winners_bracket', base + '/losers_bracket'];
      expect(urls).toEqual(['https://api.sleeper.app/v1/user/' + username, 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026',
        base, ...pair, ...pair, ...pair, base, base + '/rosters', base + '/users',
        'https://api.sleeper.app/v1/user/' + manager, 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026',
        base, ...pair, base, base + '/rosters', base + '/users']);
      expect(admissions).toBe(14); expect(claims).toBe(admissions + zeroRequestClaims.length);
      expect(zeroRequestClaims.some(outcome => outcome.status === 'backoff')).toBe(true);
      const claimsBeforeSettlement = claims;
      const settleUntil = Date.now() + 150_000;
      while (true) {
        const outcome = await runPublicDataRefreshStep({ ...ordinary, refresh }, AbortSignal.timeout(20_000));
        observe(outcome);
        if (outcome.status === 'busy') { if (Date.now() >= settleUntil) throw new Error('CP12 terminal settlement exceeded admission allowance.'); await delay(1_000); continue; }
        expect(outcome.providerRequests).toBe(0); break;
      }
      expect(admissions).toBe(14); expect(claims).toBe(claimsBeforeSettlement + 1); expect(claims).toBe(admissions + zeroRequestClaims.length); expect(urls).toHaveLength(20); fetch.mockRestore();
      await readOnly(async (database, store) => {
        const current = await readPublicDataRefresh(database, store, targetId);
        expect(current).toMatchObject({ status: 'available', target: { playoffBrackets: PUBLIC_PLAYOFF_BRACKETS },
          cycle: { playoffBrackets: PUBLIC_PLAYOFF_BRACKETS, outcome: { disposition: 'complete' } },
          intake: { status: 'available', brackets: [{ collection: 'complete', resource: { status: 'available' } }] } });
        if (current.status !== 'available' || !current.cycle || !current.intake || current.intake.status === 'missing') throw new Error('Missing CP12 complete cycle.');
        cycleId = current.cycle.requestId;
        const latest = await bracket('winners_bracket', undefined, store);
        expect(latest.contentId).not.toBe(originalWinners.contentId);
        expect(latest.value.matches[0].winner).toMatchObject({ state: 'supplied', value: '2' });
        const old = await readPublicSleeperIntake(database, store, originalId);
        expect(old).toMatchObject({ brackets: [{ resource: { status: 'available', winners_bracket: originalWinners, losers_bracket: originalLosers } }] });
        expect(await bracket('winners_bracket', originalWinners.bracketReceiptId, store)).toEqual(originalWinners);
        expect(await bracket('losers_bracket', originalLosers.bracketReceiptId, store)).toEqual(originalLosers);
        expect(await bracket('losers_bracket', undefined, store)).toMatchObject({ value: { publication: 'published', matches: [] } });
      });
      expect(cycleId).not.toBe(originalId); expect(await intake.next(cycleId)).toBe('complete');
      expect(await history(originalId)).toEqual(retained); expect(await checkpoints(cycleId)).toHaveLength(1);
      const witnessed = await connection.database.query(`SELECT checkpoint.intake_id,
        dispatch.work->>'kind'='playoff-brackets' AND NOT(dispatch.work ? 'nativeWeek') AND (dispatch.work->>'season')::integer=task.season AS same_work,
        checkpoint.source_mapping=attempt.source_mapping AS same_mapping,
        receipt.provenance->'acquisition'->>'dispatchNonce'=dispatch.capture_nonce::text
          AND receipt.provenance->'acquisition'->'work'=dispatch.work
          AND receipt.provenance->'acquisition'->'fence'=attempt.write_fence AS witnessed,
        attempt.reserved_at>=dispatch.admitted_at AND receipt.recorded_at>=attempt.reserved_at AS database_order
        FROM public_data_bracket_checkpoints checkpoint
        JOIN public_data_bracket_tasks task ON task.intake_id=checkpoint.intake_id AND task.ordinal=checkpoint.task_ordinal
        JOIN public_data_dispatches dispatch ON dispatch.worker_id=checkpoint.worker_id AND dispatch.generation=checkpoint.generation
        JOIN league_roster_capture_receipts receipt ON receipt.id IN(checkpoint.winners_bracket_receipt_id,checkpoint.losers_bracket_receipt_id)
        JOIN league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
        WHERE checkpoint.intake_id=ANY($1::uuid[])`, [[originalId, cycleId]]);
      expect(witnessed).toHaveLength(4);
      for (const row of witnessed) expect(row).toMatchObject({ same_work: true, same_mapping: true, witnessed: true, database_order: true });
      const [spacing] = await connection.database.query(`SELECT count(*)::integer AS count,
        bool_and(history.previous IS NULL OR history.admitted_at-history.previous>=interval '60 seconds') AS spaced
        FROM(SELECT dispatch.admitted_at,lag(dispatch.admitted_at) OVER(ORDER BY dispatch.admitted_at) AS previous
          FROM public_data_dispatches dispatch WHERE dispatch.intake_id=ANY($1::uuid[])) history`, [[originalId, cycleId]]);
      expect(spacing).toEqual({ count: 14, spaced: true });
    } finally {
      fetch.mockRestore();
      if (target) await refresh.configure({ ...configuration, expectedRevision: target.configurationRevision,
        expiresAt: new Date(Date.now() + 60_000).toISOString(), paused: true });
    }
  }, 18 * 60_000);

  it('preserves checkpoint and cycle scope history across replay configuration changes and source remapping', async () => {
    expect(originalId).toBeTruthy(); expect(cycleId).toBeTruthy();
    const cycleHistory = await history(cycleId);
    await expect(intake.completeBrackets!(...replay)).rejects.toThrow();
    const [configuration] = await connection.database.query(`SELECT target.configuration_revision,configuration.expires_at
      FROM public_data_refresh_targets target JOIN public_data_refresh_configurations configuration
      ON configuration.target_id=target.id AND configuration.revision=target.configuration_revision WHERE target.id=$1`, [targetId]);
    const revision = Number(configuration.configuration_revision);
    const expiry = configuration.expires_at instanceof Date ? configuration.expires_at.getTime() : Date.parse(String(configuration.expires_at));
    const base = { id: targetId, expectedRevision: revision, identityRequestId: originalId, seasons: [2026], cadenceSeconds: 60,
      expiresAt: new Date(expiry + 60_000).toISOString(), paused: true };
    const configurations = await connection.database.query('SELECT * FROM public_data_refresh_configurations WHERE target_id=$1 ORDER BY revision', [targetId]);
    for (const invalid of [
      { ...base, playoffBrackets: null }, { ...base, playoffBrackets: 'unknown' },
      { ...base, playoffBrackets: PUBLIC_PLAYOFF_BRACKETS, seasons: [2025] },
      { ...base, playoffBrackets: PUBLIC_PLAYOFF_BRACKETS, seasons: [2026, 2027] },
    ]) await expect(connection.database.query('SELECT public.configure_public_data_refresh($1::jsonb)', [JSON.stringify(invalid)])).rejects.toThrow();
    await expect(refresh.configure({ ...base, expectedRevision: revision - 1, playoffBrackets: PUBLIC_PLAYOFF_BRACKETS })).rejects.toThrow(/revision changed/);
    expect(await connection.database.query('SELECT * FROM public_data_refresh_configurations WHERE target_id=$1 ORDER BY revision', [targetId])).toEqual(configurations);
    const changed = await refresh.configure(base); expect(changed.configurationRevision).toBe(revision + 1);
    expect((await connection.database.query(`SELECT config.playoff_brackets,request.playoff_brackets AS request_selector FROM public_data_refresh_cycles cycle
      JOIN public_data_refresh_configurations config ON config.target_id=cycle.target_id AND config.revision=cycle.configuration_revision
      JOIN public_data_intakes request ON request.id=cycle.intake_id WHERE cycle.target_id=$1`, [targetId]))[0]).toEqual({ playoff_brackets: PUBLIC_PLAYOFF_BRACKETS, request_selector: PUBLIC_PLAYOFF_BRACKETS });
    for (const table of bracketTables) {
      await expect(ownerQuery(`DELETE FROM public.${table} WHERE intake_id=$1`, [originalId])).rejects.toThrow(/immutable|history/);
    }
    await expect(ownerQuery('UPDATE public.public_data_intakes SET playoff_brackets=NULL WHERE id=$1', [originalId])).rejects.toThrow();
    await expect(ownerQuery(`INSERT INTO public.public_data_bracket_tasks(intake_id,ordinal,season,external_league_id)
      SELECT intake_id,ordinal,season,external_league_id FROM public.public_data_bracket_tasks WHERE intake_id=$1 AND ordinal=1`, [originalId])).rejects.toThrow();
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'CP12 current mapping qualification fence')",
      [mapping.leagueSeasonId, mapping.revisionId, 'cp12-remap-' + randomUUID()]);
    await readOnly(async (database, store) => {
      for (const id of [originalId, cycleId]) {
        const read = await readPublicSleeperIntake(database, store, id);
        expect(read).toMatchObject({ brackets: [{ collection: 'complete', resource: { status: 'unavailable' } }] });
      }
    });
    expect(await history(originalId)).toEqual(retained); expect(await history(cycleId)).toEqual(cycleHistory);
  }, 60_000);

  it('denies direct bracket task mutations and private helpers through restricted roles', async () => {
    const saved = await history(originalId);
    for (const table of bracketTables) {
      await expect(connection.database.query(`DELETE FROM public.${table} WHERE intake_id=$1`, [originalId])).rejects.toThrow(/permission denied/);
      expect(await ownerQuery(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS write,
        has_table_privilege('league_one_auth',$1,'SELECT,INSERT,UPDATE,DELETE') AS auth`, ['public.' + table]))
        .toEqual([{ read: true, write: false, auth: false }]);
    }
    const helpers = ['public.validate_public_data_bracket_task()', 'public.validate_public_data_bracket_checkpoint()',
      'public.validate_public_data_bracket_checkpoint_fence()', 'public.validate_public_data_bracket_task_fence()',
      'public.fail_public_data_bracket_work(jsonb,jsonb)', 'public.checkpoint_public_data_intake_v46(jsonb,jsonb,jsonb)'];
    for (const signature of helpers) expect(await ownerQuery(`SELECT has_function_privilege('league_one_runtime',$1,'EXECUTE') AS runtime,
      has_function_privilege('league_one_auth',$1,'EXECUTE') AS auth`, [signature])).toEqual([{ runtime: false, auth: false }]);
    await expect(connection.database.query('SELECT public.fail_public_data_bracket_work(NULL,NULL)')).rejects.toThrow(/permission denied/);
    await expect(connection.database.query('SELECT public.checkpoint_public_data_intake_v46(NULL,NULL,NULL)')).rejects.toThrow(/permission denied/);
    const owner = await createPinnedIntegrationDatabase('owner');
    try {
      await owner.database.query('BEGIN');
      await owner.database.query(await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'));
      for (const table of bracketTables) expect(await owner.database.query(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE') AS write`, ['public.' + table]))
        .toEqual([{ read: true, write: false }]);
      for (const signature of helpers) expect(await owner.database.query(
        "SELECT has_function_privilege('league_one_runtime',$1,'EXECUTE') AS runtime,has_function_privilege('league_one_auth',$1,'EXECUTE') AS auth", [signature]))
        .toEqual([{ runtime: false, auth: false }]);
    } finally { await owner.database.query('ROLLBACK'); await owner.close(); }
    expect(await history(originalId)).toEqual(saved);
  }, 60_000);
});
