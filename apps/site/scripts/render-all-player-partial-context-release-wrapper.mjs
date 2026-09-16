import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { administrationMigrationChecksum } from './league-administration-release-wrapper.mjs';
import { PARTIAL_CONTEXT_MIGRATIONS, PARTIAL_CONTEXT_INSTALLED_LEDGER,
  partialContextReleaseSentinel, buildAllPlayerPartialContextReleaseWrapper } from './all-player-partial-context-release-wrapper.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || args.some((argument) => argument !== '--review')) throw new Error('Only --review is accepted.');
const reviewOnly = args.includes('--review');
for (const [name, checksum] of PARTIAL_CONTEXT_INSTALLED_LEDGER) {
  const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
  if (administrationMigrationChecksum(sql) !== checksum) throw new Error(`Installed migration ${name} was modified.`);
}
const migrations = await Promise.all(PARTIAL_CONTEXT_MIGRATIONS.map(async (name) => ({ name,
  sql: await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8') })));
const manifest = JSON.parse(await readFile(new URL('../release/all-player-partial-context/catalog.integration.json', import.meta.url), 'utf8'));
const wrapper = buildAllPlayerPartialContextReleaseWrapper({ migrations, expectedDatabase: 'neondb', expectedOwner: 'neondb_owner',
  manifest: reviewOnly ? { ...manifest, reviewed: true } : manifest });
// An unreviewed rendering is entirely comments; it is impossible to apply it accidentally.
const artifact = reviewOnly ? '-- REVIEW ONLY: catalog review and production-release approval are pending.\n'
  + wrapper.split('\n').map((line) => line.trimEnd() ? `-- ${line.trimEnd()}` : '--').join('\n') : wrapper;
const name = reviewOnly ? '018.production.review.sql' : '018.production.sql';
await mkdir(new URL('../release/all-player-partial-context/', import.meta.url), { recursive: true });
await writeFile(new URL(`../release/all-player-partial-context/${name}`, import.meta.url), artifact, 'utf8');
process.stdout.write(`${JSON.stringify({ output: `apps/site/release/all-player-partial-context/${name}`,
  sha256: createHash('sha256').update(artifact).digest('hex'), reviewed: manifest.reviewed,
  executable: !reviewOnly, sentinel: partialContextReleaseSentinel(migrations) })}\n`);
