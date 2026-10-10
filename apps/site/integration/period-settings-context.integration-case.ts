import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import calendarFixture from '../test-support/fixtures/sleeper-2026-season-schedule.json';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import type { ConfigurationComponentName, JsonObject, JsonValue } from '../lib/league-administration/contracts';
import type { ExactPeriodContextRead, ExactPeriodContextSelection } from '../lib/aggregator/exact-period-context';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from '../lib/league-administration/store';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createSleeperCalendarEvidence } from '../lib/league-administration/period-mapping';
import { runPublicIntakeStep, runPublicDataRefreshStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
import { PUBLIC_INTAKE_JOB, PUBLIC_PERIOD_INVENTORY } from '../lib/league-administration/public-intake-contracts';
import { createProjectionStore } from '../lib/projection-store';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

const rules = { rec: 0.5 };
const weeks = Array.from({ length: 18 }, (_, index) => index + 1);
const numericId = () => '9' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const leagueDocument = (external: string): JsonObject => ({ league_id: external, season: '2026', sport: 'nfl',
  season_type: 'regular', name: 'CP9 synthetic settings league', status: 'complete', total_rosters: 2,
  roster_positions: ['QB', 'BN'], scoring_settings: rules,
  settings: { leg: 18, last_scored_leg: 0, start_week: 1, playoff_week_start: 15, playoff_round_type: 2, waiver_budget: 0 } });
const matchups = [{ roster_id: 1, matchup_id: 1, points: 10, players: [], starters: [] },
  { roster_id: 2, matchup_id: 1, points: 8, players: [], starters: [] }];
type AvailableContext = Extract<ExactPeriodContextRead, { status: 'available' }>;

/** AUTHORED / UNEXECUTED CP9 qualification. Historical applicability positives are
 * explicit synthetic owner-confirmed decisions, never provider-effective history
 * or decisions known at capture time. Only weeks1/2 are ordinarily acquired in
 * each18-task request. Six60s +840s +two120s hooks =24min authored allowance;
 * actual fit/cost remains unmeasured. Existing20s/60s/30m/40m/50m gates remain. */
describe.sequential('receipt bound period settings context through restricted PostgreSQL', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationStore>;
  let intake: ReturnType<typeof createPublicIntakeStore>;
  let refresh: ReturnType<typeof createPublicDataRefreshStore>;
  let roleFixture: Awaited<ReturnType<typeof fixture>>;
  let roleCapture: Awaited<ReturnType<typeof exact>>;
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
          NOT EXISTS(SELECT 1 FROM public_data_dispatches WHERE admitted_at>clock_timestamp()-interval '60 seconds')
          AND NOT EXISTS(SELECT 1 FROM projection_jobs WHERE job_key=$1
            AND (state='running' OR completed_at>clock_timestamp()-interval '60 seconds')) AS ready`, [PUBLIC_INTAKE_JOB]);
        if (row.ready === true) break;
        if (Date.now() >= until) throw new Error('CP9 shared minute cleanup did not settle.');
        await delay(250);
      }
    } finally { await connection.close(); }
  });
  async function now() {
    const [clock] = await connection.database.query('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
    return (clock.at instanceof Date ? clock.at : new Date(String(clock.at))).toISOString();
  }
  async function fixture() {
    const external = numericId(), leagueKey = 'cp9-' + randomUUID();
    const registered = await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey,
      leagueName: 'CP9 synthetic settings', season: 2026, sleeperLeagueId: external, scoringRules: rules });
    if (registered.kind !== 'stored') throw new Error('CP9 fixture registration unavailable.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','CP9 synthetic prerequisite')", [registered.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','CP9 synthetic prerequisite')", [registered.value.leagueId]);
    const mapping = await administration.readSourceMapping(external); if (!mapping) throw new Error('Missing CP9 mapping.');
    return { ...registered.value, mapping, external, payload: leagueDocument(external) };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function observation(f: Fixture, payload: JsonValue, family: 'league' | 'matchups' = 'league', week: number | null = null) {
    const at = await now();
    return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: f.mapping.scope, family, week, completeness: 'complete', payload,
      provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
  }
  async function settings(f: Fixture, payload = f.payload, withCalendar = true) {
    const attempt = await administration.beginLeagueSettingsAttempt(f.mapping, randomUUID());
    const input = await observation(f, payload), at = input.envelope.provenance.checkedAt;
    const calendar = withCalendar ? createSleeperCalendarEvidence({ season: '2026', seasonSchedule: calendarFixture.body,
      evaluatedAt: at, retrievalStartedAt: at, retrievalCompletedAt: at }) : undefined;
    if (withCalendar && !calendar) throw new Error('Invalid CP9 calendar prerequisite.');
    const result = await administration.recordObservation(input, undefined, f.mapping, undefined, undefined, { attempt }, undefined, calendar ?? undefined);
    expect(result.leagueSettingsAcceptance?.status).toBe('accepted');
    if (!result.observationId || !result.leagueSettingsAcceptance?.receiptId) throw new Error('Missing CP9 settings receipt.');
    return { input, result, attempt, receiptId: result.leagueSettingsAcceptance.receiptId,
      proof: { observationId: result.observationId, contentHash: input.contentHash, envelope: input.envelope } };
  }
  async function exact(f: Fixture, week = 4, payload = f.payload, withCalendar = true) {
    const attempt = await administration.beginExactMatchupAttempt(f.mapping, week, randomUUID());
    const configuration = await settings(f, payload, withCalendar), input = await observation(f, matchups, 'matchups', week);
    const result = await administration.recordObservation(input, undefined, f.mapping, undefined, undefined, undefined,
      { attempt, population: configuration.proof });
    expect(result.matchupAcceptance?.status).toBe('accepted');
    if (!result.matchupAcceptance?.receiptId) throw new Error('Missing CP9 matchup receipt.');
    return { attempt, input, result, configuration,
      selection: { nativeWeek: week, matchupsReceiptId: result.matchupAcceptance.receiptId } };
  }
  async function read(mapping: AdministrationSourceMapping, selection: ExactPeriodContextSelection,
    store = administration): Promise<AvailableContext> {
    if (!store.readExactPeriodContext) throw new Error('Missing CP9 reader.');
    const result = await store.readExactPeriodContext(mapping, selection);
    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('Missing CP9 exact context.');
    return result;
  }
  async function activate(f: Fixture, versionId: string | null | undefined, component: ConfigurationComponentName,
    from = 1, through = 18, seasonType = 'regular') {
    if (!versionId) throw new Error('Missing CP9 configuration version.');
    const [current] = await connection.database.query(`SELECT COALESCE(max(generation),0)::integer AS generation
      FROM league_configuration_activations WHERE league_season_id=$1 AND component=$2`, [f.leagueSeasonId, component]);
    const evidence = 'CP9 synthetic owner attestation for ' + component + ' ' + from + '-' + through;
    const [row] = await ownerQuery(`SELECT activate_league_configuration_component($1::uuid,$2::text,$3::text,
      $4::smallint,$5::smallint,$6::text,$7::bigint) AS id`, [versionId, component, seasonType, from, through, evidence, current.generation]);
    return String(row.id);
  }
  async function retained(f: Fixture) {
    return connection.database.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM league_administration_contents c WHERE league_season_id=$1) AS contents,
      (SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM league_configuration_versions v WHERE league_season_id=$1) AS versions,
      (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM league_configuration_activations a WHERE league_season_id=$1) AS activations,
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM league_roster_capture_receipts r
        JOIN league_roster_resource_attempts a ON a.id=r.attempt_id WHERE a.source_mapping->>'leagueSeasonId'=$1::text) AS receipts`, [f.leagueSeasonId]);
  }
  async function storedOnly<T>(body: (database: DatabaseClient, store: ReturnType<typeof createLeagueAdministrationStore>) => Promise<T>) {
    const statements: string[] = [];
    const database: DatabaseClient = { enabled: true,
      query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        statements.push(sql); expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu);
        return connection.database.query<Row>(sql, parameters, options);
      } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP9 stored reader must not fetch source.'));
    try { const result = await body(database, createLeagueAdministrationStore(database));
      expect(fetch).not.toHaveBeenCalled(); expect(statements.length).toBeGreaterThan(0); return result;
    } finally { fetch.mockRestore(); }
  }

  it('retains captured settings without treating current observations as historical applicability', async () => {
    const f = await fixture(), capture = await exact(f);
    const history = await retained(f);
    const context = await storedOnly((_database, store) => read(f.mapping, capture.selection, store));
    expect(context).toMatchObject({ version: 'sleeper-exact-period-context-v1', period: { season: 2026, nativeWeek: 4 },
      sourceMappingRevisionId: f.mapping.revisionId, capture: { matchupsReceiptId: capture.selection.matchupsReceiptId, settingsReceiptId: null },
      observedConfiguration: { rawContentHash: capture.configuration.input.contentHash, applicability: 'observation-only',
        provenance: capture.configuration.input.envelope.provenance, value: capture.configuration.input.leagueSettings?.value },
      calendar: { status: 'mapped', seasonType: 'regular', week: 4 },
      configuration: { scoring: { status: 'unknown', reason: 'no_binding' }, roster: { status: 'unknown', reason: 'no_binding' },
        competition: { status: 'unknown', reason: 'no_binding' } },
      nativeOfficialPhase: { status: 'unknown', reason: 'native-period-phase-not-exposed' },
      phase: { status: 'unknown', reason: 'competition_applicability_unknown', round: { status: 'unknown' }, leg: { status: 'unknown' }, end: { status: 'unknown' } } });
    expect(context.observedConfiguration.contentId).toBe(context.capture.configurationContentId);
    expect(context.observedConfiguration.value.waivers.budget).toMatchObject({ state: 'known', value: 0 });
    expect(await retained(f)).toEqual(history);
    const ordinary = await administration.readAcceptedExactMatchups(f.mapping, 4);
    expect(ordinary).toMatchObject({ status: 'available', lineupApplicability: { status: 'unavailable', reason: 'no_binding' } });
    expect(ordinary).not.toHaveProperty('periodContext');
  }, 60_000);

  it('resolves independently evidenced components at inclusive native period boundaries', async () => {
    const f = await fixture(), captures = [];
    for (const week of [1, 2, 14, 15, 18]) captures.push(await exact(f, week));
    const scoring = captures[0].configuration;
    const roster = await settings(f, { ...f.payload, roster_positions: ['QB', 'SUPER_FLEX', 'BN'] });
    const competition = await settings(f, { ...f.payload, settings: { ...(f.payload.settings as JsonObject), start_week: 2 } });
    expect(new Set([scoring.result.versionId, roster.result.versionId, competition.result.versionId]).size).toBe(3);
    const scoringRef = await activate(f, scoring.result.versionId, 'scoring');
    const rosterRef = await activate(f, roster.result.versionId, 'roster', 2, 15);
    const competitionRef = await activate(f, competition.result.versionId, 'competition');
    for (const capture of captures) {
      const context = await read(f.mapping, capture.selection), week = capture.selection.nativeWeek;
      expect(context.configuration.scoring).toMatchObject({ status: 'known', activationRef: scoringRef,
        basis: 'latest-evidenced-decision', binding: { configurationVersionId: scoring.result.versionId, evidence: { kind: 'owner_confirmed' } },
        range: { fromWeek: 1, throughWeek: 18 }, fields: { scoring: { rules: { value: rules } } } });
      expect(context.configuration.competition).toMatchObject({ status: 'known', activationRef: competitionRef,
        binding: { configurationVersionId: competition.result.versionId }, fields: { competition: { startPeriod: { value: 2 } } } });
      expect(context.configuration.roster).toMatchObject(week >= 2 && week <= 15
        ? { status: 'known', activationRef: rosterRef, binding: { configurationVersionId: roster.result.versionId }, range: { fromWeek: 2, throughWeek: 15 } }
        : { status: 'unknown', reason: 'no_binding' });
      expect(context.phase).toMatchObject({ status: 'derived', basis: 'owner-confirmed-applicable-settings',
        activationRef: competitionRef, value: week < 2 ? 'before-start' : week < 15 ? 'regular-window' : 'on-or-after-playoff-start',
        boundaries: { startPeriod: 2, playoffStartPeriod: 15 }, round: { status: 'unknown' }, leg: { status: 'unknown' }, end: { status: 'unknown' } });
      expect(context.calendar).toMatchObject({ status: 'mapped', seasonType: 'regular', week });
      expect(context.nativeOfficialPhase.status).toBe('unknown');
      expect(context.observedConfiguration.rawContentHash).toBe(capture.configuration.input.contentHash);
    }
  }, 60_000);

  it('preserves missing invalid and contradictory evidence without inventing fantasy phase', async () => {
    for (const [value, reason] of [[undefined, 'absent'], [null, 'null'], ['15', 'invalid'], [false, 'invalid'],
      [0, 'zero'], [19, 'out-of-range']] as const) {
      const f = await fixture(), fields = { ...(f.payload.settings as JsonObject) };
      if (value === undefined) delete fields.playoff_week_start; else fields.playoff_week_start = value;
      const capture = await exact(f, 4, { ...f.payload, settings: fields });
      await activate(f, capture.configuration.result.versionId, 'competition');
      const context = await read(f.mapping, capture.selection);
      expect(context.configuration.competition.status).toBe('known');
      expect(context.phase).toMatchObject({ status: 'unknown', reason: 'competition_boundaries_unproved',
        boundaryGaps: [{ field: 'playoffStartPeriod', reason }] });
      expect(context.observedConfiguration.value.competition.playoffStartPeriod).toMatchObject(value === undefined
        ? { state: 'absent', value: null } : value === null ? { state: 'null', value: null }
          : typeof value !== 'number' ? { state: 'invalid', value: null, raw: value } : { state: 'known', value });
      expect(await administration.readAcceptedExactMatchups(f.mapping, 4)).toMatchObject({ status: 'available' });
    }
    const f = await fixture(), contradiction = await exact(f, 4, { ...f.payload,
      settings: { ...(f.payload.settings as JsonObject), start_week: 15, playoff_week_start: 2 } });
    await activate(f, contradiction.configuration.result.versionId, 'competition');
    expect((await read(f.mapping, contradiction.selection)).phase)
      .toMatchObject({ status: 'unknown', reason: 'contradictory_competition_boundaries' });
    const noCalendar = await fixture(), unmapped = await exact(noCalendar, 4, noCalendar.payload, false);
    await activate(noCalendar, unmapped.configuration.result.versionId, 'competition');
    expect(await read(noCalendar.mapping, unmapped.selection)).toMatchObject({ calendar: { status: 'unmapped', reason: 'calendar_evidence_missing' },
      configuration: { competition: { status: 'unknown', reason: 'period_mapping_unproved' } },
      phase: { status: 'unknown', reason: 'period_mapping_unproved' } });
    const otherRange = await fixture(), excluded = await exact(otherRange);
    await activate(otherRange, excluded.configuration.result.versionId, 'competition', 1, 3);
    await activate(otherRange, excluded.configuration.result.versionId, 'competition', 4, 4, 'post');
    expect((await read(otherRange.mapping, excluded.selection)).configuration.competition)
      .toEqual({ status: 'unknown', reason: 'no_binding' });
  }, 60_000);

  it('retains captured settings through corrections replay and newer unproved decisions', async () => {
    const f = await fixture(), original = await exact(f);
    await activate(f, original.configuration.result.versionId, 'scoring');
    await activate(f, original.configuration.result.versionId, 'competition');
    const first = await read(f.mapping, original.selection);
    const scoringCorrection = await settings(f, { ...f.payload, scoring_settings: { rec: 1 } }, false);
    expect(scoringCorrection.result.status).toBe('rejected'); // Existing configured-profile conflict stays authoritative for v1.
    const scoringRef = await activate(f, scoringCorrection.result.versionId, 'scoring');
    const applicable = await read(f.mapping, original.selection);
    expect(applicable.observedConfiguration).toEqual(first.observedConfiguration);
    expect(applicable.configuration.scoring).toMatchObject({ status: 'known', activationRef: scoringRef,
      basis: 'latest-evidenced-decision', binding: { configurationVersionId: scoringCorrection.result.versionId,
        evidence: { kind: 'owner_confirmed' } }, fields: { scoring: { rules: { value: { rec: 1 } } } } });
    expect(applicable.observedConfiguration.value.scoring.rules.value).toEqual(rules);
    const corrected = await exact(f, 4, { ...f.payload, settings: { ...(f.payload.settings as JsonObject), playoff_week_start: 14 } });
    expect(corrected.selection.matchupsReceiptId).not.toBe(original.selection.matchupsReceiptId);
    expect((await read(f.mapping, original.selection)).observedConfiguration).toEqual(first.observedConfiguration);
    const back = await exact(f);
    expect(back.configuration.input.contentHash).toBe(original.configuration.input.contentHash);
    expect(back.configuration.result.versionId).toBe(original.configuration.result.versionId);
    expect(back.selection.matchupsReceiptId).not.toBe(original.selection.matchupsReceiptId);
    const beforeReplay = await retained(f);
    expect((await administration.recordObservation(back.input, undefined, f.mapping, undefined, undefined, undefined,
      { attempt: back.attempt, population: back.configuration.proof })).matchupAcceptance)
      .toMatchObject({ status: 'accepted', reason: 'exact_receipt_replay', receiptId: back.selection.matchupsReceiptId });
    expect(await retained(f)).toEqual(beforeReplay);
    const unprovedPayload = { ...f.payload, settings: { ...(f.payload.settings as JsonObject), playoff_week_start: 12 } };
    const unprovedInput = await observation(f, unprovedPayload);
    const unproved = await administration.recordObservation(unprovedInput);
    const unprovedRef = await activate(f, unproved.versionId, 'competition');
    const blocked = await read(f.mapping, original.selection);
    expect(blocked.configuration.competition).toEqual({ status: 'unknown', reason: 'invalid_applicability_evidence' });
    expect(blocked.phase).toMatchObject({ status: 'unknown', reason: 'competition_applicability_unknown' });
    expect(blocked.observedConfiguration).toEqual(first.observedConfiguration);
    await settings(f, unprovedPayload);
    expect((await read(f.mapping, original.selection)).configuration.competition)
      .toMatchObject({ status: 'known', activationRef: unprovedRef, fields: { competition: { playoffStartPeriod: { value: 12 } } } });
    roleFixture = f; roleCapture = back;
  }, 60_000);

  it('rejects unrelated receipts and mapping revisions while preserving immutable history', async () => {
    const f = await fixture(), capture = await exact(f), foreign = await fixture(), other = await exact(foreign);
    const reader = administration.readExactPeriodContext; if (!reader) throw new Error('Missing CP9 reader.');
    const before = await retained(f);
    for (const selection of [{ ...capture.selection, matchupsReceiptId: randomUUID() }, other.selection,
      { ...capture.selection, nativeWeek: 5 }]) {
      expect(await reader(f.mapping, selection)).toEqual({ status: 'missing' });
    }
    expect(await reader(f.mapping, { ...capture.selection, nativeWeek: 0 }))
      .toEqual({ status: 'unavailable', reason: 'invalid_period_context_scope' });
    expect(await reader(f.mapping, { ...capture.selection,
      intakeCapture: { intakeId: randomUUID(), settingsReceiptId: capture.configuration.receiptId } }))
      .toEqual({ status: 'unavailable', reason: 'period_context_evidence_unavailable' });
    expect(await reader({ ...f.mapping, revisionId: randomUUID() }, capture.selection)).toEqual({ status: 'missing' });
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'CP9 synthetic remap')",
      [f.leagueSeasonId, f.mapping.revisionId, 'cp9-remap-' + randomUUID()]);
    expect(await reader(f.mapping, capture.selection)).toEqual({ status: 'missing' });
    const [middle] = await connection.database.query('SELECT external_league_id FROM league_source_connections WHERE id=$1', [f.mapping.connectionId]);
    const mappingB = await administration.readSourceMapping(String(middle.external_league_id)); if (!mappingB) throw new Error('Missing CP9 middle mapping.');
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'CP9 synthetic return')", [f.leagueSeasonId, mappingB.revisionId, f.external]);
    const mappingA = await administration.readSourceMapping(f.external); if (!mappingA) throw new Error('Missing CP9 returned mapping.');
    expect(mappingA.revisionId).not.toBe(f.mapping.revisionId);
    expect(await reader(mappingA, capture.selection)).toEqual({ status: 'missing' });
    expect(await retained(f)).toEqual(before);
    const current = { ...f, mapping: mappingA }, fresh = await exact(current);
    expect((await read(mappingA, fresh.selection)).sourceMappingRevisionId).toBe(mappingA.revisionId);
    expect((await read(foreign.mapping, other.selection)).capture.matchupsReceiptId).toBe(other.selection.matchupsReceiptId);
  }, 60_000);

  it('composes ordinary recovery and changed refresh context through retained period receipts', async () => {
    const id = randomUUID(), manager = numericId(), external = numericId(), username = 'cp9_periods_' + manager;
    let correction = false, failSecond = false; const urls: string[] = [];
    const original = leagueDocument(external), changed: JsonObject = { ...original,
      roster_positions: ['QB', 'SUPER_FLEX', 'BN'], settings: { ...(original.settings as JsonObject), playoff_week_start: 14 } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      if (url === 'https://api.sleeper.app/v1/user/' + username || url === 'https://api.sleeper.app/v1/user/' + manager)
        return new Response(JSON.stringify({ user_id: manager, username }));
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return new Response(JSON.stringify([correction ? changed : original]));
      if (url === 'https://api.sleeper.app/v1/league/' + external) return new Response(JSON.stringify(correction ? changed : original));
      for (const week of [1, 2]) if (url === 'https://api.sleeper.app/v1/league/' + external + '/matchups/' + week) {
        if (week === 2 && failSecond) return new Response('{}', { status: 503 });
        return new Response(JSON.stringify(matchups));
      }
      throw new Error('Unexpected CP9 fixture acquisition: ' + url);
    });
    const dependencies = (): PublicIntakeDependencies => ({ intake, administration, jobs: createProjectionStore(connection.database) });
    async function progress(resource: string, status = 'progress', recurring = false, override = dependencies()) {
      const until = Date.now() + 150_000;
      do {
        const outcome = recurring ? await runPublicDataRefreshStep({ ...override, refresh }, AbortSignal.timeout(20_000))
          : await runPublicIntakeStep(id, override, AbortSignal.timeout(20_000));
        if (['busy', 'backoff', 'idle'].includes(outcome.status)) { await delay(1_000); continue; }
        expect(outcome).toMatchObject({ status, resource, providerRequests: resource === 'exact-matchups' ? 2 : 1 }); return;
      } while (Date.now() < until);
      throw new Error('CP9 ordinary stage exceeded its existing admission allowance.');
    }
    const checkpoints = (requestId: string) => connection.database.query(`SELECT * FROM public_data_exact_period_checkpoints
      WHERE intake_id=$1 ORDER BY task_ordinal`, [requestId]);
    let target: { targetId: string; configurationRevision: number } | undefined;
    const configuration = { id: randomUUID(), expectedRevision: 0, identityRequestId: id, seasons: [2026],
      periodInventory: PUBLIC_PERIOD_INVENTORY, cadenceSeconds: 60, expiresAt: new Date(Date.now() + 25 * 60_000).toISOString(), paused: false };
    try {
      await intake.submit({ id, username, seasons: [2026], periodInventory: PUBLIC_PERIOD_INVENTORY });
      for (const resource of ['identity', 'leagues', 'bootstrap']) await progress(resource);
      let acknowledgmentProved = false;
      await progress('exact-matchups', 'unavailable', false, { ...dependencies(), intake: { ...intake,
        completeExactPeriod: async (work, mapping, capture, fence) => {
          expect(work.nativeWeek).toBe(1);
          await intake.completeExactPeriod(work, mapping, capture, fence);
          acknowledgmentProved = true; throw new Error('CP9 checkpoint committed; acknowledgment lost.');
        } } });
      expect(acknowledgmentProved).toBe(true);
      expect(await intake.next(id)).toMatchObject({ kind: 'exact-matchups', nativeWeek: 2 });
      failSecond = true; await progress('exact-matchups', 'unavailable');
      expect(await connection.database.query('SELECT native_week,status,failure_count FROM public_data_exact_period_tasks WHERE intake_id=$1 AND native_week<=2 ORDER BY native_week', [id]))
        .toEqual([{ native_week: 1, status: 'complete', failure_count: 0 }, { native_week: 2, status: 'pending', failure_count: 1 }]);
      failSecond = false; await progress('exact-matchups'); expect(urls).toHaveLength(9);
      const mapping = await administration.readSourceMapping(external); if (!mapping) throw new Error('Missing ordinary CP9 mapping.');
      const originalCheckpoints = await checkpoints(id); expect(originalCheckpoints).toHaveLength(2);
      const selections = originalCheckpoints.map(row => ({ nativeWeek: Number(row.task_ordinal), matchupsReceiptId: String(row.matchups_receipt_id),
        intakeCapture: { intakeId: id, settingsReceiptId: String(row.settings_receipt_id) } }));
      const originalContexts: AvailableContext[] = [];
      for (const selection of selections) originalContexts.push(await read(mapping, selection));
      target = await refresh.configure(configuration);
      expect(await refresh.configure(configuration)).toMatchObject({ status: 'replayed', targetId: target.targetId });
      correction = true;
      for (const resource of ['identity', 'leagues', 'bootstrap', 'exact-matchups', 'exact-matchups']) await progress(resource, 'progress', true);
      expect(urls).toHaveLength(16); expect(urls[9]).toBe('https://api.sleeper.app/v1/user/' + manager);
      expect(urls.some(url => /\/matchups\/(?:[3-9]|1[0-9])$/u.test(url))).toBe(false);
      fetch.mockRestore();
      let currentId = '';
      await storedOnly(async (database, store) => {
        const ordinary = await readPublicSleeperIntake(database, store, id);
        if (ordinary.status === 'missing') throw new Error('Missing CP9 ordinary default read.');
        expect(ordinary.exactPeriods).toHaveLength(18);
        expect(ordinary.exactPeriods?.every(period => !Object.hasOwn(period, 'periodContext'))).toBe(true);
        const current = await readPublicDataRefresh(database, store, target!.targetId, { periodContextVersion: 'v1' });
        expect(current).toMatchObject({ status: 'available', intake: { status: 'pending', periodInventory: {
          collection: 'pending', summary: { admittedPeriods: 18, completePeriods: 2, pendingPeriods: 16 } } } });
        if (current.status !== 'available' || !current.cycle || !current.intake || current.intake.status === 'missing') throw new Error('Missing CP9 refresh context.');
        currentId = current.cycle.requestId;
        expect(current.intake.periodInventory?.tasks.map(task => task.nativeWeek)).toEqual(weeks);
        for (const period of current.intake.exactPeriods?.slice(0, 2) ?? []) {
          expect(period.resource.status).toBe('available');
          expect(period.periodContext).toMatchObject({ status: 'available', observedConfiguration: { applicability: 'observation-only',
            value: { competition: { playoffStartPeriod: { state: 'known', value: 14 } } } },
            configuration: { competition: { status: 'unknown', reason: 'period_mapping_unproved' } },
            phase: { status: 'unknown', reason: 'period_mapping_unproved' } });
        }
        const historical = await readPublicSleeperIntake(database, store, id, { periodContextVersion: 'v1' });
        if (historical.status === 'missing') throw new Error('Missing CP9 historical intake.');
        expect(historical.periodInventory?.summary).toMatchObject({ completePeriods: 2, pendingPeriods: 16 });
        expect(historical.exactPeriods?.slice(0, 2).map(period => period.resource))
          .toEqual([1, 2].map(() => expect.objectContaining({ status: 'unavailable', reason: 'intake-capture-not-current-head' })));
        expect(historical.exactPeriods?.slice(0, 2).map(period => period.periodContext)).toEqual(originalContexts);
        for (let index = 0; index < selections.length; index++) expect(await read(mapping, selections[index], store)).toEqual(originalContexts[index]);
        const reader = store.readExactPeriodContext; if (!reader) throw new Error('Missing CP9 paired reader.');
        expect(await reader(mapping, { ...selections[0], intakeCapture: { intakeId: currentId,
          settingsReceiptId: selections[0].intakeCapture.settingsReceiptId } }))
          .toEqual({ status: 'unavailable', reason: 'period_context_evidence_unavailable' });
      });
      expect(currentId).not.toBe(id); expect(await checkpoints(id)).toEqual(originalCheckpoints);
      expect(await checkpoints(currentId)).toHaveLength(2);
      expect((await connection.database.query('SELECT count(*)::integer AS count FROM public_data_exact_period_tasks WHERE intake_id=ANY($1::uuid[])', [[id, currentId]]))[0].count).toBe(36);
      const witnesses = await connection.database.query(`SELECT checkpoint.intake_id,
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
        WHERE checkpoint.intake_id=ANY($1::uuid[])`, [[id, currentId]]);
      expect(witnesses).toHaveLength(8);
      for (const row of witnesses) expect(row).toMatchObject({ same_work: true, same_mapping: true, witnessed: true, database_order: true });
    } finally {
      fetch.mockRestore();
      if (target) await refresh.configure({ ...configuration, expectedRevision: target.configurationRevision,
        expiresAt: new Date(Date.now() + 60_000).toISOString(), paused: true });
    }
  }, 840_000);

  it('denies applicability activation and immutable history writes through actual restricted roles', async () => {
    expect(roleFixture).toBeTruthy(); expect(roleCapture).toBeTruthy();
    const before = await retained(roleFixture);
    const signature = 'public.activate_league_configuration_component(uuid,text,text,smallint,smallint,text,bigint)';
    await expect(connection.database.query(`SELECT public.activate_league_configuration_component($1::uuid,'competition',
      'regular',1::smallint,18::smallint,'unprivileged CP9 request',0::bigint)`, [roleCapture.configuration.result.versionId]))
      .rejects.toThrow(/permission denied/);
    for (const table of ['league_configuration_activations', 'league_native_period_calendar_evidence']) {
      await expect(connection.database.query(`DELETE FROM public.${table} WHERE league_season_id=$1`, [roleFixture.leagueSeasonId])).rejects.toThrow(/permission denied/);
      expect(await ownerQuery(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS write`, ['public.' + table]))
        .toEqual([{ read: true, write: false }]);
      await expect(ownerQuery(`DELETE FROM public.${table} WHERE league_season_id=$1`, [roleFixture.leagueSeasonId])).rejects.toThrow(/immutable|history/);
    }
    const owner = await createPinnedIntegrationDatabase('owner');
    try {
      await owner.database.query('BEGIN');
      await owner.database.query(await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'));
      expect(await owner.database.query(`SELECT has_function_privilege('league_one_runtime',$1,'EXECUTE') AS runtime,
        has_function_privilege('league_one_auth',$1,'EXECUTE') AS auth`, [signature])).toEqual([{ runtime: false, auth: false }]);
    } finally { await owner.database.query('ROLLBACK'); await owner.close(); }
    expect(await retained(roleFixture)).toEqual(before);
    await storedOnly((_database, store) => read(roleFixture.mapping, roleCapture.selection, store));
  }, 60_000);
});
