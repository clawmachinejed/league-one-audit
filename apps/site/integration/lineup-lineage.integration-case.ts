import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { databaseTime, lineageFixture, LINEUP_A, LINEUP_B, LINEUP_C } from './lineup-lineage-fixture';

describe.sequential('atomic lineup provenance and materialization in isolated Neon', () => {
  let database: IndependentDatabase;
  beforeAll(() => { database = createIndependentDatabase(); });
  afterAll(async () => { await database.close(); });

  it('requires exact official observation replay lineage and request timestamps', async () => {
    const f = await lineageFixture(database);
    const source = await f.observe();
    await expect(f.store.recordLeagueWeekObservation(source.input)).resolves.toMatchObject({ kind: 'stored', value: source.value });
    await expect(f.store.recordLeagueWeekObservation({ ...source.input, lineupRevision: LINEUP_C })).rejects.toThrow();
    await expect(f.store.recordLeagueWeekObservation({ ...source.input,
      requestStartedAt: new Date(Date.parse(source.input.requestStartedAt) - 1000).toISOString() })).rejects.toThrow();
  });

  it('rejects absent and stale publication fences; current acknowledgment proves the exact source', async () => {
    const f = await lineageFixture(database);
    const source = await f.observe();
    expect(await f.publish(source, null)).toMatchObject({ kind: 'rejected' });
    expect(await f.publish(source, { ...f.fence, watchGeneration: 2 })).toMatchObject({ kind: 'rejected' });
    const result = await f.publish(source);
    if (result.kind !== 'published') throw new Error('Fenced snapshot was not published.');
    if (f.fence.ownerLane !== 'current') throw new Error('Incorrect fixture lane.');
    const input = { ...f.acknowledgeInput(source, result.snapshot.revisionKey), fence: f.fence };
    expect(await f.store.acknowledgeCurrentLineup({ ...input, sourceRevision: 'wrong-source' })).toEqual({ kind: 'stale' });
    expect(await f.store.acknowledgeCurrentLineup({ ...input, lineupRevision: LINEUP_C })).toEqual({ kind: 'stale' });
    expect(await f.store.acknowledgeCurrentLineup(input)).toEqual({ kind: 'updated' });
    expect((await ownerQuery('SELECT pending_since, last_materialized_lineup_revision FROM league_week_lineup_watch_states WHERE id=$1', [f.watchId]))[0])
      .toMatchObject({ pending_since: null, last_materialized_lineup_revision: LINEUP_B });
  });

  it('advances unchanged verification provenance without modifying historical snapshot source', async () => {
    const f = await lineageFixture(database);
    const firstSource = await f.observe();
    const first = await f.publish(firstSource);
    if (first.kind !== 'published') throw new Error('First snapshot was not published.');
    const laterSource = await f.observe();
    const later = await f.publish(laterSource);
    if (later.kind !== 'unchanged') throw new Error('Equal content created a new snapshot.');
    expect(later.snapshot.snapshotId).toBe(first.snapshot.snapshotId);
    const rows = await ownerQuery(`SELECT current.verification_source_observation_id, snapshot.league_week_observation_id
      FROM current_projection_snapshots current JOIN projection_snapshots snapshot ON snapshot.id=current.snapshot_id
      WHERE current.league_season_id=$1 AND current.week=$2`, [f.league.leagueSeasonId, f.period.week]);
    expect(rows[0]).toMatchObject({ verification_source_observation_id: laterSource.value.observationId,
      league_week_observation_id: firstSource.value.observationId });
    if (f.fence.ownerLane !== 'current') throw new Error('Incorrect fixture lane.');
    expect(await f.store.acknowledgeCurrentLineup({ ...f.acknowledgeInput(firstSource, first.snapshot.revisionKey), fence: f.fence })).toEqual({ kind: 'stale' });
    expect(await f.store.acknowledgeCurrentLineup({ ...f.acknowledgeInput(laterSource, later.snapshot.revisionKey), fence: f.fence })).toEqual({ kind: 'updated' });
  });

  it('rejects authority rollover, expired global ownership and retired-watch bypasses', async () => {
    const f = await lineageFixture(database);
    const source = await f.observe();
    await ownerQuery('UPDATE league_period_authorities SET authority_generation=authority_generation+1 WHERE league_key=$1', [f.leagueKey]);
    expect(await f.publish(source)).toMatchObject({ kind: 'rejected' });
    await ownerQuery('UPDATE league_period_authorities SET authority_generation=1 WHERE league_key=$1', [f.leagueKey]);
    await ownerQuery("UPDATE projection_jobs SET lease_until=now()-interval '1 second' WHERE job_key='live-projection-sync'");
    expect(await f.publish(source)).toMatchObject({ kind: 'rejected' });
    await ownerQuery(`UPDATE league_week_lineup_watch_states SET retired_at=now(), retirement_reason='completed',
      watch_class='completed', materialization_lane=NULL, next_check_at=NULL, pending_since=NULL WHERE id=$1`, [f.watchId]);
    expect(await f.publish(source, null)).toMatchObject({ kind: 'rejected' });
  });

  it('acknowledges actual B while a newer C remains immediately due', async () => {
    const f = await lineageFixture(database, 'future');
    const source = await f.observe(LINEUP_B);
    await f.acceptWatch(LINEUP_C);
    const result = await f.publish(source);
    if (result.kind !== 'published') throw new Error('Older valid full load was blocked by newer pending lineup.');
    expect(await f.store.completeFutureMaterializationAndAcknowledgeLineup(await f.fullAckInput(source, result.snapshot.revisionKey)))
      .toMatchObject({ kind: 'updated' });
    const rows = await ownerQuery(`SELECT watch.latest_lineup_revision, watch.last_materialized_lineup_revision,
      watch.pending_since IS NOT NULL AS pending, materialization.next_refresh_at<=now() AS due,
      materialization.active_attempt_id FROM league_week_lineup_watch_states watch
      JOIN league_week_materialization_states materialization USING(league_key,season,season_type,week)
      WHERE watch.id=$1`, [f.watchId]);
    expect(rows[0]).toMatchObject({ latest_lineup_revision: LINEUP_C, last_materialized_lineup_revision: LINEUP_B,
      pending: true, due: true, active_attempt_id: null });
  });

  it('uses actual full C instead of labeling it as the claim target B', async () => {
    const f = await lineageFixture(database, 'future');
    await f.acceptWatch(LINEUP_C);
    const source = await f.observe(LINEUP_C);
    const result = await f.publish(source);
    if (result.kind !== 'published') throw new Error('Full C publication failed.');
    const input = await f.fullAckInput(source, result.snapshot.revisionKey);
    expect(await f.store.completeFutureMaterializationAndAcknowledgeLineup({ ...input, lineupRevision: LINEUP_B })).toEqual({ kind: 'stale' });
    expect((await ownerQuery('SELECT active_attempt_id FROM league_week_materialization_states WHERE league_key=$1', [f.leagueKey]))[0].active_attempt_id).toBe(f.attemptId);
    expect(await f.store.completeFutureMaterializationAndAcknowledgeLineup(input)).toMatchObject({ kind: 'updated' });
    expect((await ownerQuery('SELECT pending_since,last_materialized_lineup_revision FROM league_week_lineup_watch_states WHERE id=$1', [f.watchId]))[0])
      .toMatchObject({ pending_since: null, last_materialized_lineup_revision: LINEUP_C });
  });

  it('reopens A after A-to-B-to-A cleared pending while full B was in flight', async () => {
    const f = await lineageFixture(database, 'future');
    await ownerQuery(`UPDATE league_week_lineup_watch_states SET last_materialized_lineup_revision=$2,
      last_materialized_snapshot_revision='prior-A', last_materialized_verified_at=now()-interval '1 minute'
      WHERE id=$1`, [f.watchId, LINEUP_A]);
    const source = await f.observe(LINEUP_B);
    await f.acceptWatch(LINEUP_A);
    expect((await ownerQuery('SELECT pending_since FROM league_week_lineup_watch_states WHERE id=$1', [f.watchId]))[0].pending_since).toBeNull();
    const result = await f.publish(source);
    if (result.kind !== 'published') throw new Error('Full B publication failed.');
    expect(await f.store.completeFutureMaterializationAndAcknowledgeLineup(await f.fullAckInput(source, result.snapshot.revisionKey))).toMatchObject({ kind: 'updated' });
    expect((await ownerQuery(`SELECT pending_since IS NOT NULL AS pending,last_materialized_lineup_revision
      FROM league_week_lineup_watch_states WHERE id=$1`, [f.watchId]))[0])
      .toMatchObject({ pending: true, last_materialized_lineup_revision: LINEUP_B });
  });

  it('does not apply B failure backoff to newer C and rejects backdated expired leases', async () => {
    const f = await lineageFixture(database, 'future');
    await f.acceptWatch(LINEUP_C);
    expect(await f.store.failFutureMaterializationRefresh({ leagueKey: f.leagueKey, projectionProvider: 'tank01',
      normalizerVersion: f.normalizerVersion, modelVersion: 'clock-v1', period: f.period,
      attemptId: f.attemptId, failedAt: await databaseTime(), failureCode: 'snapshot-rejected' }))
      .toMatchObject({ kind: 'updated', consecutiveFailures: 0 });
    expect((await ownerQuery('SELECT next_refresh_at<=now() AS due FROM league_week_materialization_states WHERE league_key=$1', [f.leagueKey]))[0].due).toBe(true);
    const expired = await lineageFixture(database, 'future');
    const source = await expired.observe();
    const result = await expired.publish(source);
    if (result.kind !== 'published') throw new Error('Expiration fixture publication failed.');
    await ownerQuery(`UPDATE league_week_materialization_states SET active_attempt_started_at=now()-interval '2 minutes',
      last_attempted_at=now()-interval '2 minutes', active_attempt_expires_at=now()-interval '1 minute'
      WHERE league_key=$1`, [expired.leagueKey]);
    const input = await expired.fullAckInput(source, result.snapshot.revisionKey);
    expect(await expired.store.completeFutureMaterializationAndAcknowledgeLineup({ ...input, completedAt: source.input.observedAt })).toEqual({ kind: 'stale' });
    expect(await expired.publish(source)).toMatchObject({ kind: 'rejected' });
  });
});
