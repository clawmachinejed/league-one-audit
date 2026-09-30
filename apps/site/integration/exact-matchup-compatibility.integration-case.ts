import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import captureSchedule from '../test-support/fixtures/sleeper-2026-season-schedule.json';
import type { AdministrationFamily, JsonValue } from '../lib/league-administration/contracts';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import { createBundleOneReader, createExactMatchupCompatibilityReader } from '../lib/league-administration/store';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createSleeperCalendarEvidence } from '../lib/league-administration/period-mapping';
import { createProjectionStore, type PublishSnapshotInput } from '../lib/projection-store';
import { calculateLineupRevision } from '../lib/projections/domain/lineup-revision';
import { translateSleeperLineupObservation } from '../lib/projections/adapters/sleeper/lineup-observation';
import { externalLeagueRef, externalRosterRef } from '../lib/projections/shared/provider-identity';
import type { SleeperMatchup } from '../lib/transform';
import type { MatchupsData, Player, Team } from '../lib/types';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

const rules = { rec: 0.5 };
const ordinary: readonly SleeperMatchup[] = [
  { roster_id: 1, matchup_id: 4, players: ['a'], starters: ['a', '0'],
    starters_points: [8.25, null], players_points: { a: 9.5 }, points: 8.25, custom_points: 0 },
  { roster_id: 2, matchup_id: 4, players: ['b'], starters: ['b', '0'],
    starters_points: [4, null], players_points: { b: 4 }, points: 4 },
];

/** All setup is synthetic and runs only inside the existing guarded disposable SQL suite. */
describe.sequential('accepted exact-period stored derived compatibility', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationMethods>;
  let projection: ReturnType<typeof createProjectionStore>;
  let reader: ReturnType<typeof createExactMatchupCompatibilityReader>;
  beforeAll(() => {
    connection = createIndependentDatabase();
    administration = createLeagueAdministrationMethods(connection.database);
    projection = createProjectionStore(connection.database);
    reader = createExactMatchupCompatibilityReader(connection.database);
  });
  afterAll(async () => connection.close());

  async function instant() {
    const [clock] = await ownerQuery('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
    return exactMatchupClockInstant(clock.at);
  }

  async function fixture() {
    const leagueKey = `compatibility-${randomUUID()}`;
    const externalLeagueId = `compatibility-source-${randomUUID()}`;
    const registered = await projection.registerLeagueSeason({ leagueKey, leagueName: 'Synthetic exact compatibility',
      season: 2026, sleeperLeagueId: externalLeagueId, scoringRules: rules });
    if (registered.kind !== 'stored') throw new Error('Missing synthetic registration.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','synthetic fixture')",
      [registered.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','synthetic fixture')",
      [registered.value.leagueId]);
    const mapping = await administration.readSourceMapping(externalLeagueId);
    if (!mapping) throw new Error('Missing synthetic source mapping.');
    const externalGameId = `compatibility-game-${randomUUID()}`;
    await projection.upsertNflGames([{ key: externalGameId, provider: 'tank01', externalGameId,
      season: 2026, seasonType: 'reg', week: 3, homeTeam: 'IND', awayTeam: 'HOU', kickoffAt: '2026-09-27T17:00:00.000Z' }]);
    return { ...registered.value, leagueKey, externalLeagueId, mapping, externalGameId };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;

  const leaguePayload = (f: Fixture) => ({ league_id: f.externalLeagueId, season: '2026', sport: 'nfl',
    season_type: 'regular', total_rosters: 2, scoring_settings: rules, roster_positions: ['QB', 'RB', 'BN'],
    settings: { leg: 3 }, status: 'in_season' });

  async function document(f: Fixture, family: AdministrationFamily, payload: unknown) {
    const at = await instant();
    return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: f.mapping.scope,
      family, week: family === 'matchups' ? 3 : null, completeness: 'complete', payload: payload as JsonValue,
      provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
  }

  async function seed(f: Fixture | undefined = undefined, options: {
    rows?: readonly SleeperMatchup[]; calendar?: boolean;
  } = {}) {
    const target = f ?? await fixture();
    const capture = await administration.beginCalculationSourceCapture(target.mapping, 3, randomUUID());
    const attempt = await administration.beginExactMatchupAttempt(target.mapping, 3, randomUUID());
    const league = await document(target, 'league', leaguePayload(target));
    const at = await instant();
    const calendar = options.calendar === false ? undefined : createSleeperCalendarEvidence({ season: '2026',
      seasonSchedule: captureSchedule.body, evaluatedAt: at, retrievalStartedAt: at, retrievalCompletedAt: at }) ?? undefined;
    if (options.calendar !== false && !calendar) throw new Error('Invalid synthetic calendar.');
    const leagueResult = await administration.recordObservation(league, undefined, target.mapping,
      undefined, undefined, undefined, undefined, calendar, capture);
    if (!leagueResult.observationId || !leagueResult.versionId || !leagueResult.calculationInput) {
      throw new Error('Missing synthetic configuration source.');
    }
    const rows = options.rows ?? ordinary;
    const matchup = await document(target, 'matchups', rows);
    const matchupResult = await administration.recordObservation(matchup, undefined, target.mapping,
      undefined, undefined, undefined, { attempt, population: { observationId: leagueResult.observationId,
        contentHash: league.contentHash, envelope: league.envelope } }, undefined, capture);
    if (!matchupResult.calculationInput || matchupResult.matchupAcceptance?.status !== 'accepted') {
      throw new Error('Missing synthetic accepted matchup source.');
    }
    const official = await administration.readAcceptedExactMatchups(target.mapping, 3);
    if (official.status !== 'available') throw new Error('Missing synthetic official facts.');
    return { f: target, capture, league, matchup, rows, official,
      source: { observationId: leagueResult.observationId, configurationVersionId: leagueResult.versionId,
        generation: leagueResult.generation, sourceCapture: { captureId: capture.id,
          leagueInputId: leagueResult.calculationInput.id, matchupInputId: matchupResult.calculationInput.id } } };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;

  /** Reuses the real restricted publication adapter and the store suite's synthetic ownership setup. */
  async function publicationFence(f: Fixture): Promise<PublishSnapshotInput['lineupFence']> {
    const watchId = randomUUID(); const runId = randomUUID();
    await ownerQuery(`INSERT INTO league_period_authorities
      (league_key,default_season,default_season_type,default_week,active_season,active_season_type,active_week,
        league_lifecycle,nfl_phase,source_provider,source_revision,source_observed_at,verified_at,source_external_league_id,
        expected_roster_count,expected_starter_slot_count,expected_roster_ids)
      VALUES($1,2026,'reg',3,2026,'reg',3,'active','regular','sleeper','synthetic-compatibility',now(),now(),$2,2,2,ARRAY['1','2'])`,
    [f.leagueKey, f.externalLeagueId]);
    await ownerQuery(`INSERT INTO league_week_lineup_watch_states
      (id,league_key,source_provider,external_league_id,season,season_type,week,lineup_revision_version,cadence_policy_version,
        authority_generation,watch_class,materialization_lane,phase,expected_roster_count,expected_starter_slot_count,expected_roster_ids,next_check_at)
      VALUES($1,$2,'sleeper',$3,2026,'reg',3,'lineup-v1','lineup-cadence-v1',1,'current','current',0,2,2,ARRAY['1','2'],now())`,
    [watchId, f.leagueKey, f.externalLeagueId]);
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until)
      VALUES('live-projection-sync','projection-sync',now(),'running',$1,now()+interval '5 minutes')
      ON CONFLICT(job_key) DO UPDATE SET state='running',lease_owner=$1,lease_until=now()+interval '5 minutes'`, [runId]);
    return { watchId, watchGeneration: 1, authorityGeneration: 1, ownerLane: 'current', runId };
  }

  function payload(at: string): MatchupsData {
    const teams: Team[] = [1, 2].map(id => ({ id, managerName: `Manager ${id}`, name: `Team ${id}`, avatar: null,
      wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }));
    const starter = (id: string, points: number, projectedPoints: number): Player => ({ id, name: id, position: 'QB',
      nflTeam: id === 'a' ? 'IND' : 'HOU', injuryStatus: null, slot: 'QB', points, projectedPoints,
      game: { kind: 'scheduled', opponent: id === 'a' ? 'HOU' : 'IND', location: id === 'a' ? 'home' : 'away',
        date: '2026-09-27', kickoffAt: '2026-09-27T17:00:00.000Z' } });
    const empty: Player = { id: 'empty-RB-1', name: 'Empty slot', position: '—', nflTeam: null, injuryStatus: null,
      game: null, slot: 'RB', points: null, projectedPoints: null };
    return { league: { season: '2026', rosterPositions: ['QB', 'RB'], week: 3, maxWeek: 18 }, teams,
      updatedAt: at, week: 3, matchups: [{ id: '4', status: 'upcoming', sides: [
        { team: teams[1], points: 4, projectedPoints: 17.5, starters: [starter('b', 4, 17.5), { ...empty }] },
        { team: teams[0], points: 0, projectedPoints: 13.25, starters: [starter('a', 8.25, 13.25), { ...empty }] },
      ], winProbability: { modelVersion: 'normal-v3', status: 'estimated',
        teams: [{ teamId: 1, probability: 0.35 }, { teamId: 2, probability: 0.65 }] } }] };
  }

  async function publish(value: Seed, lineupFence: PublishSnapshotInput['lineupFence'], options: {
    linked?: boolean; payload?: MatchupsData;
  } = {}) {
    const at = value.matchup.envelope.provenance.requestCompletedAt!;
    const leagueRef = externalLeagueRef('sleeper', value.f.externalLeagueId);
    const lineup = translateSleeperLineupObservation(leagueRef, { season: 2026, seasonType: 'regular', week: 3 }, {
      expectedRosterCount: 2, expectedStarterSlotCount: 2,
      expectedRosterRefs: ['1', '2'].map(id => externalRosterRef(leagueRef, id)),
    }, value.rows);
    if (lineup.status !== 'complete') throw new Error('Invalid synthetic lineup.');
    const revision = await calculateLineupRevision(lineup.observation);
    const official = await projection.recordLeagueWeekObservation({ leagueSeasonId: value.f.leagueSeasonId, week: 3,
      sourceRevision: randomUUID(), requestStartedAt: at, requestCompletedAt: at, observedAt: at, quality: 'complete',
      sourceData: options.linked === false ? {} : { administration: value.source },
      lineupRevisionVersion: revision.revisionVersion, lineupRevision: revision.lineupRevision,
      expectedTank01GameIds: [value.f.externalGameId], playerPoints: [],
      rosterPoints: value.rows.map(row => ({ externalRosterId: String(row.roster_id), points: row.custom_points ?? row.points ?? null })) });
    const games = await projection.recordGameStates({ provider: 'tank01', states: [{ externalGameId: value.f.externalGameId,
      sourceRevision: randomUUID(), requestStartedAt: at, requestCompletedAt: at, observedAt: at,
      statusCode: 0, period: null, gameClock: null, homeScore: null, awayScore: null, sourceData: {} }] });
    if (official.kind !== 'stored' || games.kind !== 'stored' || games.value.length !== 1) {
      throw new Error('Missing synthetic stored sources.');
    }
    const published = await projection.publishSnapshot({ lineupFence, leagueSeasonId: value.f.leagueSeasonId,
      week: 3, modelVersion: 'clock-v1', revisionKey: randomUUID(), leagueWeekObservationId: official.value.observationId,
      gameStateObservationIds: [games.value[0].observationId], calculatedAt: at, payload: options.payload ?? payload(at),
      activityWindows: [{ startsAt: '2026-09-27T15:00:00.000Z', endsAt: '2026-09-28T00:00:00.000Z' }] });
    if (published.kind !== 'published' && published.kind !== 'unchanged') throw new Error(`Synthetic publication failed: ${published.kind}`);
    return { published, observationId: official.value.observationId, gameObservationId: games.value[0].observationId };
  }
  type Published = Awaited<ReturnType<typeof publish>>;

  const readInput = (value: Seed, published: Published) => ({
    request: { snapshotId: published.published.snapshot.snapshotId, leagueSeasonId: value.f.leagueSeasonId,
      season: 2026, week: 3, modelVersion: 'clock-v1' }, expectedMapping: value.f.mapping,
    context: { defaultSeason: 2026, defaultWeek: 3, activeSeason: 2026, activeWeek: 3,
      lifecycle: 'active' as const, nflPhase: 'regular' as const, temporalState: 'active' as const, refreshDue: false },
    now: new Date(published.published.snapshot.verifiedAt),
  });
  const read = (value: Seed, published: Published) => reader.readExactMatchupCompatibility(readInput(value, published));
  const unavailable = (value: Awaited<ReturnType<typeof read>>, reason: string) => {
    expect(value.forecast).toMatchObject({ status: 'unavailable', reason });
    expect(value.gameState).toMatchObject({ status: 'unavailable', reason });
    expect(value.probability).toMatchObject({ status: 'unavailable', reason });
  };

  it('composes B1 from the accepted capture and stored snapshot while isolating absent optional resources', async () => {
    const value = await seed();
    const published = await publish(value, await publicationFence(value.f));
    const request = readInput(value, published);
    const result = await createBundleOneReader(connection.database).readBundleOne({
      expectedMapping: value.f.mapping, nativeWeek: 3,
      snapshot: { snapshotId: request.request.snapshotId, modelVersion: request.request.modelVersion },
      selectedSeasonTeamId: value.official.value.teams[0].seasonTeamId,
      context: request.context, now: request.now,
    });
    if (result.status !== 'read') throw new Error('Expected composed B1 read.');
    expect(result.official).toEqual(value.official);
    expect(result.dependencies.official).toMatchObject({ contentId: value.official.accepted.contentId,
      receiptId: value.official.receipt.id, mappingRevisionId: value.f.mapping.revisionId,
      sourceObservedAt: value.official.receipt.provenance.sourceObservedAt });
    expect(result.forecast).toMatchObject({ status: 'available', teams: [
      { projectedPoints: 13.25, projectedOutcome: 'loss', display: { name: 'Team 1', source: 'stored-snapshot' } },
      { projectedPoints: 17.5, projectedOutcome: 'win' },
    ] });
    expect(result.currentRoster.value.status).toBe('missing');
    expect(result.metadata).toMatchObject({ status: 'available', historicalPlayerState: 'unverified',
      currentDisplay: { status: 'unavailable' } });
    expect(result.boxScores).toMatchObject({ status: 'unavailable', reason: 'player_identity_invalid' });
    expect(result.gameState).toMatchObject({ status: 'available', groups: [
      { status: 'upcoming', authority: 'local-interpretation' },
    ] });
    const retry = await createBundleOneReader(connection.database).readBundleOne({
      expectedMapping: value.f.mapping, nativeWeek: 3, snapshot: null,
      selectedSeasonTeamId: null, context: request.context, now: request.now,
    });
    if (retry.status !== 'read') throw new Error('Expected official-only B1 read.');
    expect(retry.official).toEqual(value.official);
    expect(retry.forecast).toEqual({ status: 'unavailable', reason: 'snapshot_reference_missing' });
  });
  it('attaches stored results by team identity, preserving custom zero, ordered vacancies and official starter points', async () => {
    const value = await seed(); const published = await publish(value, await publicationFence(value.f));
    const result = await read(value, published);
    expect(result.official).toEqual(value.official);
    expect(result.forecast).toMatchObject({ status: 'available', reference: {
      snapshotId: published.published.snapshot.snapshotId, modelVersion: 'clock-v1',
    }, teams: expect.arrayContaining([
      expect.objectContaining({ seasonTeamId: value.official.value.teams.find(team => team.externalRosterId === '1')!.seasonTeamId,
        externalRosterId: '1', projectedPoints: 13.25, starters: [
          { index: 0, playerExternalId: 'a', projectedPoints: 13.25 },
          { index: 1, playerExternalId: null, projectedPoints: null },
        ] }),
      expect.objectContaining({ externalRosterId: '2', projectedPoints: 17.5 }),
    ]) });
    expect(result.gameState).toMatchObject({ status: 'available', observations: [
      { id: published.gameObservationId, provider: 'tank01', season: 2026, seasonType: 'reg', week: 3 },
    ] });
    expect(result.probability).toMatchObject({ status: 'available', groups: [{ identity: value.official.value.groups[0].identity,
      value: payload(published.published.snapshot.calculatedAt).matchups[0].winProbability }] });
    expect(value.official.value.teams[0]).toMatchObject({ officialTeamPoints: { effective: '0' },
      starters: [{ playerExternalId: 'a', officialPoints: '8.25' }, { playerExternalId: null, empty: true, officialPoints: null }] });
    expect(value.official.value.state).toEqual({ provider: 'unknown', local: 'unknown', reason: 'no_matchup_finality_evidence' });
  });

  it('retains the original calculation and game source IDs when unchanged publication advances verification', async () => {
    const original = await seed(); const fence = await publicationFence(original.f); const first = await publish(original, fence);
    const verification = await seed(original.f); const second = await publish(verification, fence);
    expect(second.published.kind).toBe('unchanged');
    expect(second.published.snapshot.snapshotId).toBe(first.published.snapshot.snapshotId);
    expect(second.observationId).not.toBe(first.observationId);
    expect(second.gameObservationId).not.toBe(first.gameObservationId);
    const result = await read(verification, second);
    expect(result.official).toEqual(verification.official);
    expect(result.forecast.status).toBe('available');
    expect(result.gameState).toMatchObject({ status: 'available', observations: [{ id: first.gameObservationId }] });
    expect(result.sourceHistory).toMatchObject({ status: 'available',
      original: { leagueWeekObservationId: first.observationId, gameStateObservationIds: [first.gameObservationId],
        source: { status: 'linked', captureId: original.capture.id,
          leagueInput: { provenance: original.league.envelope.provenance } } },
      verification: { leagueWeekObservationId: second.observationId, source: { status: 'linked', captureId: verification.capture.id,
        leagueInput: { provenance: verification.league.envelope.provenance } } } });
  });

  it('does not upgrade a legacy unlinked original after linked unchanged verification', async () => {
    const original = await seed(); const fence = await publicationFence(original.f);
    const first = await publish(original, fence, { linked: false });
    const verification = await seed(original.f); const second = await publish(verification, fence);
    expect(second.published.kind).toBe('unchanged');
    expect(second.published.snapshot.snapshotId).toBe(first.published.snapshot.snapshotId);
    const result = await read(verification, second);
    expect(result.official).toEqual(verification.official);
    unavailable(result, 'original_source_unproved');
  });

  it('does not upgrade an original source epoch after A to B to A remapping and fresh unchanged verification', async () => {
    const original = await seed(); const fence = await publicationFence(original.f); const first = await publish(original, fence);
    const other = `compatibility-remap-${randomUUID()}`;
    const [middle] = await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'synthetic remap') AS id",
      [original.f.leagueSeasonId, original.f.mapping.revisionId, other]);
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'synthetic return')",
      [original.f.leagueSeasonId, middle.id, original.f.externalLeagueId]);
    const mapping = await administration.readSourceMapping(original.f.externalLeagueId);
    if (!mapping) throw new Error('Missing remapped source.');
    const verification = await seed({ ...original.f, mapping });
    const second = await publish(verification, fence);
    expect(second.published.kind).toBe('unchanged');
    expect(second.published.snapshot.snapshotId).toBe(first.published.snapshot.snapshotId);
    const result = await read(verification, second);
    expect(result.official).toEqual(verification.official);
    unavailable(result, 'original_source_mismatch');
  });

  it.each(['team-score', 'starter-score', 'starter-order'] as const)('keeps corrected official %s facts independent of incompatible stored analytics', async field => {
    const original = await seed(); const published = await publish(original, await publicationFence(original.f));
    const changed = ordinary.map((row, index) => index ? row : field === 'team-score' ? { ...row, custom_points: -2 }
      : field === 'starter-score' ? { ...row, starters_points: [8.5, null] }
        : { ...row, starters: ['0', 'a'], starters_points: [null, 8.25] });
    const corrected = await seed(original.f, { rows: changed });
    const result = await read(corrected, published);
    expect(result.official).toEqual(corrected.official);
    unavailable(result, 'original_official_facts_mismatch');
  });

  it('rejects a scoring-profile change without replacing accepted facts or linked calculation history', async () => {
    const original = await seed(); const fence = await publicationFence(original.f); const published = await publish(original, fence);
    const before = await read(original, published);
    expect(before).toMatchObject({ official: original.official, forecast: { status: 'available' },
      gameState: { status: 'available' }, probability: { status: 'available' },
      sourceHistory: { status: 'available',
        original: { leagueWeekObservationId: published.observationId,
          source: { status: 'linked', captureId: original.capture.id } },
        verification: { leagueWeekObservationId: published.observationId,
          source: { status: 'linked', captureId: original.capture.id } } } });
    const current = await projection.readCurrentSnapshot(original.f.leagueSeasonId, 3);
    expect(current?.snapshotId).toBe(published.published.snapshot.snapshotId);

    const capture = await administration.beginCalculationSourceCapture(original.f.mapping, 3, randomUUID());
    const changed = await document(original.f, 'league', { ...leaguePayload(original.f), scoring_settings: { rec: 1 } });
    const at = await instant();
    const calendar = createSleeperCalendarEvidence({ season: '2026', seasonSchedule: captureSchedule.body,
      evaluatedAt: at, retrievalStartedAt: at, retrievalCompletedAt: at });
    if (!calendar) throw new Error('Invalid synthetic calendar.');
    const rejected = await administration.recordObservation(changed, undefined, original.f.mapping,
      undefined, undefined, undefined, undefined, calendar, capture);
    expect(rejected).toMatchObject({ status: 'rejected',
      reason: 'scoring_profile_change_requires_explicit_compatibility_and_period_review' });
    expect(rejected.calculationInput).toBeUndefined();
    expect(rejected.calendarEvidence).toBeUndefined();
    if (!rejected.observationId || !rejected.versionId) throw new Error('Missing retained rejected configuration.');
    expect(rejected.versionId).not.toBe(original.source.configurationVersionId);
    expect(await ownerQuery('SELECT id FROM league_calculation_capture_inputs WHERE capture_id=$1', [capture.id])).toEqual([]);
    expect(await ownerQuery('SELECT id FROM league_native_period_calendar_evidence WHERE observation_id=$1',
      [rejected.observationId])).toEqual([]);
    expect(await administration.readSource({ ...original.f.mapping.scope, family: 'league', week: null }))
      .toMatchObject({ status: 'conflict', reason: 'scoring_profile_change_requires_explicit_compatibility_and_period_review' });

    // A rejected configuration cannot be grafted onto the existing capture to
    // advance verification. The real official-observation writer enforces this.
    await expect(publish({ ...original, source: { ...original.source, observationId: rejected.observationId,
      configurationVersionId: rejected.versionId, generation: rejected.generation } }, fence))
      .rejects.toThrow(/official observation administration lineage is stale or mismatched/);
    expect(await ownerQuery('SELECT scoring_profile_id FROM league_seasons WHERE id=$1', [original.f.leagueSeasonId]))
      .toEqual([{ scoring_profile_id: original.f.scoringProfileId }]);
    expect(await administration.readAcceptedExactMatchups(original.f.mapping, 3)).toEqual(original.official);
    expect(await projection.readCurrentSnapshot(original.f.leagueSeasonId, 3)).toEqual(current);
    expect(await read(original, published)).toEqual(before);
  });

  it('requires retained native-to-NFL calendar evidence despite numerically equal weeks', async () => {
    const value = await seed(undefined, { calendar: false }); const published = await publish(value, await publicationFence(value.f));
    const result = await read(value, published);
    expect(result.official).toEqual(value.official);
    unavailable(result, 'period_mapping_unproved');
  });

  it('preserves official acceptance when the requested snapshot or model is absent', async () => {
    const value = await seed(); const published = await publish(value, await publicationFence(value.f));
    const input = readInput(value, published);
    for (const request of [{ ...input.request, snapshotId: randomUUID() }, { ...input.request, modelVersion: 'missing-model' }]) {
      const result = await reader.readExactMatchupCompatibility({ ...input, request });
      expect(result.official).toEqual(value.official);
      unavailable(result, 'snapshot_missing');
    }
  });

  it('never borrows another source or week when the requested snapshot UUID exists elsewhere', async () => {
    const value = await seed(); const published = await publish(value, await publicationFence(value.f));
    const other = await seed(); const input = readInput(value, published);
    const foreign = await reader.readExactMatchupCompatibility({ ...input, expectedMapping: other.f.mapping,
      request: { ...input.request, leagueSeasonId: other.f.leagueSeasonId } });
    expect(foreign.official).toEqual(other.official);
    unavailable(foreign, 'snapshot_missing');
    const nextWeek = await reader.readExactMatchupCompatibility({ ...input, request: { ...input.request, week: 4 } });
    expect(nextWeek.official).toEqual({ status: 'missing' });
    unavailable(nextWeek, 'official_unavailable');
  });

  it('keeps official data available when derived verification is stale', async () => {
    const value = await seed(); const published = await publish(value, await publicationFence(value.f));
    const input = readInput(value, published);
    const result = await reader.readExactMatchupCompatibility({ ...input, now: new Date(input.now.getTime() + 7 * 24 * 60 * 60 * 1000) });
    expect(result.official).toEqual(value.official);
    unavailable(result, 'snapshot_stale');
  });

  it('reports missing probability independently while retaining stored forecasts and original game references', async () => {
    const value = await seed(); const data = payload(value.matchup.envelope.provenance.requestCompletedAt!);
    delete data.matchups[0].winProbability;
    const published = await publish(value, await publicationFence(value.f), { payload: data });
    const result = await read(value, published);
    expect(result.official).toEqual(value.official);
    expect(result.forecast.status).toBe('available');
    expect(result.gameState.status).toBe('available');
    expect(result.probability.status).toBe('unavailable');
  });

  it('rejects an original game set that does not cover the stored starter games', async () => {
    const value = await seed(); const data = payload(value.matchup.envelope.provenance.requestCompletedAt!);
    data.matchups[0].sides[0].starters[0].nflTeam = 'LAR';
    data.matchups[0].sides[0].starters[0].game = { kind: 'scheduled', opponent: 'SEA', location: 'home',
      date: '2026-09-27', kickoffAt: '2026-09-27T17:00:00.000Z' };
    const published = await publish(value, await publicationFence(value.f), { payload: data });
    const result = await read(value, published);
    expect(result.official).toEqual(value.official);
    unavailable(result, 'game_evidence_unavailable');
  });
});
