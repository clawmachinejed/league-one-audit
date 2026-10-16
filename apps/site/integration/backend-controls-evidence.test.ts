import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertBackendControlsEvidence, assertCompleteBackendControlsEvidence, writeBackendControlsEvidence,
  BACKEND_CONTROLS_EVIDENCE_FILE, BACKEND_CONTROLS_LIMITS, BACKEND_CONTROLS_ORACLES,
  type ControlsEvidence } from './backend-controls-evidence';
import { BACKEND_CONTROLS_MODULE, BACKEND_CONTROLS_PROFILE, BACKEND_CONTROLS_SOURCE_DIGEST,
  BACKEND_CONTROLS_TESTS, qualificationDigest, type QualificationBinding } from './qualification-profile';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
const instant = (milliseconds: number) => new Date(Date.UTC(2026, 9, 16) + milliseconds).toISOString();
async function fixture(): Promise<{ binding: QualificationBinding; evidence: ControlsEvidence }> {
  const directory = await mkdtemp(join(tmpdir(), 'backend-controls-evidence-')); directories.push(directory);
  // Synthetic artifact-validator input only. No SQL, LOGIN, acquisition or cleanup is performed here.
  const binding: QualificationBinding = { directory, context: {
    kind: 'integration-qualification-context-v1', runId: randomUUID(), nonce: randomUUID(), gitSha: 'a'.repeat(40),
    profile: BACKEND_CONTROLS_PROFILE, profileDigest: 'b'.repeat(64),
    modules: [{ path: BACKEND_CONTROLS_MODULE, sourceDigest: BACKEND_CONTROLS_SOURCE_DIGEST }],
  } };
  const evidence: ControlsEvidence = {
    kind: 'data-backend-controls-evidence-v1', contextDigest: qualificationDigest(binding.context),
    gitSha: binding.context.gitSha, serverVersion: '17.6', serverVersionNum: '170006',
    actualLogins: ['league_one_runtime', 'league_one_auth'], accountLoginExecuted: false,
    prerequisiteGets: 2, measuredGets: 2, cleanupComplete: true,
    cases: BACKEND_CONTROLS_TESTS.map((name, index) => {
      const { type, ...data } = BACKEND_CONTROLS_ORACLES[index];
      return { name, limitMs: BACKEND_CONTROLS_LIMITS[index], state: 'passed',
        startedAt: instant(index * 10_000), endedAt: instant(index * 10_000 + 1_000),
        events: [{ type, at: instant(index * 10_000 + 500), data }] };
    }),
  };
  return { binding, evidence };
}

describe('CP24 bounded evidence guards without SQL execution', () => {
  it('writes one exclusive artifact, reads back its exact data and refuses replacement', async () => {
    const { binding, evidence } = await fixture();
    expect(() => assertCompleteBackendControlsEvidence(evidence, binding)).not.toThrow();
    const digest = await writeBackendControlsEvidence(binding, evidence);
    const path = join(binding.directory, BACKEND_CONTROLS_EVIDENCE_FILE);
    const original = await readFile(path, 'utf8');
    expect(JSON.parse(original)).toEqual(evidence);
    expect(digest).toBe(qualificationDigest(JSON.parse(original)));
    const changed = structuredClone(evidence); changed.cleanupComplete = false;
    await expect(writeBackendControlsEvidence(binding, changed)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(path, 'utf8')).toBe(original);
  });

  it('retains a failed prerequisite and every unserved obligation without qualifying them', async () => {
    const { binding, evidence } = await fixture();
    evidence.actualLogins = []; evidence.prerequisiteGets = 0; evidence.measuredGets = 0;
    evidence.cleanupComplete = false;
    evidence.cases = evidence.cases.map((entry, index) => ({ ...entry, state: index === 0 ? 'failed' : 'unserved',
      startedAt: index === 0 ? entry.startedAt : null, endedAt: index === 0 ? entry.endedAt : null,
      events: index === 0 ? [{ type: 'prerequisite', at: instant(500), data: { outcome: 'failed' } }] : [] }));
    expect(() => assertBackendControlsEvidence(evidence, binding)).not.toThrow();
    await writeBackendControlsEvidence(binding, evidence);
    const path = join(binding.directory, BACKEND_CONTROLS_EVIDENCE_FILE), original = await readFile(path, 'utf8');
    expect(() => assertCompleteBackendControlsEvidence(JSON.parse(original), binding)).toThrow();
    expect(JSON.parse(original).cases.map((entry: { state: string }) => entry.state)).toEqual([
      'failed', 'unserved', 'unserved', 'unserved', 'unserved', 'unserved', 'unserved', 'unserved', 'unserved',
    ]);
    expect(await readFile(path, 'utf8')).toBe(original);
  });

  it('rejects missing, foreign, duplicate or relabeled role and source claims', async () => {
    const { binding, evidence } = await fixture();
    const changes: Record<string, (value: ControlsEvidence) => void> = {
      'wrong context': value => { value.contextDigest = 'f'.repeat(64); },
      'wrong source': value => { value.gitSha = 'f'.repeat(40); },
      'owner LOGIN': value => { value.actualLogins = ['owner', 'league_one_auth']; },
      'account LOGIN': value => { value.actualLogins = ['league_one_runtime', 'league_one_account']; },
      'missing auth LOGIN': value => { value.actualLogins = ['league_one_runtime']; },
      'duplicate LOGIN': value => { value.actualLogins = ['league_one_runtime', 'league_one_auth', 'league_one_auth']; },
      'renewed CP21 claim': value => { Object.assign(value, { accountLoginExecuted: true }); },
      'unacknowledged cleanup': value => { value.cleanupComplete = false; },
      'missing prerequisite acquisition': value => { value.prerequisiteGets = 1; },
      'inflated measured acquisition': value => { value.measuredGets = 3; },
      'fractional acquisition': value => { value.measuredGets = 1.5; },
      'negative acquisition': value => { value.prerequisiteGets = -1; },
      'unbounded acquisition': value => { value.measuredGets = 21; },
      'malformed server version': value => { value.serverVersionNum = '17.6'; },
      'empty server version': value => { value.serverVersion = ''; },
      'version major disagreement': value => { value.serverVersionNum = '160006'; },
      'version minor disagreement': value => { value.serverVersionNum = '170005'; },
      'unsupported version encoding': value => { value.serverVersion = '9.6.24'; value.serverVersionNum = '90624'; },
      'unexpected proof field': value => { Object.assign(value, { sqlQualified: true }); },
    };
    for (const [name, change] of Object.entries(changes)) {
      const adverse = structuredClone(evidence); change(adverse);
      expect(() => assertCompleteBackendControlsEvidence(adverse, binding), name).toThrow();
    }
    for (const change of [
      (context: QualificationBinding['context']) => { context.nonce = randomUUID(); },
      (context: QualificationBinding['context']) => { context.runId = randomUUID(); },
      (context: QualificationBinding['context']) => { context.profile = 'data-competing-workers-v1'; },
      (context: QualificationBinding['context']) => { context.modules[0].sourceDigest = 'f'.repeat(64); },
    ]) {
      const context = structuredClone(binding.context); change(context);
      expect(() => assertCompleteBackendControlsEvidence(evidence, { ...binding, context })).toThrow();
    }
  });

  it('requires all nine original cases in chronological order within their authored bounds', async () => {
    const { binding, evidence } = await fixture();
    const changes: Record<string, (value: ControlsEvidence) => void> = {
      'missing case': value => { value.cases.pop(); },
      'duplicate case': value => { value.cases[8] = structuredClone(value.cases[0]); },
      'reordered cases': value => { value.cases.reverse(); },
      'renamed case': value => { value.cases[0].name += ' extra'; },
      'failed case': value => { value.cases[0].state = 'failed'; },
      'unserved case': value => { value.cases[0].state = 'unserved'; },
      'running case': value => { value.cases[0].state = 'running'; },
      'missing start': value => { value.cases[0].startedAt = null; },
      'missing end': value => { value.cases[0].endedAt = null; },
      'invalid timestamp': value => { value.cases[0].startedAt = 'not-a-time'; },
      'negative duration': value => { value.cases[0].endedAt = instant(-1); },
      'overlapping cases': value => { value.cases[1].startedAt = instant(500); },
      'case deadline exceeded': value => { value.cases[8].endedAt = instant(80_000 + value.cases[8].limitMs + 1); },
      'inflated allowance': value => { value.cases[0].limitMs += 1; },
      'event before case': value => { value.cases[0].events[0].at = instant(-1); },
      'event after case': value => { value.cases[0].events[0].at = instant(1_001); },
    };
    for (const [name, change] of Object.entries(changes)) {
      const adverse = structuredClone(evidence); change(adverse);
      expect(() => assertCompleteBackendControlsEvidence(adverse, binding), name).toThrow();
    }
  });

  it('cannot replace any case oracle with empty, duplicate, foreign or incomplete success events', async () => {
    const { binding, evidence } = await fixture();
    for (let index = 0; index < evidence.cases.length; index++) {
      const changes: Record<string, (value: ControlsEvidence) => void> = {
        'absent events': value => { value.cases[index].events = []; },
        'unrelated event': value => { value.cases[index].events[0] = {
          type: 'prerequisite', at: value.cases[index].events[0].at, data: { outcome: 'passed' } }; },
        'duplicate oracle': value => { value.cases[index].events.push(structuredClone(value.cases[index].events[0])); },
        'other case oracle': value => { const other = structuredClone(value.cases[(index + 1) % 9].events[0]);
          other.at = value.cases[index].events[0].at; value.cases[index].events[0] = other; },
      };
      for (const [name, change] of Object.entries(changes)) {
        const adverse = structuredClone(evidence); change(adverse);
        expect(() => assertCompleteBackendControlsEvidence(adverse, binding), index + ': ' + name).toThrow();
      }
      for (const [key, wanted] of Object.entries(evidence.cases[index].events[0].data)) {
        const missing = structuredClone(evidence); delete missing.cases[index].events[0].data[key];
        expect(() => assertCompleteBackendControlsEvidence(missing, binding), index + ': missing ' + key).toThrow();
        const changed = structuredClone(evidence);
        changed.cases[index].events[0].data[key] = typeof wanted === 'boolean' ? !wanted
          : typeof wanted === 'number' ? wanted + 1 : 'other-oracle';
        expect(() => assertCompleteBackendControlsEvidence(changed, binding), index + ': changed ' + key).toThrow();
      }
    }
  });

  it('refuses unsafe, nested and unbounded data before retaining any artifact', async () => {
    const { binding, evidence } = await fixture();
    const payloads: unknown[] = [
      { endpoint: 'https://fixture.invalid/' }, { connection: 'postgresql://runtime:fixture@fixture.invalid/db' },
      { password: 'redacted' }, { sentinel: 'redacted' }, { secret: 'redacted' }, { credential: 'redacted' },
      { sourceUrl: 'redacted' }, { value: ['https://fixture.invalid/'] }, { value: ['DATABASE_URL'] },
      { value: { nested: true } }, { value: [true, { nested: true }] }, { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY }, { value: 'x'.repeat(301) }, { value: Array(65).fill(0) },
      { 'invalid-key': true }, Object.fromEntries(Array.from({ length: 33 }, (_, index) => ['key' + index, true])),
    ];
    for (const payload of payloads) {
      const adverse = structuredClone(evidence); Object.assign(adverse.cases[0].events[0], { data: payload });
      await expect(writeBackendControlsEvidence(binding, adverse)).rejects.toThrow();
    }
    const extra = structuredClone(evidence); Object.assign(extra.cases[0].events[0], { raw: 'not permitted' });
    await expect(writeBackendControlsEvidence(binding, extra)).rejects.toThrow();
    const many = structuredClone(evidence); many.cases[0].events = Array.from({ length: 201 },
      () => structuredClone(evidence.cases[0].events[0]));
    await expect(writeBackendControlsEvidence(binding, many)).rejects.toThrow();
    const oversized = structuredClone(evidence);
    const data = Object.fromEntries(Array.from({ length: 32 }, (_, index) => ['key' + index, 'x'.repeat(300)]));
    oversized.cases[0].events = Array.from({ length: 200 }, () => ({ type: 'prerequisite', at: instant(500), data }));
    expect(() => assertBackendControlsEvidence(oversized, binding)).toThrow('evidence budget');
    await expect(writeBackendControlsEvidence(binding, oversized)).rejects.toThrow();
    await expect(readFile(join(binding.directory, BACKEND_CONTROLS_EVIDENCE_FILE), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
