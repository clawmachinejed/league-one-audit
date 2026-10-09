import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import QualificationReporter from './qualification-reporter';
import { createQualificationContext, qualificationArguments, qualificationDigest, qualificationSourceDigest, QUALIFICATION_CONTEXT_ENV,
  QUALIFICATION_FILES, INGESTION_PROFILE, INGESTION_FULL_NAME, SELECTED_FULL_NAME, SELECTED_INVENTORY, SELECTED_MODULE, SELECTED_PROFILE,
  OFFICIAL_PROFILE, OFFICIAL_SUITE, OFFICIAL_FULL_NAMES, GUARDS_PROFILE, GUARDS_FULL_NAMES,
  validateQualificationArtifacts, type QualificationReport } from './qualification-profile';

const directories: string[] = [];
const site = fileURLToPath(new URL('..', import.meta.url));
const reporterPath = join(site, 'integration/qualification-reporter.ts');
const helperPath = join(site, 'integration/qualification-profile.ts').replace(/\\/gu, '/');
const evidenceDirectory = fileURLToPath(new URL('../../../test-results/qualification', import.meta.url));
const originalExit = process.exitCode;
afterEach(async () => { process.exitCode = originalExit; await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

/** Actual installed runner, synthetic modules only. No application or SQL imports;
 * outbound fetch/http/net are blocked before configuration and worker startup. */
async function runFixture(kind: 'ordinary' | 'selected' | 'official' | 'guards' | 'teardown' | 'hook' | 'retry' | 'repeat' | 'unhandled' | 'timeout') {
  const directory = await mkdtemp(join(tmpdir(), 'qualification-runner-')); directories.push(directory);
  await mkdir(join(directory, 'integration')); await mkdir(join(directory, 'artifacts'));
  const vitestImport = pathToFileURL(join(site, 'node_modules/vitest/dist/index.js')).href;
  let body = "import {it,expect,describe,beforeAll,afterAll} from " + JSON.stringify(vitestImport) + ";\n";
  if (kind === 'guards') {
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
  const context = await createQualificationContext(kind === 'selected' || kind === 'ordinary' || kind === 'official' || kind === 'guards' ? site : directory, 'a'.repeat(40), randomUUID(),
    kind === 'guards' ? GUARDS_PROFILE : kind === 'official' ? OFFICIAL_PROFILE : kind === 'ordinary' ? INGESTION_PROFILE : kind === 'selected' ? SELECTED_PROFILE : 'full');
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
  await writeFile(join(evidenceDirectory, 'runner-' + kind + '.log'), (child.stdout ?? '') + (child.stderr ?? ''));
  const binding = { directory: join(directory, 'artifacts'), context };
  const raw = await readFile(join(binding.directory, QUALIFICATION_FILES.report), 'utf8').catch(() => undefined);
  const report: QualificationReport | undefined = raw ? JSON.parse(raw) : undefined;
  await writeFile(join(evidenceDirectory, 'runner-' + kind + '.json'), JSON.stringify({
    kind, exitCode: child.status, childError: child.error?.message, report, sqlExecuted: false, networkBlocked: true,
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
