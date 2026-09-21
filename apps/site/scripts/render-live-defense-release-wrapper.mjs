import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { administrationMigrationChecksum } from './league-administration-release-wrapper.mjs';
import { LIVE_DEFENSE_MIGRATIONS, LIVE_DEFENSE_INSTALLED_LEDGER,
  liveDefenseReleaseSentinel, buildLiveDefenseReleaseWrapper } from './live-defense-release-wrapper.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || args.some((argument) => argument !== '--review')) throw new Error('Only --review is accepted.');
const reviewOnly = args.includes('--review');
for (const [name, checksum] of LIVE_DEFENSE_INSTALLED_LEDGER) {
  const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
  if (administrationMigrationChecksum(sql) !== checksum) throw new Error(`Installed migration ${name} was modified.`);
}
const migrations = await Promise.all(LIVE_DEFENSE_MIGRATIONS.map(async (name) => ({ name,
  sql: await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8') })));
const manifest = JSON.parse(await readFile(new URL('../release/live-defense/catalog.integration.json', import.meta.url), 'utf8'));
const wrapper = buildLiveDefenseReleaseWrapper({ migrations, expectedDatabase: 'neondb', expectedOwner: 'neondb_owner',
  manifest: reviewOnly ? { ...manifest, reviewed: true } : manifest });
// An unreviewed rendering is entirely comments; it is impossible to apply it accidentally.
const artifact = reviewOnly ? '-- REVIEW ONLY: catalog review and production-release approval are pending.\n'
  + wrapper.split('\n').map((line) => line.trimEnd() ? `-- ${line.trimEnd()}` : '--').join('\n') : wrapper;
const name = reviewOnly ? '019.production.review.sql' : '019.production.sql';
await mkdir(new URL('../release/live-defense/', import.meta.url), { recursive: true });
await writeFile(new URL(`../release/live-defense/${name}`, import.meta.url), artifact, 'utf8');
process.stdout.write(`${JSON.stringify({ output: `apps/site/release/live-defense/${name}`,
  sha256: createHash('sha256').update(artifact).digest('hex'), reviewed: manifest.reviewed,
  executable: !reviewOnly, sentinel: liveDefenseReleaseSentinel(migrations) })}\n`);
