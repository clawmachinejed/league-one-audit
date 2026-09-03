import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectionRoot = dirname(fileURLToPath(import.meta.url));
const expectedPorts = [
  'clock.ts',
  'future-refresh-repository.ts',
  'game-state-feed.ts',
  'id-generator.ts',
  'identity-crosswalk.ts',
  'league-registry.ts',
  'league-source.ts',
  'lineup-source.ts',
  'lineup-watch-repository.ts',
  'logger.ts',
  'nfl-calendar.ts',
  'period-authority-reader.ts',
  'projection-feed.ts',
  'projection-repository.ts',
];

describe('canonical foundation boundaries', () => {
  it('contains the complete approved port set', () => {
    const files = readdirSync(join(projectionRoot, 'ports')).filter((file) => file.endsWith('.ts')).sort();
    expect(files).toEqual(expectedPorts);
  });

  it.each(['domain', 'ports'])('%s has no concrete provider or infrastructure imports', (folder) => {
    const directory = join(projectionRoot, folder);
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
      const source = readFileSync(join(directory, file), 'utf8');
      expect(source, file).not.toMatch(/\b(?:sleeper|tank01)\b/iu);
      expect(source, file).not.toMatch(/from\s+['"][^'"]*(?:adapters|database|next|react|server-only)[^'"]*['"]/u);
      expect(source, file).not.toMatch(/process\.env/u);
    }
  });
});
