import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

export const QUALIFICATION_CONTEXT_ENV = 'PROJECTION_INTEGRATION_QUALIFICATION_CONTEXT';
const ARTIFACT_ENV = 'PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY';
export const QUALIFICATION_FILES = { report: 'qualification-report.json', cleanup: 'qualification-cleanup.json',
  failure: 'qualification-failure.json' } as const;
export const QUALIFICATION_MAX_BYTES = 4 * 1024 * 1024;
export const SELECTED_PROFILE = 'data-core-refresh-v1';
export const INGESTION_PROFILE = 'data-core-ingestion-v1';
export const LIVE_PROFILE = 'data-live-league-two-v1';
export const LIVE_MODULE = 'integration/league-two.live-integration-case.ts';
export const LIVE_SOURCE_DIGEST = 'bcb3bee63bf12658da7d099fd34397fada96757a5799e05a586456761b173f74';
export const LIVE_SUITE = 'live League Two registered core through existing capture and typed readers';
export const LIVE_TEST = 'retains four bounded public captures and exact official core readback [live slow SQL]';
export const LIVE_FULL_NAME = LIVE_SUITE + ' > ' + LIVE_TEST;
export const LIVE_PATTERN = '^' + (LIVE_SUITE + ' ' + LIVE_TEST).replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&') + '$';
export const JOURNEY_PROFILE = 'data-live-public-intake-v1';
export const JOURNEY_MODULE = 'integration/public-data.live-integration-case.ts';
export const JOURNEY_SOURCE_DIGEST = '3d51da6710c64cccba8064806e3ff47a16240deef46b72c16a228453cae5699b';
export const JOURNEY_SUITE = 'live public DATA intake and refresh through the existing owner';
export const JOURNEY_TEST = 'retains DannyPak discovery, all associated leagues and one complete refresh [live slow SQL]';
export const JOURNEY_FULL_NAME = JOURNEY_SUITE + ' > ' + JOURNEY_TEST;
export const JOURNEY_PATTERN = '^' + (JOURNEY_SUITE + ' ' + JOURNEY_TEST).replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&') + '$';
export type QualificationProfile = 'full' | typeof SELECTED_PROFILE | typeof INGESTION_PROFILE | typeof LIVE_PROFILE | typeof JOURNEY_PROFILE | typeof OFFICIAL_PROFILE | typeof GUARDS_PROFILE | typeof CONCURRENCY_PROFILE | typeof LATE_WRITE_PROFILE
  | typeof INTAKE_RECOVERY_PROFILE | typeof REFRESH_HISTORY_PROFILE | typeof PERIOD_RECOVERY_PROFILE | typeof PERIOD_EXHAUSTION_PROFILE | typeof PERIOD_INVENTORY_PROFILE | typeof PERIOD_CAPACITY_PROFILE | typeof PERIOD_UPGRADE_PROFILE;
export const SELECTED_SOURCE_DIGEST = '46cc99e68ae41c921d682d70aecca8ed0e947b30eacceb94c670bcbb8411dc9c';
export const SELECTED_MODULE = 'integration/public-data-intake.integration-case.ts';
export const SELECTED_SUITE = 'bounded public DATA refresh cycles through the existing intake owner';
export const SELECTED_TEST = 'refreshes two typed core cycles with real admission spacing, a correction and lost-checkpoint replay [focused slow SQL]';
export const SELECTED_FULL_NAME = SELECTED_SUITE + ' > ' + SELECTED_TEST;
export const SELECTED_PATTERN = '^' + (SELECTED_SUITE + ' ' + SELECTED_TEST).replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&') + '$';

export const INGESTION_SUITE = 'ordinary public DATA ingestion through the existing intake owner';
export const INGESTION_TEST = 'stores one public manager league through canonical bootstrap and typed backend readers [focused slow SQL]';
export const INGESTION_FULL_NAME = INGESTION_SUITE + ' > ' + INGESTION_TEST;
export const INGESTION_PATTERN = '^' + (INGESTION_SUITE + ' ' + INGESTION_TEST).replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&') + '$';
export const OFFICIAL_PROFILE = 'data-official-preconfiguration-v1';
export const OFFICIAL_SUITE = 'official preconfiguration source normalization to restricted typed storage';
export const OFFICIAL_TESTS = [
  'recovers the same NULL-profile identity after canonical registration commits before the bootstrap checkpoint [focused slow SQL]',
  'retains all nine missing/null/empty scoring and slot combinations, rejects malformed fields and versions later rules',
] as const;
export const OFFICIAL_FULL_NAMES = OFFICIAL_TESTS.map(name => OFFICIAL_SUITE + ' > ' + name);
export const OFFICIAL_PATTERN = new RegExp('^(?:' + OFFICIAL_TESTS.map(name => (OFFICIAL_SUITE + ' ' + name)
  .replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&')).join('|') + ')$').source;
export const GUARDS_PROFILE = 'data-ingestion-guards-v1';
// Source order matters: the job-row work-deadline case observes the cycle retained by the first case.
const GUARDS_CASES = [
  [SELECTED_SUITE, 'retains one cycle through concurrent selectors, unknown acknowledgements, poisoned selection and sequential approval checks'],
  [SELECTED_SUITE, 'rejects private helpers and direct cursor/history writes, and rolls back selection after an actual job-lock expiry'],
  ['explicit public native-period intake through retained typed receipts', 'enforces SQL selector validation and identical omitted/empty replay before mutation'],
] as const;
export const GUARDS_FULL_NAMES = GUARDS_CASES.map(path => path.join(' > '));
export const GUARDS_PATTERN = new RegExp('^(?:' + GUARDS_CASES.map(path => path.join(' ')
  .replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&')).join('|') + ')$').source;
export const CONCURRENCY_PROFILE = 'data-refresh-concurrency-v1';
// The first case retains cycle history without admitting its identity step; later cases must preserve it.
export const CONCURRENCY_TESTS = [
  'retains one cycle through concurrent selectors, unknown acknowledgements, poisoned selection and sequential approval checks',
  'serializes competing configuration CAS calls behind one observed lock and retains only the winning revision',
  'observes a pause commit win against an admission already waiting on the target row',
  'rejects approval that expires during an observed target-row admission wait under the original live fence',
  'retains a real admitted capture when a competing pause waits for that admission to commit',
] as const;
export const CONCURRENCY_FULL_NAMES = CONCURRENCY_TESTS.map(name => SELECTED_SUITE + ' > ' + name);
export const CONCURRENCY_PATTERN = new RegExp('^(?:' + CONCURRENCY_TESTS.map(name => (SELECTED_SUITE + ' ' + name)
  .replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&')).join('|') + ')$').source;
export const LATE_WRITE_PROFILE = 'data-late-write-rollback-v1';
export const LATE_WRITE_SUITE = 'public data source to typed PostgreSQL readback and recovery';
export const LATE_WRITE_TESTS = [
  'rejects a restricted bootstrap after an advisory wait expires without leaving identity or reservation',
  'rolls back configured canonical registration and its reservation when an identity-row wait outlives the postcondition fence',
  'rolls back official-only canonical registration and its reservation when an identity-row wait outlives the postcondition fence',
] as const;
export const LATE_WRITE_FULL_NAMES = LATE_WRITE_TESTS.map(name => LATE_WRITE_SUITE + ' > ' + name);
export const LATE_WRITE_PATTERN = new RegExp('^(?:' + LATE_WRITE_TESTS.map(name => (LATE_WRITE_SUITE + ' ' + name)
  .replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&')).join('|') + ')$').source;
export const INTAKE_RECOVERY_PROFILE = 'data-intake-recovery-v1';
export const REFRESH_HISTORY_PROFILE = 'data-refresh-history-v1';
export const PERIOD_RECOVERY_PROFILE = 'data-period-recovery-v1';
export const PERIOD_EXHAUSTION_PROFILE = 'data-period-exhaustion-v1';
export const PERIOD_SUITE = 'explicit public native-period intake through retained typed receipts';
export const PERIOD_INVENTORY_PROFILE = 'data-period-inventory-v1';
export const PERIOD_CAPACITY_PROFILE = 'data-period-capacity-v1';
export const PERIOD_UPGRADE_PROFILE = 'data-period-upgrade-v1';
export const PERIOD_INVENTORY_SUITE = 'bounded explicit native-week inventory through existing DATA intake';
export const PERIOD_UPGRADE_SUITE = 'explicit native-week inventory upgrade over retained R039 capture';
export const PERIOD_INVENTORY_FULL_NAMES = [PERIOD_INVENTORY_SUITE + ' > retains two same-season weeks across recurring correction and lost-checkpoint recovery [inventory slow SQL]'];
export const PERIOD_CAPACITY_NEW_NAMES = ['same-season expansion', 'cumulative seasons', 'all discovered candidates']
  .map(name => PERIOD_INVENTORY_SUITE + ' > retains complete requested scope and rejects period acquisition over capacity: ' + name);
export const PERIOD_CAPACITY_FULL_NAMES = [
  PERIOD_SUITE + ' > enforces SQL selector validation and identical omitted/empty replay before mutation',
  PERIOD_SUITE + ' > enforces twenty task ordinals, candidate lineage and immutable scope with rolled-back owner-only negative prerequisites',
  ...PERIOD_CAPACITY_NEW_NAMES,
];
export const PERIOD_UPGRADE_FULL_NAMES = [PERIOD_UPGRADE_SUITE + ' > preserves a real single-week checkpoint across R040 and refuses downlevel multi-week mutation [upgrade slow SQL]'];
// The configured registration case supplies fairness's genuine second identity.
// The selector case retains the selection-failure history used by later assertions.
export const INTAKE_RECOVERY_FULL_NAMES = [
  LATE_WRITE_SUITE + ' > binds typed receipts, preserves core through interruption, recovers once and permits explicit existing-consumer adoption',
  LATE_WRITE_SUITE + ' > admits generation one after normal completed-job retention while preserving older dispatch history',
  LATE_WRITE_FULL_NAMES[1],
  CONCURRENCY_FULL_NAMES[0],
  SELECTED_SUITE + ' > defers a failed selection without giving it admission credit or monopolizing another verified target',
  PERIOD_SUITE + ' > enforces twenty task ordinals, candidate lineage and immutable scope with rolled-back owner-only negative prerequisites',
];
// Keep both typed cycles before empty cycles and immutable-history/limit checks.
// Metadata consumes the already-settled terminal cycle retained by pending capacity.
export const REFRESH_HISTORY_FULL_NAMES = [
  CONCURRENCY_FULL_NAMES[0], SELECTED_FULL_NAME,
  ...[
    'retains two empty-list cycles without relabeling previous typed data or replaying missed cadence slots [focused slow SQL]',
    'refuses owner UPDATE and DELETE of existing immutable refresh history and preserves later-cycle rows',
    'shares the existing sixteen-pending-request limit with manual submissions without spending admission credit',
    'copies explicit periods into a new ordinary cycle and preserves original scope across replay and configuration CAS [R038 metadata only]',
    'counts paused synthetic metadata targets toward the total16 bound using a genuine restricted configure call',
  ].map(name => SELECTED_SUITE + ' > ' + name),
];
export const PERIOD_RECOVERY_FULL_NAMES = [PERIOD_SUITE + ' > binds both reservations, rejects stale/fenced receipts, recovers an observed lock expiry and lost acknowledgments, and preserves periods through core failure [focused slow SQL]'];
export const PERIOD_EXHAUSTION_FULL_NAMES = [PERIOD_SUITE + ' > exhausts five real exact-period retries without closing core or fabricating a period checkpoint [focused slow SQL]'];
function closedPattern(names: readonly string[]): string {
  return new RegExp('^(?:' + names.map(name => name.replaceAll(' > ', ' ')
    .replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&')).join('|') + ')$').source;
}
export const CLOSEOUT_PROFILES = [
  { profile: INTAKE_RECOVERY_PROFILE, names: INTAKE_RECOVERY_FULL_NAMES, pattern: closedPattern(INTAKE_RECOVERY_FULL_NAMES),
    suites: [LATE_WRITE_SUITE, SELECTED_SUITE, PERIOD_SUITE] },
  { profile: REFRESH_HISTORY_PROFILE, names: REFRESH_HISTORY_FULL_NAMES, pattern: closedPattern(REFRESH_HISTORY_FULL_NAMES),
    suites: [SELECTED_SUITE] },
  { profile: PERIOD_RECOVERY_PROFILE, names: PERIOD_RECOVERY_FULL_NAMES, pattern: closedPattern(PERIOD_RECOVERY_FULL_NAMES),
    suites: [PERIOD_SUITE] },
  { profile: PERIOD_EXHAUSTION_PROFILE, names: PERIOD_EXHAUSTION_FULL_NAMES, pattern: closedPattern(PERIOD_EXHAUSTION_FULL_NAMES),
    suites: [PERIOD_SUITE] },
] as const;
// Inventory selections are separate from the historical four-profile closeout.
export const INVENTORY_PROFILES = [
  { profile: PERIOD_INVENTORY_PROFILE, names: PERIOD_INVENTORY_FULL_NAMES, pattern: closedPattern(PERIOD_INVENTORY_FULL_NAMES),
    suites: [PERIOD_INVENTORY_SUITE] },
  { profile: PERIOD_CAPACITY_PROFILE, names: PERIOD_CAPACITY_FULL_NAMES, pattern: closedPattern(PERIOD_CAPACITY_FULL_NAMES),
    suites: [PERIOD_SUITE, PERIOD_INVENTORY_SUITE] },
  { profile: PERIOD_UPGRADE_PROFILE, names: PERIOD_UPGRADE_FULL_NAMES, pattern: closedPattern(PERIOD_UPGRADE_FULL_NAMES),
    suites: [PERIOD_UPGRADE_SUITE] },
] as const;
export const CLOSED_PROFILES = [...CLOSEOUT_PROFILES, ...INVENTORY_PROFILES] as const;
function selectedCase(profile: QualificationProfile) {
  const closeout = CLOSED_PROFILES.find(selection => selection.profile === profile);
  if (closeout) return closeout;
  if (profile === LATE_WRITE_PROFILE) return { names: LATE_WRITE_FULL_NAMES, pattern: LATE_WRITE_PATTERN };
  if (profile === CONCURRENCY_PROFILE) return { names: CONCURRENCY_FULL_NAMES, pattern: CONCURRENCY_PATTERN };
  if (profile === LIVE_PROFILE) return { names: [LIVE_FULL_NAME], pattern: LIVE_PATTERN };
  if (profile === JOURNEY_PROFILE) return { names: [JOURNEY_FULL_NAME], pattern: JOURNEY_PATTERN };
  if (profile === GUARDS_PROFILE) return { names: GUARDS_FULL_NAMES, pattern: GUARDS_PATTERN };
  if (profile === OFFICIAL_PROFILE) return { names: OFFICIAL_FULL_NAMES, pattern: OFFICIAL_PATTERN };
  assert(profile === SELECTED_PROFILE || profile === INGESTION_PROFILE, 'Unknown closed qualification profile.');
  return profile === SELECTED_PROFILE ? { names: [SELECTED_FULL_NAME], pattern: SELECTED_PATTERN }
    : { names: [INGESTION_FULL_NAME], pattern: INGESTION_PATTERN };
}

// Closed collected-case inventory, including the two-value it.each expansion.
// Source changes require renewed review of both the inventory and source digest.
export const PRE_INVENTORY_CASES = [
  INGESTION_FULL_NAME,
  ...[
    'binds typed receipts, preserves core through interruption, recovers once and permits explicit existing-consumer adoption',
    'admits generation one after normal completed-job retention while preserving older dispatch history',
    'rejects a restricted bootstrap after an advisory wait expires without leaving identity or reservation',
    'rolls back configured canonical registration and its reservation when an identity-row wait outlives the postcondition fence',
    'rolls back official-only canonical registration and its reservation when an identity-row wait outlives the postcondition fence',
  ].map(name => 'public data source to typed PostgreSQL readback and recovery > ' + name),
  ...[
    'retains one cycle through concurrent selectors, unknown acknowledgements, poisoned selection and sequential approval checks',
    'defers a failed selection without giving it admission credit or monopolizing another verified target',
    'rejects private helpers and direct cursor/history writes, and rolls back selection after an actual job-lock expiry',
    'serializes competing configuration CAS calls behind one observed lock and retains only the winning revision',
    'observes a pause commit win against an admission already waiting on the target row',
    'rejects approval that expires during an observed target-row admission wait under the original live fence',
    'retains a real admitted capture when a competing pause waits for that admission to commit',
    SELECTED_TEST,
    'retains two empty-list cycles without relabeling previous typed data or replaying missed cadence slots [focused slow SQL]',
    'refuses owner UPDATE and DELETE of existing immutable refresh history and preserves later-cycle rows',
    'shares the existing sixteen-pending-request limit with manual submissions without spending admission credit',
    'copies explicit periods into a new ordinary cycle and preserves original scope across replay and configuration CAS [R038 metadata only]',
    'counts paused synthetic metadata targets toward the total16 bound using a genuine restricted configure call',
  ].map(name => SELECTED_SUITE + ' > ' + name),
  ...OFFICIAL_FULL_NAMES,
  ...[
    'enforces SQL selector validation and identical omitted/empty replay before mutation',
    'enforces twenty task ordinals, candidate lineage and immutable scope with rolled-back owner-only negative prerequisites',
    'binds both reservations, rejects stale/fenced receipts, recovers an observed lock expiry and lost acknowledgments, and preserves periods through core failure [focused slow SQL]',
    'exhausts five real exact-period retries without closing core or fabricating a period checkpoint [focused slow SQL]',
  ].map(name => 'explicit public native-period intake through retained typed receipts > ' + name),
].sort();
export const SELECTED_INVENTORY = [...PRE_INVENTORY_CASES, ...PERIOD_INVENTORY_FULL_NAMES,
  ...PERIOD_CAPACITY_NEW_NAMES, ...PERIOD_UPGRADE_FULL_NAMES].sort();

export type QualificationContext = {
  kind: 'integration-qualification-context-v1'; runId: string; nonce: string; gitSha: string;
  profile: QualificationProfile; profileDigest: string; modules: { path: string; sourceDigest: string }[];
};
export type QualificationCase = {
  id: string; name: string; state: string; mode: string; expectedFailure: boolean; configuredRetries: boolean;
  configuredRepeats: number; errors: number; readyEvents: number; resultEvents: number;
  diagnostic: { retryCount: number; repeatCount: number; flaky: boolean; duration: number; startTime: number } | null;
};
export type QualificationReport = {
  kind: 'integration-qualification-report-v1'; contextDigest: string; starts: number; ends: number;
  reason: string; unhandledErrors: number;
  specifications: { path: string; pattern: string | null; otherFilters: boolean }[];
  collected: string[]; hooks: { key: string; starts: number; ends: number }[];
  modules: { path: string; state: string; errors: number; suites: { id: string; name: string; mode: string; errors: number }[];
    cases: QualificationCase[] }[];
};
export type QualificationBinding = { context: QualificationContext; directory: string };
export function qualificationDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
export function qualificationSourceDigest(source: string): string {
  return createHash('sha256').update(source.replace(/\r\n?/gu, '\n'), 'utf8').digest('hex');
}
function selectedModule(profile: QualificationProfile) {
  return profile === JOURNEY_PROFILE ? JOURNEY_MODULE : profile === LIVE_PROFILE ? LIVE_MODULE : SELECTED_MODULE;
}
function selectedDigest(profile: QualificationProfile) {
  return profile === JOURNEY_PROFILE ? JOURNEY_SOURCE_DIGEST : profile === LIVE_PROFILE ? LIVE_SOURCE_DIGEST : SELECTED_SOURCE_DIGEST;
}
function selectedInventory(profile: QualificationProfile) {
  return profile === JOURNEY_PROFILE ? [JOURNEY_FULL_NAME] : profile === LIVE_PROFILE ? [LIVE_FULL_NAME] : SELECTED_INVENTORY;
}
function profileDigest(profile: QualificationProfile) {
  return qualificationDigest({ version: 1, profile, module: profile === 'full' ? null : selectedModule(profile),
    pattern: profile === 'full' ? null : selectedCase(profile).pattern, sourceDigest: profile === 'full' ? null : selectedDigest(profile), inventory: profile === 'full' ? null : selectedInventory(profile) });
}
export function parseQualificationArguments(args: readonly string[]): QualificationProfile {
  if (!args.length) return 'full';
  const closeout = CLOSED_PROFILES.find(selection => args.length === 1 && args[0] === '--profile=' + selection.profile);
  if (closeout) return closeout.profile;
  if (args.length === 1 && args[0] === '--profile=' + SELECTED_PROFILE) return SELECTED_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + INGESTION_PROFILE) return INGESTION_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + LIVE_PROFILE) return LIVE_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + JOURNEY_PROFILE) return JOURNEY_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + OFFICIAL_PROFILE) return OFFICIAL_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + GUARDS_PROFILE) return GUARDS_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + CONCURRENCY_PROFILE) return CONCURRENCY_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + LATE_WRITE_PROFILE) return LATE_WRITE_PROFILE;
  throw new Error('Only the closed data-period-inventory-v1, data-period-capacity-v1, data-period-upgrade-v1, data-intake-recovery-v1, data-refresh-history-v1, data-period-recovery-v1, data-period-exhaustion-v1, data-late-write-rollback-v1, data-refresh-concurrency-v1, data-ingestion-guards-v1, data-official-preconfiguration-v1, data-live-public-intake-v1, data-live-league-two-v1, data-core-refresh-v1 and data-core-ingestion-v1 qualification selectors are accepted.');
}
export function qualificationArguments(profile: QualificationProfile, reporter: string): string[] {
  assert(profile === 'full' || profile === SELECTED_PROFILE || profile === INGESTION_PROFILE || profile === LIVE_PROFILE || profile === JOURNEY_PROFILE || profile === OFFICIAL_PROFILE || profile === GUARDS_PROFILE || profile === CONCURRENCY_PROFILE || profile === LATE_WRITE_PROFILE || CLOSED_PROFILES.some(selection => selection.profile === profile), 'Unknown qualification profile.');
  return ['--reporter', 'verbose', '--reporter', reporter,
    ...(profile === 'full' ? [] : [selectedModule(profile), '--testNamePattern', selectedCase(profile).pattern])];
}
function exactKeys(value: object, keys: string[]) {
  assert.deepEqual(Object.keys(value).sort(), keys.sort(), 'Malformed qualification evidence keys.');
}
function validateContext(value: QualificationContext): QualificationContext {
  assert(value && typeof value === 'object', 'Qualification context is required.');
  exactKeys(value, ['kind', 'runId', 'nonce', 'gitSha', 'profile', 'profileDigest', 'modules']);
  assert.equal(value.kind, 'integration-qualification-context-v1');
  for (const id of [value.runId, value.nonce]) assert.match(id, /^[0-9a-f]{8}-[0-9a-f-]{27}$/u);
  assert.match(value.gitSha, /^[0-9a-f]{40}$/u);
  assert(value.profile === 'full' || value.profile === SELECTED_PROFILE || value.profile === INGESTION_PROFILE || value.profile === LIVE_PROFILE || value.profile === JOURNEY_PROFILE || value.profile === OFFICIAL_PROFILE || value.profile === GUARDS_PROFILE || value.profile === CONCURRENCY_PROFILE || value.profile === LATE_WRITE_PROFILE || CLOSED_PROFILES.some(selection => selection.profile === value.profile));
  assert.equal(value.profileDigest, profileDigest(value.profile));
  assert(Array.isArray(value.modules) && value.modules.length > 0 && value.modules.length <= 128);
  for (const entry of value.modules) {
    exactKeys(entry, ['path', 'sourceDigest']);
    assert.match(entry.path, /^integration\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:live-integration-case|integration-case)\.ts$/u);
    assert.match(entry.sourceDigest, /^[0-9a-f]{64}$/u);
  }
  unique(value.modules.map(module => module.path));
  if (value.profile === LIVE_PROFILE || value.profile === JOURNEY_PROFILE) assert.equal(value.modules[0].sourceDigest, selectedDigest(value.profile));
  if (value.profile === 'full') assert(value.modules.every(module => !module.path.endsWith('.live-integration-case.ts')));
  if (value.profile !== 'full') assert.deepEqual(value.modules.map(module => module.path), [selectedModule(value.profile)]);
  return value;
}
export async function createQualificationContext(siteRoot: string, gitSha: string, runId: string,
  profile: QualificationProfile = 'full'): Promise<QualificationContext> {
  const modules: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(join(siteRoot, directory), { withFileTypes: true })) {
      const path = directory + '/' + entry.name;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith('.integration-case.ts')) modules.push(path);
    }
  };
  if (profile === 'full') await walk('integration'); else { selectedCase(profile); modules.push(selectedModule(profile)); }
  const context = validateContext({ kind: 'integration-qualification-context-v1', gitSha, runId, nonce: randomUUID(), profile,
    profileDigest: profileDigest(profile), modules: await Promise.all(modules.sort().map(async path => ({
      path, sourceDigest: qualificationSourceDigest(await readFile(join(siteRoot, path), 'utf8')),
    }))) });
  if (profile !== 'full') assert.equal(context.modules[0].sourceDigest, selectedDigest(profile),
    'Selected qualification source differs from the reviewed LF digest.');
  return context;
}
/** Missing context preserves standalone use. Supplied but partial context fails before DB preparation. */
export function qualificationBinding(environment: Record<string, string | undefined> = process.env): QualificationBinding | undefined {
  const raw = environment[QUALIFICATION_CONTEXT_ENV];
  if (raw === undefined) return undefined;
  assert(raw.length > 0 && Buffer.byteLength(raw) <= 24_000, 'Malformed qualification context.');
  const directory = environment[ARTIFACT_ENV];
  assert(directory && isAbsolute(directory), 'Qualification artifact directory must be absolute.');
  return { context: validateContext(JSON.parse(raw)), directory };
}
export function qualificationRelativePath(root: string, path: string): string {
  return relative(root, path).replace(/\\/gu, '/');
}
async function readBounded(directory: string, filename: string): Promise<string> {
  const path = join(directory, filename);
  const stat = await lstat(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= QUALIFICATION_MAX_BYTES,
    'Qualification artifact must be a bounded regular file.');
  const data = await readFile(path, 'utf8');
  assert(Buffer.byteLength(data) <= QUALIFICATION_MAX_BYTES);
  return data;
}
export async function writeQualificationArtifact(binding: QualificationBinding,
  kind: keyof typeof QUALIFICATION_FILES, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value) + '\n';
  assert(Buffer.byteLength(serialized) <= QUALIFICATION_MAX_BYTES);
  await writeFile(join(binding.directory, QUALIFICATION_FILES[kind]), serialized, { flag: 'wx', mode: 0o600 });
}
export async function markQualificationFailure(binding: QualificationBinding | undefined,
  reason: 'process-timeout' | 'reporter-failure' | 'cleanup-failure'): Promise<void> {
  // Vitest can ignore close errors. Fail before any I/O, including failed marker writes.
  process.exitCode = 1;
  if (!binding) return;
  try { await writeQualificationArtifact(binding, 'failure', {
    kind: 'integration-qualification-failure-v1', contextDigest: qualificationDigest(binding.context), reason,
  }); } catch { /* An existing failure or unavailable storage remains failed. Never erase a prior marker. */ }
}
export async function qualificationCleanup(cleanup: () => Promise<void>, binding?: QualificationBinding): Promise<void> {
  try {
    await cleanup();
    if (binding) {
      const report = await readBounded(binding.directory, QUALIFICATION_FILES.report);
      const parsed = JSON.parse(report) as QualificationReport;
      assert.equal(parsed.contextDigest, qualificationDigest(binding.context));
      await writeQualificationArtifact(binding, 'cleanup', { kind: 'integration-qualification-cleanup-v1',
        contextDigest: qualificationDigest(binding.context), reportDigest: qualificationSourceDigest(report),
        globalDatabaseCleanup: 'complete' });
    }
  } catch (error) { await markQualificationFailure(binding, 'cleanup-failure'); throw error; }
}
function unique(values: string[]): void { assert.equal(new Set(values).size, values.length, 'Duplicate qualification inventory.'); }
function sameInventory(actual: string[], expected: string[]): void { unique(actual); assert.deepEqual([...actual].sort(), [...expected].sort()); }
function zero(value: unknown): void { assert.equal(value, 0); }
export function validateQualificationReport(context: QualificationContext, report: QualificationReport): void {
  validateContext(context);
  exactKeys(report, ['kind', 'contextDigest', 'starts', 'ends', 'reason', 'unhandledErrors', 'specifications', 'collected', 'hooks', 'modules']);
  assert.equal(report.kind, 'integration-qualification-report-v1');
  assert.equal(report.contextDigest, qualificationDigest(context));
  assert.equal(report.starts, 1); assert.equal(report.ends, 1); assert.equal(report.reason, 'passed'); zero(report.unhandledErrors);
  const paths = context.modules.map(module => module.path);
  sameInventory(report.specifications.map(spec => spec.path), paths);
  sameInventory(report.collected, paths); sameInventory(report.modules.map(module => module.path), paths);
  for (const spec of report.specifications) {
    exactKeys(spec, ['path', 'pattern', 'otherFilters']);
    assert.equal(spec.otherFilters, false);
    assert.equal(spec.pattern, context.profile === 'full' ? null : selectedCase(context.profile).pattern);
  }
  unique(report.hooks.map(hook => hook.key));
  for (const hook of report.hooks) {
    exactKeys(hook, ['key', 'starts', 'ends']);
    assert(Number.isSafeInteger(hook.starts) && hook.starts > 0);
    assert.equal(hook.starts, hook.ends);
  }
  const ids: string[] = [];
  for (const entry of report.modules) {
    exactKeys(entry, ['path', 'state', 'errors', 'suites', 'cases']);
    assert.equal(entry.state, 'passed'); zero(entry.errors); assert(entry.cases.length > 0);
    for (const suite of entry.suites) {
      exactKeys(suite, ['id', 'name', 'mode', 'errors']);
      ids.push(suite.id); zero(suite.errors);
      assert(suite.mode === 'run' || (context.profile !== 'full' && suite.mode === 'skip'));
    }
    unique(entry.cases.map(test => test.name));
    if (context.profile !== 'full') sameInventory(entry.cases.map(test => test.name), selectedInventory(context.profile));
    const sharedSuite = context.profile === CONCURRENCY_PROFILE
      ? { names: CONCURRENCY_FULL_NAMES, suite: SELECTED_SUITE, label: 'Refresh concurrency' }
      : context.profile === LATE_WRITE_PROFILE
        ? { names: LATE_WRITE_FULL_NAMES, suite: LATE_WRITE_SUITE, label: 'Late-write rollback' } : undefined;
    if (sharedSuite) {
      assert.deepEqual(entry.cases.filter(test => sharedSuite.names.includes(test.name)).map(test => test.name),
        sharedSuite.names, sharedSuite.label + ' cases must retain their source order.');
      const suites = entry.suites.filter(suite => suite.name === sharedSuite.suite);
      assert.equal(suites.length, 1, sharedSuite.label + ' requires its one shared suite.');
      assert.equal(suites[0].mode, 'run');
      const expectedHooks = ['beforeAll', 'afterAll'].map(name => suites[0].id + ':' + name);
      sameInventory(report.hooks.map(hook => hook.key), expectedHooks);
      for (const hook of report.hooks) assert.equal(hook.starts, 1, sharedSuite.label + ' hooks must execute exactly once.');
    }
    const closeout = CLOSED_PROFILES.find(selection => selection.profile === context.profile);
    if (closeout) {
      const selected = entry.cases.filter(test => closeout.names.includes(test.name));
      assert.deepEqual(selected.map(test => test.name), closeout.names, 'Closed cases must retain their source order.');
      const runningSuites = entry.suites.filter(suite => suite.mode === 'run');
      sameInventory(runningSuites.map(suite => suite.name), [...closeout.suites]);
      for (const name of closeout.suites) assert.equal(entry.suites.filter(suite => suite.name === name).length, 1,
        'Closed qualification requires each selected suite exactly once.');
      const expectedHooks = runningSuites.flatMap(suite => ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      sameInventory(report.hooks.map(hook => hook.key), expectedHooks);
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Closed qualification hooks must execute exactly once.');
      // allTests() reports declaration order; diagnostic start times independently
      // reject reordered execution without changing the reporter or runner.
      for (let index = 1; index < selected.length; index++) {
        const previous = selected[index - 1].diagnostic, current = selected[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Closed cases must execute in chronological source order.');
      }
    }
    if (context.profile === GUARDS_PROFILE) assert.deepEqual(entry.cases.filter(test => GUARDS_FULL_NAMES.includes(test.name))
      .map(test => test.name), GUARDS_FULL_NAMES, 'Ingestion guards must retain their source order.');
    for (const test of entry.cases) {
      exactKeys(test, ['id', 'name', 'state', 'mode', 'expectedFailure', 'configuredRetries', 'configuredRepeats',
        'errors', 'readyEvents', 'resultEvents', 'diagnostic']);
      ids.push(test.id); assert(typeof test.id === 'string' && test.id.length > 0);
      assert.equal(test.expectedFailure, false); zero(test.errors);
      assert.equal(test.configuredRetries, false); zero(test.configuredRepeats);
      const selected = context.profile === 'full' || selectedCase(context.profile).names.includes(test.name);
      if (selected) {
        assert.equal(test.state, 'passed'); assert.equal(test.mode, 'run');
        assert.equal(test.readyEvents, 1); assert.equal(test.resultEvents, 1);
        assert(test.diagnostic);
        exactKeys(test.diagnostic, ['retryCount', 'repeatCount', 'flaky', 'duration', 'startTime']);
        zero(test.diagnostic.retryCount); zero(test.diagnostic.repeatCount);
        assert.equal(test.diagnostic.flaky, false);
        assert(Number.isFinite(test.diagnostic.duration) && test.diagnostic.duration >= 0);
        assert(Number.isFinite(test.diagnostic.startTime) && test.diagnostic.startTime > 0);
      } else {
        assert.equal(test.state, 'skipped'); assert.equal(test.mode, 'skip');
        // Vitest emits ready/result for filtered cases too; no diagnostic means no execution.
        assert.equal(test.readyEvents, 1); assert.equal(test.resultEvents, 1);
        assert.equal(test.diagnostic, null);
      }
    }
  }
  unique(ids);
}
/** Only after independently verified child-tree closure; a late timeout marker always wins. */
export async function validateQualificationArtifacts(binding: QualificationBinding): Promise<{ profile: QualificationProfile; collected: number; executed: number; passed: number; skipped: number; filtered: number; reportDigest: string }> {
  try { await lstat(join(binding.directory, QUALIFICATION_FILES.failure)); throw new Error('Sticky qualification failure.'); }
  catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error; }
  const raw = await readBounded(binding.directory, QUALIFICATION_FILES.report);
  const report = JSON.parse(raw) as QualificationReport;
  validateQualificationReport(binding.context, report);
  const ack = JSON.parse(await readBounded(binding.directory, QUALIFICATION_FILES.cleanup));
  exactKeys(ack, ['kind', 'contextDigest', 'reportDigest', 'globalDatabaseCleanup']);
  assert.deepEqual(ack, { kind: 'integration-qualification-cleanup-v1', contextDigest: qualificationDigest(binding.context),
    reportDigest: qualificationSourceDigest(raw), globalDatabaseCleanup: 'complete' });
  const cases = report.modules.flatMap(module => module.cases);
  return { profile: binding.context.profile, collected: cases.length, executed: cases.filter(test => test.diagnostic !== null).length,
    passed: cases.filter(test => test.state === 'passed').length, skipped: cases.filter(test => test.state === 'skipped').length, filtered: cases.filter(test => test.state === 'skipped').length,
    reportDigest: qualificationSourceDigest(raw) };
}

/** The distinct live suffix never matches default full discovery. Only a validated bound profile opts in. */
export function qualificationIncludes(environment: Record<string, string | undefined> = process.env): string[] {
  const profile = qualificationBinding(environment)?.context.profile;
  return profile === LIVE_PROFILE ? [LIVE_MODULE] : profile === JOURNEY_PROFILE ? [JOURNEY_MODULE] : ['integration/**/*.integration-case.ts'];
}
export function requireLiveQualification(environment: Record<string, string | undefined> = process.env): QualificationBinding {
  const binding = qualificationBinding(environment);
  assert(binding?.context.profile === LIVE_PROFILE, 'Explicit bound live League Two profile required.');
  return binding;
}
export function requireJourneyQualification(environment: Record<string, string | undefined> = process.env): QualificationBinding {
  const binding = qualificationBinding(environment);
  assert(binding?.context.profile === JOURNEY_PROFILE, 'Explicit bound live public DATA intake profile required.');
  return binding;
}
