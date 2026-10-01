import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBundleFourReader } from '../lib/aggregator/bundle-four-reader';
import { compareFrozenHistoricalContinuity, type BundleFourReadInput } from '../lib/aggregator/bundle-four';
import { createPageAdministrationReader } from '../lib/page-source';
import { buildManagerHistory, type ManagerHistorySeason } from '../lib/manager-history';
import { normalizeTeams, type SleeperRoster, type SleeperUser, type SleeperMatchup } from '../lib/transform';
import type { DatabaseClient, DatabaseRow, DatabaseQueryOptions } from '../lib/database';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { b4Rosters, b4WeeklyRows, closeB4Fixture, createB4Fixture, type B4Fixture } from './b4-acceptance-fixture';

/** Only the existing guarded disposable suite executes these real restricted-store cases. */
describe.sequential('B4 retained historical continuity through the guarded real store', () => {
  let connection: IndependentDatabase, f: B4Fixture;
  beforeAll(async () => { connection = createIndependentDatabase(); f = await createB4Fixture(connection.database); });
  beforeEach(async () => { await f.seed(); });
  afterAll(async () => closeB4Fixture(f, connection));

  async function read(overrides: Partial<BundleFourReadInput> = {}) {
    const queries: string[] = [];
    const database: DatabaseClient = { enabled: true,
      async query<Row extends DatabaseRow>(statement: string, parameters: readonly unknown[] = [], options?: DatabaseQueryOptions) {
        queries.push(statement);
        expect(statement).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CALL)\b/iu);
        return connection.database.query<Row>(statement, parameters, options);
      },
    };
    const before = await f.fingerprint(), request = await f.request(overrides);
    const result = await createBundleFourReader(database).readBundleFour(request);
    expect(await f.fingerprint()).toEqual(before);
    if (result.status !== 'read' || result.history.status !== 'available') throw new Error(`Missing B4 SQL history: ${JSON.stringify(result)}`);
    return { ...result, history: result.history, queries, request };
  }

  it('reads exact annual source/team identities and compares existing history using the same retained captures', async () => {
    const [role] = await connection.database.query(`SELECT current_user AS name,rolsuper,rolcreatedb,rolcreaterole
      FROM pg_roles WHERE rolname=current_user`);
    expect(role).toEqual({ name: 'league_one_runtime', rolsuper: false, rolcreatedb: false, rolcreaterole: false });
    const { history, frozen, queries } = await read();
    expect(history).toMatchObject({ historyCompleteness: 'complete', identityCompleteness: 'complete', seasons: [
      { throughWeek: 0, predecessor: { status: 'verified', leagueSeasonId: (await f.mapping(2025)).leagueSeasonId } },
      { throughWeek: 2, predecessor: { status: 'outside-range' }, weeks: [
        { scores: [{ rawPoints: 1.004, effectivePoints: 1.004, compatibilityResult: 'tie' }, { rawPoints: 1.003 }] },
        { scores: [{ rawPoints: -2, customPoints: 0, effectivePoints: 0, compatibilityResult: 'tie' }, {}] },
      ] },
    ] });
    const sameCapture: ManagerHistorySeason[] = frozen.input.seasons.map(season => {
      if (season.rosters.status !== 'available' || season.users.status !== 'available') throw new Error('Missing same-capture history.');
      const rosters = season.rosters.envelope.payload as unknown as SleeperRoster[];
      return { season: season.mapping.scope.season, externalLeagueId: season.mapping.scope.externalLeagueId,
        rosters, teams: normalizeTeams(rosters, season.users.envelope.payload as unknown as SleeperUser[]),
        throughWeek: season.throughWeek, rows: season.matchups.map(row => row.status === 'available'
          ? row.envelope.payload as unknown as SleeperMatchup[] : null) };
    });
    expect(history.compatibility).toEqual(buildManagerHistory(sameCapture, 2026, 'league2'));
    expect(history.compatibility.managers).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerId: 'b4-new-owner', currentTeamId: 1, wins: 0, losses: 0, ties: 0, seasons: [2026] }),
      expect.objectContaining({ ownerId: 'b4-old-owner', currentTeamId: null, wins: 0, losses: 0, ties: 2, seasons: [2025] }),
    ]));
    expect(history.seasons[0].teams[0].seasonTeamId).not.toBe(history.seasons[1].teams[0].seasonTeamId);
    expect(history.seasons[1].teams[0]).toMatchObject({ providerAttribution: { owner: { nativeId: 'b4-old-owner' } },
      identityEvidence: { mappingProof: 'original-observation', sourceMappingRevisionId: (await f.mapping(2025)).revisionId } });
    expect(queries.filter(query => query.includes('league-administration:read-source */'))).toHaveLength(16);
  });

  it('retains accepted history after a partial incoming population and leaves the incomplete observation visible', async () => {
    const before = await read();
    const partial = await f.capture(2025, 'rosters', b4Rosters(2025).slice(0, 1), null, 'partial');
    expect(partial.result.results[0].result.status).toBe('rejected');
    const after = await read();
    expect(after.history.compatibility).toEqual(before.history.compatibility);
    expect(after.history.seasons[1].weeks).toEqual(before.history.seasons[1].weeks);
    const acceptedBefore = before.history.seasons[1].sources.find(source => source.family === 'rosters')!;
    const acceptedAfter = after.history.seasons[1].sources.find(source => source.family === 'rosters')!;
    expect(acceptedAfter).toMatchObject({ observationId: acceptedBefore.observationId,
      rawContentHash: acceptedBefore.rawContentHash, verifiedAt: acceptedBefore.verifiedAt, provenance: acceptedBefore.provenance });
    expect(acceptedAfter.generation).toBeGreaterThan(acceptedBefore.generation);
    const mapping = await f.mapping(2025);
    expect(await ownerQuery(`SELECT content.completeness FROM league_administration_heads head
      JOIN league_administration_observations observation ON observation.id=head.latest_observation_id
      JOIN league_administration_contents content ON content.id=observation.content_id
      WHERE head.league_season_id=$1 AND head.family='rosters'`, [mapping.leagueSeasonId]))
      .toEqual([{ completeness: 'partial' }]);
  });

  it('withholds combined records for missing official scores and ambiguous historical ownership', async () => {
    await f.capture(2025, 'matchups', [{ roster_id: 1, matchup_id: 1, points: null }, { roster_id: 2, matchup_id: 1, points: 7 }], 1);
    const missing = await read();
    expect(missing.history).toMatchObject({ historyCompleteness: 'partial', seasons: [{}, { weeks: [
      { completeness: 'unavailable', scores: [{ rawPoints: null, effectivePoints: null, compatibilityResult: null }, {}] }, {}] }] });
    expect(missing.history.compatibility.managers.every(manager => manager.wins === null)).toBe(true);
    const rosters = b4Rosters(2025); rosters[1] = { ...rosters[1], owner_id: 'b4-old-owner' };
    await f.capture(2025, 'rosters', rosters);
    const ambiguous = await read();
    expect(ambiguous.history.historyCompleteness).toBe('partial');
    expect(ambiguous.history.compatibility.warning).toContain('incomplete or ambiguous');
  });

  it('requires post-completion verification, preserves prior provenance, and retains the existing page reader', async () => {
    const earlier = await f.capture(2025, 'matchups', b4WeeklyRows(1), 1);
    if (earlier.read.status !== 'available') throw new Error('Missing prior B4 observation.');
    const changedLeague = { ...f.league(2025), name: `New completed source ${randomUUID()}` };
    await f.capture(2025, 'league', changedLeague);
    const unverified = await read();
    expect(unverified.history.historyCompleteness).toBe('partial');
    expect(unverified.history.seasons[1].weeks[0].scores).toEqual([]);
    for (const family of ['rosters', 'users'] as const) {
      const mapping = await f.mapping(2025), retained = await f.administration.readSource({ ...mapping.scope, family, week: null });
      if (retained.status !== 'available') throw new Error('Missing B4 reverified document.');
      await f.capture(2025, family, retained.envelope.payload);
    }
    const verified = await f.capture(2025, 'matchups', b4WeeklyRows(1), 1);
    await f.capture(2025, 'matchups', b4WeeklyRows(2), 2);
    if (verified.read.status !== 'available') throw new Error('Missing verified B4 observation.');
    expect(verified.read.observationId).toBe(earlier.read.observationId);
    expect(verified.read.envelope.provenance.requestCompletedAt).toBe(earlier.read.envelope.provenance.requestCompletedAt);
    expect(Date.parse(verified.read.verifiedAt!)).toBeGreaterThan(Date.parse(earlier.read.verifiedAt!));
    const accepted = await read();
    expect(accepted.history.historyCompleteness).toBe('complete');
    const pageRead = createPageAdministrationReader(() => f.administration, () => accepted.request.now.getTime());
    expect(await pageRead({ ...(await f.mapping(2025)).scope, family: 'matchups', week: 1, historicalSeason: true }))
      .toMatchObject({ status: 'available', payload: b4WeeklyRows(1),
        requestCompletedAt: earlier.read.envelope.provenance.requestCompletedAt });
  });

  it('keeps a frozen correction comparison reproducible across serialization and accepted-head changes', async () => {
    const initial = await read(), serialized = JSON.parse(JSON.stringify(initial.frozen));
    const originalSource = initial.history.seasons[1].sources.find(source => source.family === 'matchups' && source.week === 1)!;
    const oldRow = await ownerQuery(`SELECT to_jsonb(observation) AS observation,to_jsonb(content) AS content
      FROM league_administration_observations observation JOIN league_administration_contents content ON content.id=observation.content_id
      WHERE observation.id=$1`, [originalSource.observationId]);
    const correction = b4WeeklyRows(1); correction[0] = { ...correction[0], custom_points: 0 };
    await f.capture(2025, 'matchups', correction, 1);
    const changed = await read();
    expect(changed.history.compatibility.managers.find(manager => manager.ownerId === 'b4-old-owner'))
      .toMatchObject({ wins: 0, losses: 1, ties: 1 });
    const before = await f.fingerprint();
    expect(compareFrozenHistoricalContinuity(serialized)).toEqual(initial.history);
    expect(compareFrozenHistoricalContinuity(JSON.parse(JSON.stringify(changed.frozen)))).toEqual(changed.history);
    expect(await f.fingerprint()).toEqual(before);
    expect(await ownerQuery(`SELECT to_jsonb(observation) AS observation,to_jsonb(content) AS content
      FROM league_administration_observations observation JOIN league_administration_contents content ON content.id=observation.content_id
      WHERE observation.id=$1`, [originalSource.observationId])).toEqual(oldRow);
  });

  it('does not use an expired current receipt or unsupported season settings to fill a combined record', async () => {
    const request = await f.request();
    const stale = await read({ now: new Date(request.now.getTime() + 61_000) });
    expect(stale.history.historyCompleteness).toBe('partial');
    expect(stale.history.compatibility.managers.every(manager => manager.wins === null)).toBe(true);
    const league = f.league(2025);
    await f.capture(2025, 'league', { ...league, settings: { ...(league.settings as object), league_average_match: 1 } });
    const unsupported = await read();
    expect(unsupported.history.historyCompleteness).toBe('partial');
    expect(unsupported.history.compatibility.warning).toContain('unsupported extra-match');
  });

  it('fences a real source remap while retaining immutable observations and the frozen rollback comparison', async () => {
    const initial = await read(), mapping = await f.mapping(2026), request = await f.request();
    const replacement = `997${BigInt(`0x${randomUUID().replaceAll('-', '')}`).toString()}`;
    let mappingReads = 0;
    const database: DatabaseClient = { enabled: true,
      async query<Row extends DatabaseRow>(statement: string, parameters: readonly unknown[] = [], options?: DatabaseQueryOptions) {
        const rows = await connection.database.query<Row>(statement, parameters, options);
        if (statement.includes('league-administration:read-source-mapping') && ++mappingReads === 1) {
          await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'synthetic B4 concurrent remap')",
            [mapping.leagueSeasonId, mapping.revisionId, replacement]);
        }
        return rows;
      },
    };
    try {
      expect(await createBundleFourReader(database).readBundleFour(request))
        .toEqual({ status: 'unavailable', reason: 'historical_mapping_changed' });
      expect(compareFrozenHistoricalContinuity(JSON.parse(JSON.stringify(initial.frozen)))).toEqual(initial.history);
    } finally {
      const revised = await f.administration.readSourceMapping(replacement);
      if (!revised) throw new Error('Missing synthetic B4 remap restore mapping.');
      await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'restore synthetic B4 source')",
        [mapping.leagueSeasonId, revised.revisionId, f.externalIds[2026]]);
    }
  });
});
