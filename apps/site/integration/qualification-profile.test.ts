import { READER_PERFORMANCE_PROFILE, READER_PERFORMANCE_MODULE, READER_PERFORMANCE_SOURCE_DIGEST,
  READER_PERFORMANCE_SUITE, READER_PERFORMANCE_TESTS, READER_PERFORMANCE_FULL_NAMES,
  READER_PERFORMANCE_PATTERN, READER_PERFORMANCE_SUPPORT_SOURCES, assertReaderPerformanceSupportSources } from './qualification-profile';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, expect, it } from 'vitest';
import { BATCH_EVIDENCE_FILE, BATCH_CASE_NAMES, BATCH_CASE_LIMITS } from './batch-calibration-evidence';
// Load the real validator and its authored source fixture once during test-module setup.
import { READER_PERFORMANCE_EVIDENCE_FILE } from './reader-performance';
import { BATCH_CALIBRATION_PROFILE, BATCH_CALIBRATION_MODULE, BATCH_CALIBRATION_SOURCE_DIGEST, BATCH_CALIBRATION_SUITE,
  BATCH_CALIBRATION_FULL_NAMES, BATCH_CALIBRATION_PATTERN, BATCH_CALIBRATION_SUPPORT_SOURCES, assertBatchCalibrationSupportSources } from './qualification-profile';
import { RUNNER_CYCLES_EVIDENCE_FILE, RUNNER_CYCLES_LIMITS, RUNNER_CYCLES_ORACLES,
  writeRunnerCyclesEvidence, type RunnerCyclesEvidence, type RunnerInvocation } from './runner-cycles-evidence';
import { createQualificationContext, markQualificationFailure, parseQualificationArguments, qualificationArguments,
  qualificationBinding, qualificationCleanup, qualificationDigest, qualificationSourceDigest, QUALIFICATION_CONTEXT_ENV,
  QUALIFICATION_FILES, INGESTION_PROFILE, INGESTION_FULL_NAME, INGESTION_PATTERN, SELECTED_SOURCE_DIGEST, SELECTED_FULL_NAME, SELECTED_INVENTORY, SELECTED_MODULE, SELECTED_PATTERN, SELECTED_PROFILE,
  validateQualificationArtifacts, validateQualificationReport, writeQualificationArtifact, assertBatchCalibrationCaseOrder,
  LIVE_PROFILE, LIVE_MODULE, LIVE_FULL_NAME, LIVE_PATTERN, LIVE_SOURCE_DIGEST, qualificationIncludes, requireLiveQualification,
  JOURNEY_PROFILE, JOURNEY_MODULE, JOURNEY_FULL_NAME, JOURNEY_PATTERN, JOURNEY_SOURCE_DIGEST, requireJourneyQualification,
  OFFICIAL_PROFILE, OFFICIAL_FULL_NAMES, OFFICIAL_PATTERN, GUARDS_PROFILE, GUARDS_FULL_NAMES, GUARDS_PATTERN,
  CONCURRENCY_PROFILE, CONCURRENCY_FULL_NAMES, CONCURRENCY_PATTERN, SELECTED_SUITE,
  LATE_WRITE_PROFILE, LATE_WRITE_FULL_NAMES, LATE_WRITE_PATTERN, LATE_WRITE_SUITE,
  CLOSEOUT_PROFILES, INTAKE_RECOVERY_PROFILE, REFRESH_HISTORY_PROFILE, PERIOD_RECOVERY_PROFILE, PERIOD_EXHAUSTION_PROFILE,
  CORE_COMPATIBILITY_PROFILE, CORE_COMPATIBILITY_MODULES, CORE_COMPATIBILITY_FULL_NAMES, CORE_COMPATIBILITY_PATTERN,
  OFFICIAL_RESULTS_PROFILE, OFFICIAL_RESULTS_MODULE, OFFICIAL_RESULTS_SOURCE_DIGEST, OFFICIAL_RESULTS_SUITE,
  OFFICIAL_RESULTS_TESTS, OFFICIAL_RESULTS_FULL_NAMES, OFFICIAL_RESULTS_PATTERN,
  OFFICIAL_RESULTS_PLAYED_PROFILE, OFFICIAL_RESULTS_PLAYED_FULL_NAMES, OFFICIAL_RESULTS_PLAYED_PATTERN,
  FRESH_INSTALL_PROFILE, FRESH_INSTALL_MODULE, FRESH_INSTALL_SOURCE_DIGEST, FRESH_INSTALL_SUITE,
  FRESH_INSTALL_TESTS, FRESH_INSTALL_FULL_NAMES, FRESH_INSTALL_PATTERN,
  PROCESS_RECOVERY_PROFILE, PROCESS_RECOVERY_MODULE, PROCESS_RECOVERY_SOURCE_DIGEST, PROCESS_RECOVERY_SUITE,
  PROCESS_RECOVERY_TESTS, PROCESS_RECOVERY_FULL_NAMES, PROCESS_RECOVERY_PATTERN,
  PROCESS_RECOVERY_SUPPORT_SOURCES, assertProcessRecoverySupportSources,
  RUNNER_CYCLES_PROFILE, RUNNER_CYCLES_MODULE, RUNNER_CYCLES_SOURCE_DIGEST, RUNNER_CYCLES_SUITE,
  RUNNER_CYCLES_TESTS, RUNNER_CYCLES_FULL_NAMES, RUNNER_CYCLES_PATTERN,
  RUNNER_CYCLES_SUPPORT_SOURCES, assertRunnerCyclesSupportSources,
  COMPETING_WORKERS_PROFILE, COMPETING_WORKERS_MODULE, COMPETING_WORKERS_SOURCE_DIGEST, COMPETING_WORKERS_SUITE,
  COMPETING_WORKERS_TESTS, COMPETING_WORKERS_FULL_NAMES, COMPETING_WORKERS_PATTERN,
  COMPETING_WORKERS_SUPPORT_SOURCES, assertCompetingWorkersSupportSources,
  WITHIN_SEASON_HISTORY_PROFILE, WITHIN_SEASON_HISTORY_MODULE, WITHIN_SEASON_HISTORY_SOURCE_DIGEST, WITHIN_SEASON_HISTORY_SUITE,
  WITHIN_SEASON_HISTORY_TESTS, WITHIN_SEASON_HISTORY_FULL_NAMES, WITHIN_SEASON_HISTORY_PATTERN,
  DRAFT_INTAKE_PROFILE, DRAFT_INTAKE_MODULE, DRAFT_INTAKE_SOURCE_DIGEST, DRAFT_INTAKE_SUITE,
  DRAFT_INTAKE_TESTS, DRAFT_INTAKE_FULL_NAMES, DRAFT_INTAKE_PATTERN,
  DRAFT_REFRESH_PROFILE, DRAFT_REFRESH_MODULE, DRAFT_REFRESH_SOURCE_DIGEST, DRAFT_REFRESH_SUITE,
  DRAFT_REFRESH_TESTS, DRAFT_REFRESH_FULL_NAMES, DRAFT_REFRESH_PATTERN,
  DRAFT_INTAKE_RECOVERY_PROFILE, DRAFT_INTAKE_RECOVERY_MODULE, DRAFT_INTAKE_RECOVERY_SOURCE_DIGEST, DRAFT_INTAKE_RECOVERY_SUITE,
  DRAFT_INTAKE_RECOVERY_TESTS, DRAFT_INTAKE_RECOVERY_FULL_NAMES, DRAFT_INTAKE_RECOVERY_PATTERN,
  TRADED_PICKS_PROFILE, TRADED_PICKS_MODULE, TRADED_PICKS_SOURCE_DIGEST, TRADED_PICKS_SUITE,
  TRADED_PICKS_TESTS, TRADED_PICKS_FULL_NAMES, TRADED_PICKS_PATTERN,
  DRAFT_SELECTIONS_PROFILE, DRAFT_SELECTIONS_MODULE, DRAFT_SELECTIONS_SOURCE_DIGEST, DRAFT_SELECTIONS_SUITE,
  DRAFT_SELECTIONS_TESTS, DRAFT_SELECTIONS_FULL_NAMES, DRAFT_SELECTIONS_PATTERN,
  DRAFT_METADATA_PROFILE, DRAFT_METADATA_MODULE, DRAFT_METADATA_SOURCE_DIGEST, DRAFT_METADATA_SUITE,
  DRAFT_METADATA_TESTS, DRAFT_METADATA_FULL_NAMES, DRAFT_METADATA_PATTERN,
  TRANSACTION_HISTORY_INTAKE_PROFILE, TRANSACTION_HISTORY_INTAKE_MODULE, TRANSACTION_HISTORY_INTAKE_SOURCE_DIGEST,
  TRANSACTION_HISTORY_INTAKE_SUITE, TRANSACTION_HISTORY_INTAKE_TESTS, TRANSACTION_HISTORY_INTAKE_FULL_NAMES, TRANSACTION_HISTORY_INTAKE_PATTERN,
  TRANSACTION_HISTORY_REFRESH_PROFILE, TRANSACTION_HISTORY_REFRESH_MODULE, TRANSACTION_HISTORY_REFRESH_SOURCE_DIGEST,
  TRANSACTION_HISTORY_REFRESH_SUITE, TRANSACTION_HISTORY_REFRESH_TESTS, TRANSACTION_HISTORY_REFRESH_FULL_NAMES, TRANSACTION_HISTORY_REFRESH_PATTERN,
  TRANSACTION_HISTORY_RECOVERY_PROFILE, TRANSACTION_HISTORY_RECOVERY_MODULE, TRANSACTION_HISTORY_RECOVERY_SOURCE_DIGEST,
  TRANSACTION_HISTORY_RECOVERY_SUITE, TRANSACTION_HISTORY_RECOVERY_TESTS, TRANSACTION_HISTORY_RECOVERY_FULL_NAMES, TRANSACTION_HISTORY_RECOVERY_PATTERN,
  TRANSACTION_PERIOD_INTAKE_PROFILE, TRANSACTION_PERIOD_INTAKE_MODULE, TRANSACTION_PERIOD_INTAKE_SOURCE_DIGEST,
  TRANSACTION_PERIOD_INTAKE_SUITE, TRANSACTION_PERIOD_INTAKE_TESTS, TRANSACTION_PERIOD_INTAKE_FULL_NAMES, TRANSACTION_PERIOD_INTAKE_PATTERN,
  WEEKLY_REPORTS_PROFILE, WEEKLY_REPORTS_MODULE, WEEKLY_REPORTS_SOURCE_DIGEST, WEEKLY_REPORTS_SUITE,
  WEEKLY_REPORTS_TESTS, WEEKLY_REPORTS_FULL_NAMES, WEEKLY_REPORTS_PATTERN,
  OFFICIAL_RESULTS_EVIDENCE_PROFILE, OFFICIAL_RESULTS_EVIDENCE_MODULE, OFFICIAL_RESULTS_EVIDENCE_SOURCE_DIGEST,
  OFFICIAL_RESULTS_EVIDENCE_SUITE, OFFICIAL_RESULTS_EVIDENCE_TESTS, OFFICIAL_RESULTS_EVIDENCE_FULL_NAMES,
  OFFICIAL_RESULTS_EVIDENCE_PATTERN,
  BRACKET_INTAKE_PROFILE, BRACKET_INTAKE_MODULE, BRACKET_INTAKE_SOURCE_DIGEST, BRACKET_INTAKE_SUITE,
  BRACKET_INTAKE_TESTS, BRACKET_INTAKE_FULL_NAMES, BRACKET_INTAKE_PATTERN,
  TYPED_BRACKETS_PROFILE, TYPED_BRACKETS_MODULE, TYPED_BRACKETS_SOURCE_DIGEST, TYPED_BRACKETS_SUITE,
  TYPED_BRACKETS_TESTS, TYPED_BRACKETS_FULL_NAMES, TYPED_BRACKETS_PATTERN,
  EXACT_MATCHUP_VALUES_PROFILE, EXACT_MATCHUP_VALUES_MODULE, EXACT_MATCHUP_VALUES_SOURCE_DIGEST, EXACT_MATCHUP_VALUES_SUITE,
  EXACT_MATCHUP_VALUES_TESTS, EXACT_MATCHUP_VALUES_FULL_NAMES, EXACT_MATCHUP_VALUES_PATTERN,
  PERIOD_SETTINGS_CONTEXT_PROFILE, PERIOD_SETTINGS_CONTEXT_MODULE, PERIOD_SETTINGS_CONTEXT_SOURCE_DIGEST, PERIOD_SETTINGS_CONTEXT_SUITE,
  PERIOD_SETTINGS_CONTEXT_TESTS, PERIOD_SETTINGS_CONTEXT_FULL_NAMES, PERIOD_SETTINGS_CONTEXT_PATTERN,
  PERIOD_INVENTORY_PROFILE, PERIOD_INVENTORY_MODULE, PERIOD_INVENTORY_SOURCE_DIGEST, PERIOD_INVENTORY_SUITE,
  PERIOD_INVENTORY_TESTS, PERIOD_INVENTORY_FULL_NAMES, PERIOD_INVENTORY_PATTERN,
  TEAM_MANAGER_FACTS_PROFILE, TEAM_MANAGER_FACTS_MODULE, TEAM_MANAGER_FACTS_SOURCE_DIGEST, TEAM_MANAGER_FACTS_SUITE,
  TEAM_MANAGER_FACTS_TESTS, TEAM_MANAGER_FACTS_FULL_NAMES, TEAM_MANAGER_FACTS_PATTERN,
  ROSTER_PLAYER_LINKS_PROFILE, ROSTER_PLAYER_LINKS_MODULE, ROSTER_PLAYER_LINKS_SOURCE_DIGEST, ROSTER_PLAYER_LINKS_SUITE,
  ROSTER_PLAYER_LINKS_TESTS, ROSTER_PLAYER_LINKS_FULL_NAMES, ROSTER_PLAYER_LINKS_PATTERN,
  PLAYER_DIRECTORY_PROFILE, PLAYER_DIRECTORY_MODULE, PLAYER_DIRECTORY_SOURCE_DIGEST, PLAYER_DIRECTORY_SUITE,
  PLAYER_DIRECTORY_TESTS, PLAYER_DIRECTORY_FULL_NAMES, PLAYER_DIRECTORY_PATTERN,
  LIVE_PLAYER_DIRECTORY_PROFILE, LIVE_PLAYER_DIRECTORY_MODULE, LIVE_PLAYER_DIRECTORY_SOURCE_DIGEST, LIVE_PLAYER_DIRECTORY_SUITE,
  LIVE_PLAYER_DIRECTORY_TEST, LIVE_PLAYER_DIRECTORY_FULL_NAME, LIVE_PLAYER_DIRECTORY_PATTERN, requireLivePlayerDirectoryQualification,
  type QualificationBinding, type QualificationCase, type QualificationReport } from './qualification-profile';

import { BACKEND_CONTROLS_PROFILE, BACKEND_CONTROLS_MODULE, BACKEND_CONTROLS_SOURCE_DIGEST,
  BACKEND_CONTROLS_SUITE, BACKEND_CONTROLS_TESTS, BACKEND_CONTROLS_FULL_NAMES, BACKEND_CONTROLS_PATTERN,
  BACKEND_CONTROLS_SUPPORT_SOURCES, assertBackendControlsSupportSources, QUALIFICATION_MAX_BYTES } from './qualification-profile';
import { BACKEND_CONTROLS_EVIDENCE_FILE, BACKEND_CONTROLS_LIMITS, BACKEND_CONTROLS_ORACLES,
  writeBackendControlsEvidence, type ControlsEvidence } from './backend-controls-evidence';

const directories: string[] = [];
const exitCode = process.exitCode;
// Source-only historical fixtures; current shared-harness drift must still fail.
let frozenHarness: Promise<string> | undefined;
function historicalHarnessSource() {
  return frozenHarness ??= promisify(execFile)('git', ['show', 'b8abdb576d2f10cafd238908d201d9ee5a462f00:apps/site/integration/neon-integration-harness.ts'],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }).then(result => {
    expect(qualificationSourceDigest(result.stdout)).toBe('a4f2f15362da075160f0a187c4da35ee72902c37ebcf49de1842a92f50942783'); return result.stdout;
  });
}

afterEach(async () => { process.exitCode = exitCode; await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(selected: boolean | typeof INGESTION_PROFILE | typeof OFFICIAL_PROFILE | typeof GUARDS_PROFILE | typeof CONCURRENCY_PROFILE | typeof LATE_WRITE_PROFILE | typeof CLOSEOUT_PROFILES[number]['profile'] = false): Promise<QualificationBinding> {
  const directory = await mkdtemp(join(tmpdir(), 'qualification-profile-')); directories.push(directory);
  await mkdir(join(directory, 'integration'));
  await writeFile(join(directory, SELECTED_MODULE), 'fixture\r\nsource\r\n');
  const context = await createQualificationContext(selected ? fileURLToPath(new URL('..', import.meta.url)) : directory,
    'a'.repeat(40), randomUUID(), typeof selected === 'string' ? selected : selected ? SELECTED_PROFILE : 'full');
  // Synthetic fixture context only; production creation verifies the pinned source digest.
  context.modules[0].sourceDigest = qualificationSourceDigest('fixture\nsource\n');
  return { directory, context };
}
function report(binding: QualificationBinding): QualificationReport {
  const closeout = CLOSEOUT_PROFILES.find(selection => selection.profile === binding.context.profile);
  if (closeout) {
    const suites = [...new Set(SELECTED_INVENTORY.map(name => name.split(' > ')[0]))].map((name, index) => ({
      id: 'suite-' + index, name, mode: (closeout.suites as readonly string[]).includes(name) ? 'run' : 'skip', errors: 0,
    }));
    const inventory = [...closeout.names, ...SELECTED_INVENTORY.filter(name => !closeout.names.includes(name))];
    return { kind: 'integration-qualification-report-v1', contextDigest: qualificationDigest(binding.context), starts: 1, ends: 1,
      reason: 'passed', unhandledErrors: 0, specifications: [{ path: SELECTED_MODULE, pattern: closeout.pattern, otherFilters: false }],
      collected: [SELECTED_MODULE], hooks: suites.filter(suite => suite.mode === 'run').flatMap(suite => ['beforeAll', 'afterAll']
        .map(name => ({ key: suite.id + ':' + name, starts: 1, ends: 1 }))),
      modules: [{ path: SELECTED_MODULE, state: 'passed', errors: 0, suites,
        cases: inventory.map((name, index) => {
          const selected = closeout.names.includes(name);
          return { id: 'case-' + index, name, state: selected ? 'passed' : 'skipped', mode: selected ? 'run' : 'skip',
            expectedFailure: false, configuredRetries: false, configuredRepeats: 0, errors: 0, readyEvents: 1, resultEvents: 1,
            diagnostic: selected ? { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } : null };
        }) }] };
  }
  const selected = binding.context.profile !== 'full';
  const ingestion = binding.context.profile === INGESTION_PROFILE;
  const official = binding.context.profile === OFFICIAL_PROFILE;
  const guards = binding.context.profile === GUARDS_PROFILE;
  const concurrency = binding.context.profile === CONCURRENCY_PROFILE;
  const lateWrite = binding.context.profile === LATE_WRITE_PROFILE;
  const sharedSuite = concurrency || lateWrite;
  const orderedNames = lateWrite ? LATE_WRITE_FULL_NAMES : CONCURRENCY_FULL_NAMES;
  const inventory = sharedSuite ? [...orderedNames, ...SELECTED_INVENTORY.filter(name => !orderedNames.includes(name))] : guards ? [...GUARDS_FULL_NAMES, ...SELECTED_INVENTORY.filter(name => !GUARDS_FULL_NAMES.includes(name))] : SELECTED_INVENTORY;
  return { kind: 'integration-qualification-report-v1', contextDigest: qualificationDigest(binding.context), starts: 1, ends: 1,
    reason: 'passed', unhandledErrors: 0, specifications: [{ path: SELECTED_MODULE, pattern: selected ? lateWrite ? LATE_WRITE_PATTERN : concurrency ? CONCURRENCY_PATTERN : guards ? GUARDS_PATTERN : official ? OFFICIAL_PATTERN : ingestion ? INGESTION_PATTERN : SELECTED_PATTERN : null,
      otherFilters: false }], collected: [SELECTED_MODULE], hooks: sharedSuite ? ['beforeAll', 'afterAll'].map(name => ({ key: 'suite:' + name, starts: 1, ends: 1 })) : [{ key: 'suite:beforeAll', starts: 1, ends: 1 }],
    modules: [{ path: SELECTED_MODULE, state: 'passed', errors: 0, suites: sharedSuite ? [{ id: 'suite', name: lateWrite ? LATE_WRITE_SUITE : SELECTED_SUITE, mode: 'run', errors: 0 }] : [],
      cases: (selected ? inventory : ['fixture']).map((name, index) => {
        const runs = !selected || (sharedSuite ? orderedNames.includes(name) : guards ? GUARDS_FULL_NAMES.includes(name) : official ? OFFICIAL_FULL_NAMES.includes(name) : name === (ingestion ? INGESTION_FULL_NAME : SELECTED_FULL_NAME));
        return { id: 'case-' + index, name, state: runs ? 'passed' : 'skipped', mode: runs ? 'run' : 'skip',
          expectedFailure: false, configuredRetries: false, configuredRepeats: 0, errors: 0,
          readyEvents: 1, resultEvents: 1, diagnostic: runs ? {
            retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 } : null };
      }) }] };
}
it('keeps default selection and accepts only fixed CLI selectors', () => {
  expect(parseQualificationArguments([])).toBe('full');
  expect(parseQualificationArguments(['--profile=' + SELECTED_PROFILE])).toBe(SELECTED_PROFILE);
  expect(qualificationArguments('full', '/reporter')).toEqual(['--reporter', 'verbose', '--reporter', '/reporter']);
  expect(qualificationArguments(SELECTED_PROFILE, '/reporter').slice(4)).toEqual([SELECTED_MODULE, '--testNamePattern', SELECTED_PATTERN]);
  for (const args of [['--profile=full'], ['--config=other'], ['--testNamePattern=x'], ['--profile=' + SELECTED_PROFILE, '--retry=1']]) {
    expect(() => parseQualificationArguments(args)).toThrow();
  }
});
it('binds full SHA, generated nonce and LF source digest, rejecting partial contexts', async () => {
  const binding = await fixture();
  expect(binding.context.modules[0].sourceDigest).toBe(qualificationSourceDigest('fixture\nsource\n'));
  expect(qualificationBinding({})).toBeUndefined();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context),
    PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationBinding(env)).toEqual(binding);
  for (const raw of ['', '{}', '{', JSON.stringify({ ...binding.context, gitSha: 'short' })]) {
    expect(() => qualificationBinding({ ...env, [QUALIFICATION_CONTEXT_ENV]: raw })).toThrow();
  }
  expect(() => qualificationBinding({ [QUALIFICATION_CONTEXT_ENV]: env[QUALIFICATION_CONTEXT_ENV] })).toThrow();
});
it('requires an exclusive post-cleanup acknowledgment bound to this report and invocation', async () => {
  const binding = await fixture(true), evidence = report(binding);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  const deferred = Promise.withResolvers<void>();
  const completing = qualificationCleanup(() => deferred.promise, binding);
  await expect(readFile(join(binding.directory, QUALIFICATION_FILES.cleanup))).rejects.toThrow();
  deferred.resolve(); await completing;
  expect(await validateQualificationArtifacts(binding)).toMatchObject({ profile: SELECTED_PROFILE, collected: 25, executed: 1, passed: 1, filtered: 24 });
  await expect(writeQualificationArtifact(binding, 'report', evidence)).rejects.toThrow();
  await expect(validateQualificationArtifacts({ ...binding, context: { ...binding.context, nonce: randomUUID() } })).rejects.toThrow();
  await markQualificationFailure(binding, 'process-timeout');
  expect(process.exitCode).toBe(1);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});
it('never acknowledges failed cleanup, including standalone use and unavailable marker storage', async () => {
  const binding = await fixture();
  await expect(qualificationCleanup(async () => { throw Error('cleanup'); }, binding)).rejects.toThrow('cleanup');
  expect(process.exitCode).toBe(1);
  await expect(readFile(join(binding.directory, QUALIFICATION_FILES.cleanup))).rejects.toThrow();
  process.exitCode = undefined;
  await expect(qualificationCleanup(async () => { throw Error('standalone'); })).rejects.toThrow('standalone');
  expect(process.exitCode).toBe(1);
  process.exitCode = undefined;
  await markQualificationFailure({ ...binding, directory: join(binding.directory, 'missing') }, 'process-timeout');
  expect(process.exitCode).toBe(1);
});
it('rejects adverse structured results without trusting a successful runner reason alone', async () => {
  const binding = await fixture(true);
  const changes: ((r: QualificationReport) => void)[] = [
    r => { r.reason = 'interrupted'; }, r => { r.unhandledErrors = 1; }, r => { r.ends = 2; },
    r => { r.collected.push(SELECTED_MODULE); }, r => { r.modules[0].cases.pop(); },
    r => { r.modules[0].cases.push({ ...r.modules[0].cases[0] }); },
    r => { r.modules[0].cases[0].name = 'unexpected'; }, r => { r.modules[0].errors = 1; },
    r => { r.hooks[0].ends = 0; }, r => { r.specifications[0].otherFilters = true; },
    ...['skipped', 'pending', 'failed'].map(state => (r: QualificationReport) => { r.modules[0].cases.find(c => c.name === SELECTED_FULL_NAME)!.state = state; }),
    ...[(c: QualificationReport['modules'][0]['cases'][0]) => { c.expectedFailure = true; },
      (c: QualificationCase) => { c.mode = 'only'; }, (c: QualificationCase) => { c.configuredRepeats = 1; }, (c: QualificationCase) => { c.configuredRetries = true; },
      (c: QualificationCase) => { c.errors = 1; }, (c: QualificationCase) => { c.readyEvents = 2; }, (c: QualificationCase) => { c.resultEvents = 0; },
      (c: QualificationCase) => { c.diagnostic!.retryCount = 1; }, (c: QualificationCase) => { c.diagnostic!.repeatCount = 1; },
      (c: QualificationCase) => { c.diagnostic!.flaky = true; }].map(change => (r: QualificationReport) => change(r.modules[0].cases.find(c => c.name === SELECTED_FULL_NAME)!)),
  ];
  for (const change of changes) { const evidence = report(binding); change(evidence); expect(() => validateQualificationReport(binding.context, evidence)).toThrow(); }
});
it('rejects malformed, truncated and changed acknowledgment bytes', async () => {
  const binding = await fixture();
  await writeQualificationArtifact(binding, 'report', report(binding));
  await qualificationCleanup(async () => {}, binding);
  await writeFile(join(binding.directory, QUALIFICATION_FILES.cleanup), '{}');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeFile(join(binding.directory, QUALIFICATION_FILES.report), '{"kind":');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
});

it('pins the reviewed LF module digest and independently inventories all literal/parameterized cases without importing SQL', async () => {
  const path = fileURLToPath(new URL('./public-data-intake.integration-case.ts', import.meta.url));
  const source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(SELECTED_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const cases: string[] = [];
  const visit = (node: ts.Node, suites: string[]) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && expression.text === 'describe' && ts.isStringLiteral(node.arguments[0])) {
        const suite = [...suites, node.arguments[0].text];
        ts.forEachChild(node.arguments[1], child => visit(child, suite)); return;
      }
      const direct = ts.isIdentifier(expression) && expression.text === 'it';
      const each = ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)
        && expression.expression.expression.getText(tree) === 'it' && expression.expression.name.text === 'each';
      if ((direct || each) && ts.isStringLiteral(node.arguments[0])) {
        const template = node.arguments[0].text;
        const argument = each && ts.isCallExpression(expression) ? expression.arguments[0] : undefined;
        const valuesNode = argument && ts.isAsExpression(argument) ? argument.expression : argument;
        const values = valuesNode && ts.isArrayLiteralExpression(valuesNode)
          ? valuesNode.elements.map(value => { expect(ts.isStringLiteral(value)).toBe(true); return (value as ts.StringLiteral).text; })
          : [undefined];
        for (const value of values) cases.push([...suites, value === undefined ? template : template.replace('%s', value)].join(' > '));
        return;
      }
    }
    ts.forEachChild(node, child => visit(child, suites));
  };
  visit(tree, []);
  expect(cases.filter(name => GUARDS_FULL_NAMES.includes(name))).toEqual(GUARDS_FULL_NAMES);
  expect(cases.filter(name => CONCURRENCY_FULL_NAMES.includes(name))).toEqual(CONCURRENCY_FULL_NAMES);
  expect(cases.filter(name => LATE_WRITE_FULL_NAMES.includes(name))).toEqual(LATE_WRITE_FULL_NAMES);
  const sourceOrdinals = [[1, 2, 4, 6, 7, 22], [6, 13, 14, 15, 16, 17, 18], [23], [24]];
  for (const [index, selection] of CLOSEOUT_PROFILES.entries()) {
    expect(cases.filter(name => selection.names.includes(name))).toEqual(selection.names);
    expect(sourceOrdinals[index].map(ordinal => cases[ordinal])).toEqual(selection.names);
  }
  expect(cases.sort()).toEqual(SELECTED_INVENTORY);
});

it('accepts the unchanged full selection only when every collected case passed and cleanup was acknowledged', async () => {
  const binding = await fixture();
  await writeQualificationArtifact(binding, 'report', report(binding));
  await qualificationCleanup(async () => {}, binding);
  expect(await validateQualificationArtifacts(binding)).toMatchObject({
    profile: 'full', collected: 1, executed: 1, passed: 1, skipped: 0, filtered: 0,
  });
});

it('keeps the ordinary selector closed and refuses cross-profile case evidence', async () => {
  expect(parseQualificationArguments(['--profile=' + INGESTION_PROFILE])).toBe(INGESTION_PROFILE);
  expect(qualificationArguments(INGESTION_PROFILE, '/reporter').slice(4)).toEqual([SELECTED_MODULE, '--testNamePattern', INGESTION_PATTERN]);
  expect(() => parseQualificationArguments(['--profile=' + INGESTION_PROFILE, '--retry=1'])).toThrow();
  const ordinary = await fixture(INGESTION_PROFILE), refresh = await fixture(true);
  expect(ordinary.context.profileDigest).not.toBe(refresh.context.profileDigest);
  const evidence = report(ordinary);
  expect(() => validateQualificationReport(ordinary.context, evidence)).not.toThrow();
  expect(() => validateQualificationReport(refresh.context, evidence)).toThrow();
  evidence.contextDigest = qualificationDigest(refresh.context);
  expect(() => validateQualificationReport(refresh.context, evidence)).toThrow();
});
it('binds the official pair to exactly two cases, one module and the complete reviewed inventory', async () => {
  expect(parseQualificationArguments(['--profile=' + OFFICIAL_PROFILE])).toBe(OFFICIAL_PROFILE);
  expect(qualificationArguments(OFFICIAL_PROFILE, '/reporter').slice(4)).toEqual([SELECTED_MODULE, '--testNamePattern', OFFICIAL_PATTERN]);
  for (const extra of ['--retry=1', '--testNamePattern=x', '--profile=' + INGESTION_PROFILE]) {
    expect(() => parseQualificationArguments(['--profile=' + OFFICIAL_PROFILE, extra])).toThrow();
  }
  const pattern = new RegExp(OFFICIAL_PATTERN);
  expect(pattern.source).toBe(OFFICIAL_PATTERN);
  expect(SELECTED_INVENTORY.filter(name => pattern.test(name.replaceAll(' > ', ' ')))).toEqual([...OFFICIAL_FULL_NAMES].sort());
  for (const name of OFFICIAL_FULL_NAMES) {
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  const binding = await fixture(OFFICIAL_PROFILE), evidence = report(binding);
  await writeQualificationArtifact(binding, 'report', evidence);
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({
    profile: OFFICIAL_PROFILE, collected: 25, executed: 2, passed: 2, skipped: 23, filtered: 23,
  });
  for (const older of [await fixture(true), await fixture(INGESTION_PROFILE)]) {
    expect(binding.context.profileDigest).not.toBe(older.context.profileDigest);
    const substituted = report(older); substituted.contextDigest = qualificationDigest(binding.context);
    substituted.specifications[0].pattern = OFFICIAL_PATTERN;
    expect(() => validateQualificationReport(binding.context, substituted)).toThrow();
    const reverse = structuredClone(evidence); reverse.contextDigest = qualificationDigest(older.context);
    reverse.specifications[0].pattern = report(older).specifications[0].pattern;
    expect(() => validateQualificationReport(older.context, reverse)).toThrow();
  }
});
it.each([
  { profile: OFFICIAL_PROFILE, names: OFFICIAL_FULL_NAMES },
  { profile: GUARDS_PROFILE, names: GUARDS_FULL_NAMES },
  { profile: CONCURRENCY_PROFILE, names: CONCURRENCY_FULL_NAMES },
  { profile: LATE_WRITE_PROFILE, names: LATE_WRITE_FULL_NAMES },
  ...CLOSEOUT_PROFILES,
] as const)('rejects missing, skipped, retried or duplicated cases and extra execution for $profile', async ({ profile, names }) => {
  const binding = await fixture(profile);
  for (const name of names) {
    const changes: ((r: QualificationReport) => void)[] = [
      r => { r.modules[0].cases = r.modules[0].cases.filter(test => test.name !== name); },
      r => { r.modules[0].cases.push({ ...r.modules[0].cases.find(test => test.name === name)! }); },
      ...[(test: QualificationCase) => { test.state = 'skipped'; test.mode = 'skip'; test.diagnostic = null; },
        (test: QualificationCase) => { test.state = 'pending'; },
        (test: QualificationCase) => { test.state = 'failed'; },
        (test: QualificationCase) => { test.expectedFailure = true; },
        (test: QualificationCase) => { test.configuredRetries = true; },
        (test: QualificationCase) => { test.configuredRepeats = 1; },
        (test: QualificationCase) => { test.diagnostic!.retryCount = 1; },
        (test: QualificationCase) => { test.diagnostic!.repeatCount = 1; },
        (test: QualificationCase) => { test.diagnostic!.flaky = true; },
        (test: QualificationCase) => { test.readyEvents = 0; },
        (test: QualificationCase) => { test.resultEvents = 2; }]
        .map(change => (r: QualificationReport) => change(r.modules[0].cases.find(test => test.name === name)!)),
    ];
    for (const change of changes) {
      const evidence = report(binding); change(evidence);
      expect(() => validateQualificationReport(binding.context, evidence)).toThrow();
    }
  }
  const extra = report(binding), filtered = extra.modules[0].cases.find(test => !names.includes(test.name))!;
  filtered.state = 'passed'; filtered.mode = 'run';
  filtered.diagnostic = { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 };
  expect(() => validateQualificationReport(binding.context, extra)).toThrow();
  for (const pattern of [SELECTED_PATTERN, INGESTION_PATTERN, '.*']) {
    const evidence = report(binding); evidence.specifications[0].pattern = pattern;
    expect(() => validateQualificationReport(binding.context, evidence)).toThrow();
  }
});
it.each([OFFICIAL_PROFILE, GUARDS_PROFILE, CONCURRENCY_PROFILE, LATE_WRITE_PROFILE, ...CLOSEOUT_PROFILES.map(selection => selection.profile)] as const)('refuses %s source drift before provisioning and keeps default full discovery unchanged', async profile => {
  const binding = await fixture();
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), profile)).rejects.toThrow('reviewed LF digest');
  const site = fileURLToPath(new URL('..', import.meta.url));
  const context = await createQualificationContext(site, 'a'.repeat(40), randomUUID(), profile);
  expect(context.modules).toEqual([{ path: SELECTED_MODULE, sourceDigest: SELECTED_SOURCE_DIGEST }]);
  expect(qualificationIncludes({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context),
    PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toEqual(['integration/**/*.integration-case.ts']);
  expect((await createQualificationContext(site, 'a'.repeat(40), randomUUID())).modules).toHaveLength(70);
});
it('excludes live source from generated full inventory and default discovery, requiring the exact bound opt-in', async () => {
  const binding = await fixture();
  for (const modulePath of [LIVE_MODULE, JOURNEY_MODULE]) await writeFile(join(binding.directory, modulePath), 'not a default integration case');
  const full = await createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID());
  expect(full.modules.map(entry => entry.path)).toEqual([SELECTED_MODULE]);
  expect(qualificationIncludes({})).toEqual(['integration/**/*.integration-case.ts']);
  expect(() => requireLiveQualification({})).toThrow();
  expect(() => requireJourneyQualification({})).toThrow();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(full), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(() => requireLiveQualification(env)).toThrow();
  expect(() => requireJourneyQualification(env)).toThrow();
  for (const [path, sourceDigest] of [[LIVE_MODULE, LIVE_SOURCE_DIGEST], [JOURNEY_MODULE, JOURNEY_SOURCE_DIGEST]]) {
    expect(qualificationIncludes(env)).not.toContain(path);
    const tampered = { ...full, modules: [{ path, sourceDigest }] };
    expect(() => qualificationIncludes({ ...env, [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(tampered) })).toThrow();
  }
});
it.each([
  { profile: LIVE_PROFILE, module: LIVE_MODULE, name: LIVE_FULL_NAME, pattern: LIVE_PATTERN, digest: LIVE_SOURCE_DIGEST,
    require: requireLiveQualification, otherGuard: requireJourneyQualification },
  { profile: JOURNEY_PROFILE, module: JOURNEY_MODULE, name: JOURNEY_FULL_NAME, pattern: JOURNEY_PATTERN, digest: JOURNEY_SOURCE_DIGEST,
    require: requireJourneyQualification, otherGuard: requireLiveQualification },
] as const)('binds $profile and rejects source drift, mixed inventory, skip/retry and cross-profile evidence', async spec => {
  const directory = await mkdtemp(join(tmpdir(), 'qualification-live-')); directories.push(directory);
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), spec.profile);
  const binding = { directory, context };
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: directory };
  expect(context.modules).toEqual([{ path: spec.module, sourceDigest: spec.digest }]);
  expect(qualificationIncludes(env)).toEqual([spec.module]); expect(spec.require(env)).toEqual(binding);
  expect(() => spec.otherGuard(env)).toThrow();
  expect(parseQualificationArguments(['--profile=' + spec.profile])).toBe(spec.profile);
  expect(() => parseQualificationArguments(['--profile=' + spec.profile, '--retry=1'])).toThrow();
  expect(qualificationArguments(spec.profile, '/reporter').slice(4)).toEqual([spec.module, '--testNamePattern', spec.pattern]);
  const evidence: QualificationReport = { kind: 'integration-qualification-report-v1', contextDigest: qualificationDigest(context), starts: 1, ends: 1,
    reason: 'passed', unhandledErrors: 0, specifications: [{ path: spec.module, pattern: spec.pattern, otherFilters: false }], collected: [spec.module], hooks: [],
    modules: [{ path: spec.module, state: 'passed', errors: 0, suites: [], cases: [{ id: 'live', name: spec.name, state: 'passed', mode: 'run',
      expectedFailure: false, configuredRetries: false, configuredRepeats: 0, errors: 0, readyEvents: 1, resultEvents: 1,
      diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1 } }] }] };
  validateQualificationReport(context, evidence);
  for (const mutate of [(r: QualificationReport) => { r.modules[0].cases[0].state = 'skipped'; },
    (r: QualificationReport) => { r.modules[0].cases[0].configuredRetries = true; },
    (r: QualificationReport) => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: INGESTION_FULL_NAME }); },
    (r: QualificationReport) => { r.modules[0].path = SELECTED_MODULE; },
    (r: QualificationReport) => { r.specifications[0].pattern = INGESTION_PATTERN; }]) {
    const changed = structuredClone(evidence); mutate(changed); expect(() => validateQualificationReport(context, changed)).toThrow();
  }
  const changed = { ...context, modules: [{ path: spec.module, sourceDigest: '0'.repeat(64) }] };
  expect(() => qualificationBinding({ ...env, [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(changed) })).toThrow();
  const otherModule = spec.profile === LIVE_PROFILE ? JOURNEY_MODULE : LIVE_MODULE;
  const mixed = { ...context, modules: [...context.modules, { path: otherModule, sourceDigest: spec.digest }] };
  expect(() => qualificationBinding({ ...env, [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(mixed) })).toThrow();
  const otherProfile = spec.profile === LIVE_PROFILE ? JOURNEY_PROFILE : LIVE_PROFILE;
  const other = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), otherProfile);
  expect(() => validateQualificationReport(other, { ...evidence, contextDigest: qualificationDigest(other) })).toThrow();
  await mkdir(join(directory, 'integration'));
  await writeFile(join(directory, spec.module), await readFile(fileURLToPath(new URL('../' + spec.module, import.meta.url)), 'utf8') + '\n// drift\n');
  await expect(createQualificationContext(directory, 'a'.repeat(40), randomUUID(), spec.profile)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => undefined, binding);
  expect(await validateQualificationArtifacts(binding)).toMatchObject({ collected: 1, executed: 1, passed: 1, filtered: 0 });
});

it('refuses the historical fixed-four live source pin under the discovery-bound journey profile', async () => {
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), JOURNEY_PROFILE);
  const directory = await mkdtemp(join(tmpdir(), 'qualification-journey-history-')); directories.push(directory);
  const priorSourceDigest = '3d51da6710c64cccba8064806e3ff47a16240deef46b72c16a228453cae5699b';
  expect(context.modules).toEqual([{ path: JOURNEY_MODULE, sourceDigest: JOURNEY_SOURCE_DIGEST }]);
  expect(JOURNEY_SOURCE_DIGEST).not.toBe(priorSourceDigest);
  const historical = { ...context, modules: [{ path: JOURNEY_MODULE, sourceDigest: priorSourceDigest }] };
  expect(() => requireJourneyQualification({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(historical),
    PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: directory })).toThrow();
});

it('binds the ingestion guards to exactly three source-ordered cases, excluding the fairness prerequisite', async () => {
  expect(parseQualificationArguments(['--profile=' + GUARDS_PROFILE])).toBe(GUARDS_PROFILE);
  expect(qualificationArguments(GUARDS_PROFILE, '/reporter').slice(4)).toEqual([SELECTED_MODULE, '--testNamePattern', GUARDS_PATTERN]);
  for (const extra of ['--retry=1', '--testNamePattern=x', '--profile=' + OFFICIAL_PROFILE, '--sequence.shuffle']) {
    expect(() => parseQualificationArguments(['--profile=' + GUARDS_PROFILE, extra])).toThrow();
  }
  const pattern = new RegExp(GUARDS_PATTERN);
  expect(pattern.source).toBe(GUARDS_PATTERN);
  expect(SELECTED_INVENTORY.filter(name => pattern.test(name.replaceAll(' > ', ' ')))).toEqual([...GUARDS_FULL_NAMES].sort());
  for (const name of GUARDS_FULL_NAMES) {
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  const fairness = SELECTED_INVENTORY.find(name => name.includes('monopolizing another verified target'))!;
  expect(fairness).toBeDefined();
  expect(pattern.test(fairness.replaceAll(' > ', ' '))).toBe(false);
  const binding = await fixture(GUARDS_PROFILE), evidence = report(binding);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({
    profile: GUARDS_PROFILE, collected: 25, executed: 3, passed: 3, skipped: 22, filtered: 22,
  });
  const reversed = report(binding); reversed.modules[0].cases.reverse();
  expect(() => validateQualificationReport(binding.context, reversed)).toThrow('source order');
  for (const older of [await fixture(true), await fixture(INGESTION_PROFILE), await fixture(OFFICIAL_PROFILE)]) {
    expect(binding.context.profileDigest).not.toBe(older.context.profileDigest);
    const substituted = report(older); substituted.contextDigest = qualificationDigest(binding.context);
    substituted.specifications[0].pattern = GUARDS_PATTERN;
    expect(() => validateQualificationReport(binding.context, substituted)).toThrow();
    const reverse = structuredClone(evidence); reverse.contextDigest = qualificationDigest(older.context);
    reverse.specifications[0].pattern = report(older).specifications[0].pattern;
    expect(() => validateQualificationReport(older.context, reverse)).toThrow();
  }
  for (const pattern of [OFFICIAL_PATTERN, '.*']) {
    const changed = report(binding); changed.specifications[0].pattern = pattern;
    expect(() => validateQualificationReport(binding.context, changed)).toThrow();
  }
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});

it('binds five source-ordered refresh concurrency cases to one exact shared hook pair', async () => {
  expect(parseQualificationArguments(['--profile=' + CONCURRENCY_PROFILE])).toBe(CONCURRENCY_PROFILE);
  expect(qualificationArguments(CONCURRENCY_PROFILE, '/reporter').slice(4)).toEqual([SELECTED_MODULE, '--testNamePattern', CONCURRENCY_PATTERN]);
  for (const extra of ['--retry=1', '--testNamePattern=x', '--profile=' + GUARDS_PROFILE, '--sequence.shuffle']) {
    expect(() => parseQualificationArguments(['--profile=' + CONCURRENCY_PROFILE, extra])).toThrow();
  }
  const pattern = new RegExp(CONCURRENCY_PATTERN);
  expect(pattern.source).toBe(CONCURRENCY_PATTERN);
  expect(SELECTED_INVENTORY.filter(name => pattern.test(name.replaceAll(' > ', ' ')))).toEqual([...CONCURRENCY_FULL_NAMES].sort());
  for (const name of CONCURRENCY_FULL_NAMES) {
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  for (const excluded of ['monopolizing another verified target', 'rejects private helpers']) {
    const name = SELECTED_INVENTORY.find(name => name.includes(excluded))!;
    expect(name).toBeDefined(); expect(pattern.test(name.replaceAll(' > ', ' '))).toBe(false);
  }
  const binding = await fixture(CONCURRENCY_PROFILE), evidence = report(binding);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({
    profile: CONCURRENCY_PROFILE, collected: 25, executed: 5, passed: 5, skipped: 20, filtered: 20,
  });
  const changes: ((r: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.reverse(); },
    r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'duplicate-suite' }); },
    r => { r.modules[0].suites[0].mode = 'skip'; },
    r => { r.hooks = []; },
    r => { r.hooks.pop(); },
    r => { r.hooks.push({ key: 'unrelated:beforeAll', starts: 1, ends: 1 }); },
    r => { r.hooks[0].key = 'unrelated:beforeAll'; },
    r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; },
    r => { r.hooks[0].ends = 0; },
  ];
  for (const change of changes) {
    const changed = report(binding); change(changed);
    expect(() => validateQualificationReport(binding.context, changed)).toThrow();
  }
  for (const older of [await fixture(true), await fixture(INGESTION_PROFILE), await fixture(OFFICIAL_PROFILE), await fixture(GUARDS_PROFILE)]) {
    expect(binding.context.profileDigest).not.toBe(older.context.profileDigest);
    const substituted = report(older); substituted.contextDigest = qualificationDigest(binding.context);
    substituted.specifications[0].pattern = CONCURRENCY_PATTERN;
    expect(() => validateQualificationReport(binding.context, substituted)).toThrow();
    const reverse = structuredClone(evidence); reverse.contextDigest = qualificationDigest(older.context);
    reverse.specifications[0].pattern = report(older).specifications[0].pattern;
    expect(() => validateQualificationReport(older.context, reverse)).toThrow();
  }
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});

it('binds three late-write rollback cases to their exact source order, shared hooks and isolated profile evidence', async () => {
  expect(parseQualificationArguments(['--profile=' + LATE_WRITE_PROFILE])).toBe(LATE_WRITE_PROFILE);
  expect(qualificationArguments(LATE_WRITE_PROFILE, '/reporter').slice(4)).toEqual([SELECTED_MODULE, '--testNamePattern', LATE_WRITE_PATTERN]);
  for (const extra of ['--retry=1', '--repeat=1', '--testNamePattern=x', '--profile=' + CONCURRENCY_PROFILE, '--sequence.shuffle']) {
    expect(() => parseQualificationArguments(['--profile=' + LATE_WRITE_PROFILE, extra])).toThrow();
  }
  expect(() => parseQualificationArguments(['--profile=data-late-write-rollback-v2'])).toThrow();
  const pattern = new RegExp(LATE_WRITE_PATTERN);
  expect(pattern.source).toBe(LATE_WRITE_PATTERN);
  expect(SELECTED_INVENTORY.filter(name => pattern.test(name.replaceAll(' > ', ' ')))).toEqual([...LATE_WRITE_FULL_NAMES].sort());
  for (const name of LATE_WRITE_FULL_NAMES) {
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  const binding = await fixture(LATE_WRITE_PROFILE), evidence = report(binding);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({
    profile: LATE_WRITE_PROFILE, collected: 25, executed: 3, passed: 3, skipped: 22, filtered: 22,
  });
  const changes: ((r: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.reverse(); },
    r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites[0].name = SELECTED_SUITE; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'duplicate-suite' }); },
    r => { r.modules[0].suites[0].mode = 'skip'; },
    r => { r.hooks = []; },
    r => { r.hooks.pop(); },
    r => { r.hooks.push({ key: 'unrelated:beforeAll', starts: 1, ends: 1 }); },
    r => { r.hooks[0].key = 'unrelated:beforeAll'; },
    r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; },
    r => { r.hooks[0].ends = 0; },
    r => { r.unhandledErrors = 1; },
    r => { r.specifications[0].otherFilters = true; },
  ];
  for (const change of changes) {
    const changed = report(binding); change(changed);
    expect(() => validateQualificationReport(binding.context, changed)).toThrow();
  }
  for (const older of [await fixture(), await fixture(true), await fixture(INGESTION_PROFILE),
    await fixture(OFFICIAL_PROFILE), await fixture(GUARDS_PROFILE), await fixture(CONCURRENCY_PROFILE)]) {
    expect(binding.context.profileDigest).not.toBe(older.context.profileDigest);
    const substituted = report(older); substituted.contextDigest = qualificationDigest(binding.context);
    substituted.specifications[0].pattern = LATE_WRITE_PATTERN;
    expect(() => validateQualificationReport(binding.context, substituted)).toThrow();
    const reverse = structuredClone(evidence); reverse.contextDigest = qualificationDigest(older.context);
    reverse.specifications[0].pattern = report(older).specifications[0].pattern;
    expect(() => validateQualificationReport(older.context, reverse)).toThrow();
  }
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});


it.each(CLOSEOUT_PROFILES)('keeps $profile closed with exact names, running suites, hooks and cleanup evidence', async selection => {
  const { profile, names, pattern, suites } = selection;
  expect(parseQualificationArguments(['--profile=' + profile])).toBe(profile);
  expect(qualificationArguments(profile, '/reporter')).toEqual(['--reporter', 'verbose', '--reporter', '/reporter',
    SELECTED_MODULE, '--testNamePattern', pattern]);
  for (const args of [
    ['--profile=' + profile.replace('-v1', '-v2')], ['--profile', profile],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + profile, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + profile, extra]),
  ]) expect(() => parseQualificationArguments(args)).toThrow('closed');
  const regexp = new RegExp(pattern);
  expect(SELECTED_INVENTORY.filter(name => regexp.test(name.replaceAll(' > ', ' ')))).toEqual([...names].sort());
  for (const name of names) {
    expect(regexp.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(regexp.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  const binding = await fixture(profile), evidence = report(binding);
  expect(evidence.modules[0].suites.filter(suite => suite.mode === 'run').map(suite => suite.name).sort()).toEqual([...suites].sort());
  expect(evidence.hooks).toHaveLength(suites.length * 2);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile, collected: 25,
    executed: names.length, passed: names.length, skipped: 25 - names.length, filtered: 25 - names.length });
  const changes: ((r: QualificationReport) => void)[] = [
    r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites.find(suite => suite.mode === 'run')!.mode = 'skip'; },
    r => { r.modules[0].suites.find(suite => suite.mode === 'skip')!.mode = 'run'; },
    r => { r.modules[0].suites.find(suite => suite.mode === 'run')!.name = 'unexpected'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites.find(suite => suite.mode === 'run')!, id: 'duplicate-suite' }); },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites.find(suite => suite.mode === 'run')!, id: 'duplicate-skipped', mode: 'skip' }); },
    r => { r.hooks = []; }, r => { r.hooks.pop(); },
    r => { r.hooks.push({ key: 'unrelated:beforeAll', starts: 1, ends: 1 }); },
    r => { r.hooks[0].key = 'unrelated:beforeAll'; },
    r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; },
    r => { r.hooks[0].ends = 0; },
    r => { r.unhandledErrors = 1; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.modules[0].cases.find(test => test.name === names[0])!.diagnostic!.startTime = 0; },
  ];
  if (names.length > 1) changes.push(
    r => { r.modules[0].cases.reverse(); },
    r => { r.modules[0].cases.find(test => test.name === names[1])!.diagnostic!.startTime = 1; },
  );
  for (const change of changes) {
    const changed = report(binding); change(changed);
    expect(() => validateQualificationReport(binding.context, changed)).toThrow();
  }
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});

it.each(CLOSEOUT_PROFILES)('rejects cross-profile substitution in both directions for $profile', async selection => {
  const binding = await fixture(selection.profile), evidence = report(binding);
  for (const otherProfile of [false, true, INGESTION_PROFILE, OFFICIAL_PROFILE, GUARDS_PROFILE, CONCURRENCY_PROFILE,
    LATE_WRITE_PROFILE, ...CLOSEOUT_PROFILES.filter(other => other.profile !== selection.profile).map(other => other.profile)] as const) {
    const other = await fixture(otherProfile), otherReport = report(other);
    expect(binding.context.profileDigest).not.toBe(other.context.profileDigest);
    const substituted = structuredClone(otherReport);
    substituted.contextDigest = qualificationDigest(binding.context); substituted.specifications[0].pattern = selection.pattern;
    expect(() => validateQualificationReport(binding.context, substituted)).toThrow();
    const reverse = structuredClone(evidence);
    reverse.contextDigest = qualificationDigest(other.context); reverse.specifications[0].pattern = otherReport.specifications[0].pattern;
    expect(() => validateQualificationReport(other.context, reverse)).toThrow();
  }
});

it('covers eleven additional cases using four fixed dependency-closed selections', () => {
  expect(CLOSEOUT_PROFILES.map(selection => [selection.profile, selection.names.length, selection.suites.length * 2])).toEqual([
    [INTAKE_RECOVERY_PROFILE, 6, 6], [REFRESH_HISTORY_PROFILE, 7, 2],
    [PERIOD_RECOVERY_PROFILE, 1, 2], [PERIOD_EXHAUSTION_PROFILE, 1, 2],
  ]);
  const previouslySelected = new Set([INGESTION_FULL_NAME, SELECTED_FULL_NAME, ...OFFICIAL_FULL_NAMES,
    ...GUARDS_FULL_NAMES, ...CONCURRENCY_FULL_NAMES, ...LATE_WRITE_FULL_NAMES]);
  const remaining = SELECTED_INVENTORY.filter(name => !previouslySelected.has(name));
  expect(remaining).toHaveLength(11);
  const newlySelected = new Set(CLOSEOUT_PROFILES.flatMap(selection => selection.names).filter(name => !previouslySelected.has(name)));
  expect([...newlySelected].sort()).toEqual(remaining);
});

async function compatibilityFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const directory = await mkdtemp(join(tmpdir(), 'core-compatibility-profile-')); directories.push(directory);
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), CORE_COMPATIBILITY_PROFILE);
  const modules = CORE_COMPATIBILITY_MODULES.map((spec, moduleIndex) => {
    const suites = [...new Set(spec.inventory.map(name => name.split(' > ')[0]))].map((name, index) => ({
      id: 'suite-' + moduleIndex + '-' + index, name, mode: name === spec.suite ? 'run' : 'skip', errors: 0,
    }));
    return { path: spec.path, state: 'passed', errors: 0, suites, cases: spec.inventory.map((name, index) => {
      const selected = (spec.names as readonly string[]).includes(name);
      return { id: 'case-' + moduleIndex + '-' + index, name, state: selected ? 'passed' : 'skipped', mode: selected ? 'run' : 'skip',
        expectedFailure: false, configuredRetries: false, configuredRepeats: 0, errors: 0, readyEvents: 1, resultEvents: 1,
        diagnostic: selected ? { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } : null };
    }) };
  });
  return { binding: { context, directory }, evidence: { kind: 'integration-qualification-report-v1', contextDigest: qualificationDigest(context),
    starts: 1, ends: 1, reason: 'passed', unhandledErrors: 0,
    specifications: modules.map(module => ({ path: module.path, pattern: CORE_COMPATIBILITY_PATTERN, otherFilters: false })),
    collected: modules.map(module => module.path), modules,
    hooks: modules.flatMap((module, index) => [
      ...['beforeAll', 'afterAll'].map(name => ({ key: module.suites.find(suite => suite.mode === 'run')!.id + ':' + name, starts: 1, ends: 1 })),
      ...(CORE_COMPATIBILITY_MODULES[index].beforeEach ? module.cases.filter(test => test.diagnostic).map(test => ({ key: test.id + ':beforeEach', starts: 1, ends: 1 })) : []),
    ]),
  } };
}
it('binds the fixed core compatibility profile to three reviewed modules, seven cases and exact hooks', async () => {
  const { binding, evidence } = await compatibilityFixture();
  expect(parseQualificationArguments(['--profile=' + CORE_COMPATIBILITY_PROFILE])).toBe(CORE_COMPATIBILITY_PROFILE);
  expect(qualificationArguments(CORE_COMPATIBILITY_PROFILE, '/reporter').slice(4)).toEqual([
    ...CORE_COMPATIBILITY_MODULES.map(module => module.path), '--testNamePattern', CORE_COMPATIBILITY_PATTERN]);
  for (const extra of ['--retry=1', '--testNamePattern=x', '--profile=' + INGESTION_PROFILE, '--sequence.shuffle']) {
    expect(() => parseQualificationArguments(['--profile=' + CORE_COMPATIBILITY_PROFILE, extra])).toThrow();
  }
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationIncludes(env)).toEqual(CORE_COMPATIBILITY_MODULES.map(module => module.path));
  const pattern = new RegExp(CORE_COMPATIBILITY_PATTERN);
  expect(CORE_COMPATIBILITY_MODULES.flatMap(module => module.inventory.filter(name => pattern.test(name.replaceAll(' > ', ' '))))).toEqual(CORE_COMPATIBILITY_FULL_NAMES);
  expect(CORE_COMPATIBILITY_FULL_NAMES).toHaveLength(7);
  expect(evidence.hooks).toHaveLength(8);
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ collected: 89, executed: 7, passed: 7, skipped: 82, filtered: 82 });
  const ordinary = await fixture(INGESTION_PROFILE);
  expect(() => validateQualificationReport(ordinary.context, { ...evidence, contextDigest: qualificationDigest(ordinary.context) })).toThrow();
});
it('rejects compatibility module drift, missing prerequisite execution, extra cases, wrong hooks and chronological reorder', async () => {
  const { binding, evidence } = await compatibilityFixture();
  const changes: ((r: QualificationReport) => void)[] = [
    r => { r.modules.pop(); }, r => { r.collected.reverse(); r.collected.pop(); },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.modules[1].cases.reverse(); },
    r => { r.modules[1].cases.filter(test => test.diagnostic)[1].diagnostic!.startTime = 1; },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; },
    r => { r.hooks.push({ key: 'excluded:beforeAll', starts: 1, ends: 1 }); },
    r => { r.modules[2].suites.find(suite => suite.mode === 'skip')!.mode = 'run'; },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[1].cases[4].diagnostic!.retryCount = 1; },
    r => { r.modules[1].cases[1].state = 'passed'; r.modules[1].cases[1].mode = 'run'; },
    r => { r.modules[0].cases[0].id = r.modules[1].cases[0].id; },
  ];
  for (const change of changes) { const changed = structuredClone(evidence); change(changed); expect(() => validateQualificationReport(binding.context, changed)).toThrow(); }
  const env = { PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  for (const modules of [binding.context.modules.slice(1), [...binding.context.modules].reverse(), [...binding.context.modules, binding.context.modules[0]]]) {
    expect(() => qualificationBinding({ ...env, [QUALIFICATION_CONTEXT_ENV]: JSON.stringify({ ...binding.context, modules }) })).toThrow();
  }
  await mkdir(join(binding.directory, 'integration'));
  for (const spec of CORE_COMPATIBILITY_MODULES) await writeFile(join(binding.directory, spec.path), await readFile(new URL('../' + spec.path, import.meta.url), 'utf8'));
  for (const spec of CORE_COMPATIBILITY_MODULES) {
    const path = join(binding.directory, spec.path), original = await readFile(path, 'utf8');
    await writeFile(path, original + '\n// drift\n');
    await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), CORE_COMPATIBILITY_PROFILE)).rejects.toThrow('reviewed LF digest');
    await writeFile(path, original);
  }
});
it('independently inventories every compatibility case without loading SQL modules', async () => {
  for (const spec of CORE_COMPATIBILITY_MODULES) {
    const path = fileURLToPath(new URL('../' + spec.path, import.meta.url)), source = await readFile(path, 'utf8');
    expect(qualificationSourceDigest(source)).toBe(spec.sourceDigest);
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), cases: string[] = [];
    const visit = (node: ts.Node, suites: string[]) => {
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        if (ts.isIdentifier(expression) && expression.text === 'describe' && ts.isStringLiteral(node.arguments[0])) {
          const suite = [...suites, node.arguments[0].text]; ts.forEachChild(node.arguments[1], child => visit(child, suite)); return;
        }
        const direct = ts.isIdentifier(expression) && expression.text === 'it';
        const each = ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)
          && expression.expression.expression.getText(tree) === 'it' && expression.expression.name.text === 'each';
        if ((direct || each) && ts.isStringLiteral(node.arguments[0])) {
          const template = node.arguments[0].text, argument = each && ts.isCallExpression(expression) ? expression.arguments[0] : undefined;
          const values = argument && ts.isAsExpression(argument) ? argument.expression : argument;
          for (const value of values && ts.isArrayLiteralExpression(values) ? values.elements : [undefined]) {
            let name = template;
            if (value && ts.isStringLiteral(value)) name = name.replace('%s', value.text);
            else if (value && ts.isObjectLiteralExpression(value)) {
              expect(template).toBe('counts $label in cumulative PPG');
              const label = value.properties.find(field => ts.isPropertyAssignment(field) && field.name.getText(tree) === 'label');
              expect(label && ts.isPropertyAssignment(label) && ts.isStringLiteral(label.initializer)).toBe(true);
              const text = ((label as ts.PropertyAssignment).initializer as ts.StringLiteral).text;
              // Installed-Vitest runner coverage below the source inventory test
              // proves these quoted/truncated object labels, including filtered cases.
              const titles: Record<string, string> = {
                'a zero-point partial appearance after published points': "counts 'a zero-point partial appearance after…' in cumulative PPG",
                'a published zero-point appearance before partial points': "counts 'a published zero-point appearance bef…' in cumulative PPG",
              };
              name = titles[text]; expect(name).toBeDefined();
            } else expect(value).toBeUndefined();
            cases.push([...suites, name].join(' > '));
          }
          return;
        }
      }
      ts.forEachChild(node, child => visit(child, suites));
    };
    visit(tree, []);
    expect([...cases].sort()).toEqual([...spec.inventory].sort());
    expect(cases.filter(name => (spec.names as readonly string[]).includes(name))).toEqual(spec.names);
  }
});


async function playerDirectoryFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const directory = await mkdtemp(join(tmpdir(), 'player-directory-profile-')); directories.push(directory);
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)),
    'a'.repeat(40), randomUUID(), PLAYER_DIRECTORY_PROFILE);
  const evidence: QualificationReport = {
    kind: 'integration-qualification-report-v1', contextDigest: qualificationDigest(context), starts: 1, ends: 1,
    reason: 'passed', unhandledErrors: 0,
    specifications: [{ path: PLAYER_DIRECTORY_MODULE, pattern: PLAYER_DIRECTORY_PATTERN, otherFilters: false }],
    collected: [PLAYER_DIRECTORY_MODULE],
    hooks: ['beforeAll', 'afterAll'].map(name => ({ key: 'suite:' + name, starts: 1, ends: 1 })),
    modules: [{ path: PLAYER_DIRECTORY_MODULE, state: 'passed', errors: 0,
      suites: [{ id: 'suite', name: PLAYER_DIRECTORY_SUITE, mode: 'run', errors: 0 }],
      cases: PLAYER_DIRECTORY_FULL_NAMES.map((name, index) => ({ id: 'case-' + index, name, state: 'passed', mode: 'run',
        expectedFailure: false, configuredRetries: false, configuredRepeats: 0, errors: 0, readyEvents: 1, resultEvents: 1,
        diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }],
  };
  return { binding: { context, directory }, evidence };
}
it('binds the directory profile to six exact cases and original cleanup gates while full discovery includes its module', async () => {
  expect(parseQualificationArguments(['--profile=' + PLAYER_DIRECTORY_PROFILE])).toBe(PLAYER_DIRECTORY_PROFILE);
  expect(qualificationArguments(PLAYER_DIRECTORY_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', PLAYER_DIRECTORY_MODULE, '--testNamePattern', PLAYER_DIRECTORY_PATTERN]);
  for (const args of [
    ['--profile=data-player-directory-v2'], ['--profile', PLAYER_DIRECTORY_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + PLAYER_DIRECTORY_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + PLAYER_DIRECTORY_PROFILE, extra]),
  ]) expect(() => parseQualificationArguments(args)).toThrow('closed');
  const { binding, evidence } = await playerDirectoryFixture();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationIncludes(env)).toEqual([PLAYER_DIRECTORY_MODULE]);
  expect(qualificationIncludes({})).toEqual(['integration/**/*.integration-case.ts']);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules.some(module => module.path === PLAYER_DIRECTORY_MODULE)).toBe(true);
  const older = await fixture(INGESTION_PROFILE);
  expect(older.context.modules.map(module => module.path)).toEqual([SELECTED_MODULE]);
  const regex = new RegExp(PLAYER_DIRECTORY_PATTERN);
  expect(PLAYER_DIRECTORY_FULL_NAMES).toHaveLength(6);
  for (const name of PLAYER_DIRECTORY_FULL_NAMES) {
    expect(regex.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(regex.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(regex.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect(SELECTED_INVENTORY.some(name => regex.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: PLAYER_DIRECTORY_PROFILE,
    collected: 6, executed: 6, passed: 6, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});
it('rejects incomplete directory inventory, reordered execution, hook drift, retries and substituted profile evidence', async () => {
  const { binding, evidence } = await playerDirectoryFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].cases[1].id = r.modules[0].cases[0].id; }, r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].ends = 0; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; },
  ];
  for (const change of changes) {
    const changed = structuredClone(evidence); change(changed);
    expect(() => validateQualificationReport(binding.context, changed)).toThrow();
  }
  const older = await fixture(INGESTION_PROFILE), oldReport = report(older);
  expect(() => validateQualificationReport(older.context, { ...evidence, contextDigest: qualificationDigest(older.context) })).toThrow();
  expect(() => validateQualificationReport(binding.context, { ...oldReport, contextDigest: qualificationDigest(binding.context) })).toThrow();
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, PLAYER_DIRECTORY_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), PLAYER_DIRECTORY_PROFILE))
    .rejects.toThrow('reviewed LF digest');
});
it('independently inventories the directory SQL fixture source and hooks without importing its execution', async () => {
  const path = fileURLToPath(new URL('../' + PLAYER_DIRECTORY_MODULE, import.meta.url));
  const source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(PLAYER_DIRECTORY_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') {
        expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
        suites.push((node.arguments[0] as ts.StringLiteral).text);
      }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) hooks.push(expression);
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(suites).toEqual([PLAYER_DIRECTORY_SUITE]); expect(names).toEqual(PLAYER_DIRECTORY_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']);
});

async function livePlayerDirectoryFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const directory = await mkdtemp(join(tmpdir(), 'live-player-directory-profile-')); directories.push(directory);
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)),
    'a'.repeat(40), randomUUID(), LIVE_PLAYER_DIRECTORY_PROFILE);
  const evidence: QualificationReport = {
    kind: 'integration-qualification-report-v1', contextDigest: qualificationDigest(context), starts: 1, ends: 1,
    reason: 'passed', unhandledErrors: 0,
    specifications: [{ path: LIVE_PLAYER_DIRECTORY_MODULE, pattern: LIVE_PLAYER_DIRECTORY_PATTERN, otherFilters: false }],
    collected: [LIVE_PLAYER_DIRECTORY_MODULE],
    hooks: ['beforeAll', 'afterAll'].map(name => ({ key: 'suite:' + name, starts: 1, ends: 1 })),
    modules: [{ path: LIVE_PLAYER_DIRECTORY_MODULE, state: 'passed', errors: 0,
      suites: [{ id: 'suite', name: LIVE_PLAYER_DIRECTORY_SUITE, mode: 'run', errors: 0 }],
      cases: [{ id: 'case', name: LIVE_PLAYER_DIRECTORY_FULL_NAME, state: 'passed', mode: 'run',
        expectedFailure: false, configuredRetries: false, configuredRepeats: 0, errors: 0, readyEvents: 1, resultEvents: 1,
        diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 } }] }],
  };
  return { binding: { context, directory }, evidence };
}
it('requires a closed bound live directory profile while preserving default55 discovery and every older source pin', async () => {
  expect(parseQualificationArguments(['--profile=' + LIVE_PLAYER_DIRECTORY_PROFILE])).toBe(LIVE_PLAYER_DIRECTORY_PROFILE);
  expect(qualificationArguments(LIVE_PLAYER_DIRECTORY_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', LIVE_PLAYER_DIRECTORY_MODULE, '--testNamePattern', LIVE_PLAYER_DIRECTORY_PATTERN]);
  for (const args of [['--profile=data-live-player-directory-v2'], ['--profile', LIVE_PLAYER_DIRECTORY_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + LIVE_PLAYER_DIRECTORY_PROFILE, '--profile=' + PLAYER_DIRECTORY_PROFILE].map(extra => ['--profile=' + LIVE_PLAYER_DIRECTORY_PROFILE, extra]),
  ]) expect(() => parseQualificationArguments(args)).toThrow('closed');
  const { binding } = await livePlayerDirectoryFixture();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationIncludes(env)).toEqual([LIVE_PLAYER_DIRECTORY_MODULE]);
  expect(requireLivePlayerDirectoryQualification(env)).toEqual(binding);
  expect(() => requireLivePlayerDirectoryQualification({})).toThrow('Explicit bound');
  expect(qualificationIncludes({})).toEqual(['integration/**/*.integration-case.ts']);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules).toHaveLength(70);
  expect(full.modules.some(module => module.path.endsWith('.live-integration-case.ts'))).toBe(false);
  for (const profile of [PLAYER_DIRECTORY_PROFILE, SELECTED_PROFILE, INGESTION_PROFILE, LIVE_PROFILE, JOURNEY_PROFILE] as const) {
    const older = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), profile);
    expect(() => requireLivePlayerDirectoryQualification({ ...env, [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(older) })).toThrow('Explicit bound');
    expect(older.modules.some(module => module.path === LIVE_PLAYER_DIRECTORY_MODULE)).toBe(false);
  }
  expect(PLAYER_DIRECTORY_SOURCE_DIGEST).toBe('c35a72eab57663a635a4e053f2a3ff2a17dcb7c4d44d610ed7af76c51322eaa9');
  expect(LIVE_SOURCE_DIGEST).toBe('bcb3bee63bf12658da7d099fd34397fada96757a5799e05a586456761b173f74');
  expect(JOURNEY_SOURCE_DIGEST).toBe('f8f2be393a4ea0d5660feac0c720ac2fffc4817c30ebf9a231f249d7b096615f');
  expect(SELECTED_SOURCE_DIGEST).toBe('899c526471fd9f9df3917a357721c52b249d44c7aed5660fb658dda39d675abf');
  const regex = new RegExp(LIVE_PLAYER_DIRECTORY_PATTERN), name = LIVE_PLAYER_DIRECTORY_FULL_NAME.replaceAll(' > ', ' ');
  expect(regex.test(name)).toBe(true); expect(regex.test('prefix ' + name)).toBe(false); expect(regex.test(name + ' suffix')).toBe(false);
  const forged = structuredClone(binding.context); forged.modules[0].sourceDigest = 'f'.repeat(64);
  expect(() => qualificationBinding({ ...env, [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(forged) })).toThrow();
});
it('requires one live directory result with exact hooks and acknowledged cleanup and rejects substituted evidence', async () => {
  const { binding, evidence } = await livePlayerDirectoryFixture();
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: LIVE_PLAYER_DIRECTORY_PROFILE,
    collected: 1, executed: 1, passed: 1, skipped: 0, filtered: 0 });
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases = []; }, r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].suites = []; }, r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); }, r => { r.hooks.pop(); },
    r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; }, r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); },
    r => { r.hooks[0].ends = 0; }, r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; }, r => { r.collected = [PLAYER_DIRECTORY_MODULE]; },
  ];
  for (const change of changes) {
    const changed = structuredClone(evidence); change(changed);
    expect(() => validateQualificationReport(binding.context, changed)).toThrow();
  }
  const older = await playerDirectoryFixture();
  expect(() => validateQualificationReport(older.binding.context, { ...evidence, contextDigest: qualificationDigest(older.binding.context) })).toThrow();
  expect(() => validateQualificationReport(binding.context, { ...older.evidence, contextDigest: qualificationDigest(binding.context) })).toThrow();
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, LIVE_PLAYER_DIRECTORY_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), LIVE_PLAYER_DIRECTORY_PROFILE)).rejects.toThrow();
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});
it('pins and independently inventories the single live directory case and hooks without importing its execution', async () => {
  const path = fileURLToPath(new URL('../' + LIVE_PLAYER_DIRECTORY_MODULE, import.meta.url));
  const source = await readFile(path, 'utf8'); expect(qualificationSourceDigest(source)).toBe(LIVE_PLAYER_DIRECTORY_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); suites.push((node.arguments[0] as ts.StringLiteral).text); }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) hooks.push(expression);
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(suites).toEqual([LIVE_PLAYER_DIRECTORY_SUITE]); expect(names).toEqual([LIVE_PLAYER_DIRECTORY_TEST]);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']);
});

async function rosterPlayerLinksFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const directory = await mkdtemp(join(tmpdir(), 'roster-player-links-profile-')); directories.push(directory);
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)),
    'a'.repeat(40), randomUUID(), ROSTER_PLAYER_LINKS_PROFILE);
  const evidence: QualificationReport = {
    kind: 'integration-qualification-report-v1', contextDigest: qualificationDigest(context), starts: 1, ends: 1,
    reason: 'passed', unhandledErrors: 0,
    specifications: [{ path: ROSTER_PLAYER_LINKS_MODULE, pattern: ROSTER_PLAYER_LINKS_PATTERN, otherFilters: false }],
    collected: [ROSTER_PLAYER_LINKS_MODULE],
    hooks: ['beforeAll', 'afterAll'].map(name => ({ key: 'suite:' + name, starts: 1, ends: 1 })),
    modules: [{ path: ROSTER_PLAYER_LINKS_MODULE, state: 'passed', errors: 0,
      suites: [{ id: 'suite', name: ROSTER_PLAYER_LINKS_SUITE, mode: 'run', errors: 0 }],
      cases: ROSTER_PLAYER_LINKS_FULL_NAMES.map((name, index) => ({ id: 'case-' + index, name, state: 'passed', mode: 'run',
        expectedFailure: false, configuredRetries: false, configuredRepeats: 0, errors: 0, readyEvents: 1, resultEvents: 1,
        diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }],
  };
  return { binding: { context, directory }, evidence };
}
it('binds the roster player links profile to nine exact cases and original cleanup gates while full discovery includes its module', async () => {
  expect(parseQualificationArguments(['--profile=' + ROSTER_PLAYER_LINKS_PROFILE])).toBe(ROSTER_PLAYER_LINKS_PROFILE);
  expect(qualificationArguments(ROSTER_PLAYER_LINKS_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', ROSTER_PLAYER_LINKS_MODULE, '--testNamePattern', ROSTER_PLAYER_LINKS_PATTERN]);
  for (const args of [
    ['--profile=data-roster-player-links-v2'], ['--profile', ROSTER_PLAYER_LINKS_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + ROSTER_PLAYER_LINKS_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + ROSTER_PLAYER_LINKS_PROFILE, extra]),
  ]) expect(() => parseQualificationArguments(args)).toThrow('closed');
  const { binding, evidence } = await rosterPlayerLinksFixture();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationIncludes(env)).toEqual([ROSTER_PLAYER_LINKS_MODULE]);
  expect(qualificationIncludes({})).toEqual(['integration/**/*.integration-case.ts']);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules.some(module => module.path === ROSTER_PLAYER_LINKS_MODULE)).toBe(true);
  const older = await fixture(INGESTION_PROFILE);
  expect(older.context.modules.map(module => module.path)).toEqual([SELECTED_MODULE]);
  const regex = new RegExp(ROSTER_PLAYER_LINKS_PATTERN);
  expect(ROSTER_PLAYER_LINKS_FULL_NAMES).toHaveLength(9);
  for (const name of ROSTER_PLAYER_LINKS_FULL_NAMES) {
    expect(regex.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(regex.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(regex.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect(SELECTED_INVENTORY.some(name => regex.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: ROSTER_PLAYER_LINKS_PROFILE,
    collected: 9, executed: 9, passed: 9, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});
it('rejects incomplete roster player link inventory, reordered execution, hook drift, retries and substituted profile evidence', async () => {
  const { binding, evidence } = await rosterPlayerLinksFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].cases[1].id = r.modules[0].cases[0].id; }, r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].ends = 0; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; },
  ];
  for (const change of changes) {
    const changed = structuredClone(evidence); change(changed);
    expect(() => validateQualificationReport(binding.context, changed)).toThrow();
  }
  const older = await fixture(INGESTION_PROFILE), oldReport = report(older);
  expect(() => validateQualificationReport(older.context, { ...evidence, contextDigest: qualificationDigest(older.context) })).toThrow();
  expect(() => validateQualificationReport(binding.context, { ...oldReport, contextDigest: qualificationDigest(binding.context) })).toThrow();
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, ROSTER_PLAYER_LINKS_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), ROSTER_PLAYER_LINKS_PROFILE))
    .rejects.toThrow('reviewed LF digest');
});
it('independently inventories the roster player link SQL fixture source and hooks without importing its execution', async () => {
  const path = fileURLToPath(new URL('../' + ROSTER_PLAYER_LINKS_MODULE, import.meta.url));
  const source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(ROSTER_PLAYER_LINKS_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') {
        expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
        suites.push((node.arguments[0] as ts.StringLiteral).text);
      }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) hooks.push(expression);
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(suites).toEqual([ROSTER_PLAYER_LINKS_SUITE]); expect(names).toEqual(ROSTER_PLAYER_LINKS_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']);
});

async function teamManagerFactsFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const directory = await mkdtemp(join(tmpdir(), 'team-manager-facts-profile-')); directories.push(directory);
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)),
    'a'.repeat(40), randomUUID(), TEAM_MANAGER_FACTS_PROFILE);
  const evidence: QualificationReport = {
    kind: 'integration-qualification-report-v1', contextDigest: qualificationDigest(context), starts: 1, ends: 1,
    reason: 'passed', unhandledErrors: 0,
    specifications: [{ path: TEAM_MANAGER_FACTS_MODULE, pattern: TEAM_MANAGER_FACTS_PATTERN, otherFilters: false }],
    collected: [TEAM_MANAGER_FACTS_MODULE],
    hooks: ['beforeAll', 'afterAll'].map(name => ({ key: 'suite:' + name, starts: 1, ends: 1 })),
    modules: [{ path: TEAM_MANAGER_FACTS_MODULE, state: 'passed', errors: 0,
      suites: [{ id: 'suite', name: TEAM_MANAGER_FACTS_SUITE, mode: 'run', errors: 0 }],
      cases: TEAM_MANAGER_FACTS_FULL_NAMES.map((name, index) => ({ id: 'case-' + index, name, state: 'passed', mode: 'run',
        expectedFailure: false, configuredRetries: false, configuredRepeats: 0, errors: 0, readyEvents: 1, resultEvents: 1,
        diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }],
  };
  return { binding: { context, directory }, evidence };
}
it('binds the team manager facts profile to nine exact cases and original cleanup gates while full discovery includes its module', async () => {
  expect(parseQualificationArguments(['--profile=' + TEAM_MANAGER_FACTS_PROFILE])).toBe(TEAM_MANAGER_FACTS_PROFILE);
  expect(qualificationArguments(TEAM_MANAGER_FACTS_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', TEAM_MANAGER_FACTS_MODULE, '--testNamePattern', TEAM_MANAGER_FACTS_PATTERN]);
  for (const args of [
    ['--profile=data-team-manager-facts-v2'], ['--profile', TEAM_MANAGER_FACTS_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + TEAM_MANAGER_FACTS_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + TEAM_MANAGER_FACTS_PROFILE, extra]),
  ]) expect(() => parseQualificationArguments(args)).toThrow('closed');
  const { binding, evidence } = await teamManagerFactsFixture();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationIncludes(env)).toEqual([TEAM_MANAGER_FACTS_MODULE]);
  expect(qualificationIncludes({})).toEqual(['integration/**/*.integration-case.ts']);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules.some(module => module.path === TEAM_MANAGER_FACTS_MODULE)).toBe(true);
  const older = await fixture(INGESTION_PROFILE);
  expect(older.context.modules.map(module => module.path)).toEqual([SELECTED_MODULE]);
  const regex = new RegExp(TEAM_MANAGER_FACTS_PATTERN);
  expect(TEAM_MANAGER_FACTS_FULL_NAMES).toHaveLength(9);
  for (const name of TEAM_MANAGER_FACTS_FULL_NAMES) {
    expect(regex.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(regex.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(regex.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect(SELECTED_INVENTORY.some(name => regex.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: TEAM_MANAGER_FACTS_PROFILE,
    collected: 9, executed: 9, passed: 9, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});
it('rejects incomplete team manager fact inventory, reordered execution, hook drift, retries and substituted profile evidence', async () => {
  const { binding, evidence } = await teamManagerFactsFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].cases[1].id = r.modules[0].cases[0].id; }, r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].ends = 0; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; },
  ];
  for (const change of changes) {
    const changed = structuredClone(evidence); change(changed);
    expect(() => validateQualificationReport(binding.context, changed)).toThrow();
  }
  const older = await fixture(INGESTION_PROFILE), oldReport = report(older);
  expect(() => validateQualificationReport(older.context, { ...evidence, contextDigest: qualificationDigest(older.context) })).toThrow();
  expect(() => validateQualificationReport(binding.context, { ...oldReport, contextDigest: qualificationDigest(binding.context) })).toThrow();
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, TEAM_MANAGER_FACTS_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), TEAM_MANAGER_FACTS_PROFILE))
    .rejects.toThrow('reviewed LF digest');
});
it('independently inventories the team manager fact SQL fixture source and hooks without importing its execution', async () => {
  const path = fileURLToPath(new URL('../' + TEAM_MANAGER_FACTS_MODULE, import.meta.url));
  const source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(TEAM_MANAGER_FACTS_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') {
        expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
        suites.push((node.arguments[0] as ts.StringLiteral).text);
      }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) hooks.push(expression);
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(suites).toEqual([TEAM_MANAGER_FACTS_SUITE]); expect(names).toEqual(TEAM_MANAGER_FACTS_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']);
});

async function periodInventoryFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const directory = await mkdtemp(join(tmpdir(), 'period-inventory-profile-')); directories.push(directory);
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)),
    'a'.repeat(40), randomUUID(), PERIOD_INVENTORY_PROFILE);
  const evidence: QualificationReport = {
    kind: 'integration-qualification-report-v1', contextDigest: qualificationDigest(context), starts: 1, ends: 1,
    reason: 'passed', unhandledErrors: 0,
    specifications: [{ path: PERIOD_INVENTORY_MODULE, pattern: PERIOD_INVENTORY_PATTERN, otherFilters: false }],
    collected: [PERIOD_INVENTORY_MODULE],
    hooks: ['beforeAll', 'afterAll'].map(name => ({ key: 'suite:' + name, starts: 1, ends: 1 })),
    modules: [{ path: PERIOD_INVENTORY_MODULE, state: 'passed', errors: 0,
      suites: [{ id: 'suite', name: PERIOD_INVENTORY_SUITE, mode: 'run', errors: 0 }],
      cases: PERIOD_INVENTORY_FULL_NAMES.map((name, index) => ({ id: 'case-' + index, name, state: 'passed', mode: 'run',
        expectedFailure: false, configuredRetries: false, configuredRepeats: 0, errors: 0, readyEvents: 1, resultEvents: 1,
        diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }],
  };
  return { binding: { context, directory }, evidence };
}
it('binds the period inventory profile to six exact cases and original cleanup gates while full discovery includes its module', async () => {
  expect(parseQualificationArguments(['--profile=' + PERIOD_INVENTORY_PROFILE])).toBe(PERIOD_INVENTORY_PROFILE);
  expect(qualificationArguments(PERIOD_INVENTORY_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', PERIOD_INVENTORY_MODULE, '--testNamePattern', PERIOD_INVENTORY_PATTERN]);
  for (const args of [
    ['--profile=data-period-inventory-v2'], ['--profile', PERIOD_INVENTORY_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + PERIOD_INVENTORY_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + PERIOD_INVENTORY_PROFILE, extra]),
  ]) expect(() => parseQualificationArguments(args)).toThrow('closed');
  const { binding, evidence } = await periodInventoryFixture();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationIncludes(env)).toEqual([PERIOD_INVENTORY_MODULE]);
  expect(qualificationIncludes({})).toEqual(['integration/**/*.integration-case.ts']);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules.some(module => module.path === PERIOD_INVENTORY_MODULE)).toBe(true);
  const older = await fixture(INGESTION_PROFILE);
  expect(older.context.modules.map(module => module.path)).toEqual([SELECTED_MODULE]);
  const regex = new RegExp(PERIOD_INVENTORY_PATTERN);
  expect(PERIOD_INVENTORY_FULL_NAMES).toHaveLength(6);
  for (const name of PERIOD_INVENTORY_FULL_NAMES) {
    expect(regex.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(regex.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(regex.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect(SELECTED_INVENTORY.some(name => regex.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: PERIOD_INVENTORY_PROFILE,
    collected: 6, executed: 6, passed: 6, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});
it('rejects incomplete period inventory inventory, reordered execution, hook drift, retries and substituted profile evidence', async () => {
  const { binding, evidence } = await periodInventoryFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].cases[1].id = r.modules[0].cases[0].id; }, r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].ends = 0; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; },
  ];
  for (const change of changes) {
    const changed = structuredClone(evidence); change(changed);
    expect(() => validateQualificationReport(binding.context, changed)).toThrow();
  }
  const older = await fixture(INGESTION_PROFILE), oldReport = report(older);
  expect(() => validateQualificationReport(older.context, { ...evidence, contextDigest: qualificationDigest(older.context) })).toThrow();
  expect(() => validateQualificationReport(binding.context, { ...oldReport, contextDigest: qualificationDigest(binding.context) })).toThrow();
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, PERIOD_INVENTORY_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), PERIOD_INVENTORY_PROFILE))
    .rejects.toThrow('reviewed LF digest');
});
it('independently inventories the period inventory SQL fixture source and hooks without importing its execution', async () => {
  const path = fileURLToPath(new URL('../' + PERIOD_INVENTORY_MODULE, import.meta.url));
  const source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(PERIOD_INVENTORY_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') {
        expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
        suites.push((node.arguments[0] as ts.StringLiteral).text);
      }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) hooks.push(expression);
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(suites).toEqual([PERIOD_INVENTORY_SUITE]); expect(names).toEqual(PERIOD_INVENTORY_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']);
});

async function periodSettingsContextFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const directory = await mkdtemp(join(tmpdir(), 'period-settings-context-profile-')); directories.push(directory);
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)),
    'a'.repeat(40), randomUUID(), PERIOD_SETTINGS_CONTEXT_PROFILE);
  const evidence: QualificationReport = {
    kind: 'integration-qualification-report-v1', contextDigest: qualificationDigest(context), starts: 1, ends: 1,
    reason: 'passed', unhandledErrors: 0,
    specifications: [{ path: PERIOD_SETTINGS_CONTEXT_MODULE, pattern: PERIOD_SETTINGS_CONTEXT_PATTERN, otherFilters: false }],
    collected: [PERIOD_SETTINGS_CONTEXT_MODULE],
    hooks: ['beforeAll', 'afterAll'].map(name => ({ key: 'suite:' + name, starts: 1, ends: 1 })),
    modules: [{ path: PERIOD_SETTINGS_CONTEXT_MODULE, state: 'passed', errors: 0,
      suites: [{ id: 'suite', name: PERIOD_SETTINGS_CONTEXT_SUITE, mode: 'run', errors: 0 }],
      cases: PERIOD_SETTINGS_CONTEXT_FULL_NAMES.map((name, index) => ({ id: 'case-' + index, name, state: 'passed', mode: 'run',
        expectedFailure: false, configuredRetries: false, configuredRepeats: 0, errors: 0, readyEvents: 1, resultEvents: 1,
        diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }],
  };
  return { binding: { context, directory }, evidence };
}
it('binds the period settings context profile to seven exact cases and original cleanup gates while full discovery includes its module', async () => {
  expect(parseQualificationArguments(['--profile=' + PERIOD_SETTINGS_CONTEXT_PROFILE])).toBe(PERIOD_SETTINGS_CONTEXT_PROFILE);
  expect(qualificationArguments(PERIOD_SETTINGS_CONTEXT_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', PERIOD_SETTINGS_CONTEXT_MODULE, '--testNamePattern', PERIOD_SETTINGS_CONTEXT_PATTERN]);
  for (const args of [
    ['--profile=data-period-settings-context-v2'], ['--profile', PERIOD_SETTINGS_CONTEXT_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + PERIOD_SETTINGS_CONTEXT_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + PERIOD_SETTINGS_CONTEXT_PROFILE, extra]),
  ]) expect(() => parseQualificationArguments(args)).toThrow('closed');
  const { binding, evidence } = await periodSettingsContextFixture();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationIncludes(env)).toEqual([PERIOD_SETTINGS_CONTEXT_MODULE]);
  expect(qualificationIncludes({})).toEqual(['integration/**/*.integration-case.ts']);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules.some(module => module.path === PERIOD_SETTINGS_CONTEXT_MODULE)).toBe(true);
  const older = await fixture(INGESTION_PROFILE);
  expect(older.context.modules.map(module => module.path)).toEqual([SELECTED_MODULE]);
  const regex = new RegExp(PERIOD_SETTINGS_CONTEXT_PATTERN);
  expect(PERIOD_SETTINGS_CONTEXT_FULL_NAMES).toHaveLength(7);
  for (const name of PERIOD_SETTINGS_CONTEXT_FULL_NAMES) {
    expect(regex.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(regex.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(regex.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect(SELECTED_INVENTORY.some(name => regex.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: PERIOD_SETTINGS_CONTEXT_PROFILE,
    collected: 7, executed: 7, passed: 7, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});
it('rejects incomplete period settings context inventory, reordered execution, hook drift, retries and substituted profile evidence', async () => {
  const { binding, evidence } = await periodSettingsContextFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].cases[1].id = r.modules[0].cases[0].id; }, r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].ends = 0; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; },
  ];
  for (const change of changes) {
    const changed = structuredClone(evidence); change(changed);
    expect(() => validateQualificationReport(binding.context, changed)).toThrow();
  }
  const older = await fixture(INGESTION_PROFILE), oldReport = report(older);
  expect(() => validateQualificationReport(older.context, { ...evidence, contextDigest: qualificationDigest(older.context) })).toThrow();
  expect(() => validateQualificationReport(binding.context, { ...oldReport, contextDigest: qualificationDigest(binding.context) })).toThrow();
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, PERIOD_SETTINGS_CONTEXT_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), PERIOD_SETTINGS_CONTEXT_PROFILE))
    .rejects.toThrow('reviewed LF digest');
});
it('independently inventories the period settings context SQL fixture source and hooks without importing its execution', async () => {
  const path = fileURLToPath(new URL('../' + PERIOD_SETTINGS_CONTEXT_MODULE, import.meta.url));
  const source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(PERIOD_SETTINGS_CONTEXT_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') {
        expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
        suites.push((node.arguments[0] as ts.StringLiteral).text);
      }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) hooks.push(expression);
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(suites).toEqual([PERIOD_SETTINGS_CONTEXT_SUITE]); expect(names).toEqual(PERIOD_SETTINGS_CONTEXT_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']);
});

async function exactMatchupValuesFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const directory = await mkdtemp(join(tmpdir(), 'exact-matchup-values-profile-')); directories.push(directory);
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)),
    'a'.repeat(40), randomUUID(), EXACT_MATCHUP_VALUES_PROFILE);
  const evidence: QualificationReport = {
    kind: 'integration-qualification-report-v1', contextDigest: qualificationDigest(context), starts: 1, ends: 1,
    reason: 'passed', unhandledErrors: 0,
    specifications: [{ path: EXACT_MATCHUP_VALUES_MODULE, pattern: EXACT_MATCHUP_VALUES_PATTERN, otherFilters: false }],
    collected: [EXACT_MATCHUP_VALUES_MODULE],
    hooks: ['beforeAll', 'afterAll'].map(name => ({ key: 'suite:' + name, starts: 1, ends: 1 })),
    modules: [{ path: EXACT_MATCHUP_VALUES_MODULE, state: 'passed', errors: 0,
      suites: [{ id: 'suite', name: EXACT_MATCHUP_VALUES_SUITE, mode: 'run', errors: 0 }],
      cases: EXACT_MATCHUP_VALUES_FULL_NAMES.map((name, index) => ({ id: 'case-' + index, name, state: 'passed', mode: 'run',
        expectedFailure: false, configuredRetries: false, configuredRepeats: 0, errors: 0, readyEvents: 1, resultEvents: 1,
        diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }],
  };
  return { binding: { context, directory }, evidence };
}
it('binds the exact matchup values profile to seven exact cases and original cleanup gates while full discovery includes its module', async () => {
  expect(parseQualificationArguments(['--profile=' + EXACT_MATCHUP_VALUES_PROFILE])).toBe(EXACT_MATCHUP_VALUES_PROFILE);
  expect(qualificationArguments(EXACT_MATCHUP_VALUES_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', EXACT_MATCHUP_VALUES_MODULE, '--testNamePattern', EXACT_MATCHUP_VALUES_PATTERN]);
  for (const args of [
    ['--profile=data-exact-matchup-values-v2'], ['--profile', EXACT_MATCHUP_VALUES_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + EXACT_MATCHUP_VALUES_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + EXACT_MATCHUP_VALUES_PROFILE, extra]),
  ]) expect(() => parseQualificationArguments(args)).toThrow('closed');
  const { binding, evidence } = await exactMatchupValuesFixture();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationIncludes(env)).toEqual([EXACT_MATCHUP_VALUES_MODULE]);
  expect(qualificationIncludes({})).toEqual(['integration/**/*.integration-case.ts']);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules.some(module => module.path === EXACT_MATCHUP_VALUES_MODULE)).toBe(true);
  const older = await fixture(INGESTION_PROFILE);
  expect(older.context.modules.map(module => module.path)).toEqual([SELECTED_MODULE]);
  const regex = new RegExp(EXACT_MATCHUP_VALUES_PATTERN);
  expect(EXACT_MATCHUP_VALUES_FULL_NAMES).toHaveLength(7);
  for (const name of EXACT_MATCHUP_VALUES_FULL_NAMES) {
    expect(regex.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(regex.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(regex.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect(SELECTED_INVENTORY.some(name => regex.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: EXACT_MATCHUP_VALUES_PROFILE,
    collected: 7, executed: 7, passed: 7, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});
it('rejects incomplete exact matchup values inventory, reordered execution, hook drift, retries and substituted profile evidence', async () => {
  const { binding, evidence } = await exactMatchupValuesFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].cases[1].id = r.modules[0].cases[0].id; }, r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].ends = 0; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; },
  ];
  for (const change of changes) {
    const changed = structuredClone(evidence); change(changed);
    expect(() => validateQualificationReport(binding.context, changed)).toThrow();
  }
  const older = await fixture(INGESTION_PROFILE), oldReport = report(older);
  expect(() => validateQualificationReport(older.context, { ...evidence, contextDigest: qualificationDigest(older.context) })).toThrow();
  expect(() => validateQualificationReport(binding.context, { ...oldReport, contextDigest: qualificationDigest(binding.context) })).toThrow();
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, EXACT_MATCHUP_VALUES_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), EXACT_MATCHUP_VALUES_PROFILE))
    .rejects.toThrow('reviewed LF digest');
});
it('independently inventories the exact matchup values SQL fixture source and hooks without importing its execution', async () => {
  const path = fileURLToPath(new URL('../' + EXACT_MATCHUP_VALUES_MODULE, import.meta.url));
  const source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(EXACT_MATCHUP_VALUES_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') {
        expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
        suites.push((node.arguments[0] as ts.StringLiteral).text);
      }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) hooks.push(expression);
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(suites).toEqual([EXACT_MATCHUP_VALUES_SUITE]); expect(names).toEqual(EXACT_MATCHUP_VALUES_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']);
});

async function typedBracketsFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const directory = await mkdtemp(join(tmpdir(), 'typed-brackets-profile-')); directories.push(directory);
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)),
    'a'.repeat(40), randomUUID(), TYPED_BRACKETS_PROFILE);
  const evidence: QualificationReport = {
    kind: 'integration-qualification-report-v1', contextDigest: qualificationDigest(context), starts: 1, ends: 1,
    reason: 'passed', unhandledErrors: 0,
    specifications: [{ path: TYPED_BRACKETS_MODULE, pattern: TYPED_BRACKETS_PATTERN, otherFilters: false }],
    collected: [TYPED_BRACKETS_MODULE],
    hooks: ['beforeAll', 'afterAll'].map(name => ({ key: 'suite:' + name, starts: 1, ends: 1 })),
    modules: [{ path: TYPED_BRACKETS_MODULE, state: 'passed', errors: 0,
      suites: [{ id: 'suite', name: TYPED_BRACKETS_SUITE, mode: 'run', errors: 0 }],
      cases: TYPED_BRACKETS_FULL_NAMES.map((name, index) => ({ id: 'case-' + index, name, state: 'passed', mode: 'run',
        expectedFailure: false, configuredRetries: false, configuredRepeats: 0, errors: 0, readyEvents: 1, resultEvents: 1,
        diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }],
  };
  return { binding: { context, directory }, evidence };
}
it('binds the typed brackets profile to seven exact cases and original cleanup gates while full discovery includes its module', async () => {
  expect(parseQualificationArguments(['--profile=' + TYPED_BRACKETS_PROFILE])).toBe(TYPED_BRACKETS_PROFILE);
  expect(qualificationArguments(TYPED_BRACKETS_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', TYPED_BRACKETS_MODULE, '--testNamePattern', TYPED_BRACKETS_PATTERN]);
  for (const args of [
    ['--profile=data-typed-brackets-v2'], ['--profile', TYPED_BRACKETS_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + TYPED_BRACKETS_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + TYPED_BRACKETS_PROFILE, extra]),
  ]) expect(() => parseQualificationArguments(args)).toThrow('closed');
  const { binding, evidence } = await typedBracketsFixture();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationIncludes(env)).toEqual([TYPED_BRACKETS_MODULE]);
  expect(qualificationIncludes({})).toEqual(['integration/**/*.integration-case.ts']);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules.some(module => module.path === TYPED_BRACKETS_MODULE)).toBe(true);
  const older = await fixture(INGESTION_PROFILE);
  expect(older.context.modules.map(module => module.path)).toEqual([SELECTED_MODULE]);
  const regex = new RegExp(TYPED_BRACKETS_PATTERN);
  expect(TYPED_BRACKETS_FULL_NAMES).toHaveLength(7);
  for (const name of TYPED_BRACKETS_FULL_NAMES) {
    expect(regex.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(regex.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(regex.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect(SELECTED_INVENTORY.some(name => regex.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: TYPED_BRACKETS_PROFILE,
    collected: 7, executed: 7, passed: 7, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});
it('rejects incomplete typed brackets inventory, reordered execution, hook drift, retries and substituted profile evidence', async () => {
  const { binding, evidence } = await typedBracketsFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].cases[1].id = r.modules[0].cases[0].id; }, r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].ends = 0; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; },
  ];
  for (const change of changes) {
    const changed = structuredClone(evidence); change(changed);
    expect(() => validateQualificationReport(binding.context, changed)).toThrow();
  }
  const older = await fixture(INGESTION_PROFILE), oldReport = report(older);
  expect(() => validateQualificationReport(older.context, { ...evidence, contextDigest: qualificationDigest(older.context) })).toThrow();
  expect(() => validateQualificationReport(binding.context, { ...oldReport, contextDigest: qualificationDigest(binding.context) })).toThrow();
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, TYPED_BRACKETS_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), TYPED_BRACKETS_PROFILE))
    .rejects.toThrow('reviewed LF digest');
});
it('independently inventories the typed brackets SQL fixture source and hooks without importing its execution', async () => {
  const path = fileURLToPath(new URL('../' + TYPED_BRACKETS_MODULE, import.meta.url));
  const source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(TYPED_BRACKETS_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') {
        expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
        suites.push((node.arguments[0] as ts.StringLiteral).text);
      }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) hooks.push(expression);
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(suites).toEqual([TYPED_BRACKETS_SUITE]); expect(names).toEqual(TYPED_BRACKETS_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']);
});

async function bracketIntakeFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const directory = await mkdtemp(join(tmpdir(), 'bracket-intake-profile-')); directories.push(directory);
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)),
    'a'.repeat(40), randomUUID(), BRACKET_INTAKE_PROFILE);
  const evidence: QualificationReport = {
    kind: 'integration-qualification-report-v1', contextDigest: qualificationDigest(context), starts: 1, ends: 1,
    reason: 'passed', unhandledErrors: 0,
    specifications: [{ path: BRACKET_INTAKE_MODULE, pattern: BRACKET_INTAKE_PATTERN, otherFilters: false }],
    collected: [BRACKET_INTAKE_MODULE],
    hooks: ['beforeAll', 'afterAll'].map(name => ({ key: 'suite:' + name, starts: 1, ends: 1 })),
    modules: [{ path: BRACKET_INTAKE_MODULE, state: 'passed', errors: 0,
      suites: [{ id: 'suite', name: BRACKET_INTAKE_SUITE, mode: 'run', errors: 0 }],
      cases: BRACKET_INTAKE_FULL_NAMES.map((name, index) => ({ id: 'case-' + index, name, state: 'passed', mode: 'run',
        expectedFailure: false, configuredRetries: false, configuredRepeats: 0, errors: 0, readyEvents: 1, resultEvents: 1,
        diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }],
  };
  return { binding: { context, directory }, evidence };
}
it('binds the bracket intake profile to five exact cases and original cleanup gates while full discovery includes its module', async () => {
  expect(parseQualificationArguments(['--profile=' + BRACKET_INTAKE_PROFILE])).toBe(BRACKET_INTAKE_PROFILE);
  expect(qualificationArguments(BRACKET_INTAKE_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', BRACKET_INTAKE_MODULE, '--testNamePattern', BRACKET_INTAKE_PATTERN]);
  for (const args of [
    ['--profile=data-bracket-intake-v2'], ['--profile', BRACKET_INTAKE_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + BRACKET_INTAKE_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + BRACKET_INTAKE_PROFILE, extra]),
  ]) expect(() => parseQualificationArguments(args)).toThrow('closed');
  const { binding, evidence } = await bracketIntakeFixture();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationIncludes(env)).toEqual([BRACKET_INTAKE_MODULE]);
  expect(qualificationIncludes({})).toEqual(['integration/**/*.integration-case.ts']);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules.some(module => module.path === BRACKET_INTAKE_MODULE)).toBe(true);
  const older = await fixture(INGESTION_PROFILE);
  expect(older.context.modules.map(module => module.path)).toEqual([SELECTED_MODULE]);
  const regex = new RegExp(BRACKET_INTAKE_PATTERN);
  expect(BRACKET_INTAKE_FULL_NAMES).toHaveLength(5);
  for (const name of BRACKET_INTAKE_FULL_NAMES) {
    expect(regex.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(regex.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(regex.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect(SELECTED_INVENTORY.some(name => regex.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: BRACKET_INTAKE_PROFILE,
    collected: 5, executed: 5, passed: 5, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});
it('rejects incomplete bracket intake inventory, reordered execution, hook drift, retries and substituted profile evidence', async () => {
  const { binding, evidence } = await bracketIntakeFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].cases[1].id = r.modules[0].cases[0].id; }, r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].ends = 0; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; },
  ];
  for (const change of changes) {
    const changed = structuredClone(evidence); change(changed);
    expect(() => validateQualificationReport(binding.context, changed)).toThrow();
  }
  const older = await fixture(INGESTION_PROFILE), oldReport = report(older);
  expect(() => validateQualificationReport(older.context, { ...evidence, contextDigest: qualificationDigest(older.context) })).toThrow();
  expect(() => validateQualificationReport(binding.context, { ...oldReport, contextDigest: qualificationDigest(binding.context) })).toThrow();
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, BRACKET_INTAKE_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), BRACKET_INTAKE_PROFILE))
    .rejects.toThrow('reviewed LF digest');
});
it('independently inventories the bracket intake SQL fixture source and hooks without importing its execution', async () => {
  const path = fileURLToPath(new URL('../' + BRACKET_INTAKE_MODULE, import.meta.url));
  const source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(BRACKET_INTAKE_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [], budgets: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') {
        expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
        suites.push((node.arguments[0] as ts.StringLiteral).text);
      }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); budgets.push(node.arguments[2]?.getText(tree) ?? 'default'); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) hooks.push(expression);
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(suites).toEqual([BRACKET_INTAKE_SUITE]); expect(names).toEqual(BRACKET_INTAKE_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']);
  expect(budgets).toEqual(['60_000', '180_000', '18 * 60_000', '60_000', '60_000']);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow.match(/^\s+- data-bracket-intake-v1$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+workflow_dispatch:data-bracket-intake-v1\)$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+pnpm test:integration --profile=data-bracket-intake-v1$/gmu)).toHaveLength(1);
});

async function officialResultsFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const directory = await mkdtemp(join(tmpdir(), 'official-results-profile-')); directories.push(directory);
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)),
    'a'.repeat(40), randomUUID(), OFFICIAL_RESULTS_PROFILE);
  const evidence: QualificationReport = {
    kind: 'integration-qualification-report-v1', contextDigest: qualificationDigest(context), starts: 1, ends: 1,
    reason: 'passed', unhandledErrors: 0,
    specifications: [{ path: OFFICIAL_RESULTS_MODULE, pattern: OFFICIAL_RESULTS_PATTERN, otherFilters: false }],
    collected: [OFFICIAL_RESULTS_MODULE],
    hooks: ['beforeAll', 'afterAll'].map(name => ({ key: 'suite:' + name, starts: 1, ends: 1 })),
    modules: [{ path: OFFICIAL_RESULTS_MODULE, state: 'passed', errors: 0,
      suites: [{ id: 'suite', name: OFFICIAL_RESULTS_SUITE, mode: 'run', errors: 0 }],
      cases: OFFICIAL_RESULTS_FULL_NAMES.map((name, index) => ({ id: 'case-' + index, name, state: 'passed', mode: 'run',
        expectedFailure: false, configuredRetries: false, configuredRepeats: 0, errors: 0, readyEvents: 1, resultEvents: 1,
        diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }],
  };
  return { binding: { context, directory }, evidence };
}
it('binds the official results profile to eight exact cases and original cleanup gates while full discovery includes its module', async () => {
  expect(parseQualificationArguments(['--profile=' + OFFICIAL_RESULTS_PROFILE])).toBe(OFFICIAL_RESULTS_PROFILE);
  expect(qualificationArguments(OFFICIAL_RESULTS_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', OFFICIAL_RESULTS_MODULE, '--testNamePattern', OFFICIAL_RESULTS_PATTERN]);
  for (const args of [
    ['--profile=data-official-results-v2'], ['--profile', OFFICIAL_RESULTS_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + OFFICIAL_RESULTS_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + OFFICIAL_RESULTS_PROFILE, extra]),
  ]) expect(() => parseQualificationArguments(args)).toThrow('closed');
  const { binding, evidence } = await officialResultsFixture();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationIncludes(env)).toEqual([OFFICIAL_RESULTS_MODULE]);
  expect(qualificationIncludes({})).toEqual(['integration/**/*.integration-case.ts']);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules.some(module => module.path === OFFICIAL_RESULTS_MODULE)).toBe(true);
  const older = await fixture(INGESTION_PROFILE);
  expect(older.context.modules.map(module => module.path)).toEqual([SELECTED_MODULE]);
  const regex = new RegExp(OFFICIAL_RESULTS_PATTERN);
  expect(OFFICIAL_RESULTS_FULL_NAMES).toHaveLength(8);
  for (const name of OFFICIAL_RESULTS_FULL_NAMES) {
    expect(regex.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(regex.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(regex.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect(SELECTED_INVENTORY.some(name => regex.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: OFFICIAL_RESULTS_PROFILE,
    collected: 8, executed: 8, passed: 8, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});
it('rejects incomplete official results inventory, reordered execution, hook drift, retries and substituted profile evidence', async () => {
  const { binding, evidence } = await officialResultsFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].cases[1].id = r.modules[0].cases[0].id; }, r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].ends = 0; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; },
  ];
  for (const change of changes) {
    const changed = structuredClone(evidence); change(changed);
    expect(() => validateQualificationReport(binding.context, changed)).toThrow();
  }
  const older = await fixture(INGESTION_PROFILE), oldReport = report(older);
  expect(() => validateQualificationReport(older.context, { ...evidence, contextDigest: qualificationDigest(older.context) })).toThrow();
  expect(() => validateQualificationReport(binding.context, { ...oldReport, contextDigest: qualificationDigest(binding.context) })).toThrow();
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, OFFICIAL_RESULTS_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), OFFICIAL_RESULTS_PROFILE))
    .rejects.toThrow('reviewed LF digest');
});
it('independently inventories the official results SQL fixture source and hooks without importing its execution', async () => {
  const path = fileURLToPath(new URL('../' + OFFICIAL_RESULTS_MODULE, import.meta.url));
  const source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(OFFICIAL_RESULTS_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [], budgets: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') {
        expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
        suites.push((node.arguments[0] as ts.StringLiteral).text);
      }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); budgets.push(node.arguments[2]?.getText(tree) ?? 'default'); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) hooks.push(expression);
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(suites).toEqual([OFFICIAL_RESULTS_SUITE]); expect(names).toEqual(OFFICIAL_RESULTS_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']);
  expect(budgets.slice(0, 7)).toEqual(Array(7).fill('60_000'));
  expect(['18 * 60_000', '1_080_000', '1080_000', '1080000']).toContain(budgets[7]);
  expect(budgets).toHaveLength(8);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow.match(/^\s+- data-official-results-v1$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+workflow_dispatch:data-official-results-v1\)$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+pnpm test:integration --profile=data-official-results-v1$/gmu)).toHaveLength(1);
});

async function officialResultsEvidenceFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const directory = await mkdtemp(join(tmpdir(), 'official-results-evidence-profile-')); directories.push(directory);
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)),
    'a'.repeat(40), randomUUID(), OFFICIAL_RESULTS_EVIDENCE_PROFILE);
  const evidence: QualificationReport = {
    kind: 'integration-qualification-report-v1', contextDigest: qualificationDigest(context), starts: 1, ends: 1,
    reason: 'passed', unhandledErrors: 0,
    specifications: [{ path: OFFICIAL_RESULTS_EVIDENCE_MODULE, pattern: OFFICIAL_RESULTS_EVIDENCE_PATTERN, otherFilters: false }],
    collected: [OFFICIAL_RESULTS_EVIDENCE_MODULE],
    hooks: ['beforeAll', 'afterAll'].map(name => ({ key: 'suite:' + name, starts: 1, ends: 1 })),
    modules: [{ path: OFFICIAL_RESULTS_EVIDENCE_MODULE, state: 'passed', errors: 0,
      suites: [{ id: 'suite', name: OFFICIAL_RESULTS_EVIDENCE_SUITE, mode: 'run', errors: 0 }],
      cases: OFFICIAL_RESULTS_EVIDENCE_FULL_NAMES.map((name, index) => ({ id: 'case-' + index, name, state: 'passed', mode: 'run',
        expectedFailure: false, configuredRetries: false, configuredRepeats: 0, errors: 0, readyEvents: 1, resultEvents: 1,
        diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }],
  };
  return { binding: { context, directory }, evidence };
}
it('binds the official results evidence profile to two exact cases and original cleanup gates while full discovery includes its module', async () => {
  expect(parseQualificationArguments(['--profile=' + OFFICIAL_RESULTS_EVIDENCE_PROFILE])).toBe(OFFICIAL_RESULTS_EVIDENCE_PROFILE);
  expect(qualificationArguments(OFFICIAL_RESULTS_EVIDENCE_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', OFFICIAL_RESULTS_EVIDENCE_MODULE, '--testNamePattern', OFFICIAL_RESULTS_EVIDENCE_PATTERN]);
  for (const args of [
    ['--profile=data-official-results-evidence-v2'], ['--profile', OFFICIAL_RESULTS_EVIDENCE_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + OFFICIAL_RESULTS_EVIDENCE_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + OFFICIAL_RESULTS_EVIDENCE_PROFILE, extra]),
  ]) expect(() => parseQualificationArguments(args)).toThrow('closed');
  const { binding, evidence } = await officialResultsEvidenceFixture();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationIncludes(env)).toEqual([OFFICIAL_RESULTS_EVIDENCE_MODULE]);
  expect(qualificationIncludes({})).toEqual(['integration/**/*.integration-case.ts']);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  // Preserve the prior 57 standard modules and both separately pinned CP13 additions.
  const previousModules = [
    'integration/account-enrollment.integration-case.ts',
    'integration/account-foundation.integration-case.ts',
    'integration/account-store.integration-case.ts',
    'integration/all-player-alias-repair.integration-case.ts',
    'integration/all-player-hourly-collection.integration-case.ts',
    'integration/all-player-league-acceptance.integration-case.ts',
    'integration/all-player-metrics.integration-case.ts',
    'integration/all-player-participation-assumption.integration-case.ts',
    'integration/all-player-pregame-empty.integration-case.ts',
    'integration/all-player-provider-participation.integration-case.ts',
    'integration/all-player-statistics.integration-case.ts',
    'integration/all-player-team-drift.integration-case.ts',
    'integration/b3-function-security.integration-case.ts',
    'integration/b3-legacy-compatibility.integration-case.ts',
    'integration/b3-write-guards.integration-case.ts',
    'integration/bracket-intake.integration-case.ts',
    'integration/bundle-four.integration-case.ts',
    'integration/bundle-two.integration-case.ts',
    'integration/calculation-source-history.integration-case.ts',
    'integration/current-roster-acceptance.integration-case.ts',
    'integration/exact-matchup-compatibility.integration-case.ts',
    'integration/exact-matchup-values.integration-case.ts',
    'integration/exact-matchups.integration-case.ts',
    'integration/future-distance.integration-case.ts',
    'integration/future-probability-refresh.integration-case.ts',
    'integration/league-administration.integration-case.ts',
    'integration/league-settings.integration-case.ts',
    'integration/lineup-authority.integration-case.ts',
    'integration/lineup-lineage.integration-case.ts',
    'integration/lineup-observer-worker.integration-case.ts',
    'integration/lineup-reservation.integration-case.ts',
    'integration/lineup-watch.integration-case.ts',
    'integration/live-box-scores.integration-case.ts',
    'integration/live-defense-publication.integration-case.ts',
    'integration/live-defense-reader.integration-case.ts',
    'integration/live-defense-weekly-statistics.integration-case.ts',
    'integration/matchup-revision.integration-case.ts',
    'integration/official-results.integration-case.ts',
    'integration/period-inventory.integration-case.ts',
    'integration/period-mapping.integration-case.ts',
    'integration/period-settings-context.integration-case.ts',
    'integration/player-directory.integration-case.ts',
    'integration/projection-slate-recovery.integration-case.ts',
    'integration/projection-store.integration-case.ts',
    'integration/public-data-intake.integration-case.ts',
    'integration/reset-session-revocation.integration-case.ts',
    'integration/retained-matchup-comparison.integration-case.ts',
    'integration/roster-player-links.integration-case.ts',
    'integration/scoring-event-coverage.integration-case.ts',
    'integration/source-mapping-upgrade.integration-case.ts',
    'integration/source-mapping.integration-case.ts',
    'integration/team-lineup-availability.integration-case.ts',
    'integration/team-manager-facts.integration-case.ts',
    'integration/team-manager-relationships.integration-case.ts',
    'integration/transactions.integration-case.ts',
    'integration/typed-brackets.integration-case.ts',
    'integration/website-auth.integration-case.ts',
  ];
  expect(full.modules.map(module => module.path)).toEqual([...previousModules, WITHIN_SEASON_HISTORY_MODULE, DRAFT_INTAKE_MODULE, DRAFT_REFRESH_MODULE, DRAFT_INTAKE_RECOVERY_MODULE, TRADED_PICKS_MODULE, DRAFT_SELECTIONS_MODULE, DRAFT_METADATA_MODULE, OFFICIAL_RESULTS_EVIDENCE_MODULE, WEEKLY_REPORTS_MODULE, TRANSACTION_PERIOD_INTAKE_MODULE, TRANSACTION_HISTORY_INTAKE_MODULE, TRANSACTION_HISTORY_REFRESH_MODULE, TRANSACTION_HISTORY_RECOVERY_MODULE].sort());
  expect(full.modules).toHaveLength(70);
  expect(full.modules.some(module => module.path.endsWith('.live-integration-case.ts'))).toBe(false);
  const original = await officialResultsFixture();
  expect(OFFICIAL_RESULTS_SOURCE_DIGEST).toBe('592d00ae4f076bddfef63202aebe4bae128ddd9d4fab34f490f666c34f0d2479');
  expect(original.binding.context.modules).toEqual([{ path: OFFICIAL_RESULTS_MODULE, sourceDigest: OFFICIAL_RESULTS_SOURCE_DIGEST }]);
  expect(original.binding.context.profileDigest).not.toBe(binding.context.profileDigest);
  expect(qualificationArguments(OFFICIAL_RESULTS_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', OFFICIAL_RESULTS_MODULE, '--testNamePattern', OFFICIAL_RESULTS_PATTERN]);
  expect(qualificationIncludes({ ...env, [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(original.binding.context) })).toEqual([OFFICIAL_RESULTS_MODULE]);
  expect(OFFICIAL_RESULTS_FULL_NAMES).toHaveLength(8);
  const originalPattern = new RegExp(OFFICIAL_RESULTS_PATTERN);
  expect(OFFICIAL_RESULTS_EVIDENCE_FULL_NAMES.every(name => !originalPattern.test(name.replaceAll(' > ', ' ')))).toBe(true);
  const older = await fixture(INGESTION_PROFILE);
  expect(older.context.modules.map(module => module.path)).toEqual([SELECTED_MODULE]);
  const regex = new RegExp(OFFICIAL_RESULTS_EVIDENCE_PATTERN);
  expect(OFFICIAL_RESULTS_EVIDENCE_FULL_NAMES).toHaveLength(2);
  for (const name of OFFICIAL_RESULTS_EVIDENCE_FULL_NAMES) {
    expect(regex.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(regex.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(regex.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect([...SELECTED_INVENTORY, ...OFFICIAL_RESULTS_FULL_NAMES].some(name => regex.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: OFFICIAL_RESULTS_EVIDENCE_PROFILE,
    collected: 2, executed: 2, passed: 2, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});
it('rejects incomplete official results evidence inventory, reordered execution, hook drift, retries and substituted profile evidence', async () => {
  const { binding, evidence } = await officialResultsEvidenceFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].cases[1].id = r.modules[0].cases[0].id; }, r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].ends = 0; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; }, r => { r.reason = 'failed'; },
    r => { r.starts = 2; }, r => { r.ends = 0; }, r => { r.contextDigest = 'f'.repeat(64); },
    r => { r.modules[0].state = 'failed'; }, r => { r.modules[0].errors = 1; },
    r => { r.modules[0].cases[0].state = 'failed'; }, r => { r.modules[0].cases[0].mode = 'todo'; },
    r => { r.modules[0].cases[0].errors = 1; }, r => { r.modules[0].cases[0].diagnostic!.flaky = true; },
    r => { r.modules[0].cases[0].diagnostic!.duration = -1; }, r => { r.modules[0].cases[0].diagnostic!.startTime = 0; },
    r => { r.modules[0].suites[0].errors = 1; }, r => { r.modules[0].suites[0].id = r.modules[0].cases[0].id; },
    r => { r.collected.push(OFFICIAL_RESULTS_MODULE); }, r => { r.modules.push(structuredClone(r.modules[0])); },
    r => { r.specifications.push({ ...r.specifications[0] }); },
    r => { r.hooks.push({ ...r.hooks[0] }); }, r => { r.hooks[0].key = 'suite:beforeEach'; },
    r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'older-filtered', name: OFFICIAL_RESULTS_FULL_NAMES[0],
      state: 'skipped', mode: 'skip', diagnostic: null }); },
  ];
  for (const change of changes) {
    const changed = structuredClone(evidence); change(changed);
    expect(() => validateQualificationReport(binding.context, changed)).toThrow();
  }
  const older = await fixture(INGESTION_PROFILE), oldReport = report(older);
  expect(() => validateQualificationReport(older.context, { ...evidence, contextDigest: qualificationDigest(older.context) })).toThrow();
  expect(() => validateQualificationReport(binding.context, { ...oldReport, contextDigest: qualificationDigest(binding.context) })).toThrow();
  const original = await officialResultsFixture();
  expect(() => validateQualificationReport(original.binding.context, { ...evidence,
    contextDigest: qualificationDigest(original.binding.context) })).toThrow();
  expect(() => validateQualificationReport(binding.context, { ...original.evidence,
    contextDigest: qualificationDigest(binding.context) })).toThrow();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  for (const change of [
    (context: typeof binding.context) => { context.modules[0].sourceDigest = 'f'.repeat(64); },
    (context: typeof binding.context) => { context.modules[0].path = OFFICIAL_RESULTS_MODULE; },
    (context: typeof binding.context) => { context.profileDigest = original.binding.context.profileDigest; },
    (context: typeof binding.context) => { context.modules.push({ ...context.modules[0] }); },
  ]) {
    const context = structuredClone(binding.context); change(context);
    expect(() => qualificationBinding({ ...env, [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context) })).toThrow();
  }
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, OFFICIAL_RESULTS_EVIDENCE_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), OFFICIAL_RESULTS_EVIDENCE_PROFILE))
    .rejects.toThrow('reviewed LF digest');
});
it('independently inventories the official results evidence SQL fixture source and hooks without importing its execution', async () => {
  const path = fileURLToPath(new URL('../' + OFFICIAL_RESULTS_EVIDENCE_MODULE, import.meta.url));
  const source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(OFFICIAL_RESULTS_EVIDENCE_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [], budgets: string[] = [], hookBudgets: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') {
        expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
        suites.push((node.arguments[0] as ts.StringLiteral).text);
      }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); budgets.push(node.arguments[2]?.getText(tree) ?? 'default'); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) {
        hooks.push(expression); hookBudgets.push(node.arguments[1]?.getText(tree) ?? 'default');
      }
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(suites).toEqual([OFFICIAL_RESULTS_EVIDENCE_SUITE]); expect(names).toEqual(OFFICIAL_RESULTS_EVIDENCE_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']);
  expect(budgets).toEqual(['60_000', '1_080_000']);
  expect(hookBudgets).toEqual(['120_000', '120_000']);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow.match(/^\s+- data-official-results-evidence-v1$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+workflow_dispatch:data-official-results-evidence-v1\)$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+pnpm test:integration --profile=data-official-results-evidence-v1$/gmu)).toHaveLength(1);
});

async function weeklyReportsFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const previous = await officialResultsEvidenceFixture();
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), WEEKLY_REPORTS_PROFILE);
  const evidence = structuredClone(previous.evidence);
  evidence.contextDigest = qualificationDigest(context);
  evidence.specifications = [{ path: WEEKLY_REPORTS_MODULE, pattern: WEEKLY_REPORTS_PATTERN, otherFilters: false }];
  evidence.collected = [WEEKLY_REPORTS_MODULE];
  evidence.modules = [{ ...evidence.modules[0], path: WEEKLY_REPORTS_MODULE,
    suites: [{ id: 'suite', name: WEEKLY_REPORTS_SUITE, mode: 'run', errors: 0 }],
    cases: WEEKLY_REPORTS_FULL_NAMES.map((name, index) => ({ ...previous.evidence.modules[0].cases[0], id: 'case-' + index, name,
      diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }];
  return { binding: { context, directory: previous.binding.directory }, evidence };
}
it('binds the weekly reports profile to eight exact source ordered cases and unchanged cleanup requirements', async () => {
  expect(parseQualificationArguments(['--profile=' + WEEKLY_REPORTS_PROFILE])).toBe(WEEKLY_REPORTS_PROFILE);
  expect(qualificationArguments(WEEKLY_REPORTS_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', WEEKLY_REPORTS_MODULE, '--testNamePattern', WEEKLY_REPORTS_PATTERN]);
  for (const args of [['--profile=data-weekly-reports-v2'], ['--profile', WEEKLY_REPORTS_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + WEEKLY_REPORTS_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + WEEKLY_REPORTS_PROFILE, extra])])
    expect(() => parseQualificationArguments(args)).toThrow('closed');
  const { binding, evidence } = await weeklyReportsFixture();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationIncludes(env)).toEqual([WEEKLY_REPORTS_MODULE]);
  expect(WEEKLY_REPORTS_FULL_NAMES).toHaveLength(8);
  const pattern = new RegExp(WEEKLY_REPORTS_PATTERN);
  for (const name of WEEKLY_REPORTS_FULL_NAMES) {
    expect(pattern.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect([...OFFICIAL_RESULTS_FULL_NAMES, ...OFFICIAL_RESULTS_EVIDENCE_FULL_NAMES].some(name => pattern.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence); await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: WEEKLY_REPORTS_PROFILE, collected: 8, executed: 8, passed: 8, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout'); await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
  expect(OFFICIAL_RESULTS_SOURCE_DIGEST).toBe('592d00ae4f076bddfef63202aebe4bae128ddd9d4fab34f490f666c34f0d2479');
  expect(OFFICIAL_RESULTS_EVIDENCE_SOURCE_DIGEST).toBe('342f44ca993a2c442f2ffb0075ffb47f8713243e7b5a5d203ac09ffb0598e8ae');
});
it('rejects report profile inventory hook retry source substitution and cleanup evidence drift', async () => {
  const { binding, evidence } = await weeklyReportsFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].cases[1].id = r.modules[0].cases[0].id; }, r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; }, r => { r.hooks[0].ends = 0; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].key = 'suite:beforeEach'; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; }, r => { r.reason = 'failed'; }, r => { r.starts = 2; }, r => { r.ends = 0; },
    r => { r.contextDigest = 'f'.repeat(64); }, r => { r.modules[0].state = 'failed'; }, r => { r.modules[0].errors = 1; },
    r => { r.modules[0].cases[0].diagnostic!.flaky = true; }, r => { r.collected.push(OFFICIAL_RESULTS_MODULE); },
  ];
  for (const change of changes) { const changed = structuredClone(evidence); change(changed); expect(() => validateQualificationReport(binding.context, changed)).toThrow(); }
  const original = await officialResultsEvidenceFixture();
  expect(() => validateQualificationReport(original.binding.context, { ...evidence, contextDigest: qualificationDigest(original.binding.context) })).toThrow();
  expect(() => validateQualificationReport(binding.context, { ...original.evidence, contextDigest: qualificationDigest(binding.context) })).toThrow();
  for (const change of [(context: typeof binding.context) => { context.modules[0].sourceDigest = 'f'.repeat(64); },
    (context: typeof binding.context) => { context.modules[0].path = OFFICIAL_RESULTS_MODULE; },
    (context: typeof binding.context) => { context.profileDigest = original.binding.context.profileDigest; },
    (context: typeof binding.context) => { context.modules.push({ ...context.modules[0] }); }]) {
    const context = structuredClone(binding.context); change(context);
    expect(() => qualificationBinding({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toThrow();
  }
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, WEEKLY_REPORTS_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), WEEKLY_REPORTS_PROFILE)).rejects.toThrow('reviewed LF digest');
});
it('independently inventories report candidate source hooks budgets and manual workflow without importing SQL execution', async () => {
  const path = fileURLToPath(new URL('../' + WEEKLY_REPORTS_MODULE, import.meta.url)), source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(WEEKLY_REPORTS_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [], budgets: string[] = [], hookBudgets: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); suites.push((node.arguments[0] as ts.StringLiteral).text); }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); budgets.push(node.arguments[2]?.getText(tree) ?? 'default'); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) { hooks.push(expression); hookBudgets.push(node.arguments[1]?.getText(tree) ?? 'default'); }
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(suites).toEqual([WEEKLY_REPORTS_SUITE]); expect(names).toEqual(WEEKLY_REPORTS_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']); expect(budgets).toEqual([...Array<string>(7).fill('60_000'), '1_080_000']); expect(hookBudgets).toEqual(['120_000', '120_000']);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow.match(/^\s+- data-weekly-reports-v1$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+workflow_dispatch:data-weekly-reports-v1\)$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+pnpm test:integration --profile=data-weekly-reports-v1$/gmu)).toHaveLength(1);
});


async function officialResultsPlayedFixture() {
  const { binding, evidence } = await officialResultsFixture();
  binding.context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)),
    'a'.repeat(40), randomUUID(), OFFICIAL_RESULTS_PLAYED_PROFILE);
  evidence.contextDigest = qualificationDigest(binding.context);
  evidence.specifications[0].pattern = OFFICIAL_RESULTS_PLAYED_PATTERN;
  for (const test of evidence.modules[0].cases.slice(0, 6)) {
    test.state = 'skipped'; test.mode = 'skip'; test.diagnostic = null;
  }
  return { binding, evidence };
}
it('qualifies only the two existing stored played-result cases with six honestly filtered cases', async () => {
  expect(parseQualificationArguments(['--profile=' + OFFICIAL_RESULTS_PLAYED_PROFILE])).toBe(OFFICIAL_RESULTS_PLAYED_PROFILE);
  expect(qualificationArguments(OFFICIAL_RESULTS_PLAYED_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', OFFICIAL_RESULTS_MODULE, '--testNamePattern', OFFICIAL_RESULTS_PLAYED_PATTERN]);
  const { binding, evidence } = await officialResultsPlayedFixture();
  expect(binding.context.modules).toEqual([{ path: OFFICIAL_RESULTS_MODULE, sourceDigest: OFFICIAL_RESULTS_SOURCE_DIGEST }]);
  expect(qualificationIncludes({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context),
    PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toEqual([OFFICIAL_RESULTS_MODULE]);
  expect(OFFICIAL_RESULTS_PLAYED_FULL_NAMES).toEqual(OFFICIAL_RESULTS_FULL_NAMES.slice(6));
  const pattern = new RegExp(OFFICIAL_RESULTS_PLAYED_PATTERN);
  for (const [index, name] of OFFICIAL_RESULTS_FULL_NAMES.entries()) {
    expect(pattern.test(name.replaceAll(' > ', ' '))).toBe(index >= 6);
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: OFFICIAL_RESULTS_PLAYED_PROFILE,
    collected: 8, executed: 2, passed: 2, skipped: 6, filtered: 6 });
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});
it('rejects missing played-result executions, extra execution, altered inventory, hooks and source binding', async () => {
  const { binding, evidence } = await officialResultsPlayedFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases.reverse(); },
    r => { r.modules[0].cases[7].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases[6].state = 'skipped'; }, r => { r.modules[0].cases[7].diagnostic = null; },
    r => { r.modules[0].cases[6].configuredRetries = true; },
    r => { r.modules[0].cases[7].configuredRepeats = 1; },
    r => { r.modules[0].cases[6].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[7].diagnostic!.flaky = true; },
    r => { r.modules[0].cases[0].diagnostic = { ...r.modules[0].cases[6].diagnostic! }; },
    r => { r.modules[0].cases[0].state = 'passed'; r.modules[0].cases[0].mode = 'run'; },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; },
    r => { r.modules[0].suites[0].mode = 'skip'; },
    r => { r.specifications[0].pattern = OFFICIAL_RESULTS_PATTERN; },
    r => { r.specifications[0].otherFilters = true; }, r => { r.unhandledErrors = 1; },
  ];
  for (const change of changes) {
    const changed = structuredClone(evidence); change(changed);
    expect(() => validateQualificationReport(binding.context, changed)).toThrow();
  }
  const changedContext = structuredClone(binding.context); changedContext.modules[0].sourceDigest = 'f'.repeat(64);
  expect(() => validateQualificationReport(changedContext, { ...evidence, contextDigest: qualificationDigest(changedContext) })).toThrow();
  const fullProfile = await officialResultsFixture();
  expect(() => validateQualificationReport(fullProfile.binding.context,
    { ...evidence, contextDigest: qualificationDigest(fullProfile.binding.context) })).toThrow();
  for (const args of [['--profile=data-official-results-played-v2'], ['--profile', OFFICIAL_RESULTS_PLAYED_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other',
      '--profile=' + OFFICIAL_RESULTS_PROFILE].map(extra => ['--profile=' + OFFICIAL_RESULTS_PLAYED_PROFILE, extra])]) {
    expect(() => parseQualificationArguments(args)).toThrow('closed');
  }
});
it('keeps the played-result selection on the unchanged SQL fixture and fixed manual workflow arm', async () => {
  const source = await readFile(new URL('../' + OFFICIAL_RESULTS_MODULE, import.meta.url), 'utf8');
  expect(qualificationSourceDigest(source)).toBe(OFFICIAL_RESULTS_SOURCE_DIGEST);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow.split('          - data-official-results-played-v1')).toHaveLength(2);
  expect(workflow.split('workflow_dispatch:data-official-results-played-v1)')).toHaveLength(2);
  expect(workflow.split('pnpm test:integration --profile=data-official-results-played-v1')).toHaveLength(2);
  expect(qualificationIncludes({})).toEqual(['integration/**/*.integration-case.ts']);
});

async function transactionPeriodIntakeFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const previous = await officialResultsEvidenceFixture();
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), TRANSACTION_PERIOD_INTAKE_PROFILE);
  const evidence = structuredClone(previous.evidence);
  evidence.contextDigest = qualificationDigest(context);
  evidence.specifications = [{ path: TRANSACTION_PERIOD_INTAKE_MODULE, pattern: TRANSACTION_PERIOD_INTAKE_PATTERN, otherFilters: false }];
  evidence.collected = [TRANSACTION_PERIOD_INTAKE_MODULE];
  evidence.modules = [{ ...evidence.modules[0], path: TRANSACTION_PERIOD_INTAKE_MODULE,
    suites: [{ id: 'suite', name: TRANSACTION_PERIOD_INTAKE_SUITE, mode: 'run', errors: 0 }],
    cases: TRANSACTION_PERIOD_INTAKE_FULL_NAMES.map((name, index) => ({ ...previous.evidence.modules[0].cases[0], id: 'case-' + index, name,
      diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }];
  return { binding: { context, directory: previous.binding.directory }, evidence };
}
it('binds the transaction period intake profile to three exact source ordered cases and unchanged cleanup requirements', async () => {
  expect(parseQualificationArguments(['--profile=' + TRANSACTION_PERIOD_INTAKE_PROFILE])).toBe(TRANSACTION_PERIOD_INTAKE_PROFILE);
  expect(qualificationArguments(TRANSACTION_PERIOD_INTAKE_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', TRANSACTION_PERIOD_INTAKE_MODULE, '--testNamePattern', TRANSACTION_PERIOD_INTAKE_PATTERN]);
  for (const args of [['--profile=data-transaction-period-intake-v2'], ['--profile', TRANSACTION_PERIOD_INTAKE_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + TRANSACTION_PERIOD_INTAKE_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + TRANSACTION_PERIOD_INTAKE_PROFILE, extra])])
    expect(() => parseQualificationArguments(args)).toThrow('closed');
  const { binding, evidence } = await transactionPeriodIntakeFixture();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationIncludes(env)).toEqual([TRANSACTION_PERIOD_INTAKE_MODULE]);
  expect(TRANSACTION_PERIOD_INTAKE_FULL_NAMES).toHaveLength(3);
  const pattern = new RegExp(TRANSACTION_PERIOD_INTAKE_PATTERN);
  for (const name of TRANSACTION_PERIOD_INTAKE_FULL_NAMES) {
    expect(pattern.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect([...OFFICIAL_RESULTS_FULL_NAMES, ...OFFICIAL_RESULTS_EVIDENCE_FULL_NAMES].some(name => pattern.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence); await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: TRANSACTION_PERIOD_INTAKE_PROFILE, collected: 3, executed: 3, passed: 3, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout'); await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
  expect(OFFICIAL_RESULTS_SOURCE_DIGEST).toBe('592d00ae4f076bddfef63202aebe4bae128ddd9d4fab34f490f666c34f0d2479');
  expect(OFFICIAL_RESULTS_EVIDENCE_SOURCE_DIGEST).toBe('342f44ca993a2c442f2ffb0075ffb47f8713243e7b5a5d203ac09ffb0598e8ae');
});
it('rejects transaction period intake profile inventory hook retry source substitution and cleanup evidence drift', async () => {
  const { binding, evidence } = await transactionPeriodIntakeFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].cases[1].id = r.modules[0].cases[0].id; }, r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; }, r => { r.hooks[0].ends = 0; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].key = 'suite:beforeEach'; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; }, r => { r.reason = 'failed'; }, r => { r.starts = 2; }, r => { r.ends = 0; },
    r => { r.contextDigest = 'f'.repeat(64); }, r => { r.modules[0].state = 'failed'; }, r => { r.modules[0].errors = 1; },
    r => { r.modules[0].cases[0].diagnostic!.flaky = true; }, r => { r.collected.push(OFFICIAL_RESULTS_MODULE); },
  ];
  for (const change of changes) { const changed = structuredClone(evidence); change(changed); expect(() => validateQualificationReport(binding.context, changed)).toThrow(); }
  const original = await officialResultsEvidenceFixture();
  expect(() => validateQualificationReport(original.binding.context, { ...evidence, contextDigest: qualificationDigest(original.binding.context) })).toThrow();
  expect(() => validateQualificationReport(binding.context, { ...original.evidence, contextDigest: qualificationDigest(binding.context) })).toThrow();
  for (const change of [(context: typeof binding.context) => { context.modules[0].sourceDigest = 'f'.repeat(64); },
    (context: typeof binding.context) => { context.modules[0].path = OFFICIAL_RESULTS_MODULE; },
    (context: typeof binding.context) => { context.profileDigest = original.binding.context.profileDigest; },
    (context: typeof binding.context) => { context.modules.push({ ...context.modules[0] }); }]) {
    const context = structuredClone(binding.context); change(context);
    expect(() => qualificationBinding({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toThrow();
  }
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, TRANSACTION_PERIOD_INTAKE_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), TRANSACTION_PERIOD_INTAKE_PROFILE)).rejects.toThrow('reviewed LF digest');
});
it('independently inventories transaction period intake source hooks budgets and manual workflow without importing SQL execution', async () => {
  const path = fileURLToPath(new URL('../' + TRANSACTION_PERIOD_INTAKE_MODULE, import.meta.url)), source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(TRANSACTION_PERIOD_INTAKE_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [], budgets: string[] = [], hookBudgets: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); suites.push((node.arguments[0] as ts.StringLiteral).text); }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); budgets.push(node.arguments[2]?.getText(tree) ?? 'default'); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) { hooks.push(expression); hookBudgets.push(node.arguments[1]?.getText(tree) ?? 'default'); }
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(suites).toEqual([TRANSACTION_PERIOD_INTAKE_SUITE]); expect(names).toEqual(TRANSACTION_PERIOD_INTAKE_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']); expect(budgets).toEqual(['60_000', '720_000', '120_000']); expect(hookBudgets).toEqual(['120_000', '120_000']);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow.match(/^\s+- data-transaction-period-intake-v1$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+workflow_dispatch:data-transaction-period-intake-v1\)$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+pnpm test:integration --profile=data-transaction-period-intake-v1$/gmu)).toHaveLength(1);
});

const historyProfiles = [
  { profile: TRANSACTION_HISTORY_INTAKE_PROFILE, module: TRANSACTION_HISTORY_INTAKE_MODULE, digest: TRANSACTION_HISTORY_INTAKE_SOURCE_DIGEST,
    suite: TRANSACTION_HISTORY_INTAKE_SUITE, names: TRANSACTION_HISTORY_INTAKE_FULL_NAMES, tests: TRANSACTION_HISTORY_INTAKE_TESTS, pattern: TRANSACTION_HISTORY_INTAKE_PATTERN },
  { profile: TRANSACTION_HISTORY_REFRESH_PROFILE, module: TRANSACTION_HISTORY_REFRESH_MODULE, digest: TRANSACTION_HISTORY_REFRESH_SOURCE_DIGEST,
    suite: TRANSACTION_HISTORY_REFRESH_SUITE, names: TRANSACTION_HISTORY_REFRESH_FULL_NAMES, tests: TRANSACTION_HISTORY_REFRESH_TESTS, pattern: TRANSACTION_HISTORY_REFRESH_PATTERN },
  { profile: TRANSACTION_HISTORY_RECOVERY_PROFILE, module: TRANSACTION_HISTORY_RECOVERY_MODULE, digest: TRANSACTION_HISTORY_RECOVERY_SOURCE_DIGEST,
    suite: TRANSACTION_HISTORY_RECOVERY_SUITE, names: TRANSACTION_HISTORY_RECOVERY_FULL_NAMES, tests: TRANSACTION_HISTORY_RECOVERY_TESTS, pattern: TRANSACTION_HISTORY_RECOVERY_PATTERN },
] as const;
async function transactionHistoryFixture(selection: typeof historyProfiles[number]): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const previous = await officialResultsEvidenceFixture();
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), selection.profile);
  const evidence = structuredClone(previous.evidence);
  evidence.contextDigest = qualificationDigest(context);
  evidence.specifications = [{ path: selection.module, pattern: selection.pattern, otherFilters: false }];
  evidence.collected = [selection.module];
  evidence.modules = [{ ...evidence.modules[0], path: selection.module,
    suites: [{ id: 'suite', name: selection.suite, mode: 'run', errors: 0 }],
    cases: selection.names.map((name, index) => ({ ...previous.evidence.modules[0].cases[0], id: 'case-' + index, name,
      diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }];
  return { binding: { context, directory: previous.binding.directory }, evidence };
}
it.each(historyProfiles)('binds $profile to its sole case module and exactly two hooks with acknowledged cleanup', async selection => {
  expect(parseQualificationArguments(['--profile=' + selection.profile])).toBe(selection.profile);
  expect(qualificationArguments(selection.profile, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', selection.module, '--testNamePattern', selection.pattern]);
  const { binding, evidence } = await transactionHistoryFixture(selection);
  expect(binding.context.modules).toEqual([{ path: selection.module, sourceDigest: selection.digest }]);
  expect(qualificationIncludes({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context),
    PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toEqual([selection.module]);
  expect(selection.names).toHaveLength(1);
  const pattern = new RegExp(selection.pattern);
  for (const name of selection.names) {
    expect(pattern.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  for (const other of historyProfiles.filter(value => value.profile !== selection.profile))
    expect(other.names.some(name => pattern.test(name.replaceAll(' > ', ' ')))).toBe(false);
  expect(TRANSACTION_PERIOD_INTAKE_FULL_NAMES.some(name => pattern.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence); await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: selection.profile, collected: 1, executed: 1, passed: 1, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout'); await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
  for (const args of [['--profile=' + selection.profile.replace('-v1', '-v2')], ['--profile', selection.profile],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + selection.profile, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + selection.profile, extra])])
    expect(() => parseQualificationArguments(args)).toThrow('closed');
});
it.each(historyProfiles)('rejects $profile altered inventory execution hooks and substituted source evidence', async selection => {
  const { binding, evidence } = await transactionHistoryFixture(selection);
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases[0].name += ' extra'; },
    r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].suites = []; }, r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; }, r => { r.hooks[0].ends = 0; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].key = 'suite:beforeEach'; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; }, r => { r.reason = 'failed'; }, r => { r.starts = 2; }, r => { r.ends = 0; },
    r => { r.contextDigest = 'f'.repeat(64); }, r => { r.modules[0].state = 'failed'; }, r => { r.modules[0].errors = 1; },
    r => { r.modules[0].cases[0].diagnostic!.flaky = true; }, r => { r.collected.push(OFFICIAL_RESULTS_MODULE); },
  ];
  for (const change of changes) { const changed = structuredClone(evidence); change(changed); expect(() => validateQualificationReport(binding.context, changed)).toThrow(); }
  for (const other of historyProfiles.filter(value => value.profile !== selection.profile)) {
    const substituted = await transactionHistoryFixture(other);
    expect(() => validateQualificationReport(binding.context, { ...substituted.evidence, contextDigest: qualificationDigest(binding.context) })).toThrow();
  }
  const cp14 = await transactionPeriodIntakeFixture();
  expect(() => validateQualificationReport(binding.context, { ...cp14.evidence, contextDigest: qualificationDigest(binding.context) })).toThrow();
  for (const change of [(context: typeof binding.context) => { context.modules[0].sourceDigest = 'f'.repeat(64); },
    (context: typeof binding.context) => { context.modules[0].path = OFFICIAL_RESULTS_MODULE; },
    (context: typeof binding.context) => { context.profileDigest = cp14.binding.context.profileDigest; },
    (context: typeof binding.context) => { context.modules.push({ ...context.modules[0] }); }]) {
    const context = structuredClone(binding.context); change(context);
    expect(() => qualificationBinding({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toThrow();
  }
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, selection.module), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), selection.profile)).rejects.toThrow('reviewed LF digest');
});
it.each(historyProfiles)('independently inventories $profile source names hooks budgets and manual workflow without executing SQL', async selection => {
  const path = fileURLToPath(new URL('../' + selection.module, import.meta.url)), source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(selection.digest);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [], budgets: string[] = [], hookBudgets: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); suites.push((node.arguments[0] as ts.StringLiteral).text); }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); budgets.push(node.arguments[2]?.getText(tree) ?? 'default'); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) { hooks.push(expression); hookBudgets.push(node.arguments[1]?.getText(tree) ?? 'default'); }
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(suites).toEqual([selection.suite]); expect(names).toEqual(selection.tests);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']); expect(budgets).toEqual(['1_530_000']); expect(hookBudgets).toEqual(['90_000', '90_000']);
  // This is a bound inventory, not evidence that unexecuted network/SQL work fits.
  expect(1_530_000 + 2 * 90_000).toBe(1_710_000); expect(30 * 60_000 - 1_710_000).toBe(90_000);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow.split('          - ' + selection.profile + '\n')).toHaveLength(2);
  expect(workflow.split('workflow_dispatch:' + selection.profile + ')')).toHaveLength(2);
  expect(workflow.split('pnpm test:integration --profile=' + selection.profile + '\n')).toHaveLength(2);
  expect(TRANSACTION_PERIOD_INTAKE_SOURCE_DIGEST).toBe('a16903ff701c386f2f9d2f2032e6920534139015e83bc1ed6b9d675ceea682f1');
});

async function draftMetadataFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const previous = await officialResultsEvidenceFixture();
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), DRAFT_METADATA_PROFILE);
  const evidence = structuredClone(previous.evidence);
  evidence.contextDigest = qualificationDigest(context);
  evidence.specifications = [{ path: DRAFT_METADATA_MODULE, pattern: DRAFT_METADATA_PATTERN, otherFilters: false }];
  evidence.collected = [DRAFT_METADATA_MODULE];
  evidence.modules = [{ ...evidence.modules[0], path: DRAFT_METADATA_MODULE,
    suites: [{ id: 'suite', name: DRAFT_METADATA_SUITE, mode: 'run', errors: 0 }],
    cases: DRAFT_METADATA_FULL_NAMES.map((name, index) => ({ ...previous.evidence.modules[0].cases[0], id: 'case-' + index, name,
      diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }];
  return { binding: { context, directory: previous.binding.directory }, evidence };
}
it('binds the draft metadata profile to eight exact source ordered cases and unchanged cleanup requirements', async () => {
  expect(parseQualificationArguments(['--profile=' + DRAFT_METADATA_PROFILE])).toBe(DRAFT_METADATA_PROFILE);
  expect(qualificationArguments(DRAFT_METADATA_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', DRAFT_METADATA_MODULE, '--testNamePattern', DRAFT_METADATA_PATTERN]);
  for (const args of [['--profile=data-draft-metadata-v2'], ['--profile', DRAFT_METADATA_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + DRAFT_METADATA_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + DRAFT_METADATA_PROFILE, extra])])
    expect(() => parseQualificationArguments(args)).toThrow('closed');
  const { binding, evidence } = await draftMetadataFixture();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationIncludes(env)).toEqual([DRAFT_METADATA_MODULE]);
  expect(DRAFT_METADATA_FULL_NAMES).toHaveLength(8);
  const pattern = new RegExp(DRAFT_METADATA_PATTERN);
  for (const name of DRAFT_METADATA_FULL_NAMES) {
    expect(pattern.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect([...OFFICIAL_RESULTS_FULL_NAMES, ...OFFICIAL_RESULTS_EVIDENCE_FULL_NAMES].some(name => pattern.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence); await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: DRAFT_METADATA_PROFILE, collected: 8, executed: 8, passed: 8, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout'); await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
  expect(OFFICIAL_RESULTS_SOURCE_DIGEST).toBe('592d00ae4f076bddfef63202aebe4bae128ddd9d4fab34f490f666c34f0d2479');
  expect(OFFICIAL_RESULTS_EVIDENCE_SOURCE_DIGEST).toBe('342f44ca993a2c442f2ffb0075ffb47f8713243e7b5a5d203ac09ffb0598e8ae');
});
it('rejects draft metadata profile inventory hook retry source substitution and cleanup evidence drift', async () => {
  const { binding, evidence } = await draftMetadataFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].cases[1].id = r.modules[0].cases[0].id; }, r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; }, r => { r.hooks[0].ends = 0; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].key = 'suite:beforeEach'; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; }, r => { r.reason = 'failed'; }, r => { r.starts = 2; }, r => { r.ends = 0; },
    r => { r.contextDigest = 'f'.repeat(64); }, r => { r.modules[0].state = 'failed'; }, r => { r.modules[0].errors = 1; },
    r => { r.modules[0].cases[0].diagnostic!.flaky = true; }, r => { r.collected.push(OFFICIAL_RESULTS_MODULE); },
  ];
  for (const change of changes) { const changed = structuredClone(evidence); change(changed); expect(() => validateQualificationReport(binding.context, changed)).toThrow(); }
  const original = await officialResultsEvidenceFixture();
  expect(() => validateQualificationReport(original.binding.context, { ...evidence, contextDigest: qualificationDigest(original.binding.context) })).toThrow();
  expect(() => validateQualificationReport(binding.context, { ...original.evidence, contextDigest: qualificationDigest(binding.context) })).toThrow();
  for (const change of [(context: typeof binding.context) => { context.modules[0].sourceDigest = 'f'.repeat(64); },
    (context: typeof binding.context) => { context.modules[0].path = OFFICIAL_RESULTS_MODULE; },
    (context: typeof binding.context) => { context.profileDigest = original.binding.context.profileDigest; },
    (context: typeof binding.context) => { context.modules.push({ ...context.modules[0] }); }]) {
    const context = structuredClone(binding.context); change(context);
    expect(() => qualificationBinding({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toThrow();
  }
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, DRAFT_METADATA_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), DRAFT_METADATA_PROFILE)).rejects.toThrow('reviewed LF digest');
});
it('independently inventories draft metadata source hooks budgets and manual workflow without importing SQL execution', async () => {
  const path = fileURLToPath(new URL('../' + DRAFT_METADATA_MODULE, import.meta.url)), source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(DRAFT_METADATA_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [], budgets: string[] = [], hookBudgets: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); suites.push((node.arguments[0] as ts.StringLiteral).text); }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); budgets.push(node.arguments[2]?.getText(tree) ?? 'default'); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) { hooks.push(expression); hookBudgets.push(node.arguments[1]?.getText(tree) ?? 'default'); }
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(suites).toEqual([DRAFT_METADATA_SUITE]); expect(names).toEqual(DRAFT_METADATA_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']); expect(budgets).toEqual(Array<string>(8).fill('60_000')); expect(hookBudgets).toEqual(['120_000', '120_000']);
  // Authored ceilings only: 12 minutes cases/hooks, 18 minutes shared setup,
  // migrations, role provisioning, reporting and acknowledged global cleanup.
  expect(8 * 60_000 + 2 * 120_000).toBe(720_000);
  expect(30 * 60_000 - 720_000).toBe(1_080_000);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow).toContain("timeout-minutes: ${{ inputs.profile == 'data-freshness-capacity-recovery-v1' && 360 || inputs.profile == 'data-freshness-capacity-healthy-v1' && 270 || 50 }}");
  expect(workflow.match(/^\s+- data-draft-metadata-v1$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+workflow_dispatch:data-draft-metadata-v1\)$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+pnpm test:integration --profile=data-draft-metadata-v1$/gmu)).toHaveLength(1);
});

it('keeps CP15 module bytes and predecessor pins unchanged for the CP16 selector', async () => {
  for (const selection of historyProfiles) {
    const source = await readFile(new URL('../' + selection.module, import.meta.url), 'utf8');
    expect(qualificationSourceDigest(source)).toBe(selection.digest);
    const original = await transactionHistoryFixture(selection), current = await draftMetadataFixture();
    expect(() => validateQualificationReport(current.binding.context,
      { ...original.evidence, contextDigest: qualificationDigest(current.binding.context) })).toThrow();
  }
  expect(TYPED_BRACKETS_SOURCE_DIGEST).toBe('edab995ff8e046b4a3c6dcab40a22f1bebb76e3d3f7a59dc7e3f1cd7bb3c06fe');
  expect(TRANSACTION_PERIOD_INTAKE_SOURCE_DIGEST).toBe('a16903ff701c386f2f9d2f2032e6920534139015e83bc1ed6b9d675ceea682f1');
});

async function draftSelectionsFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const previous = await officialResultsEvidenceFixture();
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), DRAFT_SELECTIONS_PROFILE);
  const evidence = structuredClone(previous.evidence);
  evidence.contextDigest = qualificationDigest(context);
  evidence.specifications = [{ path: DRAFT_SELECTIONS_MODULE, pattern: DRAFT_SELECTIONS_PATTERN, otherFilters: false }];
  evidence.collected = [DRAFT_SELECTIONS_MODULE];
  evidence.modules = [{ ...evidence.modules[0], path: DRAFT_SELECTIONS_MODULE,
    suites: [{ id: 'suite', name: DRAFT_SELECTIONS_SUITE, mode: 'run', errors: 0 }],
    cases: DRAFT_SELECTIONS_FULL_NAMES.map((name, index) => ({ ...previous.evidence.modules[0].cases[0], id: 'case-' + index, name,
      diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }];
  return { binding: { context, directory: previous.binding.directory }, evidence };
}
it('binds the draft selections profile to eight exact source ordered cases and unchanged cleanup requirements', async () => {
  expect(parseQualificationArguments(['--profile=' + DRAFT_SELECTIONS_PROFILE])).toBe(DRAFT_SELECTIONS_PROFILE);
  expect(qualificationArguments(DRAFT_SELECTIONS_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', DRAFT_SELECTIONS_MODULE, '--testNamePattern', DRAFT_SELECTIONS_PATTERN]);
  for (const args of [['--profile=data-draft-selections-v2'], ['--profile', DRAFT_SELECTIONS_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + DRAFT_SELECTIONS_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + DRAFT_SELECTIONS_PROFILE, extra])])
    expect(() => parseQualificationArguments(args)).toThrow('closed');
  const { binding, evidence } = await draftSelectionsFixture();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationIncludes(env)).toEqual([DRAFT_SELECTIONS_MODULE]);
  expect(DRAFT_SELECTIONS_FULL_NAMES).toHaveLength(8);
  const pattern = new RegExp(DRAFT_SELECTIONS_PATTERN);
  for (const name of DRAFT_SELECTIONS_FULL_NAMES) {
    expect(pattern.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect([...DRAFT_METADATA_FULL_NAMES, ...OFFICIAL_RESULTS_FULL_NAMES, ...OFFICIAL_RESULTS_EVIDENCE_FULL_NAMES].some(name => pattern.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence); await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: DRAFT_SELECTIONS_PROFILE, collected: 8, executed: 8, passed: 8, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout'); await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
  expect(OFFICIAL_RESULTS_SOURCE_DIGEST).toBe('592d00ae4f076bddfef63202aebe4bae128ddd9d4fab34f490f666c34f0d2479');
  expect(OFFICIAL_RESULTS_EVIDENCE_SOURCE_DIGEST).toBe('342f44ca993a2c442f2ffb0075ffb47f8713243e7b5a5d203ac09ffb0598e8ae');
});
it('rejects draft selections profile inventory hook retry source substitution and cleanup evidence drift', async () => {
  const { binding, evidence } = await draftSelectionsFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].cases[1].id = r.modules[0].cases[0].id; }, r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; }, r => { r.hooks[0].ends = 0; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].key = 'suite:beforeEach'; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; }, r => { r.reason = 'failed'; }, r => { r.starts = 2; }, r => { r.ends = 0; },
    r => { r.contextDigest = 'f'.repeat(64); }, r => { r.modules[0].state = 'failed'; }, r => { r.modules[0].errors = 1; },
    r => { r.modules[0].cases[0].diagnostic!.flaky = true; }, r => { r.collected.push(OFFICIAL_RESULTS_MODULE); },
  ];
  for (const change of changes) { const changed = structuredClone(evidence); change(changed); expect(() => validateQualificationReport(binding.context, changed)).toThrow(); }
  const original = await officialResultsEvidenceFixture();
  expect(() => validateQualificationReport(original.binding.context, { ...evidence, contextDigest: qualificationDigest(original.binding.context) })).toThrow();
  expect(() => validateQualificationReport(binding.context, { ...original.evidence, contextDigest: qualificationDigest(binding.context) })).toThrow();
  for (const change of [(context: typeof binding.context) => { context.modules[0].sourceDigest = 'f'.repeat(64); },
    (context: typeof binding.context) => { context.modules[0].path = OFFICIAL_RESULTS_MODULE; },
    (context: typeof binding.context) => { context.profileDigest = original.binding.context.profileDigest; },
    (context: typeof binding.context) => { context.modules.push({ ...context.modules[0] }); }]) {
    const context = structuredClone(binding.context); change(context);
    expect(() => qualificationBinding({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toThrow();
  }
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, DRAFT_SELECTIONS_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), DRAFT_SELECTIONS_PROFILE)).rejects.toThrow('reviewed LF digest');
});
it('independently inventories draft selections source hooks budgets and manual workflow without importing SQL execution', async () => {
  const path = fileURLToPath(new URL('../' + DRAFT_SELECTIONS_MODULE, import.meta.url)), source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(DRAFT_SELECTIONS_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [], budgets: string[] = [], hookBudgets: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); suites.push((node.arguments[0] as ts.StringLiteral).text); }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); budgets.push(node.arguments[2]?.getText(tree) ?? 'default'); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) { hooks.push(expression); hookBudgets.push(node.arguments[1]?.getText(tree) ?? 'default'); }
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(suites).toEqual([DRAFT_SELECTIONS_SUITE]); expect(names).toEqual(DRAFT_SELECTIONS_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']); expect(budgets).toEqual(Array<string>(8).fill('60_000')); expect(hookBudgets).toEqual(['120_000', '120_000']);
  // Planning only: 12 minutes suite, 8 minutes setup, 3 minutes reporting/cleanup, 7 minutes margin.
  expect(8 * 60_000 + 2 * 120_000).toBe(720_000);
  expect(720_000 + 8 * 60_000 + 3 * 60_000 + 7 * 60_000).toBe(30 * 60_000);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow).toContain("timeout-minutes: ${{ inputs.profile == 'data-freshness-capacity-recovery-v1' && 360 || inputs.profile == 'data-freshness-capacity-healthy-v1' && 270 || 50 }}");
  expect(workflow.match(/^\s+- data-draft-selections-v1$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+workflow_dispatch:data-draft-selections-v1\)$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+pnpm test:integration --profile=data-draft-selections-v1$/gmu)).toHaveLength(1);
});

it('preserves CP16 and CP15 source pins and rejects predecessor report substitution for CP17', async () => {
  const current = await draftSelectionsFixture(), previous = await draftMetadataFixture();
  expect(DRAFT_METADATA_SOURCE_DIGEST).toBe('ad02626bdd113ead7d71a2f7365238f407f8eb8116b95da0f78f3e413c0fe4da');
  expect(qualificationSourceDigest(await readFile(new URL('../' + DRAFT_METADATA_MODULE, import.meta.url), 'utf8'))).toBe(DRAFT_METADATA_SOURCE_DIGEST);
  expect(() => validateQualificationReport(current.binding.context,
    { ...previous.evidence, contextDigest: qualificationDigest(current.binding.context) })).toThrow();
  expect(() => validateQualificationReport(previous.binding.context,
    { ...current.evidence, contextDigest: qualificationDigest(previous.binding.context) })).toThrow();
  for (const selection of historyProfiles)
    expect(qualificationSourceDigest(await readFile(new URL('../' + selection.module, import.meta.url), 'utf8'))).toBe(selection.digest);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules).toHaveLength(70);
  expect(full.modules.filter(module => module.path === DRAFT_SELECTIONS_MODULE)).toHaveLength(1);
  expect(full.modules.some(module => module.path.endsWith('.live-integration-case.ts'))).toBe(false);
});

async function tradedPicksFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const previous = await officialResultsEvidenceFixture();
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), TRADED_PICKS_PROFILE);
  const evidence = structuredClone(previous.evidence);
  evidence.contextDigest = qualificationDigest(context);
  evidence.specifications = [{ path: TRADED_PICKS_MODULE, pattern: TRADED_PICKS_PATTERN, otherFilters: false }];
  evidence.collected = [TRADED_PICKS_MODULE];
  evidence.modules = [{ ...evidence.modules[0], path: TRADED_PICKS_MODULE,
    suites: [{ id: 'suite', name: TRADED_PICKS_SUITE, mode: 'run', errors: 0 }],
    cases: TRADED_PICKS_FULL_NAMES.map((name, index) => ({ ...previous.evidence.modules[0].cases[0], id: 'case-' + index, name,
      diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }];
  return { binding: { context, directory: previous.binding.directory }, evidence };
}
it('binds the traded picks profile to seven exact source ordered cases and unchanged cleanup requirements', async () => {
  expect(parseQualificationArguments(['--profile=' + TRADED_PICKS_PROFILE])).toBe(TRADED_PICKS_PROFILE);
  expect(qualificationArguments(TRADED_PICKS_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', TRADED_PICKS_MODULE, '--testNamePattern', TRADED_PICKS_PATTERN]);
  for (const args of [['--profile=data-traded-picks-v2'], ['--profile', TRADED_PICKS_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + TRADED_PICKS_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + TRADED_PICKS_PROFILE, extra])])
    expect(() => parseQualificationArguments(args)).toThrow('closed');
  const { binding, evidence } = await tradedPicksFixture();
  const env = { [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory };
  expect(qualificationIncludes(env)).toEqual([TRADED_PICKS_MODULE]);
  expect(TRADED_PICKS_FULL_NAMES).toHaveLength(7);
  const pattern = new RegExp(TRADED_PICKS_PATTERN);
  for (const name of TRADED_PICKS_FULL_NAMES) {
    expect(pattern.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect([...DRAFT_METADATA_FULL_NAMES, ...OFFICIAL_RESULTS_FULL_NAMES, ...OFFICIAL_RESULTS_EVIDENCE_FULL_NAMES].some(name => pattern.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence); await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: TRADED_PICKS_PROFILE, collected: 7, executed: 7, passed: 7, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout'); await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
  expect(OFFICIAL_RESULTS_SOURCE_DIGEST).toBe('592d00ae4f076bddfef63202aebe4bae128ddd9d4fab34f490f666c34f0d2479');
  expect(OFFICIAL_RESULTS_EVIDENCE_SOURCE_DIGEST).toBe('342f44ca993a2c442f2ffb0075ffb47f8713243e7b5a5d203ac09ffb0598e8ae');
});
it('rejects traded picks profile inventory hook retry source substitution and cleanup evidence drift', async () => {
  const { binding, evidence } = await tradedPicksFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].cases[1].id = r.modules[0].cases[0].id; }, r => { r.modules[0].suites = []; },
    r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; }, r => { r.hooks[0].ends = 0; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].key = 'suite:beforeEach'; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; }, r => { r.reason = 'failed'; }, r => { r.starts = 2; }, r => { r.ends = 0; },
    r => { r.contextDigest = 'f'.repeat(64); }, r => { r.modules[0].state = 'failed'; }, r => { r.modules[0].errors = 1; },
    r => { r.modules[0].cases[0].diagnostic!.flaky = true; }, r => { r.collected.push(OFFICIAL_RESULTS_MODULE); },
  ];
  for (const change of changes) { const changed = structuredClone(evidence); change(changed); expect(() => validateQualificationReport(binding.context, changed)).toThrow(); }
  const original = await officialResultsEvidenceFixture();
  expect(() => validateQualificationReport(original.binding.context, { ...evidence, contextDigest: qualificationDigest(original.binding.context) })).toThrow();
  expect(() => validateQualificationReport(binding.context, { ...original.evidence, contextDigest: qualificationDigest(binding.context) })).toThrow();
  for (const change of [(context: typeof binding.context) => { context.modules[0].sourceDigest = 'f'.repeat(64); },
    (context: typeof binding.context) => { context.modules[0].path = OFFICIAL_RESULTS_MODULE; },
    (context: typeof binding.context) => { context.profileDigest = original.binding.context.profileDigest; },
    (context: typeof binding.context) => { context.modules.push({ ...context.modules[0] }); }]) {
    const context = structuredClone(binding.context); change(context);
    expect(() => qualificationBinding({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toThrow();
  }
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, TRADED_PICKS_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), TRADED_PICKS_PROFILE)).rejects.toThrow('reviewed LF digest');
});
it('independently inventories traded picks source hooks budgets and manual workflow without importing SQL execution', async () => {
  const path = fileURLToPath(new URL('../' + TRADED_PICKS_MODULE, import.meta.url)), source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(TRADED_PICKS_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [], budgets: string[] = [], hookBudgets: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); suites.push((node.arguments[0] as ts.StringLiteral).text); }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); budgets.push(node.arguments[2]?.getText(tree) ?? 'default'); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) { hooks.push(expression); hookBudgets.push(node.arguments[1]?.getText(tree) ?? 'default'); }
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(suites).toEqual([TRADED_PICKS_SUITE]); expect(names).toEqual(TRADED_PICKS_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']); expect(budgets).toEqual(Array<string>(7).fill('60_000')); expect(hookBudgets).toEqual(['120_000', '120_000']);
  // Planning only: 11 minutes suite, 8 minutes setup, 3 minutes reporting/cleanup, 8 minutes margin.
  expect(7 * 60_000 + 2 * 120_000).toBe(660_000);
  expect(660_000 + 8 * 60_000 + 3 * 60_000 + 8 * 60_000).toBe(30 * 60_000);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow).toContain("timeout-minutes: ${{ inputs.profile == 'data-freshness-capacity-recovery-v1' && 360 || inputs.profile == 'data-freshness-capacity-healthy-v1' && 270 || 50 }}");
  expect(workflow.match(/^\s+- data-traded-picks-v1$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+workflow_dispatch:data-traded-picks-v1\)$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+pnpm test:integration --profile=data-traded-picks-v1$/gmu)).toHaveLength(1);
});

it('preserves CP16 and CP15 source pins and rejects predecessor report substitution for CP18', async () => {
  const current = await tradedPicksFixture(), previous = await draftSelectionsFixture();
  expect(DRAFT_METADATA_SOURCE_DIGEST).toBe('ad02626bdd113ead7d71a2f7365238f407f8eb8116b95da0f78f3e413c0fe4da');
  expect(qualificationSourceDigest(await readFile(new URL('../' + DRAFT_METADATA_MODULE, import.meta.url), 'utf8'))).toBe(DRAFT_METADATA_SOURCE_DIGEST);
  expect(() => validateQualificationReport(current.binding.context,
    { ...previous.evidence, contextDigest: qualificationDigest(current.binding.context) })).toThrow();
  expect(() => validateQualificationReport(previous.binding.context,
    { ...current.evidence, contextDigest: qualificationDigest(previous.binding.context) })).toThrow();
  for (const selection of historyProfiles)
    expect(qualificationSourceDigest(await readFile(new URL('../' + selection.module, import.meta.url), 'utf8'))).toBe(selection.digest);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules).toHaveLength(70);
  expect(full.modules.filter(module => module.path === TRADED_PICKS_MODULE)).toHaveLength(1);
  expect(full.modules.some(module => module.path.endsWith('.live-integration-case.ts'))).toBe(false);
});

const draftIntakeProfiles = [
  { profile: DRAFT_INTAKE_PROFILE, module: DRAFT_INTAKE_MODULE, digest: DRAFT_INTAKE_SOURCE_DIGEST,
    suite: DRAFT_INTAKE_SUITE, names: DRAFT_INTAKE_FULL_NAMES, tests: DRAFT_INTAKE_TESTS, pattern: DRAFT_INTAKE_PATTERN, bodyBudget: '900_000', hookBudgets: ["90_000","90_000"] },
  { profile: DRAFT_REFRESH_PROFILE, module: DRAFT_REFRESH_MODULE, digest: DRAFT_REFRESH_SOURCE_DIGEST,
    suite: DRAFT_REFRESH_SUITE, names: DRAFT_REFRESH_FULL_NAMES, tests: DRAFT_REFRESH_TESTS, pattern: DRAFT_REFRESH_PATTERN, bodyBudget: '900_000', hookBudgets: ["90_000","90_000"] },
  { profile: DRAFT_INTAKE_RECOVERY_PROFILE, module: DRAFT_INTAKE_RECOVERY_MODULE, digest: DRAFT_INTAKE_RECOVERY_SOURCE_DIGEST,
    suite: DRAFT_INTAKE_RECOVERY_SUITE, names: DRAFT_INTAKE_RECOVERY_FULL_NAMES, tests: DRAFT_INTAKE_RECOVERY_TESTS, pattern: DRAFT_INTAKE_RECOVERY_PATTERN, bodyBudget: '1_380_000', hookBudgets: ["90_000","90_000"] },
] as const;
async function draftIntakeProfileFixture(selection: typeof draftIntakeProfiles[number]): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const previous = await officialResultsEvidenceFixture();
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), selection.profile);
  const evidence = structuredClone(previous.evidence);
  evidence.contextDigest = qualificationDigest(context);
  evidence.specifications = [{ path: selection.module, pattern: selection.pattern, otherFilters: false }];
  evidence.collected = [selection.module];
  evidence.modules = [{ ...evidence.modules[0], path: selection.module,
    suites: [{ id: 'suite', name: selection.suite, mode: 'run', errors: 0 }],
    cases: selection.names.map((name, index) => ({ ...previous.evidence.modules[0].cases[0], id: 'case-' + index, name,
      diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }];
  return { binding: { context, directory: previous.binding.directory }, evidence };
}
it.each(draftIntakeProfiles)('binds $profile to its sole case module and exactly two hooks with acknowledged cleanup', async selection => {
  expect(parseQualificationArguments(['--profile=' + selection.profile])).toBe(selection.profile);
  expect(qualificationArguments(selection.profile, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', selection.module, '--testNamePattern', selection.pattern]);
  const { binding, evidence } = await draftIntakeProfileFixture(selection);
  expect(binding.context.modules).toEqual([{ path: selection.module, sourceDigest: selection.digest }]);
  expect(qualificationIncludes({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context),
    PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toEqual([selection.module]);
  expect(selection.names).toHaveLength(1);
  const pattern = new RegExp(selection.pattern);
  for (const name of selection.names) {
    expect(pattern.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  for (const other of draftIntakeProfiles.filter(value => value.profile !== selection.profile))
    expect(other.names.some(name => pattern.test(name.replaceAll(' > ', ' ')))).toBe(false);
  expect(TRANSACTION_PERIOD_INTAKE_FULL_NAMES.some(name => pattern.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence); await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: selection.profile, collected: 1, executed: 1, passed: 1, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout'); await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
  for (const args of [['--profile=' + selection.profile.replace('-v1', '-v2')], ['--profile', selection.profile],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + selection.profile, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + selection.profile, extra])])
    expect(() => parseQualificationArguments(args)).toThrow('closed');
});
it.each(draftIntakeProfiles)('rejects $profile altered inventory execution hooks and substituted source evidence', async selection => {
  const { binding, evidence } = await draftIntakeProfileFixture(selection);
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases[0].name += ' extra'; },
    r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].suites = []; }, r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; }, r => { r.hooks[0].ends = 0; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].key = 'suite:beforeEach'; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; }, r => { r.reason = 'failed'; }, r => { r.starts = 2; }, r => { r.ends = 0; },
    r => { r.contextDigest = 'f'.repeat(64); }, r => { r.modules[0].state = 'failed'; }, r => { r.modules[0].errors = 1; },
    r => { r.modules[0].cases[0].diagnostic!.flaky = true; }, r => { r.collected.push(OFFICIAL_RESULTS_MODULE); },
  ];
  for (const change of changes) { const changed = structuredClone(evidence); change(changed); expect(() => validateQualificationReport(binding.context, changed)).toThrow(); }
  for (const other of draftIntakeProfiles.filter(value => value.profile !== selection.profile)) {
    const substituted = await draftIntakeProfileFixture(other);
    expect(() => validateQualificationReport(binding.context, { ...substituted.evidence, contextDigest: qualificationDigest(binding.context) })).toThrow();
  }
  const cp14 = await transactionPeriodIntakeFixture();
  expect(() => validateQualificationReport(binding.context, { ...cp14.evidence, contextDigest: qualificationDigest(binding.context) })).toThrow();
  for (const change of [(context: typeof binding.context) => { context.modules[0].sourceDigest = 'f'.repeat(64); },
    (context: typeof binding.context) => { context.modules[0].path = OFFICIAL_RESULTS_MODULE; },
    (context: typeof binding.context) => { context.profileDigest = cp14.binding.context.profileDigest; },
    (context: typeof binding.context) => { context.modules.push({ ...context.modules[0] }); }]) {
    const context = structuredClone(binding.context); change(context);
    expect(() => qualificationBinding({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toThrow();
  }
  await mkdir(join(binding.directory, 'integration'));
  await writeFile(join(binding.directory, selection.module), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), selection.profile)).rejects.toThrow('reviewed LF digest');
});
it.each(draftIntakeProfiles)('independently inventories $profile source names hooks budgets and manual workflow without executing SQL', async selection => {
  const path = fileURLToPath(new URL('../' + selection.module, import.meta.url)), source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(selection.digest);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [], budgets: string[] = [], hookBudgets: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); suites.push((node.arguments[0] as ts.StringLiteral).text); }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); budgets.push(node.arguments[2]?.getText(tree) ?? 'default'); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) { hooks.push(expression); hookBudgets.push(node.arguments[1]?.getText(tree) ?? 'default'); }
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(suites).toEqual([selection.suite]); expect(names).toEqual(selection.tests);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']); expect(budgets).toEqual([selection.bodyBudget]); expect(hookBudgets).toEqual(selection.hookBudgets);
  // This is a bound inventory, not evidence that unexecuted network/SQL work fits.
  const workAllowance = Number(selection.bodyBudget.replaceAll('_', '')) + selection.hookBudgets.reduce((sum, value) => sum + Number(value.replaceAll('_', '')), 0);
  expect(workAllowance).toBeLessThanOrEqual(26 * 60_000); expect(30 * 60_000 - workAllowance).toBeGreaterThanOrEqual(4 * 60_000);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow.split('          - ' + selection.profile + '\n')).toHaveLength(2);
  expect(workflow.split('workflow_dispatch:' + selection.profile + ')')).toHaveLength(2);
  expect(workflow.split('pnpm test:integration --profile=' + selection.profile + '\n')).toHaveLength(2);
  expect(TRANSACTION_PERIOD_INTAKE_SOURCE_DIGEST).toBe('a16903ff701c386f2f9d2f2032e6920534139015e83bc1ed6b9d675ceea682f1');
});


async function withinSeasonHistoryFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const previous = await officialResultsEvidenceFixture();
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), WITHIN_SEASON_HISTORY_PROFILE);
  const evidence = structuredClone(previous.evidence);
  evidence.contextDigest = qualificationDigest(context);
  evidence.specifications = [{ path: WITHIN_SEASON_HISTORY_MODULE, pattern: WITHIN_SEASON_HISTORY_PATTERN, otherFilters: false }];
  evidence.collected = [WITHIN_SEASON_HISTORY_MODULE];
  evidence.modules = [{ ...evidence.modules[0], path: WITHIN_SEASON_HISTORY_MODULE,
    suites: [{ id: 'suite', name: WITHIN_SEASON_HISTORY_SUITE, mode: 'run', errors: 0 }],
    cases: WITHIN_SEASON_HISTORY_FULL_NAMES.map((name, index) => ({ ...previous.evidence.modules[0].cases[0], id: 'case-' + index, name,
      diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }];
  return { binding: { context, directory: previous.binding.directory }, evidence };
}
it('binds CP20 to five closed cases and two hooks with acknowledged cleanup and sticky failure', async () => {
  expect(parseQualificationArguments(['--profile=' + WITHIN_SEASON_HISTORY_PROFILE])).toBe(WITHIN_SEASON_HISTORY_PROFILE);
  expect(qualificationArguments(WITHIN_SEASON_HISTORY_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', WITHIN_SEASON_HISTORY_MODULE, '--testNamePattern', WITHIN_SEASON_HISTORY_PATTERN]);
  const { binding, evidence } = await withinSeasonHistoryFixture();
  expect(binding.context.modules).toEqual([{ path: WITHIN_SEASON_HISTORY_MODULE, sourceDigest: WITHIN_SEASON_HISTORY_SOURCE_DIGEST }]);
  expect(qualificationIncludes({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context),
    PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toEqual([WITHIN_SEASON_HISTORY_MODULE]);
  expect(WITHIN_SEASON_HISTORY_FULL_NAMES).toHaveLength(5);
  const pattern = new RegExp(WITHIN_SEASON_HISTORY_PATTERN);
  for (const name of WITHIN_SEASON_HISTORY_FULL_NAMES) {
    expect(pattern.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect(DRAFT_INTAKE_RECOVERY_FULL_NAMES.some(name => pattern.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence); await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: WITHIN_SEASON_HISTORY_PROFILE,
    collected: 5, executed: 5, passed: 5, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout'); await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
  for (const args of [['--profile=data-within-season-history-v2'], ['--profile', WITHIN_SEASON_HISTORY_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + WITHIN_SEASON_HISTORY_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + WITHIN_SEASON_HISTORY_PROFILE, extra])])
    expect(() => parseQualificationArguments(args)).toThrow('closed');
});
it('rejects CP20 inventory order execution hook filter source and predecessor substitution drift', async () => {
  const { binding, evidence } = await withinSeasonHistoryFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases[0].name += ' extra'; },
    r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].suites = []; }, r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; }, r => { r.hooks[0].ends = 0; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].key = 'suite:beforeEach'; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; }, r => { r.reason = 'failed'; }, r => { r.starts = 2; }, r => { r.ends = 0; },
    r => { r.contextDigest = 'f'.repeat(64); }, r => { r.modules[0].state = 'failed'; }, r => { r.modules[0].errors = 1; },
    r => { r.modules[0].cases[0].diagnostic!.flaky = true; }, r => { r.collected.push(OFFICIAL_RESULTS_MODULE); },
  ];
  for (const change of changes) { const changed = structuredClone(evidence); change(changed); expect(() => validateQualificationReport(binding.context, changed)).toThrow(); }
  const predecessor = await draftIntakeProfileFixture(draftIntakeProfiles[2]);
  expect(() => validateQualificationReport(binding.context, { ...predecessor.evidence, contextDigest: qualificationDigest(binding.context) })).toThrow();
  expect(() => validateQualificationReport(predecessor.binding.context, { ...evidence, contextDigest: qualificationDigest(predecessor.binding.context) })).toThrow();
  for (const change of [(context: typeof binding.context) => { context.modules[0].sourceDigest = 'f'.repeat(64); },
    (context: typeof binding.context) => { context.modules[0].path = OFFICIAL_RESULTS_MODULE; },
    (context: typeof binding.context) => { context.profileDigest = predecessor.binding.context.profileDigest; },
    (context: typeof binding.context) => { context.modules.push({ ...context.modules[0] }); }]) {
    const context = structuredClone(binding.context); change(context);
    expect(() => qualificationBinding({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toThrow();
  }
  await mkdir(join(binding.directory, 'integration')); await writeFile(join(binding.directory, WITHIN_SEASON_HISTORY_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), WITHIN_SEASON_HISTORY_PROFILE)).rejects.toThrow('reviewed LF digest');
});
it('independently inventories CP20 source names hooks allowance and fixed manual workflow without SQL execution', async () => {
  const path = fileURLToPath(new URL('../' + WITHIN_SEASON_HISTORY_MODULE, import.meta.url)), source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(WITHIN_SEASON_HISTORY_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [], budgets: string[] = [], hookBudgets: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); suites.push((node.arguments[0] as ts.StringLiteral).text); }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); budgets.push(node.arguments[2]?.getText(tree) ?? 'default'); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) { hooks.push(expression); hookBudgets.push(node.arguments[1]?.getText(tree) ?? 'default'); }
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(suites).toEqual([WITHIN_SEASON_HISTORY_SUITE]); expect(names).toEqual(WITHIN_SEASON_HISTORY_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']); expect(budgets).toEqual(['300_000', '90_000', '120_000', '120_000', '90_000']);
  expect(hookBudgets).toEqual(['120_000', '120_000']);
  // Authored allowance only: 16m cases/hooks, 8m setup, 3m reporting/cleanup, 3m margin.
  expect(budgets.concat(hookBudgets).reduce((sum, value) => sum + Number(value.replaceAll('_', '')), 0)).toBe(16 * 60_000);
  expect(16 + 8 + 3 + 3).toBe(30);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow.match(/^\s+- data-within-season-history-v1$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+workflow_dispatch:data-within-season-history-v1\)$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+pnpm test:integration --profile=data-within-season-history-v1$/gmu)).toHaveLength(1);
  expect(workflow).toContain("timeout-minutes: ${{ inputs.profile == 'data-freshness-capacity-recovery-v1' && 360 || inputs.profile == 'data-freshness-capacity-healthy-v1' && 270 || 50 }}");
  for (const selection of [...historyProfiles, ...draftIntakeProfiles])
    expect(qualificationSourceDigest(await readFile(new URL('../' + selection.module, import.meta.url), 'utf8'))).toBe(selection.digest);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules).toHaveLength(70); expect(full.modules.filter(module => module.path === WITHIN_SEASON_HISTORY_MODULE)).toHaveLength(1);
  expect(full.modules.some(module => module.path.endsWith('.live-integration-case.ts'))).toBe(false);
});

async function freshInstallFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const previous = await officialResultsEvidenceFixture();
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), FRESH_INSTALL_PROFILE);
  const evidence = structuredClone(previous.evidence);
  evidence.contextDigest = qualificationDigest(context);
  evidence.specifications = [{ path: FRESH_INSTALL_MODULE, pattern: FRESH_INSTALL_PATTERN, otherFilters: false }];
  evidence.collected = [FRESH_INSTALL_MODULE];
  evidence.modules = [{ ...evidence.modules[0], path: FRESH_INSTALL_MODULE,
    suites: [{ id: 'suite', name: FRESH_INSTALL_SUITE, mode: 'run', errors: 0 }],
    cases: FRESH_INSTALL_FULL_NAMES.map((name, index) => ({ ...previous.evidence.modules[0].cases[0], id: 'case-' + index, name,
      diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }];
  return { binding: { context, directory: previous.binding.directory }, evidence };
}
it('binds CP21 to eight closed cases and two hooks with acknowledged cleanup and sticky failure', async () => {
  expect(parseQualificationArguments(['--profile=' + FRESH_INSTALL_PROFILE])).toBe(FRESH_INSTALL_PROFILE);
  expect(qualificationArguments(FRESH_INSTALL_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', FRESH_INSTALL_MODULE, '--testNamePattern', FRESH_INSTALL_PATTERN]);
  const { binding, evidence } = await freshInstallFixture();
  expect(binding.context.modules).toEqual([{ path: FRESH_INSTALL_MODULE, sourceDigest: FRESH_INSTALL_SOURCE_DIGEST }]);
  expect(qualificationIncludes({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context),
    PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toEqual([FRESH_INSTALL_MODULE]);
  expect(FRESH_INSTALL_FULL_NAMES).toHaveLength(8);
  const pattern = new RegExp(FRESH_INSTALL_PATTERN);
  for (const name of FRESH_INSTALL_FULL_NAMES) {
    expect(pattern.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect(DRAFT_INTAKE_RECOVERY_FULL_NAMES.some(name => pattern.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence); await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: FRESH_INSTALL_PROFILE,
    collected: 8, executed: 8, passed: 8, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout'); await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
  for (const args of [['--profile=data-fresh-install-v2'], ['--profile', FRESH_INSTALL_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + FRESH_INSTALL_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + FRESH_INSTALL_PROFILE, extra])])
    expect(() => parseQualificationArguments(args)).toThrow('closed');
});
it('rejects CP21 inventory order execution hook filter source and predecessor substitution drift', async () => {
  const { binding, evidence } = await freshInstallFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases[0].name += ' extra'; },
    r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].suites = []; }, r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; }, r => { r.hooks[0].ends = 0; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].key = 'suite:beforeEach'; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; }, r => { r.reason = 'failed'; }, r => { r.starts = 2; }, r => { r.ends = 0; },
    r => { r.contextDigest = 'f'.repeat(64); }, r => { r.modules[0].state = 'failed'; }, r => { r.modules[0].errors = 1; },
    r => { r.modules[0].cases[0].diagnostic!.flaky = true; }, r => { r.collected.push(OFFICIAL_RESULTS_MODULE); },
  ];
  for (const change of changes) { const changed = structuredClone(evidence); change(changed); expect(() => validateQualificationReport(binding.context, changed)).toThrow(); }
  const predecessor = await draftIntakeProfileFixture(draftIntakeProfiles[2]);
  expect(() => validateQualificationReport(binding.context, { ...predecessor.evidence, contextDigest: qualificationDigest(binding.context) })).toThrow();
  expect(() => validateQualificationReport(predecessor.binding.context, { ...evidence, contextDigest: qualificationDigest(predecessor.binding.context) })).toThrow();
  for (const change of [(context: typeof binding.context) => { context.modules[0].sourceDigest = 'f'.repeat(64); },
    (context: typeof binding.context) => { context.modules[0].path = OFFICIAL_RESULTS_MODULE; },
    (context: typeof binding.context) => { context.profileDigest = predecessor.binding.context.profileDigest; },
    (context: typeof binding.context) => { context.modules.push({ ...context.modules[0] }); }]) {
    const context = structuredClone(binding.context); change(context);
    expect(() => qualificationBinding({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toThrow();
  }
  await mkdir(join(binding.directory, 'integration')); await writeFile(join(binding.directory, FRESH_INSTALL_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), FRESH_INSTALL_PROFILE)).rejects.toThrow('reviewed LF digest');
});
it('independently inventories CP21 source names hooks allowance and fixed manual workflow without SQL execution', async () => {
  const path = fileURLToPath(new URL('../' + FRESH_INSTALL_MODULE, import.meta.url)), source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(FRESH_INSTALL_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [], budgets: string[] = [], hookBudgets: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); suites.push((node.arguments[0] as ts.StringLiteral).text); }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); budgets.push(node.arguments[2]?.getText(tree) ?? 'default'); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) { hooks.push(expression); hookBudgets.push(node.arguments[1]?.getText(tree) ?? 'default'); }
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(suites).toEqual([FRESH_INSTALL_SUITE]); expect(names).toEqual(FRESH_INSTALL_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']); expect(budgets).toEqual(['90_000', '90_000', '90_000', '120_000', '90_000', '90_000', '90_000', '120_000']);
  expect(hookBudgets).toEqual(['120_000', '120_000']);
  // Authored allowance only: 17m cases/hooks, 8m setup, 3m reporting/cleanup, 2m margin.
  expect(budgets.concat(hookBudgets).reduce((sum, value) => sum + Number(value.replaceAll('_', '')), 0)).toBe(17 * 60_000);
  expect(17 + 8 + 3 + 2).toBe(30);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow.match(/^\s+- data-fresh-install-v1$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+workflow_dispatch:data-fresh-install-v1\)$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+pnpm test:integration --profile=data-fresh-install-v1$/gmu)).toHaveLength(1);
  expect(workflow).toContain("timeout-minutes: ${{ inputs.profile == 'data-freshness-capacity-recovery-v1' && 360 || inputs.profile == 'data-freshness-capacity-healthy-v1' && 270 || 50 }}");
  for (const selection of [...historyProfiles, ...draftIntakeProfiles])
    expect(qualificationSourceDigest(await readFile(new URL('../' + selection.module, import.meta.url), 'utf8'))).toBe(selection.digest);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules).toHaveLength(70); expect(full.modules.filter(module => module.path === FRESH_INSTALL_MODULE)).toHaveLength(0);
  expect(full.modules.some(module => module.path.endsWith('.live-integration-case.ts'))).toBe(false);
});

async function processRecoveryFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const previous = await officialResultsEvidenceFixture();
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), PROCESS_RECOVERY_PROFILE);
  const evidence = structuredClone(previous.evidence);
  evidence.contextDigest = qualificationDigest(context);
  evidence.specifications = [{ path: PROCESS_RECOVERY_MODULE, pattern: PROCESS_RECOVERY_PATTERN, otherFilters: false }];
  evidence.collected = [PROCESS_RECOVERY_MODULE];
  evidence.modules = [{ ...evidence.modules[0], path: PROCESS_RECOVERY_MODULE,
    suites: [{ id: 'suite', name: PROCESS_RECOVERY_SUITE, mode: 'run', errors: 0 }],
    cases: PROCESS_RECOVERY_FULL_NAMES.map((name, index) => ({ ...previous.evidence.modules[0].cases[0], id: 'case-' + index, name,
      diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }];
  return { binding: { context, directory: previous.binding.directory }, evidence };
}
it('binds CP22 to seven closed cases and two hooks with acknowledged cleanup and sticky failure', async () => {
  expect(parseQualificationArguments(['--profile=' + PROCESS_RECOVERY_PROFILE])).toBe(PROCESS_RECOVERY_PROFILE);
  expect(qualificationArguments(PROCESS_RECOVERY_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', PROCESS_RECOVERY_MODULE, '--testNamePattern', PROCESS_RECOVERY_PATTERN]);
  const { binding, evidence } = await processRecoveryFixture();
  expect(binding.context.modules).toEqual([{ path: PROCESS_RECOVERY_MODULE, sourceDigest: PROCESS_RECOVERY_SOURCE_DIGEST }]);
  expect(qualificationIncludes({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context),
    PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toEqual([PROCESS_RECOVERY_MODULE]);
  expect(PROCESS_RECOVERY_FULL_NAMES).toHaveLength(7);
  const pattern = new RegExp(PROCESS_RECOVERY_PATTERN);
  for (const name of PROCESS_RECOVERY_FULL_NAMES) {
    expect(pattern.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect(DRAFT_INTAKE_RECOVERY_FULL_NAMES.some(name => pattern.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence); await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: PROCESS_RECOVERY_PROFILE,
    collected: 7, executed: 7, passed: 7, skipped: 0, filtered: 0 });
  await markQualificationFailure(binding, 'process-timeout'); await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
  for (const args of [['--profile=data-process-recovery-v2'], ['--profile', PROCESS_RECOVERY_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + PROCESS_RECOVERY_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + PROCESS_RECOVERY_PROFILE, extra])])
    expect(() => parseQualificationArguments(args)).toThrow('closed');
});
it('rejects CP22 inventory order execution hook filter source and predecessor substitution drift', async () => {
  const { binding, evidence } = await processRecoveryFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases[0].name += ' extra'; },
    r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].suites = []; }, r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; }, r => { r.hooks[0].ends = 0; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].key = 'suite:beforeEach'; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; }, r => { r.reason = 'failed'; }, r => { r.starts = 2; }, r => { r.ends = 0; },
    r => { r.contextDigest = 'f'.repeat(64); }, r => { r.modules[0].state = 'failed'; }, r => { r.modules[0].errors = 1; },
    r => { r.modules[0].cases[0].diagnostic!.flaky = true; }, r => { r.collected.push(OFFICIAL_RESULTS_MODULE); },
  ];
  for (const change of changes) { const changed = structuredClone(evidence); change(changed); expect(() => validateQualificationReport(binding.context, changed)).toThrow(); }
  const predecessor = await draftIntakeProfileFixture(draftIntakeProfiles[2]);
  expect(() => validateQualificationReport(binding.context, { ...predecessor.evidence, contextDigest: qualificationDigest(binding.context) })).toThrow();
  expect(() => validateQualificationReport(predecessor.binding.context, { ...evidence, contextDigest: qualificationDigest(predecessor.binding.context) })).toThrow();
  for (const change of [(context: typeof binding.context) => { context.modules[0].sourceDigest = 'f'.repeat(64); },
    (context: typeof binding.context) => { context.modules[0].path = OFFICIAL_RESULTS_MODULE; },
    (context: typeof binding.context) => { context.profileDigest = predecessor.binding.context.profileDigest; },
    (context: typeof binding.context) => { context.modules.push({ ...context.modules[0] }); }]) {
    const context = structuredClone(binding.context); change(context);
    expect(() => qualificationBinding({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toThrow();
  }
  await mkdir(join(binding.directory, 'integration'));
  for (const entry of PROCESS_RECOVERY_SUPPORT_SOURCES) await writeFile(join(binding.directory, entry.path),
    await readFile(new URL('../' + entry.path, import.meta.url), 'utf8'));
  await writeFile(join(binding.directory, PROCESS_RECOVERY_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), PROCESS_RECOVERY_PROFILE)).rejects.toThrow('reviewed LF digest');
});
it('independently inventories CP22 source names hooks allowance and fixed manual workflow without SQL execution', async () => {
  const path = fileURLToPath(new URL('../' + PROCESS_RECOVERY_MODULE, import.meta.url)), source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(PROCESS_RECOVERY_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [], budgets: string[] = [], hookBudgets: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); suites.push((node.arguments[0] as ts.StringLiteral).text); }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); budgets.push(node.arguments[2]?.getText(tree) ?? 'default'); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) { hooks.push(expression); hookBudgets.push(node.arguments[1]?.getText(tree) ?? 'default'); }
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(suites).toEqual([PROCESS_RECOVERY_SUITE]); expect(names).toEqual(PROCESS_RECOVERY_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']); expect(budgets).toEqual(['210_000', '270_000', '120_000', '240_000', '120_000', '240_000', '180_000']);
  expect(hookBudgets).toEqual(['90_000', '90_000']);
  // Authored allowance only: 26m cases/hooks and 4m for setup, reporting, cleanup and margin.
  expect(budgets.concat(hookBudgets).reduce((sum, value) => sum + Number(value.replaceAll('_', '')), 0)).toBe(26 * 60_000);
  expect(26 + 4).toBe(30);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow.match(/^\s+- data-process-recovery-v1$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+workflow_dispatch:data-process-recovery-v1\)$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+pnpm test:integration --profile=data-process-recovery-v1$/gmu)).toHaveLength(1);
  expect(workflow).toContain("timeout-minutes: ${{ inputs.profile == 'data-freshness-capacity-recovery-v1' && 360 || inputs.profile == 'data-freshness-capacity-healthy-v1' && 270 || 50 }}");
  for (const selection of [...historyProfiles, ...draftIntakeProfiles])
    expect(qualificationSourceDigest(await readFile(new URL('../' + selection.module, import.meta.url), 'utf8'))).toBe(selection.digest);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules).toHaveLength(70); expect(full.modules.filter(module => module.path === PROCESS_RECOVERY_MODULE)).toHaveLength(0);
  expect(full.modules.some(module => module.path.endsWith('.live-integration-case.ts'))).toBe(false);
});

it('binds CP22 worker and protocol source independently from the seven collected cases', async () => {
  const siteRoot = fileURLToPath(new URL('..', import.meta.url));
  await expect(assertProcessRecoverySupportSources(siteRoot)).resolves.toBeUndefined();
  const directory = await mkdtemp(join(tmpdir(), 'process-recovery-support-')); directories.push(directory);
  await mkdir(join(directory, 'integration'));
  const source = await readFile(new URL('../' + PROCESS_RECOVERY_MODULE, import.meta.url), 'utf8');
  await writeFile(join(directory, PROCESS_RECOVERY_MODULE), source);
  await expect(createQualificationContext(directory, 'a'.repeat(40), randomUUID(), PROCESS_RECOVERY_PROFILE)).rejects.toThrow();
  for (const entry of PROCESS_RECOVERY_SUPPORT_SOURCES) await writeFile(join(directory, entry.path),
    await readFile(new URL('../' + entry.path, import.meta.url), 'utf8'));
  const context = await createQualificationContext(directory, 'a'.repeat(40), randomUUID(), PROCESS_RECOVERY_PROFILE);
  expect(context.modules).toEqual([{ path: PROCESS_RECOVERY_MODULE, sourceDigest: PROCESS_RECOVERY_SOURCE_DIGEST }]);
  expect(PROCESS_RECOVERY_SUPPORT_SOURCES.map(entry => entry.path)).toEqual([
    'integration/process-recovery-worker.ts', 'integration/process-recovery-protocol.ts',
  ]);
  for (const entry of PROCESS_RECOVERY_SUPPORT_SOURCES) {
    const original = await readFile(join(directory, entry.path), 'utf8');
    await writeFile(join(directory, entry.path), original + '\n// unreviewed source drift\n');
    await expect(assertProcessRecoverySupportSources(directory)).rejects.toThrow('reviewed LF digest');
    await expect(createQualificationContext(directory, 'a'.repeat(40), randomUUID(), PROCESS_RECOVERY_PROFILE)).rejects.toThrow('reviewed LF digest');
    await writeFile(join(directory, entry.path), original);
  }
});

it('checks the actual CP22 draft-reader assertion against supplied status and adverse states', async () => {
  const path = fileURLToPath(new URL('../' + PROCESS_RECOVERY_MODULE, import.meta.url));
  const source = await readFile(path, 'utf8'), tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const cases: ts.CallExpression[] = [], assertions: ts.CallExpression[] = [];
  const findCase = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'it'
      && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === PROCESS_RECOVERY_TESTS[0]) cases.push(node);
    ts.forEachChild(node, findCase);
  };
  findCase(tree); expect(cases).toHaveLength(1);
  const findAssertion = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'expect(read).toMatchObject') assertions.push(node);
    ts.forEachChild(node, findAssertion);
  };
  findAssertion(cases[0]); expect(assertions).toHaveLength(1);
  const assertion = assertions[0], statuses: ts.ObjectLiteralExpression[] = [];
  const allowedKinds = new Set([ts.SyntaxKind.CallExpression, ts.SyntaxKind.PropertyAccessExpression,
    ts.SyntaxKind.Identifier, ts.SyntaxKind.ObjectLiteralExpression, ts.SyntaxKind.PropertyAssignment,
    ts.SyntaxKind.ArrayLiteralExpression, ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NumericLiteral]);
  const checkLiteral = (node: ts.Node) => {
    expect(allowedKinds.has(node.kind)).toBe(true);
    if (ts.isCallExpression(node)) expect(['expect(read).toMatchObject', 'expect', 'expect.arrayContaining',
      'expect.objectContaining']).toContain(node.expression.getText(tree));
    if (ts.isObjectLiteralExpression(node) && node.properties.map(property => property.name?.getText(tree)).join(',') === 'raw,state,value') statuses.push(node);
    ts.forEachChild(node, checkLiteral);
  };
  checkLiteral(assertion);
  const observed = { status: 'pending', drafts: [{ ordinal: 3, resource: { status: 'available',
    value: { kind: 'detail', detail: { status: { raw: 'complete', state: 'supplied', value: 'complete' } } } } }] };
  const expression = assertion.getText(tree);
  const evaluate = (read: unknown, text = expression) => runInNewContext(text, { expect, read }, { timeout: 1_000 });
  expect(() => evaluate(observed)).not.toThrow();
  const changes: ((read: typeof observed) => void)[] = [
    read => { read.drafts[0].resource.value.detail.status.raw = 'drafting'; },
    read => { read.drafts[0].resource.value.detail.status.state = 'unavailable'; },
    read => { read.drafts[0].resource.value.detail.status.value = 'drafting'; },
    read => { read.status = 'complete'; },
    read => { read.drafts[0].ordinal = 4; },
    read => { read.drafts[0].resource.status = 'unavailable'; },
    read => { read.drafts[0].resource.value.kind = 'catalog'; },
    read => { read.drafts = []; },
  ];
  for (const change of changes) {
    const adverse = structuredClone(observed); change(adverse);
    expect(() => evaluate(adverse)).toThrow();
  }
  expect(statuses).toHaveLength(1);
  const status = statuses[0], start = status.getStart(tree) - assertion.getStart(tree), end = status.end - assertion.getStart(tree);
  // Reproduce the historical partial nested literal using this same source assertion.
  const historical = expression.slice(0, start) + "{ value: 'complete' }" + expression.slice(end);
  expect(() => evaluate(observed, historical)).toThrow();
});

async function competingWorkersFixture(): Promise<{ binding: QualificationBinding; evidence: QualificationReport }> {
  const previous = await officialResultsEvidenceFixture();
  const historicalRoot = await mkdtemp(join(tmpdir(), 'cp23-historical-report-')); directories.push(historicalRoot);
  await mkdir(join(historicalRoot, 'integration'));
  for (const path of [COMPETING_WORKERS_MODULE, ...COMPETING_WORKERS_SUPPORT_SOURCES.map(entry => entry.path)])
    await writeFile(join(historicalRoot, path), path === 'integration/neon-integration-harness.ts'
      ? await historicalHarnessSource() : await readFile(new URL('../' + path, import.meta.url), 'utf8'));
  const context = await createQualificationContext(historicalRoot, 'a'.repeat(40), randomUUID(), COMPETING_WORKERS_PROFILE);
  const evidence = structuredClone(previous.evidence);
  evidence.contextDigest = qualificationDigest(context);
  evidence.specifications = [{ path: COMPETING_WORKERS_MODULE, pattern: COMPETING_WORKERS_PATTERN, otherFilters: false }];
  evidence.collected = [COMPETING_WORKERS_MODULE];
  evidence.modules = [{ ...evidence.modules[0], path: COMPETING_WORKERS_MODULE,
    suites: [{ id: 'suite', name: COMPETING_WORKERS_SUITE, mode: 'run', errors: 0 }],
    cases: COMPETING_WORKERS_FULL_NAMES.map((name, index) => ({ ...previous.evidence.modules[0].cases[0], id: 'case-' + index, name,
      diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }];
  return { binding: { context, directory: previous.binding.directory }, evidence };
}
it('binds CP23 to five closed cases and two hooks with acknowledged cleanup and sticky failure', async () => {
  expect(parseQualificationArguments(['--profile=' + COMPETING_WORKERS_PROFILE])).toBe(COMPETING_WORKERS_PROFILE);
  expect(qualificationArguments(COMPETING_WORKERS_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', COMPETING_WORKERS_MODULE, '--testNamePattern', COMPETING_WORKERS_PATTERN]);
  const { binding, evidence } = await competingWorkersFixture();
  expect(binding.context.modules).toEqual([{ path: COMPETING_WORKERS_MODULE, sourceDigest: COMPETING_WORKERS_SOURCE_DIGEST }]);
  expect(qualificationIncludes({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context),
    PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toEqual([COMPETING_WORKERS_MODULE]);
  expect(COMPETING_WORKERS_FULL_NAMES).toHaveLength(5);
  const pattern = new RegExp(COMPETING_WORKERS_PATTERN);
  for (const name of COMPETING_WORKERS_FULL_NAMES) {
    expect(pattern.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect(DRAFT_INTAKE_RECOVERY_FULL_NAMES.some(name => pattern.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence); await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: COMPETING_WORKERS_PROFILE,
    collected: 5, executed: 5, passed: 5, skipped: 0, filtered: 0 });
  await expect(writeQualificationArtifact(binding, 'report', evidence)).rejects.toThrow();
  const cleanupPath = join(binding.directory, QUALIFICATION_FILES.cleanup);
  const originalCleanup = await readFile(cleanupPath, 'utf8');
  for (const field of ['contextDigest', 'reportDigest'] as const) {
    const substituted = JSON.parse(originalCleanup); substituted[field] = 'f'.repeat(64);
    await writeFile(cleanupPath, JSON.stringify(substituted));
    await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  }
  await writeFile(cleanupPath, originalCleanup);
  await expect(validateQualificationArtifacts({ ...binding, context: { ...binding.context, nonce: randomUUID() } })).rejects.toThrow();

  await markQualificationFailure(binding, 'process-timeout'); await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
  for (const args of [['--profile=data-competing-workers-v2'], ['--profile', COMPETING_WORKERS_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + COMPETING_WORKERS_PROFILE, '--profile=' + SELECTED_PROFILE].map(extra => ['--profile=' + COMPETING_WORKERS_PROFILE, extra])])
    expect(() => parseQualificationArguments(args)).toThrow('closed');
});
it('rejects CP23 inventory order execution hook filter source and predecessor substitution drift', async () => {
  const { binding, evidence } = await competingWorkersFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases[0].name += ' extra'; },
    r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].suites = []; }, r => { r.modules[0].suites[0].mode = 'skip'; }, r => { r.modules[0].suites[0].name = 'other'; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; }, r => { r.hooks[0].ends = 0; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].key = 'suite:beforeEach'; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; }, r => { r.reason = 'failed'; }, r => { r.starts = 2; }, r => { r.ends = 0; },
    r => { r.contextDigest = 'f'.repeat(64); }, r => { r.modules[0].state = 'failed'; }, r => { r.modules[0].errors = 1; },
    r => { r.modules[0].cases[0].diagnostic!.flaky = true; }, r => { r.collected.push(OFFICIAL_RESULTS_MODULE); },
  ];
  for (const change of changes) { const changed = structuredClone(evidence); change(changed); expect(() => validateQualificationReport(binding.context, changed)).toThrow(); }
  const predecessor = await processRecoveryFixture();
  expect(() => validateQualificationReport(binding.context, { ...predecessor.evidence, contextDigest: qualificationDigest(binding.context) })).toThrow();
  expect(() => validateQualificationReport(predecessor.binding.context, { ...evidence, contextDigest: qualificationDigest(predecessor.binding.context) })).toThrow();
  for (const change of [(context: typeof binding.context) => { context.modules[0].sourceDigest = 'f'.repeat(64); },
    (context: typeof binding.context) => { context.modules[0].path = OFFICIAL_RESULTS_MODULE; },
    (context: typeof binding.context) => { context.profileDigest = predecessor.binding.context.profileDigest; },
    (context: typeof binding.context) => { context.modules.push({ ...context.modules[0] }); }]) {
    const context = structuredClone(binding.context); change(context);
    expect(() => qualificationBinding({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toThrow();
  }
  await mkdir(join(binding.directory, 'integration'));
  for (const entry of COMPETING_WORKERS_SUPPORT_SOURCES) await writeFile(join(binding.directory, entry.path),
    await readFile(new URL('../' + entry.path, import.meta.url), 'utf8'));
  await writeFile(join(binding.directory, COMPETING_WORKERS_MODULE), 'source drift');
  await expect(createQualificationContext(binding.directory, 'a'.repeat(40), randomUUID(), COMPETING_WORKERS_PROFILE)).rejects.toThrow('reviewed LF digest');
});
it('independently inventories CP23 source names hooks allowance and fixed manual workflow without SQL execution', async () => {
  const path = fileURLToPath(new URL('../' + COMPETING_WORKERS_MODULE, import.meta.url)), source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(COMPETING_WORKERS_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), names: string[] = [], hooks: string[] = [], suites: string[] = [], budgets: string[] = [], hookBudgets: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); suites.push((node.arguments[0] as ts.StringLiteral).text); }
      if (expression === 'it') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text); budgets.push(node.arguments[2]?.getText(tree) ?? 'default'); }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) { hooks.push(expression); hookBudgets.push(node.arguments[1]?.getText(tree) ?? 'default'); }
      expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(suites).toEqual([COMPETING_WORKERS_SUITE]); expect(names).toEqual(COMPETING_WORKERS_TESTS);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']); expect(budgets).toEqual(['180_000', '210_000', '240_000', '210_000', '540_000']);
  expect(hookBudgets).toEqual(['90_000', '90_000']);
  // Authored allowance only: 26m cases/hooks and 4m for setup, reporting, cleanup and margin.
  expect(budgets.concat(hookBudgets).reduce((sum, value) => sum + Number(value.replaceAll('_', '')), 0)).toBe(26 * 60_000);
  expect(26 + 4).toBe(30);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow.match(/^\s+- data-competing-workers-v1$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+workflow_dispatch:data-competing-workers-v1\)$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+pnpm test:integration --profile=data-competing-workers-v1$/gmu)).toHaveLength(1);
  expect(workflow).toContain("timeout-minutes: ${{ inputs.profile == 'data-freshness-capacity-recovery-v1' && 360 || inputs.profile == 'data-freshness-capacity-healthy-v1' && 270 || 50 }}");
  for (const selection of [...historyProfiles, ...draftIntakeProfiles])
    expect(qualificationSourceDigest(await readFile(new URL('../' + selection.module, import.meta.url), 'utf8'))).toBe(selection.digest);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules).toHaveLength(70); expect(full.modules.filter(module => module.path === COMPETING_WORKERS_MODULE)).toHaveLength(0);
  expect(full.modules.some(module => module.path.endsWith('.live-integration-case.ts'))).toBe(false);
});

it('binds CP23 worker, protocol and pinned harness source independently from the five collected cases', async () => {
  const siteRoot = fileURLToPath(new URL('..', import.meta.url));
  await expect(assertCompetingWorkersSupportSources(siteRoot)).rejects.toThrow('reviewed LF digest');
  const drift = [];
  for (const entry of COMPETING_WORKERS_SUPPORT_SOURCES) if (qualificationSourceDigest(await readFile(join(siteRoot, entry.path), 'utf8')) !== entry.sourceDigest) drift.push(entry.path);
  expect(drift).toEqual(['integration/neon-integration-harness.ts']);
  const directory = await mkdtemp(join(tmpdir(), 'competing-workers-support-')); directories.push(directory);
  await mkdir(join(directory, 'integration'));
  const source = await readFile(new URL('../' + COMPETING_WORKERS_MODULE, import.meta.url), 'utf8');
  await writeFile(join(directory, COMPETING_WORKERS_MODULE), source);
  await expect(createQualificationContext(directory, 'a'.repeat(40), randomUUID(), COMPETING_WORKERS_PROFILE)).rejects.toThrow();
  for (const entry of COMPETING_WORKERS_SUPPORT_SOURCES) await writeFile(join(directory, entry.path),
    entry.path === 'integration/neon-integration-harness.ts' ? await historicalHarnessSource() : await readFile(new URL('../' + entry.path, import.meta.url), 'utf8'));
  const context = await createQualificationContext(directory, 'a'.repeat(40), randomUUID(), COMPETING_WORKERS_PROFILE);
  expect(context.modules).toEqual([{ path: COMPETING_WORKERS_MODULE, sourceDigest: COMPETING_WORKERS_SOURCE_DIGEST }]);
  expect(COMPETING_WORKERS_SUPPORT_SOURCES.map(entry => entry.path)).toEqual([
    'integration/competing-workers-worker.ts', 'integration/competing-workers-protocol.ts', 'integration/neon-integration-harness.ts',
  ]);
  for (const entry of COMPETING_WORKERS_SUPPORT_SOURCES) {
    const original = await readFile(join(directory, entry.path), 'utf8');
    await writeFile(join(directory, entry.path), original + '\n// unreviewed source drift\n');
    await expect(assertCompetingWorkersSupportSources(directory)).rejects.toThrow('reviewed LF digest');
    await expect(createQualificationContext(directory, 'a'.repeat(40), randomUUID(), COMPETING_WORKERS_PROFILE)).rejects.toThrow('reviewed LF digest');
    await writeFile(join(directory, entry.path), original.replace(/\r?\n/gu, '\r\n'));
    await expect(assertCompetingWorkersSupportSources(directory)).resolves.toBeUndefined();
    await writeFile(join(directory, entry.path), original);
  }
});

// CP24 synthetic artifact guards only. None of these tests executes SQL or proves hosted qualification.
const frozenBackendControlCases = [
  'validates controlled submissions and retains canonical replay and conflict outcomes',
  'validates refresh identity and scope while preserving exact configuration replay',
  'serializes competing configuration CAS calls and retains only one immutable revision',
  'honors pause and expiry before admission and resumes the same immutable cycle after unpause',
  'preserves an admitted real capture and checkpoint when pause commits afterward',
  'counts paused configurations toward the sixteen target limit without mutating a rejected seventeenth',
  'retains one winner and one immutable capacity receipt under concurrent sixteen request admission',
  'reads missing pending available unavailable and capacity status without acquisition or scheduling writes',
  'enforces restricted control permissions and immutable receipt and configuration history',
];
async function backendControlsFixture(): Promise<{
  binding: QualificationBinding; evidence: QualificationReport; companion: ControlsEvidence;
}> {
  const previous = await officialResultsEvidenceFixture();
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)),
    'a'.repeat(40), randomUUID(), BACKEND_CONTROLS_PROFILE);
  const evidence = structuredClone(previous.evidence);
  evidence.contextDigest = qualificationDigest(context);
  evidence.specifications = [{ path: BACKEND_CONTROLS_MODULE, pattern: BACKEND_CONTROLS_PATTERN, otherFilters: false }];
  evidence.collected = [BACKEND_CONTROLS_MODULE];
  evidence.modules = [{ ...evidence.modules[0], path: BACKEND_CONTROLS_MODULE,
    suites: [{ id: 'suite', name: BACKEND_CONTROLS_SUITE, mode: 'run', errors: 0 }],
    cases: BACKEND_CONTROLS_FULL_NAMES.map((name, index) => ({ ...previous.evidence.modules[0].cases[0],
      id: 'case-' + index, name,
      diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }];
  const companion: ControlsEvidence = {
    kind: 'data-backend-controls-evidence-v1', contextDigest: qualificationDigest(context), gitSha: context.gitSha,
    serverVersion: '17.6', serverVersionNum: '170006', actualLogins: ['league_one_runtime', 'league_one_auth'],
    accountLoginExecuted: false, prerequisiteGets: 2, measuredGets: 2, cleanupComplete: true,
    cases: frozenBackendControlCases.map((name, index) => {
      const start = Date.UTC(2026, 9, 16) + index * 10_000, { type, ...data } = BACKEND_CONTROLS_ORACLES[index];
      return { name, limitMs: BACKEND_CONTROLS_LIMITS[index], state: 'passed', startedAt: new Date(start).toISOString(),
        endedAt: new Date(start + 1_000).toISOString(), events: [{ type, at: new Date(start + 500).toISOString(), data }] };
    }),
  };
  return { binding: { context, directory: previous.binding.directory }, evidence, companion };
}
it('binds CP24 to nine closed cases plus separate report cleanup and companion acknowledgments', async () => {
  expect(parseQualificationArguments(['--profile=' + BACKEND_CONTROLS_PROFILE])).toBe(BACKEND_CONTROLS_PROFILE);
  expect(qualificationArguments(BACKEND_CONTROLS_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', BACKEND_CONTROLS_MODULE, '--testNamePattern', BACKEND_CONTROLS_PATTERN]);
  expect(BACKEND_CONTROLS_TESTS).toEqual(frozenBackendControlCases);
  const { binding, evidence, companion } = await backendControlsFixture();
  expect(binding.context.modules).toEqual([{ path: BACKEND_CONTROLS_MODULE, sourceDigest: BACKEND_CONTROLS_SOURCE_DIGEST }]);
  expect(qualificationIncludes({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context),
    PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toEqual([BACKEND_CONTROLS_MODULE]);
  const pattern = new RegExp(BACKEND_CONTROLS_PATTERN);
  for (const name of BACKEND_CONTROLS_FULL_NAMES) {
    expect(pattern.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect(COMPETING_WORKERS_FULL_NAMES.some(name => pattern.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeBackendControlsEvidence(binding, companion);
  const rawCompanion = await readFile(join(binding.directory, BACKEND_CONTROLS_EVIDENCE_FILE), 'utf8');
  const rawReport = await readFile(join(binding.directory, QUALIFICATION_FILES.report), 'utf8');
  await expect(validateQualificationArtifacts(binding)).resolves.toEqual({
    profile: BACKEND_CONTROLS_PROFILE, collected: 9, executed: 9, passed: 9, skipped: 0, filtered: 0,
    reportDigest: qualificationSourceDigest(rawReport), companionDigest: qualificationSourceDigest(rawCompanion),
  });
  await expect(writeQualificationArtifact(binding, 'report', evidence)).rejects.toThrow();
  await expect(writeBackendControlsEvidence(binding, companion)).rejects.toThrow();
  const cleanupPath = join(binding.directory, QUALIFICATION_FILES.cleanup), originalCleanup = await readFile(cleanupPath, 'utf8');
  for (const patch of [{ contextDigest: 'f'.repeat(64) }, { reportDigest: 'f'.repeat(64) },
    { globalDatabaseCleanup: 'pending' }, { companionDigest: qualificationSourceDigest(rawCompanion) }]) {
    await writeFile(cleanupPath, JSON.stringify({ ...JSON.parse(originalCleanup), ...patch }));
    await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  }
  await writeFile(cleanupPath, originalCleanup);
  await writeFile(join(binding.directory, QUALIFICATION_FILES.report), rawReport + ' ');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeFile(join(binding.directory, QUALIFICATION_FILES.report), rawReport);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ passed: 9 });
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
  for (const args of [['--profile=data-backend-controls-v2'], ['--profile', BACKEND_CONTROLS_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + BACKEND_CONTROLS_PROFILE, '--profile=' + COMPETING_WORKERS_PROFILE]
      .map(extra => ['--profile=' + BACKEND_CONTROLS_PROFILE, extra])])
    expect(() => parseQualificationArguments(args)).toThrow('closed');
});

it('rejects CP24 missing reordered filtered retried or failed report obligations and hook drift', async () => {
  const { binding, evidence } = await backendControlsFixture();
  const changes: Record<string, (value: QualificationReport) => void> = {
    'missing case': r => { r.modules[0].cases.pop(); },
    'renamed case': r => { r.modules[0].cases[0].name += ' extra'; },
    'duplicate case': r => { r.modules[0].cases[1] = { ...r.modules[0].cases[0] }; },
    'extra case': r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    'reordered cases': r => { r.modules[0].cases.reverse(); },
    'reordered execution': r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    'skipped case': r => { r.modules[0].cases[0].state = 'skipped'; },
    'filtered case': r => { r.modules[0].cases[0].mode = 'skip'; },
    'unexecuted case': r => { r.modules[0].cases[0].diagnostic = null; },
    'retry configuration': r => { r.modules[0].cases[0].configuredRetries = true; },
    'repeat configuration': r => { r.modules[0].cases[0].configuredRepeats = 1; },
    'retried case': r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    'repeated case': r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; },
    'expected failure': r => { r.modules[0].cases[0].expectedFailure = true; },
    'duplicate ready': r => { r.modules[0].cases[0].readyEvents = 2; },
    'missing result': r => { r.modules[0].cases[0].resultEvents = 0; },
    'missing suite': r => { r.modules[0].suites = []; },
    'skipped suite': r => { r.modules[0].suites[0].mode = 'skip'; },
    'foreign suite': r => { r.modules[0].suites[0].name = COMPETING_WORKERS_SUITE; },
    'extra suite': r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    'missing afterAll': r => { r.hooks.pop(); },
    'duplicate hook': r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; },
    'incomplete hook': r => { r.hooks[0].ends = 0; },
    'extra hook': r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); },
    'per-case hook': r => { r.hooks[0].key = 'suite:beforeEach'; },
    'open pattern': r => { r.specifications[0].pattern = '.*'; },
    'extra filters': r => { r.specifications[0].otherFilters = true; },
    'unhandled error': r => { r.unhandledErrors = 1; },
    'failed report': r => { r.reason = 'failed'; },
    'repeated runner': r => { r.starts = 2; },
    'unfinished runner': r => { r.ends = 0; },
    'foreign context': r => { r.contextDigest = 'f'.repeat(64); },
    'failed module': r => { r.modules[0].state = 'failed'; },
    'module error': r => { r.modules[0].errors = 1; },
    'flaky pass': r => { r.modules[0].cases[0].diagnostic!.flaky = true; },
    'extra collection': r => { r.collected.push(COMPETING_WORKERS_MODULE); },
  };
  for (const [name, change] of Object.entries(changes)) {
    const adverse = structuredClone(evidence); change(adverse);
    expect(() => validateQualificationReport(binding.context, adverse), name).toThrow();
  }
  const predecessor = await competingWorkersFixture();
  expect(() => validateQualificationReport(binding.context,
    { ...predecessor.evidence, contextDigest: qualificationDigest(binding.context) })).toThrow();
  expect(() => validateQualificationReport(predecessor.binding.context,
    { ...evidence, contextDigest: qualificationDigest(predecessor.binding.context) })).toThrow();
});

it('rejects CP24 forged incomplete wrong-role and missing-case companion artifacts despite a passing report', async () => {
  const { binding, evidence, companion } = await backendControlsFixture();
  await writeQualificationArtifact(binding, 'report', evidence);
  await qualificationCleanup(async () => {}, binding);
  const path = join(binding.directory, BACKEND_CONTROLS_EVIDENCE_FILE);
  const changes: Record<string, (value: ControlsEvidence) => void> = {
    'foreign run': value => { value.contextDigest = 'f'.repeat(64); },
    'foreign source': value => { value.gitSha = 'f'.repeat(40); },
    'wrong role': value => { value.actualLogins = ['owner', 'league_one_auth']; },
    'missing role': value => { value.actualLogins = ['league_one_runtime']; },
    'account LOGIN substitution': value => { Object.assign(value, { accountLoginExecuted: true }); },
    'missing server version': value => { value.serverVersion = ''; },
    'inconsistent server version': value => { value.serverVersionNum = '160006'; },
    'missing case': value => { value.cases.pop(); },
    'wrong case': value => { value.cases[0].name = COMPETING_WORKERS_TESTS[0]; },
    'case order': value => { value.cases.reverse(); },
    'failed case': value => { value.cases[0].state = 'failed'; },
    'unserved case': value => { value.cases[8].state = 'unserved'; },
    'unfinished case': value => { value.cases[8].endedAt = null; },
    'no case oracle': value => { value.cases[0].events = []; },
    'forged success': value => { value.cases[0].events[0].data = { outcome: 'passed' }; },
    'missing oracle flag': value => { delete value.cases[6].events[0].data.noWork; },
    'contradicted oracle': value => { value.cases[6].events[0].data.noDispatch = false; },
    'duplicate oracle': value => { value.cases[6].events.push(structuredClone(value.cases[6].events[0])); },
    'no prerequisite': value => { value.prerequisiteGets = 0; },
    'extra acquisition': value => { value.measuredGets = 3; },
    'missing cleanup': value => { value.cleanupComplete = false; },
    'unknown field': value => { Object.assign(value, { retainedInstallation: true }); },
  };
  for (const [name, change] of Object.entries(changes)) {
    const adverse = structuredClone(companion); change(adverse);
    await writeFile(path, JSON.stringify(adverse));
    await expect(validateQualificationArtifacts(binding), name).rejects.toThrow();
  }
  for (const raw of ['', '{', 'null', '{}', ' '.repeat(QUALIFICATION_MAX_BYTES + 1)]) {
    await writeFile(path, raw);
    await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  }
  const oversized = structuredClone(companion);
  const data = Object.fromEntries(Array.from({ length: 32 }, (_, index) => ['key' + index, 'x'.repeat(300)]));
  oversized.cases[0].events = Array.from({ length: 200 }, () => ({ type: 'prerequisite',
    at: companion.cases[0].events[0].at, data }));
  const oversizedRaw = JSON.stringify(oversized);
  expect(Buffer.byteLength(oversizedRaw)).toBeGreaterThan(1024 * 1024);
  expect(Buffer.byteLength(oversizedRaw)).toBeLessThan(QUALIFICATION_MAX_BYTES);
  await writeFile(path, oversizedRaw);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('evidence budget');
  await rm(path); await mkdir(path);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('bounded regular file');
  await rm(path, { recursive: true });
  await writeBackendControlsEvidence(binding, companion);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ passed: 9 });
});

it('does not let CP24 companion completion override failed global cleanup or a foreign context', async () => {
  const { binding, evidence, companion } = await backendControlsFixture();
  await writeQualificationArtifact(binding, 'report', evidence);
  await writeBackendControlsEvidence(binding, companion);
  await expect(qualificationCleanup(async () => { throw new Error('synthetic cleanup failure'); }, binding)).rejects.toThrow();
  await expect(readFile(join(binding.directory, QUALIFICATION_FILES.cleanup), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
  const fresh = await backendControlsFixture();
  await writeQualificationArtifact(fresh.binding, 'report', fresh.evidence);
  await qualificationCleanup(async () => {}, fresh.binding);
  await writeFile(join(fresh.binding.directory, BACKEND_CONTROLS_EVIDENCE_FILE), JSON.stringify(companion));
  await expect(validateQualificationArtifacts(fresh.binding)).rejects.toThrow();
  const predecessor = await competingWorkersFixture();
  for (const change of [
    (context: QualificationBinding['context']) => { context.modules[0].sourceDigest = 'f'.repeat(64); },
    (context: QualificationBinding['context']) => { context.modules[0].path = COMPETING_WORKERS_MODULE; },
    (context: QualificationBinding['context']) => { context.profileDigest = predecessor.binding.context.profileDigest; },
    (context: QualificationBinding['context']) => { context.modules.push({ ...context.modules[0] }); },
  ]) {
    const context = structuredClone(fresh.binding.context); change(context);
    expect(() => qualificationBinding({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context),
      PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: fresh.binding.directory })).toThrow();
  }
});

it('independently inventories CP24 frozen source order hooks budget and manual workflow without SQL execution', async () => {
  const path = fileURLToPath(new URL('../' + BACKEND_CONTROLS_MODULE, import.meta.url)), source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(BACKEND_CONTROLS_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [], hooks: string[] = [], suites: string[] = [], budgets: string[] = [], hookBudgets: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') {
        expect(ts.isStringLiteral(node.arguments[0])).toBe(true); suites.push((node.arguments[0] as ts.StringLiteral).text);
      }
      if (expression === 'it') {
        expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text);
        budgets.push(node.arguments[2]?.getText(tree) ?? 'default');
      }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) {
        hooks.push(expression); hookBudgets.push(node.arguments[1]?.getText(tree) ?? 'default');
      }
      expect(expression.startsWith('it.') || expression === 'describe'
        || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(suites).toEqual(['controlled DATA submission configuration pause and stored status']);
  expect(names).toEqual(frozenBackendControlCases);
  expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']);
  expect(budgets).toEqual(['90_000', '90_000', '120_000', '180_000', '240_000', '90_000', '180_000', '90_000', '120_000']);
  expect(hookBudgets).toEqual(['240_000', '90_000']);
  // Authored limits only: actual SQL timing and the <=2-second CP26 latency target remain unmeasured.
  expect(budgets.concat(hookBudgets).reduce((sum, value) => sum + Number(value.replaceAll('_', '')), 0)).toBe(1_530_000);
  expect(1_530_000 + 270_000).toBe(30 * 60_000);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow.match(/^\s+- data-backend-controls-v1$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+workflow_dispatch:data-backend-controls-v1\)$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+pnpm test:integration --profile=data-backend-controls-v1$/gmu)).toHaveLength(1);
  expect(workflow).toContain("timeout-minutes: ${{ inputs.profile == 'data-freshness-capacity-recovery-v1' && 360 || inputs.profile == 'data-freshness-capacity-healthy-v1' && 270 || 50 }}");
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules).toHaveLength(70);
  expect(full.modules.some(module => module.path === BACKEND_CONTROLS_MODULE)).toBe(false);
  expect(full.modules.some(module => module.path.endsWith('.live-integration-case.ts'))).toBe(false);
});

it('binds CP24 evidence and fetch helpers and collected source independently and rejects missing or changed bytes', async () => {
  const siteRoot = fileURLToPath(new URL('..', import.meta.url));
  await expect(assertBackendControlsSupportSources(siteRoot)).resolves.toBeUndefined();
  const directory = await mkdtemp(join(tmpdir(), 'backend-controls-support-')); directories.push(directory);
  await mkdir(join(directory, 'integration'));
  const source = await readFile(new URL('../' + BACKEND_CONTROLS_MODULE, import.meta.url), 'utf8');
  await writeFile(join(directory, BACKEND_CONTROLS_MODULE), source);
  await expect(createQualificationContext(directory, 'a'.repeat(40), randomUUID(), BACKEND_CONTROLS_PROFILE)).rejects.toThrow();
  expect(BACKEND_CONTROLS_SUPPORT_SOURCES.map(entry => entry.path)).toEqual(['integration/backend-controls-evidence.ts', 'integration/backend-controls-fetch.ts']);
  for (const entry of BACKEND_CONTROLS_SUPPORT_SOURCES) await writeFile(join(directory, entry.path),
    await readFile(new URL('../' + entry.path, import.meta.url), 'utf8'));
  const context = await createQualificationContext(directory, 'a'.repeat(40), randomUUID(), BACKEND_CONTROLS_PROFILE);
  expect(context.modules).toEqual([{ path: BACKEND_CONTROLS_MODULE, sourceDigest: BACKEND_CONTROLS_SOURCE_DIGEST }]);
  for (const path of [BACKEND_CONTROLS_MODULE, ...BACKEND_CONTROLS_SUPPORT_SOURCES.map(entry => entry.path)]) {
    const original = await readFile(join(directory, path), 'utf8');
    await writeFile(join(directory, path), original + '\n// unreviewed source drift\n');
    await expect(createQualificationContext(directory, 'a'.repeat(40), randomUUID(), BACKEND_CONTROLS_PROFILE)).rejects.toThrow('reviewed LF digest');
    if (path !== BACKEND_CONTROLS_MODULE) await expect(assertBackendControlsSupportSources(directory)).rejects.toThrow('reviewed LF digest');
    await writeFile(join(directory, path), original.replace(/\r?\n/gu, '\r\n'));
    await expect(createQualificationContext(directory, 'a'.repeat(40), randomUUID(), BACKEND_CONTROLS_PROFILE)).resolves.toMatchObject({ modules: context.modules, profileDigest: context.profileDigest });
    await writeFile(join(directory, path), original);
  }
});

async function backendControlCaseSource(index: number) {
  const path = fileURLToPath(new URL('../' + BACKEND_CONTROLS_MODULE, import.meta.url));
  const source = await readFile(path, 'utf8'), tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const cases: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'it'
      && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === frozenBackendControlCases[index]) cases.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(cases).toHaveLength(1);
  return { tree, callback: cases[0].arguments[1] };
}

it('preserves exact milliseconds in the actual CP24 stored-status oracle for Date and ISO-string values', async () => {
  const { tree, callback } = await backendControlCaseSource(7), assertions: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'toBe' && node.arguments[0]?.getText(tree) === 'recordedRetryAt') assertions.push(node);
    ts.forEachChild(node, visit);
  };
  visit(callback); expect(assertions).toHaveLength(1);
  const assertion = assertions[0].getText(tree);
  for (const milliseconds of ['001', '780', '999']) {
    const recordedRetryAt = `2026-10-16T13:57:19.${milliseconds}Z`, date = new Date(recordedRetryAt);
    // The failed fixture's String(Date) round-trip drops nonzero milliseconds.
    expect(new Date(String(date)).toISOString()).not.toBe(recordedRetryAt);
    for (const value of [date, recordedRetryAt]) {
      expect(() => runInNewContext(assertion, { Date, expect, recordedRetryAt,
        progressRead: { request: { next_attempt_at: value } } })).not.toThrow();
      for (const offset of [-1, 1]) expect(() => runInNewContext(assertion, { Date, expect,
        recordedRetryAt: new Date(date.getTime() + offset).toISOString(),
        progressRead: { request: { next_attempt_at: value } } })).toThrow();
    }
  }
});

it('keeps actual CP24 auth probes schema-qualified and requires the exact permission-denied code', async () => {
  const { tree, callback } = await backendControlCaseSource(8), loops: ts.ForOfStatement[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isForOfStatement(node)) {
      const calls: ts.CallExpression[] = [];
      const findAuthQuery = (child: ts.Node) => {
        if (ts.isCallExpression(child) && child.expression.getText(tree) === 'auth.database.query') calls.push(child);
        ts.forEachChild(child, findAuthQuery);
      };
      findAuthQuery(node.statement);
      if (calls.length) { expect(calls).toHaveLength(1); expect(calls[0].arguments[0].getText(tree)).toBe('sql'); loops.push(node); }
    }
    ts.forEachChild(node, visit);
  };
  visit(callback); expect(loops).toHaveLength(1);
  expect(ts.isArrayLiteralExpression(loops[0].expression)).toBe(true);
  const probes = (loops[0].expression as ts.ArrayLiteralExpression).elements.map(node => {
    expect(ts.isStringLiteral(node)).toBe(true); return (node as ts.StringLiteral).text;
  });
  expect(probes).toEqual([
    "SELECT public.submit_public_data_intake('{}'::jsonb,true)", "SELECT public.configure_public_data_refresh('{}'::jsonb)",
    'SELECT * FROM public.public_data_intakes', 'SET ROLE league_one_runtime', 'CREATE TABLE public.cp24_forbidden(id integer)',
  ]);
  expect(loops[0].statement.getText(tree).replace(/\s+/gu, '')).toBe(
    "awaitexpect(auth.database.query(sql)).rejects.toMatchObject({code:'42501'});");
});

// Synthetic artifact validation only; these fixtures never connect to a database.
const frozenRunnerCycleCases = [
  'keeps omitted and explicit false selections free of DATA acquisition and writes',
  'completes the first cycle across pending pause expiry and an inter-invocation process restart',
  'completes a changed second cycle while admitted work survives pause expiry and later disablement',
  'retains both cycle histories and stored reader parity without non-DATA mutation',
];
async function runnerCyclesFixture(): Promise<{
  binding: QualificationBinding; evidence: QualificationReport; companion: RunnerCyclesEvidence;
}> {
  const previous = await officialResultsEvidenceFixture();
  // Historical report-oracle fixture only: current runtime deliberately differs
  // from CP25's immutable source pins. This never validates the current checkout.
  const context: QualificationBinding['context'] = { ...previous.binding.context, nonce: randomUUID(),
    profile: RUNNER_CYCLES_PROFILE, modules: [{ path: RUNNER_CYCLES_MODULE, sourceDigest: RUNNER_CYCLES_SOURCE_DIGEST }],
    profileDigest: qualificationDigest({ version: 1, profile: RUNNER_CYCLES_PROFILE,
      module: RUNNER_CYCLES_MODULE, pattern: RUNNER_CYCLES_PATTERN, sourceDigest: RUNNER_CYCLES_SOURCE_DIGEST,
      inventory: RUNNER_CYCLES_FULL_NAMES, supportSources: RUNNER_CYCLES_SUPPORT_SOURCES }) };
  const evidence = structuredClone(previous.evidence);
  evidence.contextDigest = qualificationDigest(context);
  evidence.specifications = [{ path: RUNNER_CYCLES_MODULE, pattern: RUNNER_CYCLES_PATTERN, otherFilters: false }];
  evidence.collected = [RUNNER_CYCLES_MODULE];
  evidence.modules = [{ ...evidence.modules[0], path: RUNNER_CYCLES_MODULE,
    suites: [{ id: 'suite', name: RUNNER_CYCLES_SUITE, mode: 'run', errors: 0 }],
    cases: RUNNER_CYCLES_FULL_NAMES.map((name, index) => ({ ...previous.evidence.modules[0].cases[0],
      id: 'case-' + index, name,
      diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }];
  const epoch = Date.UTC(2026, 9, 16), at = (seconds: number) => new Date(epoch + seconds * 1000).toISOString();
  const requests = [randomUUID(), randomUUID()], invocations: RunnerInvocation[] = [];
  const stages = ['identity', 'leagues', 'bootstrap', 'exact-matchups', 'core', 'users'];
  let claims = 2;
  function invoke(selection: RunnerInvocation['selection'], second: number, variant: 1 | 2, resource?: string, pid = 102) {
    const before = claims;
    if (selection === 'enabled') claims++;
    const gets = resource ? ['core', 'exact-matchups'].includes(resource) ? 2 : 1 : 0;
    const duration = variant === 2 && resource === 'identity' ? 5 : 1;
    invocations.push({ pid, invocation: invocations.length + 1,
      selection, variant, startedAt: at(second), invocationStartedAt: at(second), endedAt: at(second + duration), gets,
      sqlRequests: selection === 'enabled' ? 2 : 1, signalRequests: selection === 'enabled' ? 2 : 1,
      registrySqlRequests: 1, registrySignalRequests: 1, claimBefore: before, claimAfter: claims, facade: 'registry-unavailable',
      paths: Array.from({ length: gets }, () => '/v1/league/synthetic'),
      admissions: resource ? [{ resource, requestId: requests[variant - 1], generation: claims,
        admittedAt: at(second), deadlineAt: at(second + 20), outcomeAt: at(second + duration),
        outcome: 'checkpoint-committed' }] : [] });
  }
  invoke('omitted', 0, 1, undefined, 101); invoke('false', 2, 1, undefined, 101);
  invoke('enabled', 80, 1, 'identity', 101);
  invoke('enabled', 145, 1); invoke('enabled', 210, 1);
  stages.slice(1).forEach((resource, index) => invoke('enabled', 275 + index * 65, 1, resource));
  invoke('enabled', 600, 1);
  invoke('enabled', 700, 2, 'identity'); invoke('false', 710, 2);
  stages.slice(1).forEach((resource, index) => invoke('enabled', 765 + index * 65, 2, resource));
  invoke('enabled', 1090, 2);
  const directoryContentId = randomUUID();
  const companion: RunnerCyclesEvidence = {
    kind: 'data-runner-cycles-evidence-v1', contextDigest: qualificationDigest(context), gitSha: context.gitSha,
    serverVersion: '18.6 (synthetic)', serverVersionNum: '180006', actualRuntimeLogin: true, actualHttpRuntimeLogin: true,
    primaryBoundary: 'empty-registry-rejection', prerequisiteGets: 2, prerequisiteAdmissions: 2, prerequisiteClaims: 2,
    cleanupComplete: true, admissionSpacingVerified: true, invocations,
    cases: frozenRunnerCycleCases.map((name, index) => {
      const start = [0, 10, 660, 1110][index], end = [4, 650, 1100, 1112][index];
      return { name, limitMs: RUNNER_CYCLES_LIMITS[index], state: 'passed',
        startedAt: at(start), endedAt: at(end), events: [{ at: at(end), data: { ...RUNNER_CYCLES_ORACLES[index] } }] };
    }),
    cycles: ([1, 2] as const).map((number, index) => ({ number, requestId: requests[index],
      configurationRevision: index ? 4 : 1, historyDigest: String(number).repeat(64),
      dueAt: at(index ? 660 : 0), disposition: 'complete', recordedAt: at(index ? 1090.5 : 600.5), nextDueAt: at(index ? 1140 : 660),
      directoryContentId, directoryCaptureId: randomUUID(), directoryCapturedAt: at(index ? 1025 : 535),
      exactContentId: randomUUID() })),
  };
  const digest = 'a'.repeat(64), disabled = (call: RunnerInvocation) => ({ witness: 'disabled',
    selection: call.selection, pid: call.pid, invocation: call.invocation, beforeDigest: digest, afterDigest: digest });
  companion.cases[0].events.unshift(...invocations.slice(0, 2).map(call => ({ at: call.endedAt, data: disabled(call) })));
  companion.cases[1].events.unshift({ at: at(84), data: { witness: 'restart', requestId: requests[0], cycle: 1,
    checkpointBeforeDigest: digest, checkpointAfterDigest: digest, oldPid: 101, newPid: 102,
    oldBackendPid: 201, newBackendPid: 202, oldBackendStart: at(0), newBackendStart: at(83),
    deathRequestedAt: at(82), closedAt: at(83), restartedAt: at(84) } });
  for (const [index, kind] of ['pause', 'expiry'].entries()) {
    const call = invocations[3 + index];
    companion.cases[1].events.push({ at: call.endedAt, data: { witness: 'pending', kind,
      requestId: requests[0], cycle: 1, revision: 2 + index, configuredAt: at(index ? 200 : 140),
      expiresAt: at(index ? 209 : 1000), checkedAt: call.endedAt, checkpointBeforeDigest: digest, checkpointAfterDigest: digest,
      pid: call.pid, invocation: call.invocation } });
  }
  const secondIdentity = invocations.find(row => row.variant === 2 && row.admissions[0]?.resource === 'identity')!;
  companion.cases[2].events.push({ at: secondIdentity.endedAt, data: { witness: 'admitted-control', requestId: requests[1],
    configurationRevision: 5, admittedAt: at(700), pausedAt: at(701), expiredAt: at(703),
    originalDeadline: at(720), outcomeAt: at(705) } });
  const laterDisabled = invocations.find(row => row.variant === 2 && row.selection === 'false')!;
  companion.cases[2].events.push({ at: laterDisabled.endedAt, data: disabled(laterDisabled) });
  companion.cases[3].events.push({ at: at(1111), data: { witness: 'history', firstRequest: requests[0], secondRequest: requests[1],
    priorHistoryBeforeDigest: companion.cycles[0].historyDigest, priorHistoryAfterDigest: companion.cycles[0].historyDigest,
    nonDataBeforeDigest: digest, nonDataAfterDigest: digest, storedBeforeDigest: digest, storedAfterDigest: digest,
    exactBeforeDigest: digest, exactAfterDigest: digest } });
  for (const cycle of companion.cycles) {
    const call = invocations.find(row => row.variant === cycle.number && row.selection === 'enabled'
      && row.gets === 0 && row.claimAfter === (cycle.number === 1 ? 11 : 18))!;
    companion.cases[cycle.number].events.push({ at: call.endedAt, data: { witness: 'settlement', cycle: cycle.number,
      requestId: cycle.requestId, pid: call.pid, invocation: call.invocation, generation: call.claimAfter,
      beforeOutcomeCount: 0, afterOutcomeCount: 1, outcomeDigest: qualificationDigest({ disposition: 'complete',
        recordedAt: cycle.recordedAt, nextDueAt: cycle.nextDueAt }) } });
  }
  for (const entry of companion.cases) entry.events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  return { binding: { context, directory: previous.binding.directory }, evidence, companion };
}

it('binds CP25 to four exact cases and separate report companion and cleanup acceptance', async () => {
  expect(parseQualificationArguments(['--profile=' + RUNNER_CYCLES_PROFILE])).toBe(RUNNER_CYCLES_PROFILE);
  expect(qualificationArguments(RUNNER_CYCLES_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', RUNNER_CYCLES_MODULE, '--testNamePattern', RUNNER_CYCLES_PATTERN]);
  expect(RUNNER_CYCLES_TESTS).toEqual(frozenRunnerCycleCases);
  const { binding, evidence, companion } = await runnerCyclesFixture();
  expect(qualificationIncludes({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context),
    PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toEqual([RUNNER_CYCLES_MODULE]);
  const pattern = new RegExp(RUNNER_CYCLES_PATTERN);
  for (const name of RUNNER_CYCLES_FULL_NAMES) {
    expect(pattern.test(name.replaceAll(' > ', ' '))).toBe(true);
    expect(pattern.test('prefix ' + name.replaceAll(' > ', ' '))).toBe(false);
    expect(pattern.test(name.replaceAll(' > ', ' ') + ' suffix')).toBe(false);
  }
  expect(BACKEND_CONTROLS_FULL_NAMES.some(name => pattern.test(name.replaceAll(' > ', ' ')))).toBe(false);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeQualificationArtifact(binding, 'report', evidence);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeRunnerCyclesEvidence(binding, companion);
  const rawCompanion = await readFile(join(binding.directory, RUNNER_CYCLES_EVIDENCE_FILE), 'utf8');
  const rawReport = await readFile(join(binding.directory, QUALIFICATION_FILES.report), 'utf8');
  await expect(validateQualificationArtifacts(binding)).resolves.toEqual({
    profile: RUNNER_CYCLES_PROFILE, collected: 4, executed: 4, passed: 4, skipped: 0, filtered: 0,
    reportDigest: qualificationSourceDigest(rawReport), companionDigest: qualificationSourceDigest(rawCompanion),
  });
  await expect(writeQualificationArtifact(binding, 'report', evidence)).rejects.toThrow();
  await expect(writeRunnerCyclesEvidence(binding, companion)).rejects.toThrow();
  const cleanupPath = join(binding.directory, QUALIFICATION_FILES.cleanup), originalCleanup = await readFile(cleanupPath, 'utf8');
  for (const patch of [{ contextDigest: 'f'.repeat(64) }, { reportDigest: 'f'.repeat(64) },
    { globalDatabaseCleanup: 'pending' }, { companionDigest: qualificationSourceDigest(rawCompanion) }]) {
    await writeFile(cleanupPath, JSON.stringify({ ...JSON.parse(originalCleanup), ...patch }));
    await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  }
  await writeFile(cleanupPath, originalCleanup);
  await writeFile(join(binding.directory, QUALIFICATION_FILES.report), rawReport + ' ');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeFile(join(binding.directory, QUALIFICATION_FILES.report), rawReport);
  await markQualificationFailure(binding, 'process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
  for (const args of [['--profile=data-runner-cycles-v2'], ['--profile', RUNNER_CYCLES_PROFILE],
    ...['--retry=1', '--repeat=1', '--testNamePattern=x', '--config=other', '--reporter=other', '--sequence.shuffle',
      '--profile=' + RUNNER_CYCLES_PROFILE, '--profile=' + BACKEND_CONTROLS_PROFILE]
      .map(extra => ['--profile=' + RUNNER_CYCLES_PROFILE, extra])])
    expect(() => parseQualificationArguments(args)).toThrow('closed');
});

it('rejects CP25 missing reordered filtered retried and substituted report obligations', async () => {
  const { binding, evidence } = await runnerCyclesFixture();
  const changes: ((value: QualificationReport) => void)[] = [
    r => { r.modules[0].cases.pop(); }, r => { r.modules[0].cases[0].name += ' extra'; },
    r => { r.modules[0].cases.push({ ...r.modules[0].cases[0], id: 'extra', name: 'extra' }); },
    r => { r.modules[0].cases.reverse(); }, r => { r.modules[0].cases[1].diagnostic!.startTime = 1; },
    r => { r.modules[0].cases[0].state = 'skipped'; }, r => { r.modules[0].cases[0].mode = 'skip'; },
    r => { r.modules[0].cases[0].diagnostic = null; }, r => { r.modules[0].cases[0].configuredRetries = true; },
    r => { r.modules[0].cases[0].configuredRepeats = 1; }, r => { r.modules[0].cases[0].diagnostic!.retryCount = 1; },
    r => { r.modules[0].cases[0].diagnostic!.repeatCount = 1; }, r => { r.modules[0].cases[0].expectedFailure = true; },
    r => { r.modules[0].cases[0].readyEvents = 2; }, r => { r.modules[0].cases[0].resultEvents = 0; },
    r => { r.modules[0].suites = []; }, r => { r.modules[0].suites[0].mode = 'skip'; },
    r => { r.modules[0].suites[0].name = BACKEND_CONTROLS_SUITE; },
    r => { r.modules[0].suites.push({ ...r.modules[0].suites[0], id: 'extra-suite' }); },
    r => { r.hooks.pop(); }, r => { r.hooks[0].starts = 2; r.hooks[0].ends = 2; }, r => { r.hooks[0].ends = 0; },
    r => { r.hooks.push({ key: 'extra:beforeAll', starts: 1, ends: 1 }); }, r => { r.hooks[0].key = 'suite:beforeEach'; },
    r => { r.specifications[0].pattern = '.*'; }, r => { r.specifications[0].otherFilters = true; },
    r => { r.unhandledErrors = 1; }, r => { r.reason = 'failed'; }, r => { r.starts = 2; }, r => { r.ends = 0; },
    r => { r.contextDigest = 'f'.repeat(64); }, r => { r.modules[0].state = 'failed'; }, r => { r.modules[0].errors = 1; },
    r => { r.modules[0].cases[0].diagnostic!.flaky = true; }, r => { r.collected.push(BACKEND_CONTROLS_MODULE); },
  ];
  for (const change of changes) {
    const adverse = structuredClone(evidence); change(adverse);
    expect(() => validateQualificationReport(binding.context, adverse)).toThrow();
  }
  const predecessor = await backendControlsFixture();
  expect(() => validateQualificationReport(binding.context,
    { ...predecessor.evidence, contextDigest: qualificationDigest(binding.context) })).toThrow();
  expect(() => validateQualificationReport(predecessor.binding.context,
    { ...evidence, contextDigest: qualificationDigest(predecessor.binding.context) })).toThrow();
  for (const change of [
    (context: QualificationBinding['context']) => { context.modules[0].sourceDigest = 'f'.repeat(64); },
    (context: QualificationBinding['context']) => { context.modules[0].path = BACKEND_CONTROLS_MODULE; },
    (context: QualificationBinding['context']) => { context.profileDigest = predecessor.binding.context.profileDigest; },
    (context: QualificationBinding['context']) => { context.modules.push({ ...context.modules[0] }); },
  ]) {
    const context = structuredClone(binding.context); change(context);
    expect(() => qualificationBinding({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context),
      PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toThrow();
  }
});

it('rejects missing malformed foreign and incomplete CP25 companions and never overrides failed cleanup', async () => {
  const { binding, evidence, companion } = await runnerCyclesFixture();
  await writeQualificationArtifact(binding, 'report', evidence); await qualificationCleanup(async () => {}, binding);
  const path = join(binding.directory, RUNNER_CYCLES_EVIDENCE_FILE);
  const changes: ((value: RunnerCyclesEvidence) => void)[] = [
    value => { value.contextDigest = 'f'.repeat(64); }, value => { value.gitSha = 'f'.repeat(40); },
    value => { value.serverVersionNum = '170006'; }, value => { value.cases.pop(); },
    value => { value.cases[0].state = 'failed'; }, value => { value.cases[1].events = []; },
    value => { value.cases[1].events.find(event => event.data.oracle === 'first-cycle')!.data.complete = false; },
    value => { value.cases[1].events.find(event => event.data.witness === 'restart')!.data.oldPid = 999; },
    value => { value.cases[1].events.find(event => event.data.witness === 'restart')!.data.closedAt = value.cases[1].startedAt; },
    value => { value.cases[1].events.find(event => event.data.witness === 'restart')!.data.checkpointAfterDigest = 'f'.repeat(64); },
    value => { value.cases[1].events.find(event => event.data.witness === 'pending' && event.data.kind === 'pause')!.data.requestId = randomUUID(); },
    value => { value.cases[1].events.find(event => event.data.witness === 'pending' && event.data.kind === 'expiry')!.data.expiresAt = value.cases[1].endedAt; },
    value => { value.cases[2].events.find(event => event.data.witness === 'admitted-control')!.data.originalDeadline = value.cases[2].endedAt; },
    value => { value.cases[3].events.find(event => event.data.witness === 'history')!.data.priorHistoryAfterDigest = 'f'.repeat(64); },
    value => { value.cases[1].events.find(event => event.data.witness === 'settlement')!.data.beforeOutcomeCount = 1; },
    value => { value.cases[2].events.find(event => event.data.witness === 'settlement')!.data.outcomeDigest = 'f'.repeat(64); },
    value => { value.cycles[1].dueAt = value.cycles[1].nextDueAt; },
    value => { value.cycles[1].dueAt = new Date(Date.parse(value.cycles[0].nextDueAt) + 1_000).toISOString(); },
    value => { value.cycles.pop(); },
    value => { value.invocations.pop(); }, value => { value.prerequisiteGets = 0; },
    value => { value.invocations[0].sqlRequests++; },
    value => { value.invocations[0].signalRequests = 0; },
    value => { value.invocations[0].registrySqlRequests = 0; },
    value => { value.invocations[1].registrySignalRequests = 0; },
    value => { value.invocations[0].registrySqlRequests = 2; value.invocations[0].sqlRequests = 2; },
    value => { const admitted = value.invocations.find(row => row.admissions.length)!;
      admitted.signalRequests = admitted.registrySignalRequests; },
    value => { value.cleanupComplete = false; }, value => { value.admissionSpacingVerified = false; },
  ];
  for (const change of changes) {
    const adverse = structuredClone(companion); change(adverse); await writeFile(path, JSON.stringify(adverse));
    await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  }
  for (const raw of ['', '{', 'null', '{}', ' '.repeat(QUALIFICATION_MAX_BYTES + 1)]) {
    await writeFile(path, raw); await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  }
  await rm(path); await mkdir(path);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('bounded regular file');
  await rm(path, { recursive: true }); await writeRunnerCyclesEvidence(binding, companion);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ passed: 4 });
  const fresh = await runnerCyclesFixture();
  await writeQualificationArtifact(fresh.binding, 'report', fresh.evidence);
  await writeRunnerCyclesEvidence(fresh.binding, fresh.companion);
  await expect(qualificationCleanup(async () => { throw new Error('synthetic cleanup failure'); }, fresh.binding)).rejects.toThrow();
  await expect(readFile(join(fresh.binding.directory, QUALIFICATION_FILES.cleanup), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(validateQualificationArtifacts(fresh.binding)).rejects.toThrow('Sticky');
});

it('independently inventories CP25 exact source names hooks budgets and manual workflow without executing SQL', async () => {
  const path = fileURLToPath(new URL('../' + RUNNER_CYCLES_MODULE, import.meta.url)), source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(RUNNER_CYCLES_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [], hooks: string[] = [], suites: string[] = [], budgets: string[] = [], hookBudgets: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (expression === 'describe.sequential') {
        expect(ts.isStringLiteral(node.arguments[0])).toBe(true); suites.push((node.arguments[0] as ts.StringLiteral).text);
      }
      if (expression === 'it') {
        expect(ts.isStringLiteral(node.arguments[0])).toBe(true); names.push((node.arguments[0] as ts.StringLiteral).text);
        budgets.push(node.arguments[2]?.getText(tree) ?? 'default');
      }
      if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) {
        hooks.push(expression); hookBudgets.push(node.arguments[1]?.getText(tree) ?? 'default');
      }
      expect(expression.startsWith('it.') || expression === 'describe'
        || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(suites).toEqual(['complete opt-in DATA cycles through the production runner']);
  expect(names).toEqual(frozenRunnerCycleCases); expect(hooks.sort()).toEqual(['afterAll', 'beforeAll']);
  expect(budgets).toEqual(['60_000', '660_000', '600_000', '60_000']); expect(hookBudgets).toEqual(['180_000', '90_000']);
  expect(budgets.concat(hookBudgets).reduce((sum, value) => sum + Number(value.replaceAll('_', '')), 0)).toBe(1_650_000);
  expect(1_650_000 + 150_000).toBe(30 * 60_000);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow.match(/^\s+- data-runner-cycles-v1$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+workflow_dispatch:data-runner-cycles-v1\)$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+pnpm test:integration --profile=data-runner-cycles-v1$/gmu)).toHaveLength(1);
  expect(workflow).toContain("timeout-minutes: ${{ inputs.profile == 'data-freshness-capacity-recovery-v1' && 360 || inputs.profile == 'data-freshness-capacity-healthy-v1' && 270 || 50 }}");
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules).toHaveLength(70); expect(full.modules.some(module => module.path === RUNNER_CYCLES_MODULE)).toBe(false);
  expect(full.modules.some(module => module.path.endsWith('.live-integration-case.ts'))).toBe(false);
});

it('binds every CP25 support source independently without changing historical source pins', async () => {
  const siteRoot = fileURLToPath(new URL('..', import.meta.url));
  expect(RUNNER_CYCLES_SUPPORT_SOURCES.map(entry => entry.path)).toEqual([
    'integration/runner-cycles-worker.ts', 'integration/runner-cycles-protocol.ts', 'integration/runner-cycles-evidence.ts',
    'integration/integration-child-process.ts', 'integration/neon-integration-harness.ts',
    'integration/integration-database-ownership.ts', 'integration/backend-controls-fetch.ts', 'integration/disposable-integration.ts',
    'lib/projections/runtime/projection-dispatch.ts', 'lib/league-administration/public-intake-runtime.ts',
    'lib/league-administration/public-intake.ts', 'lib/league-administration/public-refresh-reader.ts',
    'lib/league-administration/public-intake-reader.ts', 'lib/league-administration/store.ts',
    'lib/database.ts', 'lib/projection-store.ts', 'lib/league-administration/neon/public-intake.ts',
    'lib/projections/adapters/neon/jobs.ts',
    'lib/league-administration/registry.ts', 'lib/league-administration/neon/enrollment.ts',
  ]);
  // CP26 changes the runtime; historical success remains bound to historical bytes.
  await expect(assertRunnerCyclesSupportSources(siteRoot)).rejects.toThrow('reviewed LF digest');
  await expect(createQualificationContext(siteRoot, 'a'.repeat(40), randomUUID(), RUNNER_CYCLES_PROFILE)).rejects.toThrow('reviewed LF digest');
  const changed = [];
  for (const entry of RUNNER_CYCLES_SUPPORT_SOURCES) {
    if (qualificationSourceDigest(await readFile(join(siteRoot, entry.path), 'utf8')) !== entry.sourceDigest) changed.push(entry.path);
  }
  expect(changed.sort()).toEqual(['integration/disposable-integration.ts', 'integration/neon-integration-harness.ts', 'lib/league-administration/neon/public-intake.ts',
    'lib/league-administration/public-intake-reader.ts', 'lib/league-administration/public-intake-runtime.ts', 'lib/league-administration/public-intake.ts', 'lib/projections/runtime/projection-dispatch.ts']);
  await expect(assertBackendControlsSupportSources(siteRoot)).resolves.toBeUndefined();
  await expect(assertCompetingWorkersSupportSources(siteRoot)).rejects.toThrow('reviewed LF digest');
  await expect(assertProcessRecoverySupportSources(siteRoot)).resolves.toBeUndefined();
});

async function batchCalibrationReportFixture() {
  const previous = await officialResultsEvidenceFixture();
  // Historical report-oracle fixture only. The resource scheduler intentionally
  // changes pinned runtime bytes; this is never a current-source qualification.
  const context: QualificationBinding['context'] = { ...previous.binding.context, nonce: randomUUID(),
    profile: BATCH_CALIBRATION_PROFILE, modules: [{ path: BATCH_CALIBRATION_MODULE, sourceDigest: BATCH_CALIBRATION_SOURCE_DIGEST }],
    profileDigest: qualificationDigest({ version: 1, profile: BATCH_CALIBRATION_PROFILE,
      module: BATCH_CALIBRATION_MODULE, pattern: BATCH_CALIBRATION_PATTERN, sourceDigest: BATCH_CALIBRATION_SOURCE_DIGEST,
      inventory: BATCH_CALIBRATION_FULL_NAMES, supportSources: BATCH_CALIBRATION_SUPPORT_SOURCES }) };
  const evidence = structuredClone(previous.evidence);
  evidence.contextDigest = qualificationDigest(context);
  evidence.specifications = [{ path: BATCH_CALIBRATION_MODULE, pattern: BATCH_CALIBRATION_PATTERN, otherFilters: false }];
  evidence.collected = [BATCH_CALIBRATION_MODULE];
  evidence.modules = [{ ...evidence.modules[0], path: BATCH_CALIBRATION_MODULE,
    suites: [{ id: 'suite', name: BATCH_CALIBRATION_SUITE, mode: 'run', errors: 0 }],
    cases: BATCH_CALIBRATION_FULL_NAMES.map((name, index) => ({ ...previous.evidence.modules[0].cases[0], id: 'case-' + index, name,
      diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }];
  return { binding: { context, directory: previous.binding.directory }, evidence };
}
it('CP26 calibration selects only its three closed cases and one protected manual workflow arm', async () => {
  const { binding, evidence } = await batchCalibrationReportFixture();
  expect(parseQualificationArguments(['--profile=' + BATCH_CALIBRATION_PROFILE])).toBe(BATCH_CALIBRATION_PROFILE);
  expect(qualificationArguments(BATCH_CALIBRATION_PROFILE, '/reporter')).toEqual(['--reporter', 'verbose', '--reporter', '/reporter', BATCH_CALIBRATION_MODULE, '--testNamePattern', BATCH_CALIBRATION_PATTERN]);
  expect(qualificationIncludes({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toEqual([BATCH_CALIBRATION_MODULE]);
  expect(() => validateQualificationReport(binding.context, evidence)).not.toThrow();
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules).toHaveLength(70); expect(full.modules.some(row => row.path === BATCH_CALIBRATION_MODULE)).toBe(false);
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow.match(/^\s+- data-batch-calibration-v1$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+workflow_dispatch:data-batch-calibration-v1\)$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+pnpm test:integration --profile=data-batch-calibration-v1$/gmu)).toHaveLength(1);
  expect(workflow).toContain("timeout-minutes: ${{ inputs.profile == 'data-freshness-capacity-recovery-v1' && 360 || inputs.profile == 'data-freshness-capacity-healthy-v1' && 270 || 50 }}"); expect(workflow).toContain('cancel-in-progress: false');
  for (const extra of ['--retry=1', '--repeat=2', '--testNamePattern=one', BATCH_CALIBRATION_MODULE])
    expect(() => parseQualificationArguments(['--profile=' + BATCH_CALIBRATION_PROFILE, extra])).toThrow();
});
it('CP26 calibration rejects missing reordered repeated skipped and errored cases', async () => {
  const { binding, evidence } = await batchCalibrationReportFixture();
  for (const mutate of [
    (row: QualificationReport) => { row.modules[0].cases.pop(); },
    (row: QualificationReport) => { row.modules[0].cases.reverse(); },
    (row: QualificationReport) => { row.modules[0].cases[1].diagnostic!.startTime = row.modules[0].cases[0].diagnostic!.startTime - 1; },
    (row: QualificationReport) => { row.modules[0].cases[0].diagnostic!.retryCount = 1; },
    (row: QualificationReport) => { row.modules[0].cases[0].state = 'skipped'; },
    (row: QualificationReport) => { row.hooks.pop(); },
  ]) { const changed = structuredClone(evidence); mutate(changed); expect(() => validateQualificationReport(binding.context, changed)).toThrow(); }
});
it('CP26 calibration keeps Vitest wall starts separate from fractional monotonic durations', async () => {
  const { binding, evidence } = await batchCalibrationReportFixture();
  // Exact diagnostics from failed hosted run 38971925652; its original status remains failed.
  const observed = [[1792187437246, 354.35534199999984], [1792187437600, 2095.4420159999995],
    [1792187439696, 954.8459750000002]];
  for (const [index, [startTime, duration]] of observed.entries()) {
    Object.assign(evidence.modules[0].cases[index].diagnostic!, { startTime, duration });
  }
  const [first, second] = evidence.modules[0].cases.map(row => row.diagnostic!);
  expect(second.startTime).toBeLessThan(first.startTime + first.duration);
  expect(() => validateQualificationReport(binding.context, evidence)).not.toThrow();
  // Equal millisecond wall starts do not establish overlap; the companion's precise spans decide it.
  second.startTime = first.startTime;
  expect(() => validateQualificationReport(binding.context, evidence)).not.toThrow();
  second.startTime = first.startTime - 1;
  expect(() => validateQualificationReport(binding.context, evidence)).toThrow('chronological source order');
});
it('CP26 calibration requires exact companion monotonic nonoverlap without relaxing any case limit', () => {
  const cases = BATCH_CASE_NAMES.map((name, index) => ({ name, limitMs: BATCH_CASE_LIMITS[index], state: 'passed' as const,
    span: { startedAt: '2026-10-16T00:00:00.000Z', endedAt: '2026-10-16T00:00:00.001Z',
      monotonicStartMs: 100 + index, monotonicEndMs: 101 + index } }));
  expect(() => assertBatchCalibrationCaseOrder(cases)).not.toThrow();
  for (const index of [1, 2]) {
    const overlapping = structuredClone(cases);
    overlapping[index].span.monotonicStartMs -= 0.000_001;
    expect(() => assertBatchCalibrationCaseOrder(overlapping)).toThrow('must not overlap');
  }
  const missing = structuredClone(cases) as import('./batch-calibration-evidence').BatchCalibrationEvidence['cases'];
  missing[1].span = null;
  expect(() => assertBatchCalibrationCaseOrder(missing)).toThrow();
  expect(BATCH_CASE_LIMITS).toEqual([60_000, 90_000, 60_000]);
});
it('CP26 calibration requires a complete companion after ordinary report and cleanup evidence', async () => {
  const { binding, evidence } = await batchCalibrationReportFixture();
  await writeQualificationArtifact(binding, 'report', evidence);
  await qualificationCleanup(async () => {}, binding);
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  await writeFile(join(binding.directory, BATCH_EVIDENCE_FILE), JSON.stringify({ kind: 'data-batch-calibration-evidence-v1', cleanupComplete: true }));
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
});
it('CP26 calibration independently inventories literal ordered cases hooks and bounded allocations without SQL', async () => {
  const path = fileURLToPath(new URL('../' + BATCH_CALIBRATION_MODULE, import.meta.url)), source = await readFile(path, 'utf8');
  expect(qualificationSourceDigest(source)).toBe(BATCH_CALIBRATION_SOURCE_DIGEST);
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), cases: string[] = [], suites: string[] = [], hooks: string[] = [], budgets: string[] = [];
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node)) { const expression = node.expression.getText(tree);
    if (['it', 'describe.sequential'].includes(expression)) { expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
      (expression === 'it' ? cases : suites).push((node.arguments[0] as ts.StringLiteral).text); }
    if (expression === 'it') budgets.push(node.arguments[2].getText(tree));
    if (['beforeAll', 'afterAll', 'beforeEach', 'afterEach'].includes(expression)) { hooks.push(expression); budgets.push(node.arguments[1].getText(tree)); }
    expect(expression.startsWith('it.') || expression === 'describe' || expression.startsWith('describe.') && expression !== 'describe.sequential').toBe(false);
  } ts.forEachChild(node, visit); }; visit(tree);
  expect(cases).toEqual([...BATCH_CASE_NAMES]); expect(suites).toEqual([BATCH_CALIBRATION_SUITE]); expect(hooks).toEqual(['beforeAll', 'afterAll']);
  expect(budgets).toEqual(['60_000', '60_000', ...BATCH_CASE_LIMITS.map(value => value === 90_000 ? '90_000' : '60_000')]);
  expect(budgets.reduce((sum, value) => sum + Number(value.replaceAll('_', '')), 0)).toBe(330_000);
  expect(source).toContain("const result=await command('enabled')"); expect(source.match(/command\('enabled'\)/gu)).toHaveLength(1);
});
it('CP26 calibration preserves historical source pins and rejects current scheduler drift', async () => {
  const siteRoot = fileURLToPath(new URL('..', import.meta.url));
  await expect(assertBatchCalibrationSupportSources(siteRoot)).rejects.toThrow('reviewed LF digest');
  await expect(createQualificationContext(siteRoot, 'a'.repeat(40), randomUUID(), BATCH_CALIBRATION_PROFILE)).rejects.toThrow('reviewed LF digest');
  const changed: string[] = [];
  for (const entry of BATCH_CALIBRATION_SUPPORT_SOURCES) {
    if (qualificationSourceDigest(await readFile(join(siteRoot, entry.path), 'utf8')) !== entry.sourceDigest) changed.push(entry.path);
  }
  expect(changed.sort()).toEqual(['integration/disposable-integration.ts', 'integration/neon-integration-harness.ts', 'lib/league-administration/neon/public-intake.ts',
    'lib/league-administration/public-intake-contracts.ts', 'lib/league-administration/public-intake-reader.ts',
    'lib/league-administration/public-intake-runtime.ts', 'lib/league-administration/public-intake.ts', 'scripts/provision-runtime-role.sql']);
  // Read the actual reviewed historical bytes from local Git objects. The verify
  // workflow checks out full history; no test-time network or substitute source.
  const historicalSha = '5baa4498f04b77b436668b7193da69cfec787ae1';
  const git = promisify(execFile);
  const directory = await mkdtemp(join(tmpdir(), 'batch-calibration-support-')); directories.push(directory);
  for (const path of [BATCH_CALIBRATION_MODULE, ...BATCH_CALIBRATION_SUPPORT_SOURCES.map(row => row.path)]) {
    let source: string;
    try { source = (await git('git', ['show', `${historicalSha}:apps/site/${path}`], { cwd: siteRoot, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })).stdout; }
    catch { throw new Error(`Historical CP26 source object required locally: ${historicalSha}:apps/site/${path}`); }
    await mkdir(dirname(join(directory, path)), { recursive: true }); await writeFile(join(directory, path), source);
  }
  await expect(assertBatchCalibrationSupportSources(directory)).resolves.toBeUndefined();
  const context = await createQualificationContext(directory, 'a'.repeat(40), randomUUID(), BATCH_CALIBRATION_PROFILE);
  for (const path of [BATCH_CALIBRATION_MODULE, ...BATCH_CALIBRATION_SUPPORT_SOURCES.map(row => row.path)]) {
    const original = await readFile(join(directory, path), 'utf8'); await writeFile(join(directory, path), original + '\n// source drift\n');
    await expect(createQualificationContext(directory, 'a'.repeat(40), randomUUID(), BATCH_CALIBRATION_PROFILE)).rejects.toThrow('reviewed LF digest');
    await writeFile(join(directory, path), original.replace(/\r?\n/gu, '\r\n'));
    await expect(createQualificationContext(directory, 'a'.repeat(40), randomUUID(), BATCH_CALIBRATION_PROFILE)).resolves.toMatchObject({ modules: context.modules, profileDigest: context.profileDigest });
    await writeFile(join(directory, path), original);
  }
  await expect(assertRunnerCyclesSupportSources(siteRoot)).rejects.toThrow('reviewed LF digest');
});

async function fleetReportFixture(profile:'data-freshness-capacity-healthy-v1'|'data-freshness-capacity-recovery-v1'|'data-freshness-capacity-daily-v1'|'data-live-public-batch-v1'|'data-freshness-capacity-ownership-v1'){
 const previous=await officialResultsEvidenceFixture(),fleet=await import('./freshness-capacity-profile');
 const pins=await import('./qualification-profile');
 const inventory={
  [fleet.FLEET_HEALTHY_PROFILE]:{names:fleet.FLEET_HEALTHY_FULL_NAMES,suite:fleet.FLEET_HEALTHY_SUITE,module:fleet.FLEET_HEALTHY_MODULE,sourceDigest:pins.FLEET_HEALTHY_SOURCE_DIGEST},
  [fleet.FLEET_RECOVERY_PROFILE]:{names:fleet.FLEET_RECOVERY_FULL_NAMES,suite:fleet.FLEET_RECOVERY_SUITE,module:fleet.FLEET_RECOVERY_MODULE,sourceDigest:pins.FLEET_RECOVERY_SOURCE_DIGEST},
  [fleet.FLEET_DAILY_PROFILE]:{names:fleet.FLEET_DAILY_FULL_NAMES,suite:fleet.FLEET_DAILY_SUITE,module:fleet.FLEET_DAILY_MODULE,sourceDigest:pins.FLEET_DAILY_SOURCE_DIGEST},
  [fleet.FLEET_LIVE_PROFILE]:{names:fleet.FLEET_LIVE_FULL_NAMES,suite:fleet.FLEET_LIVE_SUITE,module:fleet.FLEET_LIVE_MODULE,sourceDigest:pins.FLEET_LIVE_SOURCE_DIGEST},
  [fleet.FLEET_OWNERSHIP_PROFILE]:{names:fleet.FLEET_OWNERSHIP_FULL_NAMES,suite:fleet.FLEET_OWNERSHIP_SUITE,module:fleet.FLEET_OWNERSHIP_MODULE,sourceDigest:pins.FLEET_OWNERSHIP_SOURCE_DIGEST},
 };
 const {names,suite,module:modulePath,sourceDigest}=inventory[profile],pattern=qualificationArguments(profile,'reporter').at(-1)!;
 // Historical report-oracle fixture only (DATA-CP27-2026-10-18-OWNER-LOSS-PIN-ISOLATION-SCOPE).
 // The source-binding test below independently restores and verifies the exact CP26 bytes.
 const context:QualificationBinding['context']={...previous.binding.context,nonce:randomUUID(),profile,
  modules:[{path:modulePath,sourceDigest}],profileDigest:qualificationDigest({version:1,profile,module:modulePath,
   pattern,sourceDigest,inventory:names,supportSources:pins.FLEET_SUPPORT_SOURCES})};
 const evidence=structuredClone(previous.evidence);evidence.contextDigest=qualificationDigest(context);evidence.specifications=[{path:modulePath,pattern,otherFilters:false}];evidence.collected=[modulePath];evidence.modules=[{...evidence.modules[0],path:modulePath,suites:[{id:'suite',name:suite,mode:'run',errors:0}],cases:names.map((name,index)=>({...previous.evidence.modules[0].cases[0],id:'case-'+index,name,diagnostic:{retryCount:0,repeatCount:0,flaky:false,duration:1,startTime:1234+index*2}}))}];return{binding:{context,directory:previous.binding.directory},evidence,modulePath,names,pattern};
}
for(const profile of ['data-freshness-capacity-healthy-v1','data-freshness-capacity-recovery-v1','data-freshness-capacity-daily-v1','data-live-public-batch-v1','data-freshness-capacity-ownership-v1'] as const){
 it('CP26 fleet registers only the exact source-bound selector '+profile,async()=>{const{binding,evidence,modulePath,pattern}=await fleetReportFixture(profile);expect(parseQualificationArguments(['--profile='+profile])).toBe(profile);expect(qualificationArguments(profile,'/reporter')).toEqual(['--reporter','verbose','--reporter','/reporter',...(profile==='data-live-public-batch-v1'||profile==='data-freshness-capacity-ownership-v1'?['--configLoader','runner']:[]),modulePath,'--testNamePattern',pattern]);expect(qualificationIncludes({[QUALIFICATION_CONTEXT_ENV]:JSON.stringify(binding.context),PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY:binding.directory})).toEqual([modulePath]);expect(()=>validateQualificationReport(binding.context,evidence)).not.toThrow();for(const extra of ['--retry=1','--repeat=2','--testNamePattern=one',modulePath])expect(()=>parseQualificationArguments(['--profile='+profile,extra])).toThrow();});
 it('CP26 fleet rejects incomplete reordered retried filtered or unhooked cases '+profile,async()=>{const{binding,evidence}=await fleetReportFixture(profile);for(const mutate of [(row:QualificationReport)=>{row.modules[0].cases.pop();},(row:QualificationReport)=>{row.modules[0].cases.reverse();},(row:QualificationReport)=>{row.modules[0].cases[1].diagnostic!.startTime=0;},(row:QualificationReport)=>{row.modules[0].cases[0].diagnostic!.retryCount=1;},(row:QualificationReport)=>{row.modules[0].cases[0].state='skipped';},(row:QualificationReport)=>{row.hooks.pop();}]){const changed=structuredClone(evidence);mutate(changed);expect(()=>validateQualificationReport(binding.context,changed)).toThrow();}});
 it('CP26 fleet requires the semantic chunk companion after report and cleanup '+profile,async()=>{const{binding,evidence}=await fleetReportFixture(profile);await writeQualificationArtifact(binding,'report',evidence);await qualificationCleanup(async()=>{},binding);await expect(validateQualificationArtifacts(binding)).rejects.toThrow();await writeFile(join(binding.directory,profile==='data-live-public-batch-v1'?'cp26-fleet-live-evidence.json':profile==='data-freshness-capacity-ownership-v1'?'cp26-fleet-ownership-evidence.json':profile.endsWith('daily-v1')?'cp26-fleet-daily-evidence.json':profile.endsWith('healthy-v1')?'cp26-fleet-healthy-evidence.json':'cp26-fleet-recovery-evidence.json'),JSON.stringify({kind:'forged',pass:true,cleanup:true}));await expect(validateQualificationArtifacts(binding)).rejects.toThrow();});
}
it('CP26 fleet binds frozen support bytes rejects current harness and supervisor drift and preserves LF portability',async()=>{
 const {FLEET_SUPPORT_SOURCES,assertFleetSupportSources}=await import('./qualification-profile'),fleet=await import('./freshness-capacity-profile');
 const sourceRoot=fileURLToPath(new URL('..',import.meta.url)),supervisorPath='integration/disposable-integration.ts',harnessPath='integration/neon-integration-harness.ts';
 expect(FLEET_SUPPORT_SOURCES).toHaveLength(121);expect(new Set(FLEET_SUPPORT_SOURCES.map(row=>row.path)).size).toBe(121);
 for(const path of fleet.FLEET_QUERY_SOURCE_PATHS)expect(FLEET_SUPPORT_SOURCES.some(row=>row.path===path)).toBe(true);
 expect(FLEET_SUPPORT_SOURCES.filter(row=>row.path.startsWith('migrations/'))).toHaveLength(62);
 // Source-only historical fixture: local immutable Git objects, never a network fallback.
 // Independently confirmed in DATA-CP27-2026-10-18-OWNER-LOSS-PIN-ISOLATION-SCOPE.
 const historicalSha='82c2ebf4e16ae707b8bb8f738b917cec441c5c11',git=promisify(execFile);
 const historicalSource=async(path:string)=>{
  try{return(await git('git',['show',historicalSha+':apps/site/'+path],{cwd:sourceRoot,encoding:'utf8',maxBuffer:2*1024*1024})).stdout;}
  catch{throw new Error('Historical CP26 source object required locally: '+historicalSha+':apps/site/'+path);}
 };
 const [historicalSupervisor,historicalHarness,historicalProfiles,currentProfiles]=await Promise.all([historicalSource(supervisorPath),historicalSource(harnessPath),
  historicalSource('integration/qualification-profile.ts'),readFile(join(sourceRoot,'integration/qualification-profile.ts'),'utf8')]);
 const supportPattern=/export const FLEET_SUPPORT_SOURCES = \[[\s\S]*?\] as const;/u;
 const frozenSupport=historicalProfiles.match(supportPattern)?.[0],currentSupport=currentProfiles.match(supportPattern)?.[0];
 expect(frozenSupport).toBeDefined();expect(currentSupport).toBeDefined();
 expect(qualificationSourceDigest(currentSupport!)).toBe(qualificationSourceDigest(frozenSupport!));
 for(const name of ['HEALTHY','RECOVERY','DAILY','LIVE','OWNERSHIP']){
  const pattern=new RegExp("export const FLEET_"+name+"_SOURCE_DIGEST = '[a-f0-9]{64}';",'u');
  const frozen=historicalProfiles.match(pattern)?.[0];expect(frozen).toBeDefined();expect(currentProfiles.match(pattern)?.[0]).toBe(frozen);
 }
 expect(qualificationSourceDigest(historicalSupervisor)).toBe(FLEET_SUPPORT_SOURCES.find(row=>row.path===supervisorPath)!.sourceDigest);
 const changed:string[]=[];for(const entry of FLEET_SUPPORT_SOURCES){
  if(qualificationSourceDigest(await readFile(join(sourceRoot,entry.path),'utf8'))!==entry.sourceDigest)changed.push(entry.path);
 }
 expect(changed.slice().sort()).toEqual([supervisorPath,harnessPath].sort());
 expect(qualificationSourceDigest(historicalHarness)).toBe(FLEET_SUPPORT_SOURCES.find(row=>row.path===harnessPath)!.sourceDigest);
 await expect(assertFleetSupportSources(sourceRoot)).rejects.toThrow('reviewed LF digest: '+changed[0]);
 await expect(createQualificationContext(sourceRoot,'a'.repeat(40),randomUUID(),fleet.FLEET_HEALTHY_PROFILE))
  .rejects.toThrow('reviewed LF digest: '+changed[0]);
 const directory=await mkdtemp(join(tmpdir(),'cp26-fleet-registration-'));directories.push(directory);const siteRoot=join(directory,'apps/site');
 const paths=[fleet.FLEET_HEALTHY_MODULE,fleet.FLEET_RECOVERY_MODULE,fleet.FLEET_DAILY_MODULE,fleet.FLEET_LIVE_MODULE,fleet.FLEET_OWNERSHIP_MODULE,...FLEET_SUPPORT_SOURCES.map(row=>row.path)];
 for(const path of paths){await mkdir(dirname(join(siteRoot,path)),{recursive:true});
  await writeFile(join(siteRoot,path),path===supervisorPath?historicalSupervisor:path===harnessPath?historicalHarness:await readFile(join(sourceRoot,path)));}
 await expect(assertFleetSupportSources(siteRoot)).resolves.toBeUndefined();
 const context=await createQualificationContext(siteRoot,'a'.repeat(40),randomUUID(),fleet.FLEET_HEALTHY_PROFILE);
 for(const path of [supervisorPath,harnessPath,fleet.FLEET_HEALTHY_MODULE,'integration/freshness-capacity-observer.ts','integration/freshness-capacity-protocol.ts','integration/freshness-capacity-profile.ts','integration/freshness-capacity-recovery.ts','test-support/fixtures/cp26-named-source-2026.json','migrations/061_public_data_active_brackets.sql','migrations/062_public_data_settled_request_budget.sql']){const file=join(siteRoot,path),original=await readFile(file,'utf8');await writeFile(file,original+'\n ');await expect(createQualificationContext(siteRoot,'a'.repeat(40),randomUUID(),fleet.FLEET_HEALTHY_PROFILE)).rejects.toThrow('reviewed LF digest');await writeFile(file,original.replace(/\r?\n/gu,'\r\n'));await expect(createQualificationContext(siteRoot,'a'.repeat(40),randomUUID(),fleet.FLEET_HEALTHY_PROFILE)).resolves.toMatchObject({modules:context.modules,profileDigest:context.profileDigest});await writeFile(file,original);}
 for(const [profile,modulePath]of [[fleet.FLEET_LIVE_PROFILE,fleet.FLEET_LIVE_MODULE],[fleet.FLEET_OWNERSHIP_PROFILE,fleet.FLEET_OWNERSHIP_MODULE]] as const){
  const context=await createQualificationContext(siteRoot,'a'.repeat(40),randomUUID(),profile),file=join(siteRoot,modulePath),original=await readFile(file,'utf8');
  await writeFile(file,original+'\n// altered short profile\n');await expect(createQualificationContext(siteRoot,'a'.repeat(40),randomUUID(),profile)).rejects.toThrow('reviewed LF digest');
  await writeFile(file,original.replace(/\r?\n/gu,'\r\n'));await expect(createQualificationContext(siteRoot,'a'.repeat(40),randomUUID(),profile)).resolves.toMatchObject({modules:context.modules,profileDigest:context.profileDigest});await writeFile(file,original);
 }

});
it('CP26 fleet stays out of default discovery and freezes each explicit case inventory',async()=>{
 const fleet=await import('./freshness-capacity-profile');
 const full=await createQualificationContext(fileURLToPath(new URL('..',import.meta.url)),'a'.repeat(40),randomUUID());expect(full.modules).toHaveLength(70);
 const profiles=[
  [fleet.FLEET_HEALTHY_MODULE,fleet.FLEET_HEALTHY_TESTS,'FLEET_HEALTHY'],
  [fleet.FLEET_RECOVERY_MODULE,fleet.FLEET_RECOVERY_TESTS,'FLEET_RECOVERY'],
  [fleet.FLEET_DAILY_MODULE,fleet.FLEET_DAILY_TESTS,'FLEET_DAILY'],
  [fleet.FLEET_LIVE_MODULE,fleet.FLEET_LIVE_TESTS,'FLEET_LIVE'],
  [fleet.FLEET_OWNERSHIP_MODULE,fleet.FLEET_OWNERSHIP_TESTS,'FLEET_OWNERSHIP'],
 ] as const;
 for(const [modulePath,names,symbol]of profiles){
  expect(full.modules.some(row=>row.path===modulePath)).toBe(false);
  const source=await readFile(new URL('../'+modulePath,import.meta.url),'utf8'),tree=ts.createSourceFile(modulePath,source,ts.ScriptTarget.Latest,true),cases:string[]=[],hooks:string[]=[],suites:string[]=[];
  const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)){const expression=node.expression.getText(tree);if(expression==='it')cases.push(node.arguments[0].getText(tree));if(expression==='describe.sequential')suites.push(node.arguments[0].getText(tree));if(['beforeAll','afterAll','beforeEach','afterEach'].includes(expression))hooks.push(expression);expect(expression.startsWith('it.')||expression==='describe'||expression.startsWith('describe.')&&expression!=='describe.sequential').toBe(false);}ts.forEachChild(node,visit);};visit(tree);
  expect(cases).toEqual(names.map((_,index)=>symbol+'_TESTS['+index+']'));expect(suites).toEqual([symbol+'_SUITE']);expect(hooks).toEqual(['beforeAll','afterAll']);
 }
});

it('CP26 short CI choices preserve protected execution and retain ownership journals', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  for (const profile of ['data-live-public-batch-v1', 'data-freshness-capacity-ownership-v1'] as const) {
    expect(parseQualificationArguments(['--profile=' + profile])).toBe(profile);
    expect(workflow.match(new RegExp('^ {10}- ' + profile + '\\r?$', 'gmu'))).toHaveLength(1);
    expect(workflow.match(new RegExp('^ {12}workflow_dispatch:' + profile + '\\)\\r?$', 'gmu'))).toHaveLength(1);
    expect(workflow.match(new RegExp('^ {14}pnpm test:integration --profile=' + profile + '\\r?$', 'gmu'))).toHaveLength(1);
  }
  const artifactPaths = workflow.split('      - name: Preserve sanitized integration evidence')[1]
    .split('          path: |')[1].split('          if-no-files-found:')[0]
    .trim().split(/\r?\n/u).map(value => value.trim());
  expect(artifactPaths).toEqual([
    'test-results/integration/*.json',
    'test-results/integration/artifacts/**/*.json',
    'test-results/integration/artifacts/**/ownership-journal-*.ndjson',
  ]);
  expect(workflow).toContain("    environment: integration-test");
  expect(workflow).toContain("  group: integration-test");
  expect(workflow).toContain("  cancel-in-progress: false");
  expect(workflow).toContain("          ref: ${{ github.sha }}");
  expect(workflow).toContain("          persist-credentials: false");
  expect(workflow).toContain("          NEON_TEST_API_KEY: ${{ secrets.NEON_TEST_API_KEY }}");
  expect(workflow).toContain("timeout-minutes: ${{ inputs.profile == 'data-freshness-capacity-recovery-v1' && 360 || inputs.profile == 'data-freshness-capacity-healthy-v1' && 270 || 50 }}");
  expect(workflow).not.toContain('workflow_dispatch:data-freshness-capacity-daily-v1)');
  expect(workflow).not.toContain('pull_request_target:');
});


it('CP26 short live profile loads the actual integration config with its emitted loader', async () => {
  const { binding, modulePath } = await fleetReportFixture('data-live-public-batch-v1');
  const args = qualificationArguments('data-live-public-batch-v1', '/reporter');
  const script = `
    import net from 'node:net';
    import path from 'node:path';
    import { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    net.Socket.prototype.connect = function () { throw new Error('Config-only regression forbids network'); };
    const require = createRequire(path.join(process.cwd(), 'package.json'));
    const vitestRequire = createRequire(require.resolve('vitest/package.json'));
    const { loadConfigFromFile } = await import(pathToFileURL(vitestRequire.resolve('vite')).href);
    const args = JSON.parse(process.argv[1]);
    const index = args.indexOf('--configLoader');
    const loader = index < 0 ? undefined : args[index + 1];
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' },
      path.resolve('vitest.integration.config.ts'), process.cwd(), 'silent', undefined, loader);
    const { test, resolve } = loaded.config;
    console.log(JSON.stringify({ loader, include: test.include, environment: test.environment,
      globalSetup: test.globalSetup, fileParallelism: test.fileParallelism, maxWorkers: test.maxWorkers,
      hookTimeout: test.hookTimeout, testTimeout: test.testTimeout, includeTaskLocation: test.includeTaskLocation,
      serverOnlyAlias: resolve.alias['server-only'] }));
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(args)], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { NODE_ENV: 'test', SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP,
      [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory },
    timeout: 4_000, maxBuffer: 64 * 1024, windowsHide: true, encoding: 'utf8',
  });
  expect(JSON.parse(stdout)).toEqual({ loader: 'runner', include: [modulePath], environment: 'node',
    globalSetup: ['./integration/global-setup.ts'], fileParallelism: false, maxWorkers: 1,
    hookTimeout: 120_000, testTimeout: 60_000, includeTaskLocation: true,
    serverOnlyAlias: fileURLToPath(new URL('./server-only-stub.ts', import.meta.url)) });
});


async function readerPerformanceReportFixture() {
  const previous = await officialResultsEvidenceFixture();
  const context: QualificationBinding['context'] = { ...previous.binding.context, nonce: randomUUID(),
    profile: READER_PERFORMANCE_PROFILE,
    modules: [{ path: READER_PERFORMANCE_MODULE, sourceDigest: READER_PERFORMANCE_SOURCE_DIGEST }],
    profileDigest: qualificationDigest({ version: 1, profile: READER_PERFORMANCE_PROFILE,
      module: READER_PERFORMANCE_MODULE, pattern: READER_PERFORMANCE_PATTERN, sourceDigest: READER_PERFORMANCE_SOURCE_DIGEST,
      inventory: READER_PERFORMANCE_FULL_NAMES, supportSources: READER_PERFORMANCE_SUPPORT_SOURCES }) };
  const evidence = structuredClone(previous.evidence);
  evidence.contextDigest = qualificationDigest(context);
  evidence.specifications = [{ path: READER_PERFORMANCE_MODULE, pattern: READER_PERFORMANCE_PATTERN, otherFilters: false }];
  evidence.collected = [READER_PERFORMANCE_MODULE];
  evidence.modules = [{ ...evidence.modules[0], path: READER_PERFORMANCE_MODULE,
    suites: [{ id: 'suite', name: READER_PERFORMANCE_SUITE, mode: 'run', errors: 0 }],
    cases: READER_PERFORMANCE_FULL_NAMES.map((name, index) => ({ ...previous.evidence.modules[0].cases[0],
      id: 'case-' + index, name,
      diagnostic: { retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 + index * 2 } })) }];
  return { binding: { context, directory: previous.binding.directory }, evidence };
}

it('CP27 selects only the three fixed reader cases and one protected manual workflow arm', async () => {
  const { binding, evidence } = await readerPerformanceReportFixture();
  expect(parseQualificationArguments(['--profile=' + READER_PERFORMANCE_PROFILE])).toBe(READER_PERFORMANCE_PROFILE);
  expect(qualificationArguments(READER_PERFORMANCE_PROFILE, '/reporter')).toEqual([
    '--reporter', 'verbose', '--reporter', '/reporter', '--configLoader', 'runner', READER_PERFORMANCE_MODULE, '--testNamePattern', READER_PERFORMANCE_PATTERN]);
  expect(qualificationIncludes({ [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context),
    PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory })).toEqual([READER_PERFORMANCE_MODULE]);
  expect(() => validateQualificationReport(binding.context, evidence)).not.toThrow();
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules).toHaveLength(70);
  expect(full.modules.some(module => module.path === READER_PERFORMANCE_MODULE)).toBe(false);
  const pattern = new RegExp(READER_PERFORMANCE_PATTERN);
  for (const name of READER_PERFORMANCE_FULL_NAMES) {
    const selectorName = name.replaceAll(' > ', ' ');
    expect(pattern.test(selectorName)).toBe(true); expect(pattern.test(selectorName + ' extra')).toBe(false);
    expect(pattern.test('prefix ' + selectorName)).toBe(false);
  }
  const workflow = await readFile(new URL('../../../.github/workflows/integration.yml', import.meta.url), 'utf8');
  expect(workflow.match(/^\s+- data-reader-performance-v1$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+workflow_dispatch:data-reader-performance-v1\)$/gmu)).toHaveLength(1);
  expect(workflow.match(/^\s+pnpm test:integration --profile=data-reader-performance-v1$/gmu)).toHaveLength(1);
  expect(workflow).toContain("timeout-minutes: ${{ inputs.profile == 'data-freshness-capacity-recovery-v1' && 360 || inputs.profile == 'data-freshness-capacity-healthy-v1' && 270 || 50 }}");
  expect(workflow).toContain('cancel-in-progress: false');
  for (const args of [['--profile=data-reader-performance-v2'], ['--profile', READER_PERFORMANCE_PROFILE],
    ...['--retry=1', '--repeat=2', '--testNamePattern=one', READER_PERFORMANCE_MODULE,
      '--profile=' + BATCH_CALIBRATION_PROFILE].map(extra => ['--profile=' + READER_PERFORMANCE_PROFILE, extra])]) {
    expect(() => parseQualificationArguments(args)).toThrow();
  }
});

it('CP27 rejects missing reordered retried skipped and malformed report execution', async () => {
  const { binding, evidence } = await readerPerformanceReportFixture();
  const mutations: ((value: QualificationReport) => void)[] = [
    value => { value.modules[0].cases.pop(); },
    value => { value.modules[0].cases.reverse(); },
    value => { value.modules[0].cases[0].configuredRepeats = 1; },
    value => { value.modules[0].cases[0].configuredRetries = true; },
    value => { value.modules[0].cases[0].state = 'skipped'; },
    value => { value.modules[0].cases[0].diagnostic = null; },
    value => { value.modules[0].cases[1].diagnostic!.startTime = 1; },
    value => { value.modules[0].cases[1].diagnostic!.retryCount = 1; },
    value => { value.modules[0].cases[1].errors = 1; },
    value => { value.hooks.pop(); },
    value => { value.hooks[0].starts = 2; },
    value => { value.specifications[0].otherFilters = true; },
    value => { value.specifications[0].pattern = '.*'; },
    value => { value.contextDigest = '0'.repeat(64); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(evidence); mutate(changed);
    expect(() => validateQualificationReport(binding.context, changed)).toThrow();
  }
});

it.each(['missing', 'forged', 'oversized'] as const)('CP27 rejects a %s semantic companion after report and acknowledged cleanup', async kind => {
  const { binding, evidence } = await readerPerformanceReportFixture();
  await writeQualificationArtifact(binding, 'report', evidence);
  await qualificationCleanup(async () => {}, binding);
  const companion = join(binding.directory, READER_PERFORMANCE_EVIDENCE_FILE);
  if (kind === 'forged') await writeFile(companion, JSON.stringify({ kind: 'forged', pass: true, cleanup: true }));
  if (kind === 'oversized') await writeFile(companion, ' '.repeat(QUALIFICATION_MAX_BYTES + 1));
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
});

it('CP27 source pins bind its module helper and existing reader dependencies without changing old pins', async () => {
  const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
  await expect(assertReaderPerformanceSupportSources(sourceRoot)).resolves.toBeUndefined();
  expect(READER_PERFORMANCE_SUPPORT_SOURCES).toHaveLength(26);
  expect(new Set(READER_PERFORMANCE_SUPPORT_SOURCES.map(entry => entry.path)).size).toBe(26);
  const source = await readFile(join(sourceRoot, READER_PERFORMANCE_MODULE), 'utf8');
  expect(qualificationSourceDigest(source)).toBe(READER_PERFORMANCE_SOURCE_DIGEST);
  const companion = await import('./reader-performance');
  expect(companion.READER_PERFORMANCE_PROFILE).toBe(READER_PERFORMANCE_PROFILE);
  expect(companion.READER_PERFORMANCE_MODULE).toBe(READER_PERFORMANCE_MODULE);
  expect(companion.READER_PERFORMANCE_SUITE).toBe(READER_PERFORMANCE_SUITE);
  expect(companion.READER_PERFORMANCE_TESTS).toEqual(READER_PERFORMANCE_TESTS);
  expect(companion.READER_PERFORMANCE_FULL_NAMES).toEqual(READER_PERFORMANCE_FULL_NAMES);
  expect(BATCH_CALIBRATION_SOURCE_DIGEST).toBe('305c24f10fd8c7b7ddf3e1915904885e15e7ba537661a7cb9323d9d62867c284');
  expect(RUNNER_CYCLES_SOURCE_DIGEST).toBe('07cbe0462988ce9fca97cfd89f34db76e22857422adaa98acc53a203cbd3e896');
  expect(WITHIN_SEASON_HISTORY_SOURCE_DIGEST).toBe('19c770060a21ae6d6c56316cffbee799309ac71f946518d079b8deded709c10d');
});

it('CP27 fails closed on module or helper drift while normalizing only checkout line endings', async () => {
  const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'reader-performance-source-')); directories.push(directory);
  for (const path of [READER_PERFORMANCE_MODULE, ...READER_PERFORMANCE_SUPPORT_SOURCES.map(entry => entry.path)]) {
    const target = join(directory, path); await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(join(sourceRoot, path), 'utf8'));
  }
  const context = await createQualificationContext(directory, 'a'.repeat(40), randomUUID(), READER_PERFORMANCE_PROFILE);
  for (const path of [READER_PERFORMANCE_MODULE, 'integration/reader-performance.ts',
    'integration/reader-performance-snapshot.ts', 'integration/reader-performance-oracle.ts', 'integration/neon-integration-harness.ts',
    'integration/disposable-integration.ts', 'integration/integration-owner-loss-diagnostics.ts',
    'lib/league-administration/public-intake-reader.ts', 'lib/league-administration/public-transaction-reader.ts']) {
    const target = join(directory, path), original = await readFile(target, 'utf8');
    await writeFile(target, original + '\n ');
    await expect(createQualificationContext(directory, 'a'.repeat(40), randomUUID(), READER_PERFORMANCE_PROFILE)).rejects.toThrow('reviewed LF digest');
    await writeFile(target, original.replace(/\r?\n/gu, '\r\n'));
    await expect(createQualificationContext(directory, 'a'.repeat(40), randomUUID(), READER_PERFORMANCE_PROFILE))
      .resolves.toMatchObject({ modules: context.modules, profileDigest: context.profileDigest });
    await writeFile(target, original);
  }
});


it('CP27 reader performance profile loads the actual integration config with its emitted loader', async () => {
  const { binding } = await readerPerformanceReportFixture();
  const args = qualificationArguments(READER_PERFORMANCE_PROFILE, '/reporter');
  const script = `
    import net from 'node:net';
    import path from 'node:path';
    import { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    net.Socket.prototype.connect = function () { throw new Error('Config-only regression forbids network'); };
    const require = createRequire(path.join(process.cwd(), 'package.json'));
    const vitestRequire = createRequire(require.resolve('vitest/package.json'));
    const { loadConfigFromFile } = await import(pathToFileURL(vitestRequire.resolve('vite')).href);
    const args = JSON.parse(process.argv[1]);
    const index = args.indexOf('--configLoader');
    const loader = index < 0 ? undefined : args[index + 1];
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' },
      path.resolve('vitest.integration.config.ts'), process.cwd(), 'silent', undefined, loader);
    const { test, resolve } = loaded.config;
    console.log(JSON.stringify({ loader, include: test.include, environment: test.environment,
      globalSetup: test.globalSetup, fileParallelism: test.fileParallelism, maxWorkers: test.maxWorkers,
      hookTimeout: test.hookTimeout, testTimeout: test.testTimeout, includeTaskLocation: test.includeTaskLocation,
      serverOnlyAlias: resolve.alias['server-only'] }));
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(args)], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { NODE_ENV: 'test', SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP,
      [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(binding.context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory },
    timeout: 4_000, maxBuffer: 64 * 1024, windowsHide: true, encoding: 'utf8',
  });
  expect(JSON.parse(stdout)).toEqual({ loader: 'runner', include: [READER_PERFORMANCE_MODULE], environment: 'node',
    globalSetup: ['./integration/global-setup.ts'], fileParallelism: false, maxWorkers: 1,
    hookTimeout: 120_000, testTimeout: 60_000, includeTaskLocation: true,
    serverOnlyAlias: fileURLToPath(new URL('./server-only-stub.ts', import.meta.url)) });
});
