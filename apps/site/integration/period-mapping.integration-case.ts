import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import captureSchedule from '../test-support/fixtures/sleeper-2026-season-schedule.json';
import type { AdministrationFamily, JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createSleeperCalendarEvidence, type SleeperCalendarEvidence } from '../lib/league-administration/period-mapping';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import { createProjectionStore } from '../lib/projection-store';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, runtimeQuery,
  type IndependentDatabase } from './neon-integration-harness';

const rules = { rec: 0.5 };
const ordinary = [
  { roster_id: 1, matchup_id: 4, players: ['a'], starters: ['a'], starters_points: [8.25], players_points: { a: 8.25 }, points: 8.25, custom_points: 0 },
  { roster_id: 2, matchup_id: 4, players: ['b'], starters: ['b'], starters_points: [4], players_points: { b: 4 }, points: 4 },
];

describe.sequential('retained native-week calendar identity evidence', () => {
  let connection: IndependentDatabase;
  let store: ReturnType<typeof createLeagueAdministrationMethods>;
  beforeAll(() => { connection = createIndependentDatabase(); store = createLeagueAdministrationMethods(connection.database); });
  afterAll(async () => connection.close());
  async function fixture() {
    const leagueKey = `period-mapping-${randomUUID()}`;
    const externalLeagueId = `period-source-${randomUUID()}`;
    const registered = await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey,
      leagueName: 'Synthetic period mapping', season: 2026, sleeperLeagueId: externalLeagueId, scoringRules: rules });
    if (registered.kind !== 'stored') throw new Error('Isolated fixture registration failed.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','synthetic fixture')", [registered.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','synthetic fixture')", [registered.value.leagueId]);
    const mapping = await store.readSourceMapping(externalLeagueId);
    if (!mapping) throw new Error('Missing fixture source mapping.');
    return { ...registered.value, mapping, leagueKey, externalLeagueId };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const leaguePayload = (f: Fixture, leg = 3) => ({ league_id: f.externalLeagueId, season: '2026', sport: 'nfl',
    season_type: 'regular', total_rosters: 2, scoring_settings: rules, roster_positions: ['QB', 'BN'], settings: { leg }, status: 'in_season' });
  async function instant() {
    // Preserve subsecond time and remain after an exact-matchup reservation.
    const [clock] = await ownerQuery('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
    return exactMatchupClockInstant(clock.at);
  }
  async function capture(f: Fixture, payload: unknown = leaguePayload(f), family: AdministrationFamily = 'league',
    week: number | null = null, origin: 'network' | 'cache' = 'network') {
    const at = await instant();
    return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: f.mapping.scope,
      family, week, completeness: 'complete', payload: payload as JsonValue,
      provenance: { origin, requestStartedAt: at, requestCompletedAt: at,
        sourceObservedAt: origin === 'network' ? at : null, checkedAt: at } });
  }
  async function calendar(schedule: unknown = captureSchedule.body) {
    const at = await instant();
    const value = createSleeperCalendarEvidence({ season: '2026', seasonSchedule: schedule,
      evaluatedAt: at, retrievalStartedAt: at, retrievalCompletedAt: at });
    if (!value) throw new Error('Invalid synthetic calendar evidence.');
    return value;
  }
  const write = (f: Fixture, input: NormalizedAdministrationObservation, evidence: SleeperCalendarEvidence,
    fence?: AdministrationWriteFence, methods = store) => methods.recordObservation(input, fence, f.mapping,
    undefined, undefined, undefined, undefined, evidence);
  const rows = (f: Fixture) => ownerQuery('SELECT * FROM league_native_period_calendar_evidence WHERE league_season_id=$1 ORDER BY retained_at,id', [f.leagueSeasonId]);
  async function state(f: Fixture) {
    return ownerQuery(`SELECT
      (SELECT count(*)::integer FROM league_administration_contents WHERE league_season_id=$1) AS contents,
      (SELECT count(*)::integer FROM league_administration_observations WHERE league_season_id=$1) AS observations,
      (SELECT count(*)::integer FROM league_native_period_calendar_evidence WHERE league_season_id=$1) AS calendars,
      (SELECT row_to_json(head) FROM league_administration_heads head WHERE league_season_id=$1 AND family='league' AND week=0) AS head`, [f.leagueSeasonId]);
  }
  async function seed(withCalendar = true, week = 3) {
    const f = await fixture();
    const attempt = await store.beginExactMatchupAttempt(f.mapping, week, randomUUID());
    const input = await capture(f, leaguePayload(f, week));
    const evidence = await calendar();
    const result = withCalendar ? await write(f, input, evidence) : await store.recordObservation(input);
    if (!result.observationId) throw new Error('Missing configuration observation.');
    const population = { observationId: result.observationId, contentHash: input.contentHash, envelope: input.envelope };
    const matchups = await capture(f, ordinary, 'matchups', week);
    expect((await store.recordObservation(matchups, undefined, f.mapping, undefined, undefined, undefined, { attempt, population }))
      .matchupAcceptance?.status).toBe('accepted');
    const current = await store.readAcceptedExactMatchups(f.mapping, week);
    if (current.status !== 'available') throw new Error('Missing exact matchup read.');
    return { f, input, evidence, result, current, week };
  }
  async function workerFence(seconds = 300): Promise<AdministrationWriteFence> {
    const jobKey = `period-mapping-fence:${randomUUID()}`; const workerId = randomUUID();
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
      VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '5 minutes',1)`, [jobKey, workerId]);
    const [clock] = await ownerQuery("SELECT clock_timestamp()+($1::integer * interval '1 second') AS at", [seconds]);
    return { jobKey, workerId, generation: 1, deadlineAt: exactMatchupClockInstant(clock.at) };
  }

  it('preserves old unmapped official facts and qualifies the real reader from unchanged cache content without restamping its observation', async () => {
    const { f, current, result, week } = await seed(false);
    expect(current.periodMapping).toEqual({ status: 'unmapped', reason: 'calendar_evidence_missing' });
    expect(current.value.period.nflWeekMappings).toEqual([]);
    const beforeObservation = await ownerQuery('SELECT * FROM league_administration_observations WHERE id=$1', [result.observationId]);
    const evidence = await calendar();
    const added = await write(f, await capture(f, leaguePayload(f), 'league', null, 'cache'), evidence);
    expect(added).toMatchObject({ status: 'unchanged', observationId: result.observationId, calendarEvidence: { status: 'retained' } });
    const after = await store.readAcceptedExactMatchups(f.mapping, week);
    if (after.status !== 'available') throw new Error('Missing mapped exact read.');
    expect(after.periodMapping).toMatchObject({ status: 'mapped', purpose: 'native-period-identity',
      evidenceRef: added.calendarEvidence?.id, season: 2026, seasonType: 'regular', week,
      evaluatedAt: evidence.evaluatedAt, sourceObservedAt: null });
    expect(after.value.period.nflWeekMappings).toEqual([{ season: 2026, seasonType: 'regular', week, evidenceRef: added.calendarEvidence?.id }]);
    expect({ ...after, periodMapping: current.periodMapping, value: { ...after.value, period: current.value.period } }).toEqual(current);
    expect(await ownerQuery('SELECT * FROM league_administration_observations WHERE id=$1', [result.observationId])).toEqual(beforeObservation);
    expect((await rows(f))[0]).toMatchObject({ observation_id: result.observationId, evidence });
  });

  it.each([1, 18])('maps exact Week %i including fantasy playoff legs without inventing NFL postseason or finality', async week => {
    const { current, result } = await seed(true, week);
    expect(current.periodMapping).toMatchObject({ status: 'mapped', purpose: 'native-period-identity', season: 2026,
      seasonType: 'regular', week, evidenceRef: result.calendarEvidence?.id });
    expect(current.value.state).toEqual({ provider: 'unknown', local: 'unknown', reason: 'no_matchup_finality_evidence' });
    expect(current.value.teams[0].officialTeamPoints.effective).toBe('0');
  });

  it('deduplicates equal retrievals, retains corrections, and preserves first proof across calendar A to B to A', async () => {
    const { f, evidence, result, current, week } = await seed();
    const first = (await rows(f))[0];
    const later = await calendar();
    expect(later.retrievalCompletedAt).not.toBe(evidence.retrievalCompletedAt);
    expect((await write(f, await capture(f), later)).calendarEvidence).toEqual({ id: result.calendarEvidence?.id, status: 'replayed' });
    expect((await rows(f))[0]).toEqual(first);
    const correctedSchedule = evidence.schedule.map((game, index) => index === 0 ? { ...game, status: 'pre_game' } : game);
    const corrected = await calendar(correctedSchedule);
    expect(corrected.scheduleRevision).not.toBe(evidence.scheduleRevision);
    const changed = await write(f, await capture(f), corrected);
    expect(changed.calendarEvidence?.status).toBe('retained');
    expect(changed.calendarEvidence?.id).not.toBe(result.calendarEvidence?.id);
    expect((await write(f, await capture(f), await calendar())).calendarEvidence).toEqual({ id: result.calendarEvidence?.id, status: 'replayed' });
    expect(await rows(f)).toHaveLength(2);
    expect((await rows(f))[0]).toEqual(first);
    expect(await store.readAcceptedExactMatchups(f.mapping, week)).toEqual(current);
    const beforeConflict = await state(f);
    await expect(write(f, await capture(f), { ...corrected, scheduleRevision: evidence.scheduleRevision })).rejects.toThrow(/evidence identity conflict/);
    expect(await state(f)).toEqual(beforeConflict);
  });

  it('binds configuration corrections to new content and never borrows another content or league proof', async () => {
    const { f, result } = await seed();
    const first = (await rows(f))[0];
    const input = await capture(f, { ...leaguePayload(f), name: 'Configuration correction' });
    const correction = await write(f, input, await calendar());
    expect(correction.calendarEvidence?.id).not.toBe(result.calendarEvidence?.id);
    const retained = await rows(f);
    expect(retained).toHaveLength(2);
    expect(retained[1].configuration_content_id).not.toBe(first.configuration_content_id);
    expect(retained[1].observation_id).toBe(correction.observationId);
    const foreign = await fixture();
    const before = await state(foreign);
    await expect(write(foreign, input, await calendar())).rejects.toThrow(/mapped league content/);
    expect(await state(foreign)).toEqual(before);
    const cloneSql = `INSERT INTO league_native_period_calendar_evidence(connection_id,league_season_id,source_mapping_revision_id,
      configuration_content_id,observation_id,mapping_policy_version,schedule_revision,evidence_hash,evidence)
      SELECT $2::uuid,$3::uuid,$4::uuid,configuration_content_id,observation_id,mapping_policy_version,schedule_revision,evidence_hash,evidence
      FROM league_native_period_calendar_evidence WHERE id=$1`;
    await expect(ownerQuery(cloneSql, [first.id, foreign.mapping.connectionId, foreign.leagueSeasonId, foreign.mapping.revisionId]))
      .rejects.toThrow(/lineage mismatch/);
  });

  it.each(['source', 'season', 'partial-calendar', 'duplicate-game', 'wrong-date', 'source-time', 'retrieval-order'] as const)(
    'rejects %s calendar evidence atomically', async invalid => {
      const f = await fixture(); const input = await capture(f); const evidence = await calendar();
      const malformed = structuredClone(evidence) as unknown as Record<string, unknown>;
      if (invalid === 'source') malformed.source = { ...evidence.source, resource: 'schedule/nfl/post' };
      if (invalid === 'season') malformed.source = { ...evidence.source, season: '2027' };
      if (invalid === 'partial-calendar') malformed.schedule = evidence.schedule.slice(1);
      if (invalid === 'duplicate-game') malformed.schedule = evidence.schedule.map((game, index) => index === 1 ? { ...game, game_id: evidence.schedule[0].game_id } : game);
      if (invalid === 'wrong-date') malformed.schedule = evidence.schedule.map((game, index) => index === 0 ? { ...game, date: '2025-09-01' } : game);
      if (invalid === 'source-time') malformed.sourceObservedAt = evidence.retrievalCompletedAt;
      if (invalid === 'retrieval-order') malformed.retrievalStartedAt = new Date(Date.parse(evidence.retrievalCompletedAt) + 1000).toISOString();
      const before = await state(f);
      await expect(write(f, input, malformed as unknown as SleeperCalendarEvidence)).rejects.toThrow(/native period calendar/);
      expect(await state(f)).toEqual(before);
    });

  it.each(['sport', 'season_type'] as const)('rejects explicitly supplied proof for league content missing %s while old callers remain unchanged', async field => {
    const f = await fixture(); const payload: Record<string, unknown> = leaguePayload(f); delete payload[field];
    const input = await capture(f, payload); const before = await state(f);
    await expect(write(f, input, await calendar())).rejects.toThrow(/accepted content mismatch/);
    expect(await state(f)).toEqual(before);
    expect((await store.recordObservation(input)).status).toBe('changed');
    expect(await rows(f)).toEqual([]);
  });

  it('requires an exact source mapping and rejects stale tokens after source A to B to A', async () => {
    const { f, input, evidence, current, week } = await seed(); const original = await rows(f);
    await expect(store.recordObservation(input, undefined, undefined, undefined, undefined, undefined, undefined, evidence))
      .rejects.toThrow(/mapped league content/);
    const other = `period-remap-${randomUUID()}`;
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'synthetic remap')", [f.leagueSeasonId, f.mapping.revisionId, other]);
    const middle = await store.readSourceMapping(other);
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'synthetic return')", [f.leagueSeasonId, middle!.revisionId, f.externalLeagueId]);
    const latest = await store.readSourceMapping(f.externalLeagueId);
    if (!latest) throw new Error('Missing remapped identity.');
    const before = await state(f);
    await expect(write(f, await capture(f), await calendar())).rejects.toThrow(/mapping.*stale/);
    expect(await state(f)).toEqual(before);
    expect(await rows(f)).toEqual(original);
    expect(await store.readAcceptedExactMatchups(latest, week)).toEqual({ status: 'missing' });
    const next = { ...f, mapping: latest };
    const nextResult = await write(next, await capture(next), await calendar());
    expect(nextResult.calendarEvidence?.id).not.toBe(current.periodMapping.status === 'mapped' ? current.periodMapping.evidenceRef : null);
    expect(await rows(f)).toHaveLength(2);
    expect((await rows(f))[1].source_mapping_revision_id).toBe(latest.revisionId);
  });

  it('retains no sidecar for stale or rejected base writes and leaves prior official facts available', async () => {
    const { f, input, current, week } = await seed(false);
    const oldAt = new Date(Date.parse(input.envelope.provenance.checkedAt) - 1000).toISOString();
    const stale = normalizeAdministrationObservation({ ...input.envelope, payload: { ...leaguePayload(f), name: 'Older capture' },
      provenance: { origin: 'network', requestStartedAt: oldAt, requestCompletedAt: oldAt, sourceObservedAt: oldAt, checkedAt: oldAt } });
    expect((await write(f, stale, await calendar())).status).toBe('stale');
    const rejected = await capture(f, { ...leaguePayload(f), total_rosters: 'invalid' });
    expect(rejected.status).toBe('rejected');
    expect((await write(f, rejected, await calendar())).status).toBe('rejected');
    expect(await rows(f)).toEqual([]);
    expect(await store.readAcceptedExactMatchups(f.mapping, week)).toEqual(current);
  });

  it('rejects expired, foreign-owner and wrong-generation leases without inserting either history or proof', async () => {
    const f = await fixture(); const input = await capture(f); const evidence = await calendar(); const fence = await workerFence();
    const before = await state(f);
    for (const invalid of [{ ...fence, generation: 2 }, { ...fence, workerId: randomUUID() },
      { ...fence, deadlineAt: '2020-01-01T00:00:00.000Z' }]) {
      await expect(write(f, input, evidence, invalid)).rejects.toThrow(/writer fence/);
    }
    await ownerQuery("UPDATE projection_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE job_key=$1", [fence.jobKey]);
    await expect(write(f, input, evidence, fence)).rejects.toThrow(/writer fence/);
    expect(await state(f)).toEqual(before);
  });

  it.each(['source', 'head'] as const)('rolls back all evidence when the lease deadline expires behind the %s lock', async lock => {
    const seeded = await seed(false); const { f } = seeded; const before = await state(f);
    // Exact replay returns early in v1, so the head case exercises the new wrapper guard.
    const input = lock === 'head' ? seeded.input : await capture(f, { ...leaguePayload(f), name: 'Blocked correction' });
    const evidence = await calendar();
    const owner = await createPinnedIntegrationDatabase('owner'); const writer = await createPinnedIntegrationDatabase('runtime');
    let completion: Promise<{ error?: unknown }> | undefined;
    try {
      const [ownerPid] = await owner.database.query('SELECT pg_backend_pid() AS pid');
      const [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid');
      const fence = await workerFence(8);
      await owner.database.query('BEGIN');
      if (lock === 'source') await owner.database.query("SELECT pg_advisory_xact_lock(hashtextextended('league-configuration:'||$1::text,0))", [f.leagueSeasonId]);
      else await owner.database.query("SELECT league_season_id FROM league_administration_heads WHERE league_season_id=$1 AND family='league' AND week=0 FOR UPDATE", [f.leagueSeasonId]);
      completion = write(f, input, evidence, fence, createLeagueAdministrationMethods(writer.database)).then(() => ({}), error => ({ error }));
      let blocked = false;
      for (let poll = 0; poll < 50; poll++) {
        const [row] = await owner.database.query<{ blocked: boolean }>('SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS blocked', [ownerPid.pid, writerPid.pid]);
        if (row.blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await owner.database.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)', [fence.deadlineAt]);
      await owner.database.query('COMMIT');
      expect(String((await completion).error)).toMatch(/writer fence.*(?:stale|expired)/);
      expect(await state(f)).toEqual(before);
    } finally {
      await owner.database.query('ROLLBACK').catch(() => undefined); await completion;
      await writer.close(); await owner.close();
    }
  });

  it('keeps a corrupted first proof explicitly unmapped without hiding official facts or silently borrowing a later proof', async () => {
    const { f, input, current, week } = await seed(false);
    const valid = await calendar();
    const malformed = { ...valid, scheduleRevision: '0'.repeat(64) };
    // SQL checks structural evidence; the existing TypeScript calendar owns the domain revision algorithm.
    expect((await write(f, input, malformed)).calendarEvidence?.status).toBe('retained');
    const invalidRead = await store.readAcceptedExactMatchups(f.mapping, week);
    if (invalidRead.status !== 'available') throw new Error('Corrupt optional proof hid official facts.');
    expect(invalidRead.periodMapping).toEqual({ status: 'unmapped', reason: 'calendar_evidence_invalid' });
    expect({ ...invalidRead, periodMapping: current.periodMapping }).toEqual(current);
    expect((await write(f, await capture(f), valid)).calendarEvidence?.status).toBe('retained');
    expect(await rows(f)).toHaveLength(2);
    expect(await store.readAcceptedExactMatchups(f.mapping, week)).toEqual(invalidRead);
  });

  it('keeps immutable table and private delegates inaccessible to runtime, including repeated provisioning', async () => {
    const { f, result } = await seed(); const id = result.calendarEvidence?.id;
    await expect(runtimeQuery('UPDATE league_native_period_calendar_evidence SET retained_at=clock_timestamp() WHERE id=$1', [id])).rejects.toThrow(/permission denied/);
    await expect(runtimeQuery('DELETE FROM league_native_period_calendar_evidence WHERE id=$1', [id])).rejects.toThrow(/permission denied/);
    await expect(runtimeQuery('INSERT INTO league_native_period_calendar_evidence SELECT * FROM league_native_period_calendar_evidence WHERE id=$1', [id])).rejects.toThrow(/permission denied/);
    await expect(ownerQuery('UPDATE league_native_period_calendar_evidence SET retained_at=clock_timestamp() WHERE id=$1', [id])).rejects.toThrow(/immutable/);
    await expect(ownerQuery('DELETE FROM league_native_period_calendar_evidence WHERE id=$1', [id])).rejects.toThrow(/immutable/);
    const rights = () => ownerQuery(`SELECT has_table_privilege('league_one_runtime','public.league_native_period_calendar_evidence','SELECT') AS readable,
      has_table_privilege('league_one_runtime','public.league_native_period_calendar_evidence','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS writable,
      has_function_privilege('league_one_runtime','public.record_league_administration_observation(jsonb)','EXECUTE') AS writer,
      has_function_privilege('league_one_runtime','public.record_league_administration_observation_v30(jsonb)','EXECUTE') AS bypass,
      has_function_privilege('league_one_runtime','public.validate_native_period_calendar_evidence(jsonb,text)','EXECUTE') AS validator,
      has_function_privilege('league_one_runtime','public.validate_native_period_calendar_lineage()','EXECUTE') AS lineage`);
    const expected = [{ readable: true, writable: false, writer: true, bypass: false, validator: false, lineage: false }];
    expect(await rights()).toEqual(expected);
    await ownerQuery(await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'));
    expect(await rights()).toEqual(expected);
    expect(await rows(f)).toHaveLength(1);
  });
});
