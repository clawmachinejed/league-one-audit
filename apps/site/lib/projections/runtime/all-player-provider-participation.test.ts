import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { foundationFixture } from '../../../test-support/all-player-foundation-fixture';

const unknownCaseIds = ['7527', '11292', '10224', '12529'];

function runOfflineComposition() {
  // The existing process fixture routes every request to retained data and traps
  // writes. It already has no reviewed-period override. Do not inherit secrets.
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => (
    ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'COMSPEC', 'PATHEXT'].includes(key.toUpperCase())
  )));
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, ['--conditions=react-server', '--import',
      new URL('../../../node_modules/tsx/dist/loader.mjs', import.meta.url).href,
      'test-support/all-player-foundation-runtime-fixture.ts'], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      env: { ...environment, NODE_ENV: 'test' }, windowsHide: true, timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout, stderr) => resolve({
      code: error && typeof error.code === 'number' ? error.code : error ? null : 0, stdout, stderr,
    }));
  });
}

describe('provider-only participation from the unchanged incomplete Week 1 capture', () => {
  it('exercises provider-only real Node composition for both leagues with one local weekly replay and no database writes', async () => {
    const child = await runOfflineComposition();
    expect(child.code, child.stderr).toBe(0);
    const evidence = JSON.parse(child.stdout) as {
      result: Record<string, unknown>; requests: string[]; unexpectedRequests: string[]; databaseWrites: string[];
      fixtureFailures: string[]; observation: { quality: string; coverage: Record<string, unknown>;
        cases: { providerExternalId: string; eligibleGameCount: number | null; appearanceGameCount: number | null;
          eligibilityEvidence: Record<string, unknown> }[] };
    };
    expect(evidence.result).toMatchObject({ status: 'unavailable', mode: 'shadow', reason: 'provider-coverage-incomplete' });
    expect(evidence.observation).toMatchObject({ quality: 'partial', coverage: { unknownEligibilityCount: 4322 } });
    for (const id of unknownCaseIds) {
      expect(evidence.observation.cases.find((entry) => entry.providerExternalId === id), id)
        .toMatchObject({ eligibleGameCount: null, appearanceGameCount: null });
    }
    expect(evidence.observation.cases.find((entry) => entry.providerExternalId === '5859'))
      .toMatchObject({ eligibleGameCount: 1, appearanceGameCount: 1,
        eligibilityEvidence: { kind: 'weekly-stat', individualSnaps: { off_snp: 31 } } });
    expect(evidence.fixtureFailures).toEqual([]);
    expect(evidence.databaseWrites).toEqual([]);
    expect(evidence.unexpectedRequests).toEqual([]);
    const urls = evidence.requests.map((url) => new URL(url));
    expect(urls.filter((url) => url.pathname === '/v1/players/nfl')).toHaveLength(1);
    expect(urls.filter((url) => url.pathname === '/v1/stats/nfl/regular/2026/1')).toHaveLength(1);
    expect(urls.some((url) => /tank01|\/profile\/|\/player\//iu.test(url.href))).toBe(false);
    for (const league of foundationFixture.leagues) {
      expect(urls.some((url) => url.pathname === `/v1/league/${league.settings.league_id}/rosters`)).toBe(true);
    }
  }, 30_000);
});
