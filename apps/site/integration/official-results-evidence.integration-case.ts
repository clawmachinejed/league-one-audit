import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import type { BracketFamily } from '../lib/aggregator/playoff-brackets';
import { projectOfficialStandings } from '../lib/aggregator/official-standings';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from '../lib/league-administration/store';
import { runPublicIntakeStep, runPublicDataRefreshStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
import { PUBLIC_INTAKE_JOB, PUBLIC_PLAYOFF_BRACKETS } from '../lib/league-administration/public-intake-contracts';
import { createProjectionStore } from '../lib/projection-store';
import retainedSource from '../test-support/fixtures/cp13-live-source-2026/source.json';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

const numericId = () => '7' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const sourceDigest = (value: string) => createHash('sha256').update(value).digest('hex');

/** AUTHORED / SQL-UNQUALIFIED. One60s case + one1080s case + two120s hooks
 * =23min authored allowance, not measured fit. The first case replays minimized
 * real source evidence with synthetic enrollment/fences and no intake witness.
 * The second uses synthetic responses through ordinary public owners:14 admissions,
 * 20 GET attempts, two failed stages and their backoffs, plus zero-GET settlement.
 * No exact-period/catalog acquisition or positive live-provider finality/series proof.
 * Existing20s operation,60s admission,30/40/50min work/lifecycle/CI limits stay fixed. */
describe.sequential('retained official standings and ordinary recovery through restricted PostgreSQL', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationStore>;
  const jobsToClose: string[] = [];
  beforeAll(async () => {
    connection = createIndependentDatabase(); administration = createLeagueAdministrationStore(connection.database);
    expect((await connection.database.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb
      FROM pg_roles WHERE rolname=current_user`))[0]).toEqual({ current_user: 'league_one_runtime',
      session_user: 'league_one_runtime', rolsuper: false, rolcreaterole: false, rolcreatedb: false });
  }, 120_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      if (jobsToClose.length) await ownerQuery(`UPDATE projection_jobs SET state='failed',lease_owner=NULL,
        lease_until=NULL,completed_at=clock_timestamp() WHERE job_key=ANY($1::text[])`, [jobsToClose]);
      const until = Date.now() + 85_000;
      while (true) {
        const [row] = await connection.database.query(`SELECT
          NOT EXISTS(SELECT 1 FROM public_data_dispatches WHERE admitted_at>clock_timestamp()-interval '60 seconds')
          AND NOT EXISTS(SELECT 1 FROM projection_jobs WHERE job_key=$1
            AND (state='running' OR completed_at>clock_timestamp()-interval '60 seconds')) AS ready`, [PUBLIC_INTAKE_JOB]);
        if (row.ready === true) break;
        if (Date.now() >= until) throw new Error('CP13 evidence shared minute cleanup did not settle.');
        await delay(250);
      }
    } finally { await connection.close(); }
  }, 120_000);

  async function retainedFixture(external: string) {
    // Registration supplies identity only. Missing scoring in the retained slice
    // is not replaced by a fabricated calculation profile or population proof.
    const registered = await createProjectionStore(connection.database).registerLeagueSeason({ mode: 'official-data',
      leagueKey: 'cp13-evidence-' + randomUUID(), leagueName: 'CP13 retained source replay', season: 2026,
      sleeperLeagueId: external });
    if (registered.kind !== 'stored') throw new Error('CP13 retained fixture registration unavailable.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','CP13 retained replay prerequisite')", [registered.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','CP13 retained replay prerequisite')", [registered.value.leagueId]);
    const mapping = await administration.readSourceMapping(external);
    if (!mapping) throw new Error('CP13 retained mapping unavailable.');
    expect(mapping.scope).toMatchObject({ externalLeagueId: external, provider: 'sleeper', season: 2026 });
    return mapping;
  }
  async function fence(): Promise<AdministrationWriteFence> {
    const jobKey = 'cp13-evidence-' + randomUUID(), workerId = randomUUID(); jobsToClose.push(jobKey);
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
      VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '25 seconds',1)`, [jobKey, workerId]);
    const [clock] = await connection.database.query("SELECT clock_timestamp()+interval '20 seconds' AS at");
    return { jobKey, workerId, generation: 1, deadlineAt: exactMatchupClockInstant(clock.at) };
  }
  async function standings(mapping: AdministrationSourceMapping, receipt?: string,
    store = administration) {
    const value = await store.readOfficialStandings!(mapping, receipt ? { rosterReceiptId: receipt } : {});
    expect(value.status).toBe('available');
    if (value.status !== 'available') throw new Error('CP13 evidence standings unavailable.');
    return value;
  }
  async function bracket(mapping: AdministrationSourceMapping, family: BracketFamily, receipt?: string,
    store = administration) {
    const value = await store.readAcceptedBracket!(mapping, { family, ...(receipt ? { bracketReceiptId: receipt } : {}) });
    expect(value.status).toBe('available');
    if (value.status !== 'available') throw new Error('CP13 evidence bracket unavailable.');
    return value;
  }
  async function storedOnly<T>(body: (database: DatabaseClient, store: ReturnType<typeof createLeagueAdministrationStore>) => Promise<T>) {
    const statements: string[] = [], fetch = vi.mocked(globalThis.fetch), calls = fetch.mock.calls.length;
    const database: DatabaseClient = { enabled: true,
      query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        statements.push(sql); expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu);
        return connection.database.query<Row>(sql, parameters, options);
      } };
    const result = await body(database, createLeagueAdministrationStore(database));
    expect(fetch.mock.calls).toHaveLength(calls); expect(statements.length).toBeGreaterThan(0);
    return result;
  }

  it('replays retained 2026 standings without refreshing source clocks or claiming membership', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Retained evidence must not fetch.'));
    try {
      const source = await readFile(new URL('../test-support/fixtures/cp13-live-source-2026/source.json', import.meta.url), 'utf8');
      expect(sourceDigest(source.replace(/\r\n/gu, '\n'))).toBe('a50f6085548815519f77f1be1be8c4e0fd12acbfdd7ae7a023ab451361fbad0d');
      expect(JSON.parse(source)).toEqual(retainedSource);
      expect(retainedSource.acquisition).toMatchObject({ manifestSha256: '85ab60e5e4e5e785342122d6147520d14aac21859d1b6b5bea3391988818155a',
        priorNetworkRequests: 1, resumedNetworkRequests: 24, totalNetworkRequests: 25 });
      expect(retainedSource.samples.map(sample => [sample.key, sample.externalLeagueId, sample.resources.rosters.document.payload.length]))
        .toEqual([['league1', '1378850182409490432', 12], ['league2', '1378850360529014784', 12],
          ['dynasty', '1312138224994385920', 10], ['keeper-sample', '1395875117568913408', 12],
          ['redraft-sample', '1398809418962898944', 12]]);
      const identities = new Set<string>(); let teams = 0, slices = 0;
      for (const sample of retainedSource.samples) {
        for (const [family, resource] of Object.entries(sample.resources)) {
          const document = resource.document;
          const suffix = family === 'league' ? '' : '/' + family + (document.week === null ? '' : '/' + document.week);
          expect(resource.source.endpoint).toBe('https://api.sleeper.app/v1/league/' + sample.externalLeagueId + suffix);
          expect(resource.source.responseUrl).toBe(resource.source.endpoint);
          expect(resource.source.httpStatus).toBe(200);
          expect(sourceDigest(JSON.stringify(document))).toBe(resource.sliceSha256);
          expect(document.origin).toBe('network'); expect(document.sourceObservedAt).toBe(document.requestCompletedAt);
          expect(Date.parse(document.requestStartedAt)).toBeLessThanOrEqual(Date.parse(document.requestCompletedAt)); slices++;
        }
        const document = sample.resources.rosters.document;
        expect(sample.resources.league.document.payload).toMatchObject({ league_id: sample.externalLeagueId, sport: 'nfl', season: '2026' });
        for (const row of document.payload) {
          expect(row.league_id).toBe(sample.externalLeagueId);
          expect(Object.keys(row)).toEqual(['league_id', 'roster_id', 'settings']);
        }
        const mapping = await retainedFixture(sample.externalLeagueId), workFence = await fence();
        const attempt = await administration.beginRosterAttempt(mapping, randomUUID(), undefined, workFence);
        const [clock] = await connection.database.query('SELECT clock_timestamp() AS at');
        const checkedAt = exactMatchupClockInstant(clock.at);
        const input = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
          normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope,
          family: 'rosters', week: null, completeness: 'complete', payload: document.payload,
          provenance: { origin: document.origin as 'network', requestStartedAt: document.requestStartedAt,
            requestCompletedAt: document.requestCompletedAt, sourceObservedAt: document.sourceObservedAt, checkedAt } });
        // The existing low-level CP13 writer accepts independent typed facts on a
        // newly recorded receipt. No acquisition witness, fresh source clock,
        // count evidence, or players/managers acceptance is manufactured here.
        const projection = projectOfficialStandings(input);
        const rows = await connection.database.query('SELECT public.record_league_administration_observation($1::jsonb) AS result',
          [JSON.stringify({ ...input, sourceMapping: mapping, writeFence: workFence,
            rosterAcceptance: { attempt }, officialStandings: projection })]);
        expect(rows).toHaveLength(1);
        expect(rows[0].result).toMatchObject({ rosterAcceptance: { status: 'preserved' }, officialStandings: { status: 'recorded' } });
        await storedOnly(async (database, store) => {
          const value = await standings(mapping, undefined, store);
          expect(value.capture.provenance).toEqual(input.envelope.provenance);
          expect(value.capture.provenance).not.toHaveProperty('acquisition');
          expect(value.capture).toMatchObject({ expectedTeamCount: null, configurationContentId: null, attemptId: attempt.id });
          expect(value).toMatchObject({ freshness: 'unknown', historicalApplicability: 'unverified', coverage: {
            population: 'unproved', entitySet: 'unknown', recordCompleteness: 'complete', reasons: ['standings_population_unproved'] } });
          expect(value.teams.map(({ seasonTeamId, ...team }) => {
            expect(identities.has(seasonTeamId)).toBe(false); identities.add(seasonTeamId); return team;
          })).toEqual(projection.teams);
          for (const [index, native] of document.payload.entries()) {
            const team = value.teams[index];
            expect(team.externalRosterId).toBe(String(native.roster_id)); expect(team.sourceOrdinal).toBe(index);
            for (const field of ['wins', 'losses', 'ties'] as const) expect(team.record[field]).toEqual({
              state: 'known', value: native.settings[field], sourcePath: 'settings.' + field });
            expect(team.pointsFor).toMatchObject({ state: 'known', whole: { value: native.settings.fpts },
              fraction: { value: native.settings.fpts_decimal } });
            expect(team.pointsAgainst).toMatchObject({ state: 'known', whole: { value: native.settings.fpts_against },
              fraction: { value: native.settings.fpts_against_decimal } });
            // Independent exact decimal oracle, rather than only TS/SQL projector agreement.
            for (const [field, whole, fraction] of [['pointsFor', 'fpts', 'fpts_decimal'],
              ['pointsAgainst', 'fpts_against', 'fpts_against_decimal']] as const) {
              const hundredths = BigInt(native.settings[whole]) * 100n + BigInt(native.settings[fraction]);
              const decimal = (hundredths / 100n).toString() + '.' + (hundredths % 100n).toString().padStart(2, '0');
              expect(team[field].value).toBe(decimal.replace(/\.?0+$/u, ''));
            }
            expect(Object.hasOwn(native.settings, 'rank')).toBe(false); expect(Object.hasOwn(native.settings, 'seed')).toBe(false);
            expect(team.providerRank.state).toBe('absent'); expect(team.providerSeed.state).toBe('absent');
          }
          expect(await database.query(`SELECT content.payload,marker.intake_id,marker.worker_id,marker.generation,
            receipt.provenance->>'requestStartedAt'=$2 AS original_start,
            receipt.provenance->>'requestCompletedAt'=$3 AS original_end,
            receipt.provenance->>'sourceObservedAt'=$3 AS original_observed,
            (receipt.provenance->>'requestStartedAt')::timestamptz<attempt.reserved_at AS retained_source,
            receipt.recorded_at>=attempt.reserved_at AS newly_recorded
            FROM league_official_standings_captures marker
            JOIN league_roster_capture_receipts receipt ON receipt.id=marker.receipt_id
            JOIN league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
            JOIN league_administration_contents content ON content.id=marker.content_id WHERE marker.receipt_id=$1`,
          [value.capture.rosterReceiptId, document.requestStartedAt, document.requestCompletedAt])).toEqual([{
            payload: document.payload, intake_id: null, worker_id: null, generation: null,
            original_start: true, original_end: true, original_observed: true, retained_source: true, newly_recorded: true }]);
          expect(await database.query(`SELECT count(*)::integer AS count FROM league_official_standings_teams fact
            JOIN league_season_teams team ON team.id=fact.season_team_id AND team.league_season_id=$2
              AND team.external_league_id=$3 AND team.external_roster_id=fact.external_roster_id WHERE fact.content_id=$1`,
          [value.capture.contentId, mapping.leagueSeasonId, sample.externalLeagueId])).toEqual([{ count: document.payload.length }]);
          expect((await store.readAcceptedCurrentRoster(mapping)).status).not.toBe('available');
          expect((await store.readAcceptedTeamManagers(mapping)).status).not.toBe('available');
          expect(await standings(mapping, value.capture.rosterReceiptId, store)).toEqual({ ...value, selection: 'receipt' });
          teams += value.teams.length;
        });
      }
      expect(slices).toBe(25); expect(teams).toBe(58); expect(identities.size).toBe(58);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  }, 60_000);

  it('preserves accepted membership and exact historical brackets through ordinary refresh failures and recovery', async () => {
    const id = randomUUID(), username = 'cp13e_' + randomUUID().replaceAll('-', ''), manager = numericId(), external = numericId();
    const league = { league_id: external, season: '2026', sport: 'nfl', name: 'CP13 synthetic recovery league', total_rosters: 2,
      roster_positions: ['QB', 'BN'], scoring_settings: { rec: 0.5 },
      settings: { type: 0, playoff_week_start: 15, playoff_teams: 2, playoff_round_type: 2 } };
    const originalPlayers = [numericId(), numericId()], correctedPlayers = [numericId(), numericId()], urls: string[] = [];
    let correction = false, failLosers = false, malformedCore = false, admissions = 0, claims = 0;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url); const base = 'https://api.sleeper.app/v1/league/' + external;
      if (url === 'https://api.sleeper.app/v1/user/' + username || url === 'https://api.sleeper.app/v1/user/' + manager)
        return new Response(JSON.stringify({ user_id: manager, username }));
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return new Response(JSON.stringify([league]));
      if (url === base) return new Response(JSON.stringify(league));
      if (url === base + '/winners_bracket') return new Response(JSON.stringify([{ m: 1, r: 1, t1: 1, t2: 2,
        w: correction ? 2 : 1, l: correction ? 1 : 2 }]));
      if (url === base + '/losers_bracket') return failLosers ? new Response('{}', { status: 503 }) : new Response(correction ? '[]' : 'null');
      if (url === base + '/rosters') return new Response(JSON.stringify([1, 2].map((roster_id, index) => ({ roster_id,
        owner_id: malformedCore ? { malformed: true } : index === (correction ? 1 : 0) ? manager : null, co_owners: [],
        players: malformedCore ? null : [(correction ? correctedPlayers : originalPlayers)[index]],
        starters: [(correction ? correctedPlayers : originalPlayers)[index]], reserve: [], taxi: [],
        settings: { wins: correction ? 5 : 4, losses: 1, ties: 0, fpts: 512, fpts_decimal: correction ? 35 : 34,
          fpts_against: 400, fpts_against_decimal: 0 },
      }))));
      if (url === base + '/users') return new Response(JSON.stringify([{ user_id: manager, display_name: username }]));
      throw new Error('Unexpected CP13 evidence synthetic acquisition: ' + url);
    });
    const intake = createPublicIntakeStore(connection.database), refresh = createPublicDataRefreshStore(connection.database),
      jobs = createProjectionStore(connection.database);
    const dependencies: PublicIntakeDependencies = { intake: { ...intake, admit: async (...args) => {
      const admitted = await intake.admit(...args); if (admitted) admissions++; return admitted;
    } }, administration, jobs: { ...jobs, acquireJob: async (...args) => {
      const claim = await jobs.acquireJob(...args); if (claim.kind === 'acquired') claims++; return claim;
    } } };
    const zeroRequestClaims = { bracketRecovery: 0, coreRecovery: 0, settlement: 0 };
    async function step(recurring: boolean, zeroRequestPhase?: keyof typeof zeroRequestClaims) {
      const before = { claims, admissions, requests: urls.length };
      const outcome = recurring ? await runPublicDataRefreshStep({ ...dependencies, refresh }, AbortSignal.timeout(20_000))
        : await runPublicIntakeStep(id, dependencies, AbortSignal.timeout(20_000));
      const acquired = claims - before.claims, admitted = admissions - before.admissions;
      expect([0, 1]).toContain(acquired); expect([0, 1]).toContain(admitted);
      expect(urls.length - before.requests).toBe(outcome.providerRequests);
      if (acquired === 0) {
        expect(admitted).toBe(0); expect(outcome).toEqual({ status: 'busy', providerRequests: 0 });
      } else if (admitted === 0) {
        expect(outcome).toEqual({ status: 'backoff', providerRequests: 0 });
        if (!zeroRequestPhase) throw new Error('Unexpected CP13 evidence zero-request owner claim.');
        zeroRequestClaims[zeroRequestPhase]++; expect(zeroRequestClaims[zeroRequestPhase]).toBeLessThanOrEqual(1);
      } else { expect(acquired).toBe(1); expect(outcome.providerRequests).toBeGreaterThan(0); }
      return outcome;
    }
    async function progress(recurring: boolean, resource: string, status = 'progress', recovery?: 'bracketRecovery' | 'coreRecovery') {
      const until = Date.now() + 150_000;
      do {
        const outcome = await step(recurring, recovery);
        if (['busy', 'backoff', 'idle'].includes(outcome.status)) { await delay(1_000); continue; }
        expect(outcome).toMatchObject({ status, resource, providerRequests: ['core', 'playoff-brackets'].includes(resource) ? 2 : 1 }); return;
      } while (Date.now() < until);
      throw new Error('CP13 evidence stage exceeded existing admission allowance.');
    }
    const configuration = { id: randomUUID(), expectedRevision: 0, identityRequestId: id, seasons: [2026],
      playoffBrackets: PUBLIC_PLAYOFF_BRACKETS, cadenceSeconds: 3600,
      expiresAt: new Date(Date.now() + 25 * 60_000).toISOString(), paused: false };
    let target: { targetId: string; configurationRevision: number } | undefined;
    try {
      await intake.submit({ id, username, seasons: [2026], playoffBrackets: PUBLIC_PLAYOFF_BRACKETS });
      for (const resource of ['identity', 'leagues', 'bootstrap', 'playoff-brackets', 'core', 'users']) await progress(false, resource);
      expect(admissions).toBe(6); expect(urls).toHaveLength(8); expect(await intake.next(id)).toBe('complete');
      const mapping = await administration.readSourceMapping(external); if (!mapping) throw new Error('CP13 evidence ordinary mapping unavailable.');
      const original = await readPublicSleeperIntake(connection.database, administration, id, { officialResultsVersion: 'v1' });
      expect(original).toMatchObject({ status: 'available', officialResults: [{ resource: { status: 'available', periods: [],
        standings: { status: 'available', coverage: { population: 'proven', entitySet: 'full', recordCompleteness: 'complete' } } } }] });
      if (original.status === 'missing' || !original.officialResults) throw new Error('CP13 evidence original result missing.');
      const originalResults = original.officialResults, originalBrackets = original.brackets, originalStandings = await standings(mapping);
      const originalRoster = await administration.readAcceptedCurrentRoster(mapping);
      const originalManagers = await administration.readAcceptedTeamManagers(mapping);
      if (originalRoster.status !== 'available' || originalManagers.status !== 'available') throw new Error('CP13 evidence predecessor membership unavailable.');
      expect(originalRoster.teams.flatMap(team => team.players.map(player => player.sourceEntity.nativeId)).sort()).toEqual([...originalPlayers].sort());
      expect(originalManagers.teams.map(team => team.primaryOwner.state)).toEqual(['owned', 'unowned']);
      const oldWinner = await bracket(mapping, 'winners_bracket', (await bracket(mapping, 'winners_bracket')).bracketReceiptId);
      const oldLoser = await bracket(mapping, 'losers_bracket', (await bracket(mapping, 'losers_bracket')).bracketReceiptId);
      target = await refresh.configure(configuration); correction = true;
      for (const resource of ['identity', 'leagues', 'bootstrap']) await progress(true, resource);
      const pending = await readPublicDataRefresh(connection.database, administration, target.targetId, { officialResultsVersion: 'v1' });
      if (pending.status !== 'available' || !pending.cycle) throw new Error('CP13 evidence refresh cycle missing.');
      const currentId = pending.cycle.requestId; expect(currentId).not.toBe(id); expect(pending.cycle.outcome).toBeNull();

      failLosers = true; await progress(true, 'playoff-brackets', 'unavailable'); failLosers = false;
      expect(await intake.next(currentId)).toBe('backoff');
      await storedOnly(async (database, store) => {
        const current = await readPublicDataRefresh(database, store, target!.targetId, { officialResultsVersion: 'v1' });
        expect(current).toMatchObject({ status: 'available', cycle: { requestId: currentId, outcome: null }, intake: { status: 'pending',
          brackets: [{ collection: 'pending', failureCount: 1, resource: { status: 'unavailable', reason: 'bracket-capture-not-complete' }, acquisition: null }],
          officialResults: [{ acquisition: null, resource: { status: 'available', periods: [],
            standings: { status: 'unavailable', reason: 'intake-core-not-dispatched' }, brackets: [
              { family: 'winners_bracket', resource: { status: 'unavailable' }, reportedResults: [] },
              { family: 'losers_bracket', resource: { status: 'unavailable' }, reportedResults: [] },
            ] } }] } });
        expect(await database.query('SELECT status,failure_count FROM public_data_bracket_tasks WHERE intake_id=$1', [currentId]))
          .toEqual([{ status: 'pending', failure_count: 1 }]);
        expect(await database.query('SELECT winners_bracket_receipt_id,losers_bracket_receipt_id FROM public_data_bracket_checkpoints WHERE intake_id=$1', [currentId])).toEqual([]);
        const newWinner = await bracket(mapping, 'winners_bracket', undefined, store);
        expect(newWinner.bracketReceiptId).not.toBe(oldWinner.bracketReceiptId);
        expect(newWinner.value.matches[0].winner).toMatchObject({ state: 'supplied', value: '2' });
        expect(await bracket(mapping, 'losers_bracket', undefined, store)).toEqual({ ...oldLoser, selection: 'current' });
        const old = await readPublicSleeperIntake(database, store, id, { officialResultsVersion: 'v1' });
        if (old.status === 'missing') throw new Error('CP13 evidence old request missing.');
        expect(old.brackets).toEqual(originalBrackets); expect(old.officialResults).toEqual(originalResults);
        expect(await bracket(mapping, 'winners_bracket', oldWinner.bracketReceiptId, store)).toEqual(oldWinner);
        expect(await bracket(mapping, 'losers_bracket', oldLoser.bracketReceiptId, store)).toEqual(oldLoser);
      });
      await progress(true, 'playoff-brackets', 'progress', 'bracketRecovery');
      malformedCore = true; await progress(true, 'core', 'unavailable'); malformedCore = false;
      expect(await intake.next(currentId)).toBe('backoff');
      const failedStandings = await standings(mapping);
      expect(failedStandings.capture.rosterReceiptId).not.toBe(originalStandings.capture.rosterReceiptId);
      expect(failedStandings).toMatchObject({ coverage: { population: 'proven', entitySet: 'full', recordCompleteness: 'complete' },
        teams: [{ record: { wins: { value: 5 } }, pointsFor: { value: '512.35' } }, { pointsFor: { value: '512.35' } }] });
      await storedOnly(async (database, store) => {
        expect(await store.readAcceptedCurrentRoster(mapping)).toEqual(originalRoster);
        expect(await store.readAcceptedTeamManagers(mapping)).toEqual(originalManagers);
        expect(await database.query(`SELECT candidate.stage,candidate.players_receipt_id,candidate.managers_receipt_id,
          request.failure_count,request.next_attempt_at>clock_timestamp() AS retry_pending,request.terminal
          FROM public_data_intakes request JOIN public_data_league_candidates candidate ON candidate.intake_id=request.id
          WHERE request.id=$1 AND candidate.external_league_id=$2`, [currentId, external]))
          .toEqual([{ stage: 'core', players_receipt_id: null, managers_receipt_id: null, failure_count: 1, retry_pending: true, terminal: false }]);
        const current = await readPublicDataRefresh(database, store, target!.targetId, { officialResultsVersion: 'v1' });
        expect(current).toMatchObject({ cycle: { requestId: currentId, outcome: null }, intake: { status: 'pending',
          leagues: [{ collection: 'core', resources: {
            heldRoster: { status: 'unavailable', reason: 'intake-capture-not-current-head', retained: originalRoster },
            teamManagers: { status: 'unavailable', reason: 'intake-capture-not-current-head', retained: originalManagers },
          } }], brackets: [{ collection: 'complete', resource: { status: 'available' } }],
          officialResults: [{ acquisition: { requestId: currentId, rosterReceiptId: failedStandings.capture.rosterReceiptId },
            resource: { standings: { ...failedStandings, selection: 'receipt' }, periods: [] } }] } });
        expect(await standings(mapping, originalStandings.capture.rosterReceiptId, store)).toEqual({ ...originalStandings, selection: 'receipt' });
      });
      await progress(true, 'core', 'progress', 'coreRecovery'); await progress(true, 'users');
      expect(admissions).toBe(14); expect(urls).toHaveLength(20);
      const until = Date.now() + 150_000;
      while (true) {
        const outcome = await step(true, 'settlement');
        if (outcome.status === 'busy') { if (Date.now() >= until) throw new Error('CP13 evidence settlement exceeded admission allowance.'); await delay(1_000); continue; }
        expect(outcome.providerRequests).toBe(0); break;
      }
      expect(zeroRequestClaims.settlement).toBe(1);
      expect(admissions).toBe(14); expect(claims).toBe(15 + zeroRequestClaims.bracketRecovery + zeroRequestClaims.coreRecovery);
      const base = 'https://api.sleeper.app/v1/league/' + external, pair = [base + '/winners_bracket', base + '/losers_bracket'];
      expect(urls).toEqual(['https://api.sleeper.app/v1/user/' + username, 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026',
        base, ...pair, base, base + '/rosters', base + '/users',
        'https://api.sleeper.app/v1/user/' + manager, 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026',
        base, ...pair, ...pair, base, base + '/rosters', base, base + '/rosters', base + '/users']);
      expect(await intake.next(currentId)).toBe('complete');
      await storedOnly(async (database, store) => {
        const current = await readPublicDataRefresh(database, store, target!.targetId, { officialResultsVersion: 'v1' });
        expect(current).toMatchObject({ status: 'available', cycle: { requestId: currentId, outcome: { disposition: 'complete' } },
          intake: { status: 'available', brackets: [{ collection: 'complete', resource: { status: 'available' } }], officialResults: [{ resource: {
            status: 'available', periods: [], standings: { status: 'available', coverage: { population: 'proven', entitySet: 'full' } },
            brackets: [{ family: 'winners_bracket', reportedResults: [{ winner: { value: '2' }, loser: { value: '1' }, finality: { status: 'provider-reported-played', reason: 'bracket_outcomes_match_resolved_entrants' } }] },
              { family: 'losers_bracket', resource: { value: { publication: 'published', matches: [] } }, reportedResults: [] }],
          } }] } });
        const roster = await store.readAcceptedCurrentRoster(mapping), managers = await store.readAcceptedTeamManagers(mapping);
        if (roster.status !== 'available' || managers.status !== 'available') throw new Error('CP13 evidence recovered membership unavailable.');
        expect(roster.receipt.id).not.toBe(originalRoster.receipt.id); expect(managers.receipt.id).not.toBe(originalManagers.receipt.id);
        expect(roster.accepted.acceptedGeneration).toBe(originalRoster.accepted.acceptedGeneration + 1);
        expect(managers.accepted.acceptedGeneration).toBe(originalManagers.accepted.acceptedGeneration + 1);
        expect(roster.teams.flatMap(team => team.players.map(player => player.sourceEntity.nativeId)).sort()).toEqual([...correctedPlayers].sort());
        expect(managers.teams.map(team => team.primaryOwner.state)).toEqual(['unowned', 'owned']);
        const recovered = await standings(mapping, undefined, store);
        expect(recovered.capture.rosterReceiptId).not.toBe(failedStandings.capture.rosterReceiptId);
        expect(await standings(mapping, failedStandings.capture.rosterReceiptId, store)).toEqual({ ...failedStandings, selection: 'receipt' });
        expect(await standings(mapping, originalStandings.capture.rosterReceiptId, store)).toEqual({ ...originalStandings, selection: 'receipt' });
        const old = await readPublicSleeperIntake(database, store, id, { officialResultsVersion: 'v1' });
        if (old.status === 'missing') throw new Error('CP13 evidence old request disappeared.');
        expect(old.officialResults).toEqual(originalResults); expect(old.brackets).toEqual(originalBrackets);
        expect(await bracket(mapping, 'winners_bracket', oldWinner.bracketReceiptId, store)).toEqual(oldWinner);
        expect(await bracket(mapping, 'losers_bracket', oldLoser.bracketReceiptId, store)).toEqual(oldLoser);
        expect(await readPublicSleeperIntake(database, store, currentId)).not.toHaveProperty('officialResults');
      });
      const [spacing] = await connection.database.query(`SELECT count(*)::integer AS count,
        bool_and(history.previous IS NULL OR history.admitted_at-history.previous>=interval '60 seconds') AS spaced
        FROM(SELECT dispatch.admitted_at,lag(dispatch.admitted_at) OVER(ORDER BY dispatch.admitted_at) AS previous
          FROM public_data_dispatches dispatch WHERE dispatch.intake_id=ANY($1::uuid[])) history`, [[id, currentId]]);
      expect(spacing).toEqual({ count: 14, spaced: true });
      const markers = await connection.database.query(`SELECT marker.receipt_id,
        receipt.provenance->'acquisition'->'work'=dispatch.work
          AND receipt.provenance->'acquisition'->>'dispatchNonce'=dispatch.capture_nonce::text
          AND receipt.provenance->'acquisition'->'fence'=attempt.write_fence AS witnessed,
        attempt.reserved_at>=dispatch.admitted_at AND receipt.recorded_at>=attempt.reserved_at AS database_order
        FROM league_official_standings_captures marker
        JOIN league_roster_capture_receipts receipt ON receipt.id=marker.receipt_id
        JOIN league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
        JOIN public_data_dispatches dispatch ON dispatch.intake_id=marker.intake_id
          AND dispatch.worker_id=marker.worker_id AND dispatch.generation=marker.generation
        WHERE marker.intake_id=ANY($1::uuid[])`, [[id, currentId]]);
      expect(markers).toHaveLength(3); for (const row of markers) expect(row).toMatchObject({ witnessed: true, database_order: true });
      expect(fetch).toHaveBeenCalledTimes(20);
    } finally {
      fetch.mockRestore();
      if (target) await refresh.configure({ ...configuration, expectedRevision: target.configurationRevision,
        expiresAt: new Date(Date.now() + 60_000).toISOString(), paused: true });
    }
  }, 1_080_000);
});
