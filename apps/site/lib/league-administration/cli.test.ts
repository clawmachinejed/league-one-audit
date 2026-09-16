import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('starts the real administration CLI outside Next and refuses incomplete authority before network work', async () => {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (/DATABASE|TANK01|LEAGUE_ADMINISTRATION|VERCEL_ENV/i.test(name)) delete environment[name];
  }
  const result = await new Promise<{ stdout: string; stderr: string; failed: boolean }>(resolve => {
    execFile(process.execPath, ['--conditions=react-server', '--import',
      new URL('../../node_modules/tsx/dist/loader.mjs', import.meta.url).href,
      fileURLToPath(new URL('../../scripts/run-league-administration.ts', import.meta.url)),
      '--mode', 'write', '--season', '2026', '--league', 'all', '--weeks', '0-2'],
    { env: environment, windowsHide: true, timeout: 20_000 }, (error, stdout, stderr) => resolve({ stdout, stderr, failed: !!error }));
  });
  expect(result.failed).toBe(true);
  expect(result.stdout).toBe('');
  expect(JSON.parse(result.stderr)).toEqual({ status: 'failed', stage: 'operator-preflight', reason: 'administration-operator-refused' });
}, 30_000);
