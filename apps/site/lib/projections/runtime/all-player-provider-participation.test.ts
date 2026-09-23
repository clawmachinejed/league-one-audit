import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { foundationFixture } from '../../../test-support/all-player-foundation-fixture';

const assumedActiveCaseIds = ['7527', '11292', '10224'];

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

describe('approved missing-participation policy on the unchanged incomplete Week 1 capture', () => {
  it('records shared product assumptions through real Node composition with one local weekly replay and no league reads or database writes', async () => {
    const child = await runOfflineComposition();
    expect(child.code, child.stderr).toBe(0);
    const evidence = JSON.parse(child.stdout) as {
      result: Record<string, unknown>; requests: string[]; unexpectedRequests: string[]; databaseWrites: string[];
      fixtureFailures: string[]; observation: { quality: string; coverage: Record<string, unknown>;
        cases: { providerExternalId: string; eligibleGameCount: number | null; appearanceGameCount: number | null;
          stats: Record<string, number>; eligibilityEvidence: Record<string, unknown> }[] };
    };
    expect(evidence.result).toMatchObject({ status: 'unavailable', mode: 'shadow', reason: 'provider-coverage-incomplete' });
    expect(evidence.observation).toMatchObject({ quality: 'partial', coverage: {
      complete: false, periodInventoryComplete: false, providerPresentEntityCount: 96,
      providerMissingEntityCount: 4289, unknownEligibilityCount: 4289, unknownAppearanceCount: 28,
      assumedNonParticipationCount: 4294, participationAssumptionPolicy: 'missing-participation-as-zero-v1',
      scheduledGameCount: 16, nonFinalScheduledGameCount: 14, scheduleFinalityComplete: false,
    } });
    for (const id of assumedActiveCaseIds) {
      const entry = evidence.observation.cases.find((value) => value.providerExternalId === id)!;
      expect(entry, id).toMatchObject({ eligibleGameCount: 1, appearanceGameCount: 0,
        eligibilityEvidence: { kind: 'assumed-nonparticipation', policy: 'missing-participation-as-zero-v1',
          source: 'product-policy', effectivePeriod: foundationFixture.period,
          basis: { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1 } } });
      expect(entry.stats, id).toEqual(foundationFixture.weekly[id]);
      expect(entry.stats, id).not.toHaveProperty('gp');
    }
    expect(evidence.observation.cases.find((entry) => entry.providerExternalId === '12529'))
      .toMatchObject({ eligibleGameCount: null, appearanceGameCount: 0, stats: {},
        eligibilityEvidence: { kind: 'assumed-nonparticipation', policy: 'missing-participation-as-zero-v1',
          source: 'product-policy', effectivePeriod: foundationFixture.period,
          basis: { kind: 'missing-provider-row', inventoryFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u) } } });
    expect(foundationFixture.weekly['12529']).toBeUndefined();
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
    expect(urls.filter((url) => url.pathname.startsWith('/v1/league/'))).toEqual([]);
  }, 30_000);
});
