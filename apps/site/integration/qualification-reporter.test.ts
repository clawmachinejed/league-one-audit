import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import ts from 'typescript';
import QualificationReporter from './qualification-reporter';
import { createQualificationContext, qualificationArguments, qualificationDigest, qualificationSourceDigest, QUALIFICATION_CONTEXT_ENV,
  QUALIFICATION_FILES, INGESTION_PROFILE, INGESTION_FULL_NAME, SELECTED_FULL_NAME, SELECTED_INVENTORY, SELECTED_MODULE, SELECTED_PROFILE,
  OFFICIAL_PROFILE, OFFICIAL_SUITE, OFFICIAL_FULL_NAMES, GUARDS_PROFILE, GUARDS_FULL_NAMES,
  CONCURRENCY_PROFILE, CONCURRENCY_FULL_NAMES, LATE_WRITE_PROFILE, LATE_WRITE_FULL_NAMES, LATE_WRITE_SUITE,
  CORE_COMPATIBILITY_PROFILE, CORE_COMPATIBILITY_MODULES, CLOSEOUT_PROFILES,
  PLAYER_DIRECTORY_PROFILE, PLAYER_DIRECTORY_MODULE, PLAYER_DIRECTORY_SUITE, PLAYER_DIRECTORY_TESTS, PLAYER_DIRECTORY_FULL_NAMES,
  validateQualificationArtifacts, type QualificationReport } from './qualification-profile';

const directories: string[] = [];
const site = fileURLToPath(new URL('..', import.meta.url));
const reporterPath = join(site, 'integration/qualification-reporter.ts');
const helperPath = join(site, 'integration/qualification-profile.ts').replace(/\\/gu, '/');
const evidenceDirectory = fileURLToPath(new URL('../../../test-results/data-backend/intake-closeout-runner-' + randomUUID() + '/', import.meta.url));
const originalExit = process.exitCode;
afterEach(async () => { process.exitCode = originalExit; await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

/** Read declaration order without importing application, SQL, or harness modules. */
async function sourceCaseOrder(): Promise<string[]> {
  const path = join(site, SELECTED_MODULE), source = await readFile(path, 'utf8');
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), cases: string[] = [];
  const visit = (node: ts.Node, suites: string[]) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && expression.text === 'describe' && ts.isStringLiteral(node.arguments[0])) {
        ts.forEachChild(node.arguments[1], child => visit(child, [...suites, node.arguments[0].getText(tree).slice(1, -1)])); return;
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
  expect([...cases].sort()).toEqual(SELECTED_INVENTORY);
  return cases;
}

/** Actual installed runner, synthetic modules only. No application or SQL imports;
 * outbound fetch/http/net are blocked before configuration and worker startup. */
async function runFixture(kind: 'ordinary' | 'selected' | 'official' | 'guards' | 'concurrency' | 'late-write' | 'teardown' | 'hook' | 'retry' | 'repeat' | 'unhandled' | 'timeout' | typeof CLOSEOUT_PROFILES[number]['profile'], order: 'source' | 'reversed' = 'source') {
  const directory = await mkdtemp(join(tmpdir(), 'qualification-runner-')); directories.push(directory);
  await mkdir(join(directory, 'integration')); await mkdir(join(directory, 'artifacts'));
  const vitestImport = pathToFileURL(join(site, 'node_modules/vitest/dist/index.js')).href;
  let body = "import {it,expect,describe,beforeAll,afterAll} from " + JSON.stringify(vitestImport) + ";\n";
  const closeout = CLOSEOUT_PROFILES.find(selection => selection.profile === kind);
  if (closeout) {
    const inventory = await sourceCaseOrder();
    expect(inventory.filter(name => closeout.names.includes(name))).toEqual(closeout.names);
    if (order === 'reversed') {
      expect(closeout.names.length).toBeGreaterThan(1);
      const first = inventory.indexOf(closeout.names[0]), second = inventory.indexOf(closeout.names[1]);
      [inventory[first], inventory[second]] = [inventory[second], inventory[first]];
    }
    body += 'let executed=0,lastCompleted=-1,activeSuite=-1,closedSuites=0;\n';
    for (const [suite, names] of Object.entries(Object.groupBy(inventory, name => name.split(' > ')[0]))) {
      body += 'describe(' + JSON.stringify(suite) + ',()=>{';
      const suiteOrdinal = (closeout.suites as readonly string[]).indexOf(suite);
      const ordinals = names!.map(name => closeout.names.indexOf(name)).filter(ordinal => ordinal >= 0);
      if (suiteOrdinal >= 0) {
        const first = Math.min(...ordinals), last = Math.max(...ordinals);
        body += 'beforeAll(()=>{expect(closedSuites).toBe(' + suiteOrdinal + ');expect(activeSuite).toBe(-1);' +
          'expect(executed).toBe(' + first + ');expect(lastCompleted).toBe(' + (first - 1) + ');activeSuite=' + suiteOrdinal + '});';
        body += 'afterAll(()=>{expect(activeSuite).toBe(' + suiteOrdinal + ');expect(executed).toBe(' + (last + 1) + ');' +
          'expect(lastCompleted).toBe(' + last + ');activeSuite=-1;closedSuites++});';
      } else body += "beforeAll(()=>{throw Error('filtered suite beforeAll unexpectedly ran')});afterAll(()=>{throw Error('filtered suite afterAll unexpectedly ran')});";
      for (const name of names!) {
        const ordinal = closeout.names.indexOf(name);
        body += 'it(' + JSON.stringify(name.split(' > ')[1]) + ',async()=>{' + (ordinal >= 0
          ? 'expect(activeSuite).toBe(' + suiteOrdinal + ');expect(lastCompleted).toBe(' + (ordinal - 1) + ');' +
            'expect(executed++).toBe(' + ordinal + ');await new Promise(resolve=>setTimeout(resolve,8));' +
            'expect(lastCompleted).toBe(' + (ordinal - 1) + ');lastCompleted=' + ordinal + ';'
          : "throw Error('filtered case unexpectedly ran')") + '});';
      }
      body += '});\n';
    }
  } else if (kind === 'concurrency' || kind === 'late-write') {
    const selectedNames = kind === 'late-write' ? LATE_WRITE_FULL_NAMES : CONCURRENCY_FULL_NAMES;
    body += 'let setup=0,executed=0,retainedCycle;\n';
    const inventory = [...selectedNames, ...SELECTED_INVENTORY.filter(name => !selectedNames.includes(name))];
    for (const [suite, names] of Object.entries(Object.groupBy(inventory, name => name.split(' > ')[0]))) {
      body += 'describe(' + JSON.stringify(suite) + ',()=>{';
      const selected = names!.some(name => selectedNames.includes(name));
      body += selected ? 'beforeAll(()=>{setup++});afterAll(()=>{expect(setup).toBe(1);expect(executed).toBe(' + selectedNames.length + ')});'
        : "beforeAll(()=>{throw Error('filtered suite hook unexpectedly ran')});";
      for (const name of names!) {
        const ordinal = selectedNames.indexOf(name);
        body += 'it(' + JSON.stringify(name.split(' > ')[1]) + ',()=>{' + (ordinal >= 0
          ? 'expect(setup).toBe(1);expect(executed++).toBe(' + ordinal + ');' +
            (ordinal === 0 ? 'retainedCycle=1;' : 'expect(retainedCycle).toBe(1);')
          : "throw Error('filtered case unexpectedly ran')") + '});';
      }
      body += '});\n';
    }
  } else if (kind === 'guards') {
    body += 'let setup=0,executed=0,retainedCycle;\n';
    const inventory = [...GUARDS_FULL_NAMES, ...SELECTED_INVENTORY.filter(name => !GUARDS_FULL_NAMES.includes(name))];
    for (const [suite, names] of Object.entries(Object.groupBy(inventory, name => name.split(' > ')[0]))) {
      body += 'describe(' + JSON.stringify(suite) + ',()=>{';
      const selected = names!.filter(name => GUARDS_FULL_NAMES.includes(name));
      body += selected.length ? 'beforeAll(()=>{setup++});afterAll(()=>{expect(executed).toBe(' + (selected.length === 2 ? 2 : 3) + ')});'
        : "beforeAll(()=>{throw Error('filtered suite hook unexpectedly ran')});";
      for (const name of names!) {
        const ordinal = GUARDS_FULL_NAMES.indexOf(name);
        body += 'it(' + JSON.stringify(name.split(' > ')[1]) + ',()=>{' + (ordinal >= 0
          ? 'expect(setup).toBe(' + (ordinal < 2 ? 1 : 2) + ');expect(executed++).toBe(' + ordinal + ');' +
            (ordinal === 0 ? 'retainedCycle=1;' : ordinal === 1 ? 'expect(retainedCycle).toBe(1);' : '')
          : "throw Error('filtered case unexpectedly ran')") + '});';
      }
      body += '});\n';
    }
  } else if (kind === 'official') {
    body += 'let setup=0,executed=0;\n';
    for (const [suite, names] of Object.entries(Object.groupBy(SELECTED_INVENTORY, name => name.split(' > ')[0]))) {
      body += 'describe(' + JSON.stringify(suite) + ',()=>{';
      body += suite === OFFICIAL_SUITE ? 'beforeAll(()=>{setup++});afterAll(()=>{expect(executed).toBe(2)});'
        : "beforeAll(()=>{throw Error('filtered suite hook unexpectedly ran')});";
      for (const name of names!) {
        body += 'it(' + JSON.stringify(name.split(' > ')[1]) + ',()=>{' +
          (OFFICIAL_FULL_NAMES.includes(name) ? 'expect(setup).toBe(1);executed++;'
            : "throw Error('filtered case unexpectedly ran')") + '});';
      }
      body += '});\n';
    }
  } else if (kind === 'selected' || kind === 'ordinary') {
    for (const name of SELECTED_INVENTORY) {
      const parts = name.split(' > ');
      body += 'describe(' + JSON.stringify(parts[0]) + ',()=>{it(' + JSON.stringify(parts[1]) + ',()=>{' +
        (name === (kind === 'ordinary' ? INGESTION_FULL_NAME : SELECTED_FULL_NAME) ? 'expect(1).toBe(1)' : "throw Error('filtered case unexpectedly ran')") + '})});\n';
    }
  } else {
    if (kind === 'hook') body += "beforeAll(()=>{throw Error('fixture hook failure')});\n";
    if (kind === 'retry') body += "let attempts=0;it('fixture',{retry:1},()=>{expect(++attempts).toBe(2)});\n";
    else if (kind === 'repeat') body += "it('fixture',{repeats:1},()=>{expect(1).toBe(1)});\n";
    else if (kind === 'unhandled') body += "it('fixture',async()=>{void Promise.reject(Error('fixture unhandled'));await new Promise(r=>setTimeout(r,20));});\n";
    else body += "it('fixture',()=>{expect(1).toBe(1)});\n";
  }
  await writeFile(join(directory, SELECTED_MODULE), body);
  await writeFile(join(directory, 'setup.ts'), 'import {qualificationBinding,qualificationCleanup} from ' + JSON.stringify(helperPath) +
    ';\nexport default function(){const binding=qualificationBinding();return async()=>{await qualificationCleanup(async()=>{' +
    (kind === 'teardown' ? "throw Error('DELIBERATE_TEARDOWN_FAILURE');" : '') +
    '},binding);' + (kind === 'timeout' ? 'setInterval(()=>{},1000);' : '') + '};}\n');
  await writeFile(join(directory, 'config.mjs'), 'export default {test:{environment:"node",include:["integration/*.integration-case.ts"],' +
    'globalSetup:["./setup.ts"],fileParallelism:false,maxWorkers:1,teardownTimeout:350}};\n');
  const guard = join(directory, 'network-block.mjs');
  await writeFile(guard, "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);" +
    "const deny=()=>{throw Error('NETWORK_BLOCKED_FIXTURE')};for(const m of ['http','https']){require(m).request=deny;require(m).get=deny;}" +
    "require('net').Socket.prototype.connect=deny;globalThis.fetch=deny;\n");
  const context = await createQualificationContext(closeout || kind === 'selected' || kind === 'ordinary' || kind === 'official' || kind === 'guards' || kind === 'concurrency' || kind === 'late-write' ? site : directory, 'a'.repeat(40), randomUUID(),
    closeout ? closeout.profile : kind === 'late-write' ? LATE_WRITE_PROFILE : kind === 'concurrency' ? CONCURRENCY_PROFILE : kind === 'guards' ? GUARDS_PROFILE : kind === 'official' ? OFFICIAL_PROFILE : kind === 'ordinary' ? INGESTION_PROFILE : kind === 'selected' ? SELECTED_PROFILE : 'full');
  // Only this no-SQL fixture substitutes synthetic source beneath the same closed case inventory.
  context.modules[0].sourceDigest = qualificationSourceDigest(body);
  const allow = new Set(['path','systemroot','windir','comspec','temp','tmp','tmpdir','home','userprofile','localappdata','appdata','pathext']);
  const environment = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allow.has(key.toLowerCase()))),
    NODE_ENV: 'test' as const, [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context),
    PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: join(directory, 'artifacts') };
  const child = spawnSync(process.execPath, ['--import', pathToFileURL(guard).href, join(site, 'node_modules/vitest/vitest.mjs'),
    'run', '--config', join(directory, 'config.mjs'), ...qualificationArguments(context.profile, reporterPath)],
  { cwd: directory, env: environment, encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 2_000_000 });
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(join(evidenceDirectory, 'runner-' + kind + '-' + order + '.log'), (child.stdout ?? '') + (child.stderr ?? ''));
  const binding = { directory: join(directory, 'artifacts'), context };
  const raw = await readFile(join(binding.directory, QUALIFICATION_FILES.report), 'utf8').catch(() => undefined);
  const report: QualificationReport | undefined = raw ? JSON.parse(raw) : undefined;
  await writeFile(join(evidenceDirectory, 'runner-' + kind + '-' + order + '.json'), JSON.stringify({
    kind, order, exitCode: child.status, childError: child.error?.message, report, sqlExecuted: false, networkBlocked: true,
  }, null, 2));
  expect(child.error, child.stderr).toBeUndefined();
  expect(report, child.stderr).toBeDefined();
  expect(report!.contextDigest).toBe(qualificationDigest(context));
  return { child, binding, report: report! };
}
it('executes the closed selected case once and accounts for every filtered case using public reporter APIs', { timeout: 30_000 }, async () => {
  const { child, binding, report } = await runFixture('selected');
  expect(child.status).toBe(0);
  expect(report.modules[0].cases.filter(test => test.state === 'passed')).toHaveLength(1);
  expect(report.modules[0].cases.filter(test => test.state === 'skipped')).toHaveLength(24);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: SELECTED_PROFILE });
});
it('rejects the reproduced zero-exit teardown gap after the actual installed runner closes', { timeout: 30_000 }, async () => {
  const { child, binding, report } = await runFixture('teardown');
  expect(report.reason).toBe('passed'); expect(child.status).toBe(1);
  await expect(readFile(join(binding.directory, QUALIFICATION_FILES.cleanup))).rejects.toThrow();
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
});
it.each(['hook', 'retry', 'repeat', 'unhandled'] as const)(
  'rejects actual runner %s evidence even if tests later appear passed', { timeout: 30_000 }, async kind => {
    const { binding, report } = await runFixture(kind);
    if (kind === 'retry') expect(report.modules[0].cases[0].diagnostic).toMatchObject({ retryCount: 1, flaky: true });
    if (kind === 'repeat') expect(report.modules[0].cases[0].diagnostic?.repeatCount).toBeGreaterThan(0);
    if (kind === 'unhandled') expect(report.unhandledErrors).toBeGreaterThan(0);
    await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  });
it('lets a late process timeout override an earlier passing report and cleanup acknowledgment', { timeout: 30_000 }, async () => {
  const { child, binding, report } = await runFixture('timeout');
  expect(report.reason).toBe('passed'); expect(child.status).toBe(1);
  expect(JSON.parse(await readFile(join(binding.directory, QUALIFICATION_FILES.cleanup), 'utf8')).globalDatabaseCleanup).toBe('complete');
  expect(JSON.parse(await readFile(join(binding.directory, QUALIFICATION_FILES.failure), 'utf8')).reason).toBe('process-timeout');
  await expect(validateQualificationArtifacts(binding)).rejects.toThrow('Sticky');
});
it('fails synchronously before attempting a timeout marker write, even without initialized context', async () => {
  const reporting = new QualificationReporter().onProcessTimeout();
  expect(process.exitCode).toBe(1); await reporting;
});

it('executes only the ordinary case among25 and rejects that report under the refresh profile', { timeout: 30_000 }, async () => {
  const { child, binding, report } = await runFixture('ordinary');
  expect(child.status).toBe(0);
  expect(report.modules[0].cases.filter(test => test.state === 'passed').map(test => test.name)).toEqual([INGESTION_FULL_NAME]);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: INGESTION_PROFILE,
    collected: 25, executed: 1, passed: 1, filtered: 24 });
  const other = await createQualificationContext(site, binding.context.gitSha, binding.context.runId, SELECTED_PROFILE);
  await expect(validateQualificationArtifacts({ ...binding, context: other })).rejects.toThrow();
});
it('executes the official pair once with shared suite hooks and skips all23 unrelated cases and hooks', { timeout: 30_000 }, async () => {
  const { child, binding, report } = await runFixture('official');
  expect(child.status).toBe(0);
  expect(report.modules[0].cases.filter(test => test.state === 'passed').map(test => test.name).sort()).toEqual([...OFFICIAL_FULL_NAMES].sort());
  expect(report.hooks).toHaveLength(2);
  for (const hook of report.hooks) expect(hook).toMatchObject({ starts: 1, ends: 1 });
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: OFFICIAL_PROFILE,
    collected: 25, executed: 2, passed: 2, skipped: 23, filtered: 23 });
});

it('executes the three ingestion guards in source order with the retained cycle dependency and both suite hooks', { timeout: 30_000 }, async () => {
  const { child, binding, report } = await runFixture('guards');
  expect(child.status).toBe(0);
  expect(report.modules[0].cases.filter(test => test.state === 'passed').map(test => test.name)).toEqual(GUARDS_FULL_NAMES);
  expect(report.modules[0].cases.filter(test => test.state === 'skipped')).toHaveLength(22);
  expect(report.hooks).toHaveLength(4);
  for (const hook of report.hooks) expect(hook).toMatchObject({ starts: 1, ends: 1 });
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: GUARDS_PROFILE,
    collected: 25, executed: 3, passed: 3, skipped: 22, filtered: 22 });
});

it('executes five refresh concurrency cases in source order with one shared setup and teardown', { timeout: 30_000 }, async () => {
  const { child, binding, report } = await runFixture('concurrency');
  expect(child.status).toBe(0);
  expect(report.modules[0].cases.filter(test => test.state === 'passed').map(test => test.name)).toEqual(CONCURRENCY_FULL_NAMES);
  expect(report.modules[0].cases.filter(test => test.state === 'skipped')).toHaveLength(20);
  expect(report.hooks).toHaveLength(2);
  for (const hook of report.hooks) expect(hook).toMatchObject({ starts: 1, ends: 1 });
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: CONCURRENCY_PROFILE,
    collected: 25, executed: 5, passed: 5, skipped: 20, filtered: 20 });
});

it('executes only three late-write rollback cases in source order with exactly one selected suite hook pair', { timeout: 30_000 }, async () => {
  const { child, binding, report } = await runFixture('late-write');
  expect(child.status).toBe(0);
  expect(report.modules[0].cases.filter(test => test.state === 'passed').map(test => test.name)).toEqual(LATE_WRITE_FULL_NAMES);
  expect(report.modules[0].cases.filter(test => test.state === 'skipped')).toHaveLength(22);
  const selectedSuite = report.modules[0].suites.find(suite => suite.name === LATE_WRITE_SUITE)!;
  expect(selectedSuite).toMatchObject({ mode: 'run', errors: 0 });
  expect(report.hooks).toEqual(['beforeAll', 'afterAll'].map(name => ({
    key: selectedSuite.id + ':' + name, starts: 1, ends: 1,
  })));
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: LATE_WRITE_PROFILE,
    collected: 25, executed: 3, passed: 3, skipped: 22, filtered: 22 });
});


it.each(CLOSEOUT_PROFILES)('executes $profile in actual source topology with chronological async transitions and exact hooks', { timeout: 30_000 }, async selection => {
  const { child, binding, report } = await runFixture(selection.profile);
  expect(child.status).toBe(0);
  const selected = report.modules[0].cases.filter(test => test.state === 'passed');
  expect(selected.map(test => test.name)).toEqual(selection.names);
  expect(report.modules[0].cases.filter(test => test.state === 'skipped')).toHaveLength(25 - selection.names.length);
  const suites = report.modules[0].suites.filter(suite => suite.mode === 'run');
  expect(suites.map(suite => suite.name)).toEqual(selection.suites);
  expect(report.hooks).toEqual(suites.flatMap(suite => ['beforeAll', 'afterAll'].map(name => ({
    key: suite.id + ':' + name, starts: 1, ends: 1,
  }))));
  for (let index = 1; index < selected.length; index++) {
    expect(selected[index].diagnostic!.startTime).toBeGreaterThan(selected[index - 1].diagnostic!.startTime);
  }
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ profile: selection.profile,
    collected: 25, executed: selection.names.length, passed: selection.names.length,
    skipped: 25 - selection.names.length, filtered: 25 - selection.names.length });
});

it.each(CLOSEOUT_PROFILES.filter(selection => selection.names.length > 1))(
  'rejects a real installed-runner dependency-order violation for $profile', { timeout: 30_000 }, async selection => {
    const { child, binding, report } = await runFixture(selection.profile, 'reversed');
    expect(child.status).toBe(1);
    expect(report.modules[0].cases.some(test => test.state === 'failed')).toBe(true);
    await expect(validateQualificationArtifacts(binding)).rejects.toThrow();
  });

it('runs the fixed three-module core compatibility selection with actual beforeEach reporting and blocked networking', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'core-compatibility-runner-')); directories.push(directory);
  await mkdir(join(directory, 'integration')); await mkdir(join(directory, 'artifacts'));
  const context = await createQualificationContext(site, 'a'.repeat(40), randomUUID(), CORE_COMPATIBILITY_PROFILE);
  for (const spec of CORE_COMPATIBILITY_MODULES) {
    let objectCaseTable: string | undefined;
    const objectTemplate = 'counts $label in cumulative PPG';
    if (spec.path === 'integration/all-player-statistics.integration-case.ts') {
      const source = await readFile(join(site, spec.path), 'utf8');
      const tree = ts.createSourceFile(spec.path, source, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === objectTemplate) {
          expect(objectCaseTable).toBeUndefined();
          expect(ts.isCallExpression(node.expression)).toBe(true);
          const each = node.expression as ts.CallExpression;
          expect(each.expression.getText(tree)).toBe('it.each');
          objectCaseTable = each.arguments[0].getText(tree);
        }
        ts.forEachChild(node, visit);
      };
      visit(tree); expect(objectCaseTable).toBeDefined();
    }
    let objectCasesAdded = false;
    let body = 'import {it,expect,describe,beforeAll,afterAll,beforeEach} from ' + JSON.stringify(pathToFileURL(join(site, 'node_modules/vitest/dist/index.js')).href) + ';\n';
    body += 'let setup=0,executed=0,each=0;\n';
    for (const [suite, names] of Object.entries(Object.groupBy(spec.inventory, name => name.split(' > ')[0]))) {
      body += 'describe(' + JSON.stringify(suite) + ',()=>{';
      if (suite === spec.suite) {
        body += 'beforeAll(()=>{expect(setup++).toBe(0)});afterAll(()=>{expect(setup).toBe(1);expect(executed).toBe(' + spec.names.length + ');expect(each).toBe(' + (spec.beforeEach ? spec.names.length : 0) + ')});';
        if (spec.beforeEach) body += 'beforeEach(()=>{expect(each++).toBe(executed)});';
      } else body += "beforeAll(()=>{throw Error('excluded suite hook ran')});afterAll(()=>{throw Error('excluded suite hook ran')});";
      for (const name of names!) {
        if (objectCaseTable && name.startsWith(spec.suite + ' > counts ')) {
          if (!objectCasesAdded) {
            // Preserve the maintained it.each table/template so installed Vitest
            // supplies quoting and truncation; literal test names cannot prove this.
            body += 'it.each(' + objectCaseTable + ')(' + JSON.stringify(objectTemplate) + ",()=>{throw Error('filtered object case ran')});";
            objectCasesAdded = true;
          }
          continue;
        }
        const ordinal = (spec.names as readonly string[]).indexOf(name);
        body += 'it(' + JSON.stringify(name.split(' > ')[1]) + ',()=>{' + (ordinal < 0 ? "throw Error('filtered case ran')"
          : 'expect(setup).toBe(1);expect(executed++).toBe(' + ordinal + ')') + '});';
      }
      body += '});\n';
    }
    await writeFile(join(directory, spec.path), body);
    // The actual reporter validates these synthetic bytes. SQL modules are never imported.
    context.modules.find(module => module.path === spec.path)!.sourceDigest = qualificationSourceDigest(body);
  }
  await writeFile(join(directory, 'setup.ts'), 'import {qualificationBinding,qualificationCleanup} from ' + JSON.stringify(helperPath) +
    ';export default function(){const binding=qualificationBinding();return async()=>qualificationCleanup(async()=>{},binding)}');
  await writeFile(join(directory, 'config.mjs'), 'export default {test:{environment:"node",include:["integration/*.integration-case.ts"],globalSetup:["./setup.ts"],fileParallelism:false,maxWorkers:1}}');
  const guard = join(directory, 'network-block.mjs');
  await writeFile(guard, "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);" +
    "const deny=()=>{throw Error('NETWORK_BLOCKED_FIXTURE')};for(const m of ['http','https']){require(m).request=deny;require(m).get=deny;}" +
    "require('net').Socket.prototype.connect=deny;globalThis.fetch=deny;");
  const allow = new Set(['path','systemroot','windir','comspec','temp','tmp','tmpdir','home','userprofile','localappdata','appdata','pathext']);
  const binding = { context, directory: join(directory, 'artifacts') };
  const child = spawnSync(process.execPath, ['--import', pathToFileURL(guard).href, join(site, 'node_modules/vitest/vitest.mjs'),
    'run', '--config', join(directory, 'config.mjs'), ...qualificationArguments(context.profile, reporterPath)],
  { cwd: directory, env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allow.has(key.toLowerCase()))), NODE_ENV: 'test',
    [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory },
    encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 2_000_000 });
  expect(child.status, (child.stdout ?? '') + (child.stderr ?? '')).toBe(0);
  expect(child.error).toBeUndefined();
  const report: QualificationReport = JSON.parse(await readFile(join(binding.directory, QUALIFICATION_FILES.report), 'utf8'));
  expect(report.hooks).toHaveLength(8);
  expect(report.hooks.filter(hook => hook.key.endsWith(':beforeEach'))).toHaveLength(2);
  await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ collected: 89, executed: 7, passed: 7, filtered: 82 });
}, 30_000);


it.each(['source', 'reversed'] as const)('reports the six directory cases with actual installed-runner hooks and rejects %s order when needed', async order => {
  const directory = await mkdtemp(join(tmpdir(), 'player-directory-runner-')); directories.push(directory);
  await mkdir(join(directory, 'integration')); await mkdir(join(directory, 'artifacts'));
  const context = await createQualificationContext(site, 'a'.repeat(40), randomUUID(), PLAYER_DIRECTORY_PROFILE);
  const names = order === 'source' ? [...PLAYER_DIRECTORY_TESTS] : [...PLAYER_DIRECTORY_TESTS].reverse();
  let body = 'import {it,expect,describe,beforeAll,afterAll} from ' + JSON.stringify(pathToFileURL(join(site, 'node_modules/vitest/dist/index.js')).href) + ';\n';
  body += 'let setup=0,executed=0;describe.sequential(' + JSON.stringify(PLAYER_DIRECTORY_SUITE) + ',()=>{';
  body += 'beforeAll(()=>{expect(setup++).toBe(0)});afterAll(()=>{expect(setup).toBe(1);expect(executed).toBe(6)});';
  names.forEach((name, index) => {
    body += 'it(' + JSON.stringify(name) + ',async()=>{expect(setup).toBe(1);expect(executed).toBe(' + index + ');' +
      'await new Promise(resolve=>setTimeout(resolve,10));expect(executed++).toBe(' + index + ')});';
  });
  body += '});\n';
  await writeFile(join(directory, PLAYER_DIRECTORY_MODULE), body);
  // Only synthetic module bytes reach Vitest; the maintained SQL fixture is never imported.
  context.modules[0].sourceDigest = qualificationSourceDigest(body);
  await writeFile(join(directory, 'setup.ts'), 'import {qualificationBinding,qualificationCleanup} from ' + JSON.stringify(helperPath) +
    ';export default function(){const binding=qualificationBinding();return async()=>qualificationCleanup(async()=>{},binding)}');
  await writeFile(join(directory, 'config.mjs'), 'export default {test:{environment:"node",include:["integration/*.integration-case.ts"],globalSetup:["./setup.ts"],fileParallelism:false,maxWorkers:1}}');
  const guard = join(directory, 'network-block.mjs');
  await writeFile(guard, "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);" +
    "const deny=()=>{throw Error('NETWORK_BLOCKED_FIXTURE')};for(const m of ['http','https']){require(m).request=deny;require(m).get=deny;}" +
    "require('net').Socket.prototype.connect=deny;globalThis.fetch=deny;");
  const allow = new Set(['path','systemroot','windir','comspec','temp','tmp','tmpdir','home','userprofile','localappdata','appdata','pathext']);
  const binding = { context, directory: join(directory, 'artifacts') };
  const child = spawnSync(process.execPath, ['--import', pathToFileURL(guard).href, join(site, 'node_modules/vitest/vitest.mjs'),
    'run', '--config', join(directory, 'config.mjs'), ...qualificationArguments(context.profile, reporterPath)],
  { cwd: directory, env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allow.has(key.toLowerCase()))), NODE_ENV: 'test',
    [QUALIFICATION_CONTEXT_ENV]: JSON.stringify(context), PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: binding.directory },
    encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 2_000_000 });
  expect(child.status, (child.stdout ?? '') + (child.stderr ?? '')).toBe(0);
  expect(child.error).toBeUndefined();
  const report: QualificationReport = JSON.parse(await readFile(join(binding.directory, QUALIFICATION_FILES.report), 'utf8'));
  expect(report.hooks).toHaveLength(2);
  expect(report.hooks.map(hook => [hook.starts, hook.ends])).toEqual([[1, 1], [1, 1]]);
  expect(report.modules[0].cases.map(test => test.name)).toEqual(names.map(name => PLAYER_DIRECTORY_SUITE + ' > ' + name));
  expect(report.modules[0].cases.every(test => test.state === 'passed')).toBe(true);
  if (order === 'source') {
    expect(report.modules[0].cases.map(test => test.name)).toEqual(PLAYER_DIRECTORY_FULL_NAMES);
    await expect(validateQualificationArtifacts(binding)).resolves.toMatchObject({ collected: 6, executed: 6, passed: 6, filtered: 0 });
  } else await expect(validateQualificationArtifacts(binding)).rejects.toThrow('source order');
}, 30_000);
