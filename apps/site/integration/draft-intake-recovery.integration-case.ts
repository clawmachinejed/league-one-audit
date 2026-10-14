import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import { createLeagueAdministrationStore, createPublicIntakeStore } from '../lib/league-administration/store';
import { runPublicIntakeStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { PUBLIC_INTAKE_JOB, PUBLIC_DRAFT_PICKS, type PublicIntakeWork, type PublicIntakeStore } from '../lib/league-administration/public-intake-contracts';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createProjectionStore } from '../lib/projection-store';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { exactMatchupClockInstant } from './exact-matchup-clock';

const numericId = () => '8' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));

/** CP19 bounded adverse profile. Identity/discovery/mapping/bootstrap/core/users
 * are explicitly synthetic owner prerequisites with no DATA dispatch or receipt.
 * One ordinary complete catalog creates all three exact catalog-bound children;
 * owner fixture marks non-target league-trades/detail unavailable (not acquired).
 * Direct054 seeds one last-good selection. Five ordinary malformed selections
 * retain that head; the first failure checkpoint acknowledgment is suppressed and
 * recovered by the next owner. Draft-trades then commits, loses its caller ack,
 * and final settlement does no GET. Catalog is acquired exactly once, including
 * retries of the child. Seven admissions/sevenGETs/nine ordinary claims.
 * Body1380s+two90s hooks=1560s leaves240s for guarded global work within1800s.
 * Real60/120/240/480s waits, original20s fences and all harness guards remain.
 * Direct partial9catalog evidence is diagnostic only, not ordinary acquisition.
 * No OS process death, independent sessions, live provider or full fleet claim. */
describe.sequential('bounded draft intake recovery through restricted PostgreSQL', () => {
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
        if (Date.now() >= until) throw new Error('CP19 recovery shared-minute cleanup did not settle.');
        await delay(250);
      }
    } finally { await connection.close(); }
  }, 90_000);

  it('reuses one completed catalog and last good selections through real retry exhaustion sibling recovery and lost acknowledgments', async () => {
    const id = randomUUID(), manager = numericId(), external = numericId(), username = 'cp19_recovery_' + manager;
    const league = { league_id: external, season: '2026', sport: 'nfl', name: 'CP19 synthetic recovery', total_rosters: 2,
      roster_positions: ['QB', 'BN'], scoring_settings: { rec: 0.5 }, settings: {} };
    const native = (draftId: string) => ({ draft_id: draftId, league_id: external, season: '2026', sport: 'nfl',
      type: 'snake', status: 'pre_draft', settings: { teams: 2, rounds: 0 } });
    const retained = native('prior-cp19-draft'), oversized = Array.from({ length: 9 }, (_, index) => native('capped-' + index));
    const base = 'https://api.sleeper.app/v1/league/' + external, urls: string[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      if (url === base + '/drafts') return new Response(JSON.stringify([retained]));
      if (url === 'https://api.sleeper.app/v1/draft/' + retained.draft_id + '/picks') return new Response(JSON.stringify([{ round: 1 }]));
      if (url === 'https://api.sleeper.app/v1/draft/' + retained.draft_id + '/traded_picks') return new Response('[]');
      throw new Error('Unexpected CP19 recovery acquisition: ' + url);
    });
    const intake = createPublicIntakeStore(connection.database), jobs = createProjectionStore(connection.database);
    const checkpoints = () => connection.database.query('SELECT * FROM public_data_draft_checkpoints WHERE intake_id=$1 ORDER BY task_ordinal', [id]);
    const state = () => connection.database.query('SELECT revision,failure_count,terminal FROM public_data_intakes WHERE id=$1', [id]);
    let admissions = 0, claims = 0, cleanupSuppressed = false, recoveryProved = false, committedAcknowledgmentLost = false;
    let callbackError: unknown;
    let abandoned: { work: PublicIntakeWork; fence: AdministrationWriteFence; state: readonly DatabaseRow[] } | undefined;
    let completed: Parameters<NonNullable<PublicIntakeStore['completeDraft']>> | undefined;
    const dependencies: PublicIntakeDependencies = { administration, jobs: { ...jobs, acquireJob: async (...args) => {
      const claim = await jobs.acquireJob(...args); if (claim.kind === 'acquired') claims++; return claim;
    } }, intake: { ...intake,
      admit: async (...args) => { const admitted = await intake.admit(...args); if (admitted) admissions++; return admitted; },
      fail: async (work, fence) => {
        if (work.kind === 'drafts' && work.resource === 'selections' && !cleanupSuppressed) {
          abandoned = { work, fence, state: await state() }; cleanupSuppressed = true;
          throw new Error('Injected missing failure acknowledgment before checkpoint commit.');
        }
        await intake.fail(work, fence);
      },
      recover: async (requestId, fence) => {
        if (!abandoned || recoveryProved) return intake.recover(requestId, fence);
        try {
          expect(fence.workerId).not.toBe(abandoned.fence.workerId);
          expect(await state()).toEqual(abandoned.state);
          await intake.recover(requestId, fence);
          const after = await state();
          expect(after).toEqual([{ revision: Number(abandoned.state[0].revision) + 1, failure_count: 1, terminal: false }]);
          expect(await connection.database.query('SELECT outcome FROM public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2', [abandoned.fence.workerId, abandoned.fence.generation]))
            .toEqual([{ outcome: 'recovered' }]);
          await intake.recover(requestId, fence);
          expect(await state()).toEqual(after); expect(await checkpoints()).toHaveLength(1);
          expect(await intake.next(id)).toBe('backoff'); recoveryProved = true;
        } catch (error) { callbackError = error; throw error; }
      },
      completeDraft: async (...args) => {
        try {
          await intake.completeDraft!(...args);
          if (args[0].resource === 'catalog') {
            // Disclosed non-target prerequisites. Neither endpoint was acquired.
            expect(await ownerQuery("UPDATE public_data_draft_tasks SET status='unavailable',failure_count=5,reason='draft-capture-exhausted',write_fence=$2::jsonb WHERE intake_id=$1 AND resource IN ('league-trades','detail') AND status='pending' RETURNING resource", [id, JSON.stringify(args[3])]))
              .toEqual(expect.arrayContaining([{ resource: 'league-trades' }, { resource: 'detail' }]));
            expect(await checkpoints()).toHaveLength(1); return;
          }
          completed = args; expect(args[0].resource).toBe('draft-trades');
          expect(await checkpoints()).toHaveLength(2); committedAcknowledgmentLost = true;
        } catch (error) { callbackError = error; throw error; }
        throw new Error('Injected missing caller acknowledgment after durable checkpoint commit.');
      },
    } };
    async function progress(resource?: string, status = 'progress') {
      const until = Date.now() + 100_000;
      do {
        const before = { claims, admissions, requests: urls.length };
        const outcome = await runPublicIntakeStep(id, { ...dependencies,
          administration: createLeagueAdministrationStore(connection.database) }, AbortSignal.timeout(20_000));
        if (callbackError) throw callbackError;
        expect(urls.length - before.requests).toBe(outcome.providerRequests);
        if (outcome.status === 'busy') { expect(claims).toBe(before.claims); expect(admissions).toBe(before.admissions); await delay(1_000); continue; }
        expect(claims - before.claims).toBe(1);
        if (resource) {
          expect(outcome).toEqual({ status, resource, providerRequests: 1 }); expect(admissions - before.admissions).toBe(1);
        } else { expect(outcome).toEqual({ status, providerRequests: 0 }); expect(admissions).toBe(before.admissions); }
        return;
      } while (Date.now() < until);
      throw new Error('CP19 recovery stage exceeded unchanged cadence allowance.');
    }
    async function waitBackoff(failures: number) {
      const seconds = 60 * 2 ** (failures - 1);
      expect(await intake.next(id)).toBe('backoff');
      expect(await connection.database.query("SELECT request.next_attempt_at>=outcome.recorded_at+make_interval(secs=>$2::integer-20) AND request.next_attempt_at<=outcome.recorded_at+make_interval(secs=>$2::integer) AS original_backoff FROM public_data_intakes request JOIN public_data_dispatches dispatch ON dispatch.intake_id=request.id JOIN public_data_dispatch_outcomes outcome USING(worker_id,generation) WHERE request.id=$1 AND dispatch.resource='drafts' ORDER BY outcome.recorded_at DESC LIMIT 1", [id, seconds]))
        .toEqual([{ original_backoff: true }]);
      const until = Date.now() + (seconds + 20) * 1_000;
      while (true) {
        const [row] = await connection.database.query('SELECT next_attempt_at<=clock_timestamp() AS ready FROM public_data_intakes WHERE id=$1', [id]);
        if (row.ready === true) return;
        if (Date.now() >= until) throw new Error('CP19 original draft backoff did not elapse.');
        await delay(1_000);
      }
    }
    try {
      const input = { id, username, seasons: [2026], draftPicks: PUBLIC_DRAFT_PICKS };
      await intake.submit(input);
      // Owner-only synthetic prerequisites, not ordinary source acquisitions.
      const registration = await jobs.registerLeagueSeason({ leagueKey: 'cp19-recovery-' + randomUUID(),
        leagueName: league.name, season: 2026, sleeperLeagueId: external, scoringRules: league.scoring_settings });
      if (registration.kind !== 'stored') throw new Error('CP19 seeded registration unavailable.');
      await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','CP19 synthetic recovery prerequisite, not DATA acquisition')", [registration.value.leagueId]);
      await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','CP19 synthetic recovery prerequisite, not DATA acquisition')", [registration.value.leagueId]);
      await ownerQuery("INSERT INTO league_source_manager_accounts(provider,external_manager_id) VALUES('sleeper',$1) ON CONFLICT DO NOTHING", [manager]);
      await ownerQuery("INSERT INTO public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,avatar_url,payload,request_started_at,request_completed_at) SELECT $1,id,$2,$2,NULL,$3::jsonb,clock_timestamp(),clock_timestamp() FROM league_source_manager_accounts WHERE provider='sleeper' AND external_manager_id=$4",
        [id, username, JSON.stringify({ user_id: manager, username, fixture: 'synthetic prerequisite' }), manager]);
      await ownerQuery("INSERT INTO public_data_league_lists(intake_id,season,payload,request_started_at,request_completed_at) VALUES($1,2026,$2::jsonb,clock_timestamp(),clock_timestamp())", [id, JSON.stringify([league])]);
      await ownerQuery("INSERT INTO public_data_league_candidates(intake_id,season,external_league_id,name,stage,league_season_id,bootstrap_payload,bootstrap_started_at,bootstrap_completed_at) VALUES($1,2026,$2,$3,'complete',$4,$5::jsonb,clock_timestamp(),clock_timestamp())",
        [id, external, league.name, registration.value.leagueSeasonId, JSON.stringify(league)]);
      const seedWorker = randomUUID();
      await ownerQuery("INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count,payload) VALUES($1,$1,clock_timestamp(),'running',$2,clock_timestamp()+interval '25 seconds',1,jsonb_build_object('requestId',$3::text))", [PUBLIC_INTAKE_JOB, seedWorker, id]);
      const [seedClock] = await connection.database.query("SELECT clock_timestamp()+interval '20 seconds' AS at");
      const seedFence = { jobKey: PUBLIC_INTAKE_JOB, workerId: seedWorker, generation: 1, deadlineAt: exactMatchupClockInstant(seedClock.at) };
      await ownerQuery("INSERT INTO public_data_draft_tasks(intake_id,ordinal,season,external_league_id,resource,write_fence) VALUES($1,1,2026,$2,'catalog',$3::jsonb),($1,2,2026,$2,'league-trades',$3::jsonb)", [id, external, JSON.stringify(seedFence)]);
      await ownerQuery("UPDATE projection_jobs SET state='failed',lease_owner=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE job_key=$1", [PUBLIC_INTAKE_JOB]);
      expect(await connection.database.query('SELECT worker_id FROM public_data_dispatches WHERE intake_id=$1', [id])).toEqual([]);
      expect(await checkpoints()).toEqual([]);
      const mapping = await administration.readSourceMapping(external); if (!mapping) throw new Error('CP19 recovery mapping unavailable.');
      const attempt = await administration.beginDraftSelectionsAttempt!(mapping, { kind: 'selections', externalDraftId: retained.draft_id }, randomUUID());
      const [clock] = await connection.database.query('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
      const at = exactMatchupClockInstant(clock.at);
      const baselineInput = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
        dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'drafts', week: null, completeness: 'complete',
        payload: { selectionsVersion: 'sleeper-draft-selections-v1', kind: 'selections', externalDraftId: retained.draft_id, catalog: retained,
          picks: [{ pick_no: 1, round: 1, draft_slot: 1, player_id: 'last-good-player', roster_id: 1 }] },
        provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
      const baselineWrite = await administration.recordObservation(baselineInput, undefined, mapping, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, { attempt });
      expect(baselineWrite.draftSelectionsAcceptance?.status).toBe('accepted');
      const baseline = await administration.readDraftSelections!(mapping, { kind: 'selections', externalDraftId: retained.draft_id });
      if (baseline.status !== 'available') throw new Error('CP19 direct last-good selections unavailable.');
      expect(baseline.provenance.acquisition).toBeUndefined();
      // Independent direct partial catalog diagnostic; not this request's source.
      const partialAttempt = await administration.beginDraftMetadataAttempt!(mapping, { kind: 'catalog' }, randomUUID());
      const [partialClock] = await connection.database.query('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
      const partialAt = exactMatchupClockInstant(partialClock.at);
      const partialInput = normalizeAdministrationObservation({ ...baselineInput.envelope, completeness: 'partial',
        payload: { metadataVersion: 'sleeper-draft-metadata-v1', kind: 'catalog', catalog: oversized, details: [], reason: 'draft-metadata-capacity' },
        provenance: { origin: 'network', requestStartedAt: partialAt, requestCompletedAt: partialAt, sourceObservedAt: null, checkedAt: partialAt } });
      const partialWrite = await administration.recordObservation(partialInput, undefined, mapping, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, { attempt: partialAttempt });
      expect(partialWrite.draftMetadataAcceptance?.status).toBe('preserved');
      expect(await administration.readDraftMetadata!(mapping, { kind: 'catalog', receiptId: partialWrite.draftMetadataAcceptance!.receiptId }))
        .toMatchObject({ status: 'observed', value: { complete: false, totalCount: 9 } });
      await progress('drafts');
      const catalogCheckpoint = (await checkpoints())[0];
      expect(catalogCheckpoint.task_ordinal).toBe(1);
      expect(await connection.database.query("SELECT resource,catalog_receipt_id FROM public_data_draft_tasks WHERE intake_id=$1 AND resource IN ('detail','selections','draft-trades') ORDER BY ordinal", [id]))
        .toEqual(['detail', 'selections', 'draft-trades'].map(resource => ({ resource, catalog_receipt_id: catalogCheckpoint.draft_receipt_id })));
      await progress('drafts', 'unavailable');
      expect(cleanupSuppressed).toBe(true); if (!abandoned) throw new Error('CP19 abandoned dispatch missing.');
      expect(await state()).toEqual(abandoned.state);
      expect(await connection.database.query('SELECT outcome FROM public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2', [abandoned.fence.workerId, abandoned.fence.generation])).toEqual([]);
      await progress(undefined, 'backoff'); expect(recoveryProved).toBe(true);
      for (let failures = 1; failures <= 5; failures++) {
        expect(await connection.database.query("SELECT status,failure_count,reason FROM public_data_draft_tasks WHERE intake_id=$1 AND resource='selections'", [id]))
          .toEqual([{ status: failures < 5 ? 'pending' : 'unavailable', failure_count: failures, reason: failures < 5 ? null : 'draft-capture-exhausted' }]);
        expect(await administration.readDraftSelections!(mapping, { kind: 'selections', externalDraftId: retained.draft_id })).toEqual(baseline);
        expect(await connection.database.query("SELECT count(*)::integer AS children,bool_and(catalog_receipt_id=$2::uuid) AS same_catalog FROM public_data_draft_tasks WHERE intake_id=$1 AND external_draft_id IS NOT NULL", [id, catalogCheckpoint.draft_receipt_id]))
          .toEqual([{ children: 3, same_catalog: true }]);
        expect(await checkpoints()).toEqual([catalogCheckpoint]);
        expect(await connection.database.query("SELECT count(*)::integer AS observed,bool_and(NOT header.complete) AS partial FROM league_roster_capture_receipts receipt JOIN league_draft_selection_contents header ON header.content_id=receipt.content_id WHERE receipt.provenance->'acquisition'->'work'->>'requestId'=$1 AND receipt.provenance->'acquisition'->'work'->>'resource'='selections'", [id]))
          .toEqual([{ observed: failures, partial: true }]);
        if (failures < 5) { await waitBackoff(failures); await progress('drafts', 'unavailable'); }
      }
      expect(await intake.next(id)).toMatchObject({ kind: 'drafts', resource: 'draft-trades' });
      const nextAdmission = Date.now() + 80_000;
      while (true) {
        const [row] = await connection.database.query("SELECT NOT EXISTS(SELECT 1 FROM public_data_dispatches WHERE admitted_at>clock_timestamp()-interval '60 seconds') AS ready");
        if (row.ready === true) break;
        if (Date.now() >= nextAdmission) throw new Error('CP19 exhaustion admission spacing did not elapse.');
        await delay(1_000);
      }
      await progress('drafts', 'unavailable'); expect(committedAcknowledgmentLost).toBe(true);
      const saved = await checkpoints(); expect(saved).toHaveLength(2); expect(saved[1].task_ordinal).toBe(5);
      const completedState = await state();
      await progress(undefined, 'partial');
      expect(await state()).toEqual(completedState); expect(await checkpoints()).toEqual(saved);
      expect(claims).toBe(9); expect(admissions).toBe(7); expect(urls).toHaveLength(7);
      expect(urls).toEqual([base + '/drafts', ...Array.from({ length: 5 }, () => 'https://api.sleeper.app/v1/draft/' + retained.draft_id + '/picks'),
        'https://api.sleeper.app/v1/draft/' + retained.draft_id + '/traded_picks']);
      expect(urls.filter(url => url === base + '/drafts')).toHaveLength(1);
      expect(await connection.database.query("WITH ordered AS (SELECT admitted_at,lag(admitted_at) OVER(ORDER BY admitted_at) AS previous FROM public_data_dispatches WHERE intake_id=$1) SELECT count(*)::integer AS admissions,bool_and(previous IS NULL OR admitted_at-previous>=interval '60 seconds') AS real_spacing FROM ordered", [id]))
        .toEqual([{ admissions: 7, real_spacing: true }]);
      if (!completed) throw new Error('CP19 committed sibling checkpoint missing.');
      expect(await connection.database.query('SELECT outcome FROM public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2', [completed[3].workerId, completed[3].generation]))
        .toEqual([{ outcome: 'checkpoint-committed' }]);
      await expect(intake.fail(abandoned.work, abandoned.fence)).rejects.toThrow();
      await expect(intake.completeDraft!(...completed)).rejects.toThrow();
      await intake.submit(input); expect(await checkpoints()).toEqual(saved);
      fetch.mockRestore();
      const denyFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP19 recovery stored read attempted acquisition.'));
      const queries: string[] = [];
      const database: DatabaseClient = { enabled: true, query: async <Row extends DatabaseRow = DatabaseRow>(sql: string,
        parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu); queries.push(sql);
        return connection.database.query<Row>(sql, parameters, options);
      } };
      const final = await readPublicSleeperIntake(database, createLeagueAdministrationStore(database), id);
      expect(final).toMatchObject({ status: 'partial', draftPicks: { collection: 'partial', summary: {
        materializedResources: 5, pendingResources: 0, acquiredResources: 2, unavailableResources: 3, undiscoveredDraftLeagues: 0 } } });
      if (final.status === 'missing' || !final.drafts) throw new Error('CP19 terminal draft inventory unavailable.');
      expect(final.drafts[3]).toMatchObject({ collection: 'unavailable', failureCount: 5, acquisition: null,
        currentAccepted: { resource: { status: 'available', receiptId: baseline.receiptId, value: { totalCount: 1 } } } });
      expect(final.drafts[4]).toMatchObject({ collection: 'complete', resource: { status: 'available', value: { kind: 'draft', complete: true, totalCount: 0 } } });
      expect(await administration.readDraftSelections!(mapping, { kind: 'selections', externalDraftId: retained.draft_id, receiptId: baseline.receiptId }))
        .toMatchObject({ status: 'available', receiptId: baseline.receiptId, value: baseline.value, provenance: baseline.provenance });
      expect(denyFetch).not.toHaveBeenCalled(); expect(queries.length).toBeGreaterThan(0); denyFetch.mockRestore();
    } finally { fetch.mockRestore(); vi.restoreAllMocks(); }
  }, 1_380_000);
});
