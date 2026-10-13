import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { JsonValue } from '../lib/league-administration/contracts';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import { createLeagueAdministrationStore, createPublicIntakeStore } from '../lib/league-administration/store';
import { runPublicIntakeStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { PUBLIC_INTAKE_JOB, PUBLIC_TRANSACTION_HISTORY, type PublicIntakeWork, type PublicIntakeStore } from '../lib/league-administration/public-intake-contracts';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createProjectionStore } from '../lib/projection-store';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { exactMatchupClockInstant } from './exact-matchup-clock';

const numericId = () => '8' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const retained: JsonValue = [{ transaction_id: '90071992547409931234', type: 'waiver', status: 'complete',
  roster_ids: [1], adds: { player: 1 }, drops: {}, settings: { waiver_bid: 0 }, created: 0, status_updated: 1 }];

/** AUTHORED / SQL-UNQUALIFIED. This adverse profile does not acquire full history.
 * Ordinary identity/list/bootstrap create nineteen tasks. Under bootstrap's
 * original fence, an explicit owner fixture seeds weeks2–18 unavailable with
 * zero receipts. Existing033 directly seeds one week0 last-good acceptance.
 * Five actual malformed week0 GETs exercise unchanged60/120/240/480s backoff;
 * one suppressed cleanup acknowledgment is recovered once by the next owner.
 * Week1/core/users then acquire normally; final zero-GET settlement is partial.
 * 11 admissions,12 GETs,13 acquired claims (one recovery,one settlement), with
 * at least1,320s real spacing/backoff before settlement. Body1,530s +90s hooks
 * twice =1,710s;90s remain inside30min for guarded global work. No clock changes,
 * no process-death claim and no receipt from the17 unavailable fixture seeds. */
describe.sequential('bounded transaction history recovery through restricted PostgreSQL', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationStore>;
  beforeAll(async () => {
    connection = createIndependentDatabase(); administration = createLeagueAdministrationStore(connection.database);
    expect((await connection.database.query('SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user'))[0])
      .toEqual({ current_user: 'league_one_runtime', session_user: 'league_one_runtime', rolsuper: false, rolcreaterole: false, rolcreatedb: false });
  }, 90_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    if (!connection) return;
    try {
      const until = Date.now() + 85_000;
      while (true) {
        const [row] = await connection.database.query("SELECT NOT EXISTS(SELECT 1 FROM public_data_dispatches WHERE admitted_at>clock_timestamp()-interval '60 seconds') AND NOT EXISTS(SELECT 1 FROM projection_jobs WHERE job_key=$1 AND (state='running' OR completed_at>clock_timestamp()-interval '60 seconds')) AS ready", [PUBLIC_INTAKE_JOB]);
        if (row.ready === true) break;
        if (Date.now() >= until) throw new Error('CP15 recovery shared-minute cleanup did not settle.');
        await delay(250);
      }
    } finally { await connection.close(); }
  }, 90_000);

  it('preserves nineteen period coverage through lost acknowledgment retry exhaustion and next period recovery', async () => {
    const id = randomUUID(), manager = numericId(), external = numericId(), username = 'cp15_recovery_' + manager;
    const league = { league_id: external, season: '2026', sport: 'nfl', name: 'CP15 synthetic recovery', total_rosters: 2,
      roster_positions: ['QB', 'BN'], scoring_settings: { rec: 0.5 }, settings: {} };
    const base = 'https://api.sleeper.app/v1/league/' + external, urls: string[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      if (url === 'https://api.sleeper.app/v1/user/' + username) return new Response(JSON.stringify({ user_id: manager, username }));
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return new Response(JSON.stringify([league]));
      if (url === base) return new Response(JSON.stringify(league));
      if (url === base + '/transactions/0') return new Response(JSON.stringify([{ type: 'waiver' }]));
      if (url === base + '/transactions/1') return new Response(JSON.stringify([]));
      if (url === base + '/rosters') return new Response(JSON.stringify([1, 2].map(roster_id => ({ roster_id,
        owner_id: roster_id === 1 ? manager : null, co_owners: [], players: [], starters: [], reserve: [], taxi: [] }))));
      if (url === base + '/users') return new Response(JSON.stringify([{ user_id: manager, display_name: username }]));
      throw new Error('Unexpected CP15 recovery acquisition: ' + url);
    });
    const intake = createPublicIntakeStore(connection.database), jobs = createProjectionStore(connection.database);
    const checkpoints = () => connection.database.query('SELECT * FROM public_data_transaction_checkpoints WHERE intake_id=$1 ORDER BY task_ordinal', [id]);
    const state = () => connection.database.query('SELECT revision,failure_count,terminal FROM public_data_intakes WHERE id=$1', [id]);
    let admissions = 0, claims = 0, cleanupSuppressed = false, recoveryProved = false;
    let callbackError: unknown;
    let abandoned: { work: PublicIntakeWork; fence: AdministrationWriteFence; state: readonly DatabaseRow[] } | undefined;
    let completed: Parameters<NonNullable<PublicIntakeStore['completeTransactions']>> | undefined;
    const dependencies: PublicIntakeDependencies = { administration, jobs: { ...jobs, acquireJob: async (...args) => {
      const claim = await jobs.acquireJob(...args); if (claim.kind === 'acquired') claims++; return claim;
    } }, intake: { ...intake,
      admit: async (...args) => { const admitted = await intake.admit(...args); if (admitted) admissions++; return admitted; },
      register: async (work, capture, fence) => {
        try {
          await intake.register(work, capture, fence);
          // Explicit owner fixture: these17 periods were NOT attempted or acquired.
          // Their terminal states bound this adverse test, not production coverage.
          const seeded = await ownerQuery("UPDATE public_data_transaction_tasks SET status='unavailable',failure_count=5,reason='transaction-capture-exhausted',write_fence=$2::jsonb WHERE intake_id=$1 AND native_week BETWEEN 2 AND 18 AND status='pending' RETURNING native_week", [id, JSON.stringify(fence)]);
          expect(seeded.map(row => Number(row.native_week)).sort((a, b) => a - b)).toEqual(Array.from({ length: 17 }, (_, index) => index + 2));
          expect(await checkpoints()).toEqual([]);
        } catch (error) { callbackError = error; throw error; }
      },
      fail: async (work, fence) => {
        if (work.kind === 'transactions' && work.nativeWeek === 0 && !cleanupSuppressed) {
          abandoned = { work, fence, state: await state() }; cleanupSuppressed = true;
          throw new Error('Injected unavailable cleanup acknowledgment before checkpoint commit.');
        }
        await intake.fail(work, fence);
      },
      recover: async (requestId, fence) => {
        if (!abandoned || recoveryProved) return intake.recover(requestId, fence);
        try {
          expect(fence.workerId).not.toBe(abandoned.fence.workerId);
          expect(await state()).toEqual(abandoned.state);
          await intake.recover(requestId, fence);
          const after = await state();
          expect(after).toEqual([{ revision: Number(abandoned.state[0].revision) + 1, failure_count: 1, terminal: false }]);
          expect(await connection.database.query('SELECT outcome FROM public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2', [abandoned.fence.workerId, abandoned.fence.generation])).toEqual([{ outcome: 'recovered' }]);
          await intake.recover(requestId, fence);
          expect(await state()).toEqual(after); expect(await checkpoints()).toEqual([]);
          expect(await intake.next(id)).toBe('backoff'); recoveryProved = true;
        } catch (error) { callbackError = error; throw error; }
      },
      completeTransactions: async (...args) => {
        await intake.completeTransactions!(...args); completed = args;
      },
    } };
    async function progress(resource?: string, status = 'progress') {
      const until = Date.now() + 100_000;
      do {
        const before = { claims, admissions, requests: urls.length };
        const outcome = await runPublicIntakeStep(id, { ...dependencies,
          administration: createLeagueAdministrationStore(connection.database) }, AbortSignal.timeout(20_000));
        if (callbackError) throw callbackError;
        expect(urls.length - before.requests).toBe(outcome.providerRequests);
        if (outcome.status === 'busy') { expect(claims).toBe(before.claims); expect(admissions).toBe(before.admissions); await delay(1_000); continue; }
        expect(claims - before.claims).toBe(1);
        if (resource) {
          expect(outcome).toEqual({ status, resource, providerRequests: resource === 'core' ? 2 : 1 });
          expect(admissions - before.admissions).toBe(1);
        } else {
          expect(outcome).toEqual({ status, providerRequests: 0 }); expect(admissions).toBe(before.admissions);
        }
        return;
      } while (Date.now() < until);
      throw new Error('CP15 recovery stage exceeded unchanged cadence allowance.');
    }
    async function waitBackoff(failures: number) {
      const expected = 60 * 2 ** (failures - 1);
      expect(await intake.next(id)).toBe('backoff');
      // Original20s fence bounds the interval between computing next_attempt_at
      // and writing its immutable dispatch outcome. No DB clock is altered.
      expect(await connection.database.query("SELECT request.next_attempt_at>=outcome.recorded_at+make_interval(secs=>$2::integer-20) AND request.next_attempt_at<=outcome.recorded_at+make_interval(secs=>$2::integer) AS original_backoff FROM public_data_intakes request JOIN public_data_dispatches dispatch ON dispatch.intake_id=request.id JOIN public_data_dispatch_outcomes outcome USING(worker_id,generation) WHERE request.id=$1 AND dispatch.resource='transactions' ORDER BY outcome.recorded_at DESC LIMIT 1", [id, expected])).toEqual([{ original_backoff: true }]);
      const until = Date.now() + (expected + 20) * 1_000;
      while (true) {
        const [row] = await connection.database.query('SELECT next_attempt_at<=clock_timestamp() AS ready FROM public_data_intakes WHERE id=$1', [id]);
        if (row.ready === true) return;
        if (Date.now() >= until) throw new Error('CP15 original transaction backoff did not elapse.');
        await delay(1_000);
      }
    }
    try {
      const input = { id, username, seasons: [2026], transactionHistory: PUBLIC_TRANSACTION_HISTORY };
      await intake.submit(input);
      for (const resource of ['identity', 'leagues', 'bootstrap']) await progress(resource);
      const mapping = await administration.readSourceMapping(external); if (!mapping) throw new Error('CP15 recovery mapping unavailable.');
      const attempt = await administration.beginTransactionAttempt(mapping, 0, randomUUID());
      const [clock] = await connection.database.query('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
      const at = exactMatchupClockInstant(clock.at);
      const baselineInput = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
        dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'transactions', week: 0, completeness: 'complete', payload: retained,
        provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
      expect((await administration.recordObservation(baselineInput, undefined, mapping, undefined, undefined, undefined, undefined, undefined, undefined, { attempt })).transactionAcceptance?.status).toBe('accepted');
      const baseline = await administration.readAcceptedTransactions(mapping, 0);
      if (baseline.status !== 'available' || !baseline.capture.receipt) throw new Error('CP15 recovery direct baseline unavailable.');
      expect(baseline.capture.envelope.provenance.acquisition).toBeUndefined();
      await progress('transactions', 'unavailable');
      expect(cleanupSuppressed).toBe(true); if (!abandoned) throw new Error('CP15 abandoned dispatch missing.');
      expect(await state()).toEqual(abandoned.state);
      expect(await connection.database.query('SELECT outcome FROM public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2', [abandoned.fence.workerId, abandoned.fence.generation])).toEqual([]);
      await progress(undefined, 'backoff'); expect(recoveryProved).toBe(true);
      for (let failures = 1; failures <= 5; failures++) {
        expect(await connection.database.query('SELECT status,failure_count,reason FROM public_data_transaction_tasks WHERE intake_id=$1 AND native_week=0', [id]))
          .toEqual([{ status: failures < 5 ? 'pending' : 'unavailable', failure_count: failures, reason: failures < 5 ? null : 'transaction-capture-exhausted' }]);
        expect(await administration.readAcceptedTransactions(mapping, 0)).toEqual(baseline);
        const snapshot = await readPublicSleeperIntake(connection.database, administration, id);
        if (snapshot.status === 'missing' || !snapshot.transactions) throw new Error('CP15 recovery inventory missing.');
        expect(snapshot).toMatchObject({ transactionHistory: { summary: { requestedPeriods: 19, materializedPeriods: 19, acquiredPeriods: 0,
          pendingPeriods: failures < 5 ? 2 : 1, unavailablePeriods: failures < 5 ? 17 : 18 } } });
        expect(snapshot.transactions[0]).toMatchObject({ resource: { status: 'unavailable' }, acquisition: null,
          currentAccepted: { captureBinding: 'latest-for-current-source-mapping', resource: { status: 'available' } } });
        expect(await checkpoints()).toEqual([]);
        if (failures < 5) { await waitBackoff(failures); await progress('transactions', 'unavailable'); }
      }
      expect(await intake.next(id)).toMatchObject({ kind: 'transactions', nativeWeek: 1 });
      // Exhaustion resets request backoff, but the last failed dispatch still
      // owns the unchanged sixty-second admission spacing. Wait without making
      // an extra scheduler claim or treating a backoff claim as acquisition.
      const nextAdmission = Date.now() + 80_000;
      while (true) {
        const [row] = await connection.database.query("SELECT NOT EXISTS(SELECT 1 FROM public_data_dispatches WHERE admitted_at>clock_timestamp()-interval '60 seconds') AS ready");
        if (row.ready === true) break;
        if (Date.now() >= nextAdmission) throw new Error('CP15 exhaustion admission spacing did not elapse.');
        await delay(1_000);
      }
      await progress('transactions');
      for (const resource of ['core', 'users']) await progress(resource);
      await progress(undefined, 'partial');
      expect(claims).toBe(13); expect(admissions).toBe(11); expect(urls).toHaveLength(12);
      expect(urls).toEqual(['https://api.sleeper.app/v1/user/' + username, 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026', base,
        ...Array.from({ length: 5 }, () => base + '/transactions/0'), base + '/transactions/1', base, base + '/rosters', base + '/users']);
      expect(await connection.database.query("WITH ordered AS (SELECT admitted_at,lag(admitted_at) OVER(ORDER BY admitted_at) AS previous FROM public_data_dispatches WHERE intake_id=$1) SELECT count(*)::integer AS admissions,bool_and(previous IS NULL OR admitted_at-previous>=interval '60 seconds') AS real_spacing FROM ordered", [id]))
        .toEqual([{ admissions: 11, real_spacing: true }]);
      const saved = await checkpoints(); expect(saved).toHaveLength(1); expect(saved[0].task_ordinal).toBe(2);
      expect(await connection.database.query('SELECT terminal,failure_count FROM public_data_intakes WHERE id=$1', [id])).toEqual([{ terminal: true, failure_count: 0 }]);
      // The original failed owner and the successful older checkpoint cannot
      // mutate terminal history by replay or by borrowing the later receipt.
      await expect(intake.fail(abandoned.work, abandoned.fence)).rejects.toThrow();
      if (!completed) throw new Error('CP15 successful checkpoint missing.');
      await expect(intake.completeTransactions!(...completed)).rejects.toThrow();
      await expect(intake.completeTransactions!({ ...completed[0], nativeWeek: 0 }, completed[1], completed[2], abandoned.fence)).rejects.toThrow();
      expect(await checkpoints()).toEqual(saved);
      await intake.submit(input); expect(await checkpoints()).toEqual(saved);
      fetch.mockRestore();
      const denyFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP15 recovery stored read attempted acquisition.'));
      const queries: string[] = [];
      const database: DatabaseClient = { enabled: true, query: async <Row extends DatabaseRow = DatabaseRow>(sql: string,
        parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu); queries.push(sql);
        return connection.database.query<Row>(sql, parameters, options);
      } };
      const final = await readPublicSleeperIntake(database, createLeagueAdministrationStore(database), id);
      expect(final).toMatchObject({ status: 'partial', transactionHistory: { collection: 'partial', coverage: 'complete',
        summary: { requestedPeriods: 19, materializedPeriods: 19, acquiredPeriods: 1, pendingPeriods: 0, unavailablePeriods: 18 } } });
      if (final.status === 'missing' || !final.transactions || !final.transactionHistory) throw new Error('CP15 terminal partial history unavailable.');
      expect(final.transactions[0]).toMatchObject({ receiptState: 'unavailable', failureCount: 5, resource: { status: 'unavailable' }, acquisition: null,
        currentAccepted: { resource: { status: 'available', capture: { receipt: { id: baseline.capture.receipt.id } } } } });
      expect(final.transactions[1]).toMatchObject({ receiptState: 'complete-empty', resource: { status: 'available', value: { events: [] } } });
      expect(final.transactionHistory.tasks.slice(2).every(task => task.collection === 'unavailable' && task.transactionReceiptId === null)).toBe(true);
      const [witness] = await database.query("SELECT receipt.provenance->'acquisition'->'work'=dispatch.work AND receipt.provenance->'acquisition'->>'dispatchNonce'=dispatch.capture_nonce::text AND receipt.provenance->'acquisition'->'fence'=attempt.write_fence AS original_witness FROM public_data_transaction_checkpoints checkpoint JOIN league_roster_capture_receipts receipt ON receipt.id=checkpoint.transaction_receipt_id JOIN league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id JOIN public_data_dispatches dispatch ON dispatch.worker_id=checkpoint.worker_id AND dispatch.generation=checkpoint.generation AND dispatch.intake_id=checkpoint.intake_id WHERE checkpoint.intake_id=$1", [id]);
      expect(witness).toEqual({ original_witness: true });
      expect(denyFetch).not.toHaveBeenCalled(); expect(queries.length).toBeGreaterThan(0); denyFetch.mockRestore();
    } finally { fetch.mockRestore(); vi.restoreAllMocks(); }
  }, 1_530_000);
});
