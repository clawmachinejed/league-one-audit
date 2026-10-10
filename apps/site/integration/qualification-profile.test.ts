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
  PLAYER_DIRECTORY_PROFILE, PLAYER_DIRECTORY_MODULE, PLAYER_DIRECTORY_SOURCE_DIGEST, PLAYER_DIRECTORY_SUITE,
  PLAYER_DIRECTORY_TESTS, PLAYER_DIRECTORY_FULL_NAMES, PLAYER_DIRECTORY_PATTERN,
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
  expect((await createQualificationContext(site, 'a'.repeat(40), randomUUID())).modules).toHaveLength(49);
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
