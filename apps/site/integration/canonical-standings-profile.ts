import assert from 'node:assert/strict';

/** RFQ1 source preparation only. This profile adds no database execution authority. */
export const CANONICAL_STANDINGS_PROFILE = 'data-canonical-standings-v1' as const;
export const CANONICAL_STANDINGS_MODULE = 'integration/canonical-standings.qualification-case.ts' as const;
export const CANONICAL_STANDINGS_SUITE = 'canonical official standings through restricted runtime' as const;
export const CANONICAL_STANDINGS_TESTS = [
  'S01 records standalone opaque standings through real restricted job registration reservation write and read',
  'S02 preserves independent Sleeper native field parity and the original legacy facade',
  'S03 separates qualified source identities and rejects changed mapping job and registration authority',
  'S04 rejects verifier forgery private helpers legacy inner writers and direct runtime mutation',
  'S05 rejects typed closure corruption and rolls the complete statement back',
  'S06 binds zero one and invalid native companions to the unchanged original capture witness',
  'S07 replays only the original canonical and native evidence pair',
  'S08 retains repeated observations corrections and immutable source time conflicts',
  'S09 reports latest partial unproved mismatch failed and pending observations without borrowing history',
  'S10 rejects original ownership loss after real independent lock waits and deferred commit',
  'S11 preserves production fixture denial and role first plus future provisioner boundaries',
  'S12 preserves legacy installation bytes and canonical plus legacy historical reads after remap',
  'S13 adds no provider acquisition and preserves both leagues protected source behavior',
] as const;
export const CANONICAL_STANDINGS_FULL_NAMES = CANONICAL_STANDINGS_TESTS.map(name => `${CANONICAL_STANDINGS_SUITE} > ${name}`);
export const CANONICAL_STANDINGS_PATTERN = new RegExp('^(?:' + CANONICAL_STANDINGS_FULL_NAMES
  .map(name => name.replaceAll(' > ', ' ').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|') + ')$').source;
export const CANONICAL_STANDINGS_CASE_TIMEOUTS_MS = [45,45,60,45,90,240,90,60,90,120,60,60,60].map(seconds => seconds * 1000);
export const CANONICAL_STANDINGS_BEFORE_ALL_MS = 420_000;
export const CANONICAL_STANDINGS_AFTER_ALL_MS = 60_000;
export const CANONICAL_STANDINGS_LIMITS = Object.freeze({
  workMs: 1_800_000, reservedMs: 255_000, lockWaitMs: 10_000, expiryWaitMs: 3_000,
  // Four S06 dispatches have at most three full sixty-second gaps, leaving sixty seconds for SQL.
  nativeDispatches: 4, originalDispatchIntervalMs: 60_000, minimumPostgresVersion: 180_000, maximumPostgresVersion: 189_999,
  providerSimulation: true, actualProviderRequests: 0, retries: 0,
});
assert.equal(CANONICAL_STANDINGS_TESTS.length, 13);
assert.equal(CANONICAL_STANDINGS_CASE_TIMEOUTS_MS.length, CANONICAL_STANDINGS_TESTS.length);
assert.equal(CANONICAL_STANDINGS_BEFORE_ALL_MS + CANONICAL_STANDINGS_AFTER_ALL_MS
  + CANONICAL_STANDINGS_CASE_TIMEOUTS_MS.reduce((sum, value) => sum + value, 0)
  + CANONICAL_STANDINGS_LIMITS.reservedMs, CANONICAL_STANDINGS_LIMITS.workMs);

export const CANONICAL_STANDINGS_EVIDENCE_FILE = 'canonical-standings-evidence.json';
const mockedNativeSources = [
  { id: '900000000000101', manager: '900000000000201', username: 'canonical_legacy_fixture' },
  { id: '900000000000102', manager: '900000000000202', username: 'canonical_bridge_fixture' },
] as const;
export const CANONICAL_STANDINGS_MOCKED_REQUESTS = mockedNativeSources.flatMap(source => [
  `/v1/user/${source.username}`, `/v1/user/${source.manager}/leagues/nfl/2026`,
  `/v1/league/${source.id}`, `/v1/league/${source.id}`, `/v1/league/${source.id}/rosters`,
]);
/** Fixed adverse-probe assertions and restored controls; pinned source retains
 * which probes use restricted LOGIN and which use owner fault instrumentation. */
export const CANONICAL_STANDINGS_REQUIRED_ASSERTIONS = [
  'production-fixture-denial', 'bridge-replay-capture-id', 'duplicate-native-companion',
  'native-parity', 'mixed-input', 'fixture-provenance-pair', 'private-helpers', 'direct-evidence-dml',
  'typed-value', 'missing-child', 'wrong-team-uuid', 'duplicate-child', 'state-value-pair',
  'first-receipt-closure', 'post-materialization-rollback', 'observed-source-lock-expiry',
  'observed-head-lock-expiry', 'superseded-original-fence', 'registration-deferred-expiry',
  'membership-deferred-payload', 'membership-deferred-expiry', 'receipt-deferred-expiry',
  'account-auth-public-denial', 'runtime-policy-replacement', 'provisioner-grants-restored',
  'historical-remap-current-denial',
  'native-companion-atomic-rollback', 'bridge-swapped-witness', 'bridge-swapped-payload',
  'bridge-swapped-attempt', 'bridge-old-native-receipt', 'bridge-old-capture-new-attempt',
  'zero-native-companion', 'null-companion-nonce', 'predispatch-companion', 'late-native-companion',
  'wrong-mapping-companion', 'unknown-native-companion', 'wrong-work-companion',
  'observed-job-lock-context-change', 'remap-alias-registration-denial',
  'writer-source-lock-expiry', 'writer-head-lock-expiry',
] as const;
assert.equal(CANONICAL_STANDINGS_REQUIRED_ASSERTIONS.length, 43);
export function assertCanonicalStandingsEvidence(value: unknown, contextDigest: string): void {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'Missing canonical standings companion evidence.');
  const evidence = value as Record<string, unknown>;
  assert.deepEqual(Object.keys(evidence).sort(), ['kind', 'contextDigest', 'serverVersion', 'serverVersionNum',
    'providerSimulation', 'actualProviderRequests', 'mockedRequests', 'originalSealedCaptures', 'nativeStepDurationsMs', 'forbiddenRequests',
    'completed', 'boundaryAssertions', 'cleanupComplete'].sort(), 'Canonical standings evidence shape changed.');
  assert.equal(evidence.kind, 'canonical-standings-qualification-evidence-v1');
  assert.match(contextDigest, /^[0-9a-f]{64}$/u); assert.equal(evidence.contextDigest, contextDigest);
  assert(typeof evidence.serverVersion === 'string' && /^18(?:\.|\b)/u.test(evidence.serverVersion), 'Actual PostgreSQL 18 version evidence required.');
  assert(typeof evidence.serverVersionNum === 'number' && Number.isInteger(evidence.serverVersionNum)
    && evidence.serverVersionNum >= CANONICAL_STANDINGS_LIMITS.minimumPostgresVersion
    && evidence.serverVersionNum <= CANONICAL_STANDINGS_LIMITS.maximumPostgresVersion, 'PostgreSQL engine differs from the reviewed trigger-role contract.');
  assert.equal(evidence.providerSimulation, true); assert.equal(evidence.actualProviderRequests, 0);
  assert.equal(evidence.forbiddenRequests, 0); assert.equal(evidence.originalSealedCaptures, 6);
  assert(Array.isArray(evidence.nativeStepDurationsMs) && evidence.nativeStepDurationsMs.length === 8
    && evidence.nativeStepDurationsMs.every(value => typeof value === 'number' && Number.isSafeInteger(value)
      && value >= 0 && value < 20_000), 'Eight bounded actual native step durations required.');
  assert.deepEqual(evidence.mockedRequests, CANONICAL_STANDINGS_MOCKED_REQUESTS);
  assert.deepEqual(evidence.completed, CANONICAL_STANDINGS_TESTS);
  assert(Array.isArray(evidence.boundaryAssertions) && evidence.boundaryAssertions.every(label => typeof label === 'string'));
  assert.equal(new Set(evidence.boundaryAssertions).size, evidence.boundaryAssertions.length, 'Duplicate canonical boundary assertion evidence.');
  assert.deepEqual([...evidence.boundaryAssertions].sort(), [...CANONICAL_STANDINGS_REQUIRED_ASSERTIONS].sort(),
    'Canonical adverse-probe inventory differs from the reviewed source.');
  assert.equal(evidence.cleanupComplete, true);
}
