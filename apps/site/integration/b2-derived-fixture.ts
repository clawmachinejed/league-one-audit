import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseClient } from '../lib/database';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import { createProjectionStore, type PublishSnapshotInput } from '../lib/projection-store';
import { translateSleeperLineupObservation } from '../lib/projections/adapters/sleeper/lineup-observation';
import { calculateLineupRevision } from '../lib/projections/domain/lineup-revision';
import { externalLeagueRef, externalRosterRef } from '../lib/projections/shared/provider-identity';
import type { SleeperMatchup } from '../lib/transform';
import type { League, MatchupsData, Player, Team } from '../lib/types';
import { ownerQuery } from './neon-integration-harness';

type DerivedInput = Readonly<{
  database: DatabaseClient;
  mapping: AdministrationSourceMapping;
  leagueSeasonId: string;
  league: League;
  week: 4;
  rows: readonly SleeperMatchup[];
  at: string;
  source: Readonly<{
    observationId: string;
    configurationVersionId: string;
    generation: number;
    sourceCapture: Readonly<{ captureId: string; leagueInputId: string; matchupInputId: string }>;
  }>;
}>;

const kickoffAt = '2026-10-04T17:00:00.000Z';

/** Synthetic ownership setup follows exact-matchup-compatibility.integration-case.ts.
 * The existing harness guards every ownerQuery; publication still uses the restricted store. */
async function publicationFence(input: DerivedInput): Promise<PublishSnapshotInput['lineupFence']> {
  const watchId = randomUUID(), runId = randomUUID();
  const rosterIds = input.rows.map(row => String(row.roster_id));
  await ownerQuery(`INSERT INTO league_period_authorities
    (league_key,default_season,default_season_type,default_week,active_season,active_season_type,active_week,
      league_lifecycle,nfl_phase,source_provider,source_revision,source_observed_at,verified_at,source_external_league_id,
      expected_roster_count,expected_starter_slot_count,expected_roster_ids)
    VALUES($1,2026,'reg',4,2026,'reg',4,'active','regular','sleeper','synthetic-b2',now(),now(),$2,2,2,$3::text[])`,
  [input.mapping.scope.leagueKey, input.mapping.scope.externalLeagueId, rosterIds]);
  await ownerQuery(`INSERT INTO league_week_lineup_watch_states
    (id,league_key,source_provider,external_league_id,season,season_type,week,lineup_revision_version,cadence_policy_version,
      authority_generation,watch_class,materialization_lane,phase,expected_roster_count,expected_starter_slot_count,expected_roster_ids,next_check_at)
    VALUES($1,$2,'sleeper',$3,2026,'reg',4,'lineup-v1','lineup-cadence-v1',1,'current','current',0,2,2,$4::text[],now())`,
  [watchId, input.mapping.scope.leagueKey, input.mapping.scope.externalLeagueId, rosterIds]);
  await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until)
    VALUES('live-projection-sync','projection-sync',now(),'running',$1,now()+interval '5 minutes')
    ON CONFLICT(job_key) DO UPDATE SET state='running',lease_owner=$1,lease_until=now()+interval '5 minutes'`, [runId]);
  return { watchId, watchGeneration: 1, authorityGeneration: 1, ownerLane: 'current', runId };
}

function snapshotPayload(input: DerivedInput): MatchupsData {
  const teams: Team[] = input.rows.map(row => ({ id: row.roster_id, managerName: `Snapshot Manager ${row.roster_id}`,
    name: `Snapshot Team ${row.roster_id}`, avatar: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }));
  return { league: input.league, teams, week: input.week, updatedAt: input.at,
    matchups: [{ id: String(input.rows[0].matchup_id), status: 'upcoming',
      // Deliberately reverse the display order: the derived join must use roster identity.
      sides: input.rows.map((row, index) => {
        const projectedPoints = index === 0 ? 13.25 : 17.5;
        const starter: Player = { id: row.starters![0], name: `Synthetic Player ${row.starters![0]}`,
          position: 'QB', slot: 'QB', nflTeam: index === 0 ? 'IND' : 'HOU', injuryStatus: null,
          points: row.starters_points?.[0] ?? null, projectedPoints,
          game: { kind: 'scheduled', opponent: index === 0 ? 'HOU' : 'IND',
            location: index === 0 ? 'home' : 'away', date: '2026-10-04', kickoffAt } };
        const empty: Player = { id: 'empty-RB-1', name: 'Empty slot', position: '—', slot: 'RB',
          nflTeam: null, injuryStatus: null, points: null, projectedPoints: null, game: null };
        return { team: teams[index], points: row.custom_points ?? row.points ?? null,
          projectedPoints, starters: [starter, empty] };
      }).reverse() }] };
}

/** Publish linked B1 evidence through the existing real store; never write snapshot tables directly. */
export async function publishB2DerivedSnapshot(input: DerivedInput) {
  if (input.mapping.scope.season !== 2026 || input.mapping.leagueSeasonId !== input.leagueSeasonId
    || input.league.season !== '2026' || input.league.week !== 4 || input.week !== 4
    || input.league.rosterPositions.join(',') !== 'QB,RB' || input.rows.length !== 2
    || input.rows.some((row, index) => row.roster_id !== index + 1 || row.matchup_id === null
      || row.matchup_id !== input.rows[0].matchup_id || row.starters?.length !== 2
      || !/^[1-9]\d*$/u.test(row.starters[0]) || row.starters[1] !== '0')) {
    throw new Error('B2 derived fixture requires its two-team 2026 Week 4 QB/RB capture.');
  }
  const projection = createProjectionStore(input.database);
  const externalGameId = `b2-derived-game-${randomUUID()}`;
  await projection.upsertNflGames([{ key: externalGameId, provider: 'tank01', externalGameId,
    season: 2026, seasonType: 'reg', week: input.week, homeTeam: 'IND', awayTeam: 'HOU', kickoffAt }]);
  const leagueRef = externalLeagueRef('sleeper', input.mapping.scope.externalLeagueId);
  const lineup = translateSleeperLineupObservation(leagueRef, { season: 2026, seasonType: 'regular', week: input.week }, {
    expectedRosterCount: 2, expectedStarterSlotCount: 2,
    expectedRosterRefs: input.rows.map(row => externalRosterRef(leagueRef, String(row.roster_id))),
  }, input.rows);
  if (lineup.status !== 'complete') throw new Error('Invalid B2 synthetic lineup.');
  const revision = await calculateLineupRevision(lineup.observation);
  const official = await projection.recordLeagueWeekObservation({ leagueSeasonId: input.leagueSeasonId, week: input.week,
    sourceRevision: randomUUID(), requestStartedAt: input.at, requestCompletedAt: input.at, observedAt: input.at,
    quality: 'complete', sourceData: { administration: input.source },
    lineupRevisionVersion: revision.revisionVersion, lineupRevision: revision.lineupRevision,
    expectedTank01GameIds: [externalGameId], playerPoints: [],
    rosterPoints: input.rows.map(row => ({ externalRosterId: String(row.roster_id), points: row.custom_points ?? row.points ?? null })) });
  const games = await projection.recordGameStates({ provider: 'tank01', states: [{ externalGameId,
    sourceRevision: randomUUID(), requestStartedAt: input.at, requestCompletedAt: input.at, observedAt: input.at,
    statusCode: 0, period: null, gameClock: null, homeScore: null, awayScore: null, sourceData: {} }] });
  if (official.kind !== 'stored' || games.kind !== 'stored' || games.value.length !== 1) {
    throw new Error('Missing B2 synthetic projection sources.');
  }
  const payload = snapshotPayload(input);
  const published = await projection.publishSnapshot({ lineupFence: await publicationFence(input),
    leagueSeasonId: input.leagueSeasonId, week: input.week, modelVersion: 'clock-v1', revisionKey: randomUUID(),
    leagueWeekObservationId: official.value.observationId, gameStateObservationIds: [games.value[0].observationId],
    calculatedAt: input.at, payload,
    activityWindows: [{ startsAt: '2026-10-04T15:00:00.000Z', endsAt: '2026-10-05T00:00:00.000Z' }] });
  if (published.kind !== 'published' && published.kind !== 'unchanged') {
    throw new Error(`B2 synthetic publication failed: ${published.kind}`);
  }
  return { snapshot: published.snapshot, payload, observationId: official.value.observationId,
    gameObservationId: games.value[0].observationId };
}

/** One committed synthetic raw capture, visible to an independent restricted B2 reader.
 * Populate every prior week when a test requires a qualified position rank. No score publication is claimed. */
export async function seedB2PlayerMetrics(input: Readonly<{
  season: number;
  week: number;
  observedAt: string;
  players: readonly Readonly<{ id: string; receptions: number }>[];
}>) {
  const contentId = randomUUID(), observationId = randomUUID();
  const rawEntries = input.players.map((player, ordinal) => ({ provider_external_id: player.id,
    stats: { rec: player.receptions, gp: 1 }, ordinal }));
  await ownerQuery(`INSERT INTO nfl_games (id,season,season_type,week,home_team,away_team)
    VALUES ($1::uuid,$2::smallint,'reg',$3::smallint,'NE','ATL')
    ON CONFLICT (season,season_type,week,home_team,away_team) DO NOTHING`, [randomUUID(), input.season, input.week]);
  await ownerQuery(`INSERT INTO all_player_stat_contents
    (id,provider,season,season_type,week,normalizer_version,semantic_hash,quality,coverage,warnings,entry_count,created_at)
    VALUES ($1::uuid,'sleeper',$2::smallint,'reg',$3::smallint,'sleeper-weekly-stats-v4',
      $4,'partial','{"complete":false}'::jsonb,'[]'::jsonb,$5::integer,$6::timestamptz)`,
  [contentId, input.season, input.week, createHash('sha256').update(JSON.stringify(rawEntries)).digest('hex'),
    rawEntries.length, input.observedAt]);
  await ownerQuery(`INSERT INTO all_player_stat_entries
    (all_player_stat_content_id,entity_kind,provider_external_id,nfl_game_id,nfl_team,position,stats,
      eligibility_evidence,eligible_game_count,appearance_game_count,game_phase,ordinal,created_at)
    SELECT $1::uuid,'player',entry.provider_external_id,game.id,'NE','QB',entry.stats,
      '{"kind":"weekly-stat","source":"weekly-stat-provider","appearances":1}'::jsonb,
      1,1,'final',entry.ordinal,$5::timestamptz
    FROM jsonb_to_recordset($2::jsonb) entry(provider_external_id text,stats jsonb,ordinal integer)
    JOIN nfl_games game ON game.season=$3::smallint AND game.season_type='reg'
      AND game.week=$4::smallint AND game.home_team='NE' AND game.away_team='ATL'`,
  [contentId, JSON.stringify(rawEntries), input.season, input.week, input.observedAt]);
  await ownerQuery(`INSERT INTO all_player_stat_observations
    (id,all_player_stat_content_id,provider,season,season_type,week,normalizer_version,
      source_revision,request_started_at,request_completed_at,observed_at,quality,created_at)
    VALUES ($1::uuid,$2::uuid,'sleeper',$3::smallint,'reg',$4::smallint,'sleeper-weekly-stats-v4',
      'synthetic-b2-'||$1::text,$5::timestamptz-interval '1 second',$5::timestamptz,$5::timestamptz,
      'partial',$5::timestamptz)`,
  [observationId, contentId, input.season, input.week, input.observedAt]);
  return { contentId, observationId };
}
