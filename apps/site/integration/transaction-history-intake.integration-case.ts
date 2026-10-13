import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { JsonValue } from '../lib/league-administration/contracts';
import { createLeagueAdministrationStore, createPublicIntakeStore } from '../lib/league-administration/store';
import { runPublicIntakeStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { PUBLIC_INTAKE_JOB, PUBLIC_TRANSACTION_HISTORY } from '../lib/league-administration/public-intake-contracts';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createProjectionStore } from '../lib/projection-store';
import { createIndependentDatabase, createPinnedIntegrationDatabase, type IndependentDatabase } from './neon-integration-harness';
import { exactMatchupClockInstant } from './exact-matchup-clock';

const numericId = () => '8' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const weeks = Array.from({ length: 19 }, (_, week) => week);
const trade = { transaction_id: '90071992547409931234', type: 'trade', status: 'complete', roster_ids: [1, 2],
  consenter_ids: [1, 2], adds: { player: 2 }, drops: { player: 1 },
  draft_picks: [{ season: '2027', round: 2, roster_id: 1, previous_owner_id: 1, owner_id: 2 }],
  waiver_budget: [{ sender: 1, receiver: 2, amount: 0 }, { sender: 2, receiver: 1, amount: 12.5 }],
  created: 0, status_updated: 1_000 };
const events = (week: number, note = 'initial'): JsonValue => week === 18 ? [] : week === 4 ? [trade] : [{
  transaction_id: '90071992547409931234', type: 'waiver', status: 'complete', roster_ids: [1],
  adds: { player: 1 }, drops: {}, settings: { waiver_bid: 0 }, metadata: { week, note }, created: 0, status_updated: 1,
}];

/** AUTHORED / SQL-UNQUALIFIED. All HTTP is synthetic and intercepted.
 * One ordinary full acquisition: 24 admissions, 25 GETs, 23 admission gaps plus a real minute before zero-GET settlement.
 * The 1,530s body includes source work, selector/read assertions and the final
 * zero-GET settlement. Two 90s hooks give 1,710s; the other 90s of the unchanged
 * 30min work bound must cover migrations/provision/report/global cleanup.
 * This tight authored allowance is not measured elapsed fit. No SQL is run by
 * importing the closed profile or its offline source-inventory tests. */
describe.sequential('ordinary full transaction history intake through restricted PostgreSQL', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationStore>;
  beforeAll(async () => {
    connection = createIndependentDatabase(); administration = createLeagueAdministrationStore(connection.database);
    expect((await connection.database.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb
      FROM pg_roles WHERE rolname=current_user`))[0]).toEqual({ current_user: 'league_one_runtime',
      session_user: 'league_one_runtime', rolsuper: false, rolcreaterole: false, rolcreatedb: false });
    const runtime = await createPinnedIntegrationDatabase('runtime'); let open = false;
    try {
      await runtime.database.query('BEGIN'); open = true;
      const input = { id: randomUUID(), username: 'cp15_invalid', seasons: [2026] };
      for (const scope of [{ transactionHistory: null }, { transactionHistory: true }, { transactionHistory: 'other' },
        { transactionHistory: PUBLIC_TRANSACTION_HISTORY, seasons: [2025, 2026] },
        { transactionHistory: PUBLIC_TRANSACTION_HISTORY, transactionPeriod: { season: 2026, nativeWeek: 0 } }]) {
        await runtime.database.query('SAVEPOINT invalid_scope');
        try { await expect(runtime.database.query('SELECT public.submit_public_data_intake($1::jsonb)', [JSON.stringify({ ...input, ...scope })])).rejects.toThrow(); }
        finally { await runtime.database.query('ROLLBACK TO SAVEPOINT invalid_scope'); }
      }
      expect(await runtime.database.query('SELECT id FROM public_data_intakes WHERE id=$1', [input.id])).toEqual([]);
      for (const table of ['public_data_transaction_tasks', 'public_data_transaction_checkpoints']) {
        expect(await runtime.database.query(`SELECT has_table_privilege(current_user,$1,'SELECT') AS read,
          has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS write`, ['public.' + table]))
          .toEqual([{ read: true, write: false }]);
      }
    } finally { if (open) await runtime.database.query('ROLLBACK'); await runtime.close(); }
  }, 90_000);
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
        if (Date.now() >= until) throw new Error('CP15 intake shared-minute cleanup did not settle.');
        await delay(250);
      }
    } finally { await connection.close(); }
  }, 90_000);

  it('acquires every native period with real admission spacing immutable receipts replay and source free historical pages', async () => {
    const id = randomUUID(), manager = numericId(), external = numericId(), username = 'cp15_history_' + manager;
    const league = { league_id: external, season: '2026', sport: 'nfl', name: 'CP15 synthetic acquisition', total_rosters: 2,
      roster_positions: ['QB', 'BN'], scoring_settings: { rec: 0.5 }, settings: {} };
    const base = 'https://api.sleeper.app/v1/league/' + external, urls: string[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      if (url === 'https://api.sleeper.app/v1/user/' + username) return new Response(JSON.stringify({ user_id: manager, username }));
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return new Response(JSON.stringify([league]));
      if (url === base) return new Response(JSON.stringify(league));
      const week = weeks.find(value => url === base + '/transactions/' + value);
      if (week !== undefined) return new Response(JSON.stringify(events(week)));
      if (url === base + '/rosters') return new Response(JSON.stringify([1, 2].map(roster_id => ({ roster_id,
        owner_id: roster_id === 1 ? manager : null, co_owners: [], players: [], starters: [], reserve: [], taxi: [] }))));
      if (url === base + '/users') return new Response(JSON.stringify([{ user_id: manager, display_name: username }]));
      throw new Error('Unexpected CP15 synthetic acquisition: ' + url);
    });
    const intake = createPublicIntakeStore(connection.database), jobs = createProjectionStore(connection.database);
    let admissions = 0, claims = 0, settlementClaims = 0;
    const dependencies: PublicIntakeDependencies = { administration, intake: { ...intake, admit: async (...args) => {
      const admitted = await intake.admit(...args); if (admitted) admissions++; return admitted;
    } }, jobs: { ...jobs, acquireJob: async (...args) => {
      const claim = await jobs.acquireJob(...args); if (claim.kind === 'acquired') claims++; return claim;
    } } };
    async function progress(resource?: string) {
      const until = Date.now() + 100_000;
      do {
        const before = { claims, admissions, requests: urls.length };
        // Reconstruct the ordinary stores after every step; progress is persisted,
        // not an in-memory loop cursor. This is resumption, not process-death proof.
        const outcome = await runPublicIntakeStep(id, { ...dependencies,
          administration: createLeagueAdministrationStore(connection.database) }, AbortSignal.timeout(20_000));
        expect(urls.length - before.requests).toBe(outcome.providerRequests);
        if (outcome.status === 'busy') {
          expect(claims).toBe(before.claims); expect(admissions).toBe(before.admissions); await delay(1_000); continue;
        }
        expect(claims - before.claims).toBe(1);
        if (resource) {
          expect(outcome).toMatchObject({ status: 'progress', resource, providerRequests: resource === 'core' ? 2 : 1 });
          expect(admissions - before.admissions).toBe(1);
        } else {
          expect(outcome).toEqual({ status: 'complete', providerRequests: 0 });
          expect(admissions).toBe(before.admissions); settlementClaims++;
        }
        return;
      } while (Date.now() < until);
      throw new Error('CP15 intake stage exceeded unchanged cadence allowance.');
    }
    try {
      const input = { id, username, seasons: [2026], transactionHistory: PUBLIC_TRANSACTION_HISTORY };
      await intake.submit(input); await intake.submit(input);
      await expect(intake.submit({ id, username, seasons: [2026] })).rejects.toThrow();
      const notDiscovered = await readPublicSleeperIntake(connection.database, administration, id);
      expect(notDiscovered).toMatchObject({ transactionHistory: { discovery: 'pending', summary: { acquiredPeriods: 0, materializedPeriods: 0 } } });
      for (const resource of ['identity', 'leagues', 'bootstrap']) await progress(resource);
      const mapping = await administration.readSourceMapping(external); if (!mapping) throw new Error('Missing CP15 intake mapping.');
      expect(await readPublicSleeperIntake(connection.database, administration, id)).toMatchObject({
        transactionHistory: { collection: 'pending', summary: { requestedPeriods: 19, materializedPeriods: 19, pendingPeriods: 19, acquiredPeriods: 0 } } });
      for (const week of weeks) {
        expect(await intake.next(id)).toMatchObject({ kind: 'transactions', nativeWeek: week, externalLeagueId: external });
        await progress('transactions');
        expect(await connection.database.query('SELECT task.native_week FROM public_data_transaction_checkpoints checkpoint JOIN public_data_transaction_tasks task ON task.intake_id=checkpoint.intake_id AND task.ordinal=checkpoint.task_ordinal WHERE checkpoint.intake_id=$1 ORDER BY checkpoint.task_ordinal', [id]))
          .toEqual(weeks.slice(0, week + 1).map(native_week => ({ native_week })));
      }
      for (const resource of ['core', 'users']) await progress(resource);
      await progress();
      expect(admissions).toBe(24); expect(settlementClaims).toBe(1); expect(claims).toBe(25);
      expect(urls).toEqual(['https://api.sleeper.app/v1/user/' + username,
        'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026', base,
        ...weeks.map(week => base + '/transactions/' + week), base, base + '/rosters', base + '/users']);
      expect(urls).toHaveLength(25);
      expect(await connection.database.query(`WITH ordered AS (SELECT admitted_at,
        lag(admitted_at) OVER(ORDER BY admitted_at) AS previous FROM public_data_dispatches WHERE intake_id=$1)
        SELECT count(*)::integer AS admissions,count(previous)::integer AS gaps,
        bool_and(previous IS NULL OR admitted_at-previous>=interval '60 seconds') AS real_spacing FROM ordered`, [id]))
        .toEqual([{ admissions: 24, gaps: 23, real_spacing: true }]);
      fetch.mockRestore();
      const denyFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP15 stored read attempted source acquisition.'));
      const readSql: string[] = [];
      const database: DatabaseClient = { enabled: true, query: async <Row extends DatabaseRow = DatabaseRow>(sql: string,
        parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu); readSql.push(sql);
        return connection.database.query<Row>(sql, parameters, options);
      } };
      const readStore = createLeagueAdministrationStore(database);
      const original = await readPublicSleeperIntake(database, readStore, id);
      expect(original).toMatchObject({ status: 'available', transactionHistory: { collection: 'complete', coverage: 'complete', readCoverage: 'complete',
        summary: { observedLeagues: 1, admittedLeagues: 1, requestedPeriods: 19, materializedPeriods: 19, acquiredPeriods: 19, pendingPeriods: 0, unavailablePeriods: 0 } } });
      if (!('transactions' in original) || !original.transactions || !original.transactionHistory) throw new Error('CP15 history unavailable.');
      expect(original.transactionHistory.tasks.map(task => task.nativeWeek)).toEqual(weeks);
      expect(original.transactions.map(task => task.nativeWeek)).toEqual(weeks);
      const receipts = new Set<string>();
      for (const [week, task] of original.transactions.entries()) {
        expect(task.collection).toBe('complete'); expect(task.resource.status).toBe('available');
        if (task.resource.status !== 'available' || !task.acquisition) throw new Error('Missing CP15 acquired receipt.');
        receipts.add(task.acquisition.transactionReceiptId);
        expect(task.resource.capture.envelope).toMatchObject({ week, payload: events(week), provenance: {
          origin: 'network', acquisition: { work: { kind: 'transactions', requestId: id, nativeWeek: week, externalLeagueId: external } } } });
        expect(task.resource.value.compatibility.sourceRows).toEqual(events(week));
        expect(task.receiptState).toBe(week === 18 ? 'complete-empty' : 'complete');
        const rows = await database.query('SELECT external_transaction_id,source_value FROM league_administration_transaction_entries WHERE content_id=$1 ORDER BY external_transaction_id', [task.resource.capture.contentId]);
        const normalized = task.resource.capture.normalizedValue as { transactions: { externalTransactionId: string }[] };
        expect(rows).toEqual(normalized.transactions.map(row => ({ external_transaction_id: row.externalTransactionId, source_value: row })));
        if (week !== 4 && week !== 18) expect(normalized.transactions).toEqual([{
          externalTransactionId: '90071992547409931234', type: 'waiver', status: 'complete', createdAtMilliseconds: 0,
          statusUpdatedAtMilliseconds: 1, externalRosterIds: ['1'], consenterExternalRosterIds: [],
          playerMovements: [{ externalPlayerId: 'player', externalRosterId: '1', direction: 'add' }], draftPickMovements: [], budgetMovements: [],
        }]);
        if (week === 4) {
          expect(task.resource.capture.normalizedValue).toMatchObject({ family: 'transactions', transactions: [{
            externalTransactionId: '90071992547409931234', type: 'trade', status: 'complete', externalRosterIds: ['1', '2'],
            consenterExternalRosterIds: ['1', '2'], createdAtMilliseconds: 0, statusUpdatedAtMilliseconds: 1_000,
            playerMovements: [{ externalPlayerId: 'player', externalRosterId: '2', direction: 'add' }, { externalPlayerId: 'player', externalRosterId: '1', direction: 'drop' }],
            draftPickMovements: [{ season: 2027, round: 2, originalExternalRosterId: '1', previousOwnerExternalRosterId: '1', ownerExternalRosterId: '2' }],
            budgetMovements: [{ senderExternalRosterId: '1', receiverExternalRosterId: '2', amount: 0 }, { senderExternalRosterId: '2', receiverExternalRosterId: '1', amount: 12.5 }],
          }] });
          expect(task.resource.value.events[0]).toMatchObject({ nativeType: { value: 'trade' }, nativeStatus: { value: 'complete' },
            adds: { value: [{ player: { nativeId: 'player' }, team: { externalRosterId: '2' } }] },
            drops: { value: [{ player: { nativeId: 'player' }, team: { externalRosterId: '1' } }] },
            picks: { value: [{ season: 2027, round: 2, originalTeam: { externalRosterId: '1' }, from: { externalRosterId: '1' }, to: { externalRosterId: '2' } }] },
            budget: { value: [{ from: { externalRosterId: '1' }, to: { externalRosterId: '2' }, amount: 0 }, { from: { externalRosterId: '2' }, to: { externalRosterId: '1' }, amount: 12.5 }] } });
        }
        expect(task.resource.capture.receipt?.id).toBe(task.acquisition.transactionReceiptId);
      }
      expect(receipts.size).toBe(19);
      const pages = [];
      for (const afterOrdinal of [0, 7, 14]) {
        const page = await readPublicSleeperIntake(database, readStore, id, { transactionHistoryPage: { afterOrdinal, limit: 7 } });
        if (!('transactions' in page) || !page.transactions) throw new Error('Missing CP15 page.');
        pages.push(...page.transactions);
      }
      expect(pages).toEqual(original.transactions);
      const first = original.transactions[0];
      if (first.resource.status !== 'available' || !first.acquisition) throw new Error('Missing CP15 first capture.');
      // A later direct authoritative complete correction is separately labeled;
      // it is not a second ordinary DATA cycle or another HTTP acquisition.
      const attempt = await administration.beginTransactionAttempt(mapping, 0, randomUUID());
      const [clock] = await connection.database.query('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
      const at = exactMatchupClockInstant(clock.at);
      const correction = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
        dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'transactions', week: 0, completeness: 'complete', payload: [],
        provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
      const corrected = await administration.recordObservation(correction, undefined, mapping, undefined, undefined, undefined, undefined, undefined, undefined, { attempt });
      expect(corrected.transactionAcceptance?.status).toBe('accepted');
      const historical = await readPublicSleeperIntake(database, readStore, id);
      if (!('transactions' in historical) || !historical.transactions) throw new Error('Missing immutable CP15 history.');
      expect(historical.transactions.map(({ currentAccepted, ...task }) => { void currentAccepted; return task; }))
        .toEqual(original.transactions.map(({ currentAccepted, ...task }) => { void currentAccepted; return task; }));
      expect(historical.transactions[0]).toMatchObject({ currentAccepted: { captureBinding: 'latest-for-current-source-mapping', resource: { status: 'available', capture: { envelope: { payload: [] } } } } });
      expect(denyFetch).not.toHaveBeenCalled(); expect(readSql.length).toBeGreaterThan(0); denyFetch.mockRestore();
    } finally { fetch.mockRestore(); vi.restoreAllMocks(); }
  }, 1_530_000);
});
