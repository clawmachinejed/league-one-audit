import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { NFL_TEAM_CODES } from '../domain/contracts';

const fixture = fileURLToPath(new URL(
  '../../../test-support/all-player-operator-runtime-fixture.ts',
  import.meta.url,
));
const tsxLoader = new URL(
  '../../../node_modules/tsx/dist/loader.mjs',
  import.meta.url,
).href;

function runFixture(scenario: 'complete' | 'failed-position' | 'unresolved-defense') {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? 'test',
  };
  for (const name of Object.keys(environment)) {
    if (name.toUpperCase().includes('DATABASE') || name.toUpperCase().includes('TANK01')) {
      delete environment[name];
    }
  }
  return new Promise<Readonly<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>>((resolve) => {
    execFile(process.execPath, [
      '--conditions=react-server',
      '--import',
      tsxLoader,
      fixture,
      scenario,
    ], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      windowsHide: true,
      timeout: 20_000,
      env: environment,
    }, (error, stdout, stderr) => resolve({
      code: error && typeof error.code === 'number' ? error.code : error ? null : 0,
      stdout,
      stderr,
    }));
  });
}

function parseOutput(output: string) {
  return JSON.parse(output) as Readonly<{
    scenario: string;
    result: Readonly<Record<string, unknown>>;
    catalog: Readonly<{
      complete: boolean;
      sourceRevision: string | null;
      positions: string[];
      playerCount: number;
    }>;
    inventory: Readonly<{
      entityCount: number;
      teamDefenseCount: number;
      uniqueTeamDefenseCount: number;
      playerDefenseCount: number;
      teamDefenseIds: string[];
    }> | null;
    identityLookups: Array<Readonly<{
      provider: string;
      entityKind: 'player' | 'team_defense';
      externalId: string;
    }>>;
    rosteredDefenseIds: Array<Readonly<{ leagueId: string; defenseId: string }>>;
    requests: string[];
    databaseWrites: string[];
  }>;
}

describe('all-player operator catalog runtime outside Next.js', () => {
  it('runs the real cache-neutral shadow path with one combined complete catalog and zero writes', async () => {
    const child = await runFixture('complete');
    expect(child.code, child.stderr).toBe(0);
    expect(child.stderr).not.toContain('incrementalCache');
    const evidence = parseOutput(child.stdout);
    expect(evidence.catalog).toMatchObject({
      complete: true,
      sourceRevision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      positions: ['DEF', 'K', 'QB', 'RB', 'TE', 'WR'],
      playerCount: 6,
    });
    expect(evidence.result).toMatchObject({
      status: 'completed',
      mode: 'shadow',
      persisted: false,
      parityMismatchCount: 0,
      activeZeroCount: 1,
      projectionCoverage: { identityComplete: true },
    });
    expect(evidence.inventory).toEqual({
      entityCount: 37,
      teamDefenseCount: 32,
      uniqueTeamDefenseCount: 32,
      playerDefenseCount: 0,
      teamDefenseIds: [...NFL_TEAM_CODES].sort(),
    });
    expect(evidence.rosteredDefenseIds.map((value) => value.defenseId).sort())
      .toEqual(['ARI', 'BAL']);
    for (const { defenseId } of evidence.rosteredDefenseIds) {
      expect(evidence.identityLookups.filter((value) => (
        value.provider === 'sleeper' && value.externalId === defenseId
      ))).toEqual([{ provider: 'sleeper', entityKind: 'team_defense', externalId: defenseId }]);
    }
    expect(evidence.databaseWrites).toEqual([]);

    const urls = evidence.requests.map((request) => new URL(request));
    const catalogRequests = urls.filter((url) => url.pathname.endsWith('/players/nfl'));
    const weeklyRequests = urls.filter((url) => url.pathname.includes('/stats/nfl/regular/'));
    expect(catalogRequests).toHaveLength(6);
    expect(catalogRequests.map((url) => url.searchParams.get('position')).sort())
      .toEqual(['DEF', 'K', 'QB', 'RB', 'TE', 'WR']);
    expect(weeklyRequests.map((url) => url.pathname)).toEqual(['/v1/stats/nfl/regular/2026/1']);
    expect(weeklyRequests[0]?.searchParams.size).toBe(0);
    expect(urls.some((url) => /tank01|\/profile\/|\/player\//iu.test(url.href))).toBe(false);
  }, 30_000);

  it('passes rostered D/ST inventory before a conflicting defense identity fails closed', async () => {
    const child = await runFixture('unresolved-defense');
    expect(child.code, child.stderr).toBe(0);
    expect(child.stderr).not.toContain('incrementalCache');
    const evidence = parseOutput(child.stdout);
    expect(evidence.catalog.complete).toBe(true);
    expect(evidence.result).toMatchObject({
      status: 'unavailable',
      mode: 'shadow',
      reason: 'identity-mapping-unusable',
    });
    expect(evidence.identityLookups).toContainEqual({
      provider: 'sleeper', entityKind: 'team_defense', externalId: 'ARI',
    });
    expect(evidence.requests.some((request) => request.includes('/stats/nfl/'))).toBe(false);
    expect(evidence.databaseWrites).toEqual([]);
  }, 30_000);

  it('keeps one failed position catalog-incomplete without writes or downstream requests', async () => {
    const child = await runFixture('failed-position');
    expect(child.code, child.stderr).toBe(0);
    expect(child.stderr).not.toContain('incrementalCache');
    const evidence = parseOutput(child.stdout);
    expect(evidence.catalog).toMatchObject({ complete: false, sourceRevision: null });
    expect(evidence.catalog.positions).not.toContain('TE');
    expect(evidence.result).toMatchObject({
      status: 'unavailable',
      mode: 'shadow',
      reason: 'catalog-incomplete',
    });
    expect(evidence.databaseWrites).toEqual([]);
    expect(evidence.requests.filter((request) => request.includes('/players/nfl?position=')))
      .toHaveLength(6);
    expect(evidence.requests.some((request) => request.includes('/stats/nfl/'))).toBe(false);
  }, 30_000);
});
