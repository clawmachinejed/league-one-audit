import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIntegrationArtifactDirectory, initializeIntegrationArtifactDirectory,
  INTEGRATION_ARTIFACT_DIRECTORY_ENV, writeIntegrationArtifact } from './integration-artifacts';

let workspace: string;
beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'league-one-artifacts-'));
  vi.stubEnv(INTEGRATION_ARTIFACT_DIRECTORY_ENV, join(workspace, 'run-output'));
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  await rm(workspace, { recursive: true, force: true });
});

describe('standard integration artifact routing', () => {
  it('initializes the ignored default once for a standard run and shares it through the environment', async () => {
    const environment: Record<string, string | undefined> = {};
    const directory = await initializeIntegrationArtifactDirectory(environment);
    const expectedBase = fileURLToPath(new URL('../../../test-results/integration/artifacts/', import.meta.url));
    try {
      expect(relative(expectedBase, directory)).toMatch(/^run-[a-zA-Z0-9]+$/);
      expect(environment[INTEGRATION_ARTIFACT_DIRECTORY_ENV]).toBe(directory);
      await expect(initializeIntegrationArtifactDirectory(environment)).resolves.toBe(directory);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('allocates distinct absolute directories for independent runs', async () => {
    const base = join(workspace, 'test-results', 'integration', 'artifacts');
    const [first, second] = await Promise.all([createIntegrationArtifactDirectory(base), createIntegrationArtifactDirectory(base)]);
    expect(first).not.toBe(second);
    for (const directory of [first, second]) {
      expect(isAbsolute(directory)).toBe(true);
      expect(relative(base, directory)).toMatch(/^run-[a-zA-Z0-9]+$/);
      expect(await readdir(directory)).toEqual([]);
    }
  });

  it('keeps reports together at the explicitly selected absolute path without changing historical evidence', async () => {
    const historicalDirectory = join(workspace, 'release');
    await mkdir(historicalDirectory);
    const historicalPath = join(historicalDirectory, '011-capacity.partial.integration.json');
    await writeFile(historicalPath, 'historical evidence\n');
    const report = { kind: 'synthetic', providerRequests: 0, values: [1, 2] };
    const first = await writeIntegrationArtifact('011-capacity.partial.integration.json', report);
    const second = await writeIntegrationArtifact('011-capacity.synthetic.integration.json', { kind: 'other' });
    expect(first).toBe(join(workspace, 'run-output', '011-capacity.partial.integration.json'));
    expect(second).toBe(join(workspace, 'run-output', '011-capacity.synthetic.integration.json'));
    expect(await readFile(first, 'utf8')).toBe(`${JSON.stringify(report, null, 2)}\n`);
    expect(await readFile(historicalPath, 'utf8')).toBe('historical evidence\n');
    expect(process.stdout.write).toHaveBeenCalledWith(`INTEGRATION_ARTIFACT ${JSON.stringify({ artifactPath: first })}\n`);
  });

  it('refuses to overwrite a report from a previous attempt', async () => {
    const path = await writeIntegrationArtifact('capacity.json', { run: 'original' });
    await expect(writeIntegrationArtifact('capacity.json', { run: 'replacement' })).rejects.toMatchObject({ code: 'EEXIST' });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ run: 'original' });
  });

  it.each(['../release/evidence.json', 'subdirectory/evidence.json', 'subdirectory\\evidence.json', '/evidence.json', 'C:\\evidence.json', 'evidence.txt'])(
    'refuses an artifact filename that can escape or misidentify its output: %s', async filename => {
      await expect(writeIntegrationArtifact(filename, {})).rejects.toThrow('JSON basename');
      expect(await readdir(workspace)).toEqual([]);
    });

  it('rejects relative and empty configured directories instead of interpreting them against process cwd', async () => {
    await expect(createIntegrationArtifactDirectory('test-results')).rejects.toThrow('absolute');
    for (const directory of ['release', '']) {
      await expect(initializeIntegrationArtifactDirectory({ [INTEGRATION_ARTIFACT_DIRECTORY_ENV]: directory })).rejects.toThrow('absolute');
    }
  });

  it('preserves explicit directory selection without replacing unrelated environment values', async () => {
    const directory = join(workspace, 'explicit-output');
    const environment = { [INTEGRATION_ARTIFACT_DIRECTORY_ENV]: directory, COLLECTION_CAPACITY_OUTPUT: 'separate-capacity-path' };
    await expect(initializeIntegrationArtifactDirectory(environment)).resolves.toBe(directory);
    expect(environment).toEqual({ [INTEGRATION_ARTIFACT_DIRECTORY_ENV]: directory, COLLECTION_CAPACITY_OUTPUT: 'separate-capacity-path' });
    expect(await readdir(directory)).toEqual([]);
  });
});
