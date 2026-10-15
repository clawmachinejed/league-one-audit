import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, expect, it } from 'vitest';
import { createQualificationContext, markQualificationFailure, parseQualificationArguments, qualificationArguments,
  qualificationBinding, qualificationCleanup, qualificationDigest, qualificationSourceDigest, QUALIFICATION_CONTEXT_ENV,
  QUALIFICATION_FILES, INGESTION_PROFILE, INGESTION_FULL_NAME, INGESTION_PATTERN, SELECTED_SOURCE_DIGEST, SELECTED_FULL_NAME, SELECTED_INVENTORY, SELECTED_MODULE, SELECTED_PATTERN, SELECTED_PROFILE,
  validateQualificationArtifacts, validateQualificationReport, writeQualificationArtifact,
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

const directories: string[] = [];
const exitCode = process.exitCode;
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
  expect(workflow).toContain('timeout-minutes: 50');
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
  expect(workflow).toContain('timeout-minutes: 50');
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
  expect(workflow).toContain('timeout-minutes: 50');
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
  expect(workflow).toContain('timeout-minutes: 50');
  for (const selection of [...historyProfiles, ...draftIntakeProfiles])
    expect(qualificationSourceDigest(await readFile(new URL('../' + selection.module, import.meta.url), 'utf8'))).toBe(selection.digest);
  const full = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  expect(full.modules).toHaveLength(70); expect(full.modules.filter(module => module.path === WITHIN_SEASON_HISTORY_MODULE)).toHaveLength(1);
  expect(full.modules.some(module => module.path.endsWith('.live-integration-case.ts'))).toBe(false);
});
