import { createHash, randomUUID } from 'node:crypto';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { installAllPlayerScheduleTestClock } from './all-player-schedule-test-clock';
import { createPublicInventoryDiagnostics, type InventoryDiagnosticKind } from './public-data-inventory-diagnostics';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createIndependentDatabase, createPinnedIntegrationDatabase, createReceiptDiagnosticReader, ownerQuery, prepareIntegrationDatabase, type IndependentDatabase } from './neon-integration-harness';
import { createProjectionStore } from '../lib/projection-store';
import { createPublicIntakeStore, createPublicDataRefreshStore, createLeagueAdministrationStore } from '../lib/league-administration/store';
import { runPublicIntakeStep, runPublicDataRefreshStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
import { recordCapturedAdministration } from '../lib/league-administration/runtime';
import { PUBLIC_INTAKE_JOB, type PublicIntakeWork } from '../lib/league-administration/public-intake-contracts';
import { capturePublicSleeperCore, capturePublicSleeperIdentity, capturePublicSleeperLeagueList } from '../lib/sleeper';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { PublicDataRefreshConfiguration } from '../lib/league-administration/public-refresh-contracts';
import { createPublicDataDiagnostics, observePublicDataDependencies } from './public-data-refresh-diagnostics';
import { assertOriginalPublicCapture, validateRequestedPublicCaptureWitness, type PublicCaptureWitness } from '../lib/league-administration/public-capture-witness';


/** AUTHORED / UNEXECUTED ordinary journey. Only source responses are fixtures;
 * every admission, bootstrap, typed write and read uses the existing runtime LOGIN path. */
describe('ordinary public DATA ingestion through the existing intake owner', () => {
  let ordinaryConnection: IndependentDatabase;
  beforeAll(() => { ordinaryConnection = createIndependentDatabase(); });
  afterAll(async () => ordinaryConnection.close());
  it('stores one public manager league through canonical bootstrap and typed backend readers [focused slow SQL]', async () => {
    const diagnostics = createPublicDataDiagnostics('ordinary');
    let restoreFetch: (() => void) | undefined;
    try {
      const database = ordinaryConnection.database;
      const [runtimeSession] = await database.query("SELECT session_user AS role,current_user AS effective_role," +
        "current_setting('server_version') AS server_version,current_setting('server_version_num') AS server_version_num");
      diagnostics.assertion('runtime-role', () => {
        diagnostics.comparison('runtime.roles', { role: runtimeSession.role, effective_role: runtimeSession.effective_role }, { role: 'league_one_runtime', effective_role: 'league_one_runtime' }, (actual, expected) => expect(actual).toEqual(expected));
      });
      diagnostics.recordDatabaseVersion(runtimeSession);
      const receiptReader = createReceiptDiagnosticReader();
      const id = randomUUID();
      const native = '8' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
      const manager = '9' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
      const coManager = '7' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
      const username = 'ordinary_manager_' + manager, season = 2195;
      const league = { league_id: native, season: String(season), sport: 'nfl', name: 'Ordinary unrelated DATA league',
        total_rosters: 1, settings: { divisions: 3 }, scoring_settings: {}, roster_positions: ['QB', 'BN'] };
      const roster = [{ roster_id: 1, owner_id: manager, co_owners: [coManager],
        players: ['123'], starters: ['123'], reserve: [], taxi: [] }];
      const base = 'https://api.sleeper.app/v1';
      const expectedUrls = [base + '/user/' + username, base + '/user/' + manager + '/leagues/nfl/' + season,
        base + '/league/' + native, base + '/league/' + native, base + '/league/' + native + '/rosters',
        base + '/league/' + native + '/users'];
      const requested: string[] = [];
      const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
        const url = String(input); requested.push(url);
        if (url === expectedUrls[0]) return new Response(JSON.stringify({ user_id: manager, username, display_name: 'Ordinary manager' }));
        if (url === expectedUrls[1]) return new Response(JSON.stringify([league]));
        if (url === expectedUrls[2]) return new Response(JSON.stringify(league));
        if (url === expectedUrls[4]) return new Response(JSON.stringify(roster));
        if (url === expectedUrls[5]) return new Response(JSON.stringify([
          { user_id: manager, display_name: 'Ordinary manager' }, { user_id: coManager, display_name: 'Ordinary co-manager' }]));
        throw new Error('Unexpected ordinary fixture source scope.');
      });
      restoreFetch = () => fetch.mockRestore();
      const captures: { family: string; capture: { requestStartedAt: string; requestCompletedAt: string;
        acquisition?: PublicCaptureWitness } }[] = [];
      const retained = <T extends { requestStartedAt: string; requestCompletedAt: string; acquisition?: PublicCaptureWitness }>(family: string, capture: T): T => {
        diagnostics.assertion('capture-witness', () => {
          diagnostics.comparison('capture.version', capture.acquisition?.version, 'public-network-capture-v1', (actual, expected) => expect(actual).toBe(expected));
        });
        captures.push({ family, capture }); return capture;
      };
      const intake = createPublicIntakeStore(database), administration = createLeagueAdministrationStore(database);
      const dependencies = observePublicDataDependencies(diagnostics, {
        intake, administration, jobs: createProjectionStore(database), managerEvidenceVersion: 'v2',
        source: { identity: async (...args) => retained('identity', await capturePublicSleeperIdentity(...args)),
          leagues: async (...args) => retained('leagues', await capturePublicSleeperLeagueList(...args)),
          core: async (id, family, signal, witness) => retained(family, await capturePublicSleeperCore(id, family, signal, undefined, witness)) },
      }, receiptReader);
      await intake.submit({ id, username, seasons: [season] });
      const stages = ['identity', 'leagues', 'bootstrap', 'core', 'users'];
      let completed = 0;
      const until = Date.now() + 9 * 60_000;
      while (completed < stages.length && Date.now() < until) {
        diagnostics.beginStep(1);
        const outcome = await runPublicIntakeStep(id, dependencies, AbortSignal.timeout(20_000));
        diagnostics.checkOutcome(outcome);
        if (outcome.status === 'busy' || outcome.status === 'backoff') { await delay(1_000); continue; }
        diagnostics.assertion('step-progress', () => {
          diagnostics.comparison('step.progress', outcome, { status: 'progress', resource: stages[completed], providerRequests: stages[completed] === 'core' ? 2 : 1 }, (actual, expected) => expect(actual).toMatchObject(expected));
        });
        completed++;
      }
      diagnostics.assertion('journey-complete', () => {
        diagnostics.comparison('journey.stage-count', completed, stages.length, (actual, expected) => expect(actual).toBe(expected));
      });
      const next = await intake.next(id);
      diagnostics.assertion('journey-next', () => { diagnostics.comparison('journey.next', next, 'complete', (actual, expected) => expect(actual).toBe(expected)); });
      diagnostics.assertion('fixture-requests', () => {
        diagnostics.comparison('fixture.urls', requested, expectedUrls, (actual, expected) => expect(actual).toEqual(expected));
        diagnostics.comparison('fixture.capture-count', captures, 6, (actual, expected) => expect(actual).toHaveLength(expected));
      });
      const read = await diagnostics.observe('reader.intake', () => readPublicSleeperIntake(database, administration, id, { managerEvidenceVersion: 'v2' }));
      diagnostics.assertion('intake-readback', () => {
        diagnostics.comparison('intake.readback', read, { status: 'available', request: { requested_username: username, external_manager_id: manager,
          username, seasons: [season], terminal: true, failure_count: 0 },
          lists: [{ season }], rejected: [], leagues: [{ externalLeagueId: native, season, collection: 'complete' }] }, (actual, expected) => expect(actual).toMatchObject(expected));
      });
      if (read.status === 'missing') throw new Error('Ordinary stored request missing.');
      diagnostics.assertion('intake-population', () => {
        diagnostics.comparison('intake.league-count', read.leagues, 1, (actual, expected) => expect(actual).toHaveLength(expected)); diagnostics.comparison('intake.list-count', read.lists, 1, (actual, expected) => expect(actual).toHaveLength(expected));
      });
      const mapping = await administration.readSourceMapping(native);
      if (!mapping) throw new Error('Ordinary canonical mapping missing.');
      const [canonical] = await database.query(
        'SELECT league.id AS league_id,season.id AS league_season_id,season.scoring_profile_id,connection.id AS connection_id,' +
        'connection.current_mapping_revision_id,enrollment.active,enrollment.evidence FROM public.leagues league ' +
        'JOIN public.league_seasons season ON season.league_id=league.id ' +
        'JOIN public.league_source_connections connection ON connection.league_season_id=season.id ' +
        'JOIN public.league_administration_enrollments enrollment ON enrollment.league_id=league.id ' +
        'WHERE connection.provider=$1 AND connection.external_league_id=$2 AND season.season=$3', ['sleeper', native, season]);
      diagnostics.assertion('canonical-identity', () => {
        diagnostics.comparison('canonical.identity', canonical, { league_season_id: mapping.leagueSeasonId, connection_id: mapping.connectionId,
          current_mapping_revision_id: mapping.revisionId, scoring_profile_id: null, active: false, evidence: 'public-data-intake-v1' }, (actual, expected) => expect(actual).toMatchObject(expected));
      });
      const uuid = (value: unknown): string => {
        diagnostics.comparison('uuid.shape', value, expect.stringMatching(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu), (actual, expected) => expect(actual).toEqual(expected));
        return value as string;
      };
      diagnostics.assertion('canonical-ids', () => {
        diagnostics.comparison('canonical.distinct-ids', new Set([canonical.league_id, canonical.league_season_id, canonical.connection_id].map(uuid)).size, 3, (actual, expected) => expect(actual).toBe(expected));
      });
      const enrollmentInventory = await administration.listEnrollmentInventory(season);
      diagnostics.assertion('enrollment-inventory', () => {
        diagnostics.comparison('enrollment.inactive', enrollmentInventory.entries.some(entry => entry.intended.leagueId === canonical.league_id), false, (actual, expected) => expect(actual).toBe(expected));
      });
      const settings = await diagnostics.observe('reader.settings', () => administration.readAcceptedLeagueSettings(mapping));
      const players = await diagnostics.observe('reader.players', () => administration.readAcceptedCurrentRoster(mapping));
      const managers = await diagnostics.observe('reader.managers', () => administration.readAcceptedTeamManagers(mapping));
      const coowners = await diagnostics.observe('reader.manager-evidence', async () => administration.readAcceptedTeamManagerEvidence?.(mapping));
      if (settings.status !== 'available' || players.status !== 'available' || managers.status !== 'available'
        || coowners?.status !== 'available') throw new Error('Ordinary typed stored resources missing.');
      diagnostics.assertion('settings-value', () => {
        diagnostics.comparison('settings.value', settings.value, { sourceLeague: { provider: 'sleeper', nativeId: native }, season,
          scoring: { rules: { state: 'empty', value: {} } }, nativeSettings: { fields: { state: 'known', value: league.settings } },
          slots: { state: 'known', value: [{ nativeCode: 'QB', count: 1 }, { nativeCode: 'BN', count: 1 }] } }, (actual, expected) => expect(actual).toMatchObject(expected));
      });
      diagnostics.assertion('team-counts', () => {
        diagnostics.comparison('players.team-count', players.teams, 1, (actual, expected) => expect(actual).toHaveLength(expected)); diagnostics.comparison('managers.team-count', managers.teams, 1, (actual, expected) => expect(actual).toHaveLength(expected)); diagnostics.comparison('manager-evidence.team-count', coowners.teams, 1, (actual, expected) => expect(actual).toHaveLength(expected));
      });
      diagnostics.assertion('players-value', () => {
        diagnostics.comparison('players.value', players.teams[0], { externalRosterId: '1', players: [{ sourceEntity: { provider: 'sleeper', nativeId: '123' } }] }, (actual, expected) => expect(actual).toMatchObject(expected));
      });
      diagnostics.assertion('managers-value', () => {
        diagnostics.comparison('managers.value', managers.teams[0], { sourceTeam: { nativeId: '1' },
          primaryOwner: { state: 'owned', manager: { sourceManager: { nativeId: manager } } },
          coManagers: { state: 'known', completeness: 'complete', managers: [{ sourceManager: { nativeId: coManager } }] } }, (actual, expected) => expect(actual).toMatchObject(expected));
      });
      diagnostics.assertion('manager-receipts', () => {
        diagnostics.comparison('managers.receipt-refs', managers.teams[0].coManagers.sourceRefs, [managers.receipt.id], (actual, expected) => expect(actual).toEqual(expected));
        diagnostics.comparison('manager-evidence.receipt-refs', coowners.teams[0].coManagers.sourceRefs, [coowners.receipt.id], (actual, expected) => expect(actual).toEqual(expected));
        diagnostics.comparison('manager-evidence.completeness', coowners.evidenceCompleteness, 'complete', (actual, expected) => expect(actual).toBe(expected));
      });
      diagnostics.assertion('manager-parity', () => {
        diagnostics.comparison('manager-evidence.parity', coowners.teams[0], { sourceTeam: managers.teams[0].sourceTeam, primaryOwner: managers.teams[0].primaryOwner,
          coManagers: { state: 'known', completeness: 'complete', managers: managers.teams[0].coManagers.managers } }, (actual, expected) => expect(actual).toMatchObject(expected));
      });
      const teamId = diagnostics.assertion('team-identities', () => uuid(players.teams[0].seasonTeamId));
      diagnostics.assertion('team-identities', () => {
        diagnostics.comparison('teams.identity-parity', [managers.teams[0].seasonTeamId, coowners.teams[0].seasonTeamId], [teamId, teamId], (actual, expected) => expect(actual).toEqual(expected));
      });
      const primary = managers.teams[0].primaryOwner, co = managers.teams[0].coManagers;
      if (primary.state !== 'owned' || co.state !== 'known') throw new Error('Ordinary manager relationships missing.');
      diagnostics.assertion('provider-manager-identities', () => {
        diagnostics.comparison('co-managers.count', co.managers, 1, (actual, expected) => expect(actual).toHaveLength(expected));
        diagnostics.comparison('managers.distinct-ids', new Set([uuid(primary.manager.providerManagerId), uuid(co.managers[0].providerManagerId)]).size, 2, (actual, expected) => expect(actual).toBe(expected));
      });
      const [candidate] = await database.query('SELECT * FROM public.public_data_league_candidates WHERE intake_id=$1', [id]);
      diagnostics.assertion('candidate', () => {
        diagnostics.comparison('candidate.fields', candidate, { stage: 'complete', season, external_league_id: native, league_season_id: mapping.leagueSeasonId,
          settings_receipt_id: settings.receipt.id, players_receipt_id: players.receipt.id, managers_receipt_id: managers.receipt.id,
          league_observation_id: settings.receipt.legacyObservationId, roster_observation_id: players.receipt.legacyObservationId }, (actual, expected) => expect(actual).toMatchObject(expected));
      });
      const receipts = [settings.receipt, players.receipt, managers.receipt, coowners.receipt];
      diagnostics.assertion('receipt-identities', () => {
        diagnostics.comparison('receipts.distinct-ids', new Set(receipts.map(receipt => uuid(receipt.id))).size, 4, (actual, expected) => expect(actual).toBe(expected));
      });
      // v2 is latest-for-mapping evidence, not a fourth receipt stored on the candidate.
      // Its retained attempt must independently name this exact admitted core dispatch.
      const lineage = await database.query(`SELECT receipt.id,receipt.provenance,receipt.population_evidence,attempt.source_mapping,
        dispatch.intake_id,dispatch.resource,
        attempt.capture_nonce IS NOT NULL AND dispatch.capture_nonce IS NOT NULL
          AND receipt.provenance->'acquisition'->>'dispatchNonce'=dispatch.capture_nonce::text
          AND receipt.provenance->'acquisition'->'work'=dispatch.work
          AND receipt.provenance->'acquisition'->'fence'=attempt.write_fence
          AND receipt.provenance->'acquisition'->'mapping'=attempt.source_mapping
          AND receipt.provenance->'acquisition'->'attempts'->CASE scope.identity->'policy'->>'canonicalNormalizerVersion'
            WHEN 'sleeper-league-settings-v1' THEN 'settings' WHEN 'sleeper-current-players-v1' THEN 'players'
            WHEN 'sleeper-current-team-managers-v1' THEN 'managers' ELSE 'managersV2' END
            =jsonb_build_object('id',attempt.id,'nonce',attempt.capture_nonce) AS exact_witness,
        attempt.reserved_at>=dispatch.admitted_at AND receipt.recorded_at>=attempt.reserved_at
          AND receipt.recorded_at<=dispatch.admitted_at+interval '30 seconds' AS server_window,
        EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
          JOIN public.league_roster_resource_heads head ON head.accepted_id=accepted.id AND head.scope_id=accepted.scope_id
          WHERE accepted.receipt_id=receipt.id AND accepted.generation=head.generation
            AND attempt.ordinal=head.latest_ordinal AND attempt.scope_id=head.scope_id) AS current_head ` +
        'FROM public.league_roster_capture_receipts receipt ' +
        'JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id ' +
        'JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id ' +
        "JOIN public.public_data_dispatches dispatch ON dispatch.worker_id=attempt.write_fence->>'workerId' " +
        "AND dispatch.generation=(attempt.write_fence->>'generation')::integer WHERE receipt.id=ANY($1::uuid[])",
      [receipts.map(receipt => receipt.id)]);
      diagnostics.assertion('lineage-count', () => {
        diagnostics.comparison('lineage.count', lineage, 4, (actual, expected) => expect(actual).toHaveLength(expected));
      });
      for (const receipt of receipts) {
        const original = captures.find(entry => entry.capture.acquisition?.work.kind === 'core'
          && entry.family === (receipt.id === settings.receipt.id ? 'league' : 'rosters'))!.capture;
        diagnostics.assertion('receipt-provenance', () => {
          diagnostics.comparison('receipt.provenance', receipt.provenance, { acquisition: original.acquisition,
            requestStartedAt: original.requestStartedAt, requestCompletedAt: original.requestCompletedAt,
            sourceObservedAt: original.requestCompletedAt }, (actual, expected) => expect(actual).toMatchObject(expected));
          diagnostics.comparison('receipt.acquisition', receipt.provenance.acquisition, original.acquisition, (actual, expected) => expect(actual).toEqual(expected));
        });
        diagnostics.assertion('receipt-witness', () => {
          diagnostics.comparison('lineage.witness', lineage.find(row => row.id === receipt.id), { intake_id: id, resource: 'core',
            source_mapping: mapping, provenance: receipt.provenance, exact_witness: true, server_window: true, current_head: true }, (actual, expected) => expect(actual).toMatchObject(expected));
        });
        if (receipt.id !== settings.receipt.id) {
          const population = lineage.find(row => row.id === receipt.id)!.population_evidence as { provenance: { acquisition: unknown } };
          diagnostics.assertion('population-witness', () => {
            diagnostics.comparison('population.acquisition', population.provenance.acquisition, original.acquisition, (actual, expected) => expect(actual).toEqual(expected));
          });
        }
      }
      const outcomes = await database.query(`SELECT dispatch.resource,outcome.capture_acquisition,
        outcome.capture_acquisition->>'dispatchNonce'=dispatch.capture_nonce::text
          AND outcome.capture_acquisition->'work'=dispatch.work
          AND outcome.capture_acquisition->'fence'->>'workerId'=dispatch.worker_id
          AND outcome.capture_acquisition->'fence'->>'generation'=dispatch.generation::text AS exact_witness,
        outcome.recorded_at BETWEEN dispatch.admitted_at AND dispatch.admitted_at+interval '30 seconds' AS server_window
        FROM public.public_data_dispatches dispatch JOIN public.public_data_dispatch_outcomes outcome
          USING(worker_id,generation) WHERE dispatch.intake_id=$1 AND outcome.outcome='checkpoint-committed'
        ORDER BY dispatch.admitted_at`, [id]);
      diagnostics.assertion('dispatch-order', () => {
        diagnostics.comparison('dispatch.resources', outcomes.map(row => row.resource), stages, (actual, expected) => expect(actual).toEqual(expected));
      });
      for (const outcome of outcomes) {
        diagnostics.assertion('dispatch-witness', () => {
          diagnostics.comparison('dispatch.flags', outcome, { exact_witness: true, server_window: true }, (actual, expected) => expect(actual).toMatchObject(expected));
          diagnostics.comparison('dispatch.acquisition', outcome.capture_acquisition, captures.find(entry => entry.capture.acquisition?.work.kind === outcome.resource)!.capture.acquisition, (actual, expected) => expect(actual).toEqual(expected));
        });
      }
      const discoveryTimes = await database.query(`SELECT 'identity' AS resource,request_started_at AS started,request_completed_at AS completed
        FROM public.public_data_identity_observations WHERE intake_id=$1 UNION ALL
        SELECT 'leagues',request_started_at,request_completed_at FROM public.public_data_league_lists WHERE intake_id=$1 UNION ALL
        SELECT 'bootstrap',bootstrap_started_at,bootstrap_completed_at FROM public.public_data_league_candidates WHERE intake_id=$1`, [id]);
      diagnostics.assertion('discovery-count', () => {
        diagnostics.comparison('discovery.count', discoveryTimes, 3, (actual, expected) => expect(actual).toHaveLength(expected));
      });
      for (const stored of discoveryTimes) {
        const original = captures.find(entry => entry.capture.acquisition?.work.kind === stored.resource)!.capture;
        diagnostics.assertion('discovery-times', () => {
          diagnostics.comparison('discovery.started', exactMatchupClockInstant(stored.started), original.requestStartedAt, (actual, expected) => expect(actual).toBe(expected));
          diagnostics.comparison('discovery.completed', exactMatchupClockInstant(stored.completed), original.requestCompletedAt, (actual, expected) => expect(actual).toBe(expected));
        });
      }
      const storedResources = read.leagues[0].resources;
      diagnostics.assertion('stored-resources', () => {
        diagnostics.comparison('stored-resources.composition', storedResources, {
          settings: { status: 'available', receipt: settings.receipt }, heldRoster: { status: 'available', receipt: players.receipt },
          teamManagers: { status: 'available', receipt: managers.receipt },
          teamManagerEvidence: { status: 'available', receipt: coowners.receipt, captureBinding: 'latest-for-current-source-mapping' },
          directory: { status: 'available', observationId: candidate.users_observation_id,
            acquisition: { id: candidate.users_capture_id, legacyObservationId: candidate.users_observation_id, sourceMapping: mapping } },
        }, (actual, expected) => expect(actual).toMatchObject(expected));
      });
      const [directory] = await database.query('SELECT capture.id,capture.legacy_observation_id,capture.source_mapping,' +
        'capture.request_started_at::text,capture.request_completed_at::text,capture.source_observed_at::text ' +
        'FROM public.public_data_directory_captures capture WHERE capture.id=$1 AND capture.intake_id=$2', [candidate.users_capture_id, id]);
      diagnostics.assertion('directory-lineage', () => {
        diagnostics.comparison('directory.lineage', directory, { id: candidate.users_capture_id, legacy_observation_id: candidate.users_observation_id, source_mapping: mapping }, (actual, expected) => expect(actual).toMatchObject(expected));
        diagnostics.comparison('directory.time-order', Date.parse(String(directory.request_started_at)), Date.parse(String(directory.request_completed_at)), (actual, expected) => expect(actual).toBeLessThanOrEqual(expected));
        diagnostics.comparison('directory.time-equality', directory.source_observed_at, directory.request_completed_at, (actual, expected) => expect(actual).toBe(expected));
      });
      const directoryOriginal = captures.find(entry => entry.family === 'users')!.capture;
      diagnostics.assertion('directory-times', () => {
        diagnostics.comparison('directory.started', new Date(String(directory.request_started_at)).toISOString(), directoryOriginal.requestStartedAt, (actual, expected) => expect(actual).toBe(expected));
        diagnostics.comparison('directory.completed', new Date(String(directory.request_completed_at)).toISOString(), directoryOriginal.requestCompletedAt, (actual, expected) => expect(actual).toBe(expected));
      });
      const finalSeason = await database.query('SELECT scoring_profile_id FROM public.league_seasons WHERE id=$1', [mapping.leagueSeasonId]);
      diagnostics.assertion('final-profile', () => { diagnostics.comparison('final.profile', finalSeason[0].scoring_profile_id, null, (actual) => expect(actual).toBeNull()); });
      const finalDispatches = await database.query('SELECT resource FROM public.public_data_dispatches WHERE intake_id=$1 ORDER BY admitted_at', [id]);
      diagnostics.assertion('final-dispatch-order', () => { diagnostics.comparison('final.dispatch-order', finalDispatches, stages.map(resource => ({ resource })), (actual, expected) => expect(actual).toEqual(expected)); });
    } catch (error) { throw diagnostics.failure('case', error); }
    finally { restoreFetch?.(); await diagnostics.save(); }
  }, 10 * 60_000);
});

/** AUTHORED, NOT EXECUTED. Real restricted LOGIN, coordinator, parsers,
 * normalizer and PostgreSQL writer/readers; only HTTP responses are fixtures.
 * Real 60-second admission remains, so this oracle takes several minutes.
 * A pre-enrolled source avoids changing the other suites' fleet. Fresh-fleet
 * registration/capacity and live provider qualification remain separate gaps. */
describe('public data source to typed PostgreSQL readback and recovery', () => {
  let connection: IndependentDatabase;
  beforeAll(() => { connection = createIndependentDatabase(); });
  afterAll(async () => connection.close());
  it('binds typed receipts, preserves core through interruption, recovers once and permits explicit existing-consumer adoption', async () => {
    const database = connection.database;
    const jobs = createProjectionStore(database);
    const intake = createPublicIntakeStore(database);
    let witnessGuardsExercised = false;
    let allWitnessGuardsProved = false;
    let guardedOriginalInput: string | undefined;
    let latestWitnessInput: string | undefined, postCheckpointReplayProved = false;
    const object = (value: unknown) => value as Record<string, unknown>;
    const checkedClient: DatabaseClient = { ...database,
      async query<Row extends DatabaseRow>(statement: string, parameters: readonly unknown[] = [], options?: DatabaseQueryOptions) {
        if (statement.includes('/* league-administration:record-observation */')) {
          const input = object(JSON.parse(String(parameters[0]))), envelope = object(input.envelope);
          const acquisition = object(object(envelope.provenance).acquisition);
          if (envelope.family === 'rosters' && acquisition?.version === 'public-network-capture-v1') latestWitnessInput = String(parameters[0]);
          if (!witnessGuardsExercised && envelope.family === 'rosters' && acquisition?.version === 'public-network-capture-v1') {
            witnessGuardsExercised = true;
            guardedOriginalInput = String(parameters[0]);
            const fence = object(input.writeFence);
            const live = async () => expect((await database.query(`SELECT lease_owner=$1 AND attempt_count=$2
              AND lease_until>clock_timestamp() AND $3::timestamptz>clock_timestamp() AS valid
              FROM public.projection_jobs WHERE job_key=$4`, [fence.workerId, fence.generation, fence.deadlineAt, fence.jobKey]))[0].valid).toBe(true);
            const history = () => database.query(`SELECT to_jsonb(attempt) AS attempt,scope.identity,to_jsonb(head) AS head,
              (SELECT jsonb_agg(to_jsonb(receipt) ORDER BY receipt.id) FROM public.league_roster_capture_receipts receipt
                WHERE receipt.attempt_id=attempt.id) AS receipts FROM public.league_roster_resource_attempts attempt
              JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
              JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id
              WHERE attempt.write_fence=$1::jsonb ORDER BY attempt.id`, [JSON.stringify(fence)]);
            const replaceWitness = (witness: unknown) => {
              const changed = structuredClone(input);
              object(object(changed.envelope).provenance).acquisition = witness;
              for (const key of ['rosterAcceptance', 'teamManagerAcceptance', 'teamManagerEvidenceAcceptance']) {
                const population = object(object(changed[key]).population);
                object(object(population.envelope).provenance).acquisition = witness;
              }
              return changed;
            };
            const changedNonce = structuredClone(acquisition);
            object(object(changedNonce.attempts).managersV2).nonce = randomUUID();
            const missingRole = structuredClone(acquisition); delete object(missingRole.attempts).managersV2;
            const changedWork = structuredClone(acquisition); object(changedWork.work).revision = Number(object(changedWork.work).revision) + 1;
            const changedMapping = structuredClone(acquisition); object(changedMapping.mapping).revisionId = randomUUID();
            const mixedGroup = structuredClone(acquisition); object(object(mixedGroup.attempts).players).id = randomUUID();
            const additionalRole = structuredClone(acquisition); object(additionalRole.attempts).matchups = { id: randomUUID(), nonce: randomUUID() };
            const wrongPeriod = structuredClone(acquisition); object(wrongPeriod.work).nativeWeek = 7;
            const oldGeneration = structuredClone(acquisition); object(oldGeneration.fence).generation = Number(fence.generation) + 1;
            const mixedPopulation = structuredClone(input);
            object(object(object(object(mixedPopulation.rosterAcceptance).population).envelope).provenance).acquisition = changedNonce;
            const missingMain = structuredClone(input); delete object(object(missingMain.envelope).provenance).acquisition;
            const missingAdditions = structuredClone(input);
            for (const key of ['rosterAcceptance', 'teamManagerAcceptance', 'teamManagerEvidenceAcceptance']) delete missingAdditions[key];
            const previous = await history(); expect(previous).toHaveLength(4); await live();
            for (const invalid of [replaceWitness(null), replaceWitness(changedNonce), replaceWitness(missingRole),
              replaceWitness(changedWork), replaceWitness(changedMapping), replaceWitness(mixedGroup),
              replaceWitness({ ...acquisition, dispatchNonce: randomUUID() }), replaceWitness(additionalRole),
              replaceWitness(wrongPeriod), replaceWitness(oldGeneration), missingAdditions, mixedPopulation, missingMain]) {
              await expect(database.query(statement, [JSON.stringify(invalid)], options)).rejects.toThrow();
            }
            await live(); expect(await history()).toEqual(previous);
            // Positive control uses the same still-valid fence and original input.
            const result = await database.query<Row>(statement, parameters, options);
            const accepted = object(result[0].result);
            for (const key of ['rosterAcceptance', 'teamManagerAcceptance', 'teamManagerEvidenceAcceptance']) {
              expect(accepted[key]).toMatchObject({ status: 'accepted' });
            }
            const saved = await history();
            const replay = await database.query(statement, parameters, options);
            for (const key of ['rosterAcceptance', 'teamManagerAcceptance', 'teamManagerEvidenceAcceptance']) {
              expect(object(replay[0].result)[key]).toMatchObject({ status: 'accepted', reason: 'exact_receipt_replay',
                receiptId: object(accepted[key]).receiptId });
            }
            const reserved = saved.find(row => object(object(row.identity).policy).canonicalNormalizerVersion === 'sleeper-current-team-manager-evidence-v2')!;
            const originalAttempt = object(reserved.attempt), identity = object(reserved.identity);
            await database.query('SELECT public.begin_current_roster_attempt($1::jsonb,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb)',
              [JSON.stringify(originalAttempt.source_mapping), originalAttempt.id, JSON.stringify(identity.scope), JSON.stringify(identity.policy), JSON.stringify(fence)]);
            await expect(database.query(statement, [JSON.stringify(replaceWitness(changedNonce))], options)).rejects.toThrow('receipt conflict');
            await expect(ownerQuery('UPDATE public.league_roster_resource_attempts SET capture_nonce=gen_random_uuid() WHERE id=$1', [originalAttempt.id])).rejects.toThrow('immutable');
            await expect(ownerQuery('UPDATE public.public_data_dispatches SET capture_nonce=gen_random_uuid() WHERE worker_id=$1 AND generation=$2', [fence.workerId, fence.generation])).rejects.toThrow('immutable');
            expect(await history()).toEqual(saved);
            allWitnessGuardsProved = true;
            return result;
          }
        }
        return database.query<Row>(statement, parameters, options);
      },
    };
    const administration = createLeagueAdministrationStore(checkedClient);
    const id = randomUUID();
    const native = `9${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
    const season = 2181;
    const league = { league_id: native, season: String(season), sport: 'nfl', name: 'Synthetic unrelated official league',
      total_rosters: 1, roster_positions: ['QB', 'BN'], settings: { divisions: 3 }, scoring_settings: { rec_yd: 0.1, unsupported_bonus: 2 } };
    const roster = [{ roster_id: 1, owner_id: '555', co_owners: ['556'], players: ['123'], starters: ['123'], reserve: [], taxi: [] }];
    const registration = await jobs.registerLeagueSeason({ leagueKey: `sleeper-${native}`, leagueName: league.name,
      sleeperLeagueId: native, season, scoringRules: league.scoring_settings });
    if (registration.kind !== 'stored') throw new Error('Integration persistence disabled.');
    await ownerQuery(`INSERT INTO public.league_administration_enrollments(league_id,provider,active,evidence)
      VALUES($1,'sleeper',false,'public-data-intake-v1')`, [registration.value.leagueId]);
    await ownerQuery(`INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence)
      VALUES($1,$2,'sleeper','public-data-intake-v1')`, [registration.value.leagueId, season]);
    let directoryOutage = false;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith('/user/synthetic_manager')) return new Response(JSON.stringify({ user_id: '555', username: 'synthetic_manager' }));
      if (url.endsWith(`/user/555/leagues/nfl/${season}`)) return new Response(JSON.stringify([league]));
      if (url.endsWith(`/league/${native}`)) return new Response(JSON.stringify(league));
      if (url.endsWith(`/league/${native}/rosters`)) return new Response(JSON.stringify(roster));
      if (url.endsWith(`/league/${native}/users`)) {
        if (directoryOutage) throw new Error('synthetic directory interruption');
        return new Response(JSON.stringify([{ user_id: '555', display_name: 'Synthetic Manager' }]));
      }
      throw new Error('Unexpected fixture provider scope.');
    });
    // Controlled source-clock regressions use the existing two core journeys in
    // this nonselected case. DB clocks, admission, lease timers and fence creation
    // remain real. ±30 seconds exceeds the valid 25-second lease but remains
    // below the real 60-second admission gap minus that prior lease. Thus this
    // breaks the old same-capture comparator without reordering adjacent captures.
    // This is a source-capture clock oracle, not arbitrary whole-worker skew.
    // Only zero-argument application Date construction shifts after
    // the DB witness arrives; raw timestamps are never changed after capture.
    const RealDate = Date;
    let requestedOffset = 0, captureOffset = 0;
    const offsetCaptures: Awaited<ReturnType<typeof capturePublicSleeperCore>>[] = [];
    const restoreClock = () => { globalThis.Date = RealDate; captureOffset = 0; };
    const witnessedIntake = { ...intake,
      captureWitness: async (...args: Parameters<NonNullable<typeof intake.captureWitness>>) => {
        const witness = await intake.captureWitness!(...args);
        if (args[0].kind === 'core' && requestedOffset !== 0) {
          captureOffset = requestedOffset;
          globalThis.Date = new Proxy(RealDate, { construct(target, values, newTarget) {
            return Reflect.construct(target, values.length ? values : [RealDate.now() + captureOffset], newTarget);
          } });
        }
        return witness;
      },
      completeCore: async (...args: Parameters<typeof intake.completeCore>) => {
        restoreClock(); await intake.completeCore(...args);
        if (args[0].kind === 'core') {
          const repeated = await database.query('SELECT public.record_league_administration_observation($1::jsonb) AS result', [latestWitnessInput]);
          for (const role of ['rosterAcceptance', 'teamManagerAcceptance', 'teamManagerEvidenceAcceptance']) {
            expect(object(repeated[0].result)[role]).toMatchObject({ status: 'accepted', reason: 'exact_receipt_replay' });
          }
          await expect(intake.captureWitness!(args[0], args[1], args[3])).rejects.toThrow();
          postCheckpointReplayProved = true;
        }
      },
    };
    const dependencies: PublicIntakeDependencies = { intake: witnessedIntake, jobs, administration, managerEvidenceVersion: 'v2',
      now: () => new RealDate(RealDate.now() + captureOffset),
      source: { identity: capturePublicSleeperIdentity, leagues: capturePublicSleeperLeagueList,
        core: async (external, family, signal, witness) => {
          const capture = await capturePublicSleeperCore(external, family, signal, undefined, witness);
          if (captureOffset) offsetCaptures.push(capture);
          return capture;
        } },
    };
    const progress = async (selected = dependencies, requestId = id, offset = 0) => {
      const deadline = Date.now() + 150_000;
      while (Date.now() < deadline) {
        requestedOffset = offset; restoreClock();
        let result;
        try { result = await runPublicIntakeStep(requestId, selected, new AbortController().signal); }
        finally { restoreClock(); requestedOffset = 0; }
        if (!['busy', 'backoff'].includes(result.status)) return result;
        await delay(1_000);
      }
      throw new Error('Real public intake admission did not become due.');
    };
    try {
      expect((await database.query('SELECT session_user AS role'))[0]?.role).toBe('league_one_runtime');
      // Initial synthetic HTTP captures use the real clock. The unchanged rows
      // naturally age during the unchanged, real 60-second intake admissions.
      const originalMapping = await administration.readSourceMapping(native);
      if (!originalMapping) throw new Error('Missing original source mapping.');
      const cachedDocuments = await Promise.all((['league', 'rosters', 'users'] as const)
        .map(family => capturePublicSleeperCore(native, family, new AbortController().signal)));
      // Persist a cache read of those exact fixtures, retaining their real source
      // timestamps. A network refresh must not relabel this original row's origin.
      const originals = await recordCapturedAdministration(originalMapping.scope, cachedDocuments.map(document => ({ ...document, origin: 'cache' as const })),
        { store: administration, mapping: originalMapping });
      const originalIds = originals.results.map(entry => entry.result.observationId);
      const immutableOriginals = await database.query('SELECT * FROM public.league_administration_observations WHERE id=ANY($1::uuid[]) ORDER BY id', [originalIds]);
      directoryOutage = true;
      await intake.submit({ id, username: 'synthetic_manager', seasons: [season] });
      await intake.submit({ id, username: 'synthetic_manager', seasons: [season] });
      await expect(intake.submit({ id, username: 'different_manager', seasons: [season] })).rejects.toThrow('replay mismatch');
      for (const resource of ['identity', 'leagues', 'bootstrap']) expect(await progress()).toMatchObject({ status: 'progress', resource });
      // All typed writes commit, then process death/lost checkpoint leaves this
      // request at core. Retry must acquire fresh receipts for identical content.
      expect(await progress({ ...dependencies, intake: { ...intake, completeCore: async () => { throw new Error('lost core checkpoint'); } } }))
        .toMatchObject({ status: 'unavailable', resource: 'core' });
      const beforeRetry = await administration.readAcceptedLeagueSettings(originalMapping);
      const beforeRetryRoster = await administration.readAcceptedCurrentRoster(originalMapping);
      expect(beforeRetry.status).toBe('available');
      expect(witnessGuardsExercised).toBe(true);
      expect(allWitnessGuardsProved).toBe(true);
      // Identical witnessed bytes cannot revive the now-failed original owner.
      await expect(database.query('SELECT public.record_league_administration_observation($1::jsonb)', [guardedOriginalInput]))
        .rejects.toThrow(/fence.*(?:stale|expired)|lease/);
      expect(await progress(dependencies, id, -30_000)).toMatchObject({ status: 'progress', resource: 'core' });
      expect(postCheckpointReplayProved).toBe(true);
      const read = await readPublicSleeperIntake(database, administration, id);
      if (read.status === 'missing') throw new Error('Missing public fixture readback.');
      expect(read.leagues[0].resources).toMatchObject({ settings: { status: 'available' }, heldRoster: { status: 'available' },
        teamManagers: { status: 'available' }, directory: { status: 'unavailable' } });
      const [candidate] = await database.query('SELECT * FROM public.public_data_league_candidates WHERE intake_id=$1', [id]);
      for (const key of ['settings_receipt_id', 'players_receipt_id', 'managers_receipt_id']) expect(candidate[key]).toBeTruthy();
      expect(candidate.league_observation_id).toBe(originals.results.find(entry => entry.family === 'league')?.result.observationId);
      if (beforeRetryRoster.status !== 'available') throw new Error('Missing first mapped network roster capture.');
      expect(candidate.roster_observation_id).toBe(beforeRetryRoster.receipt.legacyObservationId);
      if (beforeRetry.status !== 'available') throw new Error('Missing interrupted typed capture.');
      expect(candidate.settings_receipt_id).not.toBe(beforeRetry.receipt.id);
      const [freshness] = await database.query(`SELECT observed.origin AS original_origin,observed.request_started_at<clock_timestamp()-interval '30 seconds' AS original_old,
        (receipt.provenance->>'requestStartedAt')::timestamptz<attempt.reserved_at AS old_comparator_fails,
        receipt.provenance->'acquisition'->>'dispatchNonce'=dispatch.capture_nonce::text
          AND receipt.recorded_at>=attempt.reserved_at AND attempt.reserved_at>=dispatch.admitted_at AS fresh_dispatch
        FROM public.league_roster_capture_receipts receipt
        JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
        JOIN public.public_data_dispatches dispatch ON dispatch.worker_id=attempt.write_fence->>'workerId'
          AND dispatch.generation=(attempt.write_fence->>'generation')::integer
        JOIN public.league_administration_observations observed ON observed.id=receipt.legacy_observation_id
        WHERE receipt.id=$1`, [candidate.settings_receipt_id]);
      expect(freshness).toEqual({ original_origin: 'cache', original_old: true, old_comparator_fails: true, fresh_dispatch: true });
      const negativeClock = await administration.readAcceptedLeagueSettings(originalMapping);
      const negativeV2 = await administration.readAcceptedTeamManagerEvidence!(originalMapping);
      if (negativeClock.status !== 'available' || negativeV2.status !== 'available') throw new Error('Clock-offset typed receipt missing.');
      expect(negativeClock.receipt.provenance.requestStartedAt).toBe(offsetCaptures.find(capture => capture.family === 'league')?.requestStartedAt);
      expect(negativeV2.receipt.provenance.requestCompletedAt).toBe(offsetCaptures.find(capture => capture.family === 'rosters')?.requestCompletedAt);
      expect((await administration.listEnrollmentInventory(season)).entries.some(entry => entry.intended.leagueId === registration.value.leagueId)).toBe(false);
      await expect(database.query('UPDATE public.public_data_intakes SET revision=revision+1 WHERE id=$1', [id])).rejects.toMatchObject({ code: '42501' });
      expect(await progress({ ...dependencies, intake: { ...intake, fail: async () => { throw new Error('old operation database deadline'); } } }))
        .toMatchObject({ status: 'unavailable', resource: 'users' });
      const [before] = await database.query('SELECT revision,failure_count FROM public.public_data_intakes WHERE id=$1', [id]);
      expect(before.failure_count).toBe(0);
      const workerId = randomUUID();
      const claim = await jobs.acquireJob({ jobKey: PUBLIC_INTAKE_JOB, jobType: PUBLIC_INTAKE_JOB, workerId,
        scheduledFor: new Date().toISOString(), leaseSeconds: 25, payload: { requestId: id } });
      if (claim.kind !== 'acquired') throw new Error('Replacement restricted owner unavailable.');
      const fence = { jobKey: PUBLIC_INTAKE_JOB, workerId, generation: claim.attempt, deadlineAt: new Date(Date.now() + 20_000).toISOString() };
      await intake.recover(id, fence);
      await intake.recover(id, fence);
      const [after] = await database.query('SELECT revision,failure_count FROM public.public_data_intakes WHERE id=$1', [id]);
      expect(Number(after.revision)).toBe(Number(before.revision) + 1);
      expect(after.failure_count).toBe(1);
      expect(await intake.next(id)).toBe('backoff');
      const [retained] = await database.query('SELECT * FROM public.public_data_league_candidates WHERE intake_id=$1', [id]);
      for (const key of ['settings_receipt_id', 'players_receipt_id', 'managers_receipt_id']) expect(retained[key]).toBe(candidate[key]);
      await jobs.completeJob(PUBLIC_INTAKE_JOB, workerId);
      // Explicit legacy preparation adopts DATA purpose; installed025 activation
      // still requires three fresh official heads, including the missing directory.
      const seasonHistory = await database.query('SELECT * FROM public.league_administration_enrollment_seasons WHERE league_id=$1 ORDER BY season', [registration.value.leagueId]);
      await database.query('SELECT public.prepare_account_league_enrollment($1::uuid,$2::integer,$3::text)', [registration.value.leagueId, season, native]);
      await database.query('SELECT public.prepare_account_league_enrollment($1::uuid,$2::integer,$3::text)', [registration.value.leagueId, season, native]);
      expect(await database.query('SELECT * FROM public.league_administration_enrollment_seasons WHERE league_id=$1 ORDER BY season', [registration.value.leagueId])).toEqual(seasonHistory);
      await expect(database.query('UPDATE public.league_administration_enrollments SET data_adopted_seasons=ARRAY[$2]::integer[] WHERE league_id=$1',
        [registration.value.leagueId, season + 1])).rejects.toMatchObject({ code: '42501' });
      expect((await database.query('SELECT active,evidence FROM public.league_administration_enrollments WHERE league_id=$1', [registration.value.leagueId]))[0])
        .toMatchObject({ active: false, evidence: 'account-onboarding-v1' });
      await expect(database.query('SELECT public.activate_account_league_enrollment($1,$2,$3)', [`sleeper-${native}`, season, native]))
        .rejects.toThrow('complete current onboarding evidence');
      expect((await administration.listEnrollmentInventory(season)).entries.some(entry => entry.intended.leagueId === registration.value.leagueId)).toBe(false);
      const mapping = await administration.readSourceMapping(native);
      if (!mapping) throw new Error('Missing adoption source mapping.');
      directoryOutage = false;
      expect(await progress()).toMatchObject({ status: 'progress', resource: 'users' });
      const [directoryReceipt] = await database.query(`SELECT capture.*,observed.request_started_at AS original_request_started_at
        FROM public.public_data_directory_captures capture JOIN public.league_administration_observations observed
          ON observed.id=capture.legacy_observation_id WHERE capture.intake_id=$1`, [id]);
      expect(directoryReceipt.legacy_observation_id).toBe(originals.results.find(entry => entry.family === 'users')?.result.observationId);
      expect(new Date(String(directoryReceipt.request_started_at)).getTime()).toBeGreaterThan(new Date(String(directoryReceipt.original_request_started_at)).getTime());
      await expect(database.query('DELETE FROM public.public_data_directory_captures WHERE id=$1', [directoryReceipt.id])).rejects.toMatchObject({ code: '42501' });
      await expect(ownerQuery('DELETE FROM public.public_data_directory_captures WHERE id=$1', [directoryReceipt.id])).rejects.toThrow('immutable');
      const finished = await readPublicSleeperIntake(database, administration, id);
      if (finished.status === 'missing') throw new Error('Missing completed intake.');
      expect(finished.leagues[0].resources?.directory).toMatchObject({ status: 'available', acquisition: { id: directoryReceipt.id } });
      expect(await database.query('SELECT * FROM public.league_administration_observations WHERE id=ANY($1::uuid[]) ORDER BY id', [originalIds])).toEqual(immutableOriginals);
      const at = new Date().toISOString();
      await recordCapturedAdministration(mapping.scope, [
        { family: 'league', payload: league }, { family: 'rosters', payload: roster },
        { family: 'users', payload: [{ user_id: '555', display_name: 'Synthetic Manager' }] },
      ].map(document => ({ ...document, family: document.family as 'league' | 'rosters' | 'users', week: null,
        origin: 'network' as const, requestStartedAt: at, requestCompletedAt: at })), { store: administration });
      await database.query('SELECT public.activate_account_league_enrollment($1,$2,$3)', [`sleeper-${native}`, season, native]);
      expect((await administration.listEnrollmentInventory(season)).entries.some(entry => entry.intended.leagueId === registration.value.leagueId)).toBe(true);
      // A later DATA-only history row is not adopted by activating this season.
      await ownerQuery(`INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence)
        VALUES($1,$2,'sleeper','public-data-intake-v1')`, [registration.value.leagueId, season + 1]);
      expect((await administration.listEnrollmentInventory(season + 1)).entries.some(entry => entry.intended.leagueId === registration.value.leagueId)).toBe(false);
      const defaultEntry = (await administration.listEnrollmentInventory()).entries.find(entry => entry.intended.leagueId === registration.value.leagueId);
      expect(defaultEntry?.intended.season).toBe(season);
      expect(fetch.mock.calls.filter(([url]) => String(url).includes('/user/'))).toHaveLength(2);
      const originalProfile = await database.query('SELECT scoring_profile_id FROM public.league_seasons WHERE id=$1', [mapping.leagueSeasonId]);
      const correctionId = randomUUID();
      league.scoring_settings.rec_yd = 0.2;
      await intake.submit({ id: correctionId, username: 'synthetic_manager', seasons: [season] });
      // Repeat the whole actual intake path, with normal admission waits, after
      // an official scoring correction that must not rewrite calculation rules.
      for (const resource of ['identity', 'leagues', 'bootstrap', 'core']) {
        expect(await progress(dependencies, correctionId, resource === 'core' ? 30_000 : 0)).toMatchObject({ status: 'progress', resource });
      }
      const corrected = await administration.readAcceptedLeagueSettings(mapping);
      if (corrected.status !== 'available') throw new Error('Missing official correction.');
      expect(corrected.value.scoring.rules).toMatchObject({ value: { rec_yd: 0.2 } });
      const positiveV2 = await administration.readAcceptedTeamManagerEvidence!(mapping);
      if (positiveV2.status !== 'available') throw new Error('Forward-clock manager evidence missing.');
      const forwardReceipts = await database.query(`SELECT id,
        (provenance->>'requestCompletedAt')::timestamptz>recorded_at AS old_completion_comparator_fails,
        provenance FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[])`,
      [[corrected.receipt.id, positiveV2.receipt.id]]);
      expect(forwardReceipts).toHaveLength(2);
      for (const retained of forwardReceipts) expect(retained.old_completion_comparator_fails).toBe(true);
      expect(corrected.receipt.provenance.requestStartedAt).toBe(offsetCaptures.filter(capture => capture.family === 'league').at(-1)?.requestStartedAt);
      expect(positiveV2.receipt.provenance.requestCompletedAt).toBe(offsetCaptures.filter(capture => capture.family === 'rosters').at(-1)?.requestCompletedAt);
      expect(await administration.readSource({ ...mapping.scope, family: 'league', week: null }))
        .toMatchObject({ status: 'conflict', reason: 'scoring_profile_change_requires_explicit_compatibility_and_period_review' });
      expect(await database.query('SELECT scoring_profile_id FROM public.league_seasons WHERE id=$1', [mapping.leagueSeasonId])).toEqual(originalProfile);
      const correctedRead = await readPublicSleeperIntake(database, administration, correctionId);
      if (correctedRead.status === 'missing') throw new Error('Missing correction checkpoint.');
      expect(correctedRead.leagues[0].resources).toMatchObject({ settings: { status: 'available' },
        heldRoster: { status: 'available' }, teamManagers: { status: 'available' } });
      const currentRoster = await administration.readAcceptedCurrentRoster(mapping);
      const currentManagers = await administration.readAcceptedTeamManagers(mapping);
      const retainedPopulation = { observationId: corrected.receipt.legacyObservationId, contentHash: corrected.receipt.rawContentHash,
        envelope: { schemaVersion: 'league-administration-v1' as const, normalizerVersion: 'sleeper-administration-v1' as const,
          dialect: 'sleeper-nfl-v1' as const, scope: mapping.scope, family: 'league' as const, week: null, completeness: 'complete' as const,
          provenance: corrected.receipt.provenance, payload: league } };
      // A receipt from the former PUBLIC worker cannot authorize a new unfenced
      // writer's claimed same-batch population, even for identical official rules.
      const wrongOwner = await administration.beginRosterCapture(mapping, randomUUID(), randomUUID());
      await expect(recordCapturedAdministration(mapping.scope,
        [await capturePublicSleeperCore(native, 'rosters', new AbortController().signal)], { store: administration, mapping,
          rosterAttempt: wrongOwner.players, managerAttempt: wrongOwner.managers, populationEvidence: retainedPopulation }))
        .rejects.toThrow('unwitnessed capture cannot borrow witnessed population');
      // The no-population recovery path is also fenced by the latest settings
      // reservation; a pending newer settings acquisition cannot reuse old proof.
      await administration.beginLeagueSettingsAttempt(mapping, randomUUID());
      const superseded = await administration.beginRosterCapture(mapping, randomUUID(), randomUUID());
      const rejectedLatest = await recordCapturedAdministration(mapping.scope,
        [await capturePublicSleeperCore(native, 'rosters', new AbortController().signal)], { store: administration, mapping,
          rosterAttempt: superseded.players, managerAttempt: superseded.managers });
      expect(rejectedLatest.results[0].result.rosterAcceptance?.status).toBe('preserved');
      expect(rejectedLatest.results[0].result.teamManagerAcceptance?.status).toBe('preserved');
      expect(await administration.readAcceptedCurrentRoster(mapping)).toEqual(currentRoster);
      expect(await administration.readAcceptedTeamManagers(mapping)).toEqual(currentManagers);

    } finally { restoreClock(); fetch.mockRestore(); }
  }, 750_000);

  it('admits generation one after normal completed-job retention while preserving older dispatch history', async () => {
    const database = connection.database;
    const jobs = createProjectionStore(database);
    const intake = createPublicIntakeStore(database);
    // Age only this suite's completed synthetic owner. Invoke the maintained
    // retention API at its ordinary 48-hour cutoff, not direct job deletion.
    await ownerQuery("UPDATE public.projection_jobs SET updated_at=clock_timestamp()-interval '49 hours' WHERE job_key=$1 AND state='completed'", [PUBLIC_INTAKE_JOB]);
    await jobs.pruneHistory({ before: new Date(Date.now() - 48 * 60 * 60_000).toISOString() });
    expect(await database.query('SELECT job_key FROM public.projection_jobs WHERE job_key=$1', [PUBLIC_INTAKE_JOB])).toHaveLength(0);
    expect((await database.query('SELECT worker_id FROM public.public_data_dispatches')).length).toBeGreaterThan(0);
    const id = randomUUID();
    await intake.submit({ id, username: 'pruning_fixture', seasons: [2183] });
    // Wait for existing immutable admissions without weakening their interval.
    const [due] = await database.query("SELECT greatest(0,extract(epoch FROM max(admitted_at)+interval '61 seconds'-clock_timestamp())) AS seconds FROM public.public_data_dispatches");
    await delay(Number(due.seconds) * 1_000);
    const workerId = randomUUID();
    const claim = await jobs.acquireJob({ jobKey: PUBLIC_INTAKE_JOB, jobType: PUBLIC_INTAKE_JOB, workerId,
      scheduledFor: new Date().toISOString(), leaseSeconds: 25, payload: { requestId: id } });
    expect(claim).toMatchObject({ kind: 'acquired', attempt: 1 });
    if (claim.kind !== 'acquired') throw new Error('Missing fresh job lifecycle.');
    const fence = { jobKey: PUBLIC_INTAKE_JOB, workerId, generation: claim.attempt, deadlineAt: new Date(Date.now() + 20_000).toISOString() };
    await intake.recover(id, fence);
    const work = await intake.next(id);
    if (typeof work === 'string') throw new Error('Missing pruning fixture work.');
    expect(await intake.admit(work, fence)).toBe(true);
    expect(await intake.admit(work, fence)).toBe(false);
    await intake.fail(work, fence);
    await jobs.completeJob(PUBLIC_INTAKE_JOB, workerId);
    expect(await database.query('SELECT worker_id FROM public.public_data_dispatches WHERE worker_id=$1 AND generation=1', [workerId])).toHaveLength(1);
  }, 90_000);

  it('rejects a restricted bootstrap after an advisory wait expires without leaving identity or reservation', async () => {
    // Synthetic retained discovery isolates this lock oracle; the protected
    // mutation uses the actual runtime LOGIN, never an owner SET ROLE shortcut.
    const id = randomUUID();
    const native = `8${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
    const season = 2182;
    await ownerQuery("INSERT INTO public.public_data_intakes(id,username,seasons) VALUES($1,'lock_fixture',ARRAY[$2]::integer[])", [id, season]);
    const [manager] = await ownerQuery("INSERT INTO public.league_source_manager_accounts(provider,external_manager_id) VALUES('sleeper',$1) RETURNING id", [native]);
    await ownerQuery(`INSERT INTO public.public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,payload,request_started_at,request_completed_at)
      VALUES($1,$2,'lock_fixture','Fixture','{}',clock_timestamp(),clock_timestamp())`, [id, manager.id]);
    await ownerQuery("INSERT INTO public.public_data_league_lists(intake_id,season,payload,request_started_at,request_completed_at) VALUES($1,$2,'[]',clock_timestamp(),clock_timestamp())", [id, season]);
    await ownerQuery("INSERT INTO public.public_data_league_candidates(intake_id,season,external_league_id,name) VALUES($1,$2,$3,'Lock fixture')", [id, season, native]);
    const blocker = await createPinnedIntegrationDatabase('owner');
    let runtime: IndependentDatabase | undefined;
    let jobs: ReturnType<typeof createProjectionStore> | undefined;
    let pending: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
    let locked = false, acquired = false;
    const workerId = randomUUID();
    try {
      runtime = await createPinnedIntegrationDatabase('runtime');
      // Bound failure cleanup while retaining the blocker until the pending
      // statement settles. Never release a live mutation just to clean up.
      await runtime.database.query("SET statement_timeout='8s'");
      const [session] = await runtime.database.query('SELECT pg_backend_pid() AS pid,session_user AS role,current_user AS effective_role');
      expect(session).toMatchObject({ role: 'league_one_runtime', effective_role: 'league_one_runtime' });
      const [blocking] = await blocker.database.query('SELECT pg_backend_pid() AS pid');
      expect(session.pid).not.toBe(blocking.pid);
      jobs = createProjectionStore(runtime.database);
      const intake = createPublicIntakeStore(runtime.database);
      const work = await intake.next(id);
      if (typeof work === 'string' || work.kind !== 'bootstrap') throw new Error('Missing advisory bootstrap fixture.');
      const retainedDiscovery = () => runtime!.database.query(`
        SELECT 'intake' AS resource,to_jsonb(retained) AS value FROM public.public_data_intakes retained WHERE id=$1
        UNION ALL SELECT 'identity',to_jsonb(retained) FROM public.public_data_identity_observations retained WHERE intake_id=$1
        UNION ALL SELECT 'list',to_jsonb(retained) FROM public.public_data_league_lists retained WHERE intake_id=$1
        UNION ALL SELECT 'candidate',to_jsonb(retained) FROM public.public_data_league_candidates retained WHERE intake_id=$1
        ORDER BY resource`, [id]);
      const discovery = await retainedDiscovery();
      expect(discovery).toHaveLength(4);
      const at = new Date().toISOString();
      await blocker.database.query('BEGIN'); locked = true;
      await blocker.database.query("SELECT pg_advisory_xact_lock(hashtextextended('account-league-enrollment',0))");
      const claim = await jobs.acquireJob({ jobKey: PUBLIC_INTAKE_JOB, jobType: PUBLIC_INTAKE_JOB, workerId,
        scheduledFor: new Date(Date.now() + 1_000).toISOString(), leaseSeconds: 25, payload: { requestId: id } });
      if (claim.kind !== 'acquired') throw new Error('Lock fixture owner unavailable.');
      acquired = true;
      // All fixture/session/lock preparation precedes the original one-second
      // work fence. This negative guard fixture has no admission or capture witness.
      const fence = { jobKey: PUBLIC_INTAKE_JOB, workerId, generation: claim.attempt, deadlineAt: new Date(Date.now() + 1_000).toISOString() };
      pending = intake.register(work, { family: 'league', week: null, origin: 'network', requestStartedAt: at, requestCompletedAt: at,
        payload: { league_id: native, season: String(season), sport: 'nfl', name: 'Lock fixture', total_rosters: 1,
          settings: {}, scoring_settings: { rec: 1 }, roster_positions: ['QB'] } }, fence)
        .then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
      let observed = false;
      while (Date.now() < Date.parse(fence.deadlineAt)) {
        const [state] = await blocker.database.query(`SELECT $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocked,
          clock_timestamp()<$3::timestamptz AS live`, [session.pid, blocking.pid, fence.deadlineAt]);
        if (state.blocked === true && state.live === true) { observed = true; break; }
        if (state.live !== true) break;
        await delay(20);
      }
      expect(observed, 'Runtime must reach this advisory blocker before its original work fence expires.').toBe(true);
      await delay(Math.max(0, Date.parse(fence.deadlineAt) - Date.now()) + 100);
      const [expired] = await blocker.database.query('SELECT clock_timestamp() >= $1::timestamptz AS expired', [fence.deadlineAt]);
      expect(expired.expired).toBe(true);
      await blocker.database.query('ROLLBACK'); locked = false;
      expect(await pending).toMatchObject({ ok: false, error: { message: expect.stringContaining('lease lost') } });
      expect(await runtime.database.query('SELECT id FROM public.leagues WHERE league_key=$1', [`sleeper-${native}`])).toHaveLength(0);
      expect(await runtime.database.query("SELECT id FROM public.league_source_connections WHERE provider='sleeper' AND external_league_id=$1", [native])).toHaveLength(0);
      expect(await runtime.database.query('SELECT external_league_id FROM public.public_data_collection_reservations WHERE external_league_id=$1', [native])).toHaveLength(0);
      expect(await runtime.database.query('SELECT worker_id FROM public.public_data_dispatches WHERE worker_id=$1 AND generation=$2', [workerId, claim.attempt])).toHaveLength(0);
      expect(await retainedDiscovery()).toEqual(discovery);
      expect(await intake.next(id)).toEqual(work);
    } finally {
      // On an assertion/read failure the still-blocked statement must first
      // settle (at latest at statement_timeout), then release its blocker.
      try { await pending; }
      finally {
        try { if (locked) await blocker.database.query('ROLLBACK'); }
        finally {
          try { if (acquired) await jobs!.failJob(PUBLIC_INTAKE_JOB, workerId, 'expected expired registration fence'); }
          finally { await Promise.all([blocker.close(), runtime?.close()]); }
        }
      }
    }
  });

  it.each(['configured', 'official-only'] as const)('rolls back %s canonical registration and its reservation when an identity-row wait outlives the postcondition fence', async mode => {
    // This test needs one real slot in the isolated fleet. Saturation is an
    // explicit fixture failure, never a skip, owner bypass or capacity rewrite.
    const [capacity] = await connection.database.query(`SELECT
      (SELECT count(*) FROM public.league_administration_enrollments)
      +(SELECT count(*) FROM public.public_data_collection_reservations reservation WHERE NOT EXISTS(
        SELECT 1 FROM public.league_source_connections source JOIN public.league_seasons season ON season.id=source.league_season_id
        JOIN public.league_administration_enrollments enrollment ON enrollment.league_id=season.league_id
        WHERE source.provider='sleeper' AND source.external_league_id=reservation.external_league_id)) AS used`);
    expect(Number(capacity.used), 'Identity-lock oracle requires one available isolated collection slot.').toBeLessThan(16);
    const id = randomUUID();
    const native = `7${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
    const season = 2184;
    const leagueKey = `sleeper-${native}`;
    const league = { league_id: native, season: String(season), sport: 'nfl', name: 'Identity lock fixture',
      total_rosters: 1, settings: {}, ...(mode === 'configured' ? { scoring_settings: { rec: 1 }, roster_positions: ['QB'] } : {}) };
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith('/user/identity_lock_fixture')) return new Response(JSON.stringify({ user_id: native, username: 'identity_lock_fixture' }));
      if (url.endsWith(`/user/${native}/leagues/nfl/${season}`)) return new Response(JSON.stringify([league]));
      if (url.endsWith(`/league/${native}`)) return new Response(JSON.stringify(league));
      throw new Error('Unexpected identity-lock fixture source scope.');
    });
    const blocker = await createPinnedIntegrationDatabase('owner');
    const runtime = await createPinnedIntegrationDatabase('runtime');
    const database = runtime.database;
    const jobs = createProjectionStore(database);
    const intake = createPublicIntakeStore(database);
    const administration = createLeagueAdministrationStore(database);
    const workerId = randomUUID();
    let blockerOpen = false;
    let registrationDeadline = 0;
    let pending: Promise<unknown> | undefined;
    try {
      await database.query("SET statement_timeout='15s'");
      const [runtimeSession] = await database.query('SELECT session_user AS role,pg_backend_pid() AS pid');
      expect(runtimeSession.role).toBe('league_one_runtime');
      const [blockerSession] = await blocker.database.query('SELECT pg_backend_pid() AS pid');
      await intake.submit({ id, username: 'identity_lock_fixture', seasons: [season] });
      // Retain discovery through the maintained worker and parsers. Admissions
      // and outcomes are genuine; this fixture inserts neither directly.
      for (const resource of ['identity', 'leagues']) {
        const until = Date.now() + 150_000;
        let completed = false;
        while (Date.now() < until) {
          const result = await runPublicIntakeStep(id, { intake, jobs, administration }, new AbortController().signal);
          if (['busy', 'backoff'].includes(result.status)) { await delay(1_000); continue; }
          expect(result).toMatchObject({ status: 'progress', resource });
          completed = true;
          break;
        }
        expect(completed, `Discovery ${resource} did not become due.`).toBe(true);
      }
      const [due] = await database.query("SELECT greatest(0,extract(epoch FROM max(admitted_at)+interval '61 seconds'-clock_timestamp())) AS seconds FROM public.public_data_dispatches");
      await delay(Number(due.seconds) * 1_000);
      const claim = await jobs.acquireJob({ jobKey: PUBLIC_INTAKE_JOB, jobType: PUBLIC_INTAKE_JOB, workerId,
        scheduledFor: new Date().toISOString(), leaseSeconds: 25, payload: { requestId: id } });
      if (claim.kind !== 'acquired') throw new Error('Identity-lock restricted owner unavailable.');
      const work = await intake.next(id);
      if (typeof work === 'string' || work.kind !== 'bootstrap') throw new Error('Missing retained bootstrap work.');
      const fence = { jobKey: PUBLIC_INTAKE_JOB, workerId, generation: claim.attempt, deadlineAt: new Date(Date.now() + 8_000).toISOString() };
      registrationDeadline = Date.parse(fence.deadlineAt);
      expect(await intake.admit(work, fence)).toBe(true);
      const witness = await intake.captureWitness!(work, null, fence);
      const capture = await capturePublicSleeperCore(native, 'league', new AbortController().signal, undefined, witness);
      expect((capture as { acquisition?: PublicCaptureWitness }).acquisition).toEqual(witness);
      await blocker.database.query('BEGIN');
      blockerOpen = true;
      // No advisory lock here. The uncommitted unique league key makes the
      // canonical INSERT/ON CONFLICT wait AFTER the intake guard has succeeded.
      await blocker.database.query('INSERT INTO public.leagues(league_key,name) VALUES($1,$2)', [leagueKey, 'Uncommitted blocker']);
      pending = intake.register(work, capture, fence).then(() => ({ ok: true }), error => ({ ok: false, error }));
      let observedIdentityWait = false;
      const observeUntil = Date.now() + 5_000;
      while (Date.now() < observeUntil) {
        const [state] = await ownerQuery('SELECT $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocked',
          [runtimeSession.pid, blockerSession.pid]);
        if (state.blocked === true) { observedIdentityWait = true; break; }
        await delay(25);
      }
      expect(observedIdentityWait, 'Runtime must reach the actual canonical identity lock before expiry.').toBe(true);
      const [expiry] = await ownerQuery('SELECT greatest(0,extract(epoch FROM $1::timestamptz-clock_timestamp())) AS seconds', [fence.deadlineAt]);
      await delay(Number(expiry.seconds) * 1_000 + 100);
      await blocker.database.query('ROLLBACK');
      blockerOpen = false;
      const outcome = await pending as { ok: boolean; error?: Error };
      expect(outcome.ok).toBe(false);
      expect(outcome.error?.message).toContain('lease lost');
      // The identity statement ran after the blocker rolled back, but the final
      // assertion rejected its transaction. Neither identity nor slot commits.
      expect(await database.query('SELECT id FROM public.leagues WHERE league_key=$1', [leagueKey])).toHaveLength(0);
      expect(await database.query('SELECT id FROM public.league_source_connections WHERE provider=$1 AND external_league_id=$2', ['sleeper', native])).toHaveLength(0);
      expect(await database.query('SELECT external_league_id FROM public.public_data_collection_reservations WHERE external_league_id=$1', [native])).toHaveLength(0);
      expect(await intake.next(id)).toEqual(work);
      expect(await database.query('SELECT worker_id FROM public.public_data_dispatches WHERE worker_id=$1 AND generation=$2', [workerId, claim.attempt])).toHaveLength(1);
      expect(await database.query('SELECT worker_id FROM public.public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2', [workerId, claim.attempt])).toHaveLength(0);
    } finally {
      if (blockerOpen) {
        // An earlier assertion failure must not accidentally unblock a live
        // mutation and commit fixture state while unwinding the oracle.
        await delay(Math.max(0, registrationDeadline - Date.now()) + 100);
        await blocker.database.query('ROLLBACK');
      }
      await pending;
      await jobs.failJob(PUBLIC_INTAKE_JOB, workerId, 'expected expired identity registration postcondition');
      fetch.mockRestore();
      await blocker.close();
      await runtime.close();
    }
  }, 390_000);
});


/** SOURCE ONLY, NOT EXECUTED. These use real restricted LOGIN SQL and the same
 * coordinator. No owner writes to acceptance/dispatch rows, clock backdating,
 * admission bypass, provider request or SQL execution occurred during authoring.
 * The focused typed-cycle case alone requires at least ten real minute-spaced
 * admissions plus recovery/cadence waits. Full-suite fit inside the qualification
 * lifecycle is unproved; select this case only through the guarded suite. */
describe('bounded public DATA refresh cycles through the existing intake owner', () => {
  let connection: IndependentDatabase;
  let identityRequestId: string;
  let nativeManager: string;
  let targetId: string;
  let configuration: PublicDataRefreshConfiguration;
  let revision = 0;
  let retainedLeague: Record<string, unknown>;
  beforeAll(async () => {
    connection = createIndependentDatabase();
    expect((await connection.database.query('SELECT session_user AS role'))[0].role).toBe('league_one_runtime');
    // Reuse an actual fixture acquisition from the earlier source-to-reader case.
    // Absence is a fixture failure, never manufactured identity/acceptance evidence.
    const [identity] = await connection.database.query(`SELECT identity.intake_id,account.external_manager_id
      FROM public.public_data_identity_observations identity
      JOIN public.league_source_manager_accounts account ON account.id=identity.source_manager_account_id
      WHERE account.provider='sleeper' AND identity.username='synthetic_manager' ORDER BY identity.request_completed_at LIMIT 1`);
    if (identity) {
      identityRequestId = String(identity.intake_id);
      nativeManager = String(identity.external_manager_id);
      const [source] = await connection.database.query('SELECT bootstrap_payload FROM public.public_data_league_candidates WHERE intake_id=$1 AND season=2181', [identityRequestId]);
      if (!source?.bootstrap_payload || typeof source.bootstrap_payload !== 'object') throw new Error('Missing retained league fixture.');
      retainedLeague = source.bootstrap_payload as Record<string, unknown>;
    } else {
      // A focused run creates its own pre-enrolled synthetic league, like the
      // maintained source-to-reader fixture above. This is not fresh-fleet
      // capacity proof. Identity itself still uses actual restricted admission,
      // HTTP parsing and checkpointing; no identity receipt is inserted by owner.
      const native = `6${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
      retainedLeague = { league_id: native, season: '2181', sport: 'nfl', name: 'Focused recurring SQL fixture',
        total_rosters: 1, settings: {}, roster_positions: ['QB', 'BN'], scoring_settings: { rec_yd: 0.1, unsupported_bonus: 2 } };
      const jobs = createProjectionStore(connection.database);
      const registered = await jobs.registerLeagueSeason({ leagueKey: `sleeper-${native}`, leagueName: String(retainedLeague.name),
        sleeperLeagueId: native, season: 2181, scoringRules: { rec_yd: 0.1, unsupported_bonus: 2 } });
      if (registered.kind !== 'stored') throw new Error('Focused recurrence fixture registration unavailable.');
      await ownerQuery("INSERT INTO public.league_administration_enrollments(league_id,provider,active,evidence) VALUES($1,'sleeper',false,'public-data-intake-v1')", [registered.value.leagueId]);
      await ownerQuery("INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2181,'sleeper','public-data-intake-v1')", [registered.value.leagueId]);
      identityRequestId = randomUUID(); nativeManager = '555';
      const intake = createPublicIntakeStore(connection.database);
      await intake.submit({ id: identityRequestId, username: 'synthetic_manager', seasons: [2181] });
      const capture = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
        const url = String(input);
        if (url.endsWith('/user/synthetic_manager')) return new Response(JSON.stringify({ user_id: nativeManager, username: 'synthetic_manager' }));
        if (url.endsWith(`/user/${nativeManager}/leagues/nfl/2181`)) return new Response('[]');
        throw new Error('Unexpected focused prerequisite source scope.');
      });
      try {
        for (const resource of ['identity', 'leagues']) {
          let done = false;
          const until = Date.now() + 150_000;
          while (Date.now() < until) {
            const result = await runPublicIntakeStep(identityRequestId, { intake, jobs,
              administration: createLeagueAdministrationStore(connection.database) }, AbortSignal.timeout(20_000));
            if (['busy', 'backoff'].includes(result.status)) { await delay(1_000); continue; }
            expect(result).toMatchObject({ status: 'progress', resource }); done = true; break;
          }
          expect(done).toBe(true);
        }
      } finally { capture.mockRestore(); }
    }
    targetId = randomUUID();
    configuration = { id: targetId, expectedRevision: 0, identityRequestId, seasons: [2181], cadenceSeconds: 60,
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), paused: false };
  }, 330_000);
  afterAll(async () => {
    if (revision) await createPublicDataRefreshStore(connection.database).configure({ ...configuration, expectedRevision: revision,
      expiresAt: new Date(Date.now() + 60_000).toISOString(), paused: true }).catch(() => undefined);
    await connection.close();
  });
  async function claim(database = connection.database, deadlineMs = 20_000) {
    const jobs = createProjectionStore(database);
    const workerId = randomUUID();
    const acquired = await jobs.acquireJob({ jobKey: PUBLIC_INTAKE_JOB, jobType: PUBLIC_INTAKE_JOB, workerId,
      scheduledFor: new Date().toISOString(), leaseSeconds: 25, payload: { policy: 'public-data-refresh-v1', mode: 'recurring' } });
    if (acquired.kind !== 'acquired') throw new Error('Refresh fixture could not acquire the existing public job.');
    return { jobs, fence: { jobKey: PUBLIC_INTAKE_JOB, workerId, generation: acquired.attempt,
      deadlineAt: new Date(Date.now() + deadlineMs).toISOString() } };
  }
  async function reconfigure(patch: Partial<PublicDataRefreshConfiguration>) {
    const input = { ...configuration, ...patch, expectedRevision: revision };
    const result = await createPublicDataRefreshStore(connection.database).configure(input);
    revision = result.configurationRevision;
    configuration = input;
    return result;
  }

  it('retains one cycle through concurrent selectors, unknown acknowledgements, poisoned selection and sequential approval checks', async () => {
    const database = connection.database;
    const refresh = createPublicDataRefreshStore(database);
    const configured = await refresh.configure(configuration);
    revision = configured.configurationRevision;
    expect(await refresh.configure(configuration)).toMatchObject({ status: 'replayed', configurationRevision: revision });
    await expect(refresh.configure({ ...configuration, id: randomUUID() })).rejects.toThrow('already has a refresh target');
    const owner = await claim();
    const other = createIndependentDatabase();
    try {
      const [left, right] = await Promise.all([refresh.select(owner.fence), createPublicDataRefreshStore(other.database).select(owner.fence)]);
      expect(left.status).toBe('selected');
      expect(right).toEqual(left);
      if (left.status !== 'selected') throw new Error('Missing selected cycle.');
      expect(await database.query('SELECT * FROM public.public_data_refresh_cycles WHERE target_id=$1', [targetId])).toHaveLength(1);
      const [request] = await database.query('SELECT username,seasons FROM public.public_data_intakes WHERE id=$1', [left.requestId]);
      expect(request).toEqual({ username: nativeManager, seasons: [2181] });
      const ambiguous: DatabaseClient = { ...database, async query<Row extends DatabaseRow = DatabaseRow>(statement: string, parameters: readonly unknown[] = []) {
        const rows = await database.query<Row>(statement, parameters);
        if (statement.includes('select_public_data_refresh')) throw new Error('synthetic selection acknowledgement lost');
        return rows;
      } };
      await expect(createPublicDataRefreshStore(ambiguous).select(owner.fence)).rejects.toThrow('acknowledgement lost');
      expect(await refresh.select(owner.fence)).toEqual(left);
      const failed = await refresh.recordSelectionFailure(null, owner.fence, 'selection-failed');
      expect(failed.status).toBe('recorded');
      expect(await refresh.recordSelectionFailure(left, owner.fence, 'selection-failed')).toMatchObject({ status: 'already-recorded', retryAt: failed.retryAt });
      expect((await database.query('SELECT last_served_at,selection_failure_count FROM public.public_data_refresh_targets WHERE id=$1', [targetId]))[0])
        .toEqual({ last_served_at: null, selection_failure_count: 1 });
      expect(await database.query('SELECT * FROM public.public_data_refresh_selection_failures WHERE target_id=$1', [targetId])).toHaveLength(1);
      // Corrected configuration resets eligibility, retaining its earlier failure.
      await reconfigure({ paused: true });
      expect(await refresh.recordSelectionFailure(left, owner.fence, 'request-state-failed')).toEqual({ status: 'superseded' });
      const intake = createPublicIntakeStore(database);
      const work = await intake.next(left.requestId);
      if (typeof work === 'string') throw new Error('Missing selected work.');
      expect(await intake.admit(work, owner.fence)).toBe(false);
      await expect(refresh.configure({ ...configuration, expectedRevision: revision, seasons: [2182] }))
        .rejects.toThrow('unfinished refresh cycle');
      await expect(refresh.configure({ ...configuration, expectedRevision: 0, cadenceSeconds: 61 })).rejects.toThrow('revision changed');
      await reconfigure({ paused: false, expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });
      expect(await intake.admit(work, owner.fence)).toBe(false); // old approval token remains stale
    } finally { await owner.jobs.failJob(PUBLIC_INTAKE_JOB, owner.fence.workerId, 'metadata-only refresh oracle'); await other.close(); }
    const resumed = await claim();
    try {
      const selected = await refresh.select(resumed.fence);
      expect(selected).toMatchObject({ status: 'selected', targetId, cycle: 1, cycleConfigurationRevision: 1, configurationRevision: revision });
      if (selected.status !== 'selected') throw new Error('Missing resumed request.');
      const [cycle] = await database.query('SELECT intake_id FROM public.public_data_refresh_cycles WHERE target_id=$1 AND cycle=1', [targetId]);
      expect(selected.requestId).toBe(cycle.intake_id);
      const read = await readPublicDataRefresh(database, createLeagueAdministrationStore(database), targetId);
      expect(read.status).toBe('available');
      expect(read).toMatchObject({ target: { configurationRevision: revision }, cycle: { number: 1, configurationRevision: 1, requestId: selected.requestId } });
      // Unknown admission is reconciled by actual durable evidence. This attempt
      // waits for the real global interval and never issues a provider request.
      const [due] = await database.query("SELECT greatest(0,extract(epoch FROM max(admitted_at)+interval '61 seconds'-clock_timestamp())) AS seconds FROM public.public_data_dispatches");
      if (Number(due.seconds) > 0) {
        // This invocation cannot extend its original20s fence while waiting.
        expect(await createPublicIntakeStore(database).admit(await createPublicIntakeStore(database).next(selected.requestId) as PublicIntakeWork, resumed.fence)).toBe(false);
        expect((await database.query('SELECT last_served_at FROM public.public_data_refresh_targets WHERE id=$1', [targetId]))[0].last_served_at).toBeNull();
      }
    } finally { await resumed.jobs.failJob(PUBLIC_INTAKE_JOB, resumed.fence.workerId, 'metadata-only refresh resume'); }
    await reconfigure({ expiresAt: new Date(Date.now() + 3_000).toISOString() });
    const expiring = await claim();
    try {
      const selected = await refresh.select(expiring.fence);
      if (selected.status !== 'selected') throw new Error('Missing expiring approval selection.');
      const intake = createPublicIntakeStore(database);
      const work = await intake.next(selected.requestId);
      if (typeof work === 'string') throw new Error('Missing expiry work.');
      await delay(Math.max(0, Date.parse(configuration.expiresAt) - Date.now()) + 100);
      expect(await intake.admit(work, expiring.fence)).toBe(false);
      expect(await database.query('SELECT * FROM public.public_data_dispatches WHERE worker_id=$1 AND generation=$2',
        [expiring.fence.workerId, expiring.fence.generation])).toHaveLength(0);
      expect((await database.query('SELECT selection_failure_count FROM public.public_data_refresh_targets WHERE id=$1', [targetId]))[0].selection_failure_count).toBe(0);
    } finally {
      await expiring.jobs.failJob(PUBLIC_INTAKE_JOB, expiring.fence.workerId, 'expected expired refresh approval');
      await reconfigure({ expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });
    }
  });

  it('defers a failed selection without giving it admission credit or monopolizing another verified target', async () => {
    const database = connection.database;
    const [otherIdentity] = await database.query(`SELECT identity.intake_id FROM public.public_data_identity_observations identity
      JOIN public.league_source_manager_accounts account ON account.id=identity.source_manager_account_id
      WHERE account.provider='sleeper' AND account.external_manager_id<>$1 AND identity.username='identity_lock_fixture'
      ORDER BY identity.request_completed_at LIMIT 1`, [nativeManager]);
    if (!otherIdentity) throw new Error('Fairness oracle requires the preceding genuine identity-lock fixture acquisition.');
    const refresh = createPublicDataRefreshStore(database);
    const otherTarget = randomUUID();
    const input = { ...configuration, id: otherTarget, expectedRevision: 0, identityRequestId: String(otherIdentity.intake_id) };
    await refresh.configure(input);
    const first = await claim();
    let firstRequest = '';
    try {
      const selected = await refresh.select(first.fence);
      expect(selected).toMatchObject({ status: 'selected', targetId });
      if (selected.status !== 'selected') throw new Error('Missing poisoned selection fixture.');
      firstRequest = selected.requestId;
      await refresh.recordSelectionFailure(selected, first.fence, 'request-state-failed');
    } finally { await first.jobs.failJob(PUBLIC_INTAKE_JOB, first.fence.workerId, 'synthetic pre-admission outage'); }
    const second = await claim();
    try {
      const selected = await refresh.select(second.fence);
      expect(selected).toMatchObject({ status: 'selected', targetId: otherTarget });
      if (selected.status !== 'selected') throw new Error('Missing fair second target.');
      expect(selected.requestId).not.toBe(firstRequest);
      expect(await database.query('SELECT last_served_at FROM public.public_data_refresh_targets WHERE id=ANY($1::uuid[]) ORDER BY id', [[targetId, otherTarget]]))
        .toEqual([{ last_served_at: null }, { last_served_at: null }]);
      expect(await database.query('SELECT * FROM public.public_data_dispatches WHERE worker_id=ANY($1::text[])', [[first.fence.workerId, second.fence.workerId]])).toHaveLength(0);
    } finally {
      await second.jobs.failJob(PUBLIC_INTAKE_JOB, second.fence.workerId, 'no HTTP in fairness selection oracle');
      await refresh.configure({ ...input, expectedRevision: 1, paused: true });
      await reconfigure({ paused: false });
    }
  });
  it('rejects private helpers and direct cursor/history writes, and rolls back selection after an actual job-lock expiry', async () => {
    const database = connection.database;
    for (const table of ['public_data_refresh_targets', 'public_data_refresh_configurations', 'public_data_refresh_cycles',
      'public_data_refresh_cycle_outcomes', 'public_data_refresh_selection_failures']) {
      const [rights] = await database.query(`SELECT has_table_privilege(current_user,$1,'SELECT') AS readable,
        has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS writable`, [`public.${table}`]);
      expect(rights).toEqual({ readable: true, writable: false });
      await expect(database.query(`DELETE FROM public.${table}`)).rejects.toThrow(/permission denied/u);
    }
    for (const signature of ['assert_public_refresh_owner(jsonb)', 'admit_public_data_dispatch_v34(jsonb,jsonb)']) {
      expect((await database.query('SELECT has_function_privilege(current_user,$1,\'EXECUTE\') AS allowed', [`public.${signature}`]))[0].allowed).toBe(false);
      expect((await database.query("SELECT COALESCE(bool_or(acl.grantee=0 AND acl.privilege_type='EXECUTE'),false) AS allowed FROM pg_proc fn CROSS JOIN LATERAL aclexplode(COALESCE(fn.proacl,acldefault('f',fn.proowner))) acl WHERE fn.oid=to_regprocedure($1)", [`public.${signature}`]))[0].allowed).toBe(false);
    }
    const runtime = await createPinnedIntegrationDatabase('runtime');
    const blocker = await createPinnedIntegrationDatabase('owner');
    const owner = await claim(database, 2_000);
    let blocked = false;
    let pending: Promise<unknown> | undefined;
    try {
      await runtime.database.query("SET statement_timeout='8s'");
      const [session] = await runtime.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
      expect(session.role).toBe('league_one_runtime');
      const [blocking] = await blocker.database.query('SELECT pg_backend_pid() AS pid');
      await blocker.database.query('BEGIN'); blocked = true;
      await blocker.database.query('SELECT job_key FROM public.projection_jobs WHERE job_key=$1 FOR UPDATE', [PUBLIC_INTAKE_JOB]);
      pending = createPublicDataRefreshStore(runtime.database).select(owner.fence).then(() => ({ ok: true }), error => ({ ok: false, error }));
      let reached = false;
      const observeUntil = Date.now() + 1_500;
      while (Date.now() < observeUntil) {
        const [state] = await ownerQuery('SELECT $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocked', [session.pid, blocking.pid]);
        if (state.blocked) { reached = true; break; }
        await delay(20);
      }
      expect(reached, 'Selector must actually block on the job row.').toBe(true);
      await delay(Math.max(0, Date.parse(owner.fence.deadlineAt) - Date.now()) + 100);
      await blocker.database.query('ROLLBACK'); blocked = false;
      expect(await pending).toMatchObject({ ok: false, error: { message: expect.stringContaining('lease lost') } });
      expect((await database.query('SELECT payload FROM public.projection_jobs WHERE job_key=$1', [PUBLIC_INTAKE_JOB]))[0].payload)
        .not.toHaveProperty('refreshSelection');
      expect(await database.query('SELECT * FROM public.public_data_refresh_cycles WHERE target_id=$1', [targetId])).toHaveLength(1);
    } finally {
      if (blocked) { await delay(Math.max(0, Date.parse(owner.fence.deadlineAt) - Date.now()) + 100); await blocker.database.query('ROLLBACK'); }
      await pending;
      await owner.jobs.failJob(PUBLIC_INTAKE_JOB, owner.fence.workerId, 'expected selector lock expiry');
      await runtime.close(); await blocker.close();
    }
  }, 15_000);

  /** AUTHORED / UNEXECUTED: observed PostgreSQL lock waits, not simultaneous
   * Promise creation alone, establish each competing transaction's barrier.
   * The admission-first case may wait the real remaining 61-second interval;
   * the expiry case waits five real seconds. These add runtime beyond metadata
   * checks. No full-suite fit in the 30/40-minute lifecycle has been measured. */
  async function expectBlocked(waiterPid: unknown, blockerPid: unknown) {
    const until = Date.now() + 2_500;
    let blocked = false;
    while (Date.now() < until) {
      const [state] = await ownerQuery('SELECT $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocked', [waiterPid, blockerPid]);
      if (state.blocked) { blocked = true; break; }
      await delay(20);
    }
    expect(blocked, 'Competing SQL statement must reach the observed lock barrier.').toBe(true);
  }

  it('serializes competing configuration CAS calls behind one observed lock and retains only the winning revision', async () => {
    const blocker = await createPinnedIntegrationDatabase('owner');
    const left = await createPinnedIntegrationDatabase('runtime');
    const right = await createPinnedIntegrationDatabase('runtime');
    let open = false;
    const pending: Promise<PromiseSettledResult<Awaited<ReturnType<ReturnType<typeof createPublicDataRefreshStore>['configure']>>>>[] = [];
    const inputs = [61, 62].map(cadenceSeconds => ({ ...configuration, expectedRevision: revision, cadenceSeconds }));
    const before = await connection.database.query('SELECT * FROM public.public_data_refresh_configurations WHERE target_id=$1 ORDER BY revision', [targetId]);
    try {
      const [ownerSession] = await blocker.database.query('SELECT pg_backend_pid() AS pid');
      const sessions = [];
      for (const client of [left, right]) {
        await client.database.query("SET statement_timeout='8s'");
        const [session] = await client.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
        expect(session.role).toBe('league_one_runtime'); sessions.push(session);
      }
      await blocker.database.query('BEGIN'); open = true;
      await blocker.database.query("SELECT pg_advisory_xact_lock(hashtextextended('public-data-refresh-configuration',0))");
      for (const [index, client] of [left, right].entries()) {
        pending.push(createPublicDataRefreshStore(client.database).configure(inputs[index])
          .then(value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason })));
        await expectBlocked(sessions[index].pid, ownerSession.pid);
      }
      await blocker.database.query('COMMIT'); open = false;
      const outcomes = await Promise.all(pending);
      expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
      const winner = outcomes.findIndex(outcome => outcome.status === 'fulfilled');
      const winning = outcomes[winner];
      if (winning.status !== 'fulfilled') throw new Error('Missing CAS winner.');
      expect(outcomes[1 - winner]).toMatchObject({ status: 'rejected', reason: { message: expect.stringContaining('revision changed') } });
      expect(winning.value.configurationRevision).toBe(revision + 1);
      revision = winning.value.configurationRevision; configuration = inputs[winner];
      const after = await connection.database.query('SELECT * FROM public.public_data_refresh_configurations WHERE target_id=$1 ORDER BY revision', [targetId]);
      expect(after.slice(0, -1)).toEqual(before);
      expect(after).toHaveLength(before.length + 1);
    } finally {
      if (open) await blocker.database.query('ROLLBACK');
      await Promise.all(pending);
      await left.close(); await right.close(); await blocker.close();
    }
    await reconfigure({ cadenceSeconds: 60 });
  });

  it('observes a pause commit win against an admission already waiting on the target row', async () => {
    const pauser = await createPinnedIntegrationDatabase('runtime');
    const admitting = await createPinnedIntegrationDatabase('runtime');
    const owner = await claim();
    let open = false;
    let pending: Promise<boolean> | undefined;
    try {
      const selected = await createPublicDataRefreshStore(connection.database).select(owner.fence);
      if (selected.status !== 'selected') throw new Error('Missing pause race selection.');
      const intake = createPublicIntakeStore(admitting.database);
      const work = await intake.next(selected.requestId);
      if (typeof work === 'string') throw new Error('Missing pause race work.');
      await admitting.database.query("SET statement_timeout='8s'");
      const [pauseSession] = await pauser.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
      const [admitSession] = await admitting.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
      expect([pauseSession.role, admitSession.role]).toEqual(['league_one_runtime', 'league_one_runtime']);
      await pauser.database.query('BEGIN'); open = true;
      const input = { ...configuration, expectedRevision: revision, paused: true };
      const configured = await createPublicDataRefreshStore(pauser.database).configure(input);
      pending = intake.admit(work, owner.fence);
      // Attach a handler immediately while the assertion inspects the live wait.
      const settled = pending.then(value => ({ value }), error => ({ error }));
      await expectBlocked(admitSession.pid, pauseSession.pid);
      await pauser.database.query('COMMIT'); open = false;
      revision = configured.configurationRevision; configuration = input;
      expect(await settled).toEqual({ value: false });
      expect(await connection.database.query('SELECT * FROM public.public_data_dispatches WHERE worker_id=$1 AND generation=$2',
        [owner.fence.workerId, owner.fence.generation])).toEqual([]);
      expect(await connection.database.query('SELECT * FROM public.public_data_refresh_selection_failures WHERE worker_id=$1 AND generation=$2',
        [owner.fence.workerId, owner.fence.generation])).toEqual([]);
    } finally {
      if (open) await pauser.database.query('ROLLBACK');
      await pending?.catch(() => undefined);
      await owner.jobs.failJob(PUBLIC_INTAKE_JOB, owner.fence.workerId, 'observed pause-before-admission barrier');
      await admitting.close(); await pauser.close();
      await reconfigure({ paused: false });
    }
  });

  it('rejects approval that expires during an observed target-row admission wait under the original live fence', async () => {
    const blocker = await createPinnedIntegrationDatabase('owner');
    const admitting = await createPinnedIntegrationDatabase('runtime');
    await admitting.database.query("SET statement_timeout='10s'");
    const [ownerSession] = await blocker.database.query('SELECT pg_backend_pid() AS pid');
    const [admitSession] = await admitting.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
    const owner = await claim();
    let open = false;
    let pending: Promise<boolean> | undefined;
    try {
      expect(admitSession.role).toBe('league_one_runtime');
      // Start the short approval only after connection setup has finished.
      await reconfigure({ expiresAt: new Date(Date.now() + 5_000).toISOString() });
      const selected = await createPublicDataRefreshStore(connection.database).select(owner.fence);
      if (selected.status !== 'selected') throw new Error('Missing expiring race selection.');
      const intake = createPublicIntakeStore(admitting.database);
      const work = await intake.next(selected.requestId);
      if (typeof work === 'string') throw new Error('Missing expiring race work.');
      await blocker.database.query('BEGIN'); open = true;
      await blocker.database.query('SELECT id FROM public.public_data_refresh_targets WHERE id=$1 FOR UPDATE', [targetId]);
      pending = intake.admit(work, owner.fence);
      const settled = pending.then(value => ({ value }), error => ({ error }));
      await expectBlocked(admitSession.pid, ownerSession.pid);
      await delay(Math.max(0, Date.parse(configuration.expiresAt) - Date.now()) + 100);
      expect((await ownerQuery('SELECT clock_timestamp()<$1::timestamptz AS live', [owner.fence.deadlineAt]))[0].live).toBe(true);
      await blocker.database.query('ROLLBACK'); open = false;
      expect(await settled).toEqual({ value: false });
      expect(await connection.database.query('SELECT * FROM public.public_data_dispatches WHERE worker_id=$1 AND generation=$2',
        [owner.fence.workerId, owner.fence.generation])).toEqual([]);
    } finally {
      if (open) await blocker.database.query('ROLLBACK');
      await pending?.catch(() => undefined);
      await owner.jobs.failJob(PUBLIC_INTAKE_JOB, owner.fence.workerId, 'observed approval expiry at admission lock');
      await admitting.close(); await blocker.close();
      await reconfigure({ expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });
    }
  });

  it('retains a real admitted capture when a competing pause waits for that admission to commit', async () => {
    // The interval is the real durable admission interval, outside any job claim.
    const [due] = await connection.database.query("SELECT greatest(0,extract(epoch FROM max(admitted_at)+interval '61 seconds'-clock_timestamp())) AS seconds FROM public.public_data_dispatches");
    if (Number(due.seconds) > 0) await delay(Number(due.seconds) * 1_000);
    const admitting = await createPinnedIntegrationDatabase('runtime');
    const pauser = await createPinnedIntegrationDatabase('runtime');
    const owner = await claim();
    let open = false;
    let pending: ReturnType<ReturnType<typeof createPublicDataRefreshStore>['configure']> | undefined;
    const capture = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (String(input).endsWith(`/user/${nativeManager}`)) return new Response(JSON.stringify({ user_id: nativeManager, username: 'admission_race_manager' }));
      throw new Error('Unexpected admission race fixture source scope.');
    });
    try {
      const selected = await createPublicDataRefreshStore(connection.database).select(owner.fence);
      if (selected.status !== 'selected') throw new Error('Missing admission-first selection.');
      const intake = createPublicIntakeStore(admitting.database);
      const work = await intake.next(selected.requestId);
      if (typeof work === 'string' || work.kind !== 'identity') throw new Error('Admission race requires the untouched first-cycle identity step.');
      await pauser.database.query("SET statement_timeout='8s'");
      await admitting.database.query("SET statement_timeout='8s'");
      const [admitSession] = await admitting.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
      const [pauseSession] = await pauser.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
      expect([admitSession.role, pauseSession.role]).toEqual(['league_one_runtime', 'league_one_runtime']);
      await admitting.database.query('BEGIN'); open = true;
      expect(await intake.admit(work, owner.fence)).toBe(true);
      const input = { ...configuration, expectedRevision: revision, paused: true };
      pending = createPublicDataRefreshStore(pauser.database).configure(input);
      const settled = pending.then(value => ({ value }), error => ({ error }));
      await expectBlocked(pauseSession.pid, admitSession.pid);
      await admitting.database.query('COMMIT'); open = false;
      const configured = await settled;
      if (!('value' in configured)) throw configured.error;
      revision = configured.value.configurationRevision; configuration = input;
      // Acquisition and checkpoint remain bound to the already admitted owner;
      // pausing prevents new admission but cannot rewrite this original fence.
      const witness = validateRequestedPublicCaptureWitness(await intake.captureWitness!(work, null, owner.fence), work, null, owner.fence);
      const document = await capturePublicSleeperIdentity(work.username, AbortSignal.timeout(Math.max(1, Date.parse(owner.fence.deadlineAt) - Date.now())), witness);
      assertOriginalPublicCapture(document, witness);
      await intake.recordIdentity(work, document, owner.fence);
      expect(capture).toHaveBeenCalledTimes(1);
      expect(await intake.next(selected.requestId)).toMatchObject({ kind: 'leagues' });
      expect(await connection.database.query('SELECT outcome FROM public.public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2',
        [owner.fence.workerId, owner.fence.generation])).toEqual([{ outcome: 'checkpoint-committed' }]);
      expect(await connection.database.query(`SELECT outcome.capture_acquisition,
        outcome.capture_acquisition->>'dispatchNonce'=dispatch.capture_nonce::text
          AND outcome.capture_acquisition->'work'=dispatch.work
          AND outcome.capture_acquisition->'fence'->>'workerId'=dispatch.worker_id
          AND outcome.capture_acquisition->'fence'->>'generation'=dispatch.generation::text AS exact_witness
        FROM public.public_data_dispatch_outcomes outcome JOIN public.public_data_dispatches dispatch
          ON dispatch.worker_id=outcome.worker_id AND dispatch.generation=outcome.generation
        WHERE outcome.worker_id=$1 AND outcome.generation=$2`, [owner.fence.workerId, owner.fence.generation]))
        .toEqual([{ capture_acquisition: witness, exact_witness: true }]);
      expect(await connection.database.query('SELECT * FROM public.public_data_refresh_selection_failures WHERE worker_id=$1 AND generation=$2',
        [owner.fence.workerId, owner.fence.generation])).toEqual([]);
    } finally {
      if (open) await admitting.database.query('ROLLBACK');
      await pending?.catch(() => undefined);
      capture.mockRestore();
      await owner.jobs.failJob(PUBLIC_INTAKE_JOB, owner.fence.workerId, 'observed admission-before-pause barrier');
      await pauser.close(); await admitting.close();
      await reconfigure({ paused: false });
    }
  }, 100_000);

  const refreshHistoryTables = ['public_data_refresh_configurations', 'public_data_refresh_cycles',
    'public_data_refresh_cycle_outcomes', 'public_data_refresh_selection_failures'] as const;
  async function retainedRefreshHistory() {
    return Promise.all(refreshHistoryTables.map(async table => ({ table,
      rows: await connection.database.query(`SELECT * FROM public.${table} WHERE target_id=$1 ORDER BY to_jsonb(${table})::text`, [targetId]) })));
  }
  async function expectRetainedRefreshHistory(previous: Awaited<ReturnType<typeof retainedRefreshHistory>>) {
    for (const { table, rows } of previous) {
      const current = await connection.database.query(`SELECT * FROM public.${table} WHERE target_id=$1`, [targetId]);
      // New cycles/configurations may append rows; every original full row,
      // including source revision, times and disposition, must remain identical.
      expect(current).toEqual(expect.arrayContaining([...rows]));
    }
  }

  it('refreshes two typed core cycles with real admission spacing, a correction and lost-checkpoint replay [focused slow SQL]', async () => {
    const diagnostics = createPublicDataDiagnostics('refresh');
    const admissionAckFault = diagnostics.expectedFault('admission-ack-loss');
    const coreCheckpointFault = diagnostics.expectedFault('core-checkpoint-loss');
    const pairedCleanupFault = diagnostics.expectedFault('paired-cleanup-loss');
    try {
    const database = connection.database;
    expect((await database.query('SELECT session_user AS role,current_user AS effective_role'))[0])
      .toEqual({ role: 'league_one_runtime', effective_role: 'league_one_runtime' });
    const receiptReader = createReceiptDiagnosticReader();
    const administration = createLeagueAdministrationStore(database);
    const intake = createPublicIntakeStore(database);
    const jobs = createProjectionStore(database);
    const refresh = createPublicDataRefreshStore(database);
    if (!revision) revision = (await refresh.configure(configuration)).configurationRevision;
    const uuid = (value: unknown): string => {
      if (typeof value !== 'string') throw new Error('Required retained identity is absent.');
      expect(value).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu);
      return value;
    };
    const native = String(retainedLeague.league_id);
    const canonicalRows = await database.query(`SELECT league.id AS league_id,season.id AS league_season_id,connection.id AS connection_id
      FROM public.league_source_connections connection JOIN public.league_seasons season ON season.id=connection.league_season_id
      JOIN public.leagues league ON league.id=season.league_id WHERE connection.provider='sleeper'
        AND connection.external_league_id=$1 AND season.season=2181`, [native]);
    expect(canonicalRows).toHaveLength(1);
    const canonical = canonicalRows[0];
    for (const value of Object.values(canonical)) uuid(value);
    expect(new Set(Object.values(canonical)).size).toBe(3);
    const originalLeague = retainedLeague;
    const originalRefreshHistory = await retainedRefreshHistory();
    const priorTerminal = new Set((await database.query(`SELECT cycle.intake_id FROM public.public_data_refresh_cycles cycle
      JOIN public.public_data_intakes request ON request.id=cycle.intake_id WHERE cycle.target_id=$1 AND request.terminal`, [targetId])).map(row => uuid(row.intake_id)));
    const selectedRequests = new Set<string>();
    let selectedThisStep: string | undefined;
    let activeResource: string | undefined;
    const acquisitions: { requestId: string; resource: string; url: string }[] = [];
    let cycleNumber = 1;
    let lostCheckpoint = false;
    let lostAdmissionAck = false;
    let pausedDuringCapture = false;
    let restoreApproval = false;
    let cleanupSuppressed = false;
    let pendingDispatchProved = false;
    let recoveryProved = false;
    let recoveryAttemptedThisStep = false;
    let callbackError: unknown;
    let unfinished: { work: PublicIntakeWork; fence: Parameters<typeof intake.completeCore>[3]; receipts: string[]; before: DatabaseRow } | undefined;
    const rawLeague = () => ({ ...originalLeague, scoring_settings: { rec_yd: cycleNumber === 1 ? 0.13 : 0.17, unsupported_bonus: 2 } });
    const rawRoster = () => [{ roster_id: 1, owner_id: cycleNumber === 1 ? '555' : '558', co_owners: [cycleNumber === 1 ? '556' : '557'],
      players: [cycleNumber === 1 ? '123' : '456'], starters: [cycleNumber === 1 ? '123' : '456'], reserve: [], taxi: [] }];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (!selectedThisStep || !activeResource) throw new Error('Provider acquisition has no selected request/admitted work.');
      acquisitions.push({ requestId: selectedThisStep, resource: activeResource, url });
      if (url.endsWith(`/user/${nativeManager}`)) return new Response(JSON.stringify({ user_id: nativeManager, username: `refresh_manager_${cycleNumber}` }));
      if (url.endsWith(`/user/${nativeManager}/leagues/nfl/2181`)) return new Response(JSON.stringify([rawLeague()]));
      if (url.endsWith(`/league/${native}`)) return new Response(JSON.stringify(rawLeague()));
      if (url.endsWith(`/league/${native}/rosters`)) return new Response(JSON.stringify(rawRoster()));
      if (url.endsWith(`/league/${native}/users`)) return new Response(JSON.stringify(['555','556','557','558'].map(user_id => ({ user_id, display_name: user_id }))));
      throw new Error('Unexpected recurring source scope.');
    });
    const receiptIds: string[][] = [];
    const immutableReceipts: DatabaseRow[][] = [];
    const seenRequests: string[] = [];
    let firstCycleHistory: Awaited<ReturnType<typeof retainedRefreshHistory>> | undefined;
    let firstCycleEvidence: { statement: string; parameters: readonly unknown[]; rows: readonly DatabaseRow[] }[] | undefined;
    let canonicalTeam: string | undefined;
    const noPeriodAccess = new Set<string>();
    const checkpointWithoutPeriodAccess = async (...args: Parameters<typeof intake.completeCore>) => {
      const reader = await createPinnedIntegrationDatabase('runtime');
      const blocker = await createPinnedIntegrationDatabase('owner'); let open = false;
      try {
        expect((await reader.database.query('SELECT session_user AS role'))[0].role).toBe('league_one_runtime');
        // Warm rowtype/function binding outside the lock; neither call can mutate.
        await createPublicIntakeStore(reader.database).next(args[0].requestId);
        await diagnostics.observe('case.wrong-owner-negative', async () => {
          await expect(reader.database.query("SELECT public.checkpoint_public_data_intake('{}'::jsonb,'{}'::jsonb,'{}'::jsonb)")).rejects.toThrow('wrong public intake owner');
        });
        await reader.database.query("SET statement_timeout='5s'");
        await blocker.database.query('BEGIN'); open = true;
        await blocker.database.query('LOCK TABLE public.public_data_exact_period_tasks,public.public_data_exact_period_checkpoints IN ACCESS EXCLUSIVE MODE');
        const locks = await blocker.database.query(`SELECT relation::regclass::text AS relation FROM pg_locks WHERE pid=pg_backend_pid()
          AND mode='AccessExclusiveLock' AND granted AND relation IN ('public.public_data_exact_period_tasks'::regclass,'public.public_data_exact_period_checkpoints'::regclass)`);
        expect(locks).toHaveLength(2);
        // Real default-directory completion executes the no-candidate and terminal
        // next-work branches. A task-table SELECT/UPDATE would block and time out.
        await createPublicIntakeStore(reader.database).completeCore(...args);
        expect(await createPublicIntakeStore(reader.database).next(args[0].requestId)).toBe('complete');
        noPeriodAccess.add(args[0].requestId);
      } catch (error) { callbackError = error; throw error; }
      finally { if (open) await blocker.database.query('ROLLBACK'); await reader.close(); await blocker.close(); }
    };
    const snapshotFirstCycle = async () => {
      const requestId = seenRequests[0]; const ids = receiptIds[0];
      firstCycleHistory = await retainedRefreshHistory();
      for (const table of ['public_data_refresh_configurations', 'public_data_refresh_cycles', 'public_data_refresh_cycle_outcomes']) {
        expect(firstCycleHistory.find(entry => entry.table === table)?.rows.length).toBeGreaterThan(0);
      }
      const requestTables = ['public_data_identity_observations','public_data_league_lists','public_data_league_candidates',
        'public_data_directory_captures','public_data_dispatches'] as const;
      const definitions: { statement: string; parameters: readonly unknown[] }[] = requestTables.map(table => ({
        statement: `SELECT * FROM public.${table} WHERE intake_id=$1 ORDER BY to_jsonb(${table})::text`, parameters: [requestId] }));
      definitions.push({ statement: 'SELECT * FROM public.public_data_intakes WHERE id=$1', parameters: [requestId] },
        { statement: `SELECT outcome.* FROM public.public_data_dispatch_outcomes outcome JOIN public.public_data_dispatches dispatch
          USING(worker_id,generation) WHERE dispatch.intake_id=$1 ORDER BY outcome.worker_id,outcome.generation`, parameters: [requestId] });
      for (const [table, predicate] of [
        ['league_roster_capture_receipts', 'id=ANY($1::uuid[])'],
        ['league_roster_resource_attempts', 'id IN (SELECT attempt_id FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[]))'],
        ['league_roster_resource_acceptances', 'receipt_id=ANY($1::uuid[])'],
        ['league_administration_contents', 'id IN (SELECT content_id FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[]))'],
        ['league_administration_observations', 'id IN (SELECT legacy_observation_id FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[]))'],
        ['league_administration_team_entries', 'content_id IN (SELECT content_id FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[]))'],
        ['league_team_manager_entries', 'content_id IN (SELECT content_id FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[]))'],
        ['league_team_manager_memberships', 'content_id IN (SELECT content_id FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[]))'],
      ]) definitions.push({ statement: `SELECT * FROM public.${table} WHERE ${predicate} ORDER BY to_jsonb(${table})::text`, parameters: [ids] });
      firstCycleEvidence = [];
      for (const definition of definitions) {
        const rows = await database.query(definition.statement, definition.parameters);
        expect(rows.length, `First completed cycle must populate ${definition.statement}`).toBeGreaterThan(0);
        firstCycleEvidence.push({ ...definition, rows });
      }
    };
    try {
      // The two source cycles retain the original 18-minute loop / 19-minute test
      // limits. No hook, admission, retry or qualification deadline is enlarged.
      const until = Date.now() + 18 * 60_000;
      while (Date.now() < until && seenRequests.length < 2) {
        if (restoreApproval) { await reconfigure({ paused: false }); restoreApproval = false; }
        selectedThisStep = undefined; activeResource = undefined; recoveryAttemptedThisStep = false;
        const acquisitionCount = acquisitions.length;
        diagnostics.beginStep(cycleNumber);
        const outcome = await runPublicDataRefreshStep(observePublicDataDependencies(diagnostics, {
          refresh: { ...refresh, select: async fence => {
            const selected = await refresh.select(fence);
            try {
              if (selected.status === 'selected') {
                expect(selected.targetId).toBe(targetId);
                selectedThisStep = uuid(selected.requestId); selectedRequests.add(selectedThisStep);
                expect(priorTerminal.has(selectedThisStep)).toBe(false);
              }
              // Selection records the first terminal outcome before any second
              // cycle acquisition. Snapshot actual full populated history here.
              if (seenRequests.length === 1 && !firstCycleEvidence) await snapshotFirstCycle();
            } catch (error) { callbackError = error; throw error; }
            return selected;
          } }, administration, jobs, managerEvidenceVersion: 'v2',
          source: { identity: capturePublicSleeperIdentity, leagues: capturePublicSleeperLeagueList,
            core: (id, family, signal, witness) => capturePublicSleeperCore(id, family, signal, undefined, witness) },
          intake: { ...intake,
            recover: async (requestId, fence) => {
              if (!unfinished || recoveryProved) return intake.recover(requestId, fence);
              recoveryAttemptedThisStep = true;
              try {
                expect(requestId).toBe(unfinished.work.requestId);
                expect(fence.workerId).not.toBe(unfinished.fence.workerId);
                const before = await database.query('SELECT revision,failure_count FROM public.public_data_intakes WHERE id=$1', [requestId]);
                expect(before).toEqual([unfinished.before]);
                const dispatches = await database.query('SELECT * FROM public.public_data_dispatches WHERE intake_id=$1 ORDER BY admitted_at', [requestId]);
                await intake.recover(requestId, fence);
                const after = await database.query('SELECT revision,failure_count FROM public.public_data_intakes WHERE id=$1', [requestId]);
                expect(after).toEqual([{ revision: Number(unfinished.before.revision) + 1, failure_count: Number(unfinished.before.failure_count) + 1 }]);
                expect(await database.query('SELECT outcome FROM public.public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2',
                  [unfinished.fence.workerId, unfinished.fence.generation])).toEqual([{ outcome: 'recovered' }]);
                await intake.recover(requestId, fence);
                expect(await database.query('SELECT revision,failure_count FROM public.public_data_intakes WHERE id=$1', [requestId])).toEqual(after);
                expect(await database.query('SELECT * FROM public.public_data_dispatches WHERE intake_id=$1 ORDER BY admitted_at', [requestId])).toEqual(dispatches);
                expect(await intake.next(requestId)).toBe('backoff');
                recoveryProved = true;
              } catch (error) { callbackError = error; throw error; }
            },
            admit: async (work, fence) => {
              if (work.requestId !== selectedThisStep) { callbackError = new Error('Admitted work differs from selected request.'); throw callbackError; }
              const admitted = await intake.admit(work, fence);
              if (admitted) activeResource = work.kind;
              if (admitted && !lostAdmissionAck) { lostAdmissionAck = true; throw admissionAckFault; }
              if (admitted && !pausedDuringCapture) { await reconfigure({ paused: true }); pausedDuringCapture = true; restoreApproval = true; }
              return admitted;
            },
            completeCore: async (work, mapping, captured, fence) => {
              if (cycleNumber === 2 && work.kind === 'core' && !lostCheckpoint) {
                lostCheckpoint = true;
                const [before] = await database.query('SELECT revision,failure_count FROM public.public_data_intakes WHERE id=$1', [work.requestId]);
                unfinished = { work, fence, before, receipts: [captured.receipts?.settings, captured.receipts?.players, captured.receipts?.managers].map(uuid) };
                throw coreCheckpointFault;
              }
              if (work.kind === 'users') await checkpointWithoutPeriodAccess(work, mapping, captured, fence);
              else await intake.completeCore(work, mapping, captured, fence);
            },
            fail: async (work, fence) => {
              if (unfinished && !cleanupSuppressed && fence.workerId === unfinished.fence.workerId
                && fence.generation === unfinished.fence.generation && work.requestId === unfinished.work.requestId
                && work.revision === unfinished.work.revision) {
                cleanupSuppressed = true; // one exact failed dispatch only; every later cleanup delegates normally
                throw pairedCleanupFault;
              }
              await intake.fail(work, fence);
            } },
        }, receiptReader), AbortSignal.timeout(20_000));
        diagnostics.checkOutcome(outcome); // Unexpected swallowed boundary failures stop before waiting or reading later state.
        if (callbackError) throw diagnostics.failure('case.assertion', callbackError);
        expect(['progress','busy','backoff','idle','unavailable','complete','partial']).toContain(outcome.status);
        if (unfinished && !pendingDispatchProved) {
          expect(cleanupSuppressed).toBe(true);
          expect(outcome).toMatchObject({ status: 'unavailable', resource: 'core', providerRequests: 2 });
          expect(await database.query(`SELECT dispatch.resource,dispatch.max_requests,outcome.outcome FROM public.public_data_dispatches dispatch
            LEFT JOIN public.public_data_dispatch_outcomes outcome USING(worker_id,generation)
            WHERE dispatch.worker_id=$1 AND dispatch.generation=$2 AND dispatch.intake_id=$3`,
          [unfinished.fence.workerId, unfinished.fence.generation, unfinished.work.requestId]))
            .toEqual([{ resource: 'core', max_requests: 2, outcome: null }]);
          expect(await database.query('SELECT revision,failure_count FROM public.public_data_intakes WHERE id=$1', [unfinished.work.requestId])).toEqual([unfinished.before]);
          expect(await database.query('SELECT id FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[])', [unfinished.receipts])).toHaveLength(3);
          expect(await database.query('SELECT stage,settings_receipt_id,players_receipt_id,managers_receipt_id FROM public.public_data_league_candidates WHERE intake_id=$1', [unfinished.work.requestId]))
            .toEqual([{ stage: 'core', settings_receipt_id: null, players_receipt_id: null, managers_receipt_id: null }]);
          pendingDispatchProved = true;
        }
        if (recoveryAttemptedThisStep) {
          expect(recoveryProved).toBe(true);
          expect(outcome).toMatchObject({ status: 'backoff', providerRequests: 0 });
          expect(acquisitions).toHaveLength(acquisitionCount);
        }
        const cycles = await database.query(`SELECT cycle.cycle,cycle.intake_id,request.terminal FROM public.public_data_refresh_cycles cycle
          JOIN public.public_data_intakes request ON request.id=cycle.intake_id JOIN public.public_data_refresh_targets target
            ON target.id=cycle.target_id AND target.current_cycle=cycle.cycle WHERE target.id=$1`, [targetId]);
        for (const cycle of cycles) {
          const requestId = uuid(cycle.intake_id);
          if (!cycle.terminal || seenRequests.includes(requestId) || priorTerminal.has(requestId)) continue;
          expect(selectedRequests.has(requestId)).toBe(true);
          const composed = await diagnostics.observe('reader.refresh', () => readPublicDataRefresh(database, administration, targetId, { managerEvidenceVersion: 'v2' }));
          expect(composed).toMatchObject({ status: 'available', target: { id: targetId, externalManagerId: nativeManager },
            cycle: { requestId, number: Number(cycle.cycle) }, intake: { status: 'available' } });
          if (composed.status !== 'available' || !composed.intake || composed.intake.status === 'missing') throw new Error('Missing composed recurring readback.');
          expect(composed.intake.leagues).toHaveLength(1);
          const expectedOwner = cycleNumber === 1 ? '555' : '558';
          const expectedCo = cycleNumber === 1 ? '556' : '557';
          const expectedPlayer = cycleNumber === 1 ? '123' : '456';
          expect(composed.intake.leagues[0]).toMatchObject({ leagueSeasonId: canonical.league_season_id, externalLeagueId: native,
            resources: { settings: { status: 'available', value: { scoring: { rules: { state: 'known', value: { rec_yd: cycleNumber === 1 ? 0.13 : 0.17 } } } } },
              heldRoster: { status: 'available', teams: [{ externalRosterId: '1', players: [{ sourceEntity: { provider: 'sleeper', nativeId: expectedPlayer } }] }] },
              teamManagers: { status: 'available', teams: [{ sourceTeam: { nativeId: '1' }, primaryOwner: { state: 'owned', manager: { sourceManager: { nativeId: expectedOwner } } },
                coManagers: { state: 'known', completeness: 'complete', managers: [{ sourceManager: { nativeId: expectedCo } }] } }] },
              teamManagerEvidence: { status: 'available', evidenceCompleteness: 'complete', teams: [{ primaryOwner: { state: 'owned', manager: { sourceManager: { nativeId: expectedOwner } } },
                coManagers: { state: 'known', completeness: 'complete', managers: [{ sourceManager: { nativeId: expectedCo } }] } }] }, directory: { status: 'available' } } });
          const mapping = await administration.readSourceMapping(native);
          if (!mapping) throw new Error('Missing retained canonical source mapping.');
          expect(mapping).toMatchObject({ leagueSeasonId: canonical.league_season_id, connectionId: canonical.connection_id });
          const evidence = await administration.readAcceptedTeamManagerEvidence?.(mapping);
          const managers = await administration.readAcceptedTeamManagers(mapping);
          const players = await administration.readAcceptedCurrentRoster(mapping);
          if (!evidence || evidence.status !== 'available' || managers.status !== 'available' || players.status !== 'available') throw new Error('Missing typed identities.');
          expect(managers.teams).toHaveLength(1); expect(evidence.teams).toHaveLength(1); expect(players.teams).toHaveLength(1);
          const teamId = uuid(managers.teams[0].seasonTeamId);
          if (canonicalTeam) expect(teamId).toBe(canonicalTeam); else canonicalTeam = teamId;
          expect([players.teams[0].seasonTeamId, evidence.teams[0].seasonTeamId]).toEqual([teamId, teamId]);
          expect(new Set([...Object.values(canonical), teamId]).size).toBe(4);
          const primary = managers.teams[0].primaryOwner; const co = managers.teams[0].coManagers;
          if (primary.state !== 'owned' || co.state !== 'known') throw new Error('Missing primary/co-manager identity.');
          expect(co.managers).toHaveLength(1);
          const managerIds = [uuid(primary.manager.providerManagerId), uuid(co.managers[0].providerManagerId)];
          expect(new Set(managerIds).size).toBe(2);
          expect(await database.query('SELECT id,external_manager_id FROM public.league_source_manager_accounts WHERE id=ANY($1::uuid[]) ORDER BY external_manager_id', [managerIds]))
            .toEqual([{ id: managerIds[0], external_manager_id: expectedOwner }, { id: managerIds[1], external_manager_id: expectedCo }].sort((a, b) => a.external_manager_id.localeCompare(b.external_manager_id)));
          const candidates = await database.query('SELECT * FROM public.public_data_league_candidates WHERE intake_id=$1', [requestId]);
          expect(candidates).toHaveLength(1); const captured = candidates[0];
          expect(captured).toMatchObject({ intake_id: requestId, season: 2181, external_league_id: native, league_season_id: canonical.league_season_id, stage: 'complete' });
          for (const field of ['league_season_id','league_observation_id','roster_observation_id','users_observation_id','users_capture_id']) uuid(captured[field]);
          const ids = [captured.settings_receipt_id, captured.players_receipt_id, captured.managers_receipt_id, evidence.receipt.id].map(uuid);
          expect(new Set(ids).size).toBe(4);
          expect([players.receipt.id, managers.receipt.id]).toEqual([ids[1], ids[2]]);
          const receipts = await database.query('SELECT * FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[]) ORDER BY id', [ids]);
          expect(receipts).toHaveLength(4);
          const accepted = await database.query('SELECT id,receipt_id,source_mapping_revision_id FROM public.league_roster_resource_acceptances WHERE receipt_id=ANY($1::uuid[])', [ids]);
          expect(accepted).toHaveLength(4); expect(new Set(accepted.map(row => uuid(row.id))).size).toBe(4);
          expect(new Set(accepted.map(row => row.source_mapping_revision_id))).toEqual(new Set([mapping.revisionId]));
          receiptIds.push(ids); immutableReceipts.push([...receipts]); seenRequests.push(requestId); cycleNumber = 2;
        }
        if (seenRequests.length < 2) await delay(1_000);
      }
      expect(seenRequests).toHaveLength(2); expect(new Set(seenRequests).size).toBe(2);
      expect(selectedRequests).toEqual(new Set(seenRequests));
      expect(noPeriodAccess).toEqual(new Set(seenRequests));
      expect(lostAdmissionAck).toBe(true); expect(pausedDuringCapture).toBe(true); expect(lostCheckpoint).toBe(true);
      expect(cleanupSuppressed).toBe(true); expect(pendingDispatchProved).toBe(true); expect(recoveryProved).toBe(true);
      if (!firstCycleHistory || !firstCycleEvidence) throw new Error('First-cycle retained history was not captured before the second acquisition.');
      await expectRetainedRefreshHistory(originalRefreshHistory); await expectRetainedRefreshHistory(firstCycleHistory);
      for (const evidence of firstCycleEvidence) expect(await database.query(evidence.statement, evidence.parameters)).toEqual(evidence.rows);
      expect(receiptIds[1].some(id => receiptIds[0].includes(id))).toBe(false);
      expect(await database.query('SELECT * FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[]) ORDER BY id', [receiptIds[0]])).toEqual(immutableReceipts[0]);
      expect(acquisitions.filter(capture => capture.requestId === seenRequests[0] && capture.resource === 'core')).toHaveLength(2);
      expect(acquisitions.filter(capture => capture.requestId === seenRequests[1] && capture.resource === 'core')).toHaveLength(4);
      expect(acquisitions.every(capture => seenRequests.includes(capture.requestId))).toBe(true);
      expect(await database.query(`SELECT dispatch.worker_id FROM public.public_data_dispatches dispatch LEFT JOIN public.public_data_dispatch_outcomes outcome
        USING(worker_id,generation) WHERE dispatch.intake_id=ANY($1::uuid[]) AND outcome.worker_id IS NULL`, [seenRequests])).toHaveLength(0);
      const [spacing] = await database.query(`SELECT bool_and(gap>=interval '60 seconds') AS bounded FROM (
        SELECT admitted_at-lag(admitted_at) OVER (ORDER BY admitted_at) AS gap FROM public.public_data_dispatches) spacing`);
      expect(spacing.bounded).toBe(true);
      const [cursor] = await database.query(`SELECT target.last_served_at=(SELECT max(dispatch.admitted_at) FROM public.public_data_dispatches dispatch
        JOIN public.public_data_refresh_cycles cycle ON cycle.intake_id=dispatch.intake_id WHERE cycle.target_id=target.id) AS exact_admission
        FROM public.public_data_refresh_targets target WHERE target.id=$1`, [targetId]);
      expect(cursor.exact_admission).toBe(true);
      expect(await database.query(`SELECT failure.* FROM public.public_data_refresh_selection_failures failure
        JOIN public.public_data_dispatches dispatch USING(worker_id,generation) WHERE failure.reason='admission-unconfirmed'
          AND failure.target_id=$1`, [targetId])).toHaveLength(0);
    } finally { fetch.mockRestore(); }
    } catch (error) { throw diagnostics.failure('case', error); }
    finally { await diagnostics.save(); }
  }, 19 * 60_000);

  it('retains two empty-list cycles without relabeling previous typed data or replaying missed cadence slots [focused slow SQL]', async () => {
    const database = connection.database;
    const refresh = createPublicDataRefreshStore(database);
    if (!revision) revision = (await refresh.configure(configuration)).configurationRevision;
    const administration = createLeagueAdministrationStore(database);
    const prior = await database.query(`SELECT cycle.intake_id FROM public.public_data_refresh_cycles cycle
      JOIN public.public_data_intakes request ON request.id=cycle.intake_id WHERE cycle.target_id=$1 AND request.terminal`, [targetId]);
    const priorRefreshHistory = await retainedRefreshHistory();
    const completed = new Set(prior.map(row => String(row.intake_id)));
    const newCycles: string[] = [];
    const capture = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith(`/user/${nativeManager}`)) return new Response(JSON.stringify({ user_id: nativeManager, username: 'empty_cycle_manager' }));
      if (url.endsWith(`/user/${nativeManager}/leagues/nfl/2181`)) return new Response('[]');
      throw new Error('Unexpected source in empty-list recurrence oracle.');
    });
    try {
      const until = Date.now() + 8 * 60_000;
      while (Date.now() < until && newCycles.length < 2) {
        const result = await runPublicDataRefreshStep({ refresh, administration, intake: createPublicIntakeStore(database), jobs: createProjectionStore(database) }, AbortSignal.timeout(20_000));
        expect(['progress','busy','backoff','idle','complete']).toContain(result.status);
        const rows = await database.query(`SELECT cycle.intake_id FROM public.public_data_refresh_cycles cycle
          JOIN public.public_data_intakes request ON request.id=cycle.intake_id WHERE cycle.target_id=$1 AND request.terminal ORDER BY cycle.cycle`, [targetId]);
        for (const row of rows) {
          const requestId = String(row.intake_id);
          if (completed.has(requestId)) continue;
          const read = await readPublicSleeperIntake(database, administration, requestId);
          expect(read).toMatchObject({ status: 'available', leagues: [], rejected: [] });
          completed.add(requestId); newCycles.push(requestId);
        }
        if (newCycles.length < 2) await delay(1_000);
      }
      expect(newCycles).toHaveLength(2);
      expect(new Set(newCycles).size).toBe(2);
      await expectRetainedRefreshHistory(priorRefreshHistory);
      const [cadence] = await database.query(`SELECT bool_and(outcome.next_due_at>outcome.recorded_at
        AND outcome.next_due_at<=outcome.recorded_at+interval '60 seconds') AS skips_missed
        FROM public.public_data_refresh_cycle_outcomes outcome WHERE outcome.target_id=$1`, [targetId]);
      expect(cadence.skips_missed).toBe(true);
      const read = await readPublicDataRefresh(database, administration, targetId);
      expect(read).toMatchObject({ status: 'available', cycle: { requestId: newCycles[1] }, intake: { status: 'available', leagues: [] } });
    } finally { capture.mockRestore(); }
  }, 9 * 60_000);
  it('refuses owner UPDATE and DELETE of existing immutable refresh history and preserves later-cycle rows', async () => {
    // This intentionally uses the owner LOGIN so an ACL rejection cannot stand
    // in for the immutable-history trigger. All attempts are rolled back even
    // if an absent guard unexpectedly permits a mutation.
    const owner = await createPinnedIntegrationDatabase('owner');
    let open = false;
    try {
      const [role] = await owner.database.query('SELECT session_user AS role,current_user AS effective_role');
      expect(role.role).toBe(role.effective_role);
      expect(role.role).not.toBe('league_one_runtime');
      await owner.database.query('BEGIN'); open = true;
      for (const table of refreshHistoryTables) {
        const before = await owner.database.query(`SELECT * FROM public.${table} WHERE target_id=$1 ORDER BY to_jsonb(${table})::text`, [targetId]);
        expect(before.length, `${table} requires an actual retained row from the preceding SQL cases.`).toBeGreaterThan(0);
        const column = table === 'public_data_refresh_configurations' ? 'configured_at'
          : table === 'public_data_refresh_cycles' ? 'created_at' : 'recorded_at';
        for (const statement of [`UPDATE public.${table} SET ${column}=${column}+interval '1 second' WHERE target_id=$1`,
          `DELETE FROM public.${table} WHERE target_id=$1`]) {
          await owner.database.query('SAVEPOINT immutable_refresh_attempt');
          try { await expect(owner.database.query(statement, [targetId])).rejects.toThrow('league administration history is immutable'); }
          finally {
            await owner.database.query('ROLLBACK TO SAVEPOINT immutable_refresh_attempt');
            await owner.database.query('RELEASE SAVEPOINT immutable_refresh_attempt');
          }
          expect(await owner.database.query(`SELECT * FROM public.${table} WHERE target_id=$1 ORDER BY to_jsonb(${table})::text`, [targetId])).toEqual(before);
        }
        expect(await connection.database.query(`SELECT * FROM public.${table} WHERE target_id=$1 ORDER BY to_jsonb(${table})::text`, [targetId])).toEqual(before);
      }
    } finally {
      if (open) await owner.database.query('ROLLBACK');
      await owner.close();
    }
  });

  it('shares the existing sixteen-pending-request limit with manual submissions without spending admission credit', async () => {
    const database = connection.database;
    const refresh = createPublicDataRefreshStore(database);
    if (!revision) revision = (await refresh.configure(configuration)).configurationRevision;
    // Observe terminal completion once, then wait the real next cadence without
    // holding a job, database transaction or extended work fence.
    const settlement = await claim();
    try { await refresh.select(settlement.fence); }
    finally { await settlement.jobs.failJob(PUBLIC_INTAKE_JOB, settlement.fence.workerId, 'capacity fixture cadence observation'); }
    const [due] = await database.query('SELECT greatest(0,extract(epoch FROM next_due_at-clock_timestamp())) AS seconds FROM public.public_data_refresh_targets WHERE id=$1', [targetId]);
    await delay(Number(due.seconds) * 1_000 + 100);
    await reconfigure({ paused: true });
    const runtime = await createPinnedIntegrationDatabase('runtime');
    const owner = await claim(runtime.database);
    let open = false;
    try {
      await runtime.database.query('BEGIN'); open = true;
      const bound = createPublicDataRefreshStore(runtime.database);
      // Acquire job/capacity in the maintained order before filling the pending
      // queue. Any selected current request is retained, never reset for this test.
      expect(await bound.select(owner.fence)).toMatchObject({ status: 'idle' });
      const [before] = await runtime.database.query('SELECT count(*)::integer AS count FROM public.public_data_intakes WHERE NOT terminal');
      const intake = createPublicIntakeStore(runtime.database);
      for (let index = Number(before.count); index < 16; index++) {
        await intake.submit({ id: randomUUID(), username: `capacity_fixture_${index}`, seasons: [2199] });
      }
      await runtime.database.query('SAVEPOINT pending_limit');
      await expect(intake.submit({ id: randomUUID(), username: 'seventeenth_pending_fixture', seasons: [2199] })).rejects.toThrow('capacity reached');
      await runtime.database.query('ROLLBACK TO SAVEPOINT pending_limit');
      await runtime.database.query('RELEASE SAVEPOINT pending_limit');
      expect((await runtime.database.query('SELECT count(*)::integer AS count FROM public.public_data_intakes WHERE NOT terminal'))[0].count).toBe(16);
      await bound.configure({ ...configuration, expectedRevision: revision, paused: false });
      expect(await bound.select(owner.fence)).toMatchObject({ status: 'capacity' });
      expect((await runtime.database.query('SELECT count(*)::integer AS count FROM public.public_data_intakes WHERE NOT terminal'))[0].count).toBe(16);
      expect(await runtime.database.query('SELECT * FROM public.public_data_dispatches WHERE worker_id=$1 AND generation=$2',
        [owner.fence.workerId, owner.fence.generation])).toHaveLength(0);
      await runtime.database.query('ROLLBACK'); open = false;
    } finally {
      if (open) await runtime.database.query('ROLLBACK');
      await owner.jobs.failJob(PUBLIC_INTAKE_JOB, owner.fence.workerId, 'rolled back manual/recurring capacity fixture');
      await runtime.close();
      await reconfigure({ paused: false });
    }
  }, 150_000);

  it('copies explicit periods into a new ordinary cycle and preserves original scope across replay and configuration CAS [R038 metadata only]', async () => {
    // Existing genuinely captured identity; all new configuration/cycle rows in
    // this metadata oracle roll back. No dispatch or provider credit is invented.
    const database = connection.database;
    // The preceding capacity oracle already settled this terminal cycle. Selecting
    // again could create a due unscoped cycle before the scoped configuration.
    const settled = await database.query(`SELECT request.terminal,outcome.disposition
      FROM public.public_data_refresh_targets target
      JOIN public.public_data_refresh_cycles cycle ON cycle.target_id=target.id AND cycle.cycle=target.current_cycle
      JOIN public.public_data_intakes request ON request.id=cycle.intake_id
      LEFT JOIN public.public_data_refresh_cycle_outcomes outcome ON outcome.target_id=cycle.target_id AND outcome.cycle=cycle.cycle
      WHERE target.id=$1`, [targetId]);
    expect(settled).toEqual([{ terminal: true, disposition: 'complete' }]);
    const [due] = await database.query('SELECT greatest(0,extract(epoch FROM next_due_at-clock_timestamp())) AS seconds FROM public.public_data_refresh_targets WHERE id=$1', [targetId]);
    await delay(Number(due.seconds) * 1_000 + 100);
    const runtime = await createPinnedIntegrationDatabase('runtime');
    const owner = await claim(runtime.database); let open = false;
    try {
      expect((await runtime.database.query('SELECT session_user AS role'))[0].role).toBe('league_one_runtime');
      await runtime.database.query('BEGIN'); open = true;
      const refresh = createPublicDataRefreshStore(runtime.database);
      const scoped = { ...configuration, expectedRevision: revision, exactPeriods: [{ season: 2181, nativeWeek: 7 }], paused: false };
      const ambiguous: DatabaseClient = { ...runtime.database, async query<Row extends DatabaseRow = DatabaseRow>(statement: string, parameters: readonly unknown[] = []) {
        const rows = await runtime.database.query<Row>(statement, parameters);
        if (statement.includes('configure_public_data_refresh')) throw new Error('period configuration acknowledgment lost');
        return rows;
      } };
      await expect(createPublicDataRefreshStore(ambiguous).configure(scoped)).rejects.toThrow('acknowledgment lost');
      expect(await refresh.configure(scoped)).toMatchObject({ status: 'replayed', configurationRevision: revision + 1 });
      const selected = await refresh.select(owner.fence);
      expect(selected).toMatchObject({ status: 'selected', targetId, configurationRevision: revision + 1, cycleConfigurationRevision: revision + 1 });
      if (selected.status !== 'selected') throw new Error('Missing period-scoped metadata selection.');
      expect(await refresh.select(owner.fence)).toEqual(selected);
      const [request] = await runtime.database.query('SELECT exact_periods FROM public.public_data_intakes WHERE id=$1', [selected.requestId]);
      expect(request.exact_periods).toEqual(scoped.exactPeriods);
      await runtime.database.query('SAVEPOINT period_scope_change');
      try { await expect(refresh.configure({ ...scoped, expectedRevision: revision + 1, exactPeriods: [{ season: 2181, nativeWeek: 8 }] })).rejects.toThrow('unfinished refresh cycle'); }
      finally { await runtime.database.query('ROLLBACK TO SAVEPOINT period_scope_change'); await runtime.database.query('RELEASE SAVEPOINT period_scope_change'); }
      await refresh.configure({ ...scoped, expectedRevision: revision + 1, paused: true });
      expect(await readPublicDataRefresh(runtime.database, createLeagueAdministrationStore(runtime.database), targetId))
        .toMatchObject({ status: 'available', target: { configurationRevision: revision + 2 },
          cycle: { requestId: selected.requestId, configurationRevision: revision + 1, exactPeriods: scoped.exactPeriods },
          intake: { request: { exactPeriods: scoped.exactPeriods } } });
      expect(await runtime.database.query('SELECT * FROM public.public_data_dispatches WHERE worker_id=$1 AND generation=$2', [owner.fence.workerId, owner.fence.generation])).toHaveLength(0);
      await runtime.database.query('ROLLBACK'); open = false;
    } finally {
      if (open) await runtime.database.query('ROLLBACK');
      await owner.jobs.failJob(PUBLIC_INTAKE_JOB, owner.fence.workerId, 'rolled back exact period selection metadata');
      await runtime.close();
    }
  }, 150_000);

  it('counts paused synthetic metadata targets toward the total16 bound using a genuine restricted configure call', async () => {
    // OWNER SETUP ONLY: synthetic identity and paused-target metadata isolates
    // this negative count boundary. It is NOT ingestion, admission or resource
    // proof. It inserts no typed acceptance, capture receipt, dispatch, or outcome
    // and changes neither the limit nor the real clock. The separate coordinator
    // case above supplies actual normalizer→writer→reader acquisition proof.
    const owner = await createPinnedIntegrationDatabase('owner');
    let open = false;
    let spareIdentity = '';
    try {
      await owner.database.query('BEGIN'); open = true;
      const [count] = await owner.database.query('SELECT count(*)::integer AS count FROM public.public_data_refresh_targets');
      for (let index = Number(count.count); index <= 16; index++) {
        const identity = randomUUID(); const manager = randomUUID(); const target = randomUUID();
        const native = `8${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
        await owner.database.query('INSERT INTO public.league_source_manager_accounts(id,provider,external_manager_id) VALUES($1,\'sleeper\',$2)', [manager, native]);
        await owner.database.query("INSERT INTO public.public_data_intakes(id,username,seasons,terminal) VALUES($1,$2,ARRAY[2199],true)", [identity, native]);
        await owner.database.query(`INSERT INTO public.public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,
          payload,request_started_at,request_completed_at) VALUES($1,$2,$3,$3,jsonb_build_object('user_id',$3::text,'username',$3::text),clock_timestamp(),clock_timestamp())`,
        [identity, manager, native]);
        if (index === 16) { spareIdentity = identity; continue; }
        await owner.database.query("INSERT INTO public.public_data_refresh_targets(id,provider,source_manager_account_id,configuration_revision) VALUES($1,'sleeper',$2,1)", [target, manager]);
        await owner.database.query(`INSERT INTO public.public_data_refresh_configurations(target_id,revision,identity_request_id,seasons,cadence_seconds,expires_at,paused)
          VALUES($1,1,$2,ARRAY[2199],60,clock_timestamp()+interval '1 hour',true)`, [target, identity]);
      }
      await owner.database.query('COMMIT'); open = false;
    } finally { if (open) await owner.database.query('ROLLBACK'); await owner.close(); }
    expect((await connection.database.query('SELECT count(*)::integer AS count FROM public.public_data_refresh_targets'))[0].count).toBe(16);
    expect((await connection.database.query('SELECT session_user AS role'))[0].role).toBe('league_one_runtime');
    await expect(createPublicDataRefreshStore(connection.database).configure({ id: randomUUID(), expectedRevision: 0,
      identityRequestId: spareIdentity, seasons: [2199], cadenceSeconds: 60, expiresAt: new Date(Date.now() + 60_000).toISOString(), paused: true }))
      .rejects.toThrow('target capacity reached');
    expect((await connection.database.query('SELECT count(*)::integer AS count FROM public.public_data_refresh_targets'))[0].count).toBe(16);
  }, 90_000);
});


/** R037 AUTHORED / UNEXECUTED. The optional-field matrix uses one explicitly
 * owner-enrolled synthetic NULL-profile identity; this is writer/reader proof,
 * not a substitute for the separate genuinely admitted bootstrap recovery case. */
describe('official preconfiguration source normalization to restricted typed storage', () => {
  let connection: IndependentDatabase;
  beforeAll(() => { connection = createIndependentDatabase(); });
  afterAll(async () => connection.close());
  it('recovers the same NULL-profile identity after canonical registration commits before the bootstrap checkpoint [focused slow SQL]', async () => {
    // Real identity/list/bootstrap/core/directory admissions plus one retry:
    // at least five60-second gaps, possibly one initial interval. No fake clock,
    // skipped admission, owner enrollment, or fabricated accepted resource.
    const database = connection.database;
    expect((await database.query('SELECT session_user AS role'))[0].role).toBe('league_one_runtime');
    const [capacity] = await database.query(`SELECT (SELECT count(*) FROM league_administration_enrollments)
      +(SELECT count(*) FROM public_data_collection_reservations reservation WHERE NOT EXISTS(
        SELECT 1 FROM league_source_connections connection JOIN league_seasons season ON season.id=connection.league_season_id
        JOIN league_administration_enrollments enrollment ON enrollment.league_id=season.league_id
        WHERE connection.provider='sleeper' AND connection.external_league_id=reservation.external_league_id)) AS used`);
    expect(Number(capacity.used), 'Fresh official registration requires one genuine isolated collection slot.').toBeLessThan(16);
    const id = randomUUID();
    const native = `4${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
    const season = 2193;
    const league = { league_id: native, season: String(season), sport: 'nfl', name: 'Fresh unconfigured DATA league', total_rosters: 1, settings: {} };
    const roster = [{ roster_id: 1, owner_id: native, co_owners: [], players: [], starters: [], reserve: [], taxi: [] }];
    const intake = createPublicIntakeStore(database);
    const jobs = createProjectionStore(database);
    const administration = createLeagueAdministrationStore(database);
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith(`/user/official_recovery_${native}`)) return new Response(JSON.stringify({ user_id: native, username: `official_${native}` }));
      if (url.endsWith(`/user/${native}/leagues/nfl/${season}`)) return new Response(JSON.stringify([league]));
      if (url.endsWith(`/league/${native}`)) return new Response(JSON.stringify(league));
      if (url.endsWith(`/league/${native}/rosters`)) return new Response(JSON.stringify(roster));
      if (url.endsWith(`/league/${native}/users`)) return new Response(JSON.stringify([{ user_id: native, display_name: 'Official preconfiguration manager' }]));
      throw new Error('Unexpected official registration recovery source scope.');
    });
    if (!database.queryAfterLock) throw new Error('Actual fenced registration transaction is required.');
    const locked = database.queryAfterLock.bind(database);
    let interrupted = false;
    const interruptedDatabase: DatabaseClient = { ...database,
      queryAfterLock: async <Row extends DatabaseRow = DatabaseRow>(...args: Parameters<NonNullable<DatabaseClient['queryAfterLock']>>) => {
        const rows = await locked<Row>(...args);
        if (!interrupted && args[0].includes('projection-store:register-league-season')) {
          interrupted = true; throw new Error('canonical identity committed; bootstrap checkpoint not reached');
        }
        return rows;
      } };
    const dependencies = { intake, jobs, administration };
    const progress = async (selected = dependencies) => {
      const deadline = Date.now() + 155_000;
      while (Date.now() < deadline) {
        const result = await runPublicIntakeStep(id, selected, AbortSignal.timeout(20_000));
        if (!['busy', 'backoff'].includes(result.status)) return result;
        await delay(1_000);
      }
      throw new Error('Real official registration admission did not become due.');
    };
    const identity = () => database.query(`SELECT league.id AS league_id,season.id AS league_season_id,season.scoring_profile_id,
      connection.id AS connection_id,connection.current_mapping_revision_id FROM leagues league
      JOIN league_seasons season ON season.league_id=league.id
      JOIN league_source_connections connection ON connection.league_season_id=season.id
      WHERE league.league_key=$1 AND season.season=$2 AND connection.provider='sleeper'`, [`sleeper-${native}`, season]);
    try {
      await intake.submit({ id, username: `official_recovery_${native}`, seasons: [season] });
      for (const resource of ['identity', 'leagues']) expect(await progress()).toMatchObject({ status: 'progress', resource });
      expect(await progress({ ...dependencies, intake: createPublicIntakeStore(interruptedDatabase) }))
        .toMatchObject({ status: 'unavailable', resource: 'bootstrap' });
      expect(interrupted).toBe(true);
      const committed = await identity();
      expect(committed).toHaveLength(1);
      expect(committed[0].scoring_profile_id).toBeNull();
      expect(await database.query('SELECT * FROM public_data_collection_reservations WHERE external_league_id=$1', [native])).toHaveLength(1);
      expect((await database.query('SELECT league_season_id,bootstrap_payload FROM public_data_league_candidates WHERE intake_id=$1', [id]))[0])
        .toMatchObject({ league_season_id: null, bootstrap_payload: null });
      for (const resource of ['bootstrap', 'core', 'users']) expect(await progress()).toMatchObject({ status: 'progress', resource });
      expect(await identity()).toEqual(committed);
      const read = await readPublicSleeperIntake(database, administration, id);
      expect(read).toMatchObject({ status: 'available', leagues: [{ resources: {
        settings: { status: 'available', value: { scoring: { rules: { state: 'absent', value: null } }, slots: { state: 'absent', value: null } } },
        heldRoster: { status: 'available' }, teamManagers: { status: 'available' }, directory: { status: 'available' } } }] });
      expect(await database.query(`SELECT active,evidence FROM league_administration_enrollments WHERE league_id=$1`, [committed[0].league_id]))
        .toEqual([{ active: false, evidence: 'public-data-intake-v1' }]);
      expect((await administration.listEnrollmentInventory(season)).entries.some(entry => entry.intended.leagueId === committed[0].league_id)).toBe(false);
      expect(await database.query('SELECT * FROM league_period_authorities WHERE league_key=$1', [`sleeper-${native}`])).toEqual([]);
      const [counts] = await database.query(`SELECT count(*)::integer AS attempts,count(DISTINCT worker_id||':'||generation)::integer AS owners
        FROM public_data_dispatches WHERE intake_id=$1 AND resource='bootstrap'`, [id]);
      expect(counts).toEqual({ attempts: 2, owners: 2 });
    } finally { fetch.mockRestore(); }
  }, 10 * 60_000);

  it('retains all nine missing/null/empty scoring and slot combinations, rejects malformed fields and versions later rules', async () => {
    const database = connection.database;
    expect((await database.query('SELECT session_user AS role'))[0].role).toBe('league_one_runtime');
    const store = createProjectionStore(database);
    const administration = createLeagueAdministrationStore(database);
    const native = `7${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
    const season = 2194;
    const registered = await store.registerLeagueSeason({ mode: 'official-data', leagueKey: `sleeper-${native}`,
      leagueName: 'Official preconfiguration matrix', sleeperLeagueId: native, season });
    if (registered.kind !== 'stored') throw new Error('Official registration unavailable.');
    expect(registered.value.scoringProfileId).toBeNull();
    // Explicit immutable metadata setup only. Neither accepted content nor
    // capture/acceptance/dispatch rows are fabricated by the fixture owner.
    await ownerQuery(`INSERT INTO league_administration_enrollments(league_id,provider,active,evidence)
      VALUES($1,'sleeper',false,'public-data-intake-v1')`, [registered.value.leagueId]);
    await ownerQuery(`INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence)
      VALUES($1,$2,'sleeper','public-data-intake-v1')`, [registered.value.leagueId, season]);
    const mapping = await administration.readSourceMapping(native);
    if (!mapping) throw new Error('Missing official-only source mapping.');
    let payload: Record<string, unknown> = { league_id: native, season: String(season), sport: 'nfl',
      name: 'Official preconfiguration matrix', settings: {}, total_rosters: 1 };
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (String(input).endsWith(`/league/${native}`)) return new Response(JSON.stringify(payload));
      throw new Error('Unexpected preconfiguration matrix source scope.');
    });
    const write = async () => {
      const attempt = await administration.beginLeagueSettingsAttempt(mapping, randomUUID());
      const document = await capturePublicSleeperCore(native, 'league', new AbortController().signal);
      return recordCapturedAdministration(mapping.scope, [document], { store: administration, mapping, leagueSettingsAttempt: attempt });
    };
    const profileSnapshot = () => database.query('SELECT id,rules_hash,rules FROM scoring_profiles ORDER BY id');
    const profiles = await profileSnapshot();
    const acceptedReceipts: string[] = [];
    try {
      for (const scoring of ['absent', 'null', 'empty'] as const) {
        for (const slots of ['absent', 'null', 'empty'] as const) {
          delete payload.scoring_settings; delete payload.roster_positions;
          if (scoring !== 'absent') payload.scoring_settings = scoring === 'null' ? null : {};
          if (slots !== 'absent') payload.roster_positions = slots === 'null' ? null : [];
          const result = await write();
          expect(result.results[0].result.leagueSettingsAcceptance?.status).toBe('accepted');
          const read = await administration.readAcceptedLeagueSettings(mapping);
          if (read.status !== 'available') throw new Error(`Missing official settings ${scoring}/${slots}.`);
          expect(read.value.scoring.rules.state).toBe(scoring);
          expect(read.value.slots.state).toBe(slots);
          expect(read.value.scoring.rules.value).toEqual(scoring === 'empty' ? {} : null);
          expect(read.value.slots.value).toEqual(slots === 'empty' ? [] : null);
          acceptedReceipts.push(read.receipt.id);
          expect(read.receipt.provenance.origin).toBe('network');
          expect((await database.query('SELECT scoring_profile_id FROM league_seasons WHERE id=$1', [registered.value.leagueSeasonId]))[0])
            .toEqual({ scoring_profile_id: null });
        }
      }
      expect(new Set(acceptedReceipts).size).toBe(9);
      expect(await profileSnapshot()).toEqual(profiles);
      const immutableReceipts = await database.query('SELECT * FROM league_roster_capture_receipts WHERE id=ANY($1::uuid[]) ORDER BY id', [acceptedReceipts]);
      const legacyBeforeInvalid = await database.query(`SELECT accepted_observation_id FROM league_administration_heads
        WHERE league_season_id=$1 AND family='league' AND week=0`, [registered.value.leagueSeasonId]);
      expect(legacyBeforeInvalid).toEqual([{ accepted_observation_id: expect.stringMatching(/^[0-9a-f-]{36}$/u) }]);
      const versionsBeforeInvalid = await database.query('SELECT id,scoring_profile_id FROM league_configuration_versions WHERE league_season_id=$1 ORDER BY id', [registered.value.leagueSeasonId]);
      expect(versionsBeforeInvalid.length).toBeGreaterThan(0);
      for (const invalid of [{ scoring_settings: [] }, { scoring_settings: { pass_td: '4' } },
        { roster_positions: {} }, { roster_positions: [null] }]) {
        payload = { league_id: native, season: String(season), sport: 'nfl', name: 'Invalid preconfiguration',
          settings: {}, total_rosters: 1, ...invalid };
        const result = await write();
        // Identity coverage retains invalid optional source fields. Only the
        // legacy configuration is rejected; its accepted observation stays put.
        expect(result.results[0].result).toMatchObject({ status: 'rejected', leagueSettingsAcceptance: { status: 'accepted' } });
        const read = await administration.readAcceptedLeagueSettings(mapping);
        expect(read).toMatchObject({ status: 'available', receipt: {
          id: result.results[0].result.leagueSettingsAcceptance?.receiptId, configurationVersionId: null },
          comparison: { legacyConfiguration: 'rejected' } });
        if (read.status !== 'available') throw new Error('Missing invalid optional-field evidence.');
        expect('scoring_settings' in invalid ? read.value.scoring.rules : read.value.slots)
          .toEqual({ sourcePath: 'scoring_settings' in invalid ? 'scoring_settings' : 'roster_positions',
            state: 'invalid', value: null, raw: 'scoring_settings' in invalid ? invalid.scoring_settings : invalid.roster_positions });
        expect(await database.query(`SELECT accepted_observation_id FROM league_administration_heads
          WHERE league_season_id=$1 AND family='league' AND week=0`, [registered.value.leagueSeasonId])).toEqual(legacyBeforeInvalid);
        expect(await database.query('SELECT id,scoring_profile_id FROM league_configuration_versions WHERE league_season_id=$1 ORDER BY id', [registered.value.leagueSeasonId])).toEqual(versionsBeforeInvalid);
        expect(await profileSnapshot()).toEqual(profiles);
      }
      payload = { league_id: native, season: String(season), sport: 'nfl', name: 'Configured later official evidence',
        settings: {}, total_rosters: 1, scoring_settings: { pass_td: 7.037, rec: 0 }, roster_positions: ['QB', 'BN'] };
      const later = await write();
      // Typed acceptance and legacy season-profile compatibility are independent.
      expect(later.results[0].result).toMatchObject({ status: 'rejected',
        reason: 'scoring_profile_change_requires_explicit_compatibility_and_period_review',
        leagueSettingsAcceptance: { status: 'accepted' } });
      const read = await administration.readAcceptedLeagueSettings(mapping);
      expect(read).toMatchObject({ status: 'available', value: { scoring: { rules: { state: 'known', value: payload.scoring_settings } },
        slots: { state: 'known', value: [
          { nativeCode: 'QB', count: 1, ordinal: 0, semantics: 'ordered-occurrence' },
          { nativeCode: 'BN', count: 1, ordinal: 1, semantics: 'ordered-occurrence' }] } },
        comparison: { legacyConfiguration: 'equal' } });
      expect((await database.query('SELECT scoring_profile_id FROM league_seasons WHERE id=$1', [registered.value.leagueSeasonId]))[0])
        .toEqual({ scoring_profile_id: null });
      expect(await database.query(`SELECT version.scoring_profile_id FROM league_configuration_versions version
        JOIN scoring_profiles profile ON profile.id=version.scoring_profile_id
        WHERE version.league_season_id=$1 AND profile.rules=$2::jsonb`, [registered.value.leagueSeasonId, JSON.stringify(payload.scoring_settings)]))
        .toHaveLength(1);
      expect(await database.query('SELECT * FROM league_roster_capture_receipts WHERE id=ANY($1::uuid[]) ORDER BY id', [acceptedReceipts])).toEqual(immutableReceipts);
      expect((await administration.listEnrollmentInventory(season)).entries.some(entry => entry.intended.leagueId === registered.value.leagueId)).toBe(false);
    } finally { fetch.mockRestore(); }
  });
});


/** R038 AUTHORED / UNEXECUTED. Real LOGIN and real minute-spaced admissions;
 * HTTP responses alone are synthetic. The recovery case needs at least eight
 * minutes plus inherited backoff; the exhaustion case needs at least twenty
 * minutes. Bounds below are test timeouts, never measured qualification times.
 * This does not establish a full-suite fit within the 30/40-minute lifecycle. */
describe('explicit public native-period intake through retained typed receipts', () => {
  let connection: IndependentDatabase;
  beforeAll(() => { connection = createIndependentDatabase(); });
  afterAll(async () => connection.close());

  async function fixture(weeks: readonly number[] = [7]) {
    const database = connection.database;
    expect((await database.query('SELECT session_user AS role'))[0].role).toBe('league_one_runtime');
    const jobs = createProjectionStore(database); const intake = createPublicIntakeStore(database);
    const administration = createLeagueAdministrationStore(database);
    const native = `6${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
    const id = randomUUID(); const season = 2179; const nativeWeek = 7;
    const league = { league_id: native, season: String(season), sport: 'nfl', name: 'Explicit period fixture', total_rosters: 2,
      settings: {}, scoring_settings: { rec: 1 }, roster_positions: ['QB', 'BN'] };
    const rosters = [{ roster_id: 1, owner_id: native, co_owners: [], players: ['123'], starters: ['123'], reserve: [], taxi: [] },
      { roster_id: 2, owner_id: '556', co_owners: [], players: ['124'], starters: ['124'], reserve: [], taxi: [] }];
    const matchups = [{ roster_id: 1, matchup_id: 4, players: ['123'], starters: ['123'], starters_points: [8], players_points: { '123': 8 }, points: 8, custom_points: 0 },
      { roster_id: 2, matchup_id: 4, players: ['124'], starters: ['124'], starters_points: [4], players_points: { '124': 4 }, points: 4 }];
    const registered = await jobs.registerLeagueSeason({ leagueKey: `sleeper-${native}`, leagueName: league.name,
      sleeperLeagueId: native, season, scoringRules: league.scoring_settings });
    if (registered.kind !== 'stored') throw new Error('Missing isolated period identity.');
    // Owner prerequisite only: reuse canonical registration, mark this synthetic
    // customer inactive DATA. This is not fresh-fleet registration/capacity proof.
    await ownerQuery("INSERT INTO public.league_administration_enrollments(league_id,provider,active,evidence) VALUES($1,'sleeper',false,'public-data-intake-v1')", [registered.value.leagueId]);
    await ownerQuery("INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,$2,'sleeper','public-data-intake-v1')", [registered.value.leagueId, season]);
    const fault = { managers: false, directory: false, matchups: false };
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith(`/user/${native}`)) return new Response(JSON.stringify({ user_id: native, username: native }));
      if (url.endsWith(`/user/${native}/leagues/nfl/${season}`)) return new Response(JSON.stringify([league]));
      if (url.endsWith(`/league/${native}`)) return new Response(JSON.stringify(league));
      if (weeks.some(week => url.endsWith(`/league/${native}/matchups/${week}`))) {
        if (fault.matchups) throw new Error('Synthetic exact-period outage');
        return new Response(JSON.stringify(matchups));
      }
      if (url.endsWith(`/league/${native}/rosters`)) return new Response(JSON.stringify(fault.managers
        ? rosters.map(roster => ({ ...roster, owner_id: {} })) : rosters));
      if (url.endsWith(`/league/${native}/users`)) {
        if (fault.directory) throw new Error('Synthetic directory outage');
        return new Response(JSON.stringify([{ user_id: native, display_name: 'Period manager' }, { user_id: '556', display_name: 'Other' }]));
      }
      throw new Error('Unexpected exact-period provider scope.');
    });
    const periodCaptures: { family: string; requestStartedAt: string; requestCompletedAt: string; acquisition?: PublicCaptureWitness }[] = [];
    const dependencies: PublicIntakeDependencies = { intake, administration, jobs,
      source: { identity: capturePublicSleeperIdentity, leagues: capturePublicSleeperLeagueList,
        core: async (external, family, signal, witness) => {
          const captured = await capturePublicSleeperCore(external, family, signal, undefined, witness);
          periodCaptures.push(captured); return captured;
        },
        exactPeriod: async (external, week, signal, witness) => {
          const captured = await capturePublicSleeperCore(external, 'matchups', signal, week, witness);
          periodCaptures.push(captured); return captured;
        } },
    };
    const progress = async (selected = dependencies, workBudget = 20_000) => {
      const until = Date.now() + 10 * 60_000;
      while (Date.now() < until) {
        const result = await runPublicIntakeStep(id, { ...selected, deadlineAt: new Date(Date.now() + workBudget).toISOString() }, new AbortController().signal);
        if (!['busy', 'backoff'].includes(result.status)) return result;
        await delay(1_000);
      }
      throw new Error('Real exact-period admission/backoff did not become due.');
    };
    await intake.submit({ id, username: native, seasons: [season], exactPeriods: weeks.map(nativeWeek => ({ season, nativeWeek })) });
    return { database, jobs, intake, administration, native, id, season, nativeWeek, league, rosters, matchups, registered, fault, fetch, dependencies, progress, periodCaptures };
  }

  it('enforces SQL selector validation and identical omitted/empty replay before mutation', async () => {
    const runtime = await createPinnedIntegrationDatabase('runtime'); let open = false;
    // Late-role equivalent, NOT a freshly created role: the normal harness creates
    // runtime before030. Remove only this exact grant, prove absence, then execute
    // the maintained provisioner's exact optional block and restore it in finally.
    const provision = await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8');
    const grantBlock = provision.match(/-- BEGIN OPTIONAL EXACT MATCHUP RESERVATION GRANT([\s\S]*?)-- END OPTIONAL EXACT MATCHUP RESERVATION GRANT/u)?.[1];
    if (!grantBlock) throw new Error('Missing maintained exact-matchup provisioner block.');
    const witnessGrant = provision.match(/-- BEGIN OPTIONAL PUBLIC CAPTURE WITNESS GRANT([\s\S]*?)-- END OPTIONAL PUBLIC CAPTURE WITNESS GRANT/u)?.[1];
    if (!witnessGrant) throw new Error('Missing maintained capture-witness provisioner block.');
    try {
      await ownerQuery('REVOKE EXECUTE ON FUNCTION public.begin_exact_matchup_attempt(jsonb,uuid,integer,jsonb) FROM league_one_runtime');
      expect((await runtime.database.query("SELECT has_function_privilege(current_user,'public.begin_exact_matchup_attempt(jsonb,uuid,integer,jsonb)','EXECUTE') AS allowed"))[0].allowed).toBe(false);
      await expect(runtime.database.query("SELECT public.begin_exact_matchup_attempt('{}'::jsonb,$1::uuid,0,NULL)", [randomUUID()])).rejects.toMatchObject({ code: '42501' });
      await ownerQuery(grantBlock);
      expect((await runtime.database.query("SELECT has_function_privilege(current_user,'public.begin_exact_matchup_attempt(jsonb,uuid,integer,jsonb)','EXECUTE') AS allowed"))[0].allowed).toBe(true);
      await expect(runtime.database.query("SELECT public.begin_exact_matchup_attempt('{}'::jsonb,$1::uuid,0,NULL)", [randomUUID()])).rejects.toThrow('invalid native matchup week');
      for (const signature of ['public.record_league_administration_observation_v30(jsonb)',
        'public.canonical_public_data_exact_periods(jsonb,integer[])', 'public.admit_public_data_dispatch_v34(jsonb,jsonb)']) {
        expect((await runtime.database.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') AS allowed", [signature]))[0].allowed).toBe(false);
      }
      const witnessReader = 'public.read_public_data_capture_witness(jsonb,jsonb,jsonb)';
      expect((await runtime.database.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') AS allowed", [witnessReader]))[0].allowed).toBe(true);
      await ownerQuery('REVOKE EXECUTE ON FUNCTION public.read_public_data_capture_witness(jsonb,jsonb,jsonb) FROM league_one_runtime');
      await expect(runtime.database.query('SELECT public.read_public_data_capture_witness(NULL,NULL,NULL)')).rejects.toMatchObject({ code: '42501' });
      await ownerQuery(witnessGrant); await ownerQuery(witnessGrant);
      expect((await runtime.database.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') AS allowed", [witnessReader]))[0].allowed).toBe(true);
      for (const signature of ['public.derive_public_data_capture_witness(jsonb,jsonb,jsonb)',
        'public.assert_public_data_capture_witness(jsonb,jsonb,text,integer,jsonb)', 'public.public_capture_after_reservation(jsonb,uuid)',
        'public.assert_public_capture_observation(jsonb,text)', 'public.assert_public_capture_input_shape(jsonb)']) {
        expect((await runtime.database.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') AS allowed", [signature]))[0].allowed).toBe(false);
      }
      for (const table of ['league_roster_resource_attempts', 'public_data_dispatches', 'public_data_dispatch_outcomes']) {
        expect((await runtime.database.query("SELECT has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS allowed", ['public.' + table]))[0].allowed).toBe(false);
      }

      expect((await runtime.database.query('SELECT session_user AS role'))[0].role).toBe('league_one_runtime');
      await runtime.database.query('BEGIN'); open = true;
      const id = randomUUID(); const input = { id, username: 'period_scope_contract', seasons: [2179, 2180] };
      const submit = (value: unknown) => runtime.database.query('SELECT public.submit_public_data_intake($1::jsonb)', [JSON.stringify(value)]);
      for (const exactPeriods of [null, {}, [{ season: 2179, nativeWeek: 0 }], [{ season: 2179, nativeWeek: 19 }],
        [{ season: 2179, nativeWeek: 1.5 }], [{ season: 2179, nativeWeek: '7' }], [{ season: 2181, nativeWeek: 7 }],
        [{ season: 2179, nativeWeek: 7, extra: true }], [{ season: 2179, nativeWeek: 7 }, { season: 2179, nativeWeek: 7 }],
        [2177, 2178, 2179, 2180].map(season => ({ season, nativeWeek: 7 }))]) {
        await runtime.database.query('SAVEPOINT invalid_period_scope');
        try { await expect(submit({ ...input, exactPeriods })).rejects.toThrow(); }
        finally { await runtime.database.query('ROLLBACK TO SAVEPOINT invalid_period_scope'); await runtime.database.query('RELEASE SAVEPOINT invalid_period_scope'); }
        expect(await runtime.database.query('SELECT id FROM public.public_data_intakes WHERE id=$1', [id])).toHaveLength(0);
      }
      await submit(input); await submit({ ...input, exactPeriods: [] });
      expect((await runtime.database.query('SELECT exact_periods FROM public.public_data_intakes WHERE id=$1', [id]))[0].exact_periods).toEqual([]);
      const scoped = { ...input, id: randomUUID(), exactPeriods: [{ season: 2180, nativeWeek: 8 }, { season: 2179, nativeWeek: 7 }] };
      await submit(scoped); await submit({ ...scoped, exactPeriods: [...scoped.exactPeriods].reverse() });
      expect((await runtime.database.query('SELECT exact_periods FROM public.public_data_intakes WHERE id=$1', [scoped.id]))[0].exact_periods).toEqual([...scoped.exactPeriods].reverse());
      await runtime.database.query('SAVEPOINT mismatched_period_replay');
      try { await expect(submit({ ...scoped, exactPeriods: [] })).rejects.toThrow('replay mismatch'); }
      finally { await runtime.database.query('ROLLBACK TO SAVEPOINT mismatched_period_replay'); await runtime.database.query('RELEASE SAVEPOINT mismatched_period_replay'); }
      await runtime.database.query('ROLLBACK'); open = false;
    } finally {
      if (open) await runtime.database.query('ROLLBACK');
      try { await ownerQuery(grantBlock); await ownerQuery(witnessGrant); } finally { await runtime.close(); }
    }
  });

  it('enforces twenty task ordinals, candidate lineage and immutable scope with rolled-back owner-only negative prerequisites', async () => {
    // Structural negative fixture ONLY. These synthetic discovery rows cannot
    // prove ingestion, admission, accepted resources or checkpoint completion.
    const owner = await createPinnedIntegrationDatabase('owner'); let open = false;
    try {
      await owner.database.query('BEGIN'); open = true;
      const id = randomUUID(); const manager = randomUUID(); const season = 2178;
      await owner.database.query("INSERT INTO public.league_source_manager_accounts(id,provider,external_manager_id) VALUES($1,'sleeper',$2)", [manager, `5${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`]);
      await owner.database.query(`INSERT INTO public.public_data_intakes(id,username,seasons,exact_periods) VALUES($1,'structural_period_fixture',ARRAY[$2]::integer[],jsonb_build_array(jsonb_build_object('season',$2::integer,'nativeWeek',7)))`, [id, season]);
      await owner.database.query(`INSERT INTO public.public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,payload,request_started_at,request_completed_at)
        VALUES($1,$2,'structural_period_fixture','Fixture','{}',clock_timestamp(),clock_timestamp())`, [id, manager]);
      await owner.database.query("INSERT INTO public.public_data_league_lists(intake_id,season,payload,request_started_at,request_completed_at) VALUES($1,$2,'[]',clock_timestamp(),clock_timestamp())", [id, season]);
      for (let ordinal = 1; ordinal <= 21; ordinal++) {
        await owner.database.query("INSERT INTO public.public_data_league_candidates(intake_id,season,external_league_id,name) VALUES($1,$2,$3,'Structural negative fixture')", [id, season, String(ordinal)]);
      }
      const insert = (ordinal: number, native: string, week = 7, status = 'pending') => owner.database.query(`INSERT INTO public.public_data_exact_period_tasks(intake_id,ordinal,season,external_league_id,native_week,status) VALUES($1,$2,$3,$4,$5,$6)`, [id, ordinal, season, native, week, status]);
      await insert(1, '1');
      for (const negative of [() => insert(2, '999'), () => insert(2, '2', 8), () => insert(2, '1'),
        () => insert(2, '2', 7, 'complete'), () => insert(0, '2'), () => insert(21, '21')]) {
        await owner.database.query('SAVEPOINT invalid_period_task');
        try { await expect(negative()).rejects.toThrow(); }
        finally { await owner.database.query('ROLLBACK TO SAVEPOINT invalid_period_task'); await owner.database.query('RELEASE SAVEPOINT invalid_period_task'); }
      }
      for (let ordinal = 2; ordinal <= 20; ordinal++) await insert(ordinal, String(ordinal));
      expect((await owner.database.query('SELECT count(*)::integer AS count FROM public.public_data_exact_period_tasks WHERE intake_id=$1', [id]))[0].count).toBe(20);
      await owner.database.query('SAVEPOINT immutable_period_scope');
      try { await expect(owner.database.query("UPDATE public.public_data_intakes SET exact_periods='[]' WHERE id=$1", [id])).rejects.toThrow(); }
      finally { await owner.database.query('ROLLBACK TO SAVEPOINT immutable_period_scope'); await owner.database.query('RELEASE SAVEPOINT immutable_period_scope'); }
      // Owner-only negative prerequisites: a terminal header with discovery and
      // two declared keys cannot be complete when both actual task rows are absent.
      // This deliberately synthetic state proves the SQL completion guard only.
      const missingId = randomUUID();
      await owner.database.query(`INSERT INTO public.public_data_intakes(id,username,seasons,exact_periods,terminal)
        VALUES($1,'missing_period_fixture',ARRAY[$2]::integer[],jsonb_build_array(
          jsonb_build_object('season',$2::integer,'nativeWeek',7),jsonb_build_object('season',$2::integer,'nativeWeek',8)),true)`, [missingId,season]);
      await owner.database.query(`INSERT INTO public.public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,payload,request_started_at,request_completed_at)
        VALUES($1,$2,'missing_period_fixture','Fixture','{}',clock_timestamp(),clock_timestamp())`, [missingId,manager]);
      await owner.database.query("INSERT INTO public.public_data_league_lists(intake_id,season,payload,request_started_at,request_completed_at) VALUES($1,$2,'[]',clock_timestamp(),clock_timestamp())", [missingId,season]);
      await owner.database.query("INSERT INTO public.public_data_league_candidates(intake_id,season,external_league_id,name) VALUES($1,$2,'1','Missing inventory negative fixture')", [missingId,season]);
      expect(await owner.database.query('SELECT * FROM public.public_data_exact_period_tasks WHERE intake_id=$1', [missingId])).toEqual([]);
      expect(await owner.database.query('SELECT expected_count,stored_count,missing_count,extra_count,unfinished_count FROM public.public_data_exact_period_inventory_v40($1)', [missingId]))
        .toEqual([{ expected_count: 2, stored_count: 0, missing_count: 2, extra_count: 0, unfinished_count: 0 }]);
      expect(await createPublicIntakeStore(owner.database).next(missingId)).toBe('partial');
      await owner.database.query('ROLLBACK'); open = false;
    } finally { if (open) await owner.database.query('ROLLBACK'); await owner.close(); }
  });

  it('binds both reservations, rejects stale/fenced receipts, recovers an observed lock expiry and lost acknowledgments, and preserves periods through core failure [focused slow SQL]', async () => {
    const f = await fixture(); const { database, intake, administration, id } = f;
    const owner = await createPinnedIntegrationDatabase('owner');
    const pinned = await createPinnedIntegrationDatabase('runtime');
    let blockerOpen = false; let pending: Promise<{ ok: boolean; error?: Error }> | undefined;
    let blockedDeadline = 0; let negativesProved = false; let expiryProved = false; let acknowledgmentProved = false;
    try {
      const mapping = await administration.readSourceMapping(f.native);
      if (!mapping) throw new Error('Missing period source mapping.');
      const cached = await recordCapturedAdministration(mapping.scope,
        (await Promise.all([capturePublicSleeperCore(f.native, 'league', new AbortController().signal),
          capturePublicSleeperCore(f.native, 'matchups', new AbortController().signal, f.nativeWeek)]))
          .map(document => ({ ...document, origin: 'cache' as const })), { store: administration, mapping });
      const cachedIds = cached.results.map(entry => entry.result.observationId);
      const originalRows = await database.query('SELECT * FROM public.league_administration_observations WHERE id=ANY($1::uuid[]) ORDER BY id', [cachedIds]);
      for (const resource of ['identity', 'leagues', 'bootstrap']) expect(await f.progress()).toMatchObject({ status: 'progress', resource });
      expect(await intake.next(id)).toMatchObject({ kind: 'exact-matchups', nativeWeek: f.nativeWeek });
      expect((await database.query('SELECT ordinal,status FROM public.public_data_exact_period_tasks WHERE intake_id=$1', [id]))).toEqual([{ ordinal: 1, status: 'pending' }]);
      f.league.scoring_settings.rec = 2; // official correction, immutable calculation profile remains 1
      f.fault.managers = true; f.fault.directory = true;
      expect(await f.progress({ ...f.dependencies, intake: { ...intake, completeExactPeriod: async (work, source, capture, fence) => {
        const timing = await database.query(`SELECT receipt.id,receipt.provenance,attempt.id AS attempt_id,attempt.capture_nonce,
          attempt.reserved_at>=dispatch.admitted_at AS after_admission,
          receipt.recorded_at>=max(attempt.reserved_at) OVER ()
            AND receipt.recorded_at<=dispatch.admitted_at+interval '30 seconds' AS server_window,
          receipt.provenance->'acquisition'->>'dispatchNonce'=dispatch.capture_nonce::text
            AND receipt.provenance->'acquisition'->'work'=dispatch.work
            AND receipt.provenance->'acquisition'->'fence'=attempt.write_fence
            AND receipt.provenance->'acquisition'->'mapping'=attempt.source_mapping AS exact_witness
          FROM public.league_roster_capture_receipts receipt
          JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
          JOIN public.public_data_dispatches dispatch ON dispatch.worker_id=attempt.write_fence->>'workerId'
            AND dispatch.generation=(attempt.write_fence->>'generation')::integer WHERE receipt.id=ANY($1::uuid[])`, [Object.values(capture.receipts)]);
        expect(timing).toHaveLength(2);
        const group = Object.fromEntries(timing.map(row => [row.id === capture.receipts.settings ? 'settings' : 'matchups',
          { id: row.attempt_id, nonce: row.capture_nonce }]));
        for (const row of timing) {
          expect(row).toMatchObject({ after_admission: true, server_window: true, exact_witness: true });
          const original = f.periodCaptures.find(entry => entry.acquisition?.fence.workerId === fence.workerId
            && entry.family === (row.id === capture.receipts.settings ? 'league' : 'matchups'))!;
          expect(original.acquisition?.attempts).toEqual(group);
          expect((row.provenance as { acquisition: unknown }).acquisition).toEqual(original.acquisition);
          expect(row.provenance).toMatchObject({ requestStartedAt: original.requestStartedAt,
            requestCompletedAt: original.requestCompletedAt, sourceObservedAt: original.requestCompletedAt });
        }
        await expect(intake.completeExactPeriod({ ...work, nativeWeek: f.nativeWeek + 1 }, source, capture, fence)).rejects.toThrow();
        await expect(intake.completeExactPeriod(work, { ...source, revisionId: randomUUID() }, capture, fence)).rejects.toThrow();
        await expect(intake.completeExactPeriod(work, source, { ...capture, receipts: { ...capture.receipts, matchups: randomUUID() } }, fence)).rejects.toThrow();
        await expect(intake.completeExactPeriod(work, source, capture, { ...fence, deadlineAt: new Date(Date.parse(fence.deadlineAt) - 1).toISOString() })).rejects.toThrow('observation mismatch');
        await administration.beginLeagueSettingsAttempt(source, randomUUID(), fence);
        await expect(intake.completeExactPeriod(work, source, capture, fence)).rejects.toThrow(/current dispatch-bound exact period receipt|public capture resource group/);
        expect(await database.query('SELECT * FROM public.public_data_exact_period_checkpoints WHERE intake_id=$1', [id])).toHaveLength(0);
        negativesProved = true;
        throw new Error('Lost checkpoint after typed writes; newer pending settings reservation retained');
      } } })).toMatchObject({ status: 'unavailable', resource: 'exact-matchups' });
      expect(negativesProved).toBe(true); // callback assertions cannot hide in coordinator catch
      expect((await database.query('SELECT status,failure_count FROM public.public_data_exact_period_tasks WHERE intake_id=$1', [id]))[0]).toEqual({ status: 'pending', failure_count: 1 });
      const [runtimeSession] = await pinned.database.query('SELECT session_user AS role,pg_backend_pid() AS pid');
      const [ownerSession] = await owner.database.query('SELECT pg_backend_pid() AS pid');
      expect(runtimeSession.role).toBe('league_one_runtime');
      expect(await f.progress({ ...f.dependencies, intake: { ...intake, completeExactPeriod: async (work, source, capture, fence) => {
        blockedDeadline = Date.parse(fence.deadlineAt);
        await owner.database.query('BEGIN'); blockerOpen = true;
        await owner.database.query("SELECT pg_advisory_xact_lock(hashtextextended('league-configuration:'||$1::text,0))", [source.leagueSeasonId]);
        pending = createPublicIntakeStore(pinned.database).completeExactPeriod(work, source, capture, fence)
          .then(() => ({ ok: true }), error => ({ ok: false, error }));
        let observed = false; const until = Math.min(Date.now() + 4_000, blockedDeadline);
        while (Date.now() < until) {
          const [state] = await ownerQuery('SELECT $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocked', [runtimeSession.pid, ownerSession.pid]);
          if (state.blocked === true) { observed = true; break; }
          await delay(25);
        }
        expect(observed, 'Checkpoint must reach the real source advisory lock before its original deadline.').toBe(true);
        await delay(Math.max(0, blockedDeadline - Date.now()) + 100);
        await owner.database.query('ROLLBACK'); blockerOpen = false;
        const result = await pending;
        expect(result.ok).toBe(false); expect(result.error?.message).toContain('lease lost');
        expect(await database.query('SELECT * FROM public.public_data_exact_period_checkpoints WHERE intake_id=$1', [id])).toHaveLength(0);
        expiryProved = true;
        throw result.error;
      } } }, 8_000)).toMatchObject({ status: 'unavailable', resource: 'exact-matchups' });
      expect(expiryProved).toBe(true);
      // New real owner recovers precisely one failed dispatch, waits inherited
      // backoff, then obtains fresh receipts. The successful checkpoint commits
      // before its caller loses acknowledgment; stale replay cannot append again.
      expect(await f.progress({ ...f.dependencies, intake: { ...intake, completeExactPeriod: async (work, source, capture, fence) => {
        await intake.completeExactPeriod(work, source, capture, fence);
        await expect(intake.completeExactPeriod(work, source, capture, fence)).rejects.toThrow();
        acknowledgmentProved = true;
        throw new Error('Checkpoint committed; acknowledgment lost');
      } } })).toMatchObject({ status: 'unavailable', resource: 'exact-matchups' });
      expect(acknowledgmentProved).toBe(true);
      const checkpoint = await database.query('SELECT * FROM public.public_data_exact_period_checkpoints WHERE intake_id=$1', [id]);
      expect(checkpoint).toHaveLength(1);
      const task = await database.query('SELECT * FROM public.public_data_exact_period_tasks WHERE intake_id=$1', [id]);
      expect(task[0]).toMatchObject({ status: 'complete', failure_count: 2 });
      const read = await readPublicSleeperIntake(database, administration, id);
      expect(read).toMatchObject({ status: 'pending', exactPeriods: [{ nativeWeek: f.nativeWeek, collection: 'complete', resource: { status: 'available' } }] });
      expect(await administration.readSource({ ...mapping.scope, family: 'league', week: null }))
        .toMatchObject({ status: 'conflict', reason: 'scoring_profile_change_requires_explicit_compatibility_and_period_review' });
      expect(await f.progress()).toMatchObject({ status: 'unavailable', resource: 'core' });
      expect(await database.query('SELECT * FROM public.public_data_exact_period_checkpoints WHERE intake_id=$1', [id])).toEqual(checkpoint);
      expect(await database.query('SELECT * FROM public.public_data_exact_period_tasks WHERE intake_id=$1', [id])).toEqual(task);
      f.fault.managers = false;
      expect(await f.progress()).toMatchObject({ status: 'progress', resource: 'core' });
      const currentSettings = await administration.readAcceptedLeagueSettings(mapping);
      if (currentSettings.status !== 'available') throw new Error('Missing later core settings receipt.');
      expect(currentSettings.receipt.id).not.toBe(checkpoint[0].settings_receipt_id);
      expect(await readPublicSleeperIntake(database, administration, id)).toMatchObject({ exactPeriods: [{ resource: { status: 'available' } }] });
      expect(await f.progress()).toMatchObject({ status: 'unavailable', resource: 'users' });
      f.fault.directory = false;
      expect(await f.progress()).toMatchObject({ status: 'progress', resource: 'users' });
      expect(await readPublicSleeperIntake(database, administration, id)).toMatchObject({ status: 'available', exactPeriods: [{ resource: { status: 'available' } }] });
      expect(await database.query('SELECT * FROM public.league_administration_observations WHERE id=ANY($1::uuid[]) ORDER BY id', [cachedIds])).toEqual(originalRows);
      expect(await database.query('SELECT * FROM public.public_data_exact_period_checkpoints WHERE intake_id=$1', [id])).toEqual(checkpoint);
      expect(f.fetch.mock.calls.filter(([url]) => String(url).includes('/matchups/'))).toHaveLength(4); // one cache seed plus three admitted pairs
      expect((await database.query('SELECT scoring_profile_id FROM public.league_seasons WHERE id=$1', [mapping.leagueSeasonId]))[0].scoring_profile_id).toBe(f.registered.value.scoringProfileId);
      for (const table of ['public_data_exact_period_tasks', 'public_data_exact_period_checkpoints']) {
        await expect(database.query(`DELETE FROM public.${table} WHERE intake_id=$1`, [id])).rejects.toMatchObject({ code: '42501' });
        await owner.database.query('BEGIN'); blockerOpen = true;
        for (const mutation of [table === 'public_data_exact_period_tasks'
          ? `UPDATE public.${table} SET native_week=native_week+1 WHERE intake_id=$1`
          : `UPDATE public.${table} SET recorded_at=recorded_at+interval '1 second' WHERE intake_id=$1`, `DELETE FROM public.${table} WHERE intake_id=$1`]) {
          await owner.database.query('SAVEPOINT period_history');
          try { await expect(owner.database.query(mutation, [id])).rejects.toThrow('immutable'); }
          finally { await owner.database.query('ROLLBACK TO SAVEPOINT period_history'); await owner.database.query('RELEASE SAVEPOINT period_history'); }
        }
        await owner.database.query('ROLLBACK'); blockerOpen = false;
      }
      await expect(database.query("SELECT public.canonical_public_data_exact_periods('[]'::jsonb,ARRAY[2179])")).rejects.toMatchObject({ code: '42501' });
    } finally {
      if (blockerOpen) { await delay(Math.max(0, blockedDeadline - Date.now()) + 100); await owner.database.query('ROLLBACK'); }
      await pending; f.fetch.mockRestore(); await pinned.close(); await owner.close();
    }
  }, 18 * 60_000);

  it('exhausts five real exact-period retries without closing core or fabricating a period checkpoint [focused slow SQL]', async () => {
    const f = await fixture([7,8]);
    try {
      for (const resource of ['identity', 'leagues', 'bootstrap']) expect(await f.progress()).toMatchObject({ status: 'progress', resource });
      expect(await f.progress()).toMatchObject({ status: 'progress', resource: 'exact-matchups', providerRequests: 2 });
      const retained = await f.database.query('SELECT * FROM public.public_data_exact_period_checkpoints WHERE intake_id=$1', [f.id]);
      expect(retained).toHaveLength(1);
      expect(await f.intake.next(f.id)).toMatchObject({ kind: 'exact-matchups', nativeWeek: 8 });
      f.fault.matchups = true;
      for (let attempt = 1; attempt <= 5; attempt++) {
        expect(await f.progress()).toMatchObject({ status: 'unavailable', resource: 'exact-matchups', providerRequests: 2 });
        expect((await f.database.query('SELECT status,failure_count,reason FROM public.public_data_exact_period_tasks WHERE intake_id=$1 AND native_week=8', [f.id]))[0])
          .toEqual({ status: attempt < 5 ? 'pending' : 'unavailable', failure_count: attempt, reason: attempt < 5 ? null : 'period-capture-exhausted' });
        expect(await f.database.query('SELECT * FROM public.public_data_exact_period_checkpoints WHERE intake_id=$1', [f.id])).toEqual(retained);
        expect((await f.database.query('SELECT status,failure_count FROM public.public_data_exact_period_tasks WHERE intake_id=$1 AND native_week=7', [f.id]))[0])
          .toEqual({ status: 'complete', failure_count: 0 });
      }
      expect(await f.intake.next(f.id)).toMatchObject({ kind: 'core' });
      for (const resource of ['core', 'users']) expect(await f.progress()).toMatchObject({ status: 'progress', resource });
      expect(await f.intake.next(f.id)).toBe('partial');
      expect(await readPublicSleeperIntake(f.database, f.administration, f.id)).toMatchObject({ status: 'partial',
        exactPeriods: [{ nativeWeek: 7, collection: 'complete', failureCount: 0, resource: { status: 'available' },
          acquisition: { matchupsReceiptId: retained[0].matchups_receipt_id, settingsReceiptId: retained[0].settings_receipt_id } },
        { nativeWeek: 8, collection: 'unavailable', failureCount: 5, resource: { status: 'unavailable' }, acquisition: null }],
        leagues: [{ collection: 'complete', resources: { settings: { status: 'available' }, heldRoster: { status: 'available' } } }] });
      expect(await f.database.query('SELECT * FROM public.public_data_exact_period_checkpoints WHERE intake_id=$1', [f.id])).toEqual(retained);
      const dispatches = await f.database.query(`SELECT resource,max_requests,admitted_at FROM public.public_data_dispatches WHERE intake_id=$1 ORDER BY admitted_at`, [f.id]);
      expect(dispatches.filter(row => row.resource === 'exact-matchups')).toHaveLength(6);
      expect(dispatches.filter(row => row.resource === 'exact-matchups').every(row => row.max_requests === 2)).toBe(true);
      for (let index = 1; index < dispatches.length; index++) {
        expect(Date.parse(exactMatchupClockInstant(dispatches[index].admitted_at)) - Date.parse(exactMatchupClockInstant(dispatches[index - 1].admitted_at))).toBeGreaterThanOrEqual(60_000);
      }
    } finally { f.fetch.mockRestore(); }
  }, 27 * 60_000);
});

function inventoryProofFixture(database: DatabaseClient) {
  const season = 2176;
  const native = `7${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
  const manager = `8${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
  const league = { league_id: native, season: String(season), sport: 'nfl', name: 'Unrelated explicit inventory fixture',
    total_rosters: 2, settings: {}, scoring_settings: { rec: 1 }, roster_positions: ['QB','RB','BN'] };
  const lists = new Map<number, readonly typeof league[]>([[season, [league]]]);
  const state = { empty: false, cycle: 1 };
  const requests: string[] = [];
  const captures: (Awaited<ReturnType<typeof capturePublicSleeperCore>> & { acquisition?: PublicCaptureWitness })[] = [];
  const matchups = (week: number) => [
    { roster_id: 1, matchup_id: week === 7 ? 41 : 82, players: ['101','102'],
      starters: [week === 7 ? '101' : '102','0'], starters_points: [week === 7 ? 8.25 : 2.5,null],
      players_points: { '101': week === 7 ? 9.5 : 0, '102': week === 7 ? -1 : 3.5 },
      points: week === 7 ? 8.25 : 2.5, ...(week === 7 ? { custom_points: state.cycle === 1 ? 0 : -2 } : {}) },
    { roster_id: 2, matchup_id: week === 7 ? 41 : 82, players: ['103'], starters: ['103','0'],
      starters_points: [week === 7 ? 4 : 6,null], players_points: { '103': week === 7 ? 4 : 6 }, points: week === 7 ? 4 : 6 },
  ];
  const rosters = [{ roster_id: 1, owner_id: manager, co_owners: [], players: ['101','102'], starters: ['101','0'], reserve: [], taxi: [] },
    { roster_id: 2, owner_id: '556', co_owners: [], players: ['103'], starters: ['103','0'], reserve: [], taxi: [] }];
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input); requests.push(url);
    if (url === `https://api.sleeper.app/v1/user/${manager}`) return new Response(JSON.stringify({ user_id: manager, username: manager }));
    for (const [selectedSeason, values] of lists) {
      if (url === `https://api.sleeper.app/v1/user/${manager}/leagues/nfl/${selectedSeason}`) return new Response(JSON.stringify(state.empty ? [] : values));
    }
    if (url === `https://api.sleeper.app/v1/league/${native}`) return new Response(JSON.stringify(league));
    if (url === `https://api.sleeper.app/v1/league/${native}/rosters`) return new Response(JSON.stringify(rosters));
    if (url === `https://api.sleeper.app/v1/league/${native}/users`) return new Response(JSON.stringify([{ user_id: manager, display_name: 'Inventory manager' }, { user_id: '556', display_name: 'Second manager' }]));
    for (const week of [7,8]) if (url === `https://api.sleeper.app/v1/league/${native}/matchups/${week}`) return new Response(JSON.stringify(matchups(week)));
    throw new Error('Unexpected bounded inventory fixture request.');
  });
  const administration = createLeagueAdministrationStore(database), intake = createPublicIntakeStore(database), jobs = createProjectionStore(database);
  const source: NonNullable<PublicIntakeDependencies['source']> = {
    identity: capturePublicSleeperIdentity, leagues: capturePublicSleeperLeagueList,
    core: async (external, family, signal, witness) => {
      const capture = await capturePublicSleeperCore(external, family, signal, undefined, witness); captures.push(capture); return capture;
    },
    exactPeriod: async (external, week, signal, witness) => {
      const capture = await capturePublicSleeperCore(external, 'matchups', signal, week, witness); captures.push(capture); return capture;
    },
  };
  const dependencies: PublicIntakeDependencies = { administration, intake, jobs, source };
  return { database, season, native, manager, league, lists, state, requests, captures, matchups, fetch, administration, intake, jobs, dependencies };
}
type InventoryProofFixture = ReturnType<typeof inventoryProofFixture>;
type InventoryDiagnostics = ReturnType<typeof createPublicInventoryDiagnostics>;
async function inventoryVersion(database: DatabaseClient, diagnostics: InventoryDiagnostics) {
  const [row] = await database.query("SELECT session_user AS role,current_user AS effective_role,current_setting('server_version') AS server_version,current_setting('server_version_num') AS server_version_num");
  expect(row).toMatchObject({ role: 'league_one_runtime', effective_role: 'league_one_runtime' });
  diagnostics.database(row);
}
async function inventoryManualProgress(f: InventoryProofFixture, id: string, until: number, diagnostics: InventoryDiagnostics) {
  while (Date.now() < until) {
    const result = await runPublicIntakeStep(id, f.dependencies, AbortSignal.timeout(20_000));
    if (result.status === 'busy' || result.status === 'backoff') { await delay(1_000); continue; }
    if (result.providerRequests) diagnostics.acquired();
    return result;
  }
  throw new Error('Bounded inventory admission did not become due.');
}
async function inventoryClaim(f: InventoryProofFixture, until: number) {
  while (Date.now() < until) {
    const workerId = randomUUID();
    const claim = await f.jobs.acquireJob({ jobKey: PUBLIC_INTAKE_JOB, jobType: PUBLIC_INTAKE_JOB, workerId,
      scheduledFor: new Date().toISOString(), minimumIntervalSeconds: 60, leaseSeconds: 25, payload: { policy: 'public-data-intake-v1' } });
    if (claim.kind !== 'acquired') { await delay(1_000); continue; }
    return { jobKey: PUBLIC_INTAKE_JOB, workerId, generation: claim.attempt, deadlineAt: new Date(Date.now() + 20_000).toISOString() };
  }
  throw new Error('Bounded inventory owner did not become available.');
}
async function inventoryHistory(database: DatabaseClient, requestId: string) {
  const definitions: { statement: string; parameters: readonly unknown[] }[] = [
    ...['public_data_intakes','public_data_identity_observations','public_data_league_lists','public_data_league_candidates',
      'public_data_exact_period_tasks','public_data_exact_period_checkpoints','public_data_dispatches'].map(table => ({
      statement: `SELECT * FROM public.${table} WHERE ${table === 'public_data_intakes' ? 'id' : 'intake_id'}=$1 ORDER BY to_jsonb(${table})::text`, parameters: [requestId] })),
    { statement: `SELECT outcome.* FROM public.public_data_dispatch_outcomes outcome JOIN public.public_data_dispatches dispatch
      USING(worker_id,generation) WHERE dispatch.intake_id=$1 ORDER BY outcome.worker_id,outcome.generation`, parameters: [requestId] },
  ];
  const receipts = `SELECT settings_receipt_id AS id FROM public.public_data_exact_period_checkpoints WHERE intake_id=$1
    UNION SELECT matchups_receipt_id FROM public.public_data_exact_period_checkpoints WHERE intake_id=$1`;
  for (const [table, predicate] of [
    ['league_roster_capture_receipts', `id IN (${receipts})`],
    ['league_roster_resource_attempts', `id IN (SELECT attempt_id FROM public.league_roster_capture_receipts WHERE id IN (${receipts}))`],
    ['league_roster_resource_acceptances', `receipt_id IN (${receipts})`],
    ['league_administration_contents', `id IN (SELECT content_id FROM public.league_roster_capture_receipts WHERE id IN (${receipts}))`],
    ['league_administration_observations', `id IN (SELECT legacy_observation_id FROM public.league_roster_capture_receipts WHERE id IN (${receipts}))`],
    ['league_administration_team_entries', `content_id IN (SELECT content_id FROM public.league_roster_capture_receipts WHERE id IN (${receipts}))`],
  ]) definitions.push({ statement: `SELECT * FROM public.${table} WHERE ${predicate} ORDER BY to_jsonb(${table})::text`, parameters: [requestId] });
  const result = [];
  for (const definition of definitions) {
    const rows = await database.query(definition.statement, definition.parameters);
    expect(rows.length, 'A retained inventory history assertion must contain actual rows.').toBeGreaterThan(0);
    result.push({ ...definition, rows });
  }
  return result;
}
async function assertInventoryHistory(database: DatabaseClient, history: Awaited<ReturnType<typeof inventoryHistory>>) {
  for (const entry of history) expect(await database.query(entry.statement, entry.parameters)).toEqual(entry.rows);
}
async function assertInventoryPeriods(f: InventoryProofFixture, id: string, weeks: readonly number[], expectedStatus: 'pending' | 'available') {
  const read = await readPublicSleeperIntake(f.database, f.administration, id);
  expect(read).toMatchObject({ status: expectedStatus, request: { exactPeriods: weeks.map(nativeWeek => ({ season: f.season, nativeWeek })) } });
  if (read.status === 'missing' || !read.exactPeriods) throw new Error('Missing explicit inventory read.');
  expect(read.exactPeriods.map(period => [period.season,period.externalLeagueId,period.nativeWeek]))
    .toEqual(weeks.map(week => [f.season,f.native,week]));
  const mapping = await f.administration.readSourceMapping(f.native);
  if (!mapping) throw new Error('Missing exact inventory source mapping.');
  const results = [];
  for (const [index, week] of weeks.entries()) {
    const exact = await f.administration.readAcceptedExactMatchups(mapping, week);
    if (exact.status !== 'available') throw new Error('Missing typed exact inventory resource.');
    expect(read.exactPeriods[index]).toMatchObject({ collection: 'complete', failureCount: expect.any(Number),
      phase: { status: 'unknown', reason: 'native-period-phase-not-evidenced' }, resource: exact,
      acquisition: { sourceMapping: mapping, matchupsReceiptId: exact.receipt.id,
        configurationContentId: exact.receipt.configurationContentId, settingsReceiptId: expect.any(String) } });
    expect(exact.value.period).toEqual({ source: { provider: 'sleeper', resourceKind: 'competition-period', nativeNamespace: f.native, nativeId: String(week) }, season: f.season, nativeWeek: week, nflWeekMappings: [] });
    expect(exact.value.state).toEqual({ provider: 'unknown', local: 'unknown', reason: 'no_matchup_finality_evidence' });
    expect(exact.value.teams.map(team => team.externalRosterId)).toEqual(['1','2']);
    expect(new Set(exact.value.teams.map(team => team.seasonTeamId)).size).toBe(2);
    expect(exact.value.teams[0]).toMatchObject({ nativeMatchupId: week === 7 ? '41' : '82', players: ['101','102'],
      officialTeamPoints: week === 7 ? { raw: '8.25', custom: f.state.cycle === 1 ? '0' : '-2', effective: f.state.cycle === 1 ? '0' : '-2', adjustment: 'custom-override' }
        : { raw: '2.5', custom: null, effective: '2.5', adjustment: 'none' },
      starters: [{ index: 0, nativeSlot: null, playerExternalId: week === 7 ? '101' : '102', empty: false,
        officialPoints: week === 7 ? '8.25' : '2.5', pointSource: 'starter-index' },
      { index: 1, nativeSlot: null, playerExternalId: null, empty: true, officialPoints: null, pointSource: 'missing' }],
      bench: null, nonstarters: { state: 'known', players: [{ playerExternalId: week === 7 ? '102' : '101', officialPoints: week === 7 ? '-1' : '0' }] },
      officialPlayerPoints: week === 7 ? { '101': '9.5', '102': '-1' } : { '101': '0', '102': '3.5' } });
    expect(exact.value.groups).toEqual([{ nativeMatchupId: week === 7 ? '41' : '82', identity: expect.any(String),
      participantTeamIds: exact.value.teams.map(team => team.seasonTeamId).sort(), format: 'paired', resultSupport: 'supported' }]);
    const [checkpoint] = await f.database.query(`SELECT checkpoint.*,settings.content_id AS configuration_content_id
      FROM public.public_data_exact_period_checkpoints checkpoint JOIN public.public_data_exact_period_tasks task
      ON task.intake_id=checkpoint.intake_id AND task.ordinal=checkpoint.task_ordinal
      JOIN public.league_roster_capture_receipts settings ON settings.id=checkpoint.settings_receipt_id
      WHERE task.intake_id=$1 AND task.native_week=$2`, [id,week]);
    expect(checkpoint).toMatchObject({ matchups_receipt_id: exact.receipt.id, configuration_content_id: exact.receipt.configurationContentId,
      source_mapping: mapping, league_season_id: mapping.leagueSeasonId });
    const lineage = await f.database.query(`SELECT receipt.id,receipt.provenance,attempt.capture_nonce,attempt.id AS attempt_id,
      attempt.reserved_at>=dispatch.admitted_at AS after_admission,
      receipt.recorded_at>=attempt.reserved_at AND receipt.recorded_at<=dispatch.admitted_at+interval '30 seconds' AS server_window,
      receipt.provenance->'acquisition'->>'dispatchNonce'=dispatch.capture_nonce::text
        AND receipt.provenance->'acquisition'->'work'=dispatch.work
        AND receipt.provenance->'acquisition'->'fence'=attempt.write_fence
        AND receipt.provenance->'acquisition'->'mapping'=attempt.source_mapping AS exact_witness
      FROM public.league_roster_capture_receipts receipt JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
      JOIN public.public_data_dispatches dispatch ON dispatch.worker_id=attempt.write_fence->>'workerId'
        AND dispatch.generation=(attempt.write_fence->>'generation')::integer WHERE receipt.id=ANY($1::uuid[])`,
    [[checkpoint.settings_receipt_id,checkpoint.matchups_receipt_id]]);
    expect(lineage).toHaveLength(2);
    const reservationGroup = Object.fromEntries(lineage.map(row => [row.id === checkpoint.settings_receipt_id ? 'settings' : 'matchups', { id: row.attempt_id, nonce: row.capture_nonce }]));
    for (const row of lineage) {
      expect(row).toMatchObject({ after_admission: true, server_window: true, exact_witness: true });
      const original = f.captures.find(capture => capture.acquisition?.fence.workerId === checkpoint.worker_id
        && capture.family === (row.id === checkpoint.settings_receipt_id ? 'league' : 'matchups'));
      if (!original) throw new Error('Missing original sealed exact capture.');
      expect(original.acquisition?.attempts).toEqual(reservationGroup);
      expect(row.provenance).toMatchObject({ acquisition: original.acquisition, requestStartedAt: original.requestStartedAt,
        requestCompletedAt: original.requestCompletedAt, sourceObservedAt: original.requestCompletedAt });
    }
    expect(await f.database.query('SELECT payload FROM public.league_administration_contents WHERE id=$1', [exact.accepted.contentId]))
      .toEqual([{ payload: f.matchups(week) }]);
    results.push(exact);
  }
  return { read, mapping, results };
}

describe('bounded explicit native-week inventory through existing DATA intake', () => {
  let connection: IndependentDatabase;
  beforeAll(() => { connection = createIndependentDatabase(); });
  afterAll(async () => connection.close());

  it('retains two same-season weeks across recurring correction and lost-checkpoint recovery [inventory slow SQL]', async () => {
    const diagnostics = createPublicInventoryDiagnostics('inventory');
    const database = connection.database, f = inventoryProofFixture(database);
    const refresh = createPublicDataRefreshStore(database);
    const identityRequestId = randomUUID(), targetId = randomUUID();
    const periods = [7,8].map(nativeWeek => ({ season: f.season, nativeWeek }));
    let revision = 0;
    const configuration = { id: targetId, expectedRevision: 0, identityRequestId, seasons: [f.season], exactPeriods: [...periods].reverse(),
      cadenceSeconds: 60, expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), paused: false };
    const until = Date.now() + 22 * 60_000;
    let callbackError: unknown, lost = false, suppressed = false, recovered = false, cas = false, isolatedCorrection = false;
    let unfinished: { work: Extract<PublicIntakeWork, { kind: 'exact-matchups' }>; fence: Parameters<typeof f.intake.completeExactPeriod>[3];
      receipts: readonly string[]; state: DatabaseRow } | undefined;
    const checked = async <T,>(action: () => Promise<T>): Promise<T> => {
      try { return await action(); } catch (error) { callbackError = error; throw error; }
    };
    const requests: string[] = [];
    const completed: string[] = [];
    let firstHistory: Awaited<ReturnType<typeof inventoryHistory>> | undefined;
    let firstReads: Awaited<ReturnType<typeof assertInventoryPeriods>> | undefined;
    let firstRefreshHistory: readonly DatabaseRow[] | undefined;
    const dependencies = { ...f.dependencies, refresh: { ...refresh, select: async (fence: Parameters<typeof refresh.select>[0]) => checked(async () => {
      const selected = await refresh.select(fence);
      if (completed.length === 1 && !firstHistory) {
        firstHistory = await inventoryHistory(database, completed[0]);
        firstRefreshHistory = await database.query(`SELECT cycle.*,outcome.disposition,outcome.recorded_at,outcome.next_due_at
          FROM public.public_data_refresh_cycles cycle JOIN public.public_data_refresh_cycle_outcomes outcome USING(target_id,cycle)
          WHERE cycle.target_id=$1 AND cycle.cycle=1`, [targetId]);
        expect(firstRefreshHistory).toHaveLength(1);
      }
      if (selected.status === 'selected') {
        expect(selected.targetId).toBe(targetId);
        expect(selected.cycle).toBeLessThanOrEqual(2);
        if (!requests.includes(selected.requestId)) requests.push(selected.requestId);
        expect(await database.query('SELECT exact_periods FROM public.public_data_intakes WHERE id=$1', [selected.requestId])).toEqual([{ exact_periods: periods }]);
        expect(selected.cycleConfigurationRevision).toBe(selected.cycle === 1 ? 1 : 3);
      }
      return selected;
    }) }, intake: { ...f.intake,
      recover: async (id: string, fence: Parameters<typeof f.intake.recover>[1]) => {
        if (!unfinished || recovered) return f.intake.recover(id, fence);
        return checked(async () => {
          diagnostics.stage('recovery'); expect(id).toBe(unfinished!.work.requestId); expect(fence.workerId).not.toBe(unfinished!.fence.workerId);
          expect(await database.query('SELECT revision,failure_count FROM public.public_data_intakes WHERE id=$1', [id])).toEqual([unfinished!.state]);
          await f.intake.recover(id, fence);
          const after = await database.query('SELECT revision,failure_count FROM public.public_data_intakes WHERE id=$1', [id]);
          expect(after).toEqual([{ revision: Number(unfinished!.state.revision) + 1, failure_count: Number(unfinished!.state.failure_count) + 1 }]);
          await f.intake.recover(id, fence); expect(await database.query('SELECT revision,failure_count FROM public.public_data_intakes WHERE id=$1', [id])).toEqual(after);
          expect(await database.query('SELECT outcome FROM public.public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2', [unfinished!.fence.workerId,unfinished!.fence.generation]))
            .toEqual([{ outcome: 'recovered' }]);
          expect(await f.intake.next(id)).toBe('backoff'); recovered = true;
        });
      },
      completeExactPeriod: async (...args: Parameters<typeof f.intake.completeExactPeriod>) => {
        const [work,,capture,fence] = args;
        if (f.state.cycle === 2 && work.nativeWeek === 8 && !lost) {
          await checked(async () => {
            const [state] = await database.query('SELECT revision,failure_count FROM public.public_data_intakes WHERE id=$1', [work.requestId]);
            unfinished = { work, fence, receipts: Object.values(capture.receipts), state };
            expect(await database.query('SELECT id FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[])', [unfinished.receipts])).toHaveLength(2);
          });
          lost = true; throw new Error('Injected inventory checkpoint loss after both typed receipts.');
        }
        await f.intake.completeExactPeriod(...args);
        if (f.state.cycle === 2 && work.nativeWeek === 7) await checked(async () => {
          if (!firstReads) throw new Error('Missing first-cycle exact-period heads.');
          const corrected = await f.administration.readAcceptedExactMatchups(firstReads.mapping, 7);
          expect(corrected.status).toBe('available');
          if (corrected.status !== 'available') throw new Error('Missing corrected week.');
          expect(corrected.accepted.contentId).not.toBe(firstReads.results[0].accepted.contentId);
          // Before the second week's GET, its current accepted head and complete
          // receipt lineage must still be exactly the first cycle's captured read.
          expect(await f.administration.readAcceptedExactMatchups(firstReads.mapping, 8)).toEqual(firstReads.results[1]);
          expect(f.requests.filter(url => url.endsWith('/matchups/8'))).toHaveLength(1);
          isolatedCorrection = true;
        });
      },
      fail: async (...args: Parameters<typeof f.intake.fail>) => {
        if (unfinished && !suppressed && args[1].workerId === unfinished.fence.workerId && args[1].generation === unfinished.fence.generation) {
          suppressed = true; throw new Error('Injected paired cleanup loss for one exact dispatch.');
        }
        await f.intake.fail(...args);
      },
    } };
    try {
      await inventoryVersion(database, diagnostics);
      diagnostics.stage('discovery'); f.state.empty = true;
      await f.intake.submit({ id: identityRequestId, username: f.manager, seasons: [f.season] });
      for (const resource of ['identity','leagues']) expect(await inventoryManualProgress(f, identityRequestId, until, diagnostics)).toMatchObject({ status: 'progress', resource });
      expect(await f.intake.next(identityRequestId)).toBe('complete'); f.state.empty = false;
      diagnostics.stage('configuration'); revision = (await refresh.configure(configuration)).configurationRevision;
      expect(revision).toBe(1);
      expect(await refresh.configure({ ...configuration, exactPeriods: periods })).toMatchObject({ status: 'replayed', configurationRevision: 1 });
      while (Date.now() < until && completed.length < 2) {
        diagnostics.stage('acquisition');
        const wasLost = lost, wasRecovered = recovered, beforeRequests = f.requests.length;
        const result = await runPublicDataRefreshStep(dependencies, AbortSignal.timeout(20_000));
        if (callbackError) throw callbackError;
        if (result.providerRequests) diagnostics.acquired();
        if (!wasLost && lost) {
          expect(result).toMatchObject({ status: 'unavailable', resource: 'exact-matchups', providerRequests: 2 });
          expect(suppressed).toBe(true);
          expect(await database.query(`SELECT outcome.outcome FROM public.public_data_dispatches dispatch LEFT JOIN public.public_data_dispatch_outcomes outcome
            USING(worker_id,generation) WHERE dispatch.worker_id=$1 AND dispatch.generation=$2`, [unfinished!.fence.workerId,unfinished!.fence.generation])).toEqual([{ outcome: null }]);
          expect(await database.query(`SELECT checkpoint.task_ordinal FROM public.public_data_exact_period_checkpoints checkpoint JOIN public.public_data_exact_period_tasks task
            ON task.intake_id=checkpoint.intake_id AND task.ordinal=checkpoint.task_ordinal WHERE task.intake_id=$1 AND task.native_week=8`, [unfinished!.work.requestId])).toEqual([]);
        } else expect(result.status).not.toBe('unavailable');
        if (!wasRecovered && recovered) { expect(result).toMatchObject({ status: 'backoff', providerRequests: 0 }); expect(f.requests).toHaveLength(beforeRequests); }
        if (!cas && result.status === 'progress' && result.resource === 'identity') {
          diagnostics.stage('configuration');
          await expect(refresh.configure({ ...configuration, expectedRevision: revision, exactPeriods: [{ season: f.season, nativeWeek: 7 }] })).rejects.toThrow('unfinished refresh cycle');
          revision = (await refresh.configure({ ...configuration, expectedRevision: revision, paused: true })).configurationRevision;
          revision = (await refresh.configure({ ...configuration, expectedRevision: revision, exactPeriods: periods })).configurationRevision;
          expect(revision).toBe(3); cas = true;
          const read = await readPublicDataRefresh(database, f.administration, targetId);
          expect(read).toMatchObject({ cycle: { configurationRevision: 1, exactPeriods: periods }, intake: { request: { exactPeriods: periods } } });
        }
        for (const id of requests) {
          if (completed.includes(id) || (await f.intake.next(id)) !== 'complete') continue;
          diagnostics.stage('readback');
          const typed = await assertInventoryPeriods(f, id, [7,8], 'available');
          expect(typed.read).toMatchObject({ exactPeriodInventory: { status: 'complete', expectedCount: 2, storedCount: 2, missingCount: 0, discoveryComplete: true } });
          expect(await readPublicDataRefresh(database, f.administration, targetId)).toMatchObject({ cycle: { requestId: id, exactPeriods: periods }, intake: { status: 'available' } });
          if (!firstReads) { firstReads = typed; f.state.cycle = 2; }
          else {
            expect(typed.mapping).toEqual(firstReads.mapping);
            expect(typed.results[0].accepted.contentId).not.toBe(firstReads.results[0].accepted.contentId);
            expect(typed.results[1].accepted.contentId).toBe(firstReads.results[1].accepted.contentId);
            for (const [index, exact] of typed.results.entries()) {
              expect(exact.receipt.id).not.toBe(firstReads.results[index].receipt.id);
              expect(exact.receipt.attemptId).not.toBe(firstReads.results[index].receipt.attemptId);
              expect(exact.value.teams.map(team => team.seasonTeamId)).toEqual(firstReads.results[index].value.teams.map(team => team.seasonTeamId));
            }
            expect(typed.results[1].value).toEqual(firstReads.results[1].value);
            expect(unfinished).toBeDefined(); expect(unfinished!.receipts).not.toContain(typed.results[1].receipt.id);
            expect(await database.query('SELECT id FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[])', [unfinished!.receipts])).toHaveLength(2);
          }
          completed.push(id);
        }
        if (completed.length < 2) await delay(1_000);
      }
      expect(completed).toHaveLength(2); expect(requests).toEqual(completed);
      expect(lost && suppressed && recovered && cas && isolatedCorrection).toBe(true);
      if (!firstHistory || !firstRefreshHistory) throw new Error('Missing populated first-cycle history.');
      diagnostics.stage('history'); await assertInventoryHistory(database, firstHistory);
      expect(await database.query(`SELECT cycle.*,outcome.disposition,outcome.recorded_at,outcome.next_due_at
        FROM public.public_data_refresh_cycles cycle JOIN public.public_data_refresh_cycle_outcomes outcome USING(target_id,cycle)
        WHERE cycle.target_id=$1 AND cycle.cycle=1`, [targetId])).toEqual(firstRefreshHistory);
      expect(f.requests).toHaveLength(24);
      const dispatches = await database.query('SELECT intake_id,resource,admitted_at FROM public.public_data_dispatches WHERE intake_id=ANY($1::uuid[]) ORDER BY admitted_at', [[identityRequestId,...completed]]);
      expect(dispatches).toHaveLength(17);
      for (let index = 1; index < dispatches.length; index++) expect(Date.parse(exactMatchupClockInstant(dispatches[index].admitted_at)) - Date.parse(exactMatchupClockInstant(dispatches[index - 1].admitted_at))).toBeGreaterThanOrEqual(60_000);
      expect(await database.query(`SELECT dispatch.worker_id FROM public.public_data_dispatches dispatch LEFT JOIN public.public_data_dispatch_outcomes outcome
        USING(worker_id,generation) WHERE dispatch.intake_id=ANY($1::uuid[]) AND outcome.worker_id IS NULL`, [completed])).toEqual([]);
      diagnostics.stage('settlement');
      let settled = false;
      while (Date.now() < until) {
        const result = await runPublicDataRefreshStep(dependencies, AbortSignal.timeout(20_000)); if (callbackError) throw callbackError;
        if (result.status === 'busy') { await delay(1_000); continue; }
        expect(result).toEqual({ status: 'backoff', providerRequests: 0 }); settled = true; break;
      }
      expect(settled).toBe(true); expect(f.requests).toHaveLength(24);
      expect(await database.query('SELECT cycle,disposition FROM public.public_data_refresh_cycle_outcomes WHERE target_id=$1 ORDER BY cycle', [targetId]))
        .toEqual([{ cycle: 1, disposition: 'complete' }, { cycle: 2, disposition: 'complete' }]);
      diagnostics.stage('complete');
    } catch (error) { diagnostics.fail(error); }
    finally { await diagnostics.finish([
      () => f.fetch.mockRestore(),
      async () => { if (revision) await refresh.configure({ ...configuration, expectedRevision: revision, paused: true }); },
    ]); }
  }, 23 * 60_000);

  it.each(['same-season expansion','cumulative seasons','all discovered candidates'] as const)(
    'retains complete requested scope and rejects period acquisition over capacity: %s', async mode => {
      const kind: InventoryDiagnosticKind = mode === 'same-season expansion' ? 'capacity-same-season'
        : mode === 'cumulative seasons' ? 'capacity-cumulative' : 'capacity-all-candidates';
      const diagnostics = createPublicInventoryDiagnostics(kind);
      const f = inventoryProofFixture(connection.database), id = randomUUID();
      const seasons = mode === 'cumulative seasons' ? [f.season,f.season + 1] : [f.season];
      const weeks = mode === 'all discovered candidates' ? [7] : [7,8];
      const counts = mode === 'same-season expansion' ? [11] : mode === 'cumulative seasons' ? [6,5] : [21];
      const periods = seasons.flatMap(season => weeks.map(nativeWeek => ({ season,nativeWeek })));
      let offset = 0;
      for (const [index, season] of seasons.entries()) f.lists.set(season, Array.from({ length: counts[index] }, () => ({
        ...f.league, league_id: String(BigInt(f.native) + BigInt(offset++)), season: String(season) })));
      const expected = seasons.flatMap(season => f.lists.get(season)!.flatMap(league => weeks.map(week => [season,league.league_id,week])));
      const until = Date.now() + 5 * 60_000;
      let fence: Awaited<ReturnType<typeof inventoryClaim>> | undefined;
      try {
        await inventoryVersion(f.database, diagnostics); diagnostics.stage('discovery');
        await f.intake.submit({ id, username: f.manager, seasons, exactPeriods: [...periods].reverse() });
        expect(await inventoryManualProgress(f, id, until, diagnostics)).toMatchObject({ status: 'progress', resource: 'identity' });
        for (const season of seasons) {
          expect(await f.intake.next(id)).toMatchObject({ kind: 'leagues', season });
          expect(await inventoryManualProgress(f, id, until, diagnostics)).toMatchObject({ status: 'progress', resource: 'leagues' });
        }
        diagnostics.stage('capacity');
        const candidates = await f.database.query('SELECT season,external_league_id,stage FROM public.public_data_league_candidates WHERE intake_id=$1 ORDER BY season,external_league_id', [id]);
        expect(candidates.map(candidate => [candidate.season,candidate.external_league_id]))
          .toEqual(seasons.flatMap(season => f.lists.get(season)!.map(league => [season,league.league_id])));
        expect(candidates).toHaveLength(counts.reduce((sum,count) => sum + count, 0));
        expect(candidates.filter(candidate => candidate.stage === 'bootstrap')).toHaveLength(Math.min(20,candidates.length));
        expect(candidates.filter(candidate => candidate.stage === 'capacity')).toHaveLength(Math.max(0,candidates.length - 20));
        expect(await f.database.query('SELECT season,payload FROM public.public_data_league_lists WHERE intake_id=$1 ORDER BY season', [id]))
          .toEqual(seasons.map(season => ({ season,payload: f.lists.get(season) })));
        expect(await f.database.query('SELECT exact_periods,terminal FROM public.public_data_intakes WHERE id=$1', [id]))
          .toEqual([{ exact_periods: periods, terminal: false }]);
        const tasks = await f.database.query('SELECT native_week,status,reason FROM public.public_data_exact_period_tasks WHERE intake_id=$1 ORDER BY ordinal', [id]);
        expect(tasks).toEqual([]);
        expect(await f.database.query('SELECT * FROM public.public_data_exact_period_checkpoints WHERE intake_id=$1', [id])).toEqual([]);
        const read = await readPublicSleeperIntake(f.database, f.administration, id);
        expect(read).toMatchObject({ status: 'pending', exactPeriodInventory: { status: 'capacity', expectedCount: expected.length,
          storedCount: tasks.length, missingCount: expected.length - tasks.length, taskLimit: 20, discoveryComplete: true, reason: 'period-inventory-capacity' } });
        if (read.status === 'missing' || !read.exactPeriods) throw new Error('Missing explicit capacity inventory.');
        expect(read.exactPeriods.map(period => [period.season,period.externalLeagueId,period.nativeWeek])).toEqual(expected);
        for (const period of read.exactPeriods) expect(period).toMatchObject({ collection: 'unavailable', reason: 'period-inventory-capacity',
          resource: { status: 'unavailable' }, acquisition: null });
        // Overflow is period-specific. Discovery is retained and the unchanged
        // bounded core path remains eligible; this case does not collect that core.
        const next = await f.intake.next(id); expect(next).toMatchObject({ kind: 'bootstrap' });
        if (typeof next === 'string') throw new Error('Capacity incorrectly closed pending core.');
        fence = await inventoryClaim(f, until);
        await expect(f.intake.admit({ requestId: id, revision: next.revision, kind: 'exact-matchups',
          season: seasons[0], externalLeagueId: String(expected[0][1]), nativeWeek: 7 }, fence)).rejects.toThrow();
        expect(await f.database.query('SELECT * FROM public.public_data_dispatches WHERE worker_id=$1 AND generation=$2', [fence.workerId,fence.generation])).toEqual([]);
        expect(await f.intake.next(id)).toEqual(next);
        expect(f.requests).toHaveLength(1 + seasons.length);
        expect(f.requests.every(url => !url.includes('/matchups/') && !url.includes('/league/'))).toBe(true);
        expect(await f.database.query("SELECT resource FROM public.public_data_dispatches WHERE intake_id=$1 AND resource='exact-matchups'", [id])).toEqual([]);
        diagnostics.stage('complete');
      } catch (error) { diagnostics.fail(error); }
      finally { await diagnostics.finish([
        () => f.fetch.mockRestore(),
        async () => { if (fence) await f.jobs.failJob(PUBLIC_INTAKE_JOB, fence.workerId, 'bounded capacity negative completed; core remains pending'); },
      ]); }
    }, 6 * 60_000);
});

describe('explicit native-week inventory upgrade over retained R039 capture', () => {
  beforeAll(async () => prepareIntegrationDatabase({ throughMigration: '039_public_data_capture_witness.sql' }));
  afterAll(async () => { await prepareIntegrationDatabase(); await installAllPlayerScheduleTestClock(); });

  it('preserves a real single-week checkpoint across R040 and refuses downlevel multi-week mutation [upgrade slow SQL]', async () => {
    const diagnostics = createPublicInventoryDiagnostics('upgrade');
    const connection = createIndependentDatabase();
    let owner: Awaited<ReturnType<typeof createPinnedIntegrationDatabase>> | undefined;
    const f = inventoryProofFixture(connection.database), id = randomUUID(), expandedId = randomUUID(), targetId = randomUUID();
    const single = [{ season: f.season, nativeWeek: 7 }], expanded = [...single,{ season: f.season, nativeWeek: 8 }];
    const configuration = { id: targetId, expectedRevision: 0, identityRequestId: id, seasons: [f.season], exactPeriods: single,
      cadenceSeconds: 60, expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), paused: true };
    const until = Date.now() + 9 * 60_000;
    let transaction = false;
    try {
      owner = await createPinnedIntegrationDatabase('owner');
      await inventoryVersion(f.database, diagnostics); diagnostics.stage('acquisition');
      const omittedId = randomUUID();
      await f.intake.submit({ id: omittedId, username: f.manager, seasons: [f.season] });
      await f.intake.submit({ id: omittedId, username: f.manager, seasons: [f.season], exactPeriods: [] });
      await f.intake.submit({ id, username: f.manager, seasons: [f.season], exactPeriods: single });
      for (const resource of ['identity','leagues','bootstrap','exact-matchups']) expect(await inventoryManualProgress(f, id, until, diagnostics))
        .toMatchObject({ status: 'progress', resource });
      const beforeRead = await assertInventoryPeriods(f, id, [7], 'pending');
      expect(await f.intake.next(id)).toMatchObject({ kind: 'core' });
      const refresh = createPublicDataRefreshStore(f.database);
      expect(await refresh.configure(configuration)).toMatchObject({ status: 'configured', configurationRevision: 1 });
      const configurationHistory = await f.database.query('SELECT * FROM public.public_data_refresh_configurations WHERE target_id=$1 ORDER BY revision', [targetId]);
      expect(configurationHistory).toHaveLength(1);
      const before = await inventoryHistory(f.database, id);
      diagnostics.stage('downlevel');
      const observedStatements: string[] = [];
      const observed: DatabaseClient = { ...f.database, async query<Row extends DatabaseRow = DatabaseRow>(statement: string, parameters: readonly unknown[] = [], options?: DatabaseQueryOptions) {
        observedStatements.push(statement); return f.database.query<Row>(statement, parameters, options);
      } };
      await expect(createPublicIntakeStore(observed).submit({ id: expandedId, username: f.manager, seasons: [f.season], exactPeriods: expanded }))
        .rejects.toThrow('Public multi-week inventory requires installed R040.');
      await expect(createPublicDataRefreshStore(observed).configure({ ...configuration, expectedRevision: 1, exactPeriods: expanded }))
        .rejects.toThrow('Public multi-week inventory requires installed R040.');
      expect(observedStatements.some(statement => statement.includes('capability'))).toBe(true);
      expect(observedStatements.some(statement => statement.includes('SELECT public.submit_public_data_intake') || statement.includes('SELECT public.configure_public_data_refresh'))).toBe(false);
      expect(await f.database.query('SELECT id FROM public.public_data_intakes WHERE id=$1', [expandedId])).toEqual([]);
      expect(await f.database.query('SELECT * FROM public.public_data_refresh_configurations WHERE target_id=$1 ORDER BY revision', [targetId])).toEqual(configurationHistory);
      await assertInventoryHistory(f.database, before);
      expect(f.requests).toHaveLength(5);
      diagnostics.stage('migration');
      const name = '040_public_data_exact_period_inventory.sql';
      const migration = (await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')).replace(/\r\n?/gu, '\n');
      expect(await owner.database.query('SELECT name FROM public.app_schema_migrations ORDER BY name DESC LIMIT 1')).toEqual([{ name: '039_public_data_capture_witness.sql' }]);
      await owner.database.query('BEGIN'); transaction = true;
      await owner.database.query("SELECT pg_advisory_xact_lock(hashtext('league-one-schema-migrations'))");
      await owner.database.query(migration);
      const checksum = createHash('sha256').update(migration).digest('hex');
      await owner.database.query('INSERT INTO public.app_schema_migrations(name,checksum) VALUES($1,$2)', [name,checksum]);
      await owner.database.query('COMMIT'); transaction = false;
      expect(await owner.database.query('SELECT name,checksum FROM public.app_schema_migrations WHERE name=$1', [name])).toEqual([{ name,checksum }]);
      await assertInventoryHistory(f.database, before);
      expect(await f.database.query('SELECT * FROM public.public_data_refresh_configurations WHERE target_id=$1 ORDER BY revision', [targetId])).toEqual(configurationHistory);
      const afterRead = await assertInventoryPeriods(f, id, [7], 'pending');
      expect(afterRead.results).toEqual(beforeRead.results); expect(afterRead.mapping).toEqual(beforeRead.mapping);
      diagnostics.stage('permissions');
      const privileges = async () => {
        diagnostics.stage('permissions-role');
        expect((await f.database.query(`SELECT role.rolsuper,role.rolcreatedb,role.rolcreaterole,role.rolinherit,role.rolbypassrls,
          EXISTS(SELECT 1 FROM pg_auth_members member WHERE member.member=role.oid) AS memberships FROM pg_roles role WHERE role.rolname=current_user`))[0])
          .toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolinherit: false, rolbypassrls: false, memberships: false });
        diagnostics.stage('permissions-functions-allowed');
        for (const signature of ['public.submit_public_data_intake(jsonb)','public.configure_public_data_refresh(jsonb)',
          'public.begin_exact_matchup_attempt(jsonb,uuid,integer,jsonb)','public.read_public_data_capture_witness(jsonb,jsonb,jsonb)']) {
          expect((await f.database.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') AS allowed", [signature]))[0].allowed).toBe(true);
        }
        for (const signature of ['public.canonical_public_data_exact_periods(jsonb,integer[])','public.public_data_exact_period_inventory_v40(uuid)',
          'public.validate_public_data_exact_period_task()','public.validate_public_data_exact_period_checkpoint()',
          'public.derive_public_data_capture_witness(jsonb,jsonb,jsonb)','public.fail_public_data_work(jsonb)']) {
          diagnostics.stage('permissions-functions-denied');
          expect((await f.database.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') AS allowed", [signature]))[0].allowed).toBe(false);
          diagnostics.stage('permissions-public-acl');
          expect((await f.database.query(`SELECT COALESCE(bool_or(acl.grantee=0 AND acl.privilege_type='EXECUTE'),false) AS allowed
            FROM pg_proc procedure CROSS JOIN LATERAL aclexplode(COALESCE(procedure.proacl,acldefault('f',procedure.proowner))) acl
            WHERE procedure.oid=to_regprocedure($1)`, [signature]))[0].allowed).toBe(false);
        }
        diagnostics.stage('permissions-tables');
        for (const table of ['public_data_exact_period_tasks','public_data_exact_period_checkpoints','public_data_dispatches',
          'public_data_dispatch_outcomes','league_roster_capture_receipts','league_roster_resource_acceptances']) {
          expect((await f.database.query("SELECT has_table_privilege(current_user,$1,'SELECT') AS readable,has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS writable", ['public.' + table]))[0])
            .toEqual({ readable: true, writable: false });
        }
        diagnostics.stage('permissions-update-denial');
        await expect(f.database.query('UPDATE public.public_data_exact_period_tasks SET native_week=8 WHERE intake_id=$1', [id])).rejects.toMatchObject({ code: '42501' });
        diagnostics.stage('permissions-delete-denial');
        await expect(f.database.query('DELETE FROM public.public_data_exact_period_checkpoints WHERE intake_id=$1', [id])).rejects.toMatchObject({ code: '42501' });
      };
      await privileges();
      diagnostics.stage('permissions-provision-first');
      const provision = await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8');
      await owner.database.query(provision);
      diagnostics.stage('permissions-provision-repeat');
      await owner.database.query(provision); await privileges();
      diagnostics.stage('permissions-history');
      await assertInventoryHistory(f.database, before);
      diagnostics.stage('permissions-constraint');
      const uniqueColumns = await f.database.query(`SELECT array_agg(attribute.attname::text ORDER BY key.ordinality) AS columns
        FROM pg_constraint constraint_row CROSS JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY key(number,ordinality)
        JOIN pg_attribute attribute ON attribute.attrelid=constraint_row.conrelid AND attribute.attnum=key.number
        WHERE constraint_row.conrelid='public.public_data_exact_period_tasks'::regclass AND constraint_row.contype='u'
        GROUP BY constraint_row.oid`);
      expect(uniqueColumns).toEqual([{ columns: ['intake_id','season','external_league_id','native_week'] }]);
      diagnostics.stage('acquisition');
      for (const resource of ['core','users']) expect(await inventoryManualProgress(f, id, until, diagnostics)).toMatchObject({ status: 'progress', resource });
      await assertInventoryPeriods(f, id, [7], 'available');
      await assertInventoryHistory(f.database, before.filter(entry => entry.statement.includes('league_roster_')
        || entry.statement.includes('league_administration_') || entry.statement.includes('public_data_exact_period_')
        || entry.statement.includes('public_data_identity_observations') || entry.statement.includes('public_data_league_lists')));
      diagnostics.stage('configuration');
      await f.intake.submit({ id: expandedId, username: f.manager, seasons: [f.season], exactPeriods: [...expanded].reverse() });
      await f.intake.submit({ id: expandedId, username: f.manager, seasons: [f.season], exactPeriods: expanded });
      expect(await f.database.query('SELECT exact_periods FROM public.public_data_intakes WHERE id=$1', [expandedId])).toEqual([{ exact_periods: expanded }]);
      expect(await refresh.configure({ ...configuration, expectedRevision: 1, exactPeriods: expanded })).toMatchObject({ status: 'configured', configurationRevision: 2 });
      expect(await f.database.query('SELECT * FROM public.public_data_refresh_configurations WHERE target_id=$1 AND revision=1', [targetId])).toEqual(configurationHistory);
      expect(await f.database.query('SELECT exact_periods FROM public.public_data_intakes WHERE id=$1', [omittedId])).toEqual([{ exact_periods: [] }]);
      expect(f.requests).toHaveLength(8);
      const admissions = await f.database.query('SELECT admitted_at FROM public.public_data_dispatches WHERE intake_id=$1 ORDER BY admitted_at', [id]);
      expect(admissions).toHaveLength(6);
      for (let index = 1; index < admissions.length; index++) expect(Date.parse(exactMatchupClockInstant(admissions[index].admitted_at)) - Date.parse(exactMatchupClockInstant(admissions[index - 1].admitted_at))).toBeGreaterThanOrEqual(60_000);
      diagnostics.stage('complete');
    } catch (error) { diagnostics.fail(error); }
    finally { await diagnostics.finish([
      () => f.fetch.mockRestore(),
      async () => { if (transaction) await owner?.database.query('ROLLBACK'); },
      async () => { await owner?.close(); },
      () => connection.close(),
    ]); }
  }, 10 * 60_000);
});
