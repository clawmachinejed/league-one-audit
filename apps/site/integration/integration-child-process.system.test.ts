import { once } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { expect, it } from 'vitest';
import { superviseCapacityChild } from './collection-capacity-supervision';
import { spawnIntegrationChild, spawnIntegrationWorker, stopIntegrationChildTree, verifyIntegrationChildTreeClosed } from './integration-child-process';

const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', ...Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME']
  .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])) };

function announcedGrandchild(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Fixture child did not start.')), 5_000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Fixture spawn failed.')); });
    child.stdout!.on('data', (data: Buffer) => {
      output += data.toString();
      if (!output.includes('\n')) return;
      clearTimeout(timer);
      const pid = Number(output.trim());
      if (Number.isSafeInteger(pid) && pid > 1) resolve(pid);
      else reject(new Error('Fixture grandchild identity was invalid.'));
    });
  });
}

it('closes a real integration child normally without sending a stop signal', async () => {
  const child = spawnIntegrationChild(process.execPath, ['-e', 'process.exitCode = 0'], { env });
  const supervised = superviseCapacityChild(child, new AbortController().signal,
    pid => stopIntegrationChildTree(child, pid));
  expect(await supervised.completion).toEqual({ closed: true, code: 0, childError: false });
  expect(await verifyIntegrationChildTreeClosed(child)).toBe(process.platform === 'win32' ? 'child-close' : 'posix-process-group');
});

it('cancellation closes a real child and its inherited-process-group descendant', async () => {
  const source = `const { spawn } = require('node:child_process');
    const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
    descendant.once('spawn', () => process.stdout.write(String(descendant.pid) + '\\n'));
    setInterval(() => {}, 1000);`;
  const child = spawnIntegrationChild(process.execPath, ['-e', source], { env });
  const controller = new AbortController();
  const supervised = superviseCapacityChild(child, controller.signal, pid => stopIntegrationChildTree(child, pid));
  // Attach readiness listeners before yielding; all failure paths stop the owned tree.
  const ready = announcedGrandchild(child);
  try {
    const descendantPid = await ready;
    expect(() => process.kill(descendantPid, 0)).not.toThrow();
    const closed = once(child, 'close');
    controller.abort();
    expect((await supervised.completion).closed).toBe(true);
    await closed;
    expect(await verifyIntegrationChildTreeClosed(child)).toBe(process.platform === 'win32' ? 'windows-taskkill' : 'posix-process-group');
    expect(() => process.kill(descendantPid, 0)).toThrow();
  } finally {
    controller.abort();
    await supervised.completion;
  }
}, 15_000);

it('hard kills a real inherited worker before starting a distinct replacement process', async () => {
  const source = 'process.stdout.write(String(process.pid) + "\\n"); setInterval(() => {}, 1000);';
  const child = spawnIntegrationWorker(process.execPath, ['-e', source], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const controller = new AbortController();
  const supervised = superviseCapacityChild(child, controller.signal, pid => stopIntegrationChildTree(child, pid));
  try {
    const pid = await announcedGrandchild(child);
    expect(pid).toBe(child.pid); expect(() => process.kill(pid, 0)).not.toThrow();
    controller.abort();
    expect((await supervised.completion).closed).toBe(true);
    expect(await verifyIntegrationChildTreeClosed(child)).toBe(process.platform === 'win32' ? 'windows-taskkill' : 'child-close');
    if (process.platform !== 'win32') expect(child.signalCode).toBe('SIGKILL');
    expect(() => process.kill(pid, 0)).toThrow();
    const replacement = spawnIntegrationWorker(process.execPath,
      ['-e', 'process.stdout.write(String(process.pid) + "\\n");'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const replacementController = new AbortController();
    const replacementSupervised = superviseCapacityChild(replacement, replacementController.signal,
      ownedPid => stopIntegrationChildTree(replacement, ownedPid));
    try {
      const replacementPid = await announcedGrandchild(replacement);
      expect(replacementPid).toBe(replacement.pid); expect(replacementPid).not.toBe(pid);
      expect(await replacementSupervised.completion).toEqual({ closed: true, code: 0, childError: false });
      expect(await verifyIntegrationChildTreeClosed(replacement)).toBe('child-close');
    } finally { replacementController.abort(); await replacementSupervised.completion; }
  } finally { controller.abort(); await supervised.completion; }
}, 15_000);

it('keeps a real helper-spawned worker inside the outer supervisor cancellation tree', async () => {
  const helper = new URL('./integration-child-process.ts', import.meta.url).href;
  const source = `import { spawnIntegrationWorker } from ${JSON.stringify(helper)};
    spawnIntegrationWorker(process.execPath,
      ['-e', 'process.stdout.write(String(process.pid) + "\\\\n"); setInterval(() => {}, 1000);'],
      { env: { NODE_ENV: 'test', SystemRoot: process.env.SystemRoot }, stdio: 'inherit' });
    setInterval(() => {}, 1000);`;
  const child = spawnIntegrationChild(process.execPath, ['--input-type=module', '-e', source],
    { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const controller = new AbortController();
  const supervised = superviseCapacityChild(child, controller.signal, pid => stopIntegrationChildTree(child, pid));
  try {
    const workerPid = await announcedGrandchild(child);
    expect(workerPid).not.toBe(child.pid); expect(() => process.kill(workerPid, 0)).not.toThrow();
    controller.abort(); expect((await supervised.completion).closed).toBe(true);
    expect(await verifyIntegrationChildTreeClosed(child)).toBe(process.platform === 'win32' ? 'windows-taskkill' : 'posix-process-group');
    expect(() => process.kill(workerPid, 0)).toThrow();
  } finally { controller.abort(); await supervised.completion; }
}, 15_000);
