import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { JsonValue } from '../lib/league-administration/contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from '../lib/league-administration/store';
import { runPublicDataRefreshStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { PUBLIC_INTAKE_JOB, PUBLIC_DRAFT_PICKS } from '../lib/league-administration/public-intake-contracts';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createProjectionStore } from '../lib/projection-store';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { exactMatchupClockInstant } from './exact-matchup-clock';

const numericId = () => '8' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const resources = ['catalog', 'league-trades', 'detail', 'selections', 'draft-trades'] as const;
type Resource = typeof resources[number];

/** CP19 AUTHORED / HOSTED SQL UNQUALIFIED. Disclosed prerequisites: owner-seeded
 * identity authority, existing registration/enrollment and five direct CP16–18
 * receipts, with no DATA acquisition or checkpoint credit. The ordinary refresh
 * reacquires identity/list/bootstrap/core/users and all five draft endpoints:
 *10admissions/11GETs+onezeroGET settlement, genuine60s spacing.900s body+two90s
 * hooks=1080s, leaving720s inside unchanged1800s work. One native draft only.
 * Changed detail/trades, complete-empty selections removal and equal catalog/
 * draft-trades all retain immutable old receipts. No second natural cycle,
 * live-source, independent-session contention or fleet capacity is claimed. */
describe.sequential('ordinary draft and pick refresh from disclosed baseline through restricted PostgreSQL', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationStore>;
  beforeAll(async () => {
    connection = createIndependentDatabase(); administration = createLeagueAdministrationStore(connection.database);
    expect((await connection.database.query('SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user'))[0])
      .toEqual({ current_user: 'league_one_runtime', session_user: 'league_one_runtime', rolsuper: false, rolcreaterole: false, rolcreatedb: false });
  }, 90_000);
  afterAll(async () => {
    vi.restoreAllMocks(); if (!connection) return;
    try {
      const until = Date.now() + 85_000;
      while (true) {
        const [row] = await connection.database.query("SELECT NOT EXISTS(SELECT 1 FROM public_data_dispatches WHERE admitted_at>clock_timestamp()-interval '60 seconds') AND NOT EXISTS(SELECT 1 FROM projection_jobs WHERE job_key=$1 AND (state='running' OR completed_at>clock_timestamp()-interval '60 seconds')) AS ready", [PUBLIC_INTAKE_JOB]);
        if (row.ready === true) break;
        if (Date.now() >= until) throw new Error('CP19 refresh shared-minute cleanup did not settle.');
        await delay(250);
      }
    } finally { await connection.close(); }
  }, 90_000);

  it('refreshes corrections equal captures and removals through ordinary recurring ownership without rewriting prior receipts', async () => {
    const identityId = randomUUID(), manager = numericId(), external = numericId(), username = 'cp19_refresh_' + manager, draftId = 'cp19-' + randomUUID();
    const league = { league_id: external, season: '2026', sport: 'nfl', name: 'CP19 unrelated refresh league', total_rosters: 2,
      roster_positions: ['QB', 'BN'], scoring_settings: { rec: 0.5 }, settings: {} };
    const catalog = { draft_id: draftId, league_id: external, season: '2026', sport: 'nfl', type: 'snake', status: 'pre_draft', settings: { teams: 2, rounds: 1 } };
    const payload = (resource: Resource, corrected: boolean): JsonValue => resource === 'catalog'
      ? { metadataVersion: 'sleeper-draft-metadata-v1', kind: 'catalog', catalog: [catalog], details: [], reason: null }
      : resource === 'detail' ? { metadataVersion: 'sleeper-draft-metadata-v1', kind: 'detail', externalDraftId: draftId, catalog,
        draft: { ...catalog, status: corrected ? 'complete' : 'pre_draft' } }
        : resource === 'selections' ? { selectionsVersion: 'sleeper-draft-selections-v1', kind: 'selections', externalDraftId: draftId, catalog,
          picks: corrected ? [] : [{ pick_no: 1, round: 1, draft_slot: 1, player_id: '007', roster_id: 1, picked_by: manager, is_keeper: false }] }
          : resource === 'league-trades' ? { tradedPicksVersion: 'sleeper-traded-picks-v1', kind: 'league',
            tradedPicks: [{ season: '2027', round: 1, roster_id: 1, owner_id: corrected ? 2 : 1, previous_owner_id: 1 }] }
            : { tradedPicksVersion: 'sleeper-traded-picks-v1', kind: 'draft', externalDraftId: draftId, catalog, tradedPicks: [] };
    const intake = createPublicIntakeStore(connection.database), jobs = createProjectionStore(connection.database), refresh = createPublicDataRefreshStore(connection.database);
    let mapping: AdministrationSourceMapping;
    async function read(resource: Resource, receiptId?: string) {
      const selected = receiptId ? { receiptId } : {};
      const result = resource === 'catalog' ? await administration.readDraftMetadata?.(mapping, { kind: 'catalog', ...selected })
        : resource === 'detail' ? await administration.readDraftMetadata?.(mapping, { kind: 'detail', externalDraftId: draftId, ...selected })
          : resource === 'selections' ? await administration.readDraftSelections?.(mapping, { kind: 'selections', externalDraftId: draftId, ...selected })
            : await administration.readTradedPicks?.(mapping, resource === 'league-trades' ? { kind: 'league', ...selected } : { kind: 'draft', externalDraftId: draftId, ...selected });
      if (!result || result.status !== 'available') throw new Error('CP19 seeded resource unavailable.');
      return result;
    }
    const baseline = new Map<Resource, Awaited<ReturnType<typeof read>>>();
    const denySeedFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP19 baseline must not request provider data.'));
    try {
      await intake.submit({ id: identityId, username, seasons: [2026] });
      await ownerQuery("INSERT INTO league_source_manager_accounts(provider,external_manager_id) VALUES('sleeper',$1) ON CONFLICT DO NOTHING", [manager]);
      await ownerQuery(`INSERT INTO public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,avatar_url,payload,request_started_at,request_completed_at)
        SELECT $1,id,$2,$2,NULL,$3::jsonb,clock_timestamp(),clock_timestamp() FROM league_source_manager_accounts WHERE provider='sleeper' AND external_manager_id=$4`,
        [identityId, username, JSON.stringify({ user_id: manager, username, fixture: 'CP19 explicit synthetic identity prerequisite' }), manager]);
      const registered = await jobs.registerLeagueSeason({ leagueKey: 'cp19-seed-' + randomUUID(), leagueName: league.name,
        season: 2026, sleeperLeagueId: external, scoringRules: { rec: 0.5 } });
      if (registered.kind !== 'stored') throw new Error('CP19 seeded registration unavailable.');
      await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','CP19 disclosed baseline, not DATA acquisition')", [registered.value.leagueId]);
      await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','CP19 disclosed baseline, not DATA acquisition')", [registered.value.leagueId]);
      const source = await administration.readSourceMapping(external); if (!source) throw new Error('CP19 seed mapping unavailable.'); mapping = source;
      for (const resource of resources) {
        const attempt = resource === 'catalog' ? await administration.beginDraftMetadataAttempt?.(mapping, { kind: 'catalog' }, randomUUID())
          : resource === 'detail' ? await administration.beginDraftMetadataAttempt?.(mapping, { kind: 'detail', externalDraftId: draftId }, randomUUID())
            : resource === 'selections' ? await administration.beginDraftSelectionsAttempt?.(mapping, { kind: 'selections', externalDraftId: draftId }, randomUUID())
              : await administration.beginTradedPicksAttempt?.(mapping, resource === 'league-trades' ? { kind: 'league' } : { kind: 'draft', externalDraftId: draftId }, randomUUID());
        if (!attempt) throw new Error('CP19 seed reservation unavailable.');
        const [clock] = await connection.database.query('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
        const at = exactMatchupClockInstant(clock.at);
        const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
          dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'drafts', week: null, completeness: 'complete', payload: payload(resource, false),
          provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
        const result = await administration.recordObservation(normalized, undefined, mapping, undefined, undefined, undefined, undefined, undefined, undefined,
          undefined, undefined, undefined, undefined, resource === 'catalog' || resource === 'detail' ? { attempt } : undefined,
          resource === 'selections' ? { attempt } : undefined, resource === 'league-trades' || resource === 'draft-trades' ? { attempt } : undefined);
        expect((result.draftMetadataAcceptance ?? result.draftSelectionsAcceptance ?? result.tradedPicksAcceptance)?.status).toBe('accepted');
        const value = await read(resource); expect(value.provenance.acquisition).toBeUndefined(); baseline.set(resource, value);
      }
      expect(await connection.database.query('SELECT worker_id FROM public_data_dispatches WHERE intake_id=$1', [identityId])).toEqual([]);
      expect(await connection.database.query('SELECT intake_id FROM public_data_draft_checkpoints WHERE intake_id=$1', [identityId])).toEqual([]);
      expect(denySeedFetch).not.toHaveBeenCalled();
    } finally { denySeedFetch.mockRestore(); }
    const base = 'https://api.sleeper.app/v1/league/' + external, draftBase = 'https://api.sleeper.app/v1/draft/' + draftId, urls: string[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      if (url === 'https://api.sleeper.app/v1/user/' + manager) return Response.json({ user_id: manager, username });
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return Response.json([league]);
      if (url === base) return Response.json(league);
      if (url === base + '/drafts') return Response.json([catalog]);
      const resource = url === base + '/traded_picks' ? 'league-trades' : url === draftBase ? 'detail'
        : url === draftBase + '/picks' ? 'selections' : url === draftBase + '/traded_picks' ? 'draft-trades' : null;
      if (resource) { const wrapper = payload(resource, true) as Record<string, JsonValue>; return Response.json(wrapper.draft ?? wrapper.picks ?? wrapper.tradedPicks); }
      if (url === base + '/rosters') return Response.json([1, 2].map(roster_id => ({ roster_id, owner_id: roster_id === 1 ? manager : null,
        co_owners: [], players: [], starters: [], reserve: [], taxi: [] })));
      if (url === base + '/users') return Response.json([{ user_id: manager, display_name: username }]);
      throw new Error('Unexpected CP19 refresh endpoint: ' + url);
    });
    let admissions = 0, claims = 0;
    const dependencies: PublicIntakeDependencies = { administration, intake: { ...intake, admit: async (...args) => {
      const admitted = await intake.admit(...args); if (admitted) admissions++; return admitted;
    } }, jobs: { ...jobs, acquireJob: async (...args) => { const claim = await jobs.acquireJob(...args); if (claim.kind === 'acquired') claims++; return claim; } } };
    async function progress(resource?: string) {
      const until = Date.now() + 100_000;
      do {
        const before = { claims, admissions, requests: urls.length };
        const outcome = await runPublicDataRefreshStep({ ...dependencies, refresh: createPublicDataRefreshStore(connection.database),
          administration: createLeagueAdministrationStore(connection.database) }, AbortSignal.timeout(20_000));
        expect(urls.length - before.requests).toBe(outcome.providerRequests);
        if (outcome.status === 'busy') { expect(claims).toBe(before.claims); expect(admissions).toBe(before.admissions); await delay(1_000); continue; }
        expect(claims - before.claims).toBe(1);
        if (resource) { expect(outcome).toMatchObject({ status: 'progress', resource, providerRequests: resource === 'core' ? 2 : 1 }); expect(admissions - before.admissions).toBe(1); }
        else { expect(outcome).toEqual({ status: 'backoff', providerRequests: 0 }); expect(admissions).toBe(before.admissions); }
        return;
      } while (Date.now() < until);
      throw new Error('CP19 refresh exceeded original cadence allowance.');
    }
    const configuration = { id: randomUUID(), expectedRevision: 0, identityRequestId: identityId, seasons: [2026], draftPicks: PUBLIC_DRAFT_PICKS,
      cadenceSeconds: 3600, expiresAt: new Date(Date.now() + 45 * 60_000).toISOString(), paused: false };
    try {
      const target = await refresh.configure(configuration); expect(await refresh.configure(configuration)).toMatchObject({ status: 'replayed', targetId: target.targetId });
      await expect(refresh.configure({ ...configuration, draftPicks: undefined })).rejects.toThrow();
      for (const resource of ['identity', 'leagues', 'bootstrap']) await progress(resource);
      const pending = await readPublicDataRefresh(connection.database, administration, target.targetId);
      if (pending.status !== 'available' || !pending.cycle) throw new Error('CP19 recurring cycle unavailable.');
      const id = pending.cycle.requestId; expect(id).not.toBe(identityId);
      expect(pending.cycle).toMatchObject({ draftPicks: PUBLIC_DRAFT_PICKS, outcome: null });
      for (const resource of resources) { expect(await intake.next(id)).toMatchObject({ kind: 'drafts', resource }); await progress('drafts'); }
      for (const resource of ['core', 'users']) await progress(resource); await progress();
      expect(admissions).toBe(10); expect(claims).toBe(11);
      expect(urls).toEqual(['https://api.sleeper.app/v1/user/' + manager,
        'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026', base, base + '/drafts', base + '/traded_picks',
        draftBase, draftBase + '/picks', draftBase + '/traded_picks', base, base + '/rosters', base + '/users']);
      expect(await connection.database.query("WITH ordered AS (SELECT admitted_at,lag(admitted_at) OVER(ORDER BY admitted_at) AS previous FROM public_data_dispatches WHERE intake_id=$1) SELECT count(*)::integer AS admissions,count(previous)::integer AS gaps,bool_and(previous IS NULL OR admitted_at-previous>=interval '60 seconds') AS real_spacing FROM ordered", [id]))
        .toEqual([{ admissions: 10, gaps: 9, real_spacing: true }]);
      fetch.mockRestore(); const deny = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP19 stored refresh attempted acquisition.'));
      const current = await readPublicDataRefresh(connection.database, administration, target.targetId);
      expect(current).toMatchObject({ cycle: { requestId: id, draftPicks: PUBLIC_DRAFT_PICKS, outcome: { disposition: 'complete' } },
        intake: { status: 'available', draftPicks: { collection: 'complete', summary: { acquiredResources: 5, pendingResources: 0, unavailableResources: 0 } } } });
      if (current.status !== 'available' || !current.intake || current.intake.status === 'missing' || !current.intake.drafts) throw new Error('CP19 completed cycle unavailable.');
      for (const resource of resources) {
        const old = baseline.get(resource)!;
        const task = current.intake.drafts[resources.indexOf(resource)];
        if (task.resource.status !== 'available' || !task.acquisition) throw new Error('CP19 refresh receipt unavailable.');
        expect(task.resource.receiptId).not.toBe(old.receiptId); expect(task.resource.provenance.acquisition?.work).toMatchObject({ kind: 'drafts', requestId: id, resource });
        expect(await connection.database.query('SELECT payload FROM league_administration_contents WHERE id=$1', [task.resource.contentId])).toEqual([{ payload: payload(resource, true) }]);
        const historical = await read(resource, old.receiptId);
        expect({ ...historical, selection: old.selection }).toEqual(old);
        if (resource === 'catalog' || resource === 'draft-trades') expect(task.resource.contentId).toBe(old.contentId);
        else expect(task.resource.contentId).not.toBe(old.contentId);
      }
      expect(current.intake.drafts[1].resource).toMatchObject({ value: { entries: [{ pickSeason: { value: '2027' }, currentOwnerId: '2' }] } });
      expect(current.intake.drafts[2].resource).toMatchObject({ value: { detail: { status: { value: 'complete' } } } });
      expect(current.intake.drafts[3].resource).toMatchObject({ value: { complete: true, totalCount: 0, picksState: 'empty', entries: [] } });
      const prior = await readPublicSleeperIntake(connection.database, administration, id); if (prior.status === 'missing') throw new Error('CP19 cycle disappeared.');
      expect(prior.drafts).toEqual(current.intake.drafts); expect(deny).not.toHaveBeenCalled(); deny.mockRestore();
    } finally { fetch.mockRestore(); vi.restoreAllMocks(); }
  }, 900_000);
});
