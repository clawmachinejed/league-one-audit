import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import { createLeagueAdministrationStore, createPublicIntakeStore } from '../lib/league-administration/store';
import { runPublicIntakeStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { PUBLIC_INTAKE_JOB, type PublicIntakeStore } from '../lib/league-administration/public-intake-contracts';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { projectTransactionCapture } from '../lib/aggregator/transaction-activity';
import { createProjectionStore } from '../lib/projection-store';
import { createIndependentDatabase, createPinnedIntegrationDatabase, type IndependentDatabase } from './neon-integration-harness';
import { exactMatchupClockInstant } from './exact-matchup-clock';

const numericId = () => '8' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const nativeEvents = [
  // Reuses the zero-bid and 0/1 timestamp witness from transactions.integration-case.ts.
  { transaction_id: '90071992547409931234', type: 'waiver', status: 'complete', roster_ids: [1],
    adds: { player: 1 }, drops: {}, settings: { waiver_bid: 0 }, metadata: { notes: 'observed' }, created: 0, status_updated: 1 },
  { transaction_id: 'failed-native-event', type: 'waiver', status: 'failed', roster_ids: [2],
    settings: { waiver_bid: 7 }, metadata: { reason: 'source supplied failure' }, created: 1_791_849_600_000, status_updated: null },
  { transaction_id: 'unknown-native-event', type: 'future_native_type', roster_ids: [],
    settings: null, metadata: {}, created: null },
] as const satisfies JsonValue;

/** AUTHORED / UNEXECUTED CP14 SQL qualification. Synthetic HTTP uses ordinary DATA
 * acquisition, migration 033 acceptance, witnessed checkpoints and stored readers.
 * Case allowances 60s + 720s + 120s, with two 120s hooks, total 19 minutes.
 * This is unmeasured planning allowance, not elapsed-fit or live-provider proof.
 * Original 20s worker, 60s admission and 30/40/50min work/lifecycle/CI limits remain.
 * CP15 full history, recurring refresh, corrections/removals and sustained load
 * are excluded; direct empty/partial captures only qualify existing 033 readback. */
describe.sequential('ordinary exact transaction period intake through restricted PostgreSQL', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationStore>;
  let intake: PublicIntakeStore;
  let mapping: AdministrationSourceMapping;
  let requestId: string;
  let selectedReceipt: string;
  let selectedObservation: string;
  let selectedRead: Awaited<ReturnType<typeof readPublicSleeperIntake>>;
  beforeAll(async () => {
    connection = createIndependentDatabase(); administration = createLeagueAdministrationStore(connection.database);
    intake = createPublicIntakeStore(connection.database);
    expect((await connection.database.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb
      FROM pg_roles WHERE rolname=current_user`))[0]).toEqual({ current_user: 'league_one_runtime',
      session_user: 'league_one_runtime', rolsuper: false, rolcreaterole: false, rolcreatedb: false });
    expect(intake.completeTransactions).toBeTypeOf('function');
  }, 120_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    if (!connection) return;
    try {
      const until = Date.now() + 85_000;
      while (true) {
        const [row] = await connection.database.query(`SELECT
          NOT EXISTS(SELECT 1 FROM public.public_data_dispatches WHERE admitted_at>clock_timestamp()-interval '60 seconds')
          AND NOT EXISTS(SELECT 1 FROM public.projection_jobs WHERE job_key=$1
            AND (state='running' OR completed_at>clock_timestamp()-interval '60 seconds')) AS ready`, [PUBLIC_INTAKE_JOB]);
        if (row.ready === true) break;
        if (Date.now() >= until) throw new Error('CP14 shared minute cleanup did not settle.');
        await delay(250);
      }
    } finally { await connection.close(); }
  }, 120_000);
  const dependencies = (): PublicIntakeDependencies => ({ intake, administration, jobs: createProjectionStore(connection.database) });
  async function progress(resource: string, status = 'progress', override = dependencies()) {
    const until = Date.now() + 150_000;
    do {
      const outcome = await runPublicIntakeStep(requestId, override, AbortSignal.timeout(20_000));
      if (['busy', 'backoff'].includes(outcome.status)) { await delay(1_000); continue; }
      expect(outcome).toMatchObject({ status, resource, providerRequests: resource === 'core' ? 2 : 1 }); return;
    } while (Date.now() < until);
    throw new Error('CP14 stage exceeded the unchanged admission allowance.');
  }
  const checkpoints = () => connection.database.query('SELECT * FROM public_data_transaction_checkpoints WHERE intake_id=$1 ORDER BY task_ordinal', [requestId]);
  async function readOnly<T>(body: (database: DatabaseClient, store: ReturnType<typeof createLeagueAdministrationStore>) => Promise<T>) {
    const queries: string[] = [];
    const database: DatabaseClient = { enabled: true,
      query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        queries.push(sql); expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu);
        return connection.database.query<Row>(sql, parameters, options);
      } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP14 stored reads cannot acquire source.'));
    try {
      const result = await body(database, createLeagueAdministrationStore(database));
      expect(fetch).not.toHaveBeenCalled(); expect(queries.length).toBeGreaterThan(0); return result;
    } finally { fetch.mockRestore(); }
  }
  async function expectSelectedRead(database: DatabaseClient, store: ReturnType<typeof createLeagueAdministrationStore>) {
    const current = await readPublicSleeperIntake(database, store, requestId);
    if (!('readAt' in current) || !('readAt' in selectedRead)) throw new Error('Missing CP14 stored read clock.');
    const { readAt, ...actual } = current, { readAt: previousReadAt, ...expected } = selectedRead;
    expect(Number.isFinite(Date.parse(readAt))).toBe(true);
    expect(Date.parse(readAt)).toBeGreaterThanOrEqual(Date.parse(previousReadAt));
    expect(actual).toEqual(expected);
  }
  async function capture(payload: JsonValue, week = 0, completeness: 'complete' | 'partial' = 'complete') {
    const attempt = await administration.beginTransactionAttempt(mapping, week, randomUUID());
    const [clock] = await connection.database.query('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
    const at = exactMatchupClockInstant(clock.at);
    const input = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope,
      family: 'transactions', week, completeness, payload,
      provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
    const result = await administration.recordObservation(input, undefined, mapping, undefined, undefined, undefined,
      undefined, undefined, undefined, { attempt });
    return { attempt, input, result };
  }

  it('validates the one period selector immutable request scope and restricted task permissions before admission', async () => {
    const runtime = await createPinnedIntegrationDatabase('runtime'); let open = false;
    try {
      await runtime.database.query('BEGIN'); open = true;
      const base = { id: randomUUID(), username: 'cp14_sql_scope', seasons: [2026] };
      const sqlSubmit = (input: unknown) => runtime.database.query('SELECT public.submit_public_data_intake($1::jsonb)', [JSON.stringify(input)]);
      for (const transactionPeriod of [null, [], {}, { season: 2026 }, { season: 2025, nativeWeek: 0 },
        { season: 2026, nativeWeek: -1 }, { season: 2026, nativeWeek: 19 },
        { season: 2026, nativeWeek: 1.5 }, { season: 2026, nativeWeek: '0' }, { season: 2026, nativeWeek: 0, extra: true }]) {
        await runtime.database.query('SAVEPOINT invalid_scope');
        try { await expect(sqlSubmit({ ...base, transactionPeriod })).rejects.toThrow(); }
        finally { await runtime.database.query('ROLLBACK TO SAVEPOINT invalid_scope'); }
        expect(await runtime.database.query('SELECT id FROM public_data_intakes WHERE id=$1', [base.id])).toEqual([]);
      }
      await sqlSubmit(base);
      expect(Object.hasOwn(await readPublicSleeperIntake(runtime.database, createLeagueAdministrationStore(runtime.database), base.id), 'transactions')).toBe(false);
      const selected = { ...base, id: randomUUID(), transactionPeriod: { season: 2026, nativeWeek: 0 } };
      await sqlSubmit(selected); await sqlSubmit(selected);
      await sqlSubmit({ ...selected, id: randomUUID(), transactionPeriod: { season: 2026, nativeWeek: 18 } });
      for (const input of [{ ...base, transactionPeriod: selected.transactionPeriod }, { ...selected, transactionPeriod: undefined },
        { ...selected, transactionPeriod: { season: 2026, nativeWeek: 18 } },
        { ...selected, id: randomUUID(), seasons: [2025, 2026] }]) {
        await runtime.database.query('SAVEPOINT changed_scope');
        try { await expect(sqlSubmit(input)).rejects.toThrow(); }
        finally { await runtime.database.query('ROLLBACK TO SAVEPOINT changed_scope'); }
      }
      expect(await runtime.database.query('SELECT * FROM public_data_dispatches WHERE intake_id=ANY($1::uuid[])', [[base.id, selected.id]])).toEqual([]);
      for (const table of ['public_data_transaction_tasks', 'public_data_transaction_checkpoints']) {
        expect(await runtime.database.query(`SELECT has_table_privilege(current_user,$1,'SELECT') AS read,
          has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS write`, ['public.' + table]))
          .toEqual([{ read: true, write: false }]);
        await runtime.database.query('SAVEPOINT denied_mutation');
        try { await expect(runtime.database.query('DELETE FROM public.' + table + ' WHERE false')).rejects.toThrow(/permission denied/); }
        finally { await runtime.database.query('ROLLBACK TO SAVEPOINT denied_mutation'); }
      }
    } finally { if (open) await runtime.database.query('ROLLBACK'); await runtime.close(); }
  }, 60_000);

  it('composes ordinary failed acquisition recovery and same capture typed facts through immutable witnessed receipt selection', async () => {
    requestId = randomUUID(); const manager = numericId(), external = numericId(), username = 'cp14_transactions_' + manager;
    const league = { league_id: external, season: '2026', sport: 'nfl', name: 'CP14 synthetic DATA league',
      total_rosters: 2, roster_positions: ['QB', 'BN'], scoring_settings: { rec: 0.5 }, settings: {} };
    const urls: string[] = []; let malformed = true, guardsReached = false;
    let originatingCapture: NormalizedAdministrationObservation | undefined;
    const base = 'https://api.sleeper.app/v1/league/' + external;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      if (url === 'https://api.sleeper.app/v1/user/' + username) return new Response(JSON.stringify({ user_id: manager, username }));
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return new Response(JSON.stringify([league]));
      if (url === base) return new Response(JSON.stringify(league));
      if (url === base + '/transactions/0') return new Response(JSON.stringify(malformed ? {} : nativeEvents));
      if (url === base + '/rosters') return new Response(JSON.stringify([1, 2].map(roster_id => ({ roster_id,
        owner_id: roster_id === 1 ? manager : null, co_owners: [], players: [], starters: [], reserve: [], taxi: [] }))));
      if (url === base + '/users') return new Response(JSON.stringify([{ user_id: manager, display_name: username }]));
      throw new Error('Unexpected CP14 synthetic source request: ' + url);
    });
    try {
      await intake.submit({ id: requestId, username, seasons: [2026], transactionPeriod: { season: 2026, nativeWeek: 0 } });
      for (const resource of ['identity', 'leagues', 'bootstrap']) await progress(resource);
      const source = await administration.readSourceMapping(external); if (!source) throw new Error('Missing CP14 source mapping.'); mapping = source;
      expect(await intake.next(requestId)).toMatchObject({ kind: 'transactions', externalLeagueId: external, season: 2026, nativeWeek: 0 });
      await progress('transactions', 'unavailable');
      expect(await checkpoints()).toEqual([]);
      expect(await readPublicSleeperIntake(connection.database, administration, requestId)).toMatchObject({ status: 'pending',
        transactions: [{ collection: 'pending', resource: { status: 'unavailable' }, acquisition: null }] });
      expect(await connection.database.query('SELECT status,failure_count FROM public_data_transaction_tasks WHERE intake_id=$1', [requestId]))
        .toEqual([{ status: 'pending', failure_count: 1 }]);
      malformed = false;
      await progress('transactions', 'progress', { ...dependencies(), administration: { ...administration,
        recordObservation: async (input, ...rest) => {
          if (input.envelope.family === 'transactions') originatingCapture = input;
          return administration.recordObservation(input, ...rest);
        } }, intake: { ...intake,
        completeTransactions: async (work, selected, checkpoint, fence) => {
          for (const wrong of [{ ...work, kind: 'weekly-report' }, { ...work, nativeWeek: 18 }, { ...work, externalLeagueId: numericId() }]) {
            await expect(intake.completeTransactions!(wrong as typeof work, selected, checkpoint, fence)).rejects.toThrow();
          }
          await expect(intake.completeTransactions!(work, { ...selected, revisionId: randomUUID() }, checkpoint, fence)).rejects.toThrow();
          await expect(intake.completeTransactions!(work, selected, { ...checkpoint, observations: { transactions: randomUUID() } }, fence)).rejects.toThrow();
          await expect(intake.completeTransactions!(work, selected, { ...checkpoint, receipts: { transactions: randomUUID() } }, fence)).rejects.toThrow();
          expect(await checkpoints()).toEqual([]); guardsReached = true;
          await intake.completeTransactions!(work, selected, checkpoint, fence);
          selectedObservation = checkpoint.observations.transactions;
        } } });
      expect(guardsReached).toBe(true);
      for (const resource of ['core', 'users']) await progress(resource);
      expect(await intake.next(requestId)).toBe('complete');
      expect(urls).toEqual(['https://api.sleeper.app/v1/user/' + username,
        'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026', base, base + '/transactions/0',
        base + '/transactions/0', base, base + '/rosters', base + '/users']);
      fetch.mockRestore();
      const rows = await checkpoints(); expect(rows).toHaveLength(1);
      selectedReceipt = String(rows[0].transaction_receipt_id);
      const accepted = await administration.readAcceptedTransactions(mapping, 0, { receiptId: selectedReceipt });
      expect(accepted.status).toBe('available'); if (accepted.status !== 'available') throw new Error('Missing CP14 selected receipt.');
      expect(accepted.capture).toMatchObject({ receipt: { id: selectedReceipt, coverage: { completeness: 'complete',
        periodIds: ['sleeper:transaction-week:0'] } }, observationId: selectedObservation, mapping,
        envelope: { family: 'transactions', week: 0, payload: nativeEvents } });
      expect(originatingCapture?.status).toBe('accepted');
      expect(accepted.capture.normalizedValue).toEqual(originatingCapture!.value);
      expect(accepted.capture.contentHash).toBe(originatingCapture!.contentHash);
      expect(accepted.capture.semanticHash).toBe(originatingCapture!.semanticHash);
      expect(accepted.capture.envelope.provenance).toEqual(originatingCapture!.envelope.provenance);
      expect(accepted.capture.receipt!.provenance).toEqual(originatingCapture!.envelope.provenance);
      const normalizedTransactions = originatingCapture!.value;
      if (normalizedTransactions?.family !== 'transactions') throw new Error('Missing CP14 normalized transaction rows.');
      const persistedRows = await readOnly(database => database.query(
        'SELECT external_transaction_id,source_value FROM league_administration_transaction_entries WHERE content_id=$1 ORDER BY external_transaction_id COLLATE "C"',
        [accepted.capture.contentId]));
      expect(persistedRows).toEqual([...normalizedTransactions.transactions]
        .sort((left, right) => left.externalTransactionId < right.externalTransactionId ? -1 : left.externalTransactionId > right.externalTransactionId ? 1 : 0)
        .map(value => ({ external_transaction_id: value.externalTransactionId, source_value: value })));
      const typed = projectTransactionCapture(accepted.capture);
      expect(typed.status).toBe('available'); if (typed.status !== 'available') throw new Error('Missing CP14 typed projection.');
      expect(typed.compatibility.sourceRows).toEqual(nativeEvents);
      expect(typed.events.map(event => event.externalTransactionId)).toEqual(nativeEvents.map(event => event.transaction_id));
      expect(typed.events[0]).toMatchObject({ nativeStatus: { state: 'known', value: 'complete' }, result: 'Won',
        createdAtMilliseconds: { state: 'known', value: 0 }, statusUpdatedAtMilliseconds: { state: 'known', value: 1 },
        timestamp: '1970-01-01T00:00:00.001Z', claim: { bid: 0, visibility: 'supplied-only', losingClaimInventory: 'unknown',
          bids: { settings: { state: 'known', value: 0 }, direct: { state: 'absent' }, metadata: { state: 'absent' } } },
        rosterIds: { state: 'known', value: ['1'] }, adds: { state: 'known', value: [{ direction: 'add',
          player: { nativeId: 'player' }, team: { externalRosterId: '1' } }] }, drops: { state: 'known', value: [] } });
      expect(typed.events[1]).toMatchObject({ nativeStatus: { state: 'known', value: 'failed' }, result: 'Lost',
        statusUpdatedAtMilliseconds: { state: 'null' }, timestamp: new Date(nativeEvents[1].created!).toISOString(), claim: { bid: 7 } });
      expect(typed.events[2]).toMatchObject({ nativeStatus: { state: 'absent' }, typeSupport: 'unsupported',
        createdAtMilliseconds: { state: 'null' }, statusUpdatedAtMilliseconds: { state: 'absent' }, timestamp: null,
        settings: { state: 'null' }, claim: { bid: null, losingClaimInventory: 'unknown' } });
      for (const event of typed.events) expect(event.evidence).toMatchObject({ captureId: accepted.capture.captureId,
        observationId: selectedObservation, contentId: accepted.capture.contentId, week: 0,
        sourceMappingRevisionId: mapping.revisionId, provenance: accepted.capture.envelope.provenance });
      selectedRead = await readOnly((database, store) => readPublicSleeperIntake(database, store, requestId));
      expect(selectedRead).toMatchObject({ status: 'available', request: { terminal: true },
        transactions: [{ collection: 'complete', nativeWeek: 0, resource: { status: 'available', value: typed },
          acquisition: { sourceMapping: mapping, transactionReceiptId: selectedReceipt } }] });
      const equal = await capture(nativeEvents);
      expect(equal.result.transactionAcceptance?.status).toBe('accepted');
      expect(equal.result.observationId).toBe(selectedObservation);
      expect(equal.result.transactionAcceptance?.receiptId).not.toBe(selectedReceipt);
      expect(Date.parse(equal.input.envelope.provenance.sourceObservedAt!))
        .toBeGreaterThan(Date.parse(originatingCapture!.envelope.provenance.sourceObservedAt!));
      expect(await administration.readAcceptedTransactions(mapping, 0)).toMatchObject({ status: 'available',
        capture: { receipt: { id: equal.result.transactionAcceptance?.receiptId }, envelope: { provenance: equal.input.envelope.provenance } } });
      await readOnly(async (database, store) => {
        expect(await store.readAcceptedTransactions(mapping, 0, { receiptId: equal.result.transactionAcceptance!.receiptId! }))
          .toMatchObject({ status: 'available', capture: { observationId: selectedObservation,
            receipt: { id: equal.result.transactionAcceptance!.receiptId! }, envelope: { provenance: equal.input.envelope.provenance } } });
        expect(await store.readAcceptedTransactions(mapping, 0, { receiptId: selectedReceipt })).toEqual(accepted);
        await expectSelectedRead(database, store);
      });
      const witnessed = await connection.database.query(`SELECT
        dispatch.work->>'kind'='transactions' AND (dispatch.work->>'nativeWeek')::integer=task.native_week
          AND (dispatch.work->>'season')::integer=task.season AS same_work,
        checkpoint.source_mapping=attempt.source_mapping AS same_mapping,
        receipt.legacy_observation_id=$2::uuid AS same_observation,
        receipt.provenance->'acquisition'->>'dispatchNonce'=dispatch.capture_nonce::text
          AND receipt.provenance->'acquisition'->'work'=dispatch.work
          AND receipt.provenance->'acquisition'->'fence'=attempt.write_fence AS witnessed,
        attempt.reserved_at>=dispatch.admitted_at AND receipt.recorded_at>=attempt.reserved_at AS database_order
        FROM public_data_transaction_checkpoints checkpoint
        JOIN public_data_transaction_tasks task ON task.intake_id=checkpoint.intake_id AND task.ordinal=checkpoint.task_ordinal
        JOIN public_data_dispatches dispatch ON dispatch.worker_id=checkpoint.worker_id AND dispatch.generation=checkpoint.generation
        JOIN league_roster_capture_receipts receipt ON receipt.id=checkpoint.transaction_receipt_id
        JOIN league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
        WHERE checkpoint.intake_id=$1`, [requestId, selectedObservation]);
      expect(witnessed).toEqual([{ same_work: true, same_mapping: true, same_observation: true, witnessed: true, database_order: true }]);
      expect(await connection.database.query(`SELECT count(*)::integer AS count,
        bool_and(previous IS NULL OR admitted_at-previous>=interval '60 seconds') AS spaced
        FROM(SELECT admitted_at,lag(admitted_at) OVER(ORDER BY admitted_at) AS previous
          FROM public_data_dispatches WHERE intake_id=$1) history`, [requestId])).toEqual([{ count: 7, spaced: true }]);
    } finally { fetch.mockRestore(); }
  }, 720_000);

  it('preserves complete empty and last good partial evidence while rejecting foreign receipt selections without source access', async () => {
    const empty = await capture([], 18);
    expect(empty.result.transactionAcceptance?.status).toBe('accepted');
    const accepted = await administration.readAcceptedTransactions(mapping, 18);
    expect(accepted.status).toBe('available'); if (accepted.status !== 'available') throw new Error('Missing CP14 empty capture.');
    expect(projectTransactionCapture(accepted.capture)).toMatchObject({ status: 'available', week: 18, sourceCompleteness: 'complete', events: [] });
    for (const value of [{ payload: nativeEvents, completeness: 'partial' as const }, { payload: [{ type: 'waiver' }], completeness: 'complete' as const }]) {
      const failed = await capture(value.payload, 18, value.completeness);
      expect(failed.result.transactionAcceptance?.status).toBe('preserved');
      expect(await administration.readAcceptedTransactions(mapping, 18)).toEqual(accepted);
    }
    const retained = await administration.scanRetainedTransactions({ leagueSeasonId: mapping.leagueSeasonId, scope: mapping.scope, nativeWeeks: [18] });
    expect(retained.status).toBe('available'); if (retained.status !== 'available') throw new Error('Missing CP14 retained partial evidence.');
    expect(retained.captures.some(value => value.envelope.completeness === 'partial')).toBe(true);
    expect(retained.captures.some(value => value.normalizedValue === null)).toBe(true);
    await readOnly(async (database, store) => {
      for (const [selected, week] of [[mapping, 18], [{ ...mapping, revisionId: randomUUID() }, 0],
        [{ ...mapping, leagueSeasonId: randomUUID() }, 0]] as const) {
        expect((await store.readAcceptedTransactions(selected, week, { receiptId: selectedReceipt })).status).not.toBe('available');
      }
      await expectSelectedRead(database, store);
      expect(await store.readAcceptedTransactions(mapping, 18)).toEqual(accepted);
    });
  }, 120_000);
});
