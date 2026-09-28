import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ exists: vi.fn(), spawn: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: mocked.exists }));
vi.mock('node:child_process', () => ({ spawnSync: mocked.spawn }));

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  vi.stubEnv('npm_execpath', '/fictional/pnpm.cjs');
  vi.stubEnv('NEON_TEST_API_KEY', undefined);
  mocked.exists.mockReturnValue(false);
  mocked.spawn.mockReturnValue({ status: 0 });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('full verification disposable database selection', () => {
  it('never selects a retained target merely because the legacy environment file exists', async () => {
    mocked.exists.mockImplementation((path) => path.endsWith('.env.integration.local'));
    await import('./full-verify.mjs');
    expect(mocked.spawn.mock.calls.map(([, args]) => args.at(-1)))
      .toEqual(['verify', 'test:browser', 'test:browser:accounts']);
    expect(mocked.exists.mock.calls.every(([path]) => path.endsWith('.env.integration-control.local'))).toBe(true);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('SKIPPED / UNVERIFIED'));
  });

  it.each(['control-file', 'secured-environment'])(
    'runs the disposable command only when configured through %s', async source => {
      if (source === 'control-file') mocked.exists.mockReturnValue(true);
      else vi.stubEnv('NEON_TEST_API_KEY', 'synthetic-test-key');
      await import('./full-verify.mjs');
      expect(mocked.spawn.mock.calls.map(([, args]) => args.at(-1)))
        .toEqual(['verify', 'test:browser', 'test:browser:accounts', 'test:integration']);
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('SKIPPED / UNVERIFIED'));
      if (source === 'secured-environment') {
        expect(mocked.spawn.mock.calls.slice(0, 3).every(([, , options]) => options.env.NEON_TEST_API_KEY === undefined)).toBe(true);
        expect(mocked.spawn.mock.calls[3][2].env.NEON_TEST_API_KEY).toBe('synthetic-test-key');
      }
    },
  );

  it('reports the SQL gate unverified when the environment credential is empty', async () => {
    vi.stubEnv('NEON_TEST_API_KEY', '  ');
    await import('./full-verify.mjs');
    expect(mocked.spawn).toHaveBeenCalledTimes(3);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('SKIPPED / UNVERIFIED'));
  });

  it('propagates a configured integration failure instead of reporting full verification complete', async () => {
    mocked.exists.mockReturnValue(true);
    mocked.spawn.mockImplementation((_command, args) => ({ status: args.at(-1) === 'test:integration' ? 1 : 0 }));
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('synthetic exit'); });
    await expect(import('./full-verify.mjs')).rejects.toThrow('synthetic exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Full Verify completed.'));
  });
});
