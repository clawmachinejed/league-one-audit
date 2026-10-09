import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectionStore } from '../lib/projection-store';
import { createLeagueAdministrationStore } from '../lib/league-administration/store';
import { recordCapturedAdministration } from '../lib/league-administration/runtime';
import { createIndependentDatabase, createReceiptDiagnosticReader, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { createPublicDataDiagnostics } from './public-data-refresh-diagnostics';
import { LIVE_SUITE, LIVE_TEST, qualificationDigest, requireLiveQualification } from './qualification-profile';
import { writeIntegrationArtifact } from './integration-artifacts';
import { assertLiveJson, createLiveCaptures, LIVE_LEAGUE_ID, liveLeagueMetadata, liveRawOracle, normalizeLiveCapture } from './live-league-two';
import type { CapturedAdministrationDocument } from '../lib/league-administration/contracts';

// This guard runs before hooks or provider/DB access, including direct module invocation.
const binding = requireLiveQualification();
describe(LIVE_SUITE, () => {
  let connection: IndependentDatabase | undefined;
  beforeAll(() => { connection = createIndependentDatabase(); });
  afterAll(async () => connection?.close());
  it(LIVE_TEST, async () => {
    const diagnostics = createPublicDataDiagnostics('live');
    const originalFetch = globalThis.fetch;
    const source = createLiveCaptures(originalFetch);
    // The case DB uses the existing Pool/WebSocket clients. All HTTP outside the four captures is forbidden.
    globalThis.fetch = async () => { throw diagnostics.failure('source.core', undefined); };
    const captures: CapturedAdministrationDocument[] = [];
    const equal = (id: Parameters<typeof diagnostics.comparison>[0], actual: unknown, expected: unknown) =>
      diagnostics.assertion('live-core', () => diagnostics.comparison(id, actual, expected, (a, e) => expect(a).toEqual(e)));
    const capture = async (family: 'league' | 'rosters' | 'users') => {
      const value = await diagnostics.observe('source.core', () => source.capture(family)); captures.push(value); return value;
    };
    try {
      const database = connection!.database, administration = createLeagueAdministrationStore(database);
      const [session] = await database.query("SELECT session_user AS role,current_user AS effective_role," +
        "current_setting('server_version') AS server_version,current_setting('server_version_num') AS server_version_num");
      equal('live.roles', { role: session.role, effective_role: session.effective_role }, { role: 'league_one_runtime', effective_role: 'league_one_runtime' });
      diagnostics.recordDatabaseVersion(session);
      const receiptReader = createReceiptDiagnosticReader();
      const bootstrap = await capture('league'), metadata = liveLeagueMetadata(bootstrap.payload);
      const registered = await createProjectionStore(database).registerLeagueSeason({ mode: 'official-data',
        leagueKey: 'sleeper-' + LIVE_LEAGUE_ID, leagueName: metadata.name, sleeperLeagueId: LIVE_LEAGUE_ID, season: metadata.season });
      equal('live.registration', registered.kind, 'stored');
      if (registered.kind !== 'stored') throw new Error('Live canonical registration unavailable.');
      // Setup metadata only. No synthetic accepted receipts, provider observations or public-intake witnesses.
      await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence,active) VALUES($1,'sleeper','live-core-test-setup',false)", [registered.value.leagueId]);
      await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,$2,'sleeper','live-core-test-setup')", [registered.value.leagueId, metadata.season]);
      const mapping = await diagnostics.observe('administration.readSourceMapping', () => administration.readSourceMapping(LIVE_LEAGUE_ID));
      equal('live.mapping', mapping?.scope, { provider: 'sleeper', leagueKey: 'sleeper-' + LIVE_LEAGUE_ID, externalLeagueId: LIVE_LEAGUE_ID, season: metadata.season });
      if (!mapping) throw new Error('Live mapping unavailable.');
      const enrollment = await database.query("SELECT enrollment.active,season.scoring_profile_id FROM public.league_administration_enrollments enrollment JOIN public.league_seasons season ON season.league_id=enrollment.league_id WHERE enrollment.league_id=$1 AND enrollment.provider='sleeper' AND season.season=$2", [registered.value.leagueId, metadata.season]);
      equal('live.enrollment.inactive', enrollment, [{ active: false, scoring_profile_id: null }]);
      const settingsAttempt = await diagnostics.observe('administration.beginLeagueSettingsAttempt', () => administration.beginLeagueSettingsAttempt(mapping, randomUUID()));
      const rosterAttempts = await diagnostics.observe('administration.beginRosterCapture', () => administration.beginRosterCapture(mapping, randomUUID(), randomUUID()));
      const managerAttempt = await diagnostics.observe('administration.beginTeamManagerEvidenceAttempt', () => administration.beginTeamManagerEvidenceAttempt!(mapping, randomUUID()));
      // Genuine legacy operator timestamps; no clock shifting, sleeping or invented R039 witness.
      const league = await capture('league'), rosters = await capture('rosters'), users = await capture('users');
      const raw = liveRawOracle(league.payload, rosters.payload, users.payload);
      equal('live.metadata', { season: raw.metadata.season, totalRosters: raw.metadata.totalRosters }, { season: metadata.season, totalRosters: metadata.totalRosters });
      const checkedAt = new Date().toISOString();
      const normalized = [league, rosters, users].map(document => normalizeLiveCapture(mapping.scope, document, checkedAt, raw.metadata.totalRosters));
      equal('live.normalized', normalized.map(value => value.status), ['accepted', 'accepted', 'accepted']);
      const original = [league, rosters, users].map(document => qualificationDigest(document.payload));
      const observedStore = { ...administration, recordObservation: async (...args: Parameters<typeof administration.recordObservation>) => {
        const input = normalized.find(value => value.envelope.family === args[0].envelope.family)!;
        assertLiveJson(args[0].envelope, input.envelope, equal, args[0].envelope.family === 'users' ? 'directory' : 'population');
        equal('live.writer.input', { contentHash: args[0].contentHash, semanticHash: args[0].semanticHash, status: args[0].status },
          { contentHash: input.contentHash, semanticHash: input.semanticHash, status: input.status });
        const result = await diagnostics.observe('administration.recordObservation', () => administration.recordObservation(...args));
        diagnostics.queueReceipts(receiptReader, args, result);
        return result;
      } };
      const written = await diagnostics.observe('administration.recordObservation', () => recordCapturedAdministration(mapping.scope, [league, rosters, users], {
        store: observedStore, mapping, leagueSettingsAttempt: settingsAttempt, rosterAttempt: rosterAttempts.players,
        managerAttempt: rosterAttempts.managers, managerEvidenceVersion: 'v2', managerEvidenceAttempt: managerAttempt,
        expectedRosterCount: raw.metadata.totalRosters, now: () => new Date(checkedAt), signal: AbortSignal.timeout(30_000),
        verify: async () => { throw new Error('Live unexpected verification request.'); },
      }));
      // Official-only registration keeps the calculation profile NULL. Typed official resources still must accept.
      equal('live.write', { status: written.status, source: written.results.map(({ family, result }) => ({ family,
        status: result.status, reason: result.reason ?? null })), settings: written.results[0]?.result.leagueSettingsAcceptance?.status,
        players: written.results[1]?.result.rosterAcceptance?.status, managers: written.results[1]?.result.teamManagerAcceptance?.status,
        managersV2: written.results[1]?.result.teamManagerEvidenceAcceptance?.status },
      { status: 'unavailable', source: [
        { family: 'league', status: 'rejected', reason: 'scoring_profile_change_requires_explicit_compatibility_and_period_review' },
        { family: 'rosters', status: 'changed', reason: null }, { family: 'users', status: 'changed', reason: null },
      ], settings: 'accepted', players: 'accepted', managers: 'accepted', managersV2: 'accepted' });
      const settings = await diagnostics.observe('reader.settings', () => administration.readAcceptedLeagueSettings(mapping));
      const players = await diagnostics.observe('reader.players', () => administration.readAcceptedCurrentRoster(mapping));
      const managers = await diagnostics.observe('reader.managers', () => administration.readAcceptedTeamManagers(mapping));
      const evidence = await diagnostics.observe('reader.manager-evidence', () => administration.readAcceptedTeamManagerEvidence!(mapping));
      const directory = await administration.readSource({ ...mapping.scope, family: 'users', week: null });
      equal('live.availability', [settings.status, players.status, managers.status, evidence.status, directory.status], Array(5).fill('available'));
      if (settings.status !== 'available' || players.status !== 'available' || managers.status !== 'available' || evidence.status !== 'available' || directory.status !== 'available') throw new Error('Live mandatory reader unavailable.');
      equal('live.settings.identity', { nativeId: settings.value.sourceLeague.nativeId, season: settings.value.season, count: settings.value.teamCount.value },
        { nativeId: LIVE_LEAGUE_ID, season: raw.metadata.season, count: raw.metadata.totalRosters });
      const storedRules = settings.value.scoring.rules.value;
      assertLiveJson(storedRules, raw.rules, equal, 'settings');
      equal('live.settings.scoring-keys', storedRules && Object.keys(storedRules).sort(), Object.keys(raw.rules).sort());
      for (const key of Object.keys(raw.rules).sort()) equal('live.settings.scoring-value', { nativeCode: key, value: (storedRules as Record<string, unknown>)?.[key] }, { nativeCode: key, value: raw.rules[key] });
      equal('live.settings.slots', settings.value.slots.value, raw.slots.map((nativeCode, ordinal) => ({ nativeCode, count: 1, ordinal, semantics: 'ordered-occurrence' })));
      assertLiveJson(settings.value, normalized[0].leagueSettings?.value, equal, 'settings');
      equal('live.settings.canonical', settings.value, normalized[0].leagueSettings?.value);
      const rosterIds = raw.teams.map(team => team.externalRosterId).sort();
      equal('live.players.roster-ids', players.teams.map(team => team.externalRosterId).sort(), rosterIds);
      equal('live.managers.roster-ids', managers.teams.map(team => team.sourceTeam.nativeId).sort(), rosterIds);
      equal('live.managers.roster-ids', evidence.teams.map(team => team.sourceTeam.nativeId).sort(), rosterIds);
      equal('live.identity.distinct-teams', new Set(players.teams.map(team => team.seasonTeamId)).size, raw.teams.length);
      const managerIdentities = new Map<string, string>();
      const managerNativeIds = new Map<string, string>();
      for (const team of raw.teams) {
        const held = players.teams.find(value => value.externalRosterId === team.externalRosterId);
        equal('live.players.ids', { externalRosterId: team.externalRosterId, players: held?.players.map(player => player.sourceEntity.nativeId).sort() },
          { externalRosterId: team.externalRosterId, players: team.players });
        for (const player of held?.players ?? []) equal('live.identity.reference', player.sourceEntity,
          { provider: 'sleeper', resourceKind: 'scoring-entity', nativeNamespace: 'nfl', nativeId: player.sourceEntity.nativeId });
        for (const reader of [managers, evidence]) {
          const stored = reader.teams.find(value => value.sourceTeam.nativeId === team.externalRosterId);
          equal('live.managers.primary', { externalRosterId: team.externalRosterId, state: stored?.primaryOwner.state,
            nativeId: stored?.primaryOwner.manager?.sourceManager.nativeId ?? null },
          { externalRosterId: team.externalRosterId, state: team.owner === null ? 'unowned' : 'owned', nativeId: team.owner });
          equal('live.managers.coowners', { externalRosterId: team.externalRosterId, state: stored?.coManagers.state,
            ids: stored?.coManagers.managers?.map(manager => manager.sourceManager.nativeId).sort() ?? null,
            ...((stored?.coManagers.state === 'unknown') ? { reason: stored.coManagers.reason } : {}) },
          { externalRosterId: team.externalRosterId, ...team.coOwners });
          equal('live.receipt.mapping', stored?.seasonTeamId, held?.seasonTeamId);
          equal('live.identity.reference', stored?.sourceTeam, { provider: 'sleeper', resourceKind: 'team',
            nativeNamespace: JSON.stringify(['nfl', metadata.season, LIVE_LEAGUE_ID]), nativeId: team.externalRosterId });
          if (stored) for (const identity of [stored.primaryOwner.manager, ...(stored.coManagers.managers ?? [])]) {
            if (!identity) continue;
            const nativeId = identity.sourceManager.nativeId, canonical = identity.providerManagerId;
            equal('live.identity.reference', identity.sourceManager, { provider: 'sleeper', resourceKind: 'manager', nativeNamespace: 'account', nativeId });
            if (managerIdentities.has(nativeId)) equal('live.identity.manager', canonical, managerIdentities.get(nativeId));
            if (managerNativeIds.has(canonical)) equal('live.identity.manager', nativeId, managerNativeIds.get(canonical));
            managerIdentities.set(nativeId, canonical); managerNativeIds.set(canonical, nativeId);
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
        { teams: [...(normalized[1].teamManagerEvidence?.teams ?? [])].sort((a, b) => a.externalRosterId.localeCompare(b.externalRosterId)), completeness: normalized[1].teamManagerEvidence?.status });
      const storedDirectory = liveRawOracle(league.payload, rosters.payload, directory.envelope.payload).directory;
      equal('live.directory.ids', storedDirectory, raw.directory);
      const writes = [written.results[0].result.leagueSettingsAcceptance!, written.results[1].result.rosterAcceptance!,
        written.results[1].result.teamManagerAcceptance!, written.results[1].result.teamManagerEvidenceAcceptance!];
      const attempts = [settingsAttempt, rosterAttempts.players, rosterAttempts.managers, managerAttempt];
      for (const [index, reader] of [settings, players, managers, evidence].entries()) {
        const input = normalized[index === 0 ? 0 : 1];
        equal('live.receipt.provenance', reader.receipt.provenance, input.envelope.provenance);
        equal('live.receipt.mapping', { revisionId: reader.accepted.sourceMappingRevisionId, id: reader.receipt.id,
          observationIds: reader.accepted.observationIds, acceptedGeneration: reader.accepted.acceptedGeneration,
          attemptId: reader.receipt.attemptId, ordinal: reader.receipt.ordinal, legacyObservationId: reader.receipt.legacyObservationId },
        { revisionId: mapping.revisionId, id: writes[index].receiptId, observationIds: [writes[index].receiptId],
          acceptedGeneration: writes[index].acceptedGeneration, attemptId: attempts[index].id, ordinal: attempts[index].ordinal,
          legacyObservationId: written.results[index === 0 ? 0 : 1].result.observationId });
      }
      for (const reader of [players, managers, evidence]) equal('live.receipt.population', {
        configurationContentId: reader.receipt.configurationContentId, expectedTeamCount: reader.receipt.expectedTeamCount,
        contentId: reader.accepted.contentId }, { configurationContentId: settings.accepted.contentId,
        expectedTeamCount: raw.metadata.totalRosters, contentId: players.accepted.contentId });
      assertLiveJson(written.population?.envelope, normalized[0].envelope, equal, 'population');
      equal('live.receipt.population', written.population, { observationId: written.results[0].result.observationId,
        contentHash: normalized[0].contentHash, envelope: normalized[0].envelope });
      assertLiveJson(directory.envelope, normalized[2].envelope, equal, 'directory');
      equal('live.directory.capture', { envelope: directory.envelope, observationId: directory.observationId },
        { envelope: normalized[2].envelope, observationId: written.results[2].result.observationId });
      equal('live.receipt.hash', settings.receipt.rawContentHash, normalized[0].contentHash);
      equal('live.payload.unchanged', [league, rosters, users].map(document => qualificationDigest(document.payload)), original);
      equal('live.capture-count', source.snapshot().attempts, 4);
    } catch (error) { source.failure(error); throw diagnostics.failure('case', error); }
    finally {
      globalThis.fetch = originalFetch;
      try { await diagnostics.observe('artifact.write', () => writeIntegrationArtifact('live-league-two-captures.json', { kind: 'live-league-two-captures-v1',
        contextDigest: qualificationDigest(binding.context), ...source.snapshot(), captures: captures.map(document => ({ family: document.family,
          requestStartedAt: document.requestStartedAt, requestCompletedAt: document.requestCompletedAt,
          sourceObservedAt: document.sourceObservedAt, contentDigest: qualificationDigest(document.payload) })) })); }
      finally { await diagnostics.save(); }
    }
  }, 180_000);
});
