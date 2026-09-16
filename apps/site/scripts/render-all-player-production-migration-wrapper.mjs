import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_PLAYER_MIGRATION_SENTINEL,
  buildAllPlayerMigrationReleaseWrapper,
  buildAllPlayerRepairReleaseWrapper,
  buildAllPlayerParticipationReleaseWrapper,
  buildAllPlayerParticipationAssumptionReleaseWrapper,
  buildAllPlayerHourlyReleaseWrapper,
  buildAllPlayerDynastyReleaseWrapper,
  releaseWrapperSha256,
} from './all-player-migration-release-wrapper.mjs';

const repair = process.argv.slice(2).includes('--repair');
const participation = process.argv.slice(2).includes('--participation');
const assumption = process.argv.slice(2).includes('--participation-assumption');
const hourly = process.argv.slice(2).includes('--hourly');
const dynasty = process.argv.slice(2).includes('--dynasty');
if (process.argv.slice(2).length > 1 || process.argv.slice(2).some((argument) => !['--repair','--participation','--participation-assumption','--hourly','--dynasty'].includes(argument))) {
  throw new Error('The production wrapper renderer accepts only one release selector.');
}
const migrationName = dynasty ? '015_all_player_dynasty_publication.sql' : hourly ? '014_all_player_hourly_collection.sql' : assumption ? '013_all_player_participation_assumption.sql' : participation ? '012_all_player_provider_participation.sql' : repair
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
const manifest = (repair || participation || assumption || hourly || dynasty) ? JSON.parse(await readFile(
  new URL(`../release/${dynasty ? '015' : hourly ? '014' : assumption ? '013' : participation ? '012' : '011'}-catalog.integration.json`, import.meta.url), 'utf8',
)) : null;
const wrapper = dynasty
  ? buildAllPlayerDynastyReleaseWrapper({ ...input, runtimeRole: 'league_one_runtime', manifest,
    previousManifest: JSON.parse(await readFile(new URL('../release/014-catalog.integration.json', import.meta.url), 'utf8')) })
  : hourly
  ? buildAllPlayerHourlyReleaseWrapper({ ...input, runtimeRole: 'league_one_runtime', manifest,
    previousManifest: JSON.parse(await readFile(new URL('../release/013-catalog.integration.json', import.meta.url), 'utf8')) })
  : assumption
  ? buildAllPlayerParticipationAssumptionReleaseWrapper({ ...input, runtimeRole: 'league_one_runtime', manifest,
    previousManifest: JSON.parse(await readFile(new URL('../release/012-catalog.integration.json', import.meta.url), 'utf8')) })
  : participation
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
  sentinel: (repair || participation || assumption || hourly || dynasty)
    ? `ALL_PLAYER_${dynasty ? 'DYNASTY' : hourly ? 'HOURLY' : assumption ? 'PARTICIPATION_ASSUMPTION' : participation ? 'PARTICIPATION' : 'REPAIR'}_APPLIED:${migrationName}:${manifest.migrationChecksum}`
    : ALL_PLAYER_MIGRATION_SENTINEL,
})}\n`);
