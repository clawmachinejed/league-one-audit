/** CP23 executable: existing ordinary runner/store SQL owns every positive
 * operation. IPC gates timing only; it cannot choose work or edit durable state. */
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { DatabaseClient, DatabaseRow } from '../lib/database';
import type { PublicIntakeWork } from '../lib/league-administration/public-intake-contracts';
import type { AdministrationWriteFence } from '../lib/league-administration/contracts';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from '../lib/league-administration/store';
import { runPublicIntakeStep, runPublicDataRefreshStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { createProjectionStore } from '../lib/projection-store';
import { createIndependentPinnedDatabase } from './neon-integration-harness';
import { assertCompetingWorkersSupportSources } from './qualification-profile';
import { CONTENTION_CONFIG, CONTENTION_DATABASE, CONTENTION_VERSION, STALE_PROBES, contentionEnvironment, contentionFetch,
  createContentionDiagnosticReporter, createContentionSelectionFault, runContentionSession, assertContentionBackendIdentity, isContentionFenceRejection, parseContentionConfig, parseContentionControl,
  type ContentionMessage, type ContentionPhase, type Control } from './competing-workers-protocol';

let phase: ContentionPhase = 'configuration';
let reportFailure: ReturnType<typeof createContentionDiagnosticReporter> | undefined;
let originalFailure: Awaited<ReturnType<typeof runContentionSession>>;
async function main() {
  const config = parseContentionConfig(JSON.parse(process.env[CONTENTION_CONFIG] ?? 'null'));
  reportFailure = createContentionDiagnosticReporter(config,process.pid,process.send
    ? (value,callback) => process.send!(value,callback) : undefined);
  const url = process.env[CONTENTION_DATABASE];
  if (!url || !process.send || process.env.NODE_OPTIONS) throw new Error('CP23 worker launch incomplete.');
  contentionEnvironment({}, url, config);
  phase = 'source';
  await assertCompetingWorkersSupportSources(fileURLToPath(new URL('..', import.meta.url)));
  const commands: Control[] = [];
  let sequence = 0, controlFailure = false, disconnected = false;
  process.on('message', value => { try { commands.push(parseContentionControl(value, config, ++sequence)); } catch { controlFailure = true; } });
  process.once('disconnect', () => { disconnected = true; });
  const absoluteDeadline = Date.now() + 535_000;
  const command = async () => {
    phase = 'control';
    while (!commands.length) {
      if (controlFailure || disconnected || Date.now() >= absoluteDeadline) throw new Error('CP23 control lifecycle failed.');
      await delay(10);
    }
    if (controlFailure) throw new Error('CP23 invalid control.');
    return commands.shift()!;
  };
  phase = 'session-open';
  const connection = await createIndependentPinnedDatabase(url);
  const selectionFault = createContentionSelectionFault(config);
  let requests = 0, step = 0, usedSpecial = false;
  let owner: Pick<ContentionMessage,'workerId'|'generation'|'deadlineAt'|'leaseUntil'|'requestId'|'resource'> = {};
  let admittedWork: PublicIntakeWork | undefined, admittedFence: AdministrationWriteFence | undefined;
  originalFailure = await runContentionSession(async () => {
    phase = 'session-identity';
    const [session] = await connection.database.query(`SELECT current_user,session_user,current_database() AS database,
      current_setting('neon.branch_id',true) AS branch,pg_backend_pid() AS pid,
      (SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS backend_start,
      (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS elevated`);
    if (session.current_user !== 'league_one_runtime' || session.session_user !== 'league_one_runtime' || session.elevated !== false
      || session.database !== config.expectedDatabase || session.branch !== config.expectedBranch) throw new Error('CP23 requires actual restricted LOGIN.');
    const send = async (type: ContentionMessage['type'], extra: Partial<ContentionMessage> = {}) => {
      const previousPhase = phase; phase = 'evidence';
      const [live] = await connection.database.query(`SELECT pg_backend_pid() AS pid,(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS backend_start`);
      assertContentionBackendIdentity(session,live);
      const message: ContentionMessage = { version: CONTENTION_VERSION, nonce: config.nonce, contextNonce: config.contextNonce,
        gitSha: config.gitSha, profileDigest: config.profileDigest, pid: process.pid, backendPid: Number(session.pid), backendStart: String(session.backend_start),
        database: String(session.database), branch: String(session.branch), currentUser: 'league_one_runtime', sessionUser: 'league_one_runtime',
        type, at: new Date().toISOString(), step, requests, ...owner, ...extra };
      await new Promise<void>((resolve,reject) => process.send!(message, error => error ? reject(new Error('CP23 IPC failed.')) : resolve()));
      phase = previousPhase;
    };
    const barrier = async (name: NonNullable<ContentionMessage['barrier']>) => {
      await send('barrier', { barrier: name });
      if (await command() !== 'release') throw new Error('CP23 barrier requires its fixed release.');
      phase = 'step';
    };
    globalThis.fetch = contentionFetch(config, () => { requests++; });
    const original = connection.database;
    const database: DatabaseClient = { ...original, queryAfterLock: async <Row extends DatabaseRow>(...args: Parameters<NonNullable<DatabaseClient['queryAfterLock']>>) => {
      try { return await original.queryAfterLock!<Row>(...args); }
      catch (error) {
        if (config.action === 'bootstrap-lock' && args[0].includes('projection-store:register-league-season-official-data')
          && error instanceof Error && error.message === 'public intake lease lost' && 'code' in error && error.code === 'P0001') {
          await send('barrier', { barrier: 'rolled-back' });
        }
        throw error;
      }
    } };
    const intake = createPublicIntakeStore(database), administration = createLeagueAdministrationStore(database);
    const jobs = createProjectionStore(database), refresh = createPublicDataRefreshStore(database);
    // Expected SQL guard errors roll back within the reserved session.
    // This wrapper remains ONLY for negative probes/cleanup, never positive work.
    // Existing queryAfterLock rolls back actual store SQL plus a harmless SELECT1.
    const negative: DatabaseClient = { enabled: true, query: async <Row extends DatabaseRow>(statement: string, parameters: readonly unknown[] = []) =>
      (await original.queryAfterLock!<Row>(statement, parameters, { statement: 'SELECT 1', parameters: [] }))[1] };
    const reject = async (operation: () => Promise<unknown>, family: 'intake'|'acceptance'='intake') => {
      try { await operation(); } catch (error) {
        if (isContentionFenceRejection(error,family)) return;
        throw new Error('CP23 stale rejection was not an installed SQL guard.');
      }
      throw new Error('CP23 stale operation was accepted.');
    };
    const dependencies: PublicIntakeDependencies = {
      intake: { ...intake, admit: async (work,fence) => {
        const admitted = await intake.admit(work,fence);
        if (admitted) {
          if (!['bootstrap','core','users'].includes(work.kind)) throw new Error('CP23 unexpected admitted resource.');
          admittedWork = work; admittedFence = fence;
          owner = { ...owner, deadlineAt: fence.deadlineAt, requestId: work.requestId, resource: work.kind as 'bootstrap'|'core'|'users' };
          await send('admitted'); await barrier('admitted');
        }
        return admitted;
      } },
      administration: { ...administration, recordObservation: async (...args) => {
        if (config.action === 'stale-core' && !usedSpecial && owner.resource === 'core') {
          usedSpecial = true; await barrier('captured-core');
          if (!admittedWork || !admittedFence) throw new Error('CP23 original work missing.');
          const staleIntake = createPublicIntakeStore(negative), staleAdministration = createLeagueAdministrationStore(negative);
          await reject(() => staleIntake.admit(admittedWork!,admittedFence!));
          await reject(() => staleAdministration.recordObservation(...args),'acceptance');
          await reject(() => staleIntake.fail(admittedWork!,admittedFence!));
          if (await jobs.completeJob(admittedFence.jobKey,admittedFence.workerId)
            || await jobs.failJob(admittedFence.jobKey,admittedFence.workerId,'cp23-stale-probe')) throw new Error('CP23 stale job transition accepted.');
          await send('probes', { rejected: STALE_PROBES });
          throw new Error('CP23 deliberately abandoned stale capture.');
        }
        return administration.recordObservation(...args);
      } },
      jobs: { ...jobs, acquireJob: async input => {
        await send('attempt');
        const claim = await jobs.acquireJob(input);
        if (claim.kind === 'acquired') { owner = { workerId: input.workerId, generation: claim.attempt, leaseUntil: claim.leaseUntil }; await send('claim'); }
        return claim;
      } },
      ...(['stale-core','bootstrap-lock'].includes(config.action) ? { cleanup: () => ({ jobs, intake: {
        fail: async (...args: Parameters<typeof intake.fail>) => {
          await reject(() => createPublicIntakeStore(negative).fail(...args));
          await send('cleanup');
          throw new Error('CP23 observed expected expired cleanup rejection.');
        },
      } }) } : {}),
    };
    const observedRefresh = { ...refresh, select: async (fence: AdministrationWriteFence) => {
      const selected = await refresh.select(fence);
      if (selected.status === 'selected') {
        owner = { ...owner, deadlineAt: fence.deadlineAt, requestId: selected.requestId };
        if (config.action === 'hold-selected' && !usedSpecial) { usedSpecial = true; await barrier('selected'); }
        if (config.action === 'selection-failure' && config.faultFixture) {
          const [request] = await database.query('SELECT username FROM public_data_intakes WHERE id=$1',[selected.requestId]);
          selectionFault(String(request.username));
        }
      }
      return selected;
    } };
    await send('ready');
    while (Date.now() < absoluteDeadline) {
      const next = await command();
      if (next === 'stop') return;
      if (next !== 'step') throw new Error('CP23 received release outside its barrier.');
      phase = 'step';
      step++; requests = 0; owner = {}; admittedWork = undefined; admittedFence = undefined;
      const result = config.requestId
        ? await runPublicIntakeStep(config.requestId, dependencies, AbortSignal.timeout(20_000))
        : await runPublicDataRefreshStep({ ...dependencies, refresh: observedRefresh }, AbortSignal.timeout(20_000));
      if (result.providerRequests !== requests) throw new Error('CP23 actual acquisition accounting differs.');
      await send('result', { status: result.status, ...('resource' in result && result.resource ? { resource: result.resource as 'bootstrap'|'core'|'users' } : {}) });
    }
    throw new Error('CP23 worker elapsed limit exhausted.');
  }, async () => {phase = 'cleanup'; await connection.close();}, () => phase);
  if (originalFailure) throw originalFailure.error;
}
main().then(() => { process.disconnect?.(); }, async error => {
  process.exitCode = 1;
  await reportFailure?.(originalFailure?.phase ?? phase, originalFailure?.error ?? error, originalFailure?.cleanupFailed ?? false);
  process.disconnect?.();
});
