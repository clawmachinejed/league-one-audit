import 'server-only';
import { randomUUID } from 'node:crypto';
import { capturePublicSleeperCore, capturePublicSleeperIdentity, capturePublicSleeperLeagueList } from '../sleeper';
import type { ProjectionStore } from '../projections/adapters/neon/contracts';
import type { LeagueAdministrationStore } from './store-contracts';
import { recordCapturedAdministration } from './runtime';
import { PUBLIC_INTAKE_JOB, type PublicIntakeOutcome, type PublicIntakeStore } from './public-intake-contracts';

export type PublicIntakeDependencies = Readonly<{
  intake: PublicIntakeStore;
  administration: LeagueAdministrationStore;
  jobs: Pick<ProjectionStore, 'acquireJob' | 'completeJob' | 'failJob'>;
  source?: Readonly<{ identity: typeof capturePublicSleeperIdentity; leagues: typeof capturePublicSleeperLeagueList;
    core: typeof capturePublicSleeperCore }>;
  now?: () => Date;
}>;

/** One bounded selection owned by the existing administration worker and jobs table.
 * Identity/list checkpoints survive later core failure. No accounts, registry activation,
 * scoring, Tank01, page requests or new scheduler participate in this collection. */
export async function runPublicIntakeStep(requestId: string, dependencies: PublicIntakeDependencies,
  signal: AbortSignal): Promise<PublicIntakeOutcome> {
  const { intake, jobs, administration } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const source = dependencies.source ?? { identity: capturePublicSleeperIdentity,
    leagues: capturePublicSleeperLeagueList, core: capturePublicSleeperCore };
  signal.throwIfAborted();
  const workerId = randomUUID();
  // All public intakes share one owner and a minimum minute between successful steps.
  const claim = await jobs.acquireJob({ jobKey: PUBLIC_INTAKE_JOB, jobType: PUBLIC_INTAKE_JOB, workerId,
    scheduledFor: new Date(Math.floor(now().getTime() / 60_000) * 60_000).toISOString(),
    leaseSeconds: 25, minimumIntervalSeconds: 60, payload: { requestId, policy: 'public-data-intake-v1' } });
  if (claim.kind !== 'acquired') return { status: 'busy', providerRequests: 0 };
  const fence = { jobKey: PUBLIC_INTAKE_JOB, workerId, generation: claim.attempt,
    deadlineAt: new Date(now().getTime() + 20_000).toISOString() };
  let work: Awaited<ReturnType<PublicIntakeStore['next']>> | undefined;
  let requests = 0;
  try {
    work = await intake.next(requestId);
    if (typeof work === 'string') {
      if (!await jobs.completeJob(PUBLIC_INTAKE_JOB, workerId)) throw new Error('Intake lease lost.');
      return { status: work, providerRequests: 0 };
    }
    if (!await intake.admit(work, fence)) {
      if (!await jobs.completeJob(PUBLIC_INTAKE_JOB, workerId)) throw new Error('Intake lease lost.');
      return { status: 'backoff', providerRequests: 0 };
    }
    if (work.kind === 'identity') {
      requests++;
      await intake.recordIdentity(work, await source.identity(work.username, signal), fence);
    } else if (work.kind === 'leagues') {
      requests++;
      await intake.recordLeagues(work, await source.leagues(work.userId, work.season, signal), fence);
    } else if (work.kind === 'bootstrap') {
      requests++;
      await intake.register(work, await source.core(work.externalLeagueId, 'league', signal), fence);
    } else {
      const mapping = await administration.readSourceMapping(work.externalLeagueId);
      if (!mapping || mapping.scope.season !== work.season) throw new Error('Intake mapping unavailable.');
      const observations: { league?: string; rosters?: string; users?: string } = {};
      if (work.kind === 'core') {
        const attempts = await administration.beginRosterCapture(mapping, randomUUID(), randomUUID(), fence);
        const settings = await administration.beginLeagueSettingsAttempt(mapping, randomUUID(), fence);
        // The league request follows both reservations; its independently accepted
        // population proof belongs to this exact roster acquisition and mapping.
        requests += 2;
        const results = await Promise.allSettled([
          source.core(work.externalLeagueId, 'league', signal), source.core(work.externalLeagueId, 'rosters', signal),
        ]);
        const documents = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
        const captured = await recordCapturedAdministration(mapping.scope, documents, { store: administration,
          signal, fence, mapping, rosterAttempt: attempts.players, managerAttempt: attempts.managers,
          leagueSettingsAttempt: settings, now });
        for (const entry of captured.results) {
          if (['changed', 'unchanged', 'replayed'].includes(entry.result.status) && entry.result.observationId) {
            if (entry.family === 'league') observations.league = entry.result.observationId;
            if (entry.family === 'rosters') observations.rosters = entry.result.observationId;
          }
        }
        if (!observations.league || !observations.rosters) throw new Error('Core evidence remains incomplete.');
      }
      // Directory outage never discards the successful core checkpoint. A separate
      // durable users step retries it, without recollecting settings or roster data.
      try {
        signal.throwIfAborted();
        requests++;
        const captured = await recordCapturedAdministration(mapping.scope,
          [await source.core(work.externalLeagueId, 'users', signal)], { store: administration, signal, fence, now });
        const entry = captured.results[0]?.result;
        if (entry && ['changed', 'unchanged', 'replayed'].includes(entry.status)) observations.users = entry.observationId;
      } catch { /* Independent resource failure is retained by completeCore below. */ }
      if (work.kind === 'users' && !observations.users) throw new Error('Directory evidence remains unavailable.');
      await intake.completeCore(work, mapping, observations, fence);
    }
    signal.throwIfAborted();
    if (!await jobs.completeJob(PUBLIC_INTAKE_JOB, workerId)) throw new Error('Intake lease lost.');
    return { status: 'progress', resource: work.kind, providerRequests: requests };
  } catch {
    if (work && typeof work === 'object') await intake.fail(work, fence).catch(() => undefined);
    await jobs.failJob(PUBLIC_INTAKE_JOB, workerId, 'public-data-intake-step-failed').catch(() => false);
    return { status: 'unavailable', ...(work && typeof work === 'object' ? { resource: work.kind } : {}), providerRequests: requests };
  }
}
