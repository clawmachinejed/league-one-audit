import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const siteRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tsxLoader = new URL('../../../node_modules/tsx/dist/loader.mjs', import.meta.url).href;

function runOfflineChild(relativePath: string, arguments_: string[] = []) {
  // Keep operating-system process settings only. Never inherit a production
  // credential, database target, provider key, or operation authorization.
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => (
    ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'COMSPEC', 'PATHEXT'].includes(key.toUpperCase())
  )));
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, ['--conditions=react-server', '--import', tsxLoader, relativePath, ...arguments_], {
      cwd: siteRoot, env: { ...environment, NODE_ENV: 'test' }, windowsHide: true, timeout: 20_000,
      maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout, stderr) => resolve({
      code: error && typeof error.code === 'number' ? error.code : error ? null : 0, stdout, stderr,
    }));
  });
}

describe('production-shaped retained fixture in real Node outside Next', () => {
  it('runs real composition, catalog, official roster adapter, weekly source and operation without manufacturing completed Week1', async () => {
    const child = await runOfflineChild('test-support/all-player-foundation-runtime-fixture.ts');
    expect(child.code, child.stderr).toBe(0);
    expect(child.stderr).not.toContain('incrementalCache');
    const evidence = JSON.parse(child.stdout) as {
      result: Record<string, unknown>; requests: string[]; unexpectedRequests: string[]; databaseWrites: string[];
      fixtureFailures: string[];
      weeklyIdentitySupplement: Record<string, unknown>;
      observation: { quality: string; entryCount: number; defenseCount: number; coverage: Record<string, unknown>;
        cases: { providerExternalId: string; eligibleGameCount: number | null; appearanceGameCount: number | null }[] };
    };
    expect(evidence.result, JSON.stringify({ result: evidence.result, fixtureFailures: evidence.fixtureFailures,
      unexpectedRequests: evidence.unexpectedRequests }))
      .toMatchObject({ status: 'unavailable', mode: 'shadow', reason: 'provider-coverage-incomplete' });
    expect(evidence.observation).toMatchObject({ quality: 'partial', entryCount: 4385, defenseCount: 32,
      coverage: { complete: false, periodInventoryComplete: false, scheduledGameCount: 16,
        nonFinalScheduledGameCount: 14, scheduleFinalityComplete: false, responseEntityCount: 301,
        unexpectedResponseEntityCount: 0, excludedResponseEntityCount: 205 },
    });
    expect(evidence.weeklyIdentitySupplement).toMatchObject({
      observedAt: '2026-09-12T16:36:36.000Z',
      canonicalJsonSha256: '1ce72b13e654617fbfe81c3f408c2ad0a2574f81d7c3a73b70c5b4cce226146e',
      addedIdentityCount: 201, overlappingIdentityCount: 97, overlapMetadataDifferences: [],
    });
    expect(evidence.observation.cases.find((entry) => entry.providerExternalId === '12529'))
      .toMatchObject({ eligibleGameCount: null, appearanceGameCount: null });
    expect(evidence.observation.cases.find((entry) => entry.providerExternalId === '5859'))
      .toMatchObject({ eligibleGameCount: 1, appearanceGameCount: 1 });
    expect(evidence.databaseWrites).toEqual([]);
    expect(evidence.unexpectedRequests).toEqual([]);
    const urls = evidence.requests.map((url) => new URL(url));
    expect(urls.filter((url) => url.pathname === '/v1/players/nfl')).toHaveLength(1);
    expect(urls.filter((url) => url.pathname === '/v1/stats/nfl/regular/2026/1')).toHaveLength(1);
    expect(urls.some((url) => /tank01|\/profile\/|\/player\//iu.test(url.href))).toBe(false);
    for (const leagueId of ['1378850182409490432', '1378850360529014784']) {
      // Both captured populations pass through the actual bulk league loader.
      expect(urls.some((url) => url.pathname === `/v1/league/${leagueId}/rosters`)).toBe(true);
    }
  }, 30_000);

  it('starts the actual operator CLI and rejects missing authorization before opening a database', async () => {
    const child = await runOfflineChild('scripts/run-all-player-ingestion.ts', [
      '--mode', 'shadow', '--season', '2026', '--season-type', 'regular', '--week', '1',
    ]);
    expect(child.code).toBe(1);
    expect(child.stdout).toBe('');
    expect(child.stderr).not.toContain('incrementalCache');
    expect(JSON.parse(child.stderr.trim())).toEqual({ status: 'failed', reason: 'operator-failed',
      stage: 'operator-input', retryDisposition: 'inspect-stage-before-retry' });
  }, 30_000);
});
