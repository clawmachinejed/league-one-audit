import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capturePublicSleeperIdentity } from '../lib/sleeper';
import { fixtureFetch, recoveryFixture, parseRecoveryWorkerConfig, parseRecoveryMessage, recoveryWorkerEnvironment,
  recoveryStartMessage, assertRecoveryStart,
  PROCESS_RECOVERY_CONFIG, PROCESS_RECOVERY_DATABASE, PROCESS_RECOVERY_VERSION, type RecoveryWorkerConfig } from './process-recovery-protocol';

vi.mock('server-only', () => ({}));

const config = (): RecoveryWorkerConfig => ({ nonce: randomUUID(), contextNonce: randomUUID(), fixtureId: randomUUID(),
  requestId: randomUUID(), gitSha: 'a'.repeat(40), profileDigest: 'b'.repeat(64), expectedDatabase: 'cp22_test',
  expectedBranch: 'br-cp22-test', mode: 'intake', barrier: 'draft-admitted', untilProgress: true });
const message = (input: RecoveryWorkerConfig) => ({ version: PROCESS_RECOVERY_VERSION, nonce: input.nonce,
  contextNonce: input.contextNonce, gitSha: input.gitSha, profileDigest: input.profileDigest, pid: 400,
  type: 'barrier', backendPid: 401, backendStart: '2026-10-15T00:00:00.000Z', database: input.expectedDatabase,
  branch: input.expectedBranch, currentUser: 'league_one_runtime', sessionUser: 'league_one_runtime',
  at: '2026-10-15T00:00:01.000Z', requests: 0, workerId: randomUUID(), generation: 2,
  deadlineAt: '2026-10-15T00:00:20.000Z', resource: 'drafts', barrier: 'draft-admitted', requestId: input.requestId });

afterEach(() => vi.restoreAllMocks());
describe('CP22 process boundary protocol without database access', () => {
  it('permits only a bound startup acknowledgment without transferring or releasing durable work', () => {
    const input = config(), start = recoveryStartMessage(input);
    expect(() => assertRecoveryStart(start, input)).not.toThrow();
    for (const changes of [{ type: 'continue' }, { nonce: randomUUID() }, { contextNonce: randomUUID() },
      { profileDigest: 'c'.repeat(64) }, { gitSha: 'c'.repeat(40) }, { work: {} }, { capture: {} }, { receipt: 'id' }]) {
      expect(() => assertRecoveryStart({ ...start, ...changes }, input)).toThrow();
    }
    expect(() => assertRecoveryStart(null, input)).toThrow();
  });
  it('strips unrelated credentials and process injection while retaining only the explicit runtime target', () => {
    const input = config(), url = 'postgresql://league_one_runtime:fixture@cp22.invalid/cp22_test?sslmode=require';
    const env = recoveryWorkerEnvironment({ PATH: 'bin', NODE_OPTIONS: '--import=unsafe', NEON_API_KEY: 'secret',
      DATABASE_URL: 'production', PROJECTION_INTEGRATION_OWNER_DATABASE_URL: 'owner', AUTH_RESET_INTEGRATION_DATABASE_URL: 'auth',
      ACCOUNT_FRESH_INSTALL_DATABASE_URL: 'account', PROJECTION_INTEGRATION_OWNER_PROOF: 'proof' }, url, input);
    expect(env).toEqual({ PATH: 'bin', NODE_ENV: 'test', [PROCESS_RECOVERY_DATABASE]: url, [PROCESS_RECOVERY_CONFIG]: JSON.stringify(input) });
    expect(() => recoveryWorkerEnvironment({}, url.replace('league_one_runtime', 'owner'), input)).toThrow('restricted runtime');
    expect(() => recoveryWorkerEnvironment({}, url.replace('sslmode=require', 'sslmode=disable'), input)).toThrow('restricted runtime');
    expect(() => recoveryWorkerEnvironment({}, url.replace('/cp22_test?', '/other_test?'), input)).toThrow('restricted runtime');
  });
  it('rejects in-memory attempt or witness transfer and malformed fixture or source bindings', () => {
    const input = config(); expect(parseRecoveryWorkerConfig(input)).toEqual(input);
    for (const extra of ['work', 'fence', 'capture', 'receipt', 'attempt', 'witness']) {
      expect(() => parseRecoveryWorkerConfig({ ...input, [extra]: {} })).toThrow();
    }
    for (const bad of [{ requestId: 'x' }, { fixtureId: 'x' }, { profileDigest: 'x' }, { gitSha: 'x' }, { expectedBranch: 'main' }]) {
      expect(() => parseRecoveryWorkerConfig({ ...input, ...bad })).toThrow();
    }
  });
  it('rejects cross-process source context role target and barrier substitutions or incomplete evidence', () => {
    const input = config(), valid = message(input); expect(parseRecoveryMessage(valid, input, 400)).toEqual(valid);
    for (const changes of [{ pid: 402 }, { nonce: randomUUID() }, { contextNonce: randomUUID() }, { gitSha: 'c'.repeat(40) },
      { profileDigest: 'c'.repeat(64) }, { currentUser: 'owner' }, { sessionUser: 'owner' }, { database: 'other_test' },
      { branch: 'br-other-test' }, { barrier: 'core-all-accepted' }, { requests: 3 }, { error: 'unsafe error' },
      { requestId: randomUUID() }, { resource: 'core' },
      { workerId: undefined }, { generation: undefined }, { deadlineAt: undefined }, { requestId: undefined }, { resource: undefined }]) {
      expect(() => parseRecoveryMessage({ ...valid, ...changes }, input, 400)).toThrow();
    }
    expect(() => parseRecoveryMessage({ ...valid, type: 'result', barrier: undefined, status: undefined }, input, 400)).toThrow();
    expect(() => parseRecoveryMessage({ ...valid, type: 'claim', barrier: undefined, workerId: undefined }, input, 400)).toThrow();
  });
  it('serves both username and recurring stable identity through the real bounded source adapter', async () => {
    const input = config(), fixture = recoveryFixture(input.fixtureId), urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(fixtureFetch(input.fixtureId, url => urls.push(url)));
    for (const lookup of [fixture.username, fixture.manager]) {
      const capture = await capturePublicSleeperIdentity(lookup, new AbortController().signal);
      expect(capture.value).toMatchObject({ userId: fixture.manager, username: fixture.username });
      expect(capture.payload).toEqual({ user_id: fixture.manager, username: fixture.username });
      expect(Date.parse(capture.requestCompletedAt)).toBeGreaterThanOrEqual(Date.parse(capture.requestStartedAt));
    }
    expect(urls).toEqual([fixture.username, fixture.manager].map(value => 'https://api.sleeper.app/v1/user/' + value));
  });
  it('fails closed on nonfixture providers methods and live season traversal', async () => {
    const input = config(), observed = vi.fn(), source = fixtureFetch(input.fixtureId, observed);
    const fixture = recoveryFixture(input.fixtureId);
    await expect(source('https://api.tank01.com/')).rejects.toThrow('nonfixture');
    await expect(source('https://api.sleeper.app/v1/user/' + fixture.manager + '/leagues/nfl/2025')).rejects.toThrow('nonfixture');
    await expect(source('https://api.sleeper.app/v1/user/' + fixture.username, { method: 'POST' })).rejects.toThrow('nonfixture');
    expect(observed).not.toHaveBeenCalled();
  });
});
