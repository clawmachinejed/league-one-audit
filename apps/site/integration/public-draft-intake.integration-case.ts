import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import { createLeagueAdministrationStore, createPublicIntakeStore } from '../lib/league-administration/store';
import { runPublicIntakeStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { PUBLIC_INTAKE_JOB, PUBLIC_DRAFT_PICKS } from '../lib/league-administration/public-intake-contracts';
import { createProjectionStore } from '../lib/projection-store';
import { createIndependentDatabase, type IndependentDatabase } from './neon-integration-harness';

const numericId = () => '8' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));

/** CP19 AUTHORED / HOSTED SQL UNQUALIFIED. Intercepted synthetic source only.
 * One ordinary one-draft intake:10 admissions/11GETs,9 admission gaps and one
 * real minute before zero-GET settlement. No owner-seeded identity/core/tasks.
 * The900s body+two90s hooks allocate1080s of unchanged1800s work; remaining720s
 * covers guarded setup/report/global cleanup. Fit must be measured, not assumed.
 * Source-free receipt replay/pagination and restricted privileges supplement
 * this functional chain. No live source, fleet capacity or process-death proof. */
describe.sequential('ordinary draft and pick intake through restricted PostgreSQL', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationStore>;
  beforeAll(async () => {
    connection = createIndependentDatabase(); administration = createLeagueAdministrationStore(connection.database);
    expect((await connection.database.query('SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user'))[0])
      .toEqual({ current_user: 'league_one_runtime', session_user: 'league_one_runtime', rolsuper: false, rolcreaterole: false, rolcreatedb: false });
  }, 90_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    if (!connection) return;
    try {
      const until = Date.now() + 85_000;
      while (true) {
        const [row] = await connection.database.query("SELECT NOT EXISTS(SELECT 1 FROM public_data_dispatches WHERE admitted_at>clock_timestamp()-interval '60 seconds') AND NOT EXISTS(SELECT 1 FROM projection_jobs WHERE job_key=$1 AND (state='running' OR completed_at>clock_timestamp()-interval '60 seconds')) AS ready", [PUBLIC_INTAKE_JOB]);
        if (row.ready === true) break;
        if (Date.now() >= until) throw new Error('CP19 intake shared-minute cleanup did not settle.');
        await delay(250);
      }
    } finally { await connection.close(); }
  }, 90_000);

  it('acquires one catalog and every native draft endpoint with real admission spacing and immutable stored receipts', async () => {
    const id = randomUUID(), manager = numericId(), external = numericId(), username = 'cp19_intake_' + manager;
    const draftId = 'cp19-' + randomUUID(), league = { league_id: external, season: '2026', sport: 'nfl', name: 'CP19 unrelated synthetic league', total_rosters: 2,
      roster_positions: ['QB', 'BN'], scoring_settings: { rec: 0.5 }, settings: {} };
    const catalog = { draft_id: draftId, league_id: external, season: '2026', sport: 'nfl', type: 'snake', status: 'drafting',
      settings: { teams: 2, rounds: 2 }, start_time: 0, draft_order: { [manager]: 1 }, slot_to_roster_id: { '1': 1, '2': 2 } };
    const detail = { ...catalog, status: 'complete', last_picked: 0 };
    const picks = [{ pick_no: 2, round: 1, draft_slot: 2, roster_id: 2, player_id: 'missing-native-player', picked_by: manager, is_keeper: false, metadata: {} },
      { pick_no: 1, round: 1, draft_slot: 1, roster_id: 1, player_id: '007', is_keeper: true, metadata: null }];
    const trades = [{ season: '2028', round: 2, roster_id: 1, owner_id: 2, previous_owner_id: 1 }];
    const base = 'https://api.sleeper.app/v1/league/' + external, draftBase = 'https://api.sleeper.app/v1/draft/' + draftId, urls: string[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      if (url === 'https://api.sleeper.app/v1/user/' + username) return Response.json({ user_id: manager, username });
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return Response.json([league]);
      if (url === base) return Response.json(league);
      if (url === base + '/drafts') return Response.json([catalog]);
      if (url === base + '/traded_picks') return Response.json(trades);
      if (url === draftBase) return Response.json(detail);
      if (url === draftBase + '/picks') return Response.json(picks);
      if (url === draftBase + '/traded_picks') return Response.json([]);
      if (url === base + '/rosters') return Response.json([1, 2].map(roster_id => ({ roster_id, owner_id: roster_id === 1 ? manager : null,
        co_owners: [], players: [], starters: [], reserve: [], taxi: [] })));
      if (url === base + '/users') return Response.json([{ user_id: manager, display_name: username }]);
      throw new Error('Unexpected CP19 intake endpoint: ' + url);
    });
    const intake = createPublicIntakeStore(connection.database), jobs = createProjectionStore(connection.database);
    let admissions = 0, claims = 0;
    const dependencies: PublicIntakeDependencies = { administration, intake: { ...intake, admit: async (...args) => {
      const admitted = await intake.admit(...args); if (admitted) admissions++; return admitted;
    } }, jobs: { ...jobs, acquireJob: async (...args) => {
      const claim = await jobs.acquireJob(...args); if (claim.kind === 'acquired') claims++; return claim;
    } } };
    async function progress(resource?: string) {
      const until = Date.now() + 100_000;
      do {
        const before = { claims, admissions, requests: urls.length };
        const outcome = await runPublicIntakeStep(id, { ...dependencies, administration: createLeagueAdministrationStore(connection.database) }, AbortSignal.timeout(20_000));
        expect(urls.length - before.requests).toBe(outcome.providerRequests);
        if (outcome.status === 'busy') { expect(claims).toBe(before.claims); expect(admissions).toBe(before.admissions); await delay(1_000); continue; }
        expect(claims - before.claims).toBe(1);
        if (resource) { expect(outcome).toMatchObject({ status: 'progress', resource, providerRequests: resource === 'core' ? 2 : 1 }); expect(admissions - before.admissions).toBe(1); }
        else { expect(outcome).toEqual({ status: 'complete', providerRequests: 0 }); expect(admissions).toBe(before.admissions); }
        return;
      } while (Date.now() < until);
      throw new Error('CP19 ordinary intake exceeded original cadence allowance.');
    }
    try {
      const input = { id, username, seasons: [2026], draftPicks: PUBLIC_DRAFT_PICKS };
      await intake.submit(input); await intake.submit(input);
      await expect(intake.submit({ id, username, seasons: [2026] })).rejects.toThrow();
      for (const invalid of [{ draftPicks: null }, { draftPicks: true }, { draftPicks: 'other' }, { seasons: [2027] }]) {
        await expect(connection.database.query('SELECT public.submit_public_data_intake($1::jsonb)', [JSON.stringify({ ...input, id: randomUUID(), ...invalid })])).rejects.toThrow();
      }
      for (const table of ['public_data_draft_tasks', 'public_data_draft_checkpoints']) {
        expect(await connection.database.query("SELECT has_table_privilege(current_user,$1,'SELECT') AS read,has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS write", ['public.' + table]))
          .toEqual([{ read: true, write: false }]);
      }
      for (const resource of ['identity', 'leagues', 'bootstrap']) await progress(resource);
      expect(await connection.database.query('SELECT resource,status FROM public_data_draft_tasks WHERE intake_id=$1 ORDER BY ordinal', [id]))
        .toEqual([{ resource: 'catalog', status: 'pending' }, { resource: 'league-trades', status: 'pending' }]);
      for (const resource of ['catalog', 'league-trades', 'detail', 'selections', 'draft-trades']) {
        expect(await intake.next(id)).toMatchObject({ kind: 'drafts', resource, externalLeagueId: external, season: 2026 });
        await progress('drafts');
      }
      for (const resource of ['core', 'users']) await progress(resource);
      await progress();
      expect(admissions).toBe(10); expect(claims).toBe(11);
      expect(urls).toEqual(['https://api.sleeper.app/v1/user/' + username,
        'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026', base, base + '/drafts', base + '/traded_picks',
        draftBase, draftBase + '/picks', draftBase + '/traded_picks', base, base + '/rosters', base + '/users']);
      expect(await connection.database.query("WITH ordered AS (SELECT admitted_at,lag(admitted_at) OVER(ORDER BY admitted_at) AS previous FROM public_data_dispatches WHERE intake_id=$1) SELECT count(*)::integer AS admissions,count(previous)::integer AS gaps,bool_and(previous IS NULL OR admitted_at-previous>=interval '60 seconds') AS real_spacing FROM ordered", [id]))
        .toEqual([{ admissions: 10, gaps: 9, real_spacing: true }]);
      fetch.mockRestore();
      const deny = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP19 stored reader attempted acquisition.'));
      const database: DatabaseClient = { enabled: true, query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, values?: readonly unknown[], options?: DatabaseQueryOptions) => {
        expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu); return connection.database.query<Row>(sql, values, options);
      } };
      const store = createLeagueAdministrationStore(database), read = await readPublicSleeperIntake(database, store, id);
      expect(read).toMatchObject({ status: 'available', draftPicks: { collection: 'complete', readCoverage: 'complete',
        summary: { observedLeagues: 1, materializedResources: 5, acquiredResources: 5, pendingResources: 0, unavailableResources: 0 } } });
      if (read.status === 'missing' || !read.drafts) throw new Error('CP19 draft result unavailable.');
      const receipts = new Set<string>();
      const payloads = new Map([['catalog', { metadataVersion: 'sleeper-draft-metadata-v1', kind: 'catalog', catalog: [catalog], details: [], reason: null }],
        ['detail', { metadataVersion: 'sleeper-draft-metadata-v1', kind: 'detail', externalDraftId: draftId, catalog, draft: detail }],
        ['selections', { selectionsVersion: 'sleeper-draft-selections-v1', kind: 'selections', externalDraftId: draftId, catalog, picks }],
        ['league-trades', { tradedPicksVersion: 'sleeper-traded-picks-v1', kind: 'league', tradedPicks: trades }],
        ['draft-trades', { tradedPicksVersion: 'sleeper-traded-picks-v1', kind: 'draft', externalDraftId: draftId, catalog, tradedPicks: [] }]]);
      for (const task of read.drafts) {
        if (task.resource.status !== 'available' || !task.acquisition) throw new Error('Missing original CP19 receipt.');
        receipts.add(task.resource.receiptId);
        expect(task.resource.provenance.acquisition?.work).toMatchObject({ kind: 'drafts', requestId: id, resource: task.resource.value?.kind === 'league' ? 'league-trades'
          : task.resource.value?.kind === 'draft' ? 'draft-trades' : task.resource.value?.kind, externalLeagueId: external });
        const name = read.draftPicks!.tasks.find(entry => entry.ordinal === task.ordinal)!.resource;
        expect(await database.query('SELECT payload FROM league_administration_contents WHERE id=$1', [task.resource.contentId])).toEqual([{ payload: payloads.get(name) }]);
        expect(task.resource.value?.complete).toBe(true);
      }
      expect(receipts.size).toBe(5);
      expect(read.drafts[0].resource).toMatchObject({ value: { kind: 'catalog', totalCount: 1, unrequestedDetailCount: 1 } });
      expect(read.drafts[1].resource).toMatchObject({ value: { entries: [{ pickSeason: { value: '2028' }, currentOwnerId: '2' }] } });
      expect(read.drafts[2].resource).toMatchObject({ value: { detail: { status: { value: 'complete' }, lastPicked: { value: 0 } } } });
      expect(read.drafts[3].resource).toMatchObject({ value: { entries: [{ sourceOrdinal: 0, pickNumber: { value: 2 }, isKeeper: { value: false } },
        { sourceOrdinal: 1, pickNumber: { value: 1 }, isKeeper: { value: true } }] } });
      expect(read.drafts[4].resource).toMatchObject({ value: { totalCount: 0, entries: [] } });
      const pages = [];
      for (const afterOrdinal of [0, 2, 4]) {
        const page = await readPublicSleeperIntake(database, store, id, { draftPicksPage: { afterOrdinal, limit: 2 } });
        if (page.status === 'missing' || !page.drafts) throw new Error('CP19 page unavailable.'); pages.push(...page.drafts);
      }
      expect(pages).toEqual(read.drafts); expect(await intake.next(id)).toBe('complete');
      const repeated = await readPublicSleeperIntake(database, store, id); if (repeated.status === 'missing') throw new Error('CP19 replay disappeared.');
      expect(repeated.drafts).toEqual(read.drafts); expect(deny).not.toHaveBeenCalled(); deny.mockRestore();
    } finally { fetch.mockRestore(); vi.restoreAllMocks(); }
  }, 900_000);
});
