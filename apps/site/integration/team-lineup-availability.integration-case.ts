import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readStoredMatchups, readStoredMatchupRevision } from '../lib/projection-reader';
import type { LeagueWeekObservationInput, PublishSnapshotInput } from '../lib/projection-store';
import { calculateLineupRevision } from '../lib/projections/domain/lineup-revision';
import {
  externalLeagueRef, externalLineupEntryRef, externalMatchupRef, externalRosterRef,
  externalPlayerRef,
} from '../lib/projections/shared/provider-identity';
import type { MatchupsData, Team } from '../lib/types';
import { databaseTime, lineageFixture, stored } from './lineup-lineage-fixture';
import {
  createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase,
} from './neon-integration-harness';

/** Synthetic storage evidence only: no provider retrieval or calculated production scores. */
describe.sequential('team lineup availability through isolated Neon publication', () => {
  let database: IndependentDatabase;
  beforeAll(() => { database = createIndependentDatabase(); });
  afterAll(async () => { await database.close(); });

  it('stores nonstarter points, replays unchanged bench content, and preserves history after a bench correction', async () => {
    const f = await lineageFixture(database);
    const leagueRef = externalLeagueRef('sleeper', `source-${f.leagueKey}`);
    const period = { ...f.period, seasonType: 'regular' as const };
    const ids = [1, 2, 3].map(() => `bench-fixture-${randomUUID()}`);
    stored(await f.store.upsertScoringEntities(ids.map((id) => ({ key: id, kind: 'player' as const,
      displayName: 'Synthetic bench fixture', nflTeam: 'SF', providerIds: [{ provider: 'sleeper', externalId: id }],
    }))));
    const lineup = await calculateLineupRevision({ leagueRef, period,
      shape: { expectedRosterCount: 2, expectedStarterSlotCount: 1,
        expectedRosterRefs: ['1', '2'].map((id) => externalRosterRef(leagueRef, id)) },
      rows: ['1', '2'].map((id, index) => ({ rosterRef: externalRosterRef(leagueRef, id),
        matchupRef: externalMatchupRef(leagueRef, period, '1'), starters: [externalLineupEntryRef(leagueRef, ids[index])],
      })),
    });
    await f.acceptWatch(lineup.lineupRevision);
    const teams: Team[] = [1, 2].map((id) => ({ id, managerName: `Synthetic ${id}`, name: `Synthetic team ${id}`,
      avatar: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }));
    async function observe(benchPoints: number) {
      const at = await databaseTime();
      const evidence = [{ entityRef: externalPlayerRef('sleeper', ids[2]), rosterRef: externalRosterRef(leagueRef, '1'),
        points: benchPoints, isStarter: false, lineupSlot: 'BN' }];
      const input: LeagueWeekObservationInput = { leagueSeasonId: f.league.leagueSeasonId, week: f.period.week,
        sourceRevision: randomUUID(), requestStartedAt: at, requestCompletedAt: at, observedAt: at, quality: 'complete',
        lineupRevisionVersion: lineup.revisionVersion, lineupRevision: lineup.lineupRevision,
        sourceData: { rosterIds: ['1', '2'], benchPointsEvidence: evidence }, expectedTank01GameIds: [],
        playerPoints: ids.map((id, index) => ({ sleeperPlayerId: id, entityKind: 'player',
          externalRosterId: index === 1 ? '2' : '1', points: index === 2 ? benchPoints : 10,
          isStarter: index !== 2, lineupSlot: index === 2 ? 'BN' : 'QB' })),
        rosterPoints: [{ externalRosterId: '1', points: 10 }, { externalRosterId: '2', points: 10 }],
      };
      const observation = stored(await f.store.recordLeagueWeekObservation(input));
      const player = (id: string, points: number, slot: string) => ({ id, name: 'Synthetic fixture player',
        position: 'QB', nflTeam: 'SF', injuryStatus: null, game: null, slot, points, projectedPoints: 12 });
      const payload: MatchupsData = { league: { season: '2026', rosterPositions: ['QB', 'BN'], week: f.period.week, maxWeek: 18 },
        teams, updatedAt: at, week: f.period.week, matchups: [{ id: '1', status: 'upcoming', sides: teams.map((team, index) => ({
          team, points: 10, projectedPoints: 12, starters: [player(ids[index], 10, 'QB')],
          bench: index === 0 ? [player(ids[2], benchPoints, 'BN')] : [],
        })) }],
      };
      const publication: PublishSnapshotInput = { leagueSeasonId: f.league.leagueSeasonId, week: f.period.week,
        modelVersion: 'clock-v1', revisionKey: createHash('sha256').update(input.sourceRevision).digest('hex'),
        leagueWeekObservationId: observation.observationId, gameStateObservationIds: [], calculatedAt: at,
        payload, activityWindows: [], lineupFence: f.fence };
      return { input, evidence, observation, payload, publication };
    }
    const initial = await observe(0);
    expect(initial.observation).toMatchObject({ playerPointsStored: 3, rosterPointsStored: 2,
      expectedGamesStored: 0, unmappedSleeperPlayerIds: [], unmappedTank01GameIds: [] });
    expect(stored(await f.store.recordLeagueWeekObservation(initial.input))).toEqual(initial.observation);
    const first = await f.store.publishSnapshot(initial.publication);
    if (first.kind !== 'published') throw new Error('Initial bench snapshot did not publish.');
    const repeated = await observe(0);
    const replay = await f.store.publishSnapshot(repeated.publication);
    expect(replay.kind).toBe('unchanged');
    if (replay.kind !== 'unchanged') throw new Error('Unchanged bench content duplicated a snapshot.');
    expect(replay.snapshot.snapshotId).toBe(first.snapshot.snapshotId);
    const corrected = await observe(5);
    const final = await f.store.publishSnapshot(corrected.publication);
    if (final.kind !== 'published') throw new Error('Corrected bench snapshot did not publish.');
    const now = new Date(await databaseTime());
    const full = await readStoredMatchups(f.leagueKey, f.period.week, { store: f.store, now });
    const compact = await readStoredMatchupRevision(f.leagueKey, f.period.week, { store: f.store, now });
    if (full.kind !== 'usable' || compact.kind !== 'usable') throw new Error('Bench readers disagreed.');
    expect(full.payload.matchups[0].sides[0]).toMatchObject({ points: 10, projectedPoints: 12,
      bench: [{ points: 5, projectedPoints: 12 }] });
    expect(compact.snapshotRevision).toBe(full.snapshotRevision);
    expect((await ownerQuery(`SELECT count(*)::integer AS players,
      count(*) FILTER (WHERE is_starter)::integer AS starters,
      count(*) FILTER (WHERE NOT is_starter AND lineup_slot='BN')::integer AS bench
      FROM official_player_point_observations WHERE league_week_observation_id=$1`, [initial.observation.observationId]))[0])
      .toEqual({ players: 3, starters: 2, bench: 1 });
    expect((await ownerQuery(`SELECT source_data->'benchPointsEvidence' AS evidence FROM league_week_observations WHERE id=$1`,
      [initial.observation.observationId]))[0].evidence).toEqual(initial.evidence);
    expect((await ownerQuery(`SELECT payload FROM projection_snapshots WHERE id=$1`, [first.snapshot.snapshotId]))[0].payload)
      .toEqual(initial.payload);
    expect((await ownerQuery(`SELECT count(*)::integer AS snapshots FROM projection_snapshots WHERE league_season_id=$1`,
      [f.league.leagueSeasonId]))[0].snapshots).toBe(2);
    expect((await ownerQuery(`SELECT snapshot_id FROM current_projection_snapshots WHERE league_season_id=$1 AND week=$2`,
      [f.league.leagueSeasonId, f.period.week]))[0].snapshot_id).toBe(final.snapshot.snapshotId);
  });

  it.each([8, null])('retains unknown starter lists and sourced nullable points (%j), then appends recovery', async (knownPoints) => {
    const f = await lineageFixture(database);
    const leagueRef = externalLeagueRef('sleeper', `source-${f.leagueKey}`);
    const period = { ...f.period, seasonType: 'regular' as const };
    // Separate canonical games from each other and the existing IND/HOU storage fixtures.
    const [homeTeam, awayTeam] = knownPoints === null ? ['MIA', 'DEN'] : ['NYJ', 'JAX'];
    const playerIds = [1, 2].map((id) => `lineup-availability-${randomUUID()}-${id}`);
    const identities = stored(await f.store.upsertScoringEntities(playerIds.map((id) => ({
      key: id, kind: 'player' as const, displayName: 'Synthetic availability player', nflTeam: homeTeam,
      providerIds: [{ provider: 'sleeper', externalId: id }],
    }))));
    expect(identities.every((identity) => identity.entityId !== null && !identity.conflict)).toBe(true);
    const gameId = `availability-game-${randomUUID()}`;
    const kickoffAt = new Date(Date.now() + 3_600_000).toISOString();
    stored(await f.store.upsertNflGames([{
      key: gameId, provider: 'tank01', externalGameId: gameId, ...f.period,
      homeTeam, awayTeam, kickoffAt,
    }]));
    const teams: Team[] = [1, 2].map((id) => ({
      id, managerName: `Synthetic manager ${id}`, name: `Synthetic team ${id}`, avatar: null,
      wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
    }));
    const activityWindows = [{
      startsAt: new Date(Date.parse(kickoffAt) - 7_200_000).toISOString(),
      endsAt: new Date(Date.parse(kickoffAt) + 25_200_000).toISOString(),
    }];

    async function observe(recovered: boolean) {
      const lineup = await calculateLineupRevision({
        leagueRef, period,
        shape: { expectedRosterCount: 2, expectedStarterSlotCount: 1,
          expectedRosterRefs: ['1', '2'].map((id) => externalRosterRef(leagueRef, id)) },
        rows: ['1', '2'].map((id, index) => ({
          rosterRef: externalRosterRef(leagueRef, id), matchupRef: externalMatchupRef(leagueRef, period, '1'),
          starters: index === 1 && !recovered ? null : [externalLineupEntryRef(leagueRef, playerIds[index])],
        })),
      });
      await f.acceptWatch(lineup.lineupRevision);
      const at = await databaseTime();
      const availability = { version: 'lineup-availability-v1',
        availableRosterIds: recovered ? ['1', '2'] : ['1'], unavailableRosterIds: recovered ? [] : ['2'] };
      const input: LeagueWeekObservationInput = {
        leagueSeasonId: f.league.leagueSeasonId, week: f.period.week, sourceRevision: randomUUID(),
        requestStartedAt: at, requestCompletedAt: at, observedAt: at, quality: 'complete',
        lineupRevisionVersion: lineup.revisionVersion, lineupRevision: lineup.lineupRevision,
        sourceData: { rosterIds: ['1', '2'], lineupAvailability: availability },
        expectedTank01GameIds: [gameId],
        playerPoints: playerIds.flatMap((id, index) => index === 1 && !recovered ? [] : [{
          sleeperPlayerId: id, entityKind: 'player' as const, externalRosterId: String(index + 1),
          points: index === 0 ? knownPoints : 0, isStarter: true, lineupSlot: 'QB',
        }]),
        rosterPoints: [{ externalRosterId: '1', points: knownPoints },
          { externalRosterId: '2', points: recovered ? 0 : null }],
      };
      const observation = stored(await f.store.recordLeagueWeekObservation(input));
      const game = stored(await f.store.recordGameStates({ provider: 'tank01', states: [{
        externalGameId: gameId, sourceRevision: randomUUID(), requestStartedAt: at,
        requestCompletedAt: at, observedAt: at, statusCode: 0, period: null,
        gameClock: null, homeScore: null, awayScore: null, sourceData: {},
      }] }))[0];
      const payload: MatchupsData = {
        league: { season: '2026', rosterPositions: ['QB'], week: f.period.week, maxWeek: 18 },
        teams, updatedAt: at, week: f.period.week,
        matchups: [{ id: '1', status: recovered ? 'upcoming' : 'unknown', sides: teams.map((team, index) => {
          const available = index === 0 || recovered;
          const points = index === 0 ? knownPoints : recovered ? 0 : null;
          const projectedPoints = index === 0 ? 18.25 : available ? 16.5 : null;
          return { team, points, projectedPoints, starters: available ? [{
            id: playerIds[index], name: 'Synthetic availability player', position: 'QB', nflTeam: homeTeam,
            injuryStatus: null, slot: 'QB', points, projectedPoints,
            game: { kind: 'scheduled', opponent: awayTeam, location: 'home', date: 'Synthetic kickoff', kickoffAt },
          }] : [] };
        }) }],
      };
      const publication: PublishSnapshotInput = {
        leagueSeasonId: f.league.leagueSeasonId, week: f.period.week, modelVersion: 'clock-v1',
        revisionKey: createHash('sha256').update(input.sourceRevision).digest('hex'),
        leagueWeekObservationId: observation.observationId, gameStateObservationIds: [game.observationId],
        calculatedAt: at, payload, activityWindows, lineupFence: f.fence,
      };
      return { input, observation, availability, publication, payload };
    }

    const unavailable = await observe(false);
    expect(unavailable.observation).toMatchObject({ playerPointsStored: 1, rosterPointsStored: 2,
      expectedGamesStored: 1, unmappedSleeperPlayerIds: [], unmappedTank01GameIds: [] });
    expect(stored(await f.store.recordLeagueWeekObservation(unavailable.input))).toEqual(unavailable.observation);
    const first = await f.store.publishSnapshot(unavailable.publication);
    if (first.kind !== 'published') throw new Error('Unavailable-side fixture was not published.');
    expect(first.snapshot.payload).toEqual(unavailable.payload);
    const now = new Date(await databaseTime());
    const full = await readStoredMatchups(f.leagueKey, f.period.week, { store: f.store, now });
    const compact = await readStoredMatchupRevision(f.leagueKey, f.period.week, { store: f.store, now });
    expect(full.kind).toBe('usable');
    expect(compact.kind).toBe('usable');
    if (full.kind !== 'usable' || compact.kind !== 'usable') throw new Error('Stored unavailable-side readers disagreed.');
    expect(full.payload).toEqual(unavailable.payload);
    expect(compact).not.toHaveProperty('payload');
    expect(compact.snapshotRevision).toBe(full.snapshotRevision);
    expect(compact.verifiedAt).toBe(full.verifiedAt);
    expect(compact.context).toEqual(full.context);
    expect(full.context).toMatchObject({ activeWeek: f.period.week, temporalState: 'active', refreshDue: false });
    expect(full.payload.matchups[0].sides[1]).toMatchObject({ points: null, projectedPoints: null, starters: [] });
    expect((await ownerQuery(`SELECT source_data->'lineupAvailability' AS availability
      FROM league_week_observations WHERE id=$1`, [unavailable.observation.observationId]))[0].availability)
      .toEqual(unavailable.availability);
    expect((await ownerQuery(`SELECT external_roster_id, points::text AS points
      FROM official_roster_point_observations WHERE league_week_observation_id=$1 ORDER BY external_roster_id`,
    [unavailable.observation.observationId]))).toEqual([
      { external_roster_id: '1', points: knownPoints === null ? null : '8' },
      { external_roster_id: '2', points: null },
    ]);
    expect((await ownerQuery(`SELECT external_roster_id, points::text AS points, is_starter, lineup_slot
      FROM official_player_point_observations WHERE league_week_observation_id=$1`,
    [unavailable.observation.observationId]))).toEqual([
      { external_roster_id: '1', points: knownPoints === null ? null : '8', is_starter: true, lineup_slot: 'QB' },
    ]);

    const repeated = await observe(false);
    expect(repeated.input.lineupRevision).toBe(unavailable.input.lineupRevision);
    const reverified = await f.store.publishSnapshot(repeated.publication);
    expect(reverified.kind).toBe('unchanged');
    if (reverified.kind !== 'unchanged') throw new Error('Unchanged unavailable-side content duplicated its snapshot.');
    expect(reverified.snapshot.snapshotId).toBe(first.snapshot.snapshotId);

    const recovered = await observe(true);
    expect(recovered.input.lineupRevision).not.toBe(unavailable.input.lineupRevision);
    const final = await f.store.publishSnapshot(recovered.publication);
    if (final.kind !== 'published') throw new Error('Recovered lineup did not publish a new snapshot.');
    expect(final.snapshot.snapshotId).not.toBe(first.snapshot.snapshotId);
    expect(final.snapshot.payload.matchups[0].sides[0]).toEqual(first.snapshot.payload.matchups[0].sides[0]);
    expect(final.snapshot.payload.matchups[0].sides[1]).toMatchObject({ points: 0, projectedPoints: 16.5 });
    expect(final.snapshot.payload.matchups[0].sides[1].starters).toHaveLength(1);
    if (f.fence.ownerLane !== 'current') throw new Error('Fixture must use the current lane.');
    expect(await f.store.acknowledgeCurrentLineup({
      leagueKey: f.leagueKey, period: f.period, modelVersion: 'clock-v1', sourceRevision: recovered.input.sourceRevision,
      lineupRevisionVersion: 'lineup-v1', lineupRevision: recovered.input.lineupRevision!,
      snapshotRevision: final.snapshot.revisionKey, fence: f.fence,
    })).toEqual({ kind: 'updated' });

    const oldHistory = (await ownerQuery(`SELECT payload, league_week_observation_id
      FROM projection_snapshots WHERE id=$1`, [first.snapshot.snapshotId]))[0];
    expect(oldHistory).toEqual({ payload: unavailable.payload,
      league_week_observation_id: unavailable.observation.observationId });
    expect((await ownerQuery(`SELECT snapshot_id, verification_source_observation_id
      FROM current_projection_snapshots WHERE league_season_id=$1 AND week=$2`,
    [f.league.leagueSeasonId, f.period.week]))[0]).toEqual({ snapshot_id: final.snapshot.snapshotId,
      verification_source_observation_id: recovered.observation.observationId });
    expect((await ownerQuery(`SELECT count(*)::integer AS snapshots FROM projection_snapshots
      WHERE league_season_id=$1 AND week=$2`, [f.league.leagueSeasonId, f.period.week]))[0].snapshots).toBe(2);
    expect((await ownerQuery(`SELECT pending_since, last_materialized_lineup_revision
      FROM league_week_lineup_watch_states WHERE id=$1`, [f.watchId]))[0])
      .toMatchObject({ pending_since: null, last_materialized_lineup_revision: recovered.input.lineupRevision });

    // The owner can reach the physical trigger; rollback preserves this fixture even if it fails.
    const mutation = await createPinnedIntegrationDatabase('owner');
    try {
      await mutation.database.query('BEGIN');
      await expect(mutation.database.query(`UPDATE projection_snapshots SET payload=$2::jsonb WHERE id=$1`,
        [first.snapshot.snapshotId, JSON.stringify(recovered.payload)])).rejects.toThrow(/immutable/iu);
    } finally {
      await mutation.database.query('ROLLBACK');
      await mutation.close();
    }
  });
});
