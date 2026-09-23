import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

function installed(parent, name) {
  let directory = dirname(parent.resolve(name));
  while (true) {
    try {
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      if (manifest.name === name) return { manifest, require: createRequire(join(directory, 'package.json')) };
    } catch {
      // A package entry can sit below its manifest directory.
    }
    const next = dirname(directory);
    if (next === directory) throw new Error(`Cannot locate manifest: ${name}`);
    directory = next;
  }
}

const site = createRequire(new URL('../package.json', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const auth = installed(site, 'better-auth');
assert.equal(manifest.dependencies['better-auth'], '1.6.23');
assert.equal(manifest.dependencies.kysely, '0.29.6');
assert.equal(manifest.dependencies['@neondatabase/auth'], undefined);
assert.equal(auth.manifest.version, '1.6.23');
for (const name of ['@better-auth/core', '@better-auth/kysely-adapter', '@better-auth/memory-adapter']) {
  assert.equal(installed(auth.require, name).manifest.version, '1.6.23');
}
assert.equal(installed(site, 'kysely').manifest.version, '0.29.6');
assert.equal(installed(auth.require, 'kysely').manifest.version, '0.29.6');
console.log('Better Auth 1.6.23 and Kysely 0.29.6 resolve consistently; managed Neon Auth SDK removed.');
