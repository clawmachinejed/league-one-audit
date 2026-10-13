import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { JsonValue } from '../lib/league-administration/contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from '../lib/league-administration/store';
import { runPublicDataRefreshStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
import { PUBLIC_INTAKE_JOB, PUBLIC_TRANSACTION_HISTORY } from '../lib/league-administration/public-intake-contracts';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createProjectionStore } from '../lib/projection-store';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { exactMatchupClockInstant } from './exact-matchup-clock';

const numericId = () => '8' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const weeks = Array.from({ length: 19 }, (_, week) => week);
const trade = { transaction_id: '90071992547409931234', type: 'trade', status: 'complete', roster_ids: [1, 2],
  consenter_ids: [1, 2], adds: { player: 2 }, drops: { player: 1 },
  draft_picks: [{ season: '2027', round: 2, roster_id: 1, previous_owner_id: 1, owner_id: 2 }],
  waiver_budget: [{ sender: 1, receiver: 2, amount: 0 }, { sender: 2, receiver: 1, amount: 12.5 }],
  created: 0, status_updated: 1_000 };
const events = (week: number, corrected = false): JsonValue => corrected && week === 1 ? [] : week === 4 ? [trade] : [{
  transaction_id: '90071992547409931234', type: 'waiver', status: 'complete', roster_ids: [1],
  adds: { player: 1 }, drops: {}, settings: { waiver_bid: corrected && week === 0 ? 7 : 0 },
  metadata: { week }, created: 0, status_updated: corrected && week === 0 ? 1 : 1_000,
}];

/** AUTHORED / SQL-UNQUALIFIED. This profile does NOT acquire its baseline.
 * beforeAll directly seeds synthetic identity authority, mapping/enrollment and
 * nineteen earlier accepted 033 receipts; no fake DATA checkpoint or dispatch.
 * One later ordinary refresh performs all 24 admissions/25 intercepted GETs at
 * real 60s spacing plus final zero-GET settlement (24 completion gaps). Body 1,530s + two90s hooks =1,710s, leaving90s for guarded
 * migration/provision/report/global cleanup inside30min. Seed, selection, final
 * zero-GET settlement and cooldown count in these allowances. Fit is unmeasured.
 * Direct partial/malformed/replay/ordering probes are explicitly distinct from
 * ordinary refresh transport failure/retry, which this tight profile excludes. */
describe.sequential('full transaction history refresh from disclosed accepted baseline through restricted PostgreSQL', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationStore>;
  let mapping: AdministrationSourceMapping;
  const identityId = randomUUID(), manager = numericId(), external = numericId(), username = 'cp15_refresh_' + manager;
  const baseline = new Map<number, Extract<Awaited<ReturnType<ReturnType<typeof createLeagueAdministrationStore>['readAcceptedTransactions']>>, { status: 'available' }>>();
  async function capture(scope: AdministrationSourceMapping, week: number, payload: JsonValue, completeness: 'complete' | 'partial' = 'complete') {
    const attempt = await administration.beginTransactionAttempt(scope, week, randomUUID());
    const [clock] = await connection.database.query('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
    const at = exactMatchupClockInstant(clock.at);
    const input = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: scope.scope, family: 'transactions', week, completeness, payload,
      provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
    return { attempt, input };
  }
  const write = (scope: AdministrationSourceMapping, value: Awaited<ReturnType<typeof capture>>) => administration.recordObservation(
    value.input, undefined, scope, undefined, undefined, undefined, undefined, undefined, undefined, { attempt: value.attempt });
  async function register(externalLeagueId: string) {
    const result = await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey: 'cp15-seeded-' + randomUUID(),
      leagueName: 'CP15 explicitly synthetic baseline', season: 2026, sleeperLeagueId: externalLeagueId, scoringRules: { rec: 0.5 } });
    if (result.kind !== 'stored') throw new Error('CP15 baseline registration unavailable.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','CP15 direct synthetic baseline, not DATA acquisition')", [result.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','CP15 direct synthetic baseline, not DATA acquisition')", [result.value.leagueId]);
    const value = await administration.readSourceMapping(externalLeagueId); if (!value) throw new Error('CP15 seeded mapping missing.');
    return value;
  }
  beforeAll(async () => {
    connection = createIndependentDatabase(); administration = createLeagueAdministrationStore(connection.database);
    expect((await connection.database.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb
      FROM pg_roles WHERE rolname=current_user`))[0]).toEqual({ current_user: 'league_one_runtime',
      session_user: 'league_one_runtime', rolsuper: false, rolcreaterole: false, rolcreatedb: false });
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP15 direct baseline must not acquire provider data.'));
    try {
      // Identity authority is an explicit owner fixture; the reviewed refresh
      // itself still reacquires identity through the unchanged scheduler.
      await createPublicIntakeStore(connection.database).submit({ id: identityId, username, seasons: [2026] });
      await ownerQuery("INSERT INTO league_source_manager_accounts(provider,external_manager_id) VALUES('sleeper',$1) ON CONFLICT DO NOTHING", [manager]);
      await ownerQuery(`INSERT INTO public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,
        avatar_url,payload,request_started_at,request_completed_at) SELECT $1,id,$2,$2,NULL,$3::jsonb,clock_timestamp(),clock_timestamp()
        FROM league_source_manager_accounts WHERE provider='sleeper' AND external_manager_id=$4`,
      [identityId, username, JSON.stringify({ user_id: manager, username, fixture: 'direct synthetic identity prerequisite' }), manager]);
      mapping = await register(external);
      for (const week of weeks) {
        const seeded = await capture(mapping, week, events(week)); expect((await write(mapping, seeded)).transactionAcceptance?.status).toBe('accepted');
        const value = await administration.readAcceptedTransactions(mapping, week);
        if (value.status !== 'available' || !value.capture.receipt) throw new Error('Missing seeded CP15 acceptance.');
        expect(value.capture.envelope.provenance.acquisition).toBeUndefined(); baseline.set(week, value);
      }
      expect(baseline.size).toBe(19);
      expect(await connection.database.query('SELECT worker_id FROM public_data_dispatches WHERE intake_id=$1', [identityId])).toEqual([]);
      expect(await connection.database.query('SELECT intake_id FROM public_data_transaction_checkpoints WHERE intake_id=$1', [identityId])).toEqual([]);
      // Duplicate native IDs are separate by league and native period. This
      // second mapping is only a direct identity/collision probe, never intake.
      const unrelated = await register(numericId());
      expect((await write(unrelated, await capture(unrelated, 0, events(0)))).transactionAcceptance?.status).toBe('accepted');
      const other = await administration.readAcceptedTransactions(unrelated, 0);
      if (other.status !== 'available') throw new Error('CP15 unrelated baseline unavailable.');
      expect(other.capture.leagueSeasonId).not.toBe(mapping.leagueSeasonId);
      expect(other.capture.receipt?.id).not.toBe(baseline.get(0)!.capture.receipt?.id);
      expect((await administration.readAcceptedTransactions(mapping, 0, { receiptId: other.capture.receipt!.id })).status).not.toBe('available');
      // A partial or malformed later observation cannot erase complete last good.
      for (const value of [await capture(mapping, 2, [], 'partial'), await capture(mapping, 3, [{ type: 'waiver' }])]) {
        expect((await write(mapping, value)).transactionAcceptance?.status).toBe('preserved');
      }
      expect(await administration.readAcceptedTransactions(mapping, 2)).toEqual(baseline.get(2));
      expect(await administration.readAcceptedTransactions(mapping, 3)).toEqual(baseline.get(3));
      // Reserve and capture older first, then accept newer; delayed old delivery
      // and exact replay must neither overwrite nor duplicate the newer receipt.
      const older = await capture(unrelated, 4, events(4));
      const newer = await capture(unrelated, 4, events(4, true));
      const accepted = await write(unrelated, newer);
      expect(accepted.transactionAcceptance?.status).toBe('accepted');
      expect((await write(unrelated, older)).transactionAcceptance?.status).toBe('preserved');
      expect((await write(unrelated, newer)).transactionAcceptance).toMatchObject({ status: 'accepted', reason: 'exact_receipt_replay' });
      const current = await administration.readAcceptedTransactions(unrelated, 4);
      expect(current).toMatchObject({ status: 'available', capture: { receipt: { id: accepted.transactionAcceptance?.receiptId } } });
      expect(await connection.database.query('SELECT count(*)::integer AS count FROM league_roster_capture_receipts WHERE attempt_id=$1', [newer.attempt.id])).toEqual([{ count: 1 }]);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
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
        if (Date.now() >= until) throw new Error('CP15 refresh shared-minute cleanup did not settle.');
        await delay(250);
      }
    } finally { await connection.close(); }
  }, 90_000);

  it('refreshes all nineteen periods with corrections removals equal content fresh clocks and immutable prior receipts', async () => {
    const league = { league_id: external, season: '2026', sport: 'nfl', name: 'CP15 synthetic refresh', total_rosters: 2,
      roster_positions: ['QB', 'BN'], scoring_settings: { rec: 0.5 }, settings: {} };
    const base = 'https://api.sleeper.app/v1/league/' + external, urls: string[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      if (url === 'https://api.sleeper.app/v1/user/' + manager) return new Response(JSON.stringify({ user_id: manager, username }));
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return new Response(JSON.stringify([league]));
      if (url === base) return new Response(JSON.stringify(league));
      const week = weeks.find(value => url === base + '/transactions/' + value);
      if (week !== undefined) return new Response(JSON.stringify(events(week, true)));
      if (url === base + '/rosters') return new Response(JSON.stringify([1, 2].map(roster_id => ({ roster_id,
        owner_id: roster_id === 1 ? manager : null, co_owners: [], players: [], starters: [], reserve: [], taxi: [] }))));
      if (url === base + '/users') return new Response(JSON.stringify([{ user_id: manager, display_name: username }]));
      throw new Error('Unexpected CP15 synthetic refresh request: ' + url);
    });
    const intake = createPublicIntakeStore(connection.database), refresh = createPublicDataRefreshStore(connection.database), jobs = createProjectionStore(connection.database);
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
        const outcome = await runPublicDataRefreshStep({ ...dependencies, refresh: createPublicDataRefreshStore(connection.database),
          administration: createLeagueAdministrationStore(connection.database) }, AbortSignal.timeout(20_000));
        expect(urls.length - before.requests).toBe(outcome.providerRequests);
        if (outcome.status === 'busy') { expect(claims).toBe(before.claims); expect(admissions).toBe(before.admissions); await delay(1_000); continue; }
        expect(claims - before.claims).toBe(1);
        if (resource) {
          expect(outcome).toMatchObject({ status: 'progress', resource, providerRequests: resource === 'core' ? 2 : 1 });
          expect(admissions - before.admissions).toBe(1);
        } else {
          expect(outcome).toEqual({ status: 'backoff', providerRequests: 0 });
          expect(admissions).toBe(before.admissions); settlementClaims++;
        }
        return;
      } while (Date.now() < until);
      throw new Error('CP15 refresh stage exceeded unchanged cadence allowance.');
    }
    const configuration = { id: randomUUID(), expectedRevision: 0, identityRequestId: identityId, seasons: [2026],
      transactionHistory: PUBLIC_TRANSACTION_HISTORY, cadenceSeconds: 3600, expiresAt: new Date(Date.now() + 45 * 60_000).toISOString(), paused: false };
    let target: Awaited<ReturnType<typeof refresh.configure>> | undefined;
    try {
      target = await refresh.configure(configuration); expect(await refresh.configure(configuration)).toMatchObject({ status: 'replayed', targetId: target.targetId });
      await expect(refresh.configure({ ...configuration, transactionHistory: undefined })).rejects.toThrow();
      for (const resource of ['identity', 'leagues', 'bootstrap']) await progress(resource);
      const pending = await readPublicDataRefresh(connection.database, administration, target.targetId);
      if (pending.status !== 'available' || !pending.cycle || !pending.intake || pending.intake.status === 'missing') throw new Error('Missing CP15 refresh cycle.');
      const id = pending.cycle.requestId;
      expect(id).not.toBe(identityId);
      expect(pending).toMatchObject({ cycle: { transactionHistory: PUBLIC_TRANSACTION_HISTORY, outcome: null }, intake: {
        transactionHistory: { collection: 'pending', summary: { requestedPeriods: 19, materializedPeriods: 19, acquiredPeriods: 0, pendingPeriods: 19 } } } });
      if (!pending.intake.transactions) throw new Error('Missing CP15 pending transaction inventory.');
      for (const task of pending.intake.transactions) {
        expect(task).toMatchObject({ collection: 'pending', resource: { status: 'unavailable' }, acquisition: null,
          currentAccepted: { captureBinding: 'latest-for-current-source-mapping', resource: { status: 'available' } } });
      }
      for (const week of weeks) {
        expect(await intake.next(id)).toMatchObject({ kind: 'transactions', nativeWeek: week, externalLeagueId: external });
        await progress('transactions');
      }
      for (const resource of ['core', 'users']) await progress(resource);
      await progress();
      expect(admissions).toBe(24); expect(settlementClaims).toBe(1); expect(claims).toBe(25); expect(urls).toHaveLength(25);
      expect(urls).toEqual(['https://api.sleeper.app/v1/user/' + manager,
        'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026', base,
        ...weeks.map(week => base + '/transactions/' + week), base, base + '/rosters', base + '/users']);
      expect(await connection.database.query(`WITH ordered AS (SELECT admitted_at,lag(admitted_at) OVER(ORDER BY admitted_at) AS previous
        FROM public_data_dispatches WHERE intake_id=$1) SELECT count(*)::integer AS admissions,count(previous)::integer AS gaps,
        bool_and(previous IS NULL OR admitted_at-previous>=interval '60 seconds') AS real_spacing FROM ordered`, [id]))
        .toEqual([{ admissions: 24, gaps: 23, real_spacing: true }]);
      fetch.mockRestore();
      const denyFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP15 stored refresh read attempted acquisition.'));
      const queries: string[] = [];
      const database: DatabaseClient = { enabled: true, query: async <Row extends DatabaseRow = DatabaseRow>(sql: string,
        parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu); queries.push(sql);
        return connection.database.query<Row>(sql, parameters, options);
      } };
      const readStore = createLeagueAdministrationStore(database);
      const current = await readPublicDataRefresh(database, readStore, target.targetId);
      expect(current).toMatchObject({ cycle: { requestId: id, outcome: { disposition: 'complete' } }, intake: {
        transactionHistory: { collection: 'complete', summary: { requestedPeriods: 19, acquiredPeriods: 19, pendingPeriods: 0, unavailablePeriods: 0 } } } });
      if (current.status !== 'available' || !current.intake || current.intake.status === 'missing' || !current.intake.transactions) throw new Error('CP15 completed cycle unavailable.');
      expect(current.intake.transactions.map(task => task.nativeWeek)).toEqual(weeks);
      const receiptIds = new Set<string>();
      for (const [week, task] of current.intake.transactions.entries()) {
        const old = baseline.get(week)!;
        if (task.resource.status !== 'available' || !task.acquisition) throw new Error('CP15 refresh did not acquire selected period.');
        const capture = task.resource.capture;
        receiptIds.add(capture.receipt!.id);
        expect(capture.receipt!.id).not.toBe(old.capture.receipt!.id);
        expect(capture.envelope.payload).toEqual(events(week, true));
        expect(task.resource.value.compatibility.sourceRows).toEqual(events(week, true));
        expect(task.receiptState).toBe(week === 1 ? 'complete-empty' : 'complete');
        const rows = await database.query('SELECT external_transaction_id,source_value FROM league_administration_transaction_entries WHERE content_id=$1 ORDER BY external_transaction_id', [task.resource.capture.contentId]);
        const normalized = task.resource.capture.normalizedValue as { transactions: { externalTransactionId: string }[] };
        expect(rows).toEqual(normalized.transactions.map(row => ({ external_transaction_id: row.externalTransactionId, source_value: row })));
        if (week !== 4 && week !== 1) expect(normalized.transactions).toEqual([{
          externalTransactionId: '90071992547409931234', type: 'waiver', status: 'complete', createdAtMilliseconds: 0,
          statusUpdatedAtMilliseconds: week === 0 ? 1 : 1_000, externalRosterIds: ['1'], consenterExternalRosterIds: [],
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
        expect(capture.envelope.provenance).toMatchObject({ origin: 'network', acquisition: {
          work: { kind: 'transactions', requestId: id, externalLeagueId: external, nativeWeek: week, season: 2026 } } });
        expect(Date.parse(capture.envelope.provenance.sourceObservedAt!)).toBeGreaterThan(Date.parse(old.capture.envelope.provenance.sourceObservedAt!));
        if (week > 3) { expect(capture.observationId).toBe(old.capture.observationId); expect(capture.contentId).toBe(old.capture.contentId); }
        const historical = await readStore.readAcceptedTransactions(mapping, week, { receiptId: old.capture.receipt!.id });
        if (historical.status !== 'available') throw new Error('CP15 immutable prior receipt unavailable.');
        // Team enrichment is current stored context; every capture field and
        // acceptance below stays bound to the original immutable receipt.
        const { seasonTeams: oldTeams, ...oldCapture } = old.capture;
        const { seasonTeams: currentTeams, ...historicalCapture } = historical.capture;
        expect(oldTeams).toEqual([]); expect(currentTeams.map(team => team.externalRosterId).sort()).toEqual(['1', '2']);
        expect(historicalCapture).toEqual(oldCapture); expect(historical.accepted).toEqual(old.accepted);
      }
      expect(receiptIds.size).toBe(19);
      expect(current.intake.transactions[0]).toMatchObject({ resource: { value: { events: [{ claim: { bid: 7 }, statusUpdatedAtMilliseconds: { value: 1 } }] } } });
      expect(current.intake.transactions[1]).toMatchObject({ resource: { value: { events: [] }, capture: { envelope: { completeness: 'complete', payload: [] } } } });
      // Current exact witness joins independently bind every task to its dispatch,
      // receipt reservation and original owner; direct seeds have none of these.
      const witnesses = await database.query(`SELECT receipt.provenance->'acquisition'->'work'=dispatch.work
        AND receipt.provenance->'acquisition'->>'dispatchNonce'=dispatch.capture_nonce::text
        AND receipt.provenance->'acquisition'->'fence'=attempt.write_fence AS witnessed,
        attempt.reserved_at>=dispatch.admitted_at AND receipt.recorded_at>=attempt.reserved_at AS database_order
        FROM public_data_transaction_checkpoints checkpoint JOIN league_roster_capture_receipts receipt ON receipt.id=checkpoint.transaction_receipt_id
        JOIN league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
        JOIN public_data_dispatches dispatch ON dispatch.intake_id=checkpoint.intake_id AND dispatch.worker_id=checkpoint.worker_id
          AND dispatch.generation=checkpoint.generation WHERE checkpoint.intake_id=$1 ORDER BY checkpoint.task_ordinal`, [id]);
      expect(witnesses).toHaveLength(19); for (const value of witnesses) expect(value).toEqual({ witnessed: true, database_order: true });
      const historical = await readPublicSleeperIntake(database, readStore, id);
      if (historical.status === 'missing') throw new Error('CP15 refreshed request disappeared.');
      expect(historical.transactions).toEqual(current.intake.transactions);
      expect(denyFetch).not.toHaveBeenCalled(); expect(queries.length).toBeGreaterThan(0); denyFetch.mockRestore();
    } finally {
      fetch.mockRestore(); vi.restoreAllMocks();
      if (target) await refresh.configure({ ...configuration, expectedRevision: target.configurationRevision,
        expiresAt: new Date(Date.now() + 60_000).toISOString(), paused: true });
    }
  }, 1_530_000);
});
