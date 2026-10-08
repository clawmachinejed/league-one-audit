import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIndependentDatabase, createReceiptDiagnosticReader, type IndependentDatabase } from './neon-integration-harness';
import { createProjectionStore } from '../lib/projection-store';
import { createLeagueAdministrationStore, createPublicDataRefreshStore, createPublicIntakeStore } from '../lib/league-administration/store';
import { runPublicDataRefreshStep, runPublicIntakeStep } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
import type { CapturedAdministrationDocument } from '../lib/league-administration/contracts';
import type { DatabaseRow } from '../lib/database';
import { createPublicDataDiagnostics, observePublicDataDependencies } from './public-data-refresh-diagnostics';
import { assertLiveJson, liveRawOracle, normalizeLiveCapture } from './live-league-two';
import { createLiveJourney, JOURNEY_CASE_MS, JOURNEY_LOOP_MS, JOURNEY_CADENCE_SECONDS, JOURNEY_LEAGUES,
  JOURNEY_MANAGER, JOURNEY_SEASON, JOURNEY_USERNAME, JOURNEY_STEPS } from './public-data-live';
import { JOURNEY_SUITE, JOURNEY_TEST, qualificationDigest, requireJourneyQualification } from './qualification-profile';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { writeIntegrationArtifact } from './integration-artifacts';

// Refuse direct/default collection before any hooks, database or HTTP work.
const binding = requireJourneyQualification();
describe(JOURNEY_SUITE, () => {
  let connection: IndependentDatabase | undefined;
  beforeAll(() => { connection = createIndependentDatabase(); });
  afterAll(async () => connection?.close());
  it(JOURNEY_TEST, async () => {
    const diagnostics = createPublicDataDiagnostics('journey');
    const originalFetch = globalThis.fetch, source = createLiveJourney(originalFetch);
    const changes: { leagueId: string; family: string; content: 'changed' | 'unchanged' }[] = [];
    const equal = (id: Parameters<typeof diagnostics.comparison>[0], actual: unknown, expected: unknown) =>
      diagnostics.assertion('live-core', () => diagnostics.comparison(id, actual, expected, (a, e) => expect(a).toEqual(e)));
    let claims = 0, admissions = 0, currentRequest: string | undefined;
    let finalized = false;
    globalThis.fetch = source.fetch;
    try {
      const database = connection!.database;
      const [session] = await database.query("SELECT session_user AS role,current_user AS effective_role," +
        "current_setting('server_version') AS server_version,current_setting('server_version_num') AS server_version_num");
      equal('live.roles', { role: session.role, effective_role: session.effective_role }, { role: 'league_one_runtime', effective_role: 'league_one_runtime' });
      diagnostics.recordDatabaseVersion(session);
      const receiptReader = createReceiptDiagnosticReader();
      const administration = createLeagueAdministrationStore(database), intake = createPublicIntakeStore(database);
      const jobs = createProjectionStore(database), refresh = createPublicDataRefreshStore(database);
      const manualId = randomUUID(), targetId = randomUUID();
      type Write = { input: Parameters<typeof administration.recordObservation>[0]; result: Awaited<ReturnType<typeof administration.recordObservation>> };
      const writes: Write[] = [];
      let selectedStep = JOURNEY_STEPS[0];
      const dependencies = observePublicDataDependencies(diagnostics, {
        administration: { ...administration, recordObservation: async (...args: Parameters<typeof administration.recordObservation>) => {
          const result = await administration.recordObservation(...args); writes.push({ input: args[0], result }); return result;
        } },
        intake: { ...intake, admit: async (...args: Parameters<typeof intake.admit>) => {
          const work = args[0];
          expect(work).toMatchObject({ requestId: currentRequest, kind: selectedStep.kind,
            ...(selectedStep.leagueId ? { externalLeagueId: selectedStep.leagueId, season: JOURNEY_SEASON } : {}) });
          if (admissions >= 28) throw new Error('Live admission cap reached.');
          const result = await intake.admit(...args); if (result) admissions++; return result;
        } },
        jobs: { ...jobs, acquireJob: async (...args: Parameters<typeof jobs.acquireJob>) => {
          if (claims >= 29) throw new Error('Live owner-claim cap reached.');
          const result = await jobs.acquireJob(...args); if (result.kind === 'acquired') claims++; return result;
        } },
        refresh: { ...refresh, select: async (...args: Parameters<typeof refresh.select>) => {
          const selection = await refresh.select(...args);
          if (selection.status === 'selected') {
            expect(selection).toMatchObject({ targetId, cycle: 1, configurationRevision: 1, cycleConfigurationRevision: 1 });
            if (currentRequest && currentRequest !== manualId) expect(selection.requestId).toBe(currentRequest);
            expect(selection.requestId).not.toBe(manualId); currentRequest = selection.requestId;
          }
          return selection;
        } }, source: source.source, managerEvidenceVersion: 'v2',
      }, receiptReader);
      const firstIdentity = new Map<string, unknown>();
      const firstReceipts = new Map<string, string[]>();
      const firstDirectories = new Map<string, string>();
      const firstNativeTeams = new Map<string, string>();
      const firstManagers = new Map<string, string>();
      const reverseManagers = new Map<string, string>();
      const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
      const firstWrites = new Map<string, string>();
      const history: { sql: string; args: unknown[]; rows: readonly DatabaseRow[] }[] = [];
      const capture = (cycle: number, kind: string, leagueId: string | null, family: string) => {
        const rows = source.captures.filter(row => row.cycle === cycle && row.family === family && row.leagueId === leagueId
          && row.capture.acquisition?.work.kind === kind);
        expect(rows).toHaveLength(1); return rows[0].capture;
      };
      const proveCollection = async (requestId: string, cycle: 1 | 2) => {
        const read = await readPublicSleeperIntake(database, administration, requestId, { managerEvidenceVersion: 'v2' });
        expect(read).toMatchObject({ status: 'available', request: { id: requestId, terminal: true, external_manager_id: JOURNEY_MANAGER,
          seasons: [JOURNEY_SEASON], failure_count: 0 }, rejected: [] });
        if (read.status === 'missing') throw new Error('Missing live intake.');
        expect(read.leagues.map(row => row.externalLeagueId)).toEqual([...JOURNEY_LEAGUES]);
        expect(read.lists).toHaveLength(1);
        const identity = capture(cycle, 'identity', null, 'identity'), list = capture(cycle, 'leagues', null, 'leagues');
        const retainedIdentity = await database.query('SELECT payload,request_started_at,request_completed_at FROM public.public_data_identity_observations WHERE intake_id=$1', [requestId]);
        const retainedList = await database.query('SELECT payload,request_started_at,request_completed_at FROM public.public_data_league_lists WHERE intake_id=$1', [requestId]);
        for (const [stored, original] of [[retainedIdentity, identity], [retainedList, list]] as const) {
          expect(stored).toHaveLength(1); assertLiveJson(stored[0].payload, original.payload, equal, 'directory');
          expect(exactMatchupClockInstant(stored[0].request_started_at)).toBe(original.requestStartedAt);
          expect(exactMatchupClockInstant(stored[0].request_completed_at)).toBe(original.requestCompletedAt);
        }
        const allReceipts: string[] = [], allContents: string[] = [], allObservations: string[] = [];
        for (const leagueId of JOURNEY_LEAGUES) {
          const league = capture(cycle, 'core', leagueId, 'league') as CapturedAdministrationDocument;
          const roster = capture(cycle, 'core', leagueId, 'rosters') as CapturedAdministrationDocument;
          const users = capture(cycle, 'users', leagueId, 'users') as CapturedAdministrationDocument;
          const bootstrap = capture(cycle, 'bootstrap', leagueId, 'league');
          const raw = liveRawOracle(league.payload, roster.payload, users.payload, { leagueId, season: JOURNEY_SEASON });
          expect(raw.metadata.totalRosters).toBeLessThanOrEqual(20);
          const mapping = await administration.readSourceMapping(leagueId);
          if (!mapping) throw new Error('Missing live mapping.');
          const [canonical] = await database.query('SELECT league.id AS league_id,season.id AS league_season_id,connection.id AS connection_id,' +
            'season.scoring_profile_id,enrollment.active,enrollment.evidence FROM public.league_source_connections connection ' +
            'JOIN public.league_seasons season ON season.id=connection.league_season_id JOIN public.leagues league ON league.id=season.league_id ' +
            'JOIN public.league_administration_enrollments enrollment ON enrollment.league_id=league.id ' +
            "WHERE connection.provider='sleeper' AND connection.external_league_id=$1 AND season.season=$2", [leagueId, JOURNEY_SEASON]);
          expect(canonical).toMatchObject({ league_season_id: mapping.leagueSeasonId, connection_id: mapping.connectionId,
            scoring_profile_id: null, active: false, evidence: 'public-data-intake-v1' });
          for (const id of [canonical.league_id, canonical.league_season_id, canonical.connection_id]) expect(id).toMatch(uuid);
          if (cycle === 1) firstIdentity.set(leagueId, canonical); else expect(canonical).toEqual(firstIdentity.get(leagueId));
          const settings = await administration.readAcceptedLeagueSettings(mapping);
          const players = await administration.readAcceptedCurrentRoster(mapping);
          const managers = await administration.readAcceptedTeamManagers(mapping);
          const evidence = await administration.readAcceptedTeamManagerEvidence!(mapping);
          const directory = await administration.readSource({ ...mapping.scope, family: 'users', week: null });
          equal('live.availability', [settings.status, players.status, managers.status, evidence.status, directory.status], Array(5).fill('available'));
          if (settings.status !== 'available' || players.status !== 'available' || managers.status !== 'available'
            || evidence.status !== 'available' || directory.status !== 'available') throw new Error('Missing live stored resource.');
          const inputs = [league, roster, users].map(document => {
            const entries = writes.filter(row => row.input.envelope.family === document.family
              && row.input.envelope.scope.externalLeagueId === leagueId
              && row.input.envelope.provenance.acquisition?.work.requestId === requestId);
            expect(entries).toHaveLength(1);
            const write = entries[0];
            const normalized = normalizeLiveCapture(mapping.scope, document, write.input.envelope.provenance.checkedAt, raw.metadata.totalRosters);
            assertLiveJson(write.input.envelope, normalized.envelope, equal, 'population');
            equal('live.writer.input', { contentHash: write.input.contentHash, semanticHash: write.input.semanticHash, status: write.input.status },
              { contentHash: normalized.contentHash, semanticHash: normalized.semanticHash, status: 'accepted' });
            const key = leagueId + ':' + document.family;
            if (cycle === 1) firstWrites.set(key, write.input.contentHash);
            else changes.push({ leagueId, family: document.family, content: firstWrites.get(key) === write.input.contentHash ? 'unchanged' : 'changed' });
            return { normalized, write };
          });
          assertLiveJson(settings.value, inputs[0].normalized.leagueSettings?.value, equal, 'settings');
          assertLiveJson(settings.value.scoring.rules.value, raw.rules, equal, 'settings');
          equal('live.settings.slots', settings.value.slots.value, raw.slots.map((nativeCode, ordinal) => ({ nativeCode, count: 1, ordinal, semantics: 'ordered-occurrence' })));
          equal('live.players.roster-ids', players.teams.map(team => team.externalRosterId).sort(), raw.teams.map(team => team.externalRosterId).sort());
          for (const reader of [managers, evidence]) equal('live.managers.roster-ids', reader.teams.map(team => team.sourceTeam.nativeId).sort(), raw.teams.map(team => team.externalRosterId).sort());
          expect(new Set(players.teams.map(team => team.seasonTeamId)).size).toBe(raw.teams.length);
          for (const team of raw.teams) {
            const held = players.teams.find(value => value.externalRosterId === team.externalRosterId)!;
            equal('live.players.ids', held.players.map(player => player.sourceEntity.nativeId).sort(), team.players);
            expect(held.seasonTeamId).toMatch(uuid);
            const key = leagueId + ':' + team.externalRosterId;
            if (cycle === 1) firstNativeTeams.set(key, held.seasonTeamId);
            else if (firstNativeTeams.has(key)) expect(held.seasonTeamId).toBe(firstNativeTeams.get(key));
            for (const reader of [managers, evidence]) {
              const stored = reader.teams.find(value => value.sourceTeam.nativeId === team.externalRosterId)!;
              equal('live.receipt.mapping', stored.seasonTeamId, held.seasonTeamId);
              equal('live.managers.primary', { state: stored.primaryOwner.state, nativeId: stored.primaryOwner.manager?.sourceManager.nativeId ?? null },
                { state: team.owner === null ? 'unowned' : 'owned', nativeId: team.owner });
              equal('live.managers.coowners', { state: stored.coManagers.state, ids: stored.coManagers.managers?.map(manager => manager.sourceManager.nativeId).sort() ?? null,
                ...(stored.coManagers.state === 'unknown' ? { reason: stored.coManagers.reason } : {}) }, team.coOwners);
              for (const manager of [stored.primaryOwner.manager, ...(stored.coManagers.managers ?? [])]) {
                if (!manager) continue;
                const native = manager.sourceManager.nativeId;
                expect(manager.providerManagerId).toMatch(uuid);
                if (reverseManagers.has(manager.providerManagerId)) expect(native).toBe(reverseManagers.get(manager.providerManagerId));
                else reverseManagers.set(manager.providerManagerId, native);
                equal('live.identity.reference', manager.sourceManager, { provider: 'sleeper', resourceKind: 'manager', nativeNamespace: 'account', nativeId: native });
                if (firstManagers.has(native)) expect(manager.providerManagerId).toBe(firstManagers.get(native));
                else firstManagers.set(native, manager.providerManagerId);
              }
            }
          }
          const canonicalManagers = evidence.teams.map(team => ({ externalRosterId: team.sourceTeam.nativeId,
            primaryOwner: team.primaryOwner.state === 'owned' ? { state: 'owned', externalManagerId: team.primaryOwner.manager.sourceManager.nativeId }
              : { state: team.primaryOwner.state, externalManagerId: null, ...('reason' in team.primaryOwner ? { reason: team.primaryOwner.reason } : {}) },
            coManagers: { state: team.coManagers.state, externalManagerIds: team.coManagers.managers?.map(manager => manager.sourceManager.nativeId) ?? null,
              ...('reason' in team.coManagers ? { reason: team.coManagers.reason } : {}) },
          })).sort((a, b) => a.externalRosterId.localeCompare(b.externalRosterId));
          equal('live.manager-evidence.canonical', { teams: canonicalManagers, completeness: evidence.evidenceCompleteness },
            { teams: [...(inputs[1].normalized.teamManagerEvidence?.teams ?? [])].sort((a, b) => a.externalRosterId.localeCompare(b.externalRosterId)), completeness: inputs[1].normalized.teamManagerEvidence?.status });
          assertLiveJson(directory.envelope.payload, users.payload, equal, 'directory');
          const [candidate] = await database.query('SELECT * FROM public.public_data_league_candidates WHERE intake_id=$1 AND external_league_id=$2', [requestId, leagueId]);
          expect(candidate).toMatchObject({ stage: 'complete', league_season_id: mapping.leagueSeasonId,
            settings_receipt_id: settings.receipt.id, players_receipt_id: players.receipt.id, managers_receipt_id: managers.receipt.id,
            league_observation_id: settings.receipt.legacyObservationId, roster_observation_id: players.receipt.legacyObservationId,
            users_observation_id: directory.observationId, bootstrap_payload: bootstrap.payload });
          expect(exactMatchupClockInstant(candidate.bootstrap_started_at)).toBe(bootstrap.requestStartedAt);
          expect(exactMatchupClockInstant(candidate.bootstrap_completed_at)).toBe(bootstrap.requestCompletedAt);
          const acceptedWrites = [inputs[0].write.result.leagueSettingsAcceptance, inputs[1].write.result.rosterAcceptance,
            inputs[1].write.result.teamManagerAcceptance, inputs[1].write.result.teamManagerEvidenceAcceptance];
          const readers = [settings, players, managers, evidence];
          equal('live.write', acceptedWrites.map(value => value?.status), Array(4).fill('accepted'));
          const ids = readers.map(reader => reader.receipt.id); expect(new Set(ids).size).toBe(4); allReceipts.push(...ids);
          if (cycle === 1) firstReceipts.set(leagueId, ids); else expect(ids.some(id => firstReceipts.get(leagueId)!.includes(id))).toBe(false);
          const lineage = await database.query(`SELECT receipt.id,attempt.id AS attempt_id,attempt.source_mapping,receipt.provenance,receipt.population_evidence,
            dispatch.intake_id,dispatch.resource,attempt.capture_nonce IS NOT NULL AND dispatch.capture_nonce IS NOT NULL
            AND receipt.provenance->'acquisition'->>'dispatchNonce'=dispatch.capture_nonce::text
            AND receipt.provenance->'acquisition'->'work'=dispatch.work
            AND receipt.provenance->'acquisition'->'fence'=attempt.write_fence
            AND receipt.provenance->'acquisition'->'mapping'=attempt.source_mapping
            AND receipt.provenance->'acquisition'->'attempts'->CASE scope.identity->'policy'->>'canonicalNormalizerVersion'
              WHEN 'sleeper-league-settings-v1' THEN 'settings' WHEN 'sleeper-current-players-v1' THEN 'players'
              WHEN 'sleeper-current-team-managers-v1' THEN 'managers' ELSE 'managersV2' END=jsonb_build_object('id',attempt.id,'nonce',attempt.capture_nonce) AS exact_witness,
            attempt.reserved_at>=dispatch.admitted_at AND receipt.recorded_at>=attempt.reserved_at
              AND receipt.recorded_at<=dispatch.admitted_at+interval '30 seconds' AS server_window
            FROM public.league_roster_capture_receipts receipt JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
            JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id JOIN public.public_data_dispatches dispatch
              ON dispatch.worker_id=attempt.write_fence->>'workerId' AND dispatch.generation=(attempt.write_fence->>'generation')::integer
            WHERE receipt.id=ANY($1::uuid[])`, [ids]);
          expect(lineage).toHaveLength(4); expect(new Set(lineage.map(row => row.attempt_id)).size).toBe(4);
          for (const [i, reader] of readers.entries()) {
            const original = i === 0 ? league : roster, input = inputs[i === 0 ? 0 : 1];
            equal('live.receipt.provenance', reader.receipt.provenance, input.normalized.envelope.provenance);
            expect(reader.accepted.acceptedGeneration).toBe(acceptedWrites[i]!.acceptedGeneration);
            expect(reader.receipt.legacyObservationId).toBe(input.write.result.observationId);
            allContents.push(reader.accepted.contentId); allObservations.push(reader.receipt.legacyObservationId);
            expect(reader.receipt.id).toBe(acceptedWrites[i]!.receiptId);
            expect(reader.accepted.observationIds).toEqual([reader.receipt.id]);
            expect(reader.receipt.provenance).toMatchObject({ acquisition: original.acquisition,
              requestStartedAt: original.requestStartedAt, requestCompletedAt: original.requestCompletedAt, sourceObservedAt: original.requestCompletedAt });
            expect(lineage.find(row => row.id === reader.receipt.id)).toMatchObject({ attempt_id: reader.receipt.attemptId,
              intake_id: requestId, resource: 'core', source_mapping: mapping, exact_witness: true, server_window: true, provenance: reader.receipt.provenance });
            expect(reader.accepted.sourceMappingRevisionId).toBe(mapping.revisionId);
          }
          equal('live.receipt.hash', settings.receipt.rawContentHash, inputs[0].normalized.contentHash);
          for (const reader of [players, managers, evidence]) {
            equal('live.receipt.population', { configurationContentId: reader.receipt.configurationContentId, expectedTeamCount: reader.receipt.expectedTeamCount },
              { configurationContentId: settings.accepted.contentId, expectedTeamCount: raw.metadata.totalRosters });
            expect(lineage.find(row => row.id === reader.receipt.id)!.population_evidence).toMatchObject({ provenance: { acquisition: league.acquisition } });
          }
          const [directoryCapture] = await database.query('SELECT * FROM public.public_data_directory_captures WHERE id=$1 AND intake_id=$2', [candidate.users_capture_id, requestId]);
          expect(directoryCapture).toMatchObject({ legacy_observation_id: directory.observationId, source_mapping: mapping });
          allContents.push(String(directoryCapture.content_id)); allObservations.push(String(directoryCapture.legacy_observation_id));
          expect(exactMatchupClockInstant(directoryCapture.request_started_at)).toBe(users.requestStartedAt);
          expect(exactMatchupClockInstant(directoryCapture.request_completed_at)).toBe(users.requestCompletedAt);
          expect(exactMatchupClockInstant(directoryCapture.source_observed_at)).toBe(users.requestCompletedAt);
          if (cycle === 1) firstDirectories.set(leagueId, String(directoryCapture.id)); else expect(directoryCapture.id).not.toBe(firstDirectories.get(leagueId));
          const composed = read.leagues.find(row => row.externalLeagueId === leagueId)!;
          expect(composed).toMatchObject({ collection: 'complete', resources: {
            settings: { status: 'available', receipt: settings.receipt }, heldRoster: { status: 'available', receipt: players.receipt },
            teamManagers: { status: 'available', receipt: managers.receipt }, teamManagerEvidence: { status: 'available', receipt: evidence.receipt },
            directory: { status: 'available', observationId: directory.observationId, acquisition: { id: directoryCapture.id, sourceMapping: mapping } },
          } });
        }
        expect(new Set([...firstIdentity.values()].map(value => (value as DatabaseRow).league_id)).size).toBe(JOURNEY_LEAGUES.length);
        expect(new Set(firstNativeTeams.values()).size).toBe(firstNativeTeams.size);
        const accountRows = await database.query("SELECT id,external_manager_id FROM public.league_source_manager_accounts WHERE provider='sleeper' AND id=ANY($1::uuid[]) ORDER BY external_manager_id", [[...reverseManagers.keys()]]);
        expect(accountRows).toEqual([...firstManagers].map(([external_manager_id, id]) => ({ id, external_manager_id }))
          .sort((a, b) => a.external_manager_id.localeCompare(b.external_manager_id)));
        const dispatches = await database.query(`SELECT dispatch.resource,dispatch.work,outcome.capture_acquisition,
          outcome.outcome,outcome.capture_acquisition->>'dispatchNonce'=dispatch.capture_nonce::text AS exact_nonce,
          outcome.recorded_at BETWEEN dispatch.admitted_at AND dispatch.admitted_at+interval '30 seconds' AS server_window
          FROM public.public_data_dispatches dispatch LEFT JOIN public.public_data_dispatch_outcomes outcome USING(worker_id,generation)
          WHERE dispatch.intake_id=$1 ORDER BY dispatch.admitted_at`, [requestId]);
        expect(dispatches).toHaveLength(14);
        for (const [i, row] of dispatches.entries()) {
          const step = JOURNEY_STEPS[(cycle - 1) * 14 + i];
          expect(row).toMatchObject({ resource: step.kind, outcome: 'checkpoint-committed', exact_nonce: true, server_window: true });
          const original = source.captures.find(entry => entry.cycle === cycle && entry.capture.acquisition?.work.kind === step.kind && entry.leagueId === (step.leagueId ?? null))!;
          expect(row.capture_acquisition).toEqual(original.capture.acquisition); expect(row.work).toEqual(original.capture.acquisition!.work);
        }
        if (cycle === 1) {
          for (const table of ['public_data_intakes', 'public_data_identity_observations', 'public_data_league_lists', 'public_data_league_candidates', 'public_data_directory_captures', 'public_data_dispatches']) {
            const sql = `SELECT * FROM public.${table} WHERE ${table === 'public_data_intakes' ? 'id' : 'intake_id'}=$1 ORDER BY to_jsonb(${table})::text`;
            const args = [requestId], rows = await database.query(sql, args); expect(rows.length).toBeGreaterThan(0); history.push({ sql, args, rows });
          }
          for (const [table, predicate] of [
            ['league_roster_capture_receipts', 'id=ANY($1::uuid[])'],
            ['league_roster_resource_attempts', 'id IN (SELECT attempt_id FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[]))'],
            ['league_roster_resource_acceptances', 'receipt_id=ANY($1::uuid[])'],
          ]) {
            const sql = `SELECT * FROM public.${table} WHERE ${predicate} ORDER BY to_jsonb(${table})::text`, args = [allReceipts];
            const rows = await database.query(sql, args); expect(rows).toHaveLength(16); history.push({ sql, args, rows });
          }
          for (const [table, column, ids] of [
            ['league_administration_contents', 'id', allContents],
            ['league_administration_observations', 'id', allObservations],
            ['league_administration_team_entries', 'content_id', allContents],
            ['league_administration_manager_entries', 'content_id', allContents],
            ['league_team_manager_entries', 'content_id', allContents],
            ['league_team_manager_memberships', 'content_id', allContents],
          ] as const) {
            const sql = `SELECT * FROM public.${table} WHERE ${column}=ANY($1::uuid[]) ORDER BY to_jsonb(${table})::text`;
            const args = [[...new Set(ids)]], rows = await database.query(sql, args);
            expect(rows.length).toBeGreaterThan(0); history.push({ sql, args, rows });
          }
          const sql = 'SELECT outcome.* FROM public.public_data_dispatch_outcomes outcome JOIN public.public_data_dispatches dispatch USING(worker_id,generation) WHERE dispatch.intake_id=$1 ORDER BY outcome.worker_id,outcome.generation';
          const args = [requestId], rows = await database.query(sql, args); expect(rows).toHaveLength(14); history.push({ sql, args, rows });
        } else for (const item of history) expect(await database.query(item.sql, item.args)).toEqual(item.rows);
      };
      await intake.submit({ id: manualId, username: JOURNEY_USERNAME, seasons: [JOURNEY_SEASON] });
      currentRequest = manualId;
      const until = performance.now() + JOURNEY_LOOP_MS;
      let notBefore = performance.now();
      const waitForAdmission = async () => {
        const wait = Math.max(0, notBefore - performance.now());
        if (performance.now() + wait >= until) throw new Error('Live journey work bound exhausted.');
        if (wait) await delay(wait); if (performance.now() >= until) throw new Error('Live journey work bound exhausted.');
      };
      for (let completed = 0; completed < 28;) {
        await waitForAdmission(); selectedStep = source.beginStep(currentRequest);
        diagnostics.beginStep(selectedStep.cycle);
        const outcome = selectedStep.cycle === 1
          ? await runPublicIntakeStep(manualId, dependencies, AbortSignal.timeout(Math.max(1, Math.floor(Math.min(20_000, until - performance.now())))))
          : await runPublicDataRefreshStep(dependencies, AbortSignal.timeout(Math.max(1, Math.floor(Math.min(20_000, until - performance.now())))));
        diagnostics.checkOutcome(outcome);
        if (outcome.status === 'busy') { source.finishStep(false); notBefore = performance.now() + 1_000; continue; }
        expect(outcome).toMatchObject({ status: 'progress', resource: selectedStep.kind, providerRequests: selectedStep.kind === 'core' ? 2 : 1 });
        source.finishStep(true); completed++; expect(admissions).toBe(completed); expect(claims).toBe(completed);
        process.stdout.write('PUBLIC_DATA_LIVE_PROGRESS ' + JSON.stringify({ step: completed, collection: selectedStep.cycle, resource: selectedStep.kind }) + '\n');
        // Real waiting after observed completion; never change the clock, DB admission or fence.
        notBefore = performance.now() + 60_000;
        if (completed === 14) {
          await diagnostics.observe('reader.intake', () => proveCollection(manualId, 1));
          await refresh.configure({ id: targetId, expectedRevision: 0, identityRequestId: manualId, seasons: [JOURNEY_SEASON],
            cadenceSeconds: JOURNEY_CADENCE_SECONDS, expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), paused: false });
          currentRequest = undefined;
        }
        if (completed === 28) await diagnostics.observe('reader.intake', () => proveCollection(currentRequest!, 2));
      }
      source.assertComplete();
      await waitForAdmission(); diagnostics.beginStep(2);
      const settled = await runPublicDataRefreshStep(dependencies, AbortSignal.timeout(Math.max(1, Math.floor(Math.min(20_000, until - performance.now())))));
      diagnostics.checkOutcome(settled); expect(settled).toEqual({ status: 'backoff', providerRequests: 0 });
      const composed = await diagnostics.observe('reader.refresh', () => readPublicDataRefresh(database, administration, targetId, { managerEvidenceVersion: 'v2' }));
      expect(composed).toMatchObject({ status: 'available', target: { id: targetId, externalManagerId: JOURNEY_MANAGER,
        cadenceSeconds: JOURNEY_CADENCE_SECONDS }, cycle: { number: 1, requestId: currentRequest, outcome: { disposition: 'complete' } },
        intake: { status: 'available', request: { terminal: true } } });
      expect(await database.query('SELECT cycle FROM public.public_data_refresh_cycles WHERE target_id=$1', [targetId])).toEqual([{ cycle: 1 }]);
      expect(await database.query('SELECT disposition FROM public.public_data_refresh_cycle_outcomes WHERE target_id=$1', [targetId])).toEqual([{ disposition: 'complete' }]);
      const [spacing] = await database.query(`SELECT count(*)::int AS count,bool_and(gap>=interval '60 seconds') AS bounded FROM (
        SELECT admitted_at-lag(admitted_at) OVER (ORDER BY admitted_at) AS gap FROM public.public_data_dispatches) entries`);
      expect(spacing).toEqual({ count: 28, bounded: true }); expect(claims).toBe(29); expect(admissions).toBe(28);
      expect(await database.query(`SELECT dispatch.worker_id FROM public.public_data_dispatches dispatch LEFT JOIN public.public_data_dispatch_outcomes outcome
        USING(worker_id,generation) WHERE outcome.worker_id IS NULL`)).toEqual([]);
      source.assertComplete();
      for (const row of source.captures) expect(qualificationDigest(row.capture.payload)).toBe(row.payloadDigest);
      finalized = true;
      process.stdout.write('PUBLIC_DATA_LIVE_PROGRESS ' + JSON.stringify({ step: 29, collection: 2, resource: 'settlement' }) + '\n');
    } catch (error) { throw diagnostics.failure('case', error); }
    finally {
      globalThis.fetch = originalFetch;
      try { await diagnostics.observe('artifact.write', () => writeIntegrationArtifact('public-data-live-captures.json', {
        kind: 'public-data-live-captures-v1', contextDigest: qualificationDigest(binding.context), claims, admissions, finalized,
        changes, ...source.snapshot(),
      })); } finally { await diagnostics.save(); }
    }
  }, JOURNEY_CASE_MS);
});
