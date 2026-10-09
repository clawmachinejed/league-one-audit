import { createHash, randomUUID } from 'node:crypto';
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
    const check = <A, E>(checkpoint: Parameters<typeof diagnostics.assertion>[0], id: Parameters<typeof diagnostics.comparison>[0],
      actual: A, expected: E, assertion: (actual: A, expected: E) => void) =>
      diagnostics.assertion(checkpoint, () => diagnostics.comparison(id, actual, expected, assertion));
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
          check('live-core', 'journey.admission.work', work, { requestId: currentRequest, kind: selectedStep.kind,
            ...(selectedStep.leagueId ? { externalLeagueId: selectedStep.leagueId, season: JOURNEY_SEASON } : {}) }, (a, e) => expect(a).toMatchObject(e));
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
            check('journey-complete', 'journey.refresh.selection', selection, { targetId, cycle: 1, configurationRevision: 1, cycleConfigurationRevision: 1 }, (a, e) => expect(a).toMatchObject(e));
            if (currentRequest && currentRequest !== manualId) check('journey-complete', 'journey.refresh.same-request', selection.requestId, currentRequest, (a, e) => expect(a).toBe(e));
            check('journey-complete', 'journey.refresh.fresh-request', selection.requestId, manualId, (a, e) => expect(a).not.toBe(e)); currentRequest = selection.requestId;
          }
          return selection;
        } }, source: source.source, managerEvidenceVersion: 'v2',
      }, receiptReader);
      // Observe the same reader calls before the composed reader converts failures to fixed reasons.
      const observedReaders = { ...administration,
        readSourceMapping: (...args: Parameters<typeof administration.readSourceMapping>) => diagnostics.observe('administration.readSourceMapping', () => administration.readSourceMapping(...args)),
        readAcceptedLeagueSettings: (...args: Parameters<typeof administration.readAcceptedLeagueSettings>) => diagnostics.observe('reader.settings', () => administration.readAcceptedLeagueSettings(...args)),
        readAcceptedCurrentRoster: (...args: Parameters<typeof administration.readAcceptedCurrentRoster>) => diagnostics.observe('reader.players', () => administration.readAcceptedCurrentRoster(...args)),
        readAcceptedTeamManagers: (...args: Parameters<typeof administration.readAcceptedTeamManagers>) => diagnostics.observe('reader.managers', () => administration.readAcceptedTeamManagers(...args)),
        readAcceptedTeamManagerEvidence: (...args: Parameters<NonNullable<typeof administration.readAcceptedTeamManagerEvidence>>) => diagnostics.observe('reader.manager-evidence', () => administration.readAcceptedTeamManagerEvidence!(...args)),
        readSource: (...args: Parameters<typeof administration.readSource>) => diagnostics.observe('reader.directory', () => administration.readSource(...args)),
      };
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
        check('capture-witness', 'journey.capture.count', rows, 1, (a, e) => expect(a).toHaveLength(e)); return rows[0].capture;
      };
      const proveCollection = async (requestId: string, cycle: 1 | 2) => {
        const read = await readPublicSleeperIntake(database, observedReaders, requestId, { managerEvidenceVersion: 'v2' });
        check('intake-readback', 'journey.intake.summary', read, { status: 'available', request: { id: requestId, terminal: true, external_manager_id: JOURNEY_MANAGER,
          seasons: [JOURNEY_SEASON], failure_count: 0 }, rejected: [] }, (a, e) => expect(a).toMatchObject(e));
        if (read.status === 'missing') throw new Error('Missing live intake.');
        check('intake-readback', 'journey.intake.league-order', read.leagues.map(row => row.externalLeagueId), [...JOURNEY_LEAGUES], (a, e) => expect(a).toEqual(e));
        check('intake-readback', 'journey.intake.list-count', read.lists, 1, (a, e) => expect(a).toHaveLength(e));
        const identity = capture(cycle, 'identity', null, 'identity'), list = capture(cycle, 'leagues', null, 'leagues');
        const retainedIdentity = await database.query('SELECT payload,request_started_at,request_completed_at FROM public.public_data_identity_observations WHERE intake_id=$1', [requestId]);
        const retainedList = await database.query('SELECT payload,request_started_at,request_completed_at FROM public.public_data_league_lists WHERE intake_id=$1', [requestId]);
        for (const [stored, original] of [[retainedIdentity, identity], [retainedList, list]] as const) {
          check('discovery-times', 'journey.discovery.row-count', stored, 1, (a, e) => expect(a).toHaveLength(e)); assertLiveJson(stored[0].payload, original.payload, equal, 'directory');
          check('discovery-times', 'journey.discovery.started', exactMatchupClockInstant(stored[0].request_started_at), original.requestStartedAt, (a, e) => expect(a).toBe(e));
          check('discovery-times', 'journey.discovery.completed', exactMatchupClockInstant(stored[0].request_completed_at), original.requestCompletedAt, (a, e) => expect(a).toBe(e));
        }
        const allReceipts: string[] = [], allContents: string[] = [], allObservations: string[] = [];
        for (const leagueId of JOURNEY_LEAGUES) {
          const league = capture(cycle, 'core', leagueId, 'league') as CapturedAdministrationDocument;
          const roster = capture(cycle, 'core', leagueId, 'rosters') as CapturedAdministrationDocument;
          const users = capture(cycle, 'users', leagueId, 'users') as CapturedAdministrationDocument;
          const bootstrap = capture(cycle, 'bootstrap', leagueId, 'league');
          const raw = liveRawOracle(league.payload, roster.payload, users.payload, { leagueId, season: JOURNEY_SEASON });
          check('live-core', 'journey.roster.bound', raw.metadata.totalRosters, 20, (a, e) => expect(a).toBeLessThanOrEqual(e));
          const mapping = await observedReaders.readSourceMapping(leagueId);
          if (!mapping) throw new Error('Missing live mapping.');
          const [canonical] = await database.query('SELECT league.id AS league_id,season.id AS league_season_id,connection.id AS connection_id,' +
            'season.scoring_profile_id,profile.id AS profile_id,profile.rules_hash,profile.rules AS profile_rules,enrollment.active,enrollment.evidence FROM public.league_source_connections connection ' +
            'JOIN public.league_seasons season ON season.id=connection.league_season_id JOIN public.leagues league ON league.id=season.league_id ' +
            'JOIN public.league_administration_enrollments enrollment ON enrollment.league_id=league.id ' +
            'LEFT JOIN public.scoring_profiles profile ON profile.id=season.scoring_profile_id ' +
            "WHERE connection.provider='sleeper' AND connection.external_league_id=$1 AND season.season=$2", [leagueId, JOURNEY_SEASON]);
          check('canonical-identity', 'journey.canonical.fields', canonical, { league_season_id: mapping.leagueSeasonId, connection_id: mapping.connectionId,
            active: false, evidence: 'public-data-intake-v1' }, (a, e) => expect(a).toMatchObject(e));
          // Public registration fixes the season profile from its first bootstrap, including unfamiliar numeric rules.
          // Later official captures can change without rewriting that immutable profile.
          const initialRules = (capture(1, 'bootstrap', leagueId, 'league').payload as { scoring_settings?: Record<string, number> | null }).scoring_settings;
          if (initialRules !== undefined && initialRules !== null && Object.keys(initialRules).length > 0) {
            const initialHash = createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(initialRules)
              .sort(([left], [right]) => left.localeCompare(right))))).digest('hex');
            check('canonical-identity', 'journey.canonical.profile-present', typeof canonical.scoring_profile_id === 'string', true, (a, e) => expect(a).toBe(e));
            check('canonical-identity', 'journey.canonical.profile-uuid', canonical.scoring_profile_id, uuid, (a, e) => expect(a).toMatch(e));
            check('canonical-identity', 'journey.canonical.profile-binding', canonical.profile_id, canonical.scoring_profile_id, (a, e) => expect(a).toBe(e));
            check('canonical-identity', 'journey.canonical.profile-hash', canonical.rules_hash, initialHash, (a, e) => expect(a).toBe(e));
            assertLiveJson(canonical.profile_rules, initialRules, equal, 'settings');
          } else check('canonical-identity', 'journey.canonical.profile-empty', { scoring_profile_id: canonical.scoring_profile_id,
            profile_id: canonical.profile_id, rules_hash: canonical.rules_hash, profile_rules: canonical.profile_rules },
          { scoring_profile_id: null, profile_id: null, rules_hash: null, profile_rules: null }, (a, e) => expect(a).toEqual(e));
          for (const id of [canonical.league_id, canonical.league_season_id, canonical.connection_id]) check('canonical-identity', 'journey.canonical.uuid', id, uuid, (a, e) => expect(a).toMatch(e));
          if (cycle === 1) firstIdentity.set(leagueId, canonical); else check('canonical-identity', 'journey.canonical.stable', canonical, firstIdentity.get(leagueId), (a, e) => expect(a).toEqual(e));
          const settings = await observedReaders.readAcceptedLeagueSettings(mapping);
          const players = await observedReaders.readAcceptedCurrentRoster(mapping);
          const managers = await observedReaders.readAcceptedTeamManagers(mapping);
          const evidence = await observedReaders.readAcceptedTeamManagerEvidence!(mapping);
          const directory = await observedReaders.readSource({ ...mapping.scope, family: 'users', week: null });
          equal('live.availability', [settings.status, players.status, managers.status, evidence.status, directory.status], Array(5).fill('available'));
          if (settings.status !== 'available' || players.status !== 'available' || managers.status !== 'available'
            || evidence.status !== 'available' || directory.status !== 'available') throw new Error('Missing live stored resource.');
          const inputs = [league, roster, users].map(document => {
            const entries = writes.filter(row => row.input.envelope.family === document.family
              && row.input.envelope.scope.externalLeagueId === leagueId
              && row.input.envelope.provenance.acquisition?.work.requestId === requestId);
            check('live-core', 'journey.writer.count', entries, 1, (a, e) => expect(a).toHaveLength(e));
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
          check('team-identities', 'journey.teams.distinct', new Set(players.teams.map(team => team.seasonTeamId)).size, raw.teams.length, (a, e) => expect(a).toBe(e));
          for (const team of raw.teams) {
            const held = players.teams.find(value => value.externalRosterId === team.externalRosterId)!;
            equal('live.players.ids', held.players.map(player => player.sourceEntity.nativeId).sort(), team.players);
            check('team-identities', 'journey.team.uuid', held.seasonTeamId, uuid, (a, e) => expect(a).toMatch(e));
            const key = leagueId + ':' + team.externalRosterId;
            if (cycle === 1) firstNativeTeams.set(key, held.seasonTeamId);
            else if (firstNativeTeams.has(key)) check('team-identities', 'journey.team.stable', held.seasonTeamId, firstNativeTeams.get(key), (a, e) => expect(a).toBe(e));
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
                check('provider-manager-identities', 'journey.manager.uuid', manager.providerManagerId, uuid, (a, e) => expect(a).toMatch(e));
                if (reverseManagers.has(manager.providerManagerId)) check('provider-manager-identities', 'journey.manager.reverse', native, reverseManagers.get(manager.providerManagerId), (a, e) => expect(a).toBe(e));
                else reverseManagers.set(manager.providerManagerId, native);
                equal('live.identity.reference', manager.sourceManager, { provider: 'sleeper', resourceKind: 'manager', nativeNamespace: 'account', nativeId: native });
                if (firstManagers.has(native)) check('provider-manager-identities', 'journey.manager.stable', manager.providerManagerId, firstManagers.get(native), (a, e) => expect(a).toBe(e));
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
          check('live-core', 'journey.candidate.fields', candidate, { stage: 'complete', league_season_id: mapping.leagueSeasonId,
            settings_receipt_id: settings.receipt.id, players_receipt_id: players.receipt.id, managers_receipt_id: managers.receipt.id,
            league_observation_id: settings.receipt.legacyObservationId, roster_observation_id: players.receipt.legacyObservationId,
            users_observation_id: directory.observationId, bootstrap_payload: bootstrap.payload }, (a, e) => expect(a).toMatchObject(e));
          check('live-core', 'journey.bootstrap.started', exactMatchupClockInstant(candidate.bootstrap_started_at), bootstrap.requestStartedAt, (a, e) => expect(a).toBe(e));
          check('live-core', 'journey.bootstrap.completed', exactMatchupClockInstant(candidate.bootstrap_completed_at), bootstrap.requestCompletedAt, (a, e) => expect(a).toBe(e));
          const acceptedWrites = [inputs[0].write.result.leagueSettingsAcceptance, inputs[1].write.result.rosterAcceptance,
            inputs[1].write.result.teamManagerAcceptance, inputs[1].write.result.teamManagerEvidenceAcceptance];
          const readers = [settings, players, managers, evidence];
          equal('live.write', acceptedWrites.map(value => value?.status), Array(4).fill('accepted'));
          const ids = readers.map(reader => reader.receipt.id); check('receipt-identities', 'journey.receipts.distinct', new Set(ids).size, 4, (a, e) => expect(a).toBe(e)); allReceipts.push(...ids);
          if (cycle === 1) firstReceipts.set(leagueId, ids); else check('receipt-identities', 'journey.receipts.fresh', ids.some(id => firstReceipts.get(leagueId)!.includes(id)), false, (a, e) => expect(a).toBe(e));
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
          check('receipt-identities', 'journey.lineage.count', lineage, 4, (a, e) => expect(a).toHaveLength(e)); check('receipt-identities', 'journey.attempts.distinct', new Set(lineage.map(row => row.attempt_id)).size, 4, (a, e) => expect(a).toBe(e));
          for (const [i, reader] of readers.entries()) {
            const original = i === 0 ? league : roster, input = inputs[i === 0 ? 0 : 1];
            equal('live.receipt.provenance', reader.receipt.provenance, input.normalized.envelope.provenance);
            check('receipt-identities', 'journey.receipt.generation', reader.accepted.acceptedGeneration, acceptedWrites[i]!.acceptedGeneration, (a, e) => expect(a).toBe(e));
            check('receipt-identities', 'journey.receipt.legacy', reader.receipt.legacyObservationId, input.write.result.observationId, (a, e) => expect(a).toBe(e));
            allContents.push(reader.accepted.contentId); allObservations.push(reader.receipt.legacyObservationId);
            check('receipt-identities', 'journey.receipt.writer', reader.receipt.id, acceptedWrites[i]!.receiptId, (a, e) => expect(a).toBe(e));
            check('receipt-identities', 'journey.receipt.observation-ids', reader.accepted.observationIds, [reader.receipt.id], (a, e) => expect(a).toEqual(e));
            check('receipt-identities', 'journey.receipt.provenance', reader.receipt.provenance, { acquisition: original.acquisition,
              requestStartedAt: original.requestStartedAt, requestCompletedAt: original.requestCompletedAt, sourceObservedAt: original.requestCompletedAt }, (a, e) => expect(a).toMatchObject(e));
            check('receipt-identities', 'journey.lineage.witness', lineage.find(row => row.id === reader.receipt.id), { attempt_id: reader.receipt.attemptId,
              intake_id: requestId, resource: 'core', source_mapping: mapping, exact_witness: true, server_window: true, provenance: reader.receipt.provenance }, (a, e) => expect(a).toMatchObject(e));
            check('receipt-identities', 'journey.receipt.mapping', reader.accepted.sourceMappingRevisionId, mapping.revisionId, (a, e) => expect(a).toBe(e));
          }
          equal('live.receipt.hash', settings.receipt.rawContentHash, inputs[0].normalized.contentHash);
          for (const reader of [players, managers, evidence]) {
            equal('live.receipt.population', { configurationContentId: reader.receipt.configurationContentId, expectedTeamCount: reader.receipt.expectedTeamCount },
              { configurationContentId: settings.accepted.contentId, expectedTeamCount: raw.metadata.totalRosters });
            check('live-core', 'journey.population.witness', lineage.find(row => row.id === reader.receipt.id)!.population_evidence, { provenance: { acquisition: league.acquisition } }, (a, e) => expect(a).toMatchObject(e));
          }
          const [directoryCapture] = await database.query('SELECT * FROM public.public_data_directory_captures WHERE id=$1 AND intake_id=$2', [candidate.users_capture_id, requestId]);
          check('directory-lineage', 'journey.directory.lineage', directoryCapture, { legacy_observation_id: directory.observationId, source_mapping: mapping }, (a, e) => expect(a).toMatchObject(e));
          allContents.push(String(directoryCapture.content_id)); allObservations.push(String(directoryCapture.legacy_observation_id));
          check('directory-lineage', 'journey.directory.started', exactMatchupClockInstant(directoryCapture.request_started_at), users.requestStartedAt, (a, e) => expect(a).toBe(e));
          check('directory-lineage', 'journey.directory.completed', exactMatchupClockInstant(directoryCapture.request_completed_at), users.requestCompletedAt, (a, e) => expect(a).toBe(e));
          check('directory-lineage', 'journey.directory.observed', exactMatchupClockInstant(directoryCapture.source_observed_at), users.requestCompletedAt, (a, e) => expect(a).toBe(e));
          if (cycle === 1) firstDirectories.set(leagueId, String(directoryCapture.id)); else check('directory-lineage', 'journey.directory.fresh', directoryCapture.id, firstDirectories.get(leagueId), (a, e) => expect(a).not.toBe(e));
          const composed = read.leagues.find(row => row.externalLeagueId === leagueId)!;
          check('intake-readback', 'journey.intake.composed', composed, { collection: 'complete', resources: {
            settings: { status: 'available', receipt: settings.receipt }, heldRoster: { status: 'available', receipt: players.receipt },
            teamManagers: { status: 'available', receipt: managers.receipt }, teamManagerEvidence: { status: 'available', receipt: evidence.receipt },
            directory: { status: 'available', observationId: directory.observationId, acquisition: { id: directoryCapture.id, sourceMapping: mapping } },
          } }, (a, e) => expect(a).toMatchObject(e));
        }
        check('live-core', 'journey.leagues.distinct', new Set([...firstIdentity.values()].map(value => (value as DatabaseRow).league_id)).size, JOURNEY_LEAGUES.length, (a, e) => expect(a).toBe(e));
        check('team-identities', 'journey.teams.all-distinct', new Set(firstNativeTeams.values()).size, firstNativeTeams.size, (a, e) => expect(a).toBe(e));
        const accountRows = await database.query("SELECT id,external_manager_id FROM public.league_source_manager_accounts WHERE provider='sleeper' AND id=ANY($1::uuid[]) ORDER BY external_manager_id", [[...reverseManagers.keys()]]);
        check('provider-manager-identities', 'journey.managers.accounts', accountRows, [...firstManagers].map(([external_manager_id, id]) => ({ id, external_manager_id }))
          .sort((a, b) => a.external_manager_id.localeCompare(b.external_manager_id)), (a, e) => expect(a).toEqual(e));
        const dispatches = await database.query(`SELECT dispatch.resource,dispatch.work,outcome.capture_acquisition,
          outcome.outcome,outcome.capture_acquisition->>'dispatchNonce'=dispatch.capture_nonce::text AS exact_nonce,
          outcome.recorded_at BETWEEN dispatch.admitted_at AND dispatch.admitted_at+interval '30 seconds' AS server_window
          FROM public.public_data_dispatches dispatch LEFT JOIN public.public_data_dispatch_outcomes outcome USING(worker_id,generation)
          WHERE dispatch.intake_id=$1 ORDER BY dispatch.admitted_at`, [requestId]);
        check('dispatch-witness', 'journey.dispatch.count', dispatches, 14, (a, e) => expect(a).toHaveLength(e));
        for (const [i, row] of dispatches.entries()) {
          const step = JOURNEY_STEPS[(cycle - 1) * 14 + i];
          check('dispatch-witness', 'journey.dispatch.flags', row, { resource: step.kind, outcome: 'checkpoint-committed', exact_nonce: true, server_window: true }, (a, e) => expect(a).toMatchObject(e));
          const original = source.captures.find(entry => entry.cycle === cycle && entry.capture.acquisition?.work.kind === step.kind && entry.leagueId === (step.leagueId ?? null))!;
          check('dispatch-witness', 'journey.dispatch.capture', row.capture_acquisition, original.capture.acquisition, (a, e) => expect(a).toEqual(e)); check('dispatch-witness', 'journey.dispatch.work', row.work, original.capture.acquisition!.work, (a, e) => expect(a).toEqual(e));
        }
        if (cycle === 1) {
          for (const table of ['public_data_intakes', 'public_data_identity_observations', 'public_data_league_lists', 'public_data_league_candidates', 'public_data_directory_captures', 'public_data_dispatches']) {
            const sql = `SELECT * FROM public.${table} WHERE ${table === 'public_data_intakes' ? 'id' : 'intake_id'}=$1 ORDER BY to_jsonb(${table})::text`;
            const args = [requestId], rows = await database.query(sql, args); check('stored-resources', 'journey.history.intake-populated', rows.length, 0, (a, e) => expect(a).toBeGreaterThan(e)); history.push({ sql, args, rows });
          }
          for (const [table, predicate] of [
            ['league_roster_capture_receipts', 'id=ANY($1::uuid[])'],
            ['league_roster_resource_attempts', 'id IN (SELECT attempt_id FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[]))'],
            ['league_roster_resource_acceptances', 'receipt_id=ANY($1::uuid[])'],
          ]) {
            const sql = `SELECT * FROM public.${table} WHERE ${predicate} ORDER BY to_jsonb(${table})::text`, args = [allReceipts];
            const rows = await database.query(sql, args); check('stored-resources', 'journey.history.receipt-count', rows, 16, (a, e) => expect(a).toHaveLength(e)); history.push({ sql, args, rows });
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
            check('stored-resources', 'journey.history.content-populated', rows.length, 0, (a, e) => expect(a).toBeGreaterThan(e)); history.push({ sql, args, rows });
          }
          const sql = 'SELECT outcome.* FROM public.public_data_dispatch_outcomes outcome JOIN public.public_data_dispatches dispatch USING(worker_id,generation) WHERE dispatch.intake_id=$1 ORDER BY outcome.worker_id,outcome.generation';
          const args = [requestId], rows = await database.query(sql, args); check('stored-resources', 'journey.history.dispatch-count', rows, 14, (a, e) => expect(a).toHaveLength(e)); history.push({ sql, args, rows });
        } else for (const item of history) check('stored-resources', 'journey.history.unchanged', await database.query(item.sql, item.args), item.rows, (a, e) => expect(a).toEqual(e));
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
        check('step-progress', 'journey.step.progress', outcome, { status: 'progress', resource: selectedStep.kind, providerRequests: selectedStep.kind === 'core' ? 2 : 1 }, (a, e) => expect(a).toMatchObject(e));
        source.finishStep(true); completed++; check('step-progress', 'journey.step.admissions', admissions, completed, (a, e) => expect(a).toBe(e)); check('step-progress', 'journey.step.claims', claims, completed, (a, e) => expect(a).toBe(e));
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
      diagnostics.checkOutcome(settled); check('journey-complete', 'journey.settlement.outcome', settled, { status: 'backoff', providerRequests: 0 }, (a, e) => expect(a).toEqual(e));
      const composed = await diagnostics.observe('reader.refresh', () => readPublicDataRefresh(database, observedReaders, targetId, { managerEvidenceVersion: 'v2' }));
      check('journey-complete', 'journey.refresh.readback', composed, { status: 'available', target: { id: targetId, externalManagerId: JOURNEY_MANAGER,
        cadenceSeconds: JOURNEY_CADENCE_SECONDS }, cycle: { number: 1, requestId: currentRequest, outcome: { disposition: 'complete' } },
        intake: { status: 'available', request: { terminal: true } } }, (a, e) => expect(a).toMatchObject(e));
      check('journey-complete', 'journey.refresh.cycle-count', await database.query('SELECT cycle FROM public.public_data_refresh_cycles WHERE target_id=$1', [targetId]), [{ cycle: 1 }], (a, e) => expect(a).toEqual(e));
      check('journey-complete', 'journey.refresh.disposition', await database.query('SELECT disposition FROM public.public_data_refresh_cycle_outcomes WHERE target_id=$1', [targetId]), [{ disposition: 'complete' }], (a, e) => expect(a).toEqual(e));
      const [spacing] = await database.query(`SELECT count(*)::int AS count,bool_and(gap>=interval '60 seconds') AS bounded FROM (
        SELECT admitted_at-lag(admitted_at) OVER (ORDER BY admitted_at) AS gap FROM public.public_data_dispatches) entries`);
      check('journey-complete', 'journey.settlement.spacing', spacing, { count: 28, bounded: true }, (a, e) => expect(a).toEqual(e)); check('journey-complete', 'journey.settlement.claims', claims, 29, (a, e) => expect(a).toBe(e)); check('journey-complete', 'journey.settlement.admissions', admissions, 28, (a, e) => expect(a).toBe(e));
      check('journey-complete', 'journey.settlement.unfinished', await database.query(`SELECT dispatch.worker_id FROM public.public_data_dispatches dispatch LEFT JOIN public.public_data_dispatch_outcomes outcome
        USING(worker_id,generation) WHERE outcome.worker_id IS NULL`), [], (a, e) => expect(a).toEqual(e));
      source.assertComplete();
      for (const row of source.captures) check('capture-witness', 'journey.capture.unchanged', qualificationDigest(row.capture.payload), row.payloadDigest, (a, e) => expect(a).toBe(e));
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
