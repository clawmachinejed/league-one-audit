import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, expect, it } from 'vitest';
import { createQualificationContext, markQualificationFailure, parseQualificationArguments, qualificationArguments,
  qualificationBinding, qualificationCleanup, qualificationDigest, qualificationSourceDigest, QUALIFICATION_CONTEXT_ENV,
  QUALIFICATION_FILES, SELECTED_SOURCE_DIGEST, SELECTED_FULL_NAME, SELECTED_INVENTORY, SELECTED_MODULE, SELECTED_PATTERN, SELECTED_PROFILE,
  validateQualificationArtifacts, validateQualificationReport, writeQualificationArtifact,
  type QualificationBinding, type QualificationCase, type QualificationReport } from './qualification-profile';

const directories: string[] = [];
const exitCode = process.exitCode;
afterEach(async () => { process.exitCode = exitCode; await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(selected = false): Promise<QualificationBinding> {
  const directory = await mkdtemp(join(tmpdir(), 'qualification-profile-')); directories.push(directory);
  await mkdir(join(directory, 'integration'));
  await writeFile(join(directory, SELECTED_MODULE), 'fixture\r\nsource\r\n');
  const context = await createQualificationContext(selected ? fileURLToPath(new URL('..', import.meta.url)) : directory,
    'a'.repeat(40), randomUUID(), selected ? SELECTED_PROFILE : 'full');
  // Synthetic fixture context only; production creation verifies the pinned source digest.
  context.modules[0].sourceDigest = qualificationSourceDigest('fixture\nsource\n');
  return { directory, context };
}
function report(binding: QualificationBinding): QualificationReport {
  const selected = binding.context.profile === SELECTED_PROFILE;
  return { kind: 'integration-qualification-report-v1', contextDigest: qualificationDigest(binding.context), starts: 1, ends: 1,
    reason: 'passed', unhandledErrors: 0, specifications: [{ path: SELECTED_MODULE, pattern: selected ? SELECTED_PATTERN : null,
      otherFilters: false }], collected: [SELECTED_MODULE], hooks: [{ key: 'suite:beforeAll', starts: 1, ends: 1 }],
    modules: [{ path: SELECTED_MODULE, state: 'passed', errors: 0, suites: [],
      cases: (selected ? SELECTED_INVENTORY : ['fixture']).map((name, index) => {
        const runs = !selected || name === SELECTED_FULL_NAME;
        return { id: 'case-' + index, name, state: runs ? 'passed' : 'skipped', mode: runs ? 'run' : 'skip',
          expectedFailure: false, configuredRetries: false, configuredRepeats: 0, errors: 0,
          readyEvents: 1, resultEvents: 1, diagnostic: runs ? {
            retryCount: 0, repeatCount: 0, flaky: false, duration: 1, startTime: 1234 } : null };
      }) }] };
}
it('keeps default selection and accepts only the one fixed CLI selector', () => {
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
  expect(await validateQualificationArtifacts(binding)).toMatchObject({ profile: SELECTED_PROFILE, collected: 24, executed: 1, passed: 1, filtered: 23 });
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
