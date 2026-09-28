// This control-plane client is used only by the supervised, disposable SQL test runner.
// API semantics: https://neon.com/api_spec/release/v2.json
const API_ORIGIN = 'https://console.neon.tech/api/v2';
export const RETAINED_NEON_PROJECT_ID = 'solitary-base-99261075';
const RETAINED_BRANCH_IDS = new Set(['br-rapid-boat-avgeevye', 'br-still-breeze-avaibago']);
const ID = /^[a-z0-9-]{1,60}$/;
const TEST_NAME = /(?:^|[-_])(?:test|tests|integration)(?:$|[-_])/i;
type Method = 'GET' | 'POST' | 'DELETE';
type JsonObject = Record<string, unknown>;

export type DisposableNeonConfig = Readonly<{
  projectId: string;
  projectName: string;
  parentBranchId: string;
  parentBranchName: string;
  databaseName: string;
  ownerRoleName: string;
}>;

export type DisposableNeonBranchReceipt = Readonly<{
  projectId: string;
  parentBranchId: string;
  branchId: string;
  branchName: string;
  createdAt: string;
  expiresAt: string;
}>;

export type DisposableNeonCreationIntent = Readonly<{
  projectId: string;
  parentBranchId: string;
  branchName: string;
  expiresAt: string;
}>;

export class NeonApiError extends Error {
  constructor(
    readonly method: Method,
    readonly path: string,
    readonly status: number | undefined,
    readonly code: string,
    readonly requestId?: string,
  ) {
    // Never retain response messages, bodies, request bodies, URIs, tokens, or fetch causes.
    super(`Neon ${method} ${path}: ${status ?? 'transport'} ${code}${requestId ? ` (${requestId})` : ''}`);
    this.name = 'NeonApiError';
  }
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Neon response shape');
  return value as JsonObject;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid Neon response list');
  return value;
}

function metadata(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value) ? value : undefined;
}

function requireConfig(config: DisposableNeonConfig): void {
  if (!ID.test(config.projectId) || config.projectId === RETAINED_NEON_PROJECT_ID ||
    !/^br-[a-z0-9-]+$/.test(config.parentBranchId) || RETAINED_BRANCH_IDS.has(config.parentBranchId) ||
    !TEST_NAME.test(config.projectName) || !TEST_NAME.test(config.parentBranchName) ||
    !/^[a-z][a-z0-9_]{0,62}$/.test(config.databaseName) || !TEST_NAME.test(config.databaseName) ||
    !/^[a-z][a-z0-9_]{0,62}$/.test(config.ownerRoleName)) {
    throw new Error('A dedicated test-only Neon project and explicit test identities are required');
  }
}

export class DisposableNeonApi {
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #requestTimeoutMs: number;
  readonly #operationTimeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #signal: AbortSignal | undefined;
  readonly #owned = new Map<DisposableNeonBranchReceipt, DisposableNeonConfig>();

  constructor(options: {
    apiKey: string;
    fetch?: typeof fetch;
    requestTimeoutMs?: number;
    operationTimeoutMs?: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
  }) {
    if (!options.apiKey || /[\r\n]/.test(options.apiKey)) throw new Error('A Neon API key is required');
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? fetch;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.#operationTimeoutMs = options.operationTimeoutMs ?? 180_000;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.#signal = options.signal;
    if ([this.#requestTimeoutMs, this.#operationTimeoutMs, this.#pollIntervalMs]
      .some(value => !Number.isSafeInteger(value) || value < 1 || value > 300_000)) {
      throw new Error('Invalid Neon API timeout configuration');
    }
  }

  ownedReceipts(): readonly DisposableNeonBranchReceipt[] {
    return [...this.#owned.keys()];
  }

  async request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    // There is no overrideable API origin, redirect following, or production-project access.
    const parsed = new URL(`${API_ORIGIN}${path}`);
    const pathname = path.split('?')[0];
    const project = /^\/projects\/([a-z0-9-]+)(?:\/|$)/.exec(path)?.[1];
    if (!/^\/projects\/[a-z0-9-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(pathname) || !project || !ID.test(project) ||
      project === RETAINED_NEON_PROJECT_ID || parsed.origin !== new URL(API_ORIGIN).origin ||
      parsed.pathname !== `/api/v2${path.split('?')[0]}` || parsed.hash ||
      path.split(/[/?]/).some(part => RETAINED_BRANCH_IDS.has(part))) {
      throw new Error('Unsafe Neon API target');
    }
    const safePath = pathname;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new NeonApiError(method, safePath, undefined, 'REQUEST_TIMEOUT'));
      }, this.#requestTimeoutMs);
    });
    try {
      return await Promise.race([timeout, (async () => {
        // Cancellation prevents new provisioning writes, while cleanup GET/DELETE
        // requests remain available. Already-sent writes must still be reconciled.
        if (method === 'POST' && this.#signal?.aborted) {
          throw new NeonApiError(method, safePath, undefined, 'REQUEST_CANCELLED');
        }
        const response = await this.#fetch(parsed, {
          method, redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${this.#apiKey}`, Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (!response.ok) {
          let error: JsonObject = {};
          try { error = object(await response.json()); } catch { /* Untrusted error text is discarded. */ }
          const code = metadata(error.code);
          const requestId = metadata(error.request_id);
          throw new NeonApiError(method, safePath, response.status,
            code && !code.includes(this.#apiKey) ? code : 'API_ERROR',
            requestId && !requestId.includes(this.#apiKey) ? requestId : undefined);
        }
        if (response.status === 204) return undefined as T;
        try { return await response.json() as T; }
        catch { throw new NeonApiError(method, safePath, response.status, 'INVALID_JSON'); }
      })()]);
    } catch (error) {
      if (error instanceof NeonApiError) throw error;
      throw new NeonApiError(method, safePath, undefined, 'REQUEST_FAILED');
    } finally {
      clearTimeout(timer);
    }
  }

  async validateTarget(config: DisposableNeonConfig): Promise<void> {
    requireConfig(config);
    const { project } = await this.request<{ project: JsonObject }>('GET', `/projects/${config.projectId}`);
    if (project?.id !== config.projectId || project.name !== config.projectName) {
      throw new Error('Neon test project identity mismatch');
    }
    const { branch } = await this.request<{ branch: JsonObject }>('GET',
      `/projects/${config.projectId}/branches/${config.parentBranchId}`);
    if (branch?.id !== config.parentBranchId || branch.project_id !== config.projectId ||
      branch.name !== config.parentBranchName || branch.expires_at || branch.current_state !== 'ready') {
      throw new Error('Neon empty test parent identity mismatch');
    }
  }

  async listBranches(config: DisposableNeonConfig): Promise<JsonObject[]> {
    requireConfig(config);
    const branches: JsonObject[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const response = object(await this.request('GET', `/projects/${config.projectId}/branches?limit=100${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`));
      branches.push(...array(response.branches).map(object));
      const pagination = response.pagination ? object(response.pagination) : {};
      if (pagination.cursor === undefined || pagination.cursor === null || pagination.cursor === '') return branches;
      if (typeof pagination.cursor !== 'string' || cursors.has(pagination.cursor)) {
        throw new Error('Invalid Neon branch pagination');
      }
      cursor = pagination.cursor;
      cursors.add(cursor);
    }
    throw new Error('Neon branch inventory exceeded its bounded page limit');
  }

  async waitOperations(projectId: string, operations: unknown): Promise<void> {
    const pending = array(operations).map(item => {
      const operation = object(item);
      if (typeof operation.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(operation.id)) {
        throw new Error('Invalid Neon operation identity');
      }
      return operation;
    });
    const deadline = Date.now() + this.#operationTimeoutMs;
    while (pending.length) {
      for (let index = pending.length - 1; index >= 0; index--) {
        const operation = pending[index];
        if (operation.status === 'finished' || operation.status === 'skipped') {
          pending.splice(index, 1);
        } else if (!['scheduling', 'running', 'cancelling'].includes(String(operation.status))) {
          // In particular, failed/error/cancelled never count as a successful operation.
          throw new Error('Neon operation did not finish successfully');
        }
      }
      if (!pending.length) return;
      if (Date.now() >= deadline) throw new Error('Neon operation deadline exceeded');
      await this.#pause();
      for (let index = 0; index < pending.length; index++) {
        const id = pending[index].id;
        const result = object(await this.request('GET', `/projects/${projectId}/operations/${id}`));
        const operation = object(result.operation);
        if (operation.id !== id || operation.project_id !== projectId) throw new Error('Neon operation identity mismatch');
        pending[index] = operation;
      }
    }
  }

  async createBranch(config: DisposableNeonConfig, runId: string,
    onIntent?: (intent: DisposableNeonCreationIntent) => void | Promise<void>): Promise<DisposableNeonBranchReceipt> {
    if (!/^[a-z0-9][a-z0-9-]{5,80}$/.test(runId)) throw new Error('Invalid disposable integration run identity');
    await this.validateTarget(config);
    const branchName = `l1-integration-${runId}`;
    const inventory = await this.listBranches(config);
    if (inventory.some(branch => branch.name === branchName)) {
      throw new Error('Disposable Neon run branch already exists; it is not owned by this process');
    }
    // Admission is also serialized by CI. This inventory cap bounds normal use and
    // refuses accumulating branches; it is not a cross-process atomic lock.
    if (inventory.filter(branch => branch.id !== config.parentBranchId).length >= 2) {
      throw new Error('Disposable Neon project already has two non-parent branches');
    }
    const startedAt = Date.now();
    const expiresAt = new Date(startedAt + 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    await onIntent?.(Object.freeze({ projectId: config.projectId, parentBranchId: config.parentBranchId, branchName, expiresAt }));
    let response: JsonObject;
    let receipt: DisposableNeonBranchReceipt;
    const previouslyOwned = this.#owned.size;
    try {
      response = object(await this.request('POST', `/projects/${config.projectId}/branches`, {
        branch: { name: branchName, parent_id: config.parentBranchId, init_source: 'parent-data', expires_at: expiresAt },
        endpoints: [{ type: 'read_write', autoscaling_limit_min_cu: 0.25,
          autoscaling_limit_max_cu: 0.25, suspend_timeout_seconds: 300 }],
      }));
      receipt = this.#register(config, object(response.branch), branchName, expiresAt, startedAt);
    } catch (error) {
      // A known branch is already available to the caller's finally block. Do not
      // re-register it if a later identity/expiration assertion failed.
      if (this.#owned.size > previouslyOwned) throw error;
      if (error instanceof NeonApiError && error.code === 'REQUEST_CANCELLED') throw error;
      if (error instanceof NeonApiError && error.status !== undefined && error.status < 500 && error.code !== 'INVALID_JSON') throw error;
      // An ambiguous POST may have committed. Reconcile by the unique preflight-absent name;
      // never retry after a lost result or a successful but malformed response.
      const deadline = Date.now() + this.#operationTimeoutMs;
      do {
        const matches = (await this.listBranches(config)).filter(branch => branch.name === branchName);
        if (matches.length > 1) throw new Error('Ambiguous Neon branch creation identity');
        if (matches.length === 1) {
          const receipt = this.#register(config, matches[0], branchName, expiresAt, startedAt);
          await this.#waitReady(config, receipt);
          return receipt;
        }
        if (Date.now() >= deadline) throw new Error('Neon creation could not be reconciled; expiration remains the fallback');
        await this.#pause();
      } while (true);
    }
    await this.waitOperations(config.projectId, response.operations);
    await this.#waitReady(config, receipt);
    return receipt;
  }

  async rotateOwnerCredentials(config: DisposableNeonConfig, receipt: DisposableNeonBranchReceipt): Promise<void> {
    this.#requireOwned(config, receipt);
    const path = `/projects/${config.projectId}/branches/${receipt.branchId}`;
    const before = object(await this.request('GET', path));
    this.#assertBranch(object(before.branch), receipt);
    // Ordinary branches inherit their parent's passwords. Rotate only the owned
    // disposable child before exposing any SQL credential to candidate test code.
    const response = object(await this.request('POST', `${path}/roles/${config.ownerRoleName}/reset_password`));
    const role = object(response.role);
    if (role.branch_id !== receipt.branchId || role.name !== config.ownerRoleName) {
      throw new Error('Disposable Neon owner rotation identity mismatch');
    }
    await this.waitOperations(config.projectId, response.operations);
  }

  async getOwnerConnectionUri(config: DisposableNeonConfig, receipt: DisposableNeonBranchReceipt): Promise<string> {
    this.#assertNotCancelled();
    this.#requireOwned(config, receipt);
    const endpoint = await this.#endpoint(config, receipt);
    this.#assertNotCancelled();
    const params = new URLSearchParams({ branch_id: receipt.branchId, endpoint_id: String(endpoint.id),
      database_name: config.databaseName, role_name: config.ownerRoleName, pooled: 'false' });
    const response = object(await this.request('GET', `/projects/${config.projectId}/connection_uri?${params}`));
    this.#assertNotCancelled();
    try {
      if (typeof response.uri !== 'string') throw new Error();
      const uri = new URL(response.uri);
      // The PostgreSQL driver accepts query-string overrides (including host,
      // user and database) and duplicate parameters. Validate the entire URI,
      // not just URL.hostname or the first sslmode value.
      const queryNames = [...uri.searchParams.keys()];
      if (!['postgres:', 'postgresql:'].includes(uri.protocol) || uri.hostname !== endpoint.host ||
        uri.hash || (uri.port !== '' && uri.port !== '5432') ||
        queryNames.some(name => !['sslmode', 'channel_binding'].includes(name)) ||
        new Set(queryNames).size !== queryNames.length ||
        (uri.searchParams.has('channel_binding') && uri.searchParams.get('channel_binding') !== 'require') ||
        uri.hostname.includes('-pooler.') || decodeURIComponent(uri.username) !== config.ownerRoleName ||
        decodeURIComponent(uri.pathname.slice(1)) !== config.databaseName || !uri.password ||
        !['require', 'verify-ca', 'verify-full'].includes(uri.searchParams.get('sslmode') ?? '')) throw new Error();
      return response.uri;
    } catch { throw new Error('Neon owner connection identity or TLS mismatch'); }
  }

  async deleteBranch(config: DisposableNeonConfig, receipt: DisposableNeonBranchReceipt): Promise<void> {
    this.#requireOwned(config, receipt);
    const path = `/projects/${config.projectId}/branches/${receipt.branchId}`;
    try {
      const before = object(await this.request('GET', path));
      this.#assertBranch(object(before.branch), receipt, false);
    } catch (error) {
      if (!(error instanceof NeonApiError && error.status === 404)) throw error;
      this.#owned.delete(receipt);
      return;
    }
    let result: unknown;
    try { result = await this.request('DELETE', path); }
    catch (error) {
      if (!(error instanceof NeonApiError) ||
        (error.status !== undefined && error.status < 500 && error.code !== 'INVALID_JSON')) throw error;
      // The deletion may have committed; verify absence without blindly repeating DELETE.
    }
    let operations: unknown[] | undefined;
    if (result !== undefined) {
      try {
        const candidates = array(object(result).operations);
        for (const candidate of candidates) {
          const operation = object(candidate);
          if (typeof operation.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(operation.id) ||
            !['scheduling', 'running', 'finished', 'failed', 'error', 'cancelling', 'cancelled', 'skipped'].includes(String(operation.status))) {
            throw new Error('Malformed deletion operation');
          }
        }
        operations = candidates;
      } catch { /* Malformed success response: reconcile authoritative absence below. */ }
    }
    if (operations) await this.waitOperations(config.projectId, operations);
    const deadline = Date.now() + this.#operationTimeoutMs;
    do {
      try {
        const result = object(await this.request('GET', path));
        this.#assertBranch(object(result.branch), receipt, false);
      } catch (error) {
        if (!(error instanceof NeonApiError && error.status === 404)) throw error;
        this.#owned.delete(receipt);
        return;
      }
      if (Date.now() >= deadline) throw new Error('Neon branch deletion remains unverified');
      await this.#pause();
    } while (true);
  }

  #register(config: DisposableNeonConfig, branch: JsonObject, name: string, expiresAt: string,
    startedAt: number): DisposableNeonBranchReceipt {
    if (typeof branch.id !== 'string' || !/^br-[a-z0-9-]+$/.test(branch.id) ||
      RETAINED_BRANCH_IDS.has(branch.id) || branch.id === config.parentBranchId ||
      branch.name !== name || branch.project_id !== config.projectId || branch.parent_id !== config.parentBranchId ||
      typeof branch.created_at !== 'string' || !Number.isFinite(Date.parse(branch.created_at)) ||
      Date.parse(branch.created_at) < startedAt - 2_000 || Date.parse(branch.created_at) > Date.now() + 5_000) {
      throw new Error('Neon created branch identity mismatch');
    }
    const receipt = Object.freeze({ projectId: config.projectId, parentBranchId: config.parentBranchId,
      branchId: branch.id, branchName: name, createdAt: branch.created_at, expiresAt });
    // Register before checking operations, expiry, endpoints, or readiness so failure still has a cleanup target.
    this.#owned.set(receipt, Object.freeze({ ...config }));
    this.#assertBranch(branch, receipt);
    return receipt;
  }

  #requireOwned(config: DisposableNeonConfig, receipt: DisposableNeonBranchReceipt): void {
    requireConfig(config);
    const original = this.#owned.get(receipt);
    if (!original || Object.keys(original).some(key => original[key as keyof DisposableNeonConfig] !== config[key as keyof DisposableNeonConfig])) {
      throw new Error('Neon branch is not owned by this supervisor');
    }
  }

  #assertBranch(branch: JsonObject, receipt: DisposableNeonBranchReceipt, requireExpiration = true): void {
    if (branch.id !== receipt.branchId || branch.project_id !== receipt.projectId ||
      branch.parent_id !== receipt.parentBranchId || branch.name !== receipt.branchName ||
      branch.created_at !== receipt.createdAt || branch.default !== false || branch.protected !== false ||
      (requireExpiration && Date.parse(String(branch.expires_at)) !== Date.parse(receipt.expiresAt))) {
      throw new Error('Neon disposable branch identity or expiration mismatch');
    }
  }

  async #endpoint(config: DisposableNeonConfig, receipt: DisposableNeonBranchReceipt): Promise<JsonObject> {
    const reply = object(await this.request('GET', `/projects/${config.projectId}/endpoints`));
    const endpoints = array(reply.endpoints).map(object).filter(endpoint => endpoint.branch_id === receipt.branchId);
    if (endpoints.length !== 1) throw new Error('Disposable Neon branch must have exactly one compute');
    const endpoint = endpoints[0];
    if (endpoint.project_id !== config.projectId || typeof endpoint.id !== 'string' || !/^ep-[a-z0-9-]+$/.test(endpoint.id) ||
      typeof endpoint.host !== 'string' || !endpoint.host.startsWith(`${endpoint.id}.`) || !endpoint.host.endsWith('.neon.tech') ||
      endpoint.type !== 'read_write' || endpoint.autoscaling_limit_min_cu !== 0.25 || endpoint.autoscaling_limit_max_cu !== 0.25 ||
      endpoint.suspend_timeout_seconds !== 300) {
      throw new Error('Disposable Neon compute identity or cost limits mismatch');
    }
    return endpoint;
  }

  async #waitReady(config: DisposableNeonConfig, receipt: DisposableNeonBranchReceipt): Promise<void> {
    const deadline = Date.now() + this.#operationTimeoutMs;
    do {
      this.#assertNotCancelled();
      const response = object(await this.request('GET', `/projects/${config.projectId}/branches/${receipt.branchId}`));
      const branch = object(response.branch);
      this.#assertBranch(branch, receipt);
      const endpoint = await this.#endpoint(config, receipt);
      this.#assertNotCancelled();
      if (branch.current_state === 'ready' && ['active', 'idle'].includes(String(endpoint.current_state)) &&
        !endpoint.pending_state && !endpoint.disabled) return;
      if (Date.now() >= deadline) throw new Error('Disposable Neon readiness deadline exceeded');
      await this.#pause();
    } while (true);
  }

  async #pause(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, this.#pollIntervalMs));
  }

  #assertNotCancelled(): void {
    if (this.#signal?.aborted) throw new Error('Disposable Neon provisioning cancelled');
  }
}
