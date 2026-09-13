import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_PLAYER_MIGRATION_SENTINEL,
  buildAllPlayerMigrationReleaseWrapper,
  buildAllPlayerRepairReleaseWrapper,
  buildAllPlayerParticipationReleaseWrapper,
  releaseWrapperSha256,
} from './all-player-migration-release-wrapper.mjs';

const repair = process.argv.slice(2).includes('--repair');
const participation = process.argv.slice(2).includes('--participation');
if ((repair && participation) || process.argv.slice(2).some((argument) => !['--repair','--participation'].includes(argument))) {
  throw new Error('The production wrapper renderer accepts only one of --repair or --participation.');
}
const migrationName = participation ? '012_all_player_provider_participation.sql' : repair
  ? '011_all_player_foundation_guards.sql'
  : '010_all_player_statistics.sql';
const migrationPath = fileURLToPath(
  new URL(`../migrations/${migrationName}`, import.meta.url),
);
const outputName = migrationName.replace(/\.sql$/u, '.production.sql');
const outputUrl = new URL(`../release/${outputName}`, import.meta.url);
const outputPath = fileURLToPath(outputUrl);
// These are reviewed service identities, never connection strings. Rendering
// performs no database operation; execution requires fresh identity validation.
const input = {
  migrationSql: await readFile(migrationPath, 'utf8'),
  expectedDatabase: 'neondb',
  expectedOwner: 'neondb_owner',
};
const manifest = (repair || participation) ? JSON.parse(await readFile(
  new URL(`../release/${participation ? '012' : '011'}-catalog.integration.json`, import.meta.url), 'utf8',
)) : null;
const wrapper = participation
  ? buildAllPlayerParticipationReleaseWrapper({ ...input, runtimeRole: 'league_one_runtime', manifest,
    previousManifest: JSON.parse(await readFile(new URL('../release/011-catalog.integration.json', import.meta.url), 'utf8')) })
  : repair
  ? buildAllPlayerRepairReleaseWrapper({ ...input, runtimeRole: 'league_one_runtime', manifest })
  : buildAllPlayerMigrationReleaseWrapper(input);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, wrapper, 'utf8');
process.stdout.write(`${JSON.stringify({
  output: `apps/site/release/${outputName}`,
  sha256: releaseWrapperSha256(wrapper),
  sentinel: (repair || participation)
    ? `ALL_PLAYER_${participation ? 'PARTICIPATION' : 'REPAIR'}_APPLIED:${migrationName}:${manifest.migrationChecksum}`
    : ALL_PLAYER_MIGRATION_SENTINEL,
})}\n`);
