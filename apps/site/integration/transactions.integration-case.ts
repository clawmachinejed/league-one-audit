import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import type { JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import type { RosterAttempt } from '../lib/aggregator/current-roster';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import { RETAINED_TRANSACTION_BATCH_LIMIT, transactionsScope, TRANSACTIONS_POLICY } from '../lib/league-administration/transaction-capture-contracts';
import { createProjectionStore } from '../lib/projection-store';
import { createIndependentDatabase, ownerQuery, runtimeQuery, type IndependentDatabase } from './neon-integration-harness';
import { exactMatchupClockInstant } from './exact-matchup-clock';

// Runs only under the existing disposable, identity-checked integration harness.
describe.sequential('transaction capture acceptance and retained evidence', () => {
  let connection: IndependentDatabase;
  let store: ReturnType<typeof createLeagueAdministrationMethods>;
  beforeAll(() => { connection = createIndependentDatabase(); store = createLeagueAdministrationMethods(connection.database); });
  afterAll(async () => connection.close());
  async function fixture() {
    const leagueKey = `transactions-${randomUUID()}`; const externalLeagueId = `transactions-source-${randomUUID()}`;
    const season = 2170;
    const registered = await createProjectionStore(connection.database).registerLeagueSeason({
      leagueKey, leagueName: 'Synthetic transactions', season, sleeperLeagueId: externalLeagueId, scoringRules: { rec: 0.5 },
    });
    if (registered.kind !== 'stored') throw new Error('Synthetic transaction registration failed.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','synthetic B3 fixture')", [registered.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,$2,'sleeper','synthetic B3 fixture')", [registered.value.leagueId, season]);
    const mapping = await store.readSourceMapping(externalLeagueId);
    if (!mapping) throw new Error('Synthetic mapping missing.');
    return { ...registered.value, mapping, leagueKey, externalLeagueId, season };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const event = (note = 'observed') => [{ transaction_id: 'same-native-event', type: 'waiver', status: 'complete',
    roster_ids: [1], adds: { player: 1 }, settings: { waiver_bid: 0 }, metadata: { notes: note }, created: 0, status_updated: 1 }];
  const selection = (f: Fixture, nativeWeeks = [0, 18]) => ({ leagueSeasonId: f.leagueSeasonId, scope: f.mapping.scope, nativeWeeks });
  async function capture(f: Fixture, payload: JsonValue = [], week = 0, completeness: 'complete' | 'partial' = 'complete') {
    const [clock] = await ownerQuery('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
    const at = exactMatchupClockInstant(clock.at);
    return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: f.mapping.scope, family: 'transactions', week, completeness, payload,
      provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
  }
  const reserve = (f: Fixture, week = 0, fence?: AdministrationWriteFence) => store.beginTransactionAttempt(f.mapping, week, randomUUID(), fence);
  const write = (f: Fixture, input: NormalizedAdministrationObservation, attempt: RosterAttempt, fence?: AdministrationWriteFence) =>
    store.recordObservation(input, fence, f.mapping, undefined, undefined, undefined, undefined, undefined, undefined, { attempt });
  async function seed(payload: JsonValue = [], week = 0) {
    const f = await fixture(); const attempt = await reserve(f, week); const input = await capture(f, payload, week);
    const result = await write(f, input, attempt);
    expect(result.transactionAcceptance).toMatchObject({ status: 'accepted', acceptedGeneration: 1 });
    return { f, attempt, input, result };
  }
  async function counts(f: Fixture) {
    return ownerQuery(`SELECT (SELECT count(*)::integer FROM league_administration_contents WHERE league_season_id=$1) AS contents,
      (SELECT count(*)::integer FROM league_administration_observations WHERE league_season_id=$1) AS observations,
      (SELECT count(*)::integer FROM league_roster_resource_acceptances accepted JOIN league_roster_resource_scopes scope
        ON scope.id=accepted.scope_id WHERE scope.league_season_id=$1) AS acceptances`, [f.leagueSeasonId]);
  }

  it('accepts complete empty native Week 0 and distinct Week 18 through the existing writer', async () => {
    const { f, result } = await seed();
    expect(await store.readAcceptedTransactions(f.mapping, 0)).toMatchObject({ status: 'available', capture: {
      envelope: { payload: [], week: 0 }, mapping: f.mapping, receipt: { coverage: { completeness: 'complete' } } } });
    const attempt = await reserve(f, 18); const input = await capture(f, event(), 18);
    expect((await write(f, input, attempt)).transactionAcceptance?.status).toBe('accepted');
    expect(await store.readAcceptedTransactions(f.mapping, 18)).toMatchObject({ status: 'available', capture: { envelope: { payload: event() } } });
    const retained = await store.scanRetainedTransactions(selection(f));
    expect(retained.status).toBe('available');
    if (retained.status !== 'available') throw new Error('Retained fixture missing.');
    expect(retained.captures.map(value => value.week)).toEqual([0, 18]);
    expect(retained.captures[0]).toMatchObject({ observationId: result.observationId, mapping: f.mapping,
      captureKind: 'original-observation', receipt: { id: result.transactionAcceptance?.receiptId } });
  });

  it('keeps an older unmapped observation unverified when a fresh equal-content receipt proves a new capture', async () => {
    const f = await fixture(); const original = await capture(f, event()); const legacy = await store.recordObservation(original);
    const attempt = await reserve(f); const fresh = await capture(f, event()); const result = await write(f, fresh, attempt);
    expect(result.observationId).toBe(legacy.observationId);
    expect(result.transactionAcceptance?.status).toBe('accepted');
    const current = await store.readAcceptedTransactions(f.mapping, 0);
    expect(current).toMatchObject({ status: 'available', capture: { captureKind: 'receipt', mapping: f.mapping,
      orderingAt: fresh.envelope.provenance.sourceObservedAt, envelope: { provenance: fresh.envelope.provenance } } });
    const retained = await store.scanRetainedTransactions(selection(f, [0]));
    expect(retained).toMatchObject({ status: 'available', captures: [{ observationId: legacy.observationId,
      mapping: null, receipt: null, envelope: { provenance: { sourceObservedAt: expect.any(String) } } }] });
    if (retained.status !== 'available') throw new Error('Retained fixture missing.');
    expect(Date.parse(retained.captures[0].envelope.provenance.sourceObservedAt!)).toBe(Date.parse(original.envelope.provenance.sourceObservedAt!));
    const next = await reserve(f); const nextInput = await capture(f, event());
    await write(f, nextInput, next);
    expect(await store.readAcceptedTransactions(f.mapping, 0)).toMatchObject({ status: 'available', capture: {
      orderingAt: nextInput.envelope.provenance.sourceObservedAt, envelope: { provenance: nextInput.envelope.provenance } } });
  });

  it('fences overlapping attempts and never accepts stale source arrivals', async () => {
    const { f } = await seed();
    const older = await reserve(f); const newer = await reserve(f);
    const newerInput = await capture(f, event('newer reservation, older source'));
    const olderInput = await capture(f, event('older reservation, newer source'));
    expect((await write(f, olderInput, older)).transactionAcceptance).toMatchObject({ status: 'preserved', reason: 'newer_network_attempt_reserved' });
    const result = await write(f, newerInput, newer);
    expect(result.status).toBe('stale');
    expect(result.transactionAcceptance).toMatchObject({ status: 'preserved', reason: 'legacy_transaction_not_current' });
    expect((await counts(f))[0].acceptances).toBe(1);
    const correction = await reserve(f); const correctedInput = await capture(f, event('correction'));
    expect((await write(f, correctedInput, correction)).transactionAcceptance).toMatchObject({ status: 'accepted', acceptedGeneration: 2 });
  });

  it('retains equal-time conflicts and partial/invalid documents without advancing accepted resource', async () => {
    const { f } = await seed(event());
    const attempt = await reserve(f); const input = await capture(f, event('first equal time'));
    const conflicting = normalizeAdministrationObservation({ ...input.envelope, payload: event('conflicting equal time') });
    await store.recordObservation(input);
    expect((await write(f, conflicting, attempt)).transactionAcceptance).toMatchObject({ status: 'preserved', reason: 'legacy_transaction_not_current' });
    expect((await counts(f))[0].acceptances).toBe(1);
    const recover = await reserve(f); await write(f, await capture(f, event('recover')), recover);
    const accepted = await store.readAcceptedTransactions(f.mapping, 0);
    for (const input of [await capture(f, event('partial'), 0, 'partial'), await capture(f, [{ type: 'waiver' }])]) {
      // Reserve before acquisition, then retain the chosen malformed/partial source shape.
      const reserved = await reserve(f); const acquired = await capture(f, input.envelope.payload, 0, input.envelope.completeness);
      expect((await write(f, acquired, reserved)).transactionAcceptance?.status).toBe('preserved');
    }
    expect(await store.readAcceptedTransactions(f.mapping, 0)).toEqual(accepted);
    const history = await store.scanRetainedTransactions(selection(f, [0]));
    expect(history.status === 'available' && history.captures.some(value => value.envelope.completeness === 'partial')).toBe(true);
    expect(history.status === 'available' && history.captures.some(value => value.normalizedValue === null)).toBe(true);
  });

  it('keeps receipts immutable, permits exact replay and rolls back conflicting receipt content', async () => {
    const { f, attempt, input, result } = await seed(event());
    expect((await write(f, input, attempt)).transactionAcceptance).toMatchObject({ status: 'accepted', reason: 'exact_receipt_replay' });
    const before = await counts(f);
    await expect(write(f, await capture(f, event('changed same attempt')), attempt)).rejects.toThrow(/receipt conflict/);
    expect(await counts(f)).toEqual(before);
    for (const table of ['league_roster_capture_receipts', 'league_roster_resource_attempts', 'league_roster_resource_acceptances']) {
      await expect(ownerQuery(`DELETE FROM ${table} WHERE ${table === 'league_roster_capture_receipts' ? 'id' : table === 'league_roster_resource_attempts' ? 'id' : 'receipt_id'}=$1`,
        [table === 'league_roster_resource_attempts' ? attempt.id : result.transactionAcceptance?.receiptId])).rejects.toThrow(/immutable/);
    }
    await expect(runtimeQuery('UPDATE league_roster_resource_heads SET generation=generation+1 WHERE scope_id=$1', [attempt.scopeId]))
      .rejects.toThrow(/permission denied/);
    await expect(runtimeQuery('SELECT public.record_league_administration_observation_v32($1::jsonb)', [JSON.stringify(input)]))
      .rejects.toThrow(/permission denied/);
  });

  it('rejects mapping changes and keeps original historical mapping after an evidenced remap', async () => {
    const { f } = await seed(event()); const attempt = await reserve(f); const input = await capture(f, event('old mapping'));
    const before = await counts(f);
    await ownerQuery("SELECT public.revise_league_source_connection($1,'sleeper',$2,$3,'synthetic same-source correction')",
      [f.leagueSeasonId, f.mapping.revisionId, f.externalLeagueId]);
    await expect(write(f, input, attempt)).rejects.toThrow(/mapping/);
    await expect(reserve(f)).rejects.toThrow(/mapping/);
    expect(await counts(f)).toEqual(before);
    expect(await store.readAcceptedTransactions(f.mapping, 0)).toEqual({ status: 'missing' });
    const history = await store.scanRetainedTransactions(selection(f, [0]));
    expect(history).toMatchObject({ status: 'available', captures: [{ mapping: f.mapping }] });
  });

  it('rejects a transaction receipt with a matchup-prefixed native period even for owner fixture insertion', async () => {
    const { f, result } = await seed(event());
    const scopeId = randomUUID(); const attemptId = randomUUID();
    const identity = { scope: { ...transactionsScope(f.mapping, 0), scoringPeriodId: 'sleeper:matchup-week:0' }, policy: TRANSACTIONS_POLICY };
    await ownerQuery('INSERT INTO league_roster_resource_scopes(id,connection_id,league_season_id,identity) VALUES($1,$2,$3,$4::jsonb)',
      [scopeId, f.mapping.connectionId, f.leagueSeasonId, JSON.stringify(identity)]);
    await ownerQuery('INSERT INTO league_roster_resource_attempts(id,scope_id,ordinal,expected_generation,source_mapping) VALUES($1,$2,1,0,$3::jsonb)',
      [attemptId, scopeId, JSON.stringify(f.mapping)]);
    await expect(ownerQuery(`INSERT INTO league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,evidence_hash,provenance,coverage)
      SELECT $1,content_id,legacy_observation_id,evidence_hash,provenance,coverage FROM league_roster_capture_receipts WHERE id=$2`,
    [attemptId, result.transactionAcceptance?.receiptId])).rejects.toThrow(/receipt lineage mismatch/);
  });

  it('binds exact reservation times and writer fence, rolling back expired writes', async () => {
    const { f } = await seed(); const preReservation = await capture(f, event()); const attempt = await reserve(f);
    await expect(write(f, preReservation, attempt)).rejects.toThrow(/predates reservation/);
    const jobKey = `transaction-fence:${randomUUID()}`; const workerId = randomUUID();
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
      VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '5 minutes',1)`, [jobKey, workerId]);
    const [clock] = await ownerQuery("SELECT clock_timestamp()+interval '5 minutes' AS at");
    const fence = { jobKey, workerId, generation: 1, deadlineAt: exactMatchupClockInstant(clock.at) };
    await expect(reserve(f, 0, { ...fence, generation: 2 })).rejects.toThrow(/writer fence/);
    const reserved = await reserve(f, 0, fence); const source = await capture(f, event()); const before = await counts(f);
    await expect(write(f, source, reserved)).rejects.toThrow(/scope mismatch/);
    await ownerQuery("UPDATE projection_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE job_key=$1", [jobKey]);
    await expect(write(f, source, reserved, fence)).rejects.toThrow(/writer fence/);
    expect(await counts(f)).toEqual(before);
  });

  it('keeps reads bounded, exact and season-scoped across repeated native event IDs', async () => {
    const first = await seed(event()); const second = await seed(event());
    const one = selection(first.f, [0]);
    const history = await store.scanRetainedTransactions(one);
    expect(history.status).toBe('available');
    if (history.status !== 'available') throw new Error('Retained fixture missing.');
    expect(await store.readRetainedTransactions(one, [first.result.observationId!])).toEqual(history);
    expect(await store.readRetainedTransactions(one, [second.result.observationId!])).toEqual({ status: 'available', captures: [] });
    expect(await store.readRetainedTransactions({ ...one, scope: { ...one.scope, externalLeagueId: 'different-source' } },
      [first.result.observationId!])).toEqual({ status: 'available', captures: [] });
    expect(await store.readRetainedTransactions(one, Array.from({ length: RETAINED_TRANSACTION_BATCH_LIMIT + 1 }, () => randomUUID())))
      .toMatchObject({ status: 'unavailable', reason: 'invalid_retained_transaction_selection' });
    expect(await store.scanRetainedTransactions({ ...one, scope: { ...one.scope, season: 2169 } }))
      .toEqual({ status: 'unavailable', reason: 'retained_transaction_scope_mismatch' });
  });
});
