import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_PLAYER_MIGRATION_SENTINEL,
  buildAllPlayerMigrationReleaseWrapper,
  releaseWrapperSha256,
} from './all-player-migration-release-wrapper.mjs';

const migrationPath = fileURLToPath(
  new URL('../migrations/010_all_player_statistics.sql', import.meta.url),
);
const outputUrl = new URL('../release/010_all_player_statistics.production.sql', import.meta.url);
const outputPath = fileURLToPath(outputUrl);
const wrapper = buildAllPlayerMigrationReleaseWrapper({
  migrationSql: await readFile(migrationPath, 'utf8'),
  expectedDatabase: 'neondb',
  expectedOwner: 'neondb_owner',
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, wrapper, 'utf8');
process.stdout.write(`${JSON.stringify({
  output: 'apps/site/release/010_all_player_statistics.production.sql',
  sha256: releaseWrapperSha256(wrapper),
  sentinel: ALL_PLAYER_MIGRATION_SENTINEL,
})}\n`);
