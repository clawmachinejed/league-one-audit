/** CP22 test executable. Every mutation/recovery is the existing production
 * owner. Wrappers only stop at completed SQL boundaries; IPC cannot release a
 * death barrier. The parent must terminate the OS process. */
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { DatabaseClient, DatabaseRow } from '../lib/database';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from '../lib/league-administration/store';
import { runPublicIntakeStep, runPublicDataRefreshStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { createProjectionStore } from '../lib/projection-store';
import { createIndependentDatabase } from './neon-integration-harness';
import { assertProcessRecoverySupportSources } from './qualification-profile';
import { fixtureFetch, parseRecoveryWorkerConfig, recoveryWorkerEnvironment, assertRecoveryStart, PROCESS_RECOVERY_CONFIG, PROCESS_RECOVERY_DATABASE,
  PROCESS_RECOVERY_VERSION, type RecoveryMessage } from './process-recovery-protocol';

async function main() {
  const config = parseRecoveryWorkerConfig(JSON.parse(process.env[PROCESS_RECOVERY_CONFIG] ?? 'null'));
  const url = process.env[PROCESS_RECOVERY_DATABASE];
  if (!url || !process.send || process.env.NODE_OPTIONS) throw new Error('CP22 worker launch is incomplete.');
  recoveryWorkerEnvironment({}, url, config); // Validate the explicit child URL before opening it.
  await assertProcessRecoverySupportSources(fileURLToPath(new URL('..', import.meta.url)));
  const connection = createIndependentDatabase(url);
  let requests = 0;
  let owner: Pick<RecoveryMessage, 'workerId' | 'generation' | 'deadlineAt' | 'resource' | 'requestId'> = {};
  try {
    const [session] = await connection.database.query(`SELECT current_user,session_user,current_database() AS database,
      current_setting('neon.branch_id',true) AS branch,pg_backend_pid() AS pid,
      (SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS backend_start,
      (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit OR rolbypassrls
        FROM pg_roles WHERE rolname=current_user) AS elevated`);
    if (session.current_user !== 'league_one_runtime' || session.session_user !== 'league_one_runtime' || session.elevated !== false
      || session.database !== config.expectedDatabase || session.branch !== config.expectedBranch) {
      throw new Error('CP22 worker requires actual restricted LOGIN.');
    }
    const send = async (type: RecoveryMessage['type'], extra: Partial<RecoveryMessage> = {}) => {
      const [live] = await connection.database.query(`SELECT pg_backend_pid() AS pid,
        (SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS backend_start`);
      if (live.pid !== session.pid || live.backend_start !== session.backend_start) throw new Error('CP22 backend identity changed.');
      const message = { version: PROCESS_RECOVERY_VERSION, nonce: config.nonce, contextNonce: config.contextNonce,
        gitSha: config.gitSha, profileDigest: config.profileDigest, pid: process.pid, type, backendPid: Number(session.pid), backendStart: String(session.backend_start),
        database: String(session.database), branch: String(session.branch), currentUser: 'league_one_runtime',
        sessionUser: 'league_one_runtime', at: new Date().toISOString(), requests, ...owner, ...extra };
      await new Promise<void>((resolve, reject) => process.send!(message, error => error ? reject(new Error('CP22 IPC unavailable.')) : resolve()));
    };
    // This keeps the runtime/IPC live without running another owner or cleanup.
    const barrier = async (name: typeof config.barrier): Promise<void> => {
      if (config.barrier !== name) return;
      await send('barrier', { barrier: name });
      await new Promise<never>(() => { setInterval(() => undefined, 1_000); });
    };
    globalThis.fetch = fixtureFetch(config.fixtureId, () => { requests++; });
    const original = connection.database;
    const database: DatabaseClient = { ...original,
      queryAfterLock: async <Row extends DatabaseRow>(...args: Parameters<NonNullable<DatabaseClient['queryAfterLock']>>) => {
        const registration = args[0].includes('projection-store:register-league-season-official-data');
        try {
          const result = await original.queryAfterLock!<Row>(...args);
          if (registration) await barrier('bootstrap-committed');
          return result;
        } catch (error) {
          if (registration && error instanceof Error && error.message === 'public intake lease lost'
            && 'code' in error && error.code === 'P0001') {
            // A genuine DB rollback/postcondition error is required, and the
            // parent independently verifies elapsed fence + empty durable rows.
            await barrier('bootstrap-rolled-back');
          }
          throw error;
        }
      } };
    const intake = createPublicIntakeStore(database), administration = createLeagueAdministrationStore(database);
    const jobs = createProjectionStore(database), refresh = createPublicDataRefreshStore(database);
    const dependencies: PublicIntakeDependencies = {
      intake: { ...intake,
        admit: async (work, fence) => {
          const admitted = await intake.admit(work, fence);
          if (admitted) {
            owner = { workerId: fence.workerId, generation: fence.generation, deadlineAt: fence.deadlineAt,
              resource: work.kind, requestId: work.requestId };
            await send('admitted');
            if (work.kind === 'drafts' && work.resource === 'detail') await barrier('draft-admitted');
          }
          return admitted;
        },
        completeCore: async (...args) => {
          if (args[0].kind === 'core') await barrier('core-all-accepted');
          await intake.completeCore(...args);
          if (args[0].kind === 'users') await barrier('users-checkpoint');
        },
      },
      administration: { ...administration, recordObservation: async (...args) => {
        const result = await administration.recordObservation(...args);
        if (owner.resource === 'core' && args[0].envelope.family === 'league' && result.leagueSettingsAcceptance?.status === 'accepted') {
          await barrier('core-first-accepted');
        }
        return result;
      } },
      jobs: { ...jobs, acquireJob: async input => {
        const claimed = await jobs.acquireJob(input);
        if (claimed.kind === 'acquired') {
          owner = { workerId: input.workerId, generation: claimed.attempt };
          await send('claim');
        }
        return claimed;
      } },
    };
    const observedRefresh = { ...refresh, select: async (...args: Parameters<typeof refresh.select>) => {
      const selected = await refresh.select(...args);
      if (selected.status === 'selected') {
        owner = { ...owner, deadlineAt: args[0].deadlineAt, requestId: selected.requestId };
        await barrier('refresh-selected');
      }
      return selected;
    } };
    const started = new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer); process.off('message', onMessage); process.off('disconnect', onDisconnect);
        if (error) reject(error); else resolve();
      };
      const onMessage = (value: unknown) => {
        try { assertRecoveryStart(value, config); finish(); }
        catch { finish(new Error('CP22 start acknowledgment rejected.')); }
      };
      const onDisconnect = () => finish(new Error('CP22 parent disconnected before start.'));
      const timer = setTimeout(() => finish(new Error('CP22 startup acknowledgment deadline exceeded.')), 15_000);
      process.once('message', onMessage); process.once('disconnect', onDisconnect);
    });
    // Parent independently inspects this live backend before permitting any job
    // claim. No startup race can turn a fast zero-GET step into missing evidence.
    await Promise.all([send('ready'), started]);
    const deadline = Date.now() + 235_000;
    while (Date.now() < deadline) {
      requests = 0;
      const signal = AbortSignal.timeout(20_000);
      const result = config.mode === 'intake'
        ? await runPublicIntakeStep(config.requestId, dependencies, signal)
        : await runPublicDataRefreshStep({ ...dependencies, refresh: observedRefresh }, signal);
      if (result.providerRequests !== requests) throw new Error('CP22 acquisition accounting mismatch.');
      if (result.status === 'busy' || config.untilProgress && result.status === 'backoff') { await delay(250); continue; }
      await send('result', { status: result.status, ...('resource' in result ? { resource: result.resource } : {}) });
      return;
    }
    throw new Error('CP22 real-clock worker allowance exceeded.');
  } finally { await connection.close(); }
}
// Driver/SQL error strings are deliberately never serialized or printed.
main().then(() => { process.disconnect?.(); }, () => { process.exitCode = 1; process.disconnect?.(); });
