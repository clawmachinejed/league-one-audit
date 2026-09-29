import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CURRENT_ROSTER_POLICY, currentRosterScope, type RosterPopulationEvidence } from '../lib/aggregator/current-roster';
import type { AdministrationEnvelope, JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import { createProjectionStore } from '../lib/projection-store';
import { compatibleScoringRulesHash } from '../lib/projections/shared/revision-compatibility';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, runtimeQuery,
  type IndependentDatabase } from './neon-integration-harness';

const rules = { rec: 0.5 };
const initialPlayers = [{ roster_id: 1, players: ['player-a'] }, { roster_id: 2, players: ['player-b'] }];
type Fixture = { leagueKey: string; leagueId: string; leagueSeasonId: string; externalLeagueId: string; season: number };
type Store = ReturnType<typeof createLeagueAdministrationMethods>;

/** All queries use the supervisor-verified disposable database and restricted runtime writer. */
describe.sequential('persisted scoped current held-player acceptance', () => {
  let connection: IndependentDatabase;
  let store: Store;
  beforeAll(() => { connection = createIndependentDatabase(); store = createLeagueAdministrationMethods(connection.database); });
  afterAll(async () => connection.close());

  async function databaseNow(): Promise<string> {
    const [row] = await ownerQuery('SELECT clock_timestamp() AS at');
    return (row.at instanceof Date ? row.at : new Date(String(row.at))).toISOString();
  }

  async function fixture(season = 2150, leagueKey = `roster-acceptance-${randomUUID()}`): Promise<Fixture> {
    const externalLeagueId = `source-${randomUUID()}`;
    const result = await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey,
      leagueName: 'Synthetic roster acceptance fixture', season, sleeperLeagueId: externalLeagueId, scoringRules: rules });
    if (result.kind !== 'stored') throw new Error('Isolated integration persistence unexpectedly disabled.');
    const { leagueId, leagueSeasonId } = result.value;
    await ownerQuery(`INSERT INTO league_administration_enrollments(league_id,provider,evidence)
      VALUES($1,'sleeper','synthetic roster acceptance fixture') ON CONFLICT DO NOTHING`, [leagueId]);
    await ownerQuery(`INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence)
      VALUES($1,$2,'sleeper','synthetic roster acceptance fixture')`, [leagueId, season]);
    return { leagueKey, leagueId, leagueSeasonId, externalLeagueId, season };
  }

  async function mapping(f: Fixture, reader = store) {
    const token = await reader.readSourceMapping(f.externalLeagueId);
    if (!token) throw new Error('Missing fixture source mapping.');
    return token;
  }

  async function capture(f: Fixture, payload: JsonValue = initialPlayers,
    options: { family?: 'league' | 'rosters'; origin?: 'network' | 'cache'; completeness?: 'complete' | 'partial';
      expectedRosterCount?: number; at?: string } = {}): Promise<NormalizedAdministrationObservation> {
    // Database time gives synthetic evidence a stable relation to real SQL deadlines,
    // but acceptance ordering itself is asserted using persisted ordinals only.
    const at = options.at ?? await databaseNow();
    const origin = options.origin ?? 'network';
    const envelope: AdministrationEnvelope = { schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
      scope: { leagueKey: f.leagueKey, provider: 'sleeper', externalLeagueId: f.externalLeagueId, season: f.season },
      family: options.family ?? 'rosters', week: null, completeness: options.completeness ?? 'complete', payload,
      provenance: { origin, requestStartedAt: at, requestCompletedAt: at,
        sourceObservedAt: origin === 'network' ? at : null, checkedAt: at } };
    return normalizeAdministrationObservation(envelope, { expectedRosterCount: options.expectedRosterCount });
  }

  async function population(f: Fixture, totalRosters: number | null = 2,
    extra: Record<string, JsonValue> = {}): Promise<RosterPopulationEvidence> {
    const input = await capture(f, { league_id: f.externalLeagueId, season: String(f.season), sport: 'nfl',
      scoring_settings: rules, roster_positions: ['QB', 'BN'], total_rosters: totalRosters, ...extra }, { family: 'league' });
    expect(input.status).toBe('accepted');
    // Legacy league writes intentionally omit roster-only sourceMapping metadata.
    const result = await store.recordObservation(input);
    expect(['changed', 'unchanged']).toContain(result.status);
    if (!result.observationId) throw new Error('Population observation was not retained.');
    return { observationId: result.observationId, contentHash: input.contentHash, envelope: input.envelope };
  }

  async function accepted(token: AdministrationSourceMapping, reader = store) {
    const result = await reader.readAcceptedCurrentRoster(token);
    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error(`Missing accepted fixture: ${result.status}`);
    return result;
  }

  async function seed(fixtureInput?: Fixture) {
    const f = fixtureInput ?? await fixture();
    const token = await mapping(f);
    const proof = await population(f);
    const attempt = await store.beginRosterAttempt(token, randomUUID());
    const input = await capture(f);
    const result = await store.recordObservation(input, undefined, token, { attempt, population: proof });
    expect(result.rosterAcceptance).toMatchObject({ status: 'accepted', acceptedGeneration: 1 });
    return { f, token, proof, attempt, input, result, read: await accepted(token) };
  }

  async function state(f: Fixture) {
    return ownerQuery(`SELECT
      (SELECT row_to_json(head) FROM league_administration_heads head
        WHERE league_season_id=$1 AND family='rosters' AND week=0) AS legacy_head,
      (SELECT jsonb_agg(to_jsonb(head) ORDER BY head.scope_id) FROM league_roster_resource_heads head
        JOIN league_roster_resource_scopes scope ON scope.id=head.scope_id WHERE scope.league_season_id=$1) AS heads,
      (SELECT count(*)::integer FROM league_administration_contents WHERE league_season_id=$1) AS contents,
      (SELECT count(*)::integer FROM league_administration_observations WHERE league_season_id=$1) AS observations,
      (SELECT count(*)::integer FROM league_roster_capture_receipts receipt JOIN league_roster_resource_attempts attempt
        ON attempt.id=receipt.attempt_id JOIN league_roster_resource_scopes scope ON scope.id=attempt.scope_id
        WHERE scope.league_season_id=$1) AS receipts,
      (SELECT count(*)::integer FROM league_roster_resource_acceptances accepted JOIN league_roster_resource_scopes scope
        ON scope.id=accepted.scope_id WHERE scope.league_season_id=$1) AS acceptances`, [f.leagueSeasonId]);
  }

  async function revise(f: Fixture, token: AdministrationSourceMapping, target: string, evidence: string) {
    await ownerQuery(`SELECT public.revise_league_source_connection($1,'sleeper',$2,$3,$4)`,
      [f.leagueSeasonId, token.revisionId, target, evidence]);
  }

  it('publishes immutable full players coverage and reads exact content with existing season-team UUIDs', async () => {
    const f = await fixture(); const token = await mapping(f);
    expect(await store.readAcceptedCurrentRoster(token)).toEqual({ status: 'missing' });
    const seeded = await seed(f); const read = seeded.read;
    expect(read.accepted).toMatchObject({ scope: currentRosterScope(token),
      canonicalNormalizerVersion: CURRENT_ROSTER_POLICY.canonicalNormalizerVersion,
      validationVersion: CURRENT_ROSTER_POLICY.validationVersion, sourceMappingRevisionId: token.revisionId,
      acceptedGeneration: 1, observationIds: [read.receipt.id], verifiedAt: seeded.input.envelope.provenance.sourceObservedAt,
      effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' });
    expect(read.receipt).toMatchObject({ attemptId: seeded.attempt.id, ordinal: 1, expectedTeamCount: 2,
      legacyObservationId: seeded.result.observationId, provenance: seeded.input.envelope.provenance });
    expect(read.teams.map(team => [team.externalRosterId, team.players.map(player => player.sourceEntity.nativeId)]))
      .toEqual([['1', ['player-a']], ['2', ['player-b']]]);
    for (const team of read.teams) {
      expect(team.players[0]).toMatchObject({ seasonTeamId: team.seasonTeamId, section: 'roster', nativeSection: 'players',
        identityState: 'unresolved', canonicalEntityId: null, effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' });
    }
    expect(await ownerQuery(`SELECT id,external_roster_id FROM league_season_teams WHERE league_season_id=$1
      ORDER BY external_roster_id`, [f.leagueSeasonId]))
      .toEqual(read.teams.map(team => ({ id: team.seasonTeamId, external_roster_id: team.externalRosterId })));
    expect(await ownerQuery(`SELECT content_id,configuration_content_id,coverage,population_evidence
      FROM league_roster_capture_receipts WHERE id=$1`, [read.receipt.id])).toEqual([{
      content_id: read.accepted.contentId, configuration_content_id: read.receipt.configurationContentId,
      coverage: { periodIds: [], interval: null, entitySet: 'full', fields: ['players'], pagination: 'complete',
        nextCursor: null, completeness: 'complete', reasons: [] }, population_evidence: {
        observationId: seeded.proof.observationId, contentHash: seeded.proof.contentHash, provenance: seeded.proof.envelope.provenance },
    }]);
    expect(await store.readSource({ ...token.scope, family: 'rosters', week: null }))
      .toMatchObject({ status: 'available', commonRoster: { kind: 'legacy-retained-roster' } });
  });

  it('reads only the accepted receipt team inventory while preserving historical identities and old-caller writes', async () => {
    const { f, token, proof, read: original } = await seed();
    const attempt = await store.beginRosterAttempt(token, randomUUID());
    const input = await capture(f, [{ roster_id: 1, players: ['replacement-a'] }, { roster_id: 3, players: [] }]);
    const result = await store.recordObservation(input, undefined, token, { attempt, population: proof });
    expect(result.rosterAcceptance?.status).toBe('accepted');
    const current = await accepted(token);
    expect(current.teams.map(team => team.externalRosterId)).toEqual(['1', '3']);
    expect(current.teams[0].seasonTeamId).toBe(original.teams[0].seasonTeamId);
    expect(current.teams[1].players).toEqual([]);
    expect(await ownerQuery(`SELECT id FROM league_season_teams WHERE league_season_id=$1 AND external_roster_id='2'`,
      [f.leagueSeasonId])).toEqual([{ id: original.teams[1].seasonTeamId }]);
    const legacy = await store.recordObservation(await capture(f, [{ roster_id: 1, players: ['rollback-player'] },
      { roster_id: 2, players: ['rollback-second-team'] }]));
    expect(legacy.status).toBe('changed'); expect(legacy.rosterAcceptance).toBeUndefined();
    expect(await store.readSource({ ...token.scope, family: 'rosters', week: null }))
      .toMatchObject({ status: 'available', observationId: legacy.observationId });
    expect(await accepted(token)).toEqual(current);
    expect(await ownerQuery(`SELECT count(*)::integer AS count FROM league_roster_resource_acceptances WHERE scope_id=$1`,
      [attempt.scopeId])).toEqual([{ count: 2 }]);
  });

  it.each(['older-first', 'newer-first'] as const)('only publishes the latest reserved overlapping attempt (%s completion)', async order => {
    const { f, token, proof } = await seed();
    const older = await store.beginRosterAttempt(token, randomUUID());
    const olderInput = await capture(f, [{ roster_id: 1, players: ['older'] }, { roster_id: 2, players: [] }]);
    const other = createIndependentDatabase();
    try {
      const otherStore = createLeagueAdministrationMethods(other.database);
      const newer = await otherStore.beginRosterAttempt(token, randomUUID());
      const newerInput = await capture(f, [{ roster_id: 1, players: ['newer'] }, { roster_id: 2, players: [] }]);
      expect(newer).toMatchObject({ scopeId: older.scopeId, ordinal: older.ordinal + 1, expectedGeneration: older.expectedGeneration });
      const finishOlder = () => store.recordObservation(olderInput, undefined, token, { attempt: older, population: proof });
      const finishNewer = () => otherStore.recordObservation(newerInput, undefined, token, { attempt: newer, population: proof });
      const first = await (order === 'older-first' ? finishOlder() : finishNewer());
      const second = await (order === 'older-first' ? finishNewer() : finishOlder());
      const olderResult = order === 'older-first' ? first : second;
      const newerResult = order === 'older-first' ? second : first;
      expect(olderResult.rosterAcceptance).toMatchObject({ status: 'preserved', reason: 'newer_network_attempt_reserved' });
      expect(newerResult.rosterAcceptance).toMatchObject({ status: 'accepted', acceptedGeneration: 2 });
      const read = await accepted(token);
      expect(read.receipt.attemptId).toBe(newer.id);
      expect(read.teams[0].players[0].sourceEntity.nativeId).toBe('newer');
      expect(await ownerQuery(`SELECT count(*)::integer AS count FROM league_roster_resource_acceptances WHERE scope_id=$1`,
        [newer.scopeId])).toEqual([{ count: 2 }]);
    } finally { await other.close(); }
  });

  it('accepts the latest reservation even when its earlier capture time makes v1 classify it stale', async () => {
    const { f, token, proof } = await seed();
    const older = await store.beginRosterAttempt(token, randomUUID());
    const newer = await store.beginRosterAttempt(token, randomUUID());
    const newerInput = await capture(f, [{ roster_id: 1, players: ['reservation-winner'] }, { roster_id: 2, players: [] }]);
    // The first reserved acquisition stalls before fetching, then observes the provider later.
    // Completion/source timestamps are not the shadow policy's ordering mechanism.
    const olderInput = await capture(f, [{ roster_id: 1, players: ['v1-only-winner'] }, { roster_id: 2, players: [] }]);
    expect(Date.parse(olderInput.envelope.provenance.sourceObservedAt!))
      .toBeGreaterThan(Date.parse(newerInput.envelope.provenance.sourceObservedAt!));
    expect(await store.recordObservation(olderInput, undefined, token, { attempt: older, population: proof }))
      .toMatchObject({ status: 'changed', rosterAcceptance: { status: 'preserved', reason: 'newer_network_attempt_reserved' } });
    expect(await store.recordObservation(newerInput, undefined, token, { attempt: newer, population: proof }))
      .toMatchObject({ status: 'stale', rosterAcceptance: { status: 'accepted', acceptedGeneration: 2 } });
    const read = await accepted(token);
    expect(read.receipt).toMatchObject({ attemptId: newer.id, provenance: newerInput.envelope.provenance });
    expect(read.teams[0].players[0].sourceEntity.nativeId).toBe('reservation-winner');
    expect(await store.readSource({ ...token.scope, family: 'rosters', week: null }))
      .toMatchObject({ status: 'available', envelope: { payload: olderInput.envelope.payload } });
  });

  it('keeps the previous accepted inventory after a newer failed acquisition and recovers after process restart', async () => {
    const { f, token, proof, read: previous } = await seed();
    const older = await store.beginRosterAttempt(token, randomUUID());
    const input = await capture(f, [{ roster_id: 1, players: ['obsolete-in-flight'] }, { roster_id: 2, players: [] }]);
    const crashedConnection = createIndependentDatabase();
    const crashedStore = createLeagueAdministrationMethods(crashedConnection.database);
    const crashed = await crashedStore.beginRosterAttempt(token, randomUUID());
    await crashedConnection.close(); // No receipt: network failed or the collector died after reserving.
    expect((await store.recordObservation(input, undefined, token, { attempt: older, population: proof })).rosterAcceptance)
      .toMatchObject({ status: 'preserved', reason: 'newer_network_attempt_reserved' });
    expect(await accepted(token)).toEqual(previous);
    const restartedConnection = createIndependentDatabase();
    try {
      const restarted = createLeagueAdministrationMethods(restartedConnection.database);
      expect(await restarted.beginRosterAttempt(token, crashed.id)).toEqual(crashed);
      expect(await restarted.beginRosterAttempt(token, older.id)).toEqual(older);
      expect(await accepted(token, restarted)).toEqual(previous);
      const recovery = await restarted.beginRosterAttempt(token, randomUUID());
      expect(recovery.ordinal).toBe(crashed.ordinal + 1);
      const recoveredInput = await capture(f, [{ roster_id: 1, players: ['recovered'] }, { roster_id: 2, players: [] }]);
      expect((await restarted.recordObservation(recoveredInput, undefined, token, { attempt: recovery, population: proof })).rosterAcceptance)
        .toMatchObject({ status: 'accepted', acceptedGeneration: 2 });
      expect((await accepted(token)).receipt.attemptId).toBe(recovery.id);
      expect(await ownerQuery(`SELECT id FROM league_roster_capture_receipts WHERE attempt_id=$1`, [crashed.id])).toEqual([]);
    } finally { await restartedConnection.close(); }
  });

  it('does not revive an older in-flight capture when the newest completed capture has unknown players', async () => {
    const { f, token, proof, read: previous } = await seed();
    const older = await store.beginRosterAttempt(token, randomUUID());
    const valid = await capture(f, [{ roster_id: 1, players: ['older-valid'] }, { roster_id: 2, players: [] }]);
    const newer = await store.beginRosterAttempt(token, randomUUID());
    const invalid = await capture(f, [{ roster_id: 1, players: ['newer-unknown'] }, { roster_id: 2, players: null }]);
    expect((await store.recordObservation(invalid, undefined, token, { attempt: newer, population: proof })).rosterAcceptance)
      .toMatchObject({ status: 'preserved', reason: 'complete_players_population_unproved' });
    expect((await store.recordObservation(valid, undefined, token, { attempt: older, population: proof })).rosterAcceptance)
      .toMatchObject({ status: 'preserved', reason: 'newer_network_attempt_reserved' });
    expect(await accepted(token)).toEqual(previous);
  });

  it('retains a new exact receipt for deduplicated content without rewriting old observation timestamps', async () => {
    const { f, token, proof, input: originalInput, attempt: originalAttempt, result: original, read: originalRead } = await seed();
    const originalObservation = await ownerQuery(`SELECT * FROM league_administration_observations WHERE id=$1`, [original.observationId]);
    const attempt = await store.beginRosterAttempt(token, randomUUID());
    const input = await capture(f);
    expect(input.envelope.provenance).not.toEqual(originalInput.envelope.provenance);
    const result = await store.recordObservation(input, undefined, token, { attempt, population: proof });
    expect(result).toMatchObject({ status: 'unchanged', observationId: original.observationId,
      rosterAcceptance: { status: 'accepted', acceptedGeneration: 2 } });
    const read = await accepted(token);
    expect(read.accepted.contentId).toBe(originalRead.accepted.contentId);
    expect(read.receipt.id).not.toBe(originalRead.receipt.id);
    expect(read.receipt.provenance).toEqual(input.envelope.provenance);
    expect(read.accepted.verifiedAt).toBe(input.envelope.provenance.sourceObservedAt);
    expect(await ownerQuery(`SELECT * FROM league_administration_observations WHERE id=$1`, [original.observationId])).toEqual(originalObservation);
    const before = await state(f);
    const retry = await store.recordObservation(input, undefined, token, { attempt, population: proof });
    expect(retry.rosterAcceptance).toMatchObject({ status: 'accepted', reason: 'exact_receipt_replay',
      receiptId: read.receipt.id, acceptedGeneration: 2 });
    expect(await state(f)).toEqual(before);
    const staleReplay = await store.recordObservation(originalInput, undefined, token, { attempt: originalAttempt, population: proof });
    expect(staleReplay.rosterAcceptance).toMatchObject({ status: 'preserved', receiptId: originalRead.receipt.id, acceptedGeneration: 2 });
    expect(await accepted(token)).toEqual(read);
    const changedEvidence = await capture(f, [{ roster_id: 1, players: ['retry-conflict'] }, { roster_id: 2, players: [] }]);
    const beforeConflict = await state(f);
    await expect(store.recordObservation(changedEvidence, undefined, token, { attempt, population: proof }))
      .rejects.toThrow(/receipt conflict/);
    expect(await state(f)).toEqual(beforeConflict);
  });

  it('keeps cache checks outside attempt ordering and preserves the original changed-cache verification trigger', async () => {
    const { f, token, proof } = await seed();
    const attempt = await store.beginRosterAttempt(token, randomUUID());
    const input = await capture(f, [{ roster_id: 1, players: ['qualified-network'] }, { roster_id: 2, players: [] }]);
    const cached = await store.recordObservation(await capture(f, [{ roster_id: 1, players: ['unverified-cache'] },
      { roster_id: 2, players: [] }], { origin: 'cache' }), undefined, token);
    expect(cached).toMatchObject({ status: 'stale', reason: 'unproven_cache_change' });
    expect(cached.rosterAcceptance).toBeUndefined();
    expect(await ownerQuery(`SELECT latest_ordinal FROM league_roster_resource_heads WHERE scope_id=$1`, [attempt.scopeId]))
      .toEqual([{ latest_ordinal: String(attempt.ordinal) }]);
    expect((await store.recordObservation(input, undefined, token, { attempt, population: proof })).rosterAcceptance?.status).toBe('accepted');
    const next = await store.beginRosterAttempt(token, randomUUID());
    const before = await state(f);
    await expect(store.recordObservation(await capture(f, initialPlayers, { origin: 'cache' }), undefined, token,
      { attempt: next, population: proof })).rejects.toThrow(/network capture/);
    expect(await state(f)).toEqual(before);
    expect((await store.recordObservation(await capture(f), undefined, token, { attempt: next, population: proof })).rosterAcceptance?.status)
      .toBe('accepted');
  });

  it.each([
    { label: 'null players', payload: [{ roster_id: 1, players: ['new'] }, { roster_id: 2, players: null }], completeness: 'complete' },
    { label: 'missing players', payload: [{ roster_id: 1, players: ['new'] }, { roster_id: 2 }], completeness: 'complete' },
    { label: 'complete-looking subset', payload: [{ roster_id: 1, players: ['new'] }], completeness: 'complete' },
    { label: 'empty collection', payload: [], completeness: 'complete' },
    { label: 'partial collection', payload: [{ roster_id: 1, players: ['new'] }, { roster_id: 2, players: [] }], completeness: 'partial' },
    { label: 'duplicate roster identities', payload: [{ roster_id: 1, players: ['new'] }, { roster_id: 1, players: [] }], completeness: 'complete' },
    { label: 'invalid player identifier', payload: [{ roster_id: 1, players: [false] }, { roster_id: 2, players: [] }], completeness: 'complete' },
  ] as const)('preserves the two-team accepted roster for $label', async example => {
    const { f, token, proof, read: previous } = await seed();
    const attempt = await store.beginRosterAttempt(token, randomUUID());
    // Deliberately omit expectedRosterCount: structural normalization alone cannot prove population.
    const input = await capture(f, example.payload, { completeness: example.completeness });
    const result = await store.recordObservation(input, undefined, token, { attempt, population: proof });
    expect(result.rosterAcceptance).toMatchObject({ status: 'preserved', reason: 'complete_players_population_unproved', acceptedGeneration: 1 });
    expect(await accepted(token)).toEqual(previous);
    expect(await ownerQuery(`SELECT coverage->>'completeness' AS completeness FROM league_roster_capture_receipts WHERE attempt_id=$1`,
      [attempt.id])).toEqual([{ completeness: 'unknown' }]);
  });

  it('accepts explicit empty players without requiring reserve, taxi, owners, or lineup coverage', async () => {
    const { f, token, proof, read: previous } = await seed();
    const attempt = await store.beginRosterAttempt(token, randomUUID());
    const input = await capture(f, [{ roster_id: 1, players: [] }, { roster_id: 2, players: [] }]);
    expect((await store.recordObservation(input, undefined, token, { attempt, population: proof })).rosterAcceptance?.status).toBe('accepted');
    const read = await accepted(token);
    expect(read.teams.map(team => team.players)).toEqual([[], []]);
    expect(read.teams.map(team => team.seasonTeamId)).toEqual(previous.teams.map(team => team.seasonTeamId));
    expect(read.accepted.acceptedGeneration).toBe(2);
  });

  it.each([{ label: 'empty', payload: [] }, { label: 'subset', payload: [{ roster_id: 1, players: [] }] }])(
    'never infers full population from a v1 accepted $label array without count evidence', async ({ payload }) => {
      const f = await fixture(); const token = await mapping(f);
      const legacyInput = await capture(f, payload);
      expect(legacyInput.status).toBe('accepted');
      expect((await store.recordObservation(legacyInput, undefined, token)).status).toBe('changed');
      const attempt = await store.beginRosterAttempt(token, randomUUID());
      const input = await capture(f, payload);
      expect((await store.recordObservation(input, undefined, token, { attempt })).rosterAcceptance)
        .toMatchObject({ status: 'preserved', reason: 'complete_players_population_unproved', acceptedGeneration: 0 });
      expect(await store.readAcceptedCurrentRoster(token)).toEqual({ status: 'missing' });
    });

  it('keeps a complete-looking roster unqualified when the retained league configuration has no team count', async () => {
    const f = await fixture(); const token = await mapping(f); const proof = await population(f, null);
    const attempt = await store.beginRosterAttempt(token, randomUUID());
    expect((await store.recordObservation(await capture(f), undefined, token, { attempt, population: proof })).rosterAcceptance)
      .toMatchObject({ status: 'preserved', acceptedGeneration: 0 });
    expect(await store.readAcceptedCurrentRoster(token)).toEqual({ status: 'missing' });
  });

  it('requires exact retained count content and cannot promote rejected scoring configuration', async () => {
    const { f, token, read: previous } = await seed();
    const rejectedConfig = await capture(f, { league_id: f.externalLeagueId, season: String(f.season), sport: 'nfl',
      total_rosters: 1, scoring_settings: { rec: 1 }, roster_positions: ['QB', 'BN'] }, { family: 'league' });
    expect(rejectedConfig.status).toBe('accepted');
    const rejected = await store.recordObservation(rejectedConfig);
    expect(rejected.status).toBe('rejected');
    if (!rejected.observationId) throw new Error('Rejected configuration evidence was not retained.');
    const attempt = await store.beginRosterAttempt(token, randomUUID());
    const input = await capture(f, [{ roster_id: 1, players: [] }], { expectedRosterCount: 1 });
    expect(input.status).toBe('accepted');
    expect((await store.recordObservation(input, undefined, token, { attempt, population: {
      observationId: rejected.observationId, contentHash: rejectedConfig.contentHash, envelope: rejectedConfig.envelope } })).rosterAcceptance?.status)
      .toBe('preserved');
    expect(await accepted(token)).toEqual(previous);
  });

  it('does not use structurally valid but unpersisted or foreign league count documents', async () => {
    const { f, token, proof, read: previous } = await seed();
    const unpersisted = await capture(f, { league_id: f.externalLeagueId, season: String(f.season), sport: 'nfl',
      total_rosters: 1, scoring_settings: rules, roster_positions: ['QB', 'BN'] }, { family: 'league' });
    const attempt = await store.beginRosterAttempt(token, randomUUID());
    const input = await capture(f, [{ roster_id: 1, players: [] }]);
    expect((await store.recordObservation(input, undefined, token, { attempt, population: {
      observationId: randomUUID(), contentHash: unpersisted.contentHash, envelope: unpersisted.envelope } })).rosterAcceptance?.status).toBe('preserved');
    expect(await accepted(token)).toEqual(previous);
    const foreign = await fixture(); const foreignProof = await population(foreign);
    const next = await store.beginRosterAttempt(token, randomUUID());
    const before = await state(f);
    await expect(store.recordObservation(await capture(f), undefined, token, { attempt: next, population: foreignProof }))
      .rejects.toThrow(/population evidence/);
    expect(await state(f)).toEqual(before);
    expect((await store.recordObservation(await capture(f), undefined, token, { attempt: next, population: proof })).rosterAcceptance?.status)
      .toBe('accepted');
  });

  it('rejects missing, null and malformed population network provenance without consuming the reservation', async () => {
    const { f, token, proof, read: previous } = await seed();
    const attempt = await store.beginRosterAttempt(token, randomUUID());
    const input = await capture(f, [{ roster_id: 1, players: ['valid-after-rejection'] }, { roster_id: 2, players: [] }]);
    const provenance = proof.envelope.provenance;
    const invalidProvenances = [null, {}, { ...provenance, origin: 'cache' },
      { ...provenance, requestStartedAt: null }, { ...provenance, requestCompletedAt: null },
      { ...provenance, sourceObservedAt: null }, { ...provenance, checkedAt: null },
      { ...provenance, requestStartedAt: 'not-a-timestamp' },
      { ...provenance, sourceObservedAt: new Date(Date.parse(provenance.checkedAt) + 1000).toISOString() }];
    const before = await state(f);
    for (const invalid of invalidProvenances) {
      // Exercise the SQL boundary directly: these malformed objects cannot satisfy the TS contract.
      await expect(runtimeQuery('SELECT public.record_league_administration_observation($1::jsonb)', [JSON.stringify({
        ...input, sourceMapping: token, rosterAcceptance: { attempt,
          population: { ...proof, envelope: { ...proof.envelope, provenance: invalid } } },
      })])).rejects.toThrow();
      expect(await state(f)).toEqual(before);
    }
    expect(await accepted(token)).toEqual(previous);
    expect((await store.recordObservation(input, undefined, token, { attempt, population: proof })).rosterAcceptance?.status).toBe('accepted');
  });

  it('requires current retained count evidence and can reuse its accepted same-revision receipt for network verification', async () => {
    const { f, token, proof, read: previous } = await seed();
    const changedCount = await population(f, 3);
    const staleCountAttempt = await store.beginRosterAttempt(token, randomUUID());
    expect((await store.recordObservation(await capture(f), undefined, token,
      { attempt: staleCountAttempt, population: proof })).rosterAcceptance?.status).toBe('preserved');
    expect(await accepted(token)).toEqual(previous);
    const fresh = await store.beginRosterAttempt(token, randomUUID());
    const three = [{ roster_id: 1, players: ['one'] }, { roster_id: 2, players: [] }, { roster_id: 3, players: [] }];
    expect((await store.recordObservation(await capture(f, three), undefined, token,
      { attempt: fresh, population: changedCount })).rosterAcceptance?.status).toBe('accepted');
    const verification = await store.beginRosterAttempt(token, randomUUID());
    expect((await store.recordObservation(await capture(f, three), undefined, token, { attempt: verification })).rosterAcceptance?.status)
      .toBe('accepted');
    expect((await accepted(token)).receipt).toMatchObject({ attemptId: verification.id, expectedTeamCount: 3 });
  });

  it('fences stale mappings and attempt pairing through A1 to B2 to A3 without rewriting history', async () => {
    const { f, token: a1, proof, read: previous } = await seed();
    const inflight = await store.beginRosterAttempt(a1, randomUUID());
    const input = await capture(f, [{ roster_id: 1, players: ['old-attempt'] }, { roster_id: 2, players: [] }]);
    const away = { ...f, externalLeagueId: `away-${randomUUID()}` };
    await revise(f, a1, away.externalLeagueId, 'synthetic remap away');
    const b2 = await mapping(away);
    await revise(away, b2, f.externalLeagueId, 'synthetic remap back');
    const a3 = await mapping(f);
    expect(a3).toMatchObject({ connectionId: a1.connectionId, generation: 3 });
    expect(await store.readAcceptedCurrentRoster(a1)).toEqual({ status: 'missing' });
    expect(await store.readAcceptedCurrentRoster(a3)).toEqual({ status: 'missing' });
    const before = await state(f);
    await expect(store.beginRosterAttempt(a1, randomUUID())).rejects.toThrow(/mapping/);
    await expect(store.recordObservation(input, undefined, a1, { attempt: inflight, population: proof })).rejects.toThrow(/mapping/);
    await expect(store.recordObservation(input, undefined, a3, { attempt: inflight, population: proof })).rejects.toThrow(/attempt scope mismatch/);
    expect(await state(f)).toEqual(before);
    const freshProof = await population(f);
    const fresh = await store.beginRosterAttempt(a3, randomUUID());
    expect((await store.recordObservation(await capture(f), undefined, a3, { attempt: fresh, population: freshProof })).rosterAcceptance?.status)
      .toBe('accepted');
    expect((await accepted(a3)).accepted.sourceMappingRevisionId).toBe(a3.revisionId);
    expect(await ownerQuery(`SELECT source_mapping_revision_id FROM league_roster_resource_acceptances WHERE receipt_id=$1`,
      [previous.receipt.id])).toEqual([{ source_mapping_revision_id: a1.revisionId }]);
  });

  it('keeps null entity/period scope unique, rejects noncanonical mapping IDs and prevents attempt identity substitution', async () => {
    const { f, token, proof } = await seed();
    const first = await store.beginRosterAttempt(token, randomUUID());
    const second = await store.beginRosterAttempt(token, randomUUID());
    expect(await store.beginRosterAttempt(token, first.id)).toEqual(first);
    expect(second).toMatchObject({ scopeId: first.scopeId, ordinal: first.ordinal + 1 });
    for (const field of ['connectionId', 'leagueSeasonId', 'revisionId'] as const) {
      const uppercase = { ...token, [field]: token[field].toUpperCase() };
      if (uppercase[field] !== token[field]) {
        await expect(store.beginRosterAttempt(uppercase, randomUUID())).rejects.toThrow(/mapping/);
      }
    }
    expect(await ownerQuery(`SELECT count(*)::integer AS count FROM league_roster_resource_scopes WHERE league_season_id=$1`,
      [f.leagueSeasonId])).toEqual([{ count: 1 }]);
    expect(await ownerQuery(`SELECT latest_ordinal FROM league_roster_resource_heads WHERE scope_id=$1`, [first.scopeId]))
      .toEqual([{ latest_ordinal: String(second.ordinal) }]);
    const other = await fixture(); const foreign = await mapping(other);
    await expect(store.beginRosterAttempt(foreign, first.id)).rejects.toThrow(/attempt identity conflict/);
    const input = await capture(f);
    for (const attempt of [{ ...second, ordinal: second.ordinal + 1 }, { ...second, expectedGeneration: second.expectedGeneration + 1 },
      { ...second, scopeId: randomUUID() }]) {
      const before = await state(f);
      await expect(store.recordObservation(input, undefined, token, { attempt, population: proof })).rejects.toThrow(/attempt scope mismatch/);
      expect(await state(f)).toEqual(before);
    }
    expect((await store.recordObservation(input, undefined, token, { attempt: second, population: proof })).rosterAcceptance?.status).toBe('accepted');
  });

  it('fails closed for every unqualified scope, audience, coverage and version dimension', async () => {
    const f = await fixture(); const token = await mapping(f); const scope = currentRosterScope(token);
    const variants = [
      { scope: { ...scope, family: 'lineup' }, policy: CURRENT_ROSTER_POLICY },
      { scope: { ...scope, entityId: randomUUID() }, policy: CURRENT_ROSTER_POLICY },
      { scope: { ...scope, scoringPeriodId: randomUUID() }, policy: CURRENT_ROSTER_POLICY },
      { scope: { ...scope, audienceId: 'private' }, policy: CURRENT_ROSTER_POLICY },
      { scope: { ...scope, coverageSpecId: 'partial-players' }, policy: CURRENT_ROSTER_POLICY },
      { scope: { ...scope, entityId: undefined }, policy: CURRENT_ROSTER_POLICY },
      { scope: { ...scope, scoringPeriodId: undefined }, policy: CURRENT_ROSTER_POLICY },
      { scope, policy: { ...CURRENT_ROSTER_POLICY, audienceId: 'private' } },
      { scope, policy: { ...CURRENT_ROSTER_POLICY, coverageSpecId: 'players-and-taxi' } },
      { scope, policy: { ...CURRENT_ROSTER_POLICY, canonicalNormalizerVersion: 'unknown-version' } },
      { scope, policy: { ...CURRENT_ROSTER_POLICY, validationVersion: 'caller-selected-policy' } },
      { scope, policy: { ...CURRENT_ROSTER_POLICY, arbitrary: 'extra' } },
    ];
    for (const invalid of variants) {
      await expect(runtimeQuery(`SELECT public.begin_current_roster_attempt($1::jsonb,$2::uuid,$3::jsonb,$4::jsonb)`,
        [JSON.stringify(token), randomUUID(), JSON.stringify(invalid.scope), JSON.stringify(invalid.policy)]))
        .rejects.toThrow(/unqualified current roster scope or policy/);
    }
    expect(await ownerQuery(`SELECT count(*)::integer AS count FROM league_roster_resource_scopes WHERE league_season_id=$1`,
      [f.leagueSeasonId])).toEqual([{ count: 0 }]);
    expect((await store.beginRosterAttempt(token, randomUUID())).ordinal).toBe(1);
  });

  it('isolates leagues and annual seasons even when roster IDs and players are identical', async () => {
    const first = await seed(); const other = await seed();
    const season = first.f.season + 1; const externalLeagueId = `annual-${randomUUID()}`;
    await expect(createProjectionStore(connection.database).registerLeagueSeason({ leagueKey: first.f.leagueKey,
      leagueName: 'Synthetic roster acceptance fixture', season, sleeperLeagueId: externalLeagueId, scoringRules: rules }))
      .rejects.toThrow(/continuity approval/u);
    expect(await ownerQuery('SELECT id FROM league_seasons WHERE league_id=$1 AND season=$2', [first.f.leagueId, season]))
      .toEqual([]);
    // An enrolled league's next season requires the existing evidenced owner path.
    const [annualConnection] = await ownerQuery<{ id: string }>(`SELECT public.connect_league_administration_season(
      $1,$2::smallint,$3,$4,$5,$6::jsonb,'synthetic roster acceptance annual continuity')::text AS id`,
    [first.f.leagueId, season, first.f.externalLeagueId, externalLeagueId, compatibleScoringRulesHash(rules), JSON.stringify(rules)]);
    const annual = await seed({ ...first.f, season, externalLeagueId, leagueSeasonId: annualConnection.id });
    expect(await ownerQuery('SELECT league_id,season FROM league_seasons WHERE id=$1', [annual.f.leagueSeasonId]))
      .toEqual([{ league_id: first.f.leagueId, season }]);
    expect(annual.f.leagueSeasonId).not.toBe(first.f.leagueSeasonId);
    expect(annual.token.scope).toMatchObject({ leagueKey: first.f.leagueKey, season, externalLeagueId });
    expect(new Set([first.attempt.scopeId, other.attempt.scopeId, annual.attempt.scopeId]).size).toBe(3);
    expect(new Set([first.read.teams[0].seasonTeamId, other.read.teams[0].seasonTeamId, annual.read.teams[0].seasonTeamId]).size).toBe(3);
    const before = await state(first.f);
    await expect(store.recordObservation(first.input, undefined, other.token,
      { attempt: first.attempt, population: first.proof })).rejects.toThrow(/scope mismatch/);
    expect(await state(first.f)).toEqual(before);
    for (const seeded of [first, other, annual]) expect(await accepted(seeded.token)).toEqual(seeded.read);
  });

  it.each(['changed', 'equal', 'replay'] as const)('rejects %s completion held behind a real SQL lock until its deadline expires', async mode => {
    const seeded = await seed(); const { f, token, proof } = seeded;
    const owner = await createPinnedIntegrationDatabase('owner');
    const writer = await createPinnedIntegrationDatabase('runtime');
    let completion: Promise<{ error?: unknown }> | undefined;
    try {
      const [ownerPid] = await owner.database.query('SELECT pg_backend_pid() AS pid');
      const [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid');
      const jobKey = `roster-deadline:${randomUUID()}`; const workerId = randomUUID();
      await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
        VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '5 minutes',1)`, [jobKey, workerId]);
      const [clock] = await owner.database.query(`SELECT clock_timestamp()+interval '8 seconds' AS deadline`);
      const deadlineAt = (clock.deadline instanceof Date ? clock.deadline : new Date(String(clock.deadline))).toISOString();
      const fence: AdministrationWriteFence = { jobKey, workerId, generation: 1, deadlineAt };
      const attempt = await store.beginRosterAttempt(token, randomUUID(), CURRENT_ROSTER_POLICY, fence);
      const input = await capture(f, mode === 'equal' ? initialPlayers
        : [{ roster_id: 1, players: [mode === 'replay' ? 'replay-first' : 'deadline-expired'] }, { roster_id: 2, players: [] }]);
      let previous = seeded.read;
      if (mode === 'replay') {
        expect((await store.recordObservation(input, fence, token, { attempt, population: proof })).rosterAcceptance?.status).toBe('accepted');
        previous = await accepted(token);
      }
      await owner.database.query('BEGIN');
      await owner.database.query('SELECT scope_id FROM league_roster_resource_heads WHERE scope_id=$1 FOR UPDATE', [attempt.scopeId]);
      const before = await state(f);
      let settled = false;
      completion = createLeagueAdministrationMethods(writer.database).recordObservation(input, fence, token, { attempt, population: proof })
        .then(() => ({}), error => ({ error })).finally(() => { settled = true; });
      let blocked = false;
      for (let poll = 0; poll < 50; poll++) {
        const [row] = await owner.database.query(`SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS blocked`,
          [ownerPid.pid, writerPid.pid]);
        if (row.blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true); expect(settled).toBe(false);
      // Wait on the database clock while preserving the actual blocking transaction.
      await owner.database.query(`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)`, [deadlineAt]);
      await owner.database.query('COMMIT');
      expect(String((await completion).error)).toMatch(/writer fence.*(?:stale|expired)/);
      expect(await state(f)).toEqual(before);
      expect(await accepted(token)).toEqual(previous);
    } finally {
      await owner.database.query('ROLLBACK').catch(() => undefined);
      await completion;
      await writer.close(); await owner.close();
    }
  });

  it('binds the exact reservation fence and rejects expired or obsolete reservation authority', async () => {
    const { f, token, proof } = await seed();
    const jobKey = `roster-fence:${randomUUID()}`; const workerId = randomUUID();
    const [clock] = await ownerQuery(`SELECT clock_timestamp()+interval '5 minutes' AS deadline`);
    const deadlineAt = (clock.deadline instanceof Date ? clock.deadline : new Date(String(clock.deadline))).toISOString();
    const fence: AdministrationWriteFence = { jobKey, workerId, generation: 2, deadlineAt };
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
      VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '5 minutes',2)`, [jobKey, workerId]);
    const beforeReservation = await state(f);
    for (const invalid of [{ ...fence, generation: 1 }, { ...fence, workerId: randomUUID() },
      { ...fence, deadlineAt: '2020-01-01T00:00:00.000Z' }]) {
      await expect(store.beginRosterAttempt(token, randomUUID(), CURRENT_ROSTER_POLICY, invalid)).rejects.toThrow(/writer fence/);
      expect(await state(f)).toEqual(beforeReservation);
    }
    const attempt = await store.beginRosterAttempt(token, randomUUID(), CURRENT_ROSTER_POLICY, fence);
    const input = await capture(f, [{ roster_id: 1, players: ['bound-worker'] }, { roster_id: 2, players: [] }]);
    const beforeWrite = await state(f);
    await expect(store.beginRosterAttempt(token, attempt.id)).rejects.toThrow(/attempt identity conflict/);
    await expect(store.recordObservation(input, undefined, token, { attempt, population: proof })).rejects.toThrow(/attempt scope mismatch/);
    const replacement = { ...fence, deadlineAt: new Date(new Date(deadlineAt).getTime() - 1000).toISOString() };
    await expect(store.recordObservation(input, replacement, token, { attempt, population: proof })).rejects.toThrow(/attempt scope mismatch/);
    expect(await state(f)).toEqual(beforeWrite);
    expect((await store.recordObservation(input, fence, token, { attempt, population: proof })).rosterAcceptance?.status).toBe('accepted');
  });

  it.each(['source', 'head'] as const)('rejects reservation authority that expires while waiting for the %s lock', async lock => {
    const seeded = await seed(); const { f, token, attempt } = seeded;
    const owner = await createPinnedIntegrationDatabase('owner');
    const writer = await createPinnedIntegrationDatabase('runtime');
    let completion: Promise<{ error?: unknown }> | undefined;
    try {
      const [ownerPid] = await owner.database.query('SELECT pg_backend_pid() AS pid');
      const [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid');
      const jobKey = `roster-reservation-deadline:${randomUUID()}`; const workerId = randomUUID();
      await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
        VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '5 minutes',1)`, [jobKey, workerId]);
      const before = await state(f);
      await owner.database.query('BEGIN');
      if (lock === 'source') {
        await owner.database.query(`SELECT pg_advisory_xact_lock(hashtextextended('league-configuration:'||$1::text,0))`, [f.leagueSeasonId]);
      } else {
        await owner.database.query('SELECT scope_id FROM league_roster_resource_heads WHERE scope_id=$1 FOR UPDATE', [attempt.scopeId]);
      }
      const [clock] = await owner.database.query(`SELECT clock_timestamp()+interval '5 seconds' AS deadline`);
      const deadlineAt = (clock.deadline instanceof Date ? clock.deadline : new Date(String(clock.deadline))).toISOString();
      const fence: AdministrationWriteFence = { jobKey, workerId, generation: 1, deadlineAt };
      const rejectedAttemptId = randomUUID();
      let settled = false;
      completion = createLeagueAdministrationMethods(writer.database)
        .beginRosterAttempt(token, rejectedAttemptId, CURRENT_ROSTER_POLICY, fence)
        .then(() => ({}), error => ({ error })).finally(() => { settled = true; });
      let blocked = false;
      for (let poll = 0; poll < 50; poll++) {
        const [row] = await owner.database.query(`SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS blocked`,
          [ownerPid.pid, writerPid.pid]);
        if (row.blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true); expect(settled).toBe(false);
      await owner.database.query(`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)`, [deadlineAt]);
      await owner.database.query('COMMIT');
      expect(String((await completion).error)).toMatch(/reservation writer fence expired/);
      expect(await ownerQuery('SELECT id FROM league_roster_resource_attempts WHERE id=$1', [rejectedAttemptId])).toEqual([]);
      expect(await state(f)).toEqual(before);
      expect(await accepted(token)).toEqual(seeded.read);
    } finally {
      await owner.database.query('ROLLBACK').catch(() => undefined);
      await completion;
      await writer.close(); await owner.close();
    }
  });

  it('rolls back all v1 effects when acceptance authorization fails after its existing writer runs', async () => {
    const { f, token, proof, attempt } = await seed();
    const before = await state(f);
    const input = await capture(f, [{ roster_id: 1, players: ['must-rollback'] }, { roster_id: 2, players: [] }]);
    await expect(store.recordObservation(input, undefined, token, { attempt: { ...attempt, id: randomUUID() }, population: proof }))
      .rejects.toThrow();
    expect(await state(f)).toEqual(before);
  });

  it('grants only the runtime entry points and readback, retaining immutable evidence guards', async () => {
    const { f, token, attempt, read } = await seed();
    const tables = ['league_roster_resource_scopes', 'league_roster_resource_heads', 'league_roster_resource_attempts',
      'league_roster_capture_receipts', 'league_roster_resource_acceptances'];
    for (const table of tables) {
      expect(await ownerQuery(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS allowed`, [`public.${table}`]))
        .toEqual([{ allowed: true }]);
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES']) {
        expect(await ownerQuery(`SELECT has_table_privilege('league_one_runtime',$1,$2) AS allowed`, [`public.${table}`, privilege]))
          .toEqual([{ allowed: false }]);
      }
      for (const role of ['league_one_auth', 'league_one_account']) {
        expect(await ownerQuery(`SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') AS allowed`,
          [role, `public.${table}`])).toEqual([{ allowed: false }]);
      }
    }
    await expect(runtimeQuery('UPDATE league_roster_resource_heads SET generation=generation+1 WHERE scope_id=$1', [attempt.scopeId]))
      .rejects.toThrow(/permission denied/);
    await expect(runtimeQuery('SELECT record_league_administration_observation_v1($1::jsonb)', ['{}'])).rejects.toThrow(/permission denied/);
    await expect(runtimeQuery('SELECT validate_current_roster_mapping($1::jsonb)', [JSON.stringify(token)])).rejects.toThrow(/permission denied/);
    for (const [table, column, value] of [
      ['league_roster_resource_scopes', 'id', attempt.scopeId], ['league_roster_resource_attempts', 'id', attempt.id],
      ['league_roster_capture_receipts', 'id', read.receipt.id], ['league_roster_resource_acceptances', 'receipt_id', read.receipt.id],
    ]) {
      await expect(ownerQuery(`UPDATE ${table} SET ${column}=${column} WHERE ${column}=$1`, [value])).rejects.toThrow(/immutable/);
      await expect(ownerQuery(`DELETE FROM ${table} WHERE ${column}=$1`, [value])).rejects.toThrow(/immutable/);
    }
    const catalog = await ownerQuery(`SELECT proname,prosecdef,proconfig,
      EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute
      FROM pg_proc p WHERE pronamespace='public'::regnamespace
        AND proname IN ('begin_current_roster_attempt','record_league_administration_observation')`);
    expect(catalog).toHaveLength(2);
    for (const row of catalog) expect(row).toMatchObject({ prosecdef: true, public_execute: false,
      proconfig: ['search_path=pg_catalog, public, pg_temp'] });
    expect(await accepted(token)).toEqual(read);
    expect((await state(f))[0].acceptances).toBe(1);
  });

  it('rejects contradictory owner acceptance links and head generation or scope forgery', async () => {
    const first = await seed(); const foreign = await seed();
    const unused = await store.beginRosterAttempt(first.token, randomUUID());
    const before = await state(first.f);
    await expect(ownerQuery(`INSERT INTO league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,evidence_hash,
        provenance,configuration_content_id,population_evidence,expected_team_count,coverage)
      SELECT $1,content_id,legacy_observation_id,evidence_hash,provenance,configuration_content_id,population_evidence,
        expected_team_count,coverage FROM league_roster_capture_receipts WHERE id=$2`,
    [unused.id, foreign.read.receipt.id])).rejects.toThrow(/receipt lineage mismatch/);
    await expect(ownerQuery(`INSERT INTO league_roster_resource_acceptances(scope_id,receipt_id,source_mapping_revision_id,generation)
      VALUES($1,$2,$3,2)`, [first.attempt.scopeId, foreign.read.receipt.id, first.token.revisionId])).rejects.toThrow(/acceptance lineage mismatch/);
    await expect(ownerQuery(`UPDATE league_roster_resource_heads SET accepted_id=(SELECT id FROM league_roster_resource_acceptances
      WHERE receipt_id=$2),generation=1 WHERE scope_id=$1`, [first.attempt.scopeId, foreign.read.receipt.id])).rejects.toThrow(/head lineage mismatch/);
    await expect(ownerQuery(`UPDATE league_roster_resource_heads SET generation=generation+1 WHERE scope_id=$1`, [first.attempt.scopeId]))
      .rejects.toThrow(/head lineage mismatch/);
    await expect(ownerQuery(`UPDATE league_roster_resource_heads SET accepted_id=NULL WHERE scope_id=$1`, [first.attempt.scopeId]))
      .rejects.toThrow(/head cannot regress/);
    expect(await state(first.f)).toEqual(before);
  });

  it('supports migration-first installation without runtime grants and applies only intended grants during later provisioning', async () => {
    const seeded = await seed(); const before = await state(seeded.f);
    const [migration, provisioning] = await Promise.all([
      readFile(new URL('../migrations/027_current_roster_acceptance.sql', import.meta.url), 'utf8'),
      readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'),
    ]);
    const missingRole = `roster_missing_runtime_${randomUUID().replaceAll('-', '')}`;
    const owner = await createPinnedIntegrationDatabase('owner');
    const tables = ['league_roster_resource_scopes', 'league_roster_resource_heads', 'league_roster_resource_attempts',
      'league_roster_capture_receipts', 'league_roster_resource_acceptances'];
    const callable = new Set(['begin_current_roster_attempt', 'record_league_administration_observation']);
    const functions = [...callable, 'record_league_administration_observation_v1',
      'validate_current_roster_mapping', 'validate_current_roster_lineage'];
    try {
      await owner.database.query('BEGIN');
      await owner.database.query("SET LOCAL statement_timeout='15s'");
      await owner.database.query("SET LOCAL lock_timeout='5s'");
      expect(await owner.database.query(`SELECT count(*) FILTER (WHERE rolname=$1)::integer AS missing_count,
        count(*) FILTER (WHERE rolname='league_one_runtime')::integer AS runtime_count FROM pg_roles`, [missingRole]))
        .toEqual([{ missing_count: 0, runtime_count: 1 }]);
      // The supervised harness requires the real restricted role. As in the B3
      // bootstrap proof, replace only its spelling in the actual migration;
      // never create, drop, rename or assume an alternative database role.
      // All temporary DDL and provisioning changes remain in this transaction.
      await owner.database.query(`DROP FUNCTION public.record_league_administration_observation(jsonb),
        public.begin_current_roster_attempt(jsonb,uuid,jsonb,jsonb,jsonb),
        public.validate_current_roster_mapping(jsonb),public.validate_current_roster_lineage() CASCADE`);
      await owner.database.query(`DROP TABLE public.league_roster_resource_acceptances,public.league_roster_capture_receipts,
        public.league_roster_resource_attempts,public.league_roster_resource_heads,public.league_roster_resource_scopes CASCADE`);
      await owner.database.query(`ALTER FUNCTION public.record_league_administration_observation_v1(jsonb)
        RENAME TO record_league_administration_observation`);
      await owner.database.query(migration.replaceAll('league_one_runtime', missingRole));
      const functionRights = () => owner.database.query<{ name: string; runtime_execute: boolean; public_execute: boolean }>(`
        SELECT p.proname AS name,has_function_privilege('league_one_runtime',p.oid,'EXECUTE') AS runtime_execute,
          EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
            WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute
        FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY($1::text[]) ORDER BY p.proname`, [functions]);
      const tableRights = () => owner.database.query<{ name: string; runtime_select: boolean; runtime_mutation: boolean; public_grant: boolean }>(`
        SELECT c.relname AS name,has_table_privilege('league_one_runtime',c.oid,'SELECT') AS runtime_select,
          has_table_privilege('league_one_runtime',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') AS runtime_mutation,
          EXISTS (SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl WHERE acl.grantee=0) AS public_grant
        FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[]) ORDER BY c.relname`, [tables]);
      const beforeFunctions = await functionRights(); const beforeTables = await tableRights();
      expect(beforeFunctions).toHaveLength(functions.length); expect(beforeTables).toHaveLength(tables.length);
      for (const row of beforeFunctions) expect(row, row.name).toMatchObject({ runtime_execute: false, public_execute: false });
      for (const row of beforeTables) expect(row, row.name).toMatchObject({ runtime_select: false, runtime_mutation: false, public_grant: false });
      // The real role already exists and passed the harness guards, so the
      // provisioning script's CREATE ROLE branch is a no-op.
      await owner.database.query(provisioning);
      const afterFunctions = await functionRights(); const afterTables = await tableRights();
      expect(afterFunctions).toHaveLength(functions.length); expect(afterTables).toHaveLength(tables.length);
      for (const row of afterFunctions) expect(row, row.name).toMatchObject({ runtime_execute: callable.has(row.name), public_execute: false });
      for (const row of afterTables) expect(row, row.name).toMatchObject({ runtime_select: true, runtime_mutation: false, public_grant: false });
      expect(await owner.database.query('SELECT count(*)::integer AS count FROM pg_roles WHERE rolname=$1', [missingRole]))
        .toEqual([{ count: 0 }]);
    } finally {
      try { await owner.database.query('ROLLBACK'); } finally { await owner.close(); }
    }
    expect(await state(seeded.f)).toEqual(before);
    expect(await accepted(seeded.token)).toEqual(seeded.read);
  });
});
