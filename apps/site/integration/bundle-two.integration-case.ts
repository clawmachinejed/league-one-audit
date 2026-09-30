import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBundleTwoReader } from '../lib/aggregator/bundle-two-reader';
import { createSeasonOverviewManifest, compareSeasonOverviewBatch } from '../lib/aggregator/season-overview-retained';
import type { BundleTwoReadInput } from '../lib/aggregator/bundle-two';
import type { DatabaseClient, DatabaseRow } from '../lib/database';
import type { JsonObject } from '../lib/league-administration/contracts';
import { normalizeTeams, compareTeams, type SleeperRoster, type SleeperMatchup } from '../lib/transform';
import { compareRosterStandings, calculateTeamPpg } from '../lib/roster-metrics';
import { buildMyTeamScheduleWeeks, selectTeamSchedule } from '../lib/my-team-schedule';
import { buildCompletedStandingsBasis, reconcileStandingsBasis, projectStandings } from '../lib/projected-standings';
import { scoreSparseStatistics } from '../lib/projections/domain/scoring';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { b2Fingerprint, b2Players, b2RosterRows, createB2Fixture, type B2Fixture } from './b2-acceptance-fixture';
import { publishB2DerivedSnapshot, seedB2PlayerMetrics } from './b2-derived-fixture';

/** Exercises the production composition entry point, with real restricted SQL and synthetic evidence only. */
describe.sequential('B2 season overview through the guarded real store', () => {
  let connection: IndependentDatabase;
  beforeAll(() => { connection = createIndependentDatabase(); });
  afterAll(async () => connection.close());

  async function read(f: B2Fixture, overrides: Partial<BundleTwoReadInput> = {}) {
    const queries: string[] = [];
    const database: DatabaseClient = { enabled: true,
      async query<Row extends DatabaseRow>(statement: string, parameters: readonly unknown[] = []) {
        queries.push(statement);
        expect(statement).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CALL)\b/iu);
        return connection.database.query<Row>(statement, parameters);
      },
    };
    const before = await b2Fingerprint(f.leagueSeasonId);
    const request = await f.request(overrides);
    const result = await createBundleTwoReader(database).readBundleTwo(request);
    expect(await b2Fingerprint(f.leagueSeasonId)).toEqual(before);
    if (result.status !== 'read') throw new Error(`Missing B2 read: ${JSON.stringify(result)}`);
    return { result, request, queries };
  }

  it('reads same-capture exact official values, both local orders and waivers using the restricted login', async () => {
    const [role] = await connection.database.query(`SELECT current_user AS name,rolsuper,rolcreatedb,rolcreaterole
      FROM pg_roles WHERE rolname=current_user`);
    expect(role).toEqual({ name: 'league_one_runtime', rolsuper: false, rolcreatedb: false, rolcreaterole: false });
    const f = await createB2Fixture(connection.database);
    const { result, queries } = await read(f, { calendar: null });
    expect(result.source).toMatchObject({ status: 'available', historicalApplicability: 'unverified',
      source: { receiptId: f.initial.read.receipt.id, contentId: f.initial.read.accepted.contentId,
        rawContentHash: f.initial.normalized.contentHash, provenance: f.initial.normalized.envelope.provenance },
      teams: [{ record: { wins: { value: 1 }, losses: { value: 1 }, ties: { value: 1 } },
        pointsFor: { value: '100.00001' }, pointsAgainst: { value: '105' }, providerRank: { value: 2 } },
      { pointsAgainst: { value: '95' }, providerRank: { value: 1 } }] });
    if (result.standings.status !== 'available' || result.rosterSummaries.status !== 'available') throw new Error('Missing official views.');
    const legacy = normalizeTeams(f.initial.rows as unknown as SleeperRoster[], [1, 2].map(id => ({
      user_id: `b2-manager-${id}`, display_name: `Manager ${id}`, avatar: null,
    })));
    const places = (comparator: typeof compareTeams) => new Map([...legacy].sort(comparator).map((team, index) => [team.id, index + 1]));
    expect(result.standings.teams.map(team => team.leagueOneOrder)).toEqual(legacy.map(team => places(compareTeams).get(team.id)));
    expect(result.rosterSummaries.teams.map(team => team.standingsRank)).toEqual(legacy.map(team => places(compareRosterStandings).get(team.id)));
    expect(result.standings.teams.map(team => team.leagueOneOrder)).toEqual([1, 2]);
    expect(result.rosterSummaries.teams.map(team => team.standingsRank)).toEqual([2, 1]);
    expect(result.standings.teams[0].waiver).toMatchObject({ priority: { value: 1 }, budgetUsed: { value: -10 }, budgetRemaining: 110 });
    expect(result.standings.compatibility).toMatchObject({ status: 'available', teams: legacy });
    expect(result.managerDirectory).toMatchObject({ status: 'available', teams: [
      { profileTarget: { seasonTeamId: f.initial.read.teams[0].seasonTeamId, externalRosterId: '1' },
        relationship: { primaryOwner: { manager: { sourceManager: { nativeId: 'b2-manager-1' } } } },
        displayAttribution: { kind: 'provider', externalManagerId: 'b2-manager-1' } }, {},
    ] });
    expect(result.schedule).toEqual({ status: 'unavailable', reason: 'schedule_not_requested' });
    expect(result.playerMetrics.status).toBe('unavailable');
    expect(queries.filter(query => query.includes('read-accepted-exact-matchups'))).toHaveLength(1);
    expect(await ownerQuery('SELECT coverage FROM league_roster_capture_receipts WHERE id=$1', [f.initial.read.receipt.id]))
      .toEqual([{ coverage: { periodIds: [], interval: null, entitySet: 'full', fields: ['players'],
        pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] } }]);
  });

  it('retains field-level absent/null/invalid states, correction lineage and the last complete accepted population', async () => {
    const f = await createB2Fixture(connection.database);
    const original = await ownerQuery('SELECT to_jsonb(c) AS content FROM league_administration_contents c WHERE id=$1', [f.initial.read.accepted.contentId]);
    const changed = b2RosterRows();
    changed[0].settings = { wins: null, losses: 1, ties: 'invalid', fpts: -1.005, fpts_decimal: 0,
      fpts_against: 0, fpts_against_decimal: null, waiver_position: 0, waiver_budget_used: -10 };
    const absentWins = { ...(changed[1].settings as JsonObject) }; delete absentWins.wins;
    changed[1].settings = absentWins;
    const correction = await f.roster(changed);
    const { result } = await read(f, { calendar: null });
    expect(result.source).toMatchObject({ status: 'available', completeness: 'partial', source: {
      receiptId: correction.read.receipt.id, provenance: correction.normalized.envelope.provenance }, teams: [
      { record: { wins: { state: 'null', value: null }, ties: { state: 'invalid', value: null } },
        pointsFor: { value: '-1.005' }, pointsAgainst: { state: 'null', value: null },
        providerRank: { state: 'absent', value: null }, waiver: { priority: { state: 'invalid', value: null } } },
      { record: { wins: { state: 'absent', value: null } } },
    ] });
    expect(result.standings).toMatchObject({ status: 'available', localOrder: { status: 'unavailable' },
      teams: [{ leagueOneOrder: null }, { leagueOneOrder: null }] });
    const partial = await f.roster(changed.slice(0, 1), { partial: true });
    expect(partial.written.rosterAcceptance?.status).toBe('preserved');
    expect((await read(f, { calendar: null })).result.source).toEqual(result.source);
    expect(await ownerQuery('SELECT to_jsonb(c) AS content FROM league_administration_contents c WHERE id=$1', [f.initial.read.accepted.contentId])).toEqual(original);
  });

  it('builds bounded same-capture schedules with exact results and team-specific incomplete averages', async () => {
    const f = await createB2Fixture(connection.database);
    const rows: SleeperMatchup[][] = [
      [{ roster_id: 1, matchup_id: 1, points: 1.004 }, { roster_id: 2, matchup_id: 1, points: 1.003 }],
      [{ roster_id: 1, matchup_id: 1, points: 20, custom_points: 0 }, { roster_id: 2, matchup_id: 1, points: 0 }],
      [{ roster_id: 1, matchup_id: 1, points: -3 }, { roster_id: 2, matchup_id: 1, points: null }],
    ];
    const original = await f.matchup(1, rows[0]);
    await f.matchup(2, rows[1]); await f.matchup(3, rows[2]);
    const { result } = await read(f, { selectedWeek: 1, scheduleRange: 'my-team' });
    if (result.schedule.status !== 'available' || result.standings.status !== 'available'
      || result.standings.compatibility.status !== 'available') throw new Error('Missing schedule fixture.');
    const teams = result.standings.compatibility.teams;
    const legacy = selectTeamSchedule({ league: f.league, updatedAt: f.initial.normalized.envelope.provenance.checkedAt,
      teams: [...teams], weeks: buildMyTeamScheduleWeeks(teams, rows, { completedWeeks: [1, 2, 3], activeWeek: 4, preseason: false }) }, 1);
    const values = (entries: readonly { week: number; points: number | null; opponentPoints: number | null; result: string | null }[]) =>
      entries.map(({ week, points, opponentPoints, result }) => ({ week, points, opponentPoints, result }));
    expect(values(result.schedule.weeks)).toEqual(values(legacy.weeks));
    expect(result.schedule.weeks.slice(0, 3).map(week => week.result)).toEqual(['W', 'T', null]);
    expect(result.schedule.weeks[1].exactOfficialPoints).toMatchObject({ raw: '20', custom: '0', effective: '0' });
    expect(result.schedule.weeks[3]).toMatchObject({ points: null, result: null, source: null, coverage: { status: 'missing' } });
    expect(result.schedule.currentTeam.currentRecord).toEqual({ wins: 1, losses: 1, ties: 1 });
    expect(result.matchupSummary).toMatchObject({ status: 'available', temporalContext: 'current-display',
      matchupPeriod: { nativeWeek: 1 }, teams: [{ currentRecord: { wins: { value: 1 } } }, {}] });
    const current = (await read(f, { scheduleRange: 'manager' })).result;
    expect(current.schedule).toMatchObject({ status: 'available', range: { fromWeek: 1, throughWeek: 14 } });
    if (current.rosterSummaries.status !== 'available') throw new Error('Missing roster summary.');
    const averages = calculateTeamPpg(rows, 3, [1, 2]);
    expect(current.rosterSummaries.teams.map(team => [team.averagePpg, team.averagePpgRank]))
      .toEqual([1, 2].map(id => [averages.get(id)?.ppg ?? null, averages.get(id)?.rank ?? null]));
    const corrected = await f.matchup(1, [{ ...rows[0][0], custom_points: 0 }, rows[0][1]]);
    expect((await read(f, { scheduleRange: 'manager' })).result.schedule)
      .toMatchObject({ status: 'available', weeks: [{ points: 0, result: 'L' }, ...Array.from({ length: 13 }, () => ({}))] });
    expect(corrected.read.status).toBe('available');
    expect(await ownerQuery('SELECT payload FROM league_administration_contents WHERE id=$1',
      [original.read.status === 'available' ? original.read.accepted.contentId : null])).toEqual([{ payload: rows[0] }]);
  });

  it('keeps unpaired and missing calendar evidence explicit and withholds history at rollover', async () => {
    const f = await createB2Fixture(connection.database);
    await f.matchup(1, [{ roster_id: 1, matchup_id: null, points: 1 }, { roster_id: 2, matchup_id: null, points: 2 }]);
    const { result } = await read(f, { calendar: null, scheduleRange: 'manager' });
    expect(result.schedule).toMatchObject({ status: 'available', limitations: expect.arrayContaining(['calendar_completion_unproved']),
      weeks: [{ opponentSeasonTeamId: null, result: null, coverage: { status: 'limited' } }, ...Array.from({ length: 13 }, () => ({}))] });
    expect(result.source.status).toBe('available');
    const input = await f.request();
    const rollover = (await read(f, { context: { ...input.context, defaultWeek: 5, activeWeek: 5 } })).result;
    expect(rollover.rosterSummaries).toMatchObject({ status: 'available', history: { throughWeek: null },
      teams: [{ averagePpg: null }, { averagePpg: null }] });
    const old = (await read(f, { now: new Date(input.now.getTime() + 7 * 86_400_000) })).result;
    expect(old.source).toEqual(result.source);
    expect(old.standings).toMatchObject({ status: 'available', freshness: 'unknown', source: { provenance: f.initial.normalized.envelope.provenance } });
  });

  it('does not promote display metadata or a previous manager capture into current ownership', async () => {
    const f = await createB2Fixture(connection.database);
    const changed = b2RosterRows(); changed[0].owner_id = 'b2-new-owner';
    changed[0].metadata = { team_name: 'Current display only' };
    await f.roster(changed, { managers: false });
    const { result } = await read(f, { calendar: null });
    expect(result.managerDirectory).toMatchObject({ status: 'available', ownership: null, teams: [
      { display: { name: 'Current display only' }, relationship: null,
        profileTarget: { seasonTeamId: f.initial.read.teams[0].seasonTeamId } }, { relationship: null },
    ] });
    expect(result.standings).toMatchObject({ status: 'available', localOrder: { status: 'unavailable' },
      teams: [{ official: { record: { wins: { value: 1 } } } }, {}] });
    expect(result.limitations).toContain('current_metadata_not_historical_evidence');
  });

  it('fences wrong seasons and a real mapping change while composed reads are in flight', async () => {
    const f = await createB2Fixture(connection.database), input = await f.request({ calendar: null });
    expect(await createBundleTwoReader(connection.database).readBundleTwo({ ...input, league: { ...input.league, season: '2027' } }))
      .toEqual({ status: 'unavailable', reason: 'invalid_season_overview_request' });
    let mappingReads = 0;
    const database: DatabaseClient = { enabled: true,
      async query<Row extends DatabaseRow>(statement: string, parameters: readonly unknown[] = []) {
        const rows = await connection.database.query<Row>(statement, parameters);
        if (statement.includes('league-administration:read-source-mapping') && ++mappingReads === 1) {
          await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'isolated B2 concurrent remap')",
            [f.leagueSeasonId, f.mapping.revisionId, `b2-replacement-${randomUUID()}`]);
        }
        return rows;
      },
    };
    expect(await createBundleTwoReader(database).readBundleTwo(input))
      .toEqual({ status: 'unavailable', reason: 'season_overview_mapping_changed' });
    expect(mappingReads).toBe(2);
    expect(await ownerQuery('SELECT payload FROM league_administration_contents WHERE id=$1', [f.initial.read.accepted.contentId]))
      .toEqual([{ payload: f.initial.rows }]);
  });

  it('joins real stored projections and cutoff metrics, preserving incomplete, historical and stale boundaries', async () => {
    const f = await createB2Fixture(connection.database);
    const rosters = b2RosterRows();
    rosters.forEach(row => { row.settings = { wins: 0, losses: 0, ties: 3, fpts: 0, fpts_against: 0 }; });
    await f.roster(rosters);
    const history: SleeperMatchup[] = [1, 2].map(roster_id => ({ roster_id, matchup_id: 4, points: 0 }));
    await f.matchup(1, history); await f.matchup(2, history);
    const capture = await f.administration.beginCalculationSourceCapture(f.mapping, 4, randomUUID());
    const attempt = await f.administration.beginExactMatchupAttempt(f.mapping, 4, randomUUID());
    const settingsAttempt = await f.administration.beginLeagueSettingsAttempt(f.mapping, randomUUID());
    const configuration = await f.document('league', f.leaguePayload);
    const configured = await f.administration.recordObservation(configuration, undefined, f.mapping,
      undefined, undefined, { attempt: settingsAttempt }, undefined, f.calendar.evidence, capture);
    if (!configured.observationId || !configured.versionId || !configured.calculationInput
      || configured.generation === undefined || configured.leagueSettingsAcceptance?.status !== 'accepted') {
      throw new Error('Missing B2 linked settings capture.');
    }
    const rows: SleeperMatchup[] = [1, 2].map((roster_id, index) => ({ roster_id, matchup_id: 4,
      players: [b2Players[index]], starters: [b2Players[index], '0'], starters_points: [0, null],
      players_points: { [b2Players[index]]: 0 }, points: 0 }));
    const current = await f.document('matchups', rows as unknown as JsonObject[], 4);
    const captured = await f.administration.recordObservation(current, undefined, f.mapping, undefined, undefined,
      undefined, { attempt, population: { observationId: configured.observationId,
        contentHash: configuration.contentHash, envelope: configuration.envelope } }, undefined, capture);
    if (!captured.calculationInput || captured.matchupAcceptance?.status !== 'accepted') throw new Error('Missing B2 linked matchup capture.');
    const published = await publishB2DerivedSnapshot({ database: connection.database, mapping: f.mapping,
      leagueSeasonId: f.leagueSeasonId, league: f.league, week: 4, rows,
      at: current.envelope.provenance.requestCompletedAt!, source: { observationId: configured.observationId,
        configurationVersionId: configured.versionId, generation: configured.generation,
        sourceCapture: { captureId: capture.id, leagueInputId: configured.calculationInput.id, matchupInputId: captured.calculationInput.id } } });
    const snapshot = { snapshotId: published.snapshot.snapshotId, modelVersion: 'clock-v1' };
    const incomplete = (await read(f, { snapshot })).result;
    expect(incomplete.source.status).toBe('available');
    expect(incomplete.projectedStandings.status).toBe('unavailable');
    await f.matchup(3, history);
    for (const week of [1, 2, 3]) await seedB2PlayerMetrics({ season: 2026, week,
      observedAt: '2026-09-28T23:00:00.000Z', players: b2Players.map((id, index) => ({ id, receptions: index ? 6 : 4 })) });
    const { result, request } = await read(f, { snapshot, scheduleRange: 'my-team' });
    if (result.projectedStandings.status !== 'available' || result.playerMetrics.status !== 'available'
      || result.standings.status !== 'available' || result.standings.compatibility.status !== 'available') {
      throw new Error(`Missing populated B2 derived join: ${JSON.stringify({ projections: result.projectedStandings, metrics: result.playerMetrics })}`);
    }
    const teams = result.standings.compatibility.teams.map(team => ({ ...team, waiverOrder: null, waiverBudgetRemaining: null }));
    const basis = reconcileStandingsBasis(buildCompletedStandingsBasis(teams, 4, [history, history, history]), teams, rows);
    const legacy = projectStandings({ league: f.league, updatedAt: published.snapshot.calculatedAt, teams, projectionBasis: basis },
      { ...published.payload, teams }, request.context);
    if (legacy.kind !== 'projected') throw new Error('Missing same-capture legacy projection.');
    expect(result.projectedStandings.teams.map(team => team.projected)).toEqual(legacy.teams);
    expect(result.projectedStandings.reference.snapshotId).toBe(published.snapshot.snapshotId);
    expect(result.projectedStandings.teams.map(team => [team.externalRosterId, team.projectedRank])).toEqual([['2', 1], ['1', 2]]);
    const metrics = await f.projection.readAllPlayerPlayerMetrics(result.playerMetrics.reference.request, scoreSparseStatistics);
    expect(result.playerMetrics.metrics).toEqual(metrics.metrics);
    expect(result.playerMetrics.reference).toMatchObject({ scoringProfileId: f.scoringProfileId,
      throughWeek: 3, asOf: '2026-09-29T08:00:00.000Z', publicationEvidence: 'immutable_publication_unproved' });
    expect(result.playerMetrics.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerExternalId: b2Players[0], pointsPerGame: 2 }),
      expect.objectContaining({ providerExternalId: b2Players[1], pointsPerGame: 3 }),
    ]));
    expect(result.schedule).toMatchObject({ status: 'available', weeks: [
      {}, {}, {}, { result: null }, { source: null, coverage: { status: 'missing' } }, ...Array.from({ length: 10 }, () => ({})),
    ] });
    const historical = (await read(f, { snapshot, selectedWeek: 1 })).result;
    expect(historical.playerMetrics).toMatchObject({ status: 'available', reference: {
      throughWeek: 1, asOf: result.playerMetrics.reference.asOf } });
    expect(historical.projectedStandings).toEqual(result.projectedStandings);
    const stale = (await read(f, { snapshot, now: new Date(request.now.getTime() + 7 * 86_400_000) })).result;
    expect(stale.source).toEqual(result.source);
    expect(stale.projectedStandings).toMatchObject({ status: 'unavailable', officialFactsPreserved: true });
    expect(await f.projection.readCurrentSnapshot(f.leagueSeasonId, 4)).toMatchObject({ snapshotId: published.snapshot.snapshotId });
  });

  it('restarts frozen comparison of real accepted captures without following a corrected head or writing replay state', async () => {
    const f = await createB2Fixture(connection.database);
    const rows = b2RosterRows(); rows[0].settings = { ...(rows[0].settings as JsonObject), wins: 2 };
    const corrected = await f.roster(rows);
    const created = createSeasonOverviewManifest(f.mapping, [f.initial.input, corrected.input]);
    if (created.status !== 'available') throw new Error('Missing real-capture comparison manifest.');
    const whole = compareSeasonOverviewBatch(created.manifest, undefined, 100);
    const first = compareSeasonOverviewBatch(created.manifest, undefined, 1);
    if (first.status !== 'more') throw new Error('Missing comparison continuation.');
    const newer = b2RosterRows(); newer[0].settings = { ...(newer[0].settings as JsonObject), wins: 3 }; await f.roster(newer);
    const before = await b2Fingerprint(f.leagueSeasonId);
    const second = compareSeasonOverviewBatch(JSON.parse(JSON.stringify(created.manifest)), JSON.parse(JSON.stringify(first.cursor)), 1);
    if (whole.status !== 'complete' || second.status !== 'complete') throw new Error('Missing restarted comparison.');
    expect([...first.entries, ...second.entries]).toEqual(whole.entries);
    expect(second.durableReplay).toBe(false);
    expect(whole.entries.map(entry => entry.receiptId).sort()).toEqual([f.initial.read.receipt.id, corrected.read.receipt.id].sort());
    expect(await b2Fingerprint(f.leagueSeasonId)).toEqual(before);
    expect((await read(f, { calendar: null })).result.source).toMatchObject({ status: 'available', teams: [{ record: { wins: { value: 3 } } }, {}] });
  });
});
