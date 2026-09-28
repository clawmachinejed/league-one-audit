import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { superviseCapacityChild } from './collection-capacity-supervision';
import { spawnIntegrationChild, stopIntegrationChildTree, verifyIntegrationChildTreeClosed } from './integration-child-process';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

function fakeChild(pid: number | undefined = 12345) {
  return Object.assign(new EventEmitter(), {
    pid, exitCode: null, signalCode: null, kill: vi.fn(), unref: vi.fn(),
  }) as unknown as ChildProcess;
}
const missing = () => Object.assign(new Error('not found'), { code: 'ESRCH' });
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
const setPlatform = (platform: string) => Object.defineProperty(process, 'platform', { configurable: true, value: platform });
const start = (child = fakeChild()) => {
  vi.mocked(spawn).mockReturnValueOnce(child);
  return spawnIntegrationChild('node', ['vitest.mjs'], { env: { NODE_ENV: 'test', PATH: 'safe-path' }, stdio: 'pipe' });
};

beforeEach(() => {
  vi.useFakeTimers();
  setPlatform('linux');
  vi.mocked(spawn).mockReset();
});
afterEach(() => {
  Object.defineProperty(process, 'platform', platformDescriptor);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('owned integration child spawning', () => {
  it.each(['linux', 'darwin'])('creates an owned %s group without a shell or automatic single-process cancellation', platform => {
    setPlatform(platform);
    const child = fakeChild(); vi.mocked(spawn).mockReturnValueOnce(child);
    const controller = new AbortController();
    const options = { env: { NODE_ENV: 'test', SAFE: '1' }, detached: false, shell: true, windowsHide: false,
      signal: controller.signal, timeout: 1 } as SpawnOptions & { env: NodeJS.ProcessEnv };
    expect(spawnIntegrationChild('node', ['vitest.mjs'], options)).toBe(child);
    expect(spawn).toHaveBeenCalledWith('node', ['vitest.mjs'], {
      ...options, detached: true, shell: false, windowsHide: true, signal: undefined, timeout: undefined,
    });
  });
  it('does not detach the Windows child and requires an explicit environment', () => {
    setPlatform('win32'); start();
    expect(vi.mocked(spawn).mock.calls[0]?.[2]).toMatchObject({ detached: false, shell: false, windowsHide: true });
    expect(() => spawnIntegrationChild('node', [], {} as { env: NodeJS.ProcessEnv })).toThrow('explicit environment');
  });
  it('refuses an unsupported platform before spawning', () => {
    setPlatform('unsupported');
    expect(() => start()).toThrow('Unsupported');
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('POSIX process group cancellation and closure', () => {
  it('waits for descendants after parent closure and sends only one group signal', async () => {
    const child = start(); const controller = new AbortController();
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    const supervised = superviseCapacityChild(child, controller.signal, pid => stopIntegrationChildTree(child, pid));
    let settled = false; void supervised.completion.then(() => { settled = true; });
    controller.abort(); await Promise.resolve();
    expect(kill.mock.calls[0]).toEqual([child.pid! * -1, 'SIGKILL']);
    child.emit('exit', null, 'SIGKILL'); child.emit('close', null, 'SIGKILL');
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    kill.mockImplementation(() => { throw missing(); });
    await vi.advanceTimersByTimeAsync(50);
    expect((await supervised.completion).closed).toBe(true);
    expect(await verifyIntegrationChildTreeClosed(child)).toBe('posix-process-group');
    expect(kill.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([[-12345, 'SIGKILL']]);
  });
  it('makes repeated stop requests share one signal, including after closure', async () => {
    const child = start(); const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw missing(); });
    await Promise.all([stopIntegrationChildTree(child), stopIntegrationChildTree(child)]);
    child.emit('exit', 0); child.emit('close', 0);
    await stopIntegrationChildTree(child);
    expect(kill.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([[-12345, 'SIGKILL']]);
  });
  it('refuses unknown, altered, invalid or exited child identities without signalling', async () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    await expect(stopIntegrationChildTree(fakeChild())).rejects.toThrow('not spawned');
    await expect(stopIntegrationChildTree(start(fakeChild(1)))).rejects.toThrow('PID is unavailable');
    await expect(stopIntegrationChildTree(start(fakeChild(process.pid)))).rejects.toThrow('PID is unavailable');
    const child = start();
    await expect(stopIntegrationChildTree(child, 6789)).rejects.toThrow('identity changed');
    child.emit('exit', 0);
    await expect(stopIntegrationChildTree(child)).rejects.toThrow('exited before');
    const changed = start(); Object.assign(changed, { pid: 9876 });
    await expect(stopIntegrationChildTree(changed)).rejects.toThrow('identity changed');
    expect(kill).not.toHaveBeenCalled();
  });
  it('checks normal closure with read-only probes and no stop signal', async () => {
    const child = start(); const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw missing(); });
    const supervised = superviseCapacityChild(child, new AbortController().signal, pid => stopIntegrationChildTree(child, pid));
    await expect(verifyIntegrationChildTreeClosed(child)).rejects.toThrow('has not closed');
    child.emit('exit', 0); child.emit('close', 0);
    expect(await supervised.completion).toEqual({ closed: true, code: 0, childError: false });
    expect(await verifyIntegrationChildTreeClosed(child)).toBe('posix-process-group');
    expect(kill.mock.calls).toEqual([[-12345, 0]]);
  });
  it('fails within the deadline when leaked descendants remain, without signalling a closed PID', async () => {
    const child = start(); const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    child.emit('exit', 0); child.emit('close', 0);
    const verification = expect(verifyIntegrationChildTreeClosed(child)).rejects.toThrow('deadline');
    await vi.advanceTimersByTimeAsync(10_000); await verification;
    expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
  });
  it('fails closed on signal refusal or unreadable process-group state', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); });
    await expect(stopIntegrationChildTree(start())).rejects.toThrow('stop failed');
    const child = start(); child.emit('close', 0);
    await expect(verifyIntegrationChildTreeClosed(child)).rejects.toThrow('could not be verified');
    expect(kill).toHaveBeenCalledTimes(2);
  });
  it('does not confuse a failed tree stop with confirmed closure in the existing supervisor', async () => {
    const child = start(); const controller = new AbortController();
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); });
    const supervised = superviseCapacityChild(child, controller.signal, pid => stopIntegrationChildTree(child, pid));
    controller.abort(); await vi.advanceTimersByTimeAsync(0);
    child.emit('close', 1);
    expect((await supervised.completion).closed).toBe(false);
  });
  it('reports a failed spawn as child closure without probing a nonexistent PID', async () => {
    const child = start(Object.assign(fakeChild(), { pid: undefined }));
    const kill = vi.spyOn(process, 'kill'); child.emit('close', -2);
    expect(await verifyIntegrationChildTreeClosed(child)).toBe('child-close');
    expect(kill).not.toHaveBeenCalled();
  });
});

describe('Windows tree cancellation', () => {
  beforeEach(() => setPlatform('win32'));
  it('uses bounded hidden taskkill with exact owned PID, tree and force flags', async () => {
    const child = start(); const taskkill = fakeChild(45678); vi.mocked(spawn).mockReturnValueOnce(taskkill);
    const stopping = stopIntegrationChildTree(child);
    expect(spawn).toHaveBeenLastCalledWith('taskkill.exe', ['/PID', '12345', '/T', '/F'], {
      windowsHide: true, stdio: 'ignore', shell: false, env: { NODE_ENV: 'test', SystemRoot: process.env.SystemRoot },
    });
    child.emit('exit', null, 'SIGKILL'); child.emit('close', null, 'SIGKILL'); taskkill.emit('close', 0);
    await stopping;
    expect(await verifyIntegrationChildTreeClosed(child)).toBe('windows-taskkill');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('distinguishes natural Windows closure from taskkill tree evidence', async () => {
    const child = start(); child.emit('exit', 0); child.emit('close', 0);
    expect(await verifyIntegrationChildTreeClosed(child)).toBe('child-close');
    await expect(stopIntegrationChildTree(child)).rejects.toThrow('exited before');
    expect(spawn).toHaveBeenCalledTimes(1);
  });
  it.each(['error', 'nonzero', 'timeout'])('fails closed for taskkill %s', async failure => {
    const child = start(); const taskkill = fakeChild(45678); vi.mocked(spawn).mockReturnValueOnce(taskkill);
    const stopping = expect(stopIntegrationChildTree(child)).rejects.toThrow('stop failed');
    if (failure === 'error') taskkill.emit('error', new Error('private executable detail'));
    if (failure === 'nonzero') taskkill.emit('close', 1);
    if (failure === 'timeout') { await vi.advanceTimersByTimeAsync(10_000); expect(taskkill.kill).toHaveBeenCalledOnce(); }
    await stopping;
    child.emit('close', 1);
    await expect(verifyIntegrationChildTreeClosed(child)).rejects.toThrow('stop failed');
    expect(vi.getTimerCount()).toBe(0);
  });
});
