/** Fixed CP25 child: real production facade and DATA HTTP composition. The
 * empty/inactive registry deliberately preserves its real primary rejection. */
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { getDatabase } from '../lib/database';
import { runProductionProjectionSync } from '../lib/projections/runtime/projection-dispatch';
import { createIndependentPinnedDatabase } from './neon-integration-harness';
import { assertRunnerCyclesSupportSources } from './qualification-profile';
import { RUNNER_CONFIG, RUNNER_VERSION, parseRunnerConfig, parseRunnerCommand, runnerEnvironment, runnerFetch, runnerTimestamp,
  type RunnerCommand, type RunnerMessage } from './runner-cycles-protocol';

async function main() {
  const config = parseRunnerConfig(JSON.parse(process.env[RUNNER_CONFIG] ?? 'null'));
  const url = process.env.DATABASE_URL;
  if (!url || !process.send || process.env.NODE_OPTIONS) throw new Error('CP25 child launch incomplete.');
  runnerEnvironment({},url,config);
  await assertRunnerCyclesSupportSources(fileURLToPath(new URL('..',import.meta.url)));
  const commands: RunnerCommand[] = []; let sequence = 0, failed = false, disconnected = false;
  process.on('message', value => { try { commands.push(parseRunnerCommand(value,config,++sequence)); } catch { failed = true; } });
  process.once('disconnect', () => { disconnected = true; });
  const expires = Date.now() + 1_650_000;
  async function command(signal?: AbortSignal|null) {
    while (!commands.length) { signal?.throwIfAborted(); if (failed || disconnected || Date.now() >= expires) throw new Error('CP25 control closed.'); await delay(10); }
    if (failed) throw new Error('CP25 invalid control.'); return commands.shift()!;
  }
  const connection = await createIndependentPinnedDatabase(url);
  try {
    const identity = `SELECT current_user,session_user,current_database() AS database,current_setting('neon.branch_id',true) AS branch,
      pg_backend_pid() AS pid,(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS backend_start,
      (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS elevated`;
    const [session] = await connection.database.query(identity);
    const http = getDatabase(); if (!http.enabled) throw new Error('CP25 production HTTP database disabled.');
    const [httpIdentity] = await http.query(identity);
    for (const row of [session,httpIdentity]) if (row.current_user !== 'league_one_runtime' || row.session_user !== 'league_one_runtime'
      || row.database !== config.expectedDatabase || row.branch !== config.expectedBranch || row.elevated !== false) throw new Error('CP25 actual restricted LOGIN mismatch.');
    let invocation = 0, gets = 0, sqlRequests = 0, signalRequests = 0, variant: 1|2 = 1, holdIdentity = false;
    let paths: string[] = [], invocationStartedAt: string|null = null;
    const send = async (type: RunnerMessage['type']) => {
      const [live] = await connection.database.query('SELECT pg_backend_pid() AS pid');
      if (live.pid !== session.pid) throw new Error('CP25 pinned backend changed.');
      const message: RunnerMessage = { version: RUNNER_VERSION, nonce: config.nonce, contextNonce: config.contextNonce, gitSha: config.gitSha,
        profileDigest: config.profileDigest, pid: process.pid, backendPid: Number(session.pid), backendStart: String(session.backend_start),
        database: String(session.database), branch: String(session.branch), sessionUser: 'league_one_runtime', currentUser: 'league_one_runtime',
        httpSessionUser: 'league_one_runtime', httpCurrentUser: 'league_one_runtime', type, invocation, at: new Date().toISOString(), gets,
        sqlRequests, signalRequests, paths, invocationStartedAt, facade: type === 'result' ? 'registry-unavailable' : 'not-run' };
      await new Promise<void>((resolve,reject) => process.send!(message,error => error ? reject(new Error('CP25 evidence unavailable.')) : resolve()));
    };
    globalThis.fetch = runnerFetch({ runtimeUrl: url, fixtureId: config.fixtureId, variant: () => variant, originalFetch: globalThis.fetch,
      sql: signal => { sqlRequests++; if (signal) signalRequests++; }, source: async (path,signal) => {
        gets++; paths.push(path);
        if (holdIdentity && /^\/v1\/user\/[^/]+$/u.test(path)) { holdIdentity = false; await send('barrier'); if ((await command(signal)).action !== 'release') throw new Error('CP25 barrier release missing.'); }
      } });
    await send('ready');
    while (Date.now() < expires) {
      const next = await command(); if (next.action === 'stop') return;
      if (next.action !== 'invoke') throw new Error('CP25 release outside acquisition.');
      invocation++; gets = 0; sqlRequests = 0; signalRequests = 0; paths = []; variant = next.variant; holdIdentity = next.holdIdentity;
      let rejected = false;
      const startedAt = Date.now(); invocationStartedAt = runnerTimestamp(new Date(startedAt));
      try {
        await runProductionProjectionSync(next.selection === 'omitted' ? { invocationStartedAt: startedAt } : { invocationStartedAt: startedAt,
          publicDataRefresh: { enabled: next.selection === 'enabled', managerEvidenceVersion: 'v2' } as never });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'No accepted league enrollment is available.') throw new Error('CP25 unexpected facade outcome.');
        rejected = true;
      }
      if (!rejected) throw new Error('CP25 primary registry unexpectedly active.');
      await send('result');
    }
    throw new Error('CP25 worker lifetime exceeded.');
  } finally { await connection.close(); }
}
// Never serialize database errors, URLs, SQL parameters or inherited secrets.
main().then(() => { process.disconnect?.(); }, () => { process.exitCode = 1; process.disconnect?.(); });
