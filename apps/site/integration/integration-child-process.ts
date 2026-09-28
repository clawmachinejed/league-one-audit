import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

const STOP_TIMEOUT_MS = 10_000;
const PROBE_INTERVAL_MS = 50;
type OwnedChild = {
  pid: number | undefined;
  platform: NodeJS.Platform;
  exited: boolean;
  closed: boolean;
  stop?: Promise<void>;
};
const ownedChildren = new WeakMap<ChildProcess, OwnedChild>();

// Cancellation belongs to superviseCapacityChild, not spawn's single-process
// timeout or signal handlers. Callers must pass an explicit, filtered env.
type IntegrationSpawnOptions = Omit<SpawnOptions,
  'detached' | 'shell' | 'windowsHide' | 'signal' | 'timeout' | 'env'> & {
  env: NodeJS.ProcessEnv;
};

/** Spawn the executable directly (normally process.execPath + Vitest's entry).
 * POSIX descendants inherit this new process group; they must not detach again.
 * Keep the returned child referenced and immediately attach the existing
 * superviseCapacityChild(child, signal, pid => stopIntegrationChildTree(child, pid)).
 */
export function spawnIntegrationChild(
  command: string, args: readonly string[], options: IntegrationSpawnOptions,
): ChildProcess {
  if (!options.env || typeof options.env !== 'object') throw new Error('Integration child needs an explicit environment.');
  const platform = process.platform;
  if (platform !== 'win32' && platform !== 'linux' && platform !== 'darwin') {
    throw new Error('Unsupported integration child platform.');
  }
  const child = spawn(command, args, {
    ...options, shell: false, windowsHide: true, detached: platform !== 'win32',
    // Also override these at runtime if a JavaScript caller supplies them.
    signal: undefined, timeout: undefined,
  });
  const owned: OwnedChild = { pid: child.pid, platform, exited: false, closed: false };
  ownedChildren.set(child, owned);
  // exit invalidates permission to signal before close, which may wait on pipes.
  child.once('exit', () => { owned.exited = true; });
  child.once('close', () => { owned.exited = true; owned.closed = true; });
  return child;
}

function ownedChild(child: ChildProcess): OwnedChild {
  const owned = ownedChildren.get(child);
  if (!owned) throw new Error('Integration child was not spawned by this owner.');
  return owned;
}

function assertPid(pid: number | undefined): asserts pid is number {
  if (!Number.isSafeInteger(pid) || pid! <= 1 || pid === process.pid) {
    throw new Error('Owned integration child PID is unavailable.');
  }
}

function groupExists(pid: number): boolean {
  try { process.kill(-pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw new Error('Integration process group closure could not be verified.');
  }
}

async function waitForGroupClosure(pid: number): Promise<void> {
  const deadline = performance.now() + STOP_TIMEOUT_MS;
  while (groupExists(pid)) {
    if (performance.now() >= deadline) throw new Error('Integration process group did not close before the deadline.');
    await new Promise<void>(resolve => setTimeout(resolve, PROBE_INTERVAL_MS));
  }
}

async function stopPosixGroup(pid: number): Promise<void> {
  // One synchronous signal while the owning ChildProcess is live. Never retry
  // a signal after yielding: exit/close and PID reuse may have happened then.
  try { process.kill(-pid, 'SIGKILL'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      throw new Error('Owned integration process group stop failed.');
    }
  }
  await waitForGroupClosure(pid);
}

function stopWindowsTree(pid: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stop = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true, stdio: 'ignore', shell: false,
      env: { NODE_ENV: 'test', SystemRoot: process.env.SystemRoot },
    });
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (success) resolve(); else reject(new Error('Owned integration child tree stop failed.'));
    };
    const timer = setTimeout(() => {
      finish(false);
      try { stop.kill(); } catch { /* The bounded stop already failed closed. */ }
    }, STOP_TIMEOUT_MS);
    stop.once('error', () => finish(false));
    stop.once('close', code => finish(code === 0));
  });
}

/** The expected PID is supplied by superviseCapacityChild. No arbitrary PID or
 * child not created here is admitted. Repeated cancellation shares one stop;
 * a first request after exit/close is refused rather than risking PID reuse.
 * Windows taskkill remains an OS tree operation, not a persistent Job Object:
 * children that deliberately escape ownership are outside this runner contract.
 */
export async function stopIntegrationChildTree(child: ChildProcess, expectedPid = child.pid): Promise<void> {
  const owned = ownedChild(child);
  assertPid(owned.pid);
  if (expectedPid !== owned.pid || child.pid !== owned.pid) throw new Error('Integration child PID identity changed.');
  if (owned.stop) return owned.stop;
  if (owned.exited || owned.closed || child.exitCode !== null || child.signalCode !== null) {
    throw new Error('Integration child exited before tree stop.');
  }
  owned.stop = owned.platform === 'win32' ? stopWindowsTree(owned.pid) : stopPosixGroup(owned.pid);
  return owned.stop;
}

export type IntegrationChildClosure = 'posix-process-group' | 'windows-taskkill' | 'child-close';

/** Call after superviseCapacityChild.completion. POSIX also checks for leaked
 * group members after natural exit without ever signalling a closed child's PID.
 * Windows natural exit proves only ChildProcess/stdio closure; taskkill supplies
 * stronger tree evidence when cancelled. Record this distinction in receipts.
 */
export async function verifyIntegrationChildTreeClosed(child: ChildProcess): Promise<IntegrationChildClosure> {
  const owned = ownedChild(child);
  if (!owned.closed) throw new Error('Integration child has not closed.');
  if (owned.stop) await owned.stop;
  if (owned.pid === undefined) return 'child-close'; // A spawn failure has no tree.
  assertPid(owned.pid);
  if (owned.platform === 'win32') return owned.stop ? 'windows-taskkill' : 'child-close';
  await waitForGroupClosure(owned.pid);
  return 'posix-process-group';
}
