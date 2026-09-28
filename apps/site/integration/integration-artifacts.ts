import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INTEGRATION_ARTIFACT_DIRECTORY_ENV = 'PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY';
const defaultBaseDirectory = fileURLToPath(new URL('../../../test-results/integration/artifacts/', import.meta.url));

/** Each standard integration run owns a fresh directory outside tracked release evidence. */
export async function createIntegrationArtifactDirectory(baseDirectory = defaultBaseDirectory): Promise<string> {
  if (!isAbsolute(baseDirectory)) throw new Error('Integration artifact base directory must be absolute.');
  await mkdir(baseDirectory, { recursive: true, mode: 0o700 });
  return mkdtemp(join(baseDirectory, 'run-'));
}

export async function initializeIntegrationArtifactDirectory(
  environment: Record<string, string | undefined> = process.env,
): Promise<string> {
  const configured = environment[INTEGRATION_ARTIFACT_DIRECTORY_ENV];
  if (configured !== undefined) {
    if (!configured || !isAbsolute(configured)) throw new Error('Integration artifact directory must be absolute.');
    await mkdir(configured, { recursive: true, mode: 0o700 });
    return configured;
  }
  const directory = await createIntegrationArtifactDirectory();
  environment[INTEGRATION_ARTIFACT_DIRECTORY_ENV] = directory;
  return directory;
}

/** Fixed, basename-only files cannot escape the run directory or overwrite evidence. */
export async function writeIntegrationArtifact(filename: string, report: unknown): Promise<string> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(filename)) {
    throw new Error('Integration artifact filename must be a JSON basename.');
  }
  const directory = await initializeIntegrationArtifactDirectory();
  const artifactPath = join(directory, filename);
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  process.stdout.write(`INTEGRATION_ARTIFACT ${JSON.stringify({ artifactPath })}\n`);
  return artifactPath;
}
