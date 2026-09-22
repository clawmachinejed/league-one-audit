import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { hooks } from '../../../.pnpmfile.mjs';

// pnpm's peer check covers ordinary peers. The three repaired edges must also
// resolve versions satisfying their ORIGINAL on-disk published declarations.

function installed(parent, name) {
  const entry = parent.resolve(name);
  let directory = dirname(entry);
  while (true) {
    try {
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      if (manifest.name === name) return { manifest, require: createRequire(join(directory, 'package.json')) };
    } catch {
      // A resolved entry can sit below the package's manifest directory.
    }
    const next = dirname(directory);
    if (next === directory) throw new Error(`Cannot locate manifest: ${name}`);
    directory = next;
  }
}

const site = createRequire(new URL('../package.json', import.meta.url));
const sdk = installed(site, '@neondatabase/auth');
const neonUi = installed(sdk.require, '@neondatabase/auth-ui');
const ui = installed(neonUi.require, '@daveyplate/better-auth-ui');
const api = installed(ui.require, '@better-auth/api-key');
const passkey = installed(neonUi.require, '@better-auth/passkey');
const evidence = [];
for (const [consumer, dependency, expectedRange, expectedVersion] of [
  [api, '@better-auth/core', '^1.6.23', '1.6.23'],
  [api, 'better-call', '1.3.7', '1.3.7'],
  [api, 'better-auth', '^1.6.23', '1.6.23'],
  [api, '@better-auth/utils', '0.4.2', '0.4.2'],
  [passkey, '@better-auth/core', '^1.6.23', '1.6.23'],
]) {
  assert.equal(consumer.manifest.peerDependencies[dependency], expectedRange);
  const resolved = installed(consumer.require, dependency);
  assert.equal(resolved.manifest.version, expectedVersion);
  evidence.push({ consumer: `${consumer.manifest.name}@${consumer.manifest.version}`, dependency,
    originalPublishedPeer: expectedRange, actualResolvedVersion: resolved.manifest.version });
}
assert.equal(sdk.manifest.version, '0.5.0-beta');
assert.equal(neonUi.manifest.version, '0.3.0-beta');
assert.equal(ui.manifest.version, '3.4.0');
assert.equal(api.manifest.version, '1.6.23');
assert.equal(passkey.manifest.version, '1.6.23');
assert.equal(installed(ui.require, 'better-call').manifest.version, '2.0.2');
assert.equal(installed(neonUi.require, 'better-call').manifest.version, '1.3.7');
assert.equal(installed(sdk.require, 'better-auth').manifest.version, '1.6.23');

const unchanged = { name: '@better-auth/api-key', version: '1.7.5', peerDependencies: { 'better-call': '1.4.0' } };
assert.deepEqual(hooks.readPackage(structuredClone(unchanged)), unchanged);
assert.throws(() => hooks.readPackage({ name: '@better-auth/api-key', version: '1.6.23',
  peerDependencies: { '@better-auth/core': '^1.7.5', 'better-call': '1.3.7' } }), /Unexpected published dependency metadata/);
assert.throws(() => hooks.readPackage({ name: '@better-auth/passkey', version: '1.6.23',
  peerDependencies: { '@better-auth/core': '^1.6.23' }, dependencies: { '@better-auth/core': '1.7.5' } }),
  /Unexpected published dependency metadata/);
console.log(JSON.stringify({ sdk: sdk.manifest.version, neonUi: neonUi.manifest.version, ui: ui.manifest.version,
  originalPeerRequirementsVerified: evidence, uiBetterCallPreserved: '2.0.2', exactScopeAndMetadataGuards: 'passed' }, null, 2));
