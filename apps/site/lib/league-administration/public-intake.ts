import 'server-only';
import { randomUUID } from 'node:crypto';
import { capturePublicSleeperCore, capturePublicSleeperIdentity, capturePublicSleeperLeagueList } from '../sleeper';
import type { ProjectionStore } from '../projection-store';
import type { LeagueAdministrationStore } from './store-contracts';
import type { CapturedAdministrationDocument } from './contracts';
import { recordCapturedAdministration, recordCapturedPlayerDirectory } from './runtime';
import { loadCompletePlayerCatalog } from '../sleeper-player-catalog';
import type { PlayerDirectoryOutcome } from './player-directory-contracts';
import type { PublicDataRefreshOutcome, PublicDataRefreshSelected, PublicDataRefreshSelectionFailure, PublicDataRefreshStore } from './public-refresh-contracts';
import { PUBLIC_INTAKE_JOB, type PublicIntakeOutcome, type PublicIntakeStore } from './public-intake-contracts';
import { assertOriginalPublicCapture, validateRequestedPublicCaptureWitness, type PublicCaptureWitness } from './public-capture-witness';
import type { AdministrationSourceMapping } from './source-mapping';

type PublicIntakeCleanup = Readonly<{ intake: Pick<PublicIntakeStore, 'fail'>; jobs: Pick<ProjectionStore, 'failJob'>;
  refresh?: Pick<PublicDataRefreshStore, 'recordSelectionFailure'> }>;
export type PublicIntakeDependencies = Readonly<{
  intake: PublicIntakeStore;
  administration: LeagueAdministrationStore;
  jobs: Pick<ProjectionStore, 'acquireJob' | 'completeJob' | 'failJob'>;
  source?: Readonly<{ identity: typeof capturePublicSleeperIdentity; leagues: typeof capturePublicSleeperLeagueList;
    core: (leagueId: string, family: 'league' | 'rosters' | 'users', signal: AbortSignal, witness?: PublicCaptureWitness) => Promise<CapturedAdministrationDocument>;
    exactPeriod?: (leagueId: string, nativeWeek: number, signal: AbortSignal, witness?: PublicCaptureWitness) => Promise<CapturedAdministrationDocument> }>;
  now?: () => Date;
  /** Requires installed R035; adds evidence without replacing either v1 reservation. */
  managerEvidenceVersion?: 'v2';
  /** Absolute work deadline, including time already spent obtaining the owner. */
  deadlineAt?: string;
  /** Optional early abort-aware database phase; manual intake does not use it. */
  preAdmission?: Readonly<{ signal: AbortSignal; jobs: Pick<ProjectionStore, 'acquireJob'>;
    intake: Pick<PublicIntakeStore, 'recover' | 'next' | 'admit'>; refresh: Pick<PublicDataRefreshStore, 'select'>;
    cleanup: () => PublicIntakeCleanup }>;
  cleanup?: () => PublicIntakeCleanup;
}>;

/** One bounded selection owned by the existing administration worker and jobs table.
 * Identity/list checkpoints survive later core failure. No accounts, registry activation,
 * scoring, Tank01, page requests or new scheduler participate in this collection. */
export async function runPublicIntakeStep(requestId: string, dependencies: PublicIntakeDependencies,
  signal: AbortSignal): Promise<PublicIntakeOutcome> {
  return runOwnedPublicIntakeStep(requestId, dependencies, signal) as Promise<PublicIntakeOutcome>;
}

export async function runPublicDataRefreshStep(dependencies: PublicIntakeDependencies & Readonly<{ refresh: PublicDataRefreshStore }>,
  signal: AbortSignal): Promise<PublicDataRefreshOutcome> {
  return runOwnedPublicIntakeStep(undefined, dependencies, signal) as Promise<PublicDataRefreshOutcome>;
}

/** Explicit shared resource selection, using the existing owner without a league or intake request. */
export async function runPublicPlayerDirectoryStep(dependencies: PublicIntakeDependencies, signal: AbortSignal): Promise<PlayerDirectoryOutcome> {
  return runOwnedPublicIntakeStep(undefined, dependencies, signal, 'player-directory') as Promise<PlayerDirectoryOutcome>;
}

async function runOwnedPublicIntakeStep(requestId: string | undefined,
  dependencies: PublicIntakeDependencies & Readonly<{ refresh?: PublicDataRefreshStore }>,
  signal: AbortSignal, mode: 'intake' | 'player-directory' = 'intake'): Promise<PublicDataRefreshOutcome | PlayerDirectoryOutcome> {
  const { intake, jobs, administration } = dependencies;
  const refresh = mode === 'intake' && requestId === undefined ? dependencies.refresh : undefined;
  const phase = refresh ? dependencies.preAdmission : undefined;
  const phaseSignal = phase?.signal ?? signal;
  const phaseIntake = phase?.intake ?? intake;
  const now = dependencies.now ?? (() => new Date());
  const source = dependencies.source ?? { identity: capturePublicSleeperIdentity,
    leagues: capturePublicSleeperLeagueList,
    core: (leagueId: string, family: 'league' | 'rosters' | 'users', captureSignal: AbortSignal, witness?: PublicCaptureWitness) =>
      capturePublicSleeperCore(leagueId, family, captureSignal, undefined, witness),
    exactPeriod: (leagueId: string, nativeWeek: number, captureSignal: AbortSignal, witness?: PublicCaptureWitness) =>
      capturePublicSleeperCore(leagueId, 'matchups', captureSignal, nativeWeek, witness) };
  signal.throwIfAborted();
  phaseSignal.throwIfAborted();
  const workerId = randomUUID();
  // All public intakes share one owner and a minimum minute between successful steps.
  const claim = await (phase?.jobs ?? jobs).acquireJob({ jobKey: PUBLIC_INTAKE_JOB, jobType: PUBLIC_INTAKE_JOB, workerId,
    scheduledFor: new Date(Math.floor(now().getTime() / 60_000) * 60_000).toISOString(),
    leaseSeconds: 25, minimumIntervalSeconds: 60, payload: mode === 'player-directory'
      ? { policy: 'public-player-directory-v1', mode: 'player-directory' } : refresh
      ? { policy: 'public-data-refresh-v1', mode: 'recurring' } : { requestId, policy: 'public-data-intake-v1' } });
  if (claim.kind !== 'acquired') return { status: 'busy', providerRequests: 0 };
  const fence = { jobKey: PUBLIC_INTAKE_JOB, workerId, generation: claim.attempt,
    deadlineAt: new Date(Math.min(now().getTime() + 20_000,
      dependencies.deadlineAt ? Date.parse(dependencies.deadlineAt) : Infinity)).toISOString() };
  let work: Awaited<ReturnType<PublicIntakeStore['next']>> | undefined;
  let requests = 0;
  let selected: PublicDataRefreshSelected | null = null;
  let selectionFailure: PublicDataRefreshSelectionFailure | undefined;
  try {
    signal.throwIfAborted();
    phaseSignal.throwIfAborted();
    if (mode === 'player-directory') {
      if (!administration.enabled || !administration.beginPlayerDirectoryAttempt || !administration.recordPlayerDirectoryCapture) {
        throw new Error('Player directory persistence is unavailable.');
      }
      // The DB clock reserves both the once-daily full GET and the shared minute
      // admission under this exact job fence before any provider work begins.
      const reservation = await administration.beginPlayerDirectoryAttempt(randomUUID(), fence);
      if (reservation.status === 'backoff') {
        if (!await jobs.completeJob(PUBLIC_INTAKE_JOB, workerId)) throw new Error('Intake lease lost.');
        return { status: 'backoff', resource: 'player-directory', providerRequests: 0 };
      }
      signal.throwIfAborted();
      const capture = await loadCompletePlayerCatalog({ attempt: reservation.attempt, signal });
      requests = capture.providerRequests;
      const result = await recordCapturedPlayerDirectory(reservation.attempt, capture, { store: administration, fence, signal });
      if (result.status === 'disabled') throw new Error('Player directory persistence was disabled.');
      if (!await jobs.completeJob(PUBLIC_INTAKE_JOB, workerId)) throw new Error('Intake lease lost.');
      return { status: result.status === 'preserved' ? 'unavailable' : 'progress',
        resource: 'player-directory', providerRequests: requests, result };
    }
    if (refresh) {
      // No target failure can be attributed to setup/claim exhaustion. Once this
      // call starts, a null acknowledgment may still have a durable owner binding.
      selectionFailure = 'selection-failed';
      const selection = await (phase?.refresh ?? refresh).select(fence);
      if (selection.status !== 'selected') {
        selectionFailure = undefined;
        if (!await jobs.completeJob(PUBLIC_INTAKE_JOB, workerId)) throw new Error('Intake lease lost.');
        return { status: selection.status, providerRequests: 0 };
      }
      selected = selection;
      requestId = selection.requestId;
      selectionFailure = 'request-state-failed';
    }
    if (!requestId) throw new Error('Intake request binding unavailable.');
    signal.throwIfAborted();
    phaseSignal.throwIfAborted();
    await phaseIntake.recover(requestId, fence);
    phaseSignal.throwIfAborted();
    work = await phaseIntake.next(requestId);
    if (typeof work === 'string') {
      selectionFailure = undefined;
      if (!await jobs.completeJob(PUBLIC_INTAKE_JOB, workerId)) throw new Error('Intake lease lost.');
      return { status: work, providerRequests: 0 };
    }
    signal.throwIfAborted();
    phaseSignal.throwIfAborted();
    if (refresh) selectionFailure = 'admission-unconfirmed';
    if (!await phaseIntake.admit(work, fence)) {
      selectionFailure = undefined;
      if (!await jobs.completeJob(PUBLIC_INTAKE_JOB, workerId)) throw new Error('Intake lease lost.');
      return { status: 'backoff', providerRequests: 0 };
    }
    selectionFailure = undefined; // Durable admission owns all subsequent failure/recovery accounting.
    signal.throwIfAborted();
    const selectedWork = work;
    const captureWitness = async (mapping: AdministrationSourceMapping | null, attempts: Readonly<Record<string, string>> = {}) => {
      if (!intake.captureWitness) return undefined;
      const value = await intake.captureWitness(selectedWork, mapping, fence);
      signal.throwIfAborted();
      return validateRequestedPublicCaptureWitness(value, selectedWork, mapping, fence, attempts);
    };
    if (work.kind === 'identity') {
      const witness = await captureWitness(null);
      requests++;
      const capture = await (witness ? source.identity(work.username, signal, witness) : source.identity(work.username, signal));
      if (witness) assertOriginalPublicCapture(capture, witness);
      await intake.recordIdentity(work, capture, fence);
    } else if (work.kind === 'leagues') {
      const witness = await captureWitness(null);
      requests++;
      const capture = await (witness ? source.leagues(work.userId, work.season, signal, witness) : source.leagues(work.userId, work.season, signal));
      if (witness) assertOriginalPublicCapture(capture, witness);
      await intake.recordLeagues(work, capture, fence);
    } else if (work.kind === 'bootstrap') {
      const witness = await captureWitness(null);
      requests++;
      const capture = await source.core(work.externalLeagueId, 'league', signal, witness);
      if (witness) assertOriginalPublicCapture(capture, witness);
      await intake.register(work, capture, fence);
    } else {
      const mapping = await administration.readSourceMapping(work.externalLeagueId);
      if (!mapping || mapping.scope.season !== work.season || mapping.scope.externalLeagueId !== work.externalLeagueId) {
        throw new Error('Intake mapping unavailable.');
      }
      const observations: { league?: string; rosters?: string; users?: string } = {};
      if (work.kind === 'exact-matchups') {
        const nativeWeek = work.nativeWeek;
        if (!source.exactPeriod) throw new Error('Exact-period capture is unsupported by this source.');
        const settings = await administration.beginLeagueSettingsAttempt(mapping, randomUUID(), fence);
        const matchups = await administration.beginExactMatchupAttempt(mapping, work.nativeWeek, randomUUID(), fence);
        const witness = await captureWitness(mapping, { settings: settings.id, matchups: matchups.id });
        // Both reservations precede both requests. No HTTP occurs inside a transaction.
        signal.throwIfAborted();
        requests += 2;
        const results = await Promise.allSettled([
          source.core(work.externalLeagueId, 'league', signal, witness), source.exactPeriod(work.externalLeagueId, work.nativeWeek, signal, witness),
        ]);
        const documents = results.flatMap((result, index) => {
          if (result.status !== 'fulfilled') return [];
          const document = result.value;
          if (document.family !== (index === 0 ? 'league' : 'matchups') || document.week !== (index === 0 ? null : nativeWeek)
            || document.origin !== 'network' || document.sourceObservedAt !== document.requestCompletedAt) {
            throw new Error('Exact-period source returned a different capture.');
          }
          return [document];
        });
        const captured = await recordCapturedAdministration(mapping.scope, documents, { store: administration,
          signal, fence, mapping, leagueSettingsAttempt: settings, matchupAttempt: { week: work.nativeWeek, attempt: matchups }, now,
          expectedAcquisition: witness });
        const league = captured.results.find(entry => entry.family === 'league')?.result;
        const matchup = captured.results.find(entry => entry.family === 'matchups')?.result;
        if (!league?.observationId || !matchup?.observationId || league.leagueSettingsAcceptance?.status !== 'accepted'
          || matchup.matchupAcceptance?.status !== 'accepted') throw new Error('Exact-period typed capture remains incomplete.');
        await intake.completeExactPeriod(work, mapping, { observations: { league: league.observationId, matchups: matchup.observationId },
          receipts: { settings: league.leagueSettingsAcceptance.receiptId, matchups: matchup.matchupAcceptance.receiptId } }, fence);
      } else if (work.kind === 'core') {
        const attempts = await administration.beginRosterCapture(mapping, randomUUID(), randomUUID(), fence);
        const settings = await administration.beginLeagueSettingsAttempt(mapping, randomUUID(), fence);
        let managerEvidenceAttempt;
        if (dependencies.managerEvidenceVersion === 'v2') {
          if (!administration.beginTeamManagerEvidenceAttempt) throw new Error('Manager evidence v2 capture is unsupported by this store.');
          managerEvidenceAttempt = await administration.beginTeamManagerEvidenceAttempt(mapping, randomUUID(), fence);
        }
        const witness = await captureWitness(mapping, { settings: settings.id, players: attempts.players.id,
          managers: attempts.managers.id, ...(managerEvidenceAttempt ? { managersV2: managerEvidenceAttempt.id } : {}) });
        // The league request follows all resource reservations; its independently accepted
        // population proof belongs to this exact roster acquisition and mapping.
        requests += 2;
        const results = await Promise.allSettled([
          source.core(work.externalLeagueId, 'league', signal, witness), source.core(work.externalLeagueId, 'rosters', signal, witness),
        ]);
        const documents = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
        const captured = await recordCapturedAdministration(mapping.scope, documents, { store: administration,
          signal, fence, mapping, rosterAttempt: attempts.players, managerAttempt: attempts.managers,
          leagueSettingsAttempt: settings, now, expectedAcquisition: witness,
          ...(managerEvidenceAttempt ? { managerEvidenceVersion: 'v2', managerEvidenceAttempt } : {}) });
        const league = captured.results.find(entry => entry.family === 'league')?.result;
        const roster = captured.results.find(entry => entry.family === 'rosters')?.result;
        if (!league?.observationId || !roster?.observationId
          || league.leagueSettingsAcceptance?.status !== 'accepted'
          || roster.rosterAcceptance?.status !== 'accepted' || roster.teamManagerAcceptance?.status !== 'accepted') {
          throw new Error('Current typed core capture remains incomplete.');
        }
        // Commit core before any optional work. Receipt IDs bind this request to
        // actual typed acceptance; a preserved older head cannot complete it.
        await intake.completeCore(work, mapping, { observations: { league: league.observationId, rosters: roster.observationId },
          receipts: { settings: league.leagueSettingsAcceptance.receiptId, players: roster.rosterAcceptance.receiptId,
            managers: roster.teamManagerAcceptance.receiptId } }, fence);
      } else {
        const witness = await captureWitness(mapping);
        requests++;
        const directoryCapture = await source.core(work.externalLeagueId, 'users', signal, witness);
        const captured = await recordCapturedAdministration(mapping.scope, [directoryCapture],
          { store: administration, signal, fence, now, expectedAcquisition: witness });
        const entry = captured.results[0]?.result;
        if (entry && ['changed', 'unchanged', 'replayed'].includes(entry.status)) observations.users = entry.observationId;
        if (!observations.users) throw new Error('Directory evidence remains unavailable.');
        await intake.completeCore(work, mapping, { observations, directoryCapture }, fence);
      }
    }
    signal.throwIfAborted();
    if (!await jobs.completeJob(PUBLIC_INTAKE_JOB, workerId)) throw new Error('Intake lease lost.');
    return { status: 'progress', resource: work.kind, providerRequests: requests };
  } catch {
    const cleanup = phase && selectionFailure ? phase.cleanup() : dependencies.cleanup?.() ?? { intake, jobs, refresh };
    if (refresh && selectionFailure && !signal.aborted) {
      // SQL first reconciles this exact owner's persisted selection/dispatch. An
      // unknown acknowledgment must never create another cycle or double credit.
      await (cleanup.refresh ?? refresh).recordSelectionFailure(selected, fence, selectionFailure).catch(() => undefined);
    }
    if (work && typeof work === 'object') await cleanup.intake.fail(work, fence).catch(() => undefined);
    await cleanup.jobs.failJob(PUBLIC_INTAKE_JOB, workerId, 'public-data-intake-step-failed').catch(() => false);
    return { status: 'unavailable', ...(mode === 'player-directory' ? { resource: 'player-directory' as const }
      : work && typeof work === 'object' ? { resource: work.kind } : {}), providerRequests: requests };
  }
}
