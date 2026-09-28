import { describe, expect, it, vi } from 'vitest';
import { DisposableNeonApi, NeonApiError, RETAINED_NEON_PROJECT_ID,
  type DisposableNeonConfig } from './disposable-neon-api';

const config: DisposableNeonConfig = { projectId: 'league-test-123456', projectName: 'league-one-integration-tests',
  parentBranchId: 'br-empty-test', parentBranchName: 'integration-empty-parent',
  databaseName: 'league_one_integration_test', ownerRoleName: 'neondb_owner' };
const runId = '12345678-abcd-1234-abcd-123456789abc';
const projectPath = `/projects/${config.projectId}`;
const branchPath = `${projectPath}/branches/br-run-test`;
const token = 'secret-api-token-never-log';
const databasePassword = 'secret-database-password-never-log';
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
type Override = (method: string, path: string, body: Record<string, unknown> | undefined) => Response | undefined | Promise<Response | undefined>;

function fixture(override?: Override, timeouts: { operationTimeoutMs?: number; requestTimeoutMs?: number; signal?: AbortSignal } = {}) {
  let branch: Record<string, unknown> | undefined;
  const endpoint: Record<string, unknown> = { id: 'ep-run-test', project_id: config.projectId, branch_id: 'br-run-test',
    host: 'ep-run-test.us-east-1.aws.neon.tech', type: 'read_write', current_state: 'active',
    autoscaling_limit_min_cu: 0.25, autoscaling_limit_max_cu: 0.25, suspend_timeout_seconds: 300, disabled: false };
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  const mock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/api/v2', '') + url.search;
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ method, path, body });
    expect(url.origin).toBe('https://console.neon.tech');
    expect(init?.redirect).toBe('error');
    const custom = await override?.(method, path, body);
    if (custom) return custom;
    if (method === 'GET' && path === projectPath) return reply({ project: { id: config.projectId, name: config.projectName } });
    if (method === 'GET' && path === `${projectPath}/branches/${config.parentBranchId}`) return reply({ branch: {
      id: config.parentBranchId, project_id: config.projectId, name: config.parentBranchName, current_state: 'ready' } });
    if (method === 'GET' && path.startsWith(`${projectPath}/branches?`)) return reply({ branches: branch ? [branch] : [] });
    if (method === 'POST' && path === `${projectPath}/branches`) {
      branch = { ...body?.branch as object, id: 'br-run-test', project_id: config.projectId,
        current_state: 'ready', default: false, protected: false, created_at: new Date().toISOString() };
      return reply({ branch, endpoints: [endpoint], operations: [] }, 201);
    }
    if (method === 'GET' && path === branchPath) return branch ? reply({ branch }) : reply({ code: 'NOT_FOUND', message: 'not found' }, 404);
    if (method === 'GET' && path === `${projectPath}/endpoints`) return reply({ endpoints: [endpoint] });
    if (method === 'GET' && path.startsWith(`${projectPath}/connection_uri?`)) return reply({ uri:
      `postgresql://${config.ownerRoleName}:${databasePassword}@${endpoint.host}/${config.databaseName}?sslmode=require` });
    if (method === 'POST' && path === `${branchPath}/roles/${config.ownerRoleName}/reset_password`) return reply({
      role: { branch_id: 'br-run-test', name: config.ownerRoleName, password: databasePassword }, operations: [] });
    if (method === 'DELETE' && path === branchPath) { branch = undefined; return reply({ operations: [] }); }
    throw new Error(`Unexpected fake request ${method} ${path}`);
  });
  const api = new DisposableNeonApi({ apiKey: token, fetch: mock, pollIntervalMs: 1, operationTimeoutMs: 50,
    requestTimeoutMs: 100, ...timeouts });
  return { api, mock, calls, endpoint, get branch() { return branch; }, setBranch: (value: Record<string, unknown> | undefined) => { branch = value; } };
}

describe('disposable Neon API identities and owned lifecycle', () => {
  it('creates bounded, expiring ordinary branches and fetches an explicit direct owner connection', async () => {
    const state = fixture();
    const receipt = await state.api.createBranch(config, runId);
    const post = state.calls.find(call => call.method === 'POST');
    expect(post?.body?.branch).toMatchObject({ name: `l1-integration-${runId}`, parent_id: config.parentBranchId, init_source: 'parent-data' });
    expect(post?.body?.endpoints).toEqual([{ type: 'read_write', autoscaling_limit_min_cu: 0.25,
      autoscaling_limit_max_cu: 0.25, suspend_timeout_seconds: 300 }]);
    expect(Date.parse(receipt.expiresAt) - Date.now()).toBeGreaterThan(3_590_000);
    expect(Date.parse(receipt.expiresAt) - Date.now()).toBeLessThanOrEqual(3_600_000);
    expect(await state.api.getOwnerConnectionUri(config, receipt)).toContain(databasePassword);
    const connection = new URL(`https://example.com${state.calls.find(call => call.path.includes('connection_uri'))?.path}`);
    expect(Object.fromEntries(connection.searchParams)).toEqual({ branch_id: receipt.branchId,
      endpoint_id: 'ep-run-test', database_name: config.databaseName, role_name: config.ownerRoleName, pooled: 'false' });
    await state.api.deleteBranch(config, receipt);
    expect(state.api.ownedReceipts()).toEqual([]);
    expect(state.calls.at(-1)).toMatchObject({ method: 'GET', path: branchPath });
  });

  it.each([
    '?sslmode=require&host=other.neon.tech', '?sslmode=require&sslmode=disable',
    '?sslmode=require&user=other', '?sslmode=require&database=other', '?sslmode=require&options=-csearch_path%3Dother',
    '?sslmode=require&channel_binding=require&channel_binding=disable', '?sslmode=require&channel_binding=disable',
    '?sslmode=require#fragment',
  ])('rejects owner URI driver overrides or ambiguous options: %s', async suffix => {
    const state = fixture((method, path) => method === 'GET' && path.includes('/connection_uri?') ? reply({ uri:
      `postgresql://${config.ownerRoleName}:${databasePassword}@ep-run-test.us-east-1.aws.neon.tech/${config.databaseName}${suffix}` }) : undefined);
    const receipt = await state.api.createBranch(config, runId);
    await expect(state.api.getOwnerConnectionUri(config, receipt)).rejects.toThrow('identity or TLS');
  });

  it('rejects nonstandard owner URI ports and permits a single required channel binding', async () => {
    let port = ':5433';
    const state = fixture((method, path) => method === 'GET' && path.includes('/connection_uri?') ? reply({ uri:
      `postgresql://${config.ownerRoleName}:${databasePassword}@ep-run-test.us-east-1.aws.neon.tech${port}/${config.databaseName}?sslmode=require&channel_binding=require` }) : undefined);
    const receipt = await state.api.createBranch(config, runId);
    await expect(state.api.getOwnerConnectionUri(config, receipt)).rejects.toThrow('identity or TLS');
    port = ':5432';
    await expect(state.api.getOwnerConnectionUri(config, receipt)).resolves.toContain('channel_binding=require');
  });

  it.each([
    { projectId: RETAINED_NEON_PROJECT_ID }, { parentBranchId: 'br-still-breeze-avaibago' },
    { parentBranchId: 'br-rapid-boat-avgeevye' }, { projectName: 'league-one-production' },
    { parentBranchName: 'retained-users' }, { databaseName: 'production' }, { ownerRoleName: 'owner?leak' },
  ])('refuses protected or unprovable configuration before contacting Neon: %j', async change => {
    const state = fixture();
    await expect(state.api.createBranch({ ...config, ...change }, runId)).rejects.toThrow();
    expect(state.mock).not.toHaveBeenCalled();
  });

  it('rejects a preexisting same-name branch without adopting or deleting it', async () => {
    const state = fixture();
    state.setBranch({ name: `l1-integration-${runId}` });
    await expect(state.api.createBranch(config, runId)).rejects.toThrow('already exists');
    expect(state.calls.some(call => call.method !== 'GET')).toBe(false);
    expect(state.api.ownedReceipts()).toEqual([]);
  });

  it('refuses more than two non-parent branches without changing existing resources', async () => {
    const state = fixture((method, path) => method === 'GET' && path.includes('branches?')
      ? reply({ branches: [{ id: config.parentBranchId }, { id: 'br-other-test' }, { id: 'br-another-test' }] }) : undefined);
    await expect(state.api.createBranch(config, runId)).rejects.toThrow('two non-parent');
    expect(state.calls.some(call => call.method !== 'GET')).toBe(false);
  });

  it.each([
    { project: { id: config.projectId, name: 'wrong-test-project' } },
    { project: { id: 'wrong-test-123', name: config.projectName } },
  ])('requires server-reported project identity', async body => {
    const state = fixture((method, path) => method === 'GET' && path === projectPath ? reply(body) : undefined);
    await expect(state.api.createBranch(config, runId)).rejects.toThrow('project identity');
    expect(state.calls.some(call => call.method === 'POST')).toBe(false);
  });

  it('requires a permanent ready parent and full paginated inventory', async () => {
    const state = fixture((method, path) => method === 'GET' && path.includes('branches?')
      ? path.includes('cursor=next') ? reply({ branches: [{ name: `l1-integration-${runId}` }] })
        : reply({ branches: [], pagination: { cursor: 'next' } }) : undefined);
    await expect(state.api.createBranch(config, runId)).rejects.toThrow('already exists');
    const expiring = fixture((method, path) => method === 'GET' && path.endsWith(config.parentBranchId)
      ? reply({ branch: { id: config.parentBranchId, project_id: config.projectId, name: config.parentBranchName,
        current_state: 'ready', expires_at: new Date(Date.now() + 1_000).toISOString() } }) : undefined);
    await expect(expiring.api.createBranch(config, runId)).rejects.toThrow('parent identity');
  });

  it('refuses copied receipts, config changes, default/protected targets and changed branch identity', async () => {
    const state = fixture();
    const receipt = await state.api.createBranch(config, runId);
    await expect(state.api.deleteBranch(config, { ...receipt })).rejects.toThrow('not owned');
    await expect(state.api.deleteBranch({ ...config, databaseName: 'different_integration_test' }, receipt)).rejects.toThrow('not owned');
    const original = { ...state.branch };
    for (const change of [{ default: true }, { protected: true }, { parent_id: 'br-another-test' }, { created_at: '2020-01-01' }]) {
      state.setBranch({ ...original, ...change });
      await expect(state.api.deleteBranch(config, receipt)).rejects.toThrow('identity');
    }
    expect(state.calls.some(call => call.method === 'DELETE')).toBe(false);
  });

  it.each([{ autoscaling_limit_max_cu: 1 }, { suspend_timeout_seconds: -1 }, { host: 'attacker.example' }])(
    'retains cleanup ownership after rejecting unsafe compute %j', async change => {
      const state = fixture(); Object.assign(state.endpoint, change);
      await expect(state.api.createBranch(config, runId)).rejects.toThrow('compute');
      const [receipt] = state.api.ownedReceipts(); expect(receipt).toBeDefined();
      await state.api.deleteBranch(config, receipt);
      expect(state.api.ownedReceipts()).toEqual([]);
    });

  it('keeps ownership when expiration is missing so cleanup can delete its own incomplete branch', async () => {
    const state: ReturnType<typeof fixture> = fixture((method, path, body) => {
      if (method !== 'POST' || path !== `${projectPath}/branches`) return undefined;
      const branch = { ...body?.branch as object, id: 'br-run-test', project_id: config.projectId,
        default: false, protected: false, created_at: new Date().toISOString(), expires_at: undefined };
      state.setBranch(branch); return reply({ branch, operations: [] }, 201);
    });
    await expect(state.api.createBranch(config, runId)).rejects.toThrow('expiration');
    await state.api.deleteBranch(config, state.api.ownedReceipts()[0]);
    expect(state.api.ownedReceipts()).toEqual([]);
  });
});

describe('Neon asynchronous operations, ambiguous responses and redaction', () => {
  it.each(['project', 'inventory'])('cancellation during %s reads prevents the creation POST', async phase => {
    const controller = new AbortController();
    const state = fixture((method, path) => {
      if (method === 'GET' && (phase === 'project' ? path === projectPath : path.includes('branches?'))) controller.abort();
      return undefined;
    }, { signal: controller.signal });
    await expect(state.api.createBranch(config, runId)).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
    expect(state.calls.some(call => call.method === 'POST')).toBe(false);
    expect(state.api.ownedReceipts()).toEqual([]);
  });

  it('cancellation during readiness retains ownership and allows cleanup GET/DELETE', async () => {
    const controller = new AbortController();
    const state = fixture((method, path) => {
      if (method === 'GET' && path === `${projectPath}/endpoints`) controller.abort();
      return undefined;
    }, { signal: controller.signal });
    await expect(state.api.createBranch(config, runId)).rejects.toThrow('cancelled');
    const [receipt] = state.api.ownedReceipts();
    expect(receipt).toBeDefined();
    await expect(state.api.rotateOwnerCredentials(config, receipt)).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
    await expect(state.api.getOwnerConnectionUri(config, receipt)).rejects.toThrow('cancelled');
    await state.api.deleteBranch(config, receipt);
    expect(state.api.ownedReceipts()).toEqual([]);
    expect(state.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(state.calls.some(call => call.method === 'DELETE')).toBe(true);
  });

  it('polls unfinished operations and verifies the returned operation identity', async () => {
    const state = fixture(() => reply({ operation: { id: 'operation-one', project_id: config.projectId, status: 'finished' } }));
    await state.api.waitOperations(config.projectId, [{ id: 'operation-one', status: 'running' }]);
    expect(state.calls).toEqual([{ method: 'GET', path: `${projectPath}/operations/operation-one`, body: undefined }]);
    await expect(state.api.waitOperations(config.projectId, [{ id: 'different', status: 'running' }])).rejects.toThrow('identity');
  });

  it.each(['failed', 'error', 'cancelled', 'unexpected'])('refuses terminal/unrecognized operation status %s', async status => {
    const state = fixture();
    await expect(state.api.waitOperations(config.projectId, [{ id: 'operation-one', status }])).rejects.toThrow('successfully');
  });

  it('bounds operations that never finish', async () => {
    const state = fixture(() => reply({ operation: { id: 'operation-one', project_id: config.projectId, status: 'running' } }),
      { operationTimeoutMs: 5 });
    await expect(state.api.waitOperations(config.projectId, [{ id: 'operation-one', status: 'running' }])).rejects.toThrow('deadline');
  });

  it('reconciles committed creation after a lost response, issuing exactly one POST', async () => {
    const state: ReturnType<typeof fixture> = fixture((method, path, body) => {
      if (method !== 'POST' || path !== `${projectPath}/branches`) return undefined;
      state.setBranch({ ...body?.branch as object, id: 'br-run-test', project_id: config.projectId,
        default: false, protected: false, created_at: new Date().toISOString(), current_state: 'ready' });
      throw new Error(`Network error contains ${token}`);
    });
    const receipt = await state.api.createBranch(config, runId);
    expect(state.api.ownedReceipts()).toEqual([receipt]);
    expect(state.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    await state.api.deleteBranch(config, receipt);
  });

  it.each([{}, { branch: { id: config.parentBranchId } }])('reconciles malformed successful create response %j', async response => {
    let journaled = false;
    const state: ReturnType<typeof fixture> = fixture((method, path, body) => {
      if (method !== 'POST' || path !== `${projectPath}/branches`) return undefined;
      expect(journaled).toBe(true);
      state.setBranch({ ...body?.branch as object, id: 'br-run-test', project_id: config.projectId,
        default: false, protected: false, created_at: new Date().toISOString(), current_state: 'ready' });
      return reply(response, 201);
    });
    const receipt = await state.api.createBranch(config, runId, async intent => {
      expect(intent).toMatchObject({ projectId: config.projectId, parentBranchId: config.parentBranchId,
        branchName: `l1-integration-${runId}` });
      expect(Date.parse(intent.expiresAt)).toBeGreaterThan(Date.now());
      await Promise.resolve(); journaled = true;
    });
    expect(state.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    await state.api.deleteBranch(config, receipt);
  });

  it('does not create a branch if durable intent recording fails', async () => {
    const state = fixture();
    await expect(state.api.createBranch(config, runId, () => { throw new Error('journal unavailable'); })).rejects.toThrow('journal');
    expect(state.calls.some(call => call.method === 'POST')).toBe(false);
  });

  it('rotates only its owned child owner and waits for the rotation operation before returning', async () => {
    const state = fixture((method, path) => {
      if (method === 'POST' && path.endsWith('/reset_password')) return reply({ role: {
        name: config.ownerRoleName, branch_id: 'br-run-test', password: databasePassword },
      operations: [{ id: 'rotation-operation', status: 'running' }] });
      if (method === 'GET' && path.endsWith('/operations/rotation-operation')) return reply({
        operation: { id: 'rotation-operation', project_id: config.projectId, status: 'finished' } });
    });
    const receipt = await state.api.createBranch(config, runId);
    await expect(state.api.rotateOwnerCredentials(config, { ...receipt })).rejects.toThrow('not owned');
    await state.api.rotateOwnerCredentials(config, receipt);
    expect(state.calls.filter(call => call.path.endsWith('/reset_password'))).toEqual([
      { method: 'POST', path: `${branchPath}/roles/${config.ownerRoleName}/reset_password`, body: undefined }]);
    expect(state.calls.at(-1)?.path).toBe(`${projectPath}/operations/rotation-operation`);
  });

  it('never retries uncertain creation when no branch can be found', async () => {
    const state = fixture(method => { if (method === 'POST') throw new Error('network'); return undefined; }, { operationTimeoutMs: 5 });
    await expect(state.api.createBranch(config, runId)).rejects.toThrow('could not be reconciled');
    expect(state.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(state.api.ownedReceipts()).toEqual([]);
  });

  it('retains owned receipts when creation operations fail', async () => {
    const state: ReturnType<typeof fixture> = fixture((method, path, body) => {
      if (method !== 'POST' || path !== `${projectPath}/branches`) return undefined;
      const branch = { ...body?.branch as object, id: 'br-run-test', project_id: config.projectId,
        default: false, protected: false, created_at: new Date().toISOString() };
      state.setBranch(branch); return reply({ branch, operations: [{ id: 'operation-one', status: 'failed', error: token }] }, 201);
    });
    await expect(state.api.createBranch(config, runId)).rejects.toThrow('successfully');
    await state.api.deleteBranch(config, state.api.ownedReceipts()[0]);
  });

  it('requires absence after deletion and does not confuse authorization failure with cleanup', async () => {
    let deny = false;
    const state = fixture((method, path) => deny && method === 'GET' && path === branchPath
      ? reply({ code: 'FORBIDDEN', request_id: 'safe-request-id', message: token }, 403) : undefined);
    const receipt = await state.api.createBranch(config, runId);
    deny = true;
    await expect(state.api.deleteBranch(config, receipt)).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(state.api.ownedReceipts()).toEqual([receipt]);
    expect(state.calls.some(call => call.method === 'DELETE')).toBe(false);
  });

  it('verifies absence after an ambiguous deletion without repeating DELETE', async () => {
    const state: ReturnType<typeof fixture> = fixture(method => {
      if (method !== 'DELETE') return undefined;
      state.setBranch(undefined); throw new Error('lost response');
    });
    const receipt = await state.api.createBranch(config, runId);
    await state.api.deleteBranch(config, receipt);
    expect(state.calls.filter(call => call.method === 'DELETE')).toHaveLength(1);
    expect(state.api.ownedReceipts()).toEqual([]);
  });

  it.each(['invalid-json', 'empty-object', 'primitive', 'malformed-operations'])('verifies absence after malformed deletion success: %s', async shape => {
    const state: ReturnType<typeof fixture> = fixture(method => {
      if (method !== 'DELETE') return undefined;
      state.setBranch(undefined);
      if (shape === 'invalid-json') return new Response('not JSON', { status: 200 });
      if (shape === 'empty-object') return reply({});
      if (shape === 'primitive') return reply(null);
      return reply({ operations: [{ status: 'finished' }] });
    });
    const receipt = await state.api.createBranch(config, runId);
    await state.api.deleteBranch(config, receipt);
    expect(state.calls.filter(call => call.method === 'DELETE')).toHaveLength(1);
    expect(state.calls.at(-1)).toMatchObject({ method: 'GET', path: branchPath });
    expect(state.api.ownedReceipts()).toEqual([]);
  });

  it('does not claim cleanup when a malformed DELETE response leaves the branch present', async () => {
    const state = fixture(method => method === 'DELETE' ? reply({}) : undefined, { operationTimeoutMs: 5 });
    const receipt = await state.api.createBranch(config, runId);
    await expect(state.api.deleteBranch(config, receipt)).rejects.toThrow('remains unverified');
    expect(state.api.ownedReceipts()).toEqual([receipt]);
    expect(state.calls.filter(call => call.method === 'DELETE')).toHaveLength(1);
  });

  it('redacts error bodies, URI query values, raw fetch causes and echoed API keys', async () => {
    const state = fixture(() => reply({ message: `${token} postgresql://owner:${databasePassword}@host/db`,
      code: 'LOCKED', request_id: 'safe-request-id' }, 423));
    const failure = await state.api.request('GET', `${projectPath}/connection_uri?password=${databasePassword}`).catch(error => error);
    expect(failure).toBeInstanceOf(NeonApiError);
    if (!(failure instanceof NeonApiError)) throw new Error('Expected sanitized Neon API error');
    expect(failure.message).toContain('423 LOCKED (safe-request-id)');
    expect(String(failure)).not.toContain(token); expect(String(failure)).not.toContain(databasePassword);
    expect(failure.cause).toBeUndefined();
    const echo = fixture(() => reply({ code: token, request_id: token, message: token }, 400));
    await expect(echo.api.request('GET', projectPath)).rejects.toMatchObject({ code: 'API_ERROR', requestId: undefined });
    const network = fixture(() => { throw new Error(databasePassword); });
    const networkFailure = await network.api.request('GET', projectPath).catch(error => error);
    if (!(networkFailure instanceof NeonApiError)) throw new Error('Expected sanitized Neon transport error');
    expect(networkFailure.code).toBe('REQUEST_FAILED');
    expect(networkFailure.cause).toBeUndefined();
    expect(String(networkFailure)).not.toContain(databasePassword);
  });

  it('bounds requests even when a fetch implementation ignores abort', async () => {
    const state = fixture(() => new Promise(() => undefined), { requestTimeoutMs: 5 });
    await expect(state.api.request('GET', projectPath)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  });

  it.each([`/projects/${RETAINED_NEON_PROJECT_ID}`, `${projectPath}/branches/br-still-breeze-avaibago`,
    `${projectPath}/../other`, '//attacker.example/projects/test', `${projectPath}/connection_uri#secret`])(
    'refuses unsafe direct API path %s', async path => {
      const state = fixture();
      await expect(state.api.request('GET', path)).rejects.toThrow('Unsafe');
      expect(state.mock).not.toHaveBeenCalled();
    });
});
