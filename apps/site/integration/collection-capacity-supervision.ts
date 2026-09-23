import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';

export const CAPACITY_MUTEX = 'league-one-auth-integration-credential';
export const CAPACITY_RECEIPT_KIND = 'collection-capacity-supervision-v1';
export const CAPACITY_OWNER_ENV = 'COLLECTION_CAPACITY_OWNER_PROOF';
type Row = Readonly<Record<string, unknown>>;
export type CapacityQuery = (statement: string, parameters?: readonly unknown[]) => Promise<readonly Row[]>;
export type CapacityBackend = Readonly<{
  pid: number; role: string; state: string; backendStart: string; transactionStart: string | null;
}>;
export type CapacitySnapshot = Readonly<{
  database: string; branch: string; relations: number; otherSessions: number; backends: readonly CapacityBackend[];
}>;
type Target = Readonly<{ database: string; branch: string }>;
export type CapacityOwnerProof = Target & Readonly<{
  pid: number; backendStart: string; applicationName: string;
}>;

export async function capacitySessionSnapshot(query: CapacityQuery): Promise<CapacitySnapshot> {
  const rows = await query(`SELECT current_database() AS database,current_setting('neon.branch_id',true) AS branch,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN('public','website_auth') AND c.relkind IN('r','p','v','m','S','f')) AS relations,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()
      AND pid<>pg_backend_pid() AND backend_type='client backend') AS "otherSessions",
    (SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'role',usename,'state',state,
      'backendStart',backend_start,'transactionStart',xact_start)), '[]'::jsonb)
      FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
        AND backend_type='client backend') AS backends`);
  assert.equal(rows.length, 1);
  return rows[0] as CapacitySnapshot;
}

export function validateCapacitySnapshot(snapshot: CapacitySnapshot, target: Target): void {
  assert.equal(snapshot.database, target.database);
  assert.equal(snapshot.branch, target.branch);
  assert.ok(Number.isSafeInteger(snapshot.relations) && snapshot.relations >= 0);
  assert.ok(Number.isSafeInteger(snapshot.otherSessions) && snapshot.otherSessions >= 0);
  assert.ok(Array.isArray(snapshot.backends));
  assert.equal(snapshot.backends.length, snapshot.otherSessions);
}

const backendKey = (backend: CapacityBackend) => `${backend.pid}:${backend.backendStart}`;

/** Historical receipts admit only the exact idle backend identities observed
 * after a closed, cleaned run, never every session born in an old time window. */
export function priorCapacityBackends(receipts: readonly unknown[], target: Target): ReadonlySet<string> {
  const allowed = new Set<string>();
  for (const input of receipts) {
    if (!input || typeof input !== 'object') continue;
    const receipt = input as Record<string, unknown>;
    if (receipt.kind !== CAPACITY_RECEIPT_KIND || receipt.database !== target.database || receipt.branch !== target.branch) continue;
    if (receipt.childPid !== undefined && receipt.childClosed !== true) {
      throw new Error('An earlier capacity child has not been confirmed closed.');
    }
    if (receipt.cleanupVerified !== true || receipt.childClosed !== true) continue;
    assert.ok(Number.isSafeInteger(receipt.childPid) && Number(receipt.childPid) > 0);
    const from = Date.parse(String(receipt.startedAt));
    const to = Date.parse(String(receipt.finishedAt));
    assert.ok(Number.isFinite(from) && Number.isFinite(to) && from <= to);
    const before = receipt.before as CapacitySnapshot;
    const after = receipt.after as CapacitySnapshot;
    validateCapacitySnapshot(before, target); validateCapacitySnapshot(after, target);
    assert.equal(before.relations, 0); assert.equal(after.relations, 0);
    before.backends.forEach(assertIdleRuntimeBackend);
    for (const backend of after.backends) {
      assertIdleRuntimeBackend(backend);
      // Prior accepted idle sessions can precede this receipt. Their exact
      // identities were retained in its before-state and checked by that run.
      assert.ok(before.backends.some(value => backendKey(value) === backendKey(backend))
        || Date.parse(backend.backendStart) >= from && Date.parse(backend.backendStart) <= to);
      allowed.add(backendKey(backend));
    }
  }
  return allowed;
}

function assertIdleRuntimeBackend(backend: CapacityBackend): void {
  assert.ok(Number.isSafeInteger(backend.pid) && backend.pid > 0);
  assert.equal(backend.role, 'league_one_runtime');
  assert.equal(backend.state, 'idle');
  assert.equal(backend.transactionStart, null);
  assert.ok(Number.isFinite(Date.parse(backend.backendStart)));
}

export function verifyCapacityBackends(
  snapshot: CapacitySnapshot, target: Target, previous: ReadonlySet<string>, currentWindow?: readonly [number, number],
): void {
  validateCapacitySnapshot(snapshot, target);
  if (currentWindow) assert.ok(currentWindow.every(Number.isFinite) && currentWindow[0] <= currentWindow[1]);
  for (const backend of snapshot.backends) {
    assertIdleRuntimeBackend(backend);
    const started = Date.parse(backend.backendStart);
    assert.ok(previous.has(backendKey(backend)) || currentWindow && started >= currentWindow[0] && started <= currentWindow[1],
      'Unknown idle session cannot be attributed to an owned capacity run.');
  }
}

/** Executed by global setup before reset and again before its cleanup. The
 * unique marker identifies the live owner session; the database proves its lock. */
export async function assertCapacityOwner(query: CapacityQuery, target: Target, serialized: string | undefined): Promise<void> {
  if (!serialized) throw new Error('Capacity reset requires the supervised runner.');
  const proof: CapacityOwnerProof = JSON.parse(serialized);
  assert.equal(proof.database, target.database); assert.equal(proof.branch, target.branch);
  assert.ok(Number.isSafeInteger(proof.pid) && proof.pid > 0);
  assert.ok(/^capacity-owner-[a-f0-9-]{36}$/u.test(proof.applicationName));
  assert.ok(Number.isFinite(Date.parse(proof.backendStart)));
  const rows = await query(`SELECT EXISTS (
    SELECT 1 FROM pg_stat_activity activity JOIN pg_locks lock ON lock.pid=activity.pid
    WHERE activity.pid=$1::integer AND activity.datname=current_database() AND activity.usename=current_user
      AND activity.application_name=$2::text AND activity.backend_start=$3::timestamptz
      AND lock.locktype='advisory' AND lock.granted AND lock.mode='ExclusiveLock'
      AND lock.objsubid=1
      AND lock.classid=((hashtextextended($4::text,0) >> 32) & 4294967295)::oid
      AND lock.objid=(hashtextextended($4::text,0) & 4294967295)::oid
  ) AND current_database()=$5::text AND current_setting('neon.branch_id',true)=$6::text AS owned`,
  [proof.pid, proof.applicationName, proof.backendStart, CAPACITY_MUTEX, target.database, target.branch]);
  assert.deepEqual(rows, [{ owned: true }]);
}

async function stopOwnedWindowsTree(pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || process.platform !== 'win32') throw new Error('Owned Windows child is unavailable.');
  await new Promise<void>((resolve, reject) => {
    const stop = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
    let failed = false;
    const timer = setTimeout(() => { failed = true; stop.kill(); }, 10_000);
    stop.once('error', () => { failed = true; });
    stop.once('close', code => { clearTimeout(timer); if (!failed && code === 0) resolve(); else reject(new Error('Owned child tree stop failed.')); });
  });
}

type ChildOutcome = Readonly<{ closed: boolean; code: number | null; childError: boolean }>;
export function superviseCapacityChild(child: ChildProcess, signal: AbortSignal,
  killTree: (pid: number) => Promise<void> = stopOwnedWindowsTree, stopTimeoutMs = 20_000) {
  let closed = false, stopping = false, settled = false, childError = false;
  let treeFinished = false, treeVerified = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let exit: ChildOutcome = { closed: false, code: null, childError: false };
  let resolveCompletion!: (value: ChildOutcome) => void;
  const completion = new Promise<ChildOutcome>(resolve => { resolveCompletion = resolve; });
  const finish = (result: ChildOutcome) => {
    if (settled) return;
    settled = true; clearTimeout(timer); signal.removeEventListener('abort', stop); resolveCompletion(result);
  };
  const finishIfReady = () => { if (closed && (!stopping || treeFinished)) finish({ ...exit, closed: !stopping || treeVerified }); };
  const stop = () => {
    if (closed || stopping) return;
    stopping = true;
    timer = setTimeout(() => { child.unref(); finish({ closed: false, code: null, childError }); }, stopTimeoutMs);
    if (!Number.isSafeInteger(child.pid)) { treeFinished = true; treeVerified = true; return; }
    Promise.resolve().then(() => {
      if (closed) throw new Error('Owned PID closed before tree stop.');
      return killTree(child.pid!);
    }).then(() => { treeFinished = true; treeVerified = true; finishIfReady(); }).catch(() => {
      treeFinished = true; if (!closed) { try { child.kill(); } catch { /* Closure is still unverified. */ } } finishIfReady();
    });
  };
  child.once('error', () => { childError = true; stop(); });
  child.once('close', code => { closed = true; exit = { closed: true, code: code ?? 1, childError }; finishIfReady(); });
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  return { completion, stop };
}
