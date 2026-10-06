import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { accountAcquisitionResponse, acquisitionCommand } from './discovery-http';
import type { createAccountDiscoveryService } from './discovery-service';
import { storedSleeperDiscovery } from './stored-discovery';
import type { StoredDiscoveryResult } from './discovery-contracts';

const actor = '10000000-0000-4000-8000-000000000001';
const commandId = '20000000-0000-4000-8000-000000000002';
const demandId = '30000000-0000-4000-8000-000000000003';
const timing = { dbSampleAt: '2026-10-06T00:00:00.000Z', minimumAuthorityExpiresAt: '2026-10-06T00:01:00.000Z', remainingLifetimeMs: '60000' };
const principal = { issuer: 'https://test.invalid/api/auth', subject: 'test-subject', displayName: 'Member' };
const retained: StoredDiscoveryResult = { status: 'available', demandId, scanId: commandId, providerAccountId: actor,
  nativeAccountId: '123', displayName: 'Manager', currentSeason: 2026, coverage: 'complete',
  requiredSeasons: [2026, 2025, 2024], completedSeasons: [2026, 2025, 2024],
  candidates: [{ id: '987', name: 'A candidate', season: '2026', avatar: null }] };
function setup() {
  const port = { admit: vi.fn(async () => ({ result: { status: 'pending', demandId, retryAfterSeconds: 2 }, decisionTiming: timing })),
    read: vi.fn(async () => ({ result: { status: 'pending', demandId, retryAfterSeconds: 2 }, decisionTiming: timing })),
    activate: vi.fn(async () => ({ result: { status: 'denied', reason: 'unavailable' }, decisionTiming: null })),
    readDiscovery: vi.fn(async () => ({ result: retained, decisionTiming: timing })) };
  const service = { resolve: vi.fn(async () => actor), forActor: vi.fn(() => port) };
  return { port, service, dependencies: { principal: vi.fn(async () => principal as typeof principal | null),
    service: vi.fn(() => service as unknown as ReturnType<typeof createAccountDiscoveryService>) } };
}
function request(body: unknown = { kind: 'identify', commandId, username: 'manager' }, expected = actor) {
  vi.stubEnv('ACCOUNTS_APP_ORIGIN', 'https://test.invalid');
  return new Request('https://test.invalid/internal/acquisition', { method: 'POST',
    headers: { origin: 'https://test.invalid', 'content-type': 'application/json', 'x-expected-account-id': expected }, body: JSON.stringify(body) });
}
afterEach(() => vi.unstubAllEnvs());

describe('internal acquisition account composition', () => {
  it('binds the verified actor and delivers only an acknowledged durable-demand DTO', async () => {
    const s = setup();
    const response = await accountAcquisitionResponse(request(), 'admit', s.dependencies);
    expect(response.status).toBe(200);
    expect(s.dependencies.service).toHaveBeenCalledExactlyOnceWith(principal);
    expect(s.service.forActor).toHaveBeenCalledExactlyOnceWith(actor);
    expect(s.port.admit).toHaveBeenCalledExactlyOnceWith({ kind: 'identify', commandId, username: 'manager' });
    expect(await response.json()).toEqual({ lookupRequestId: demandId, status: 'pending', account: null, evidenceRef: null, reason: 'queued' });
    expect(response.headers.get('cache-control')).toContain('private, no-store');
  });
  it('does not admit a command for a stale account or absent session', async () => {
    const stale = setup();
    expect((await accountAcquisitionResponse(request(undefined, demandId), 'admit', stale.dependencies)).status).toBe(409);
    expect(stale.port.admit).not.toHaveBeenCalled();
    const absent = setup(); absent.dependencies.principal.mockResolvedValue(null);
    expect((await accountAcquisitionResponse(request(), 'admit', absent.dependencies)).status).toBe(401);
    expect(absent.dependencies.service).not.toHaveBeenCalled();
  });
  it.each([
    { kind: 'identify', commandId, username: 'manager', actorUserId: actor },
    { kind: 'identify', commandId, username: '../other' },
    { kind: 'identify', commandId, username: 'manager', associationId: actor },
    { kind: 'discover', commandId, associationId: actor, associationRevision: '1', season: 2026 },
    { kind: 'discover', commandId, associationId: actor, associationRevision: '0' },
    { kind: 'discover', commandId, associationId: actor, associationRevision: '9223372036854775808' },
    { kind: 'recover', commandId, associationId: actor, associationRevision: '1' },
  ])('rejects client-supplied authority, seasons, malformed identifiers and revisions: %j', async body => {
    const s = setup();
    expect((await accountAcquisitionResponse(request(body), 'admit', s.dependencies)).status).toBe(400);
    expect(s.dependencies.principal).not.toHaveBeenCalled();
    expect(s.port.admit).not.toHaveBeenCalled();
  });
  it('retains the client command key for idempotent retry without retrying uncertainty itself', async () => {
    const s = setup(); s.port.admit.mockRejectedValue(new Error('lost commit acknowledgement'));
    expect((await accountAcquisitionResponse(request(), 'admit', s.dependencies)).status).toBe(503);
    expect(s.port.admit).toHaveBeenCalledTimes(1);
  });
  it('returns an admission error without fabricating a lookup handle when no demand was accepted', async () => {
    const s = setup(); s.port.admit.mockResolvedValue({ result: { status: 'limited', reason: 'budget_exhausted' }, decisionTiming: null } as never);
    const response = await accountAcquisitionResponse(request(), 'admit', s.dependencies);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'acquisition_unavailable' });
    expect(s.port.admit).toHaveBeenCalledTimes(1);
  });
  it('withholds expired/unknown timing and aborted delivery', async () => {
    const s = setup(); s.port.admit.mockResolvedValue({ result: { status: 'pending', demandId, retryAfterSeconds: 2 },
      decisionTiming: { ...timing, remainingLifetimeMs: '0' } });
    expect((await accountAcquisitionResponse(request(), 'admit', s.dependencies)).status).toBe(503);
    const aborted = setup(), controller = new AbortController();
    aborted.port.admit.mockImplementation(async () => { controller.abort(); return { result: { status: 'pending', demandId, retryAfterSeconds: 2 }, decisionTiming: timing }; });
    expect((await accountAcquisitionResponse(new Request(request(), { signal: controller.signal }), 'admit', aborted.dependencies)).status).toBe(503);
  });
  it('requires same origin for mutation and rejects ambient cross-site status reads', async () => {
    const s = setup(), input = request(); input.headers.set('origin', 'https://other.invalid');
    expect((await accountAcquisitionResponse(input, 'admit', s.dependencies)).status).toBe(403);
    const status = new Request(`https://test.invalid/internal/acquisition?demandId=${demandId}`, {
      headers: { 'x-expected-account-id': actor, 'sec-fetch-site': 'cross-site' } });
    expect((await accountAcquisitionResponse(status, 'progress', s.dependencies)).status).toBe(403);
    expect(s.dependencies.principal).not.toHaveBeenCalled();
  });
  it('reauthorizes each progress read and strips envelope-only fields', async () => {
    const s = setup();
    s.port.read.mockResolvedValue({ result: { status: 'pending', demandId, retryAfterSeconds: 2, receipt: 'must-not-leak' } as never, decisionTiming: timing });
    const input = new Request(`https://test.invalid/internal/acquisition?demandId=${demandId}`, { headers: { 'x-expected-account-id': actor } });
    const response = await accountAcquisitionResponse(input, 'progress', s.dependencies);
    expect(response.status).toBe(200);
    expect(s.port.read).toHaveBeenCalledWith(demandId, expect.any(String));
    expect(await response.json()).toEqual({ status: 'pending', demandId, retryAfterSeconds: 2 });
  });
  it('passes only the lookup evidence and actor-revision CAS to activation', async () => {
    const s = setup(), input = { providerAccountId: actor, lookupCaptureId: demandId, expectedActorRevision: '2', commandId };
    expect((await accountAcquisitionResponse(request(input), 'activate', s.dependencies)).status).toBe(200);
    expect(s.port.activate).toHaveBeenCalledExactlyOnceWith(input);
  });
  it('uses the canonical private lookup handle and requires an identify demand on polling', async () => {
    const s = setup();
    const input = new Request(`https://test.invalid/internal/acquisition?demandId=${demandId}`, { headers: { 'x-expected-account-id': actor } });
    const response = await accountAcquisitionResponse(input, 'identify-result', s.dependencies);
    expect(s.port.read).toHaveBeenCalledExactlyOnceWith(demandId, expect.any(String), 'identify');
    expect(await response.json()).toEqual({ lookupRequestId: demandId, status: 'pending', account: null, evidenceRef: null, reason: 'queued' });
  });
  it('never accepts a caller-selected discovery season', () => {
    expect(acquisitionCommand({ kind: 'discover', commandId, associationId: actor, associationRevision: '1' }))
      .toEqual({ kind: 'discover', commandId, associationId: actor, associationRevision: '1' });
  });
  it('composes retained candidates into the existing consumer shape without claiming complete current teams', async () => {
    const s = setup();
    const input = new Request(`https://test.invalid/internal/acquisition?demandId=${demandId}`, { headers: { 'x-expected-account-id': actor } });
    const response = await accountAcquisitionResponse(input, 'stored-discovery', s.dependencies);
    expect(response.status).toBe(200);
    const dto = await response.json();
    expect(dto).toMatchObject({ accountId: actor, season: '2026', status: 'partial',
      profiles: [{ sourceManagerAccountId: actor, displayName: 'Manager', status: 'complete' }],
      leagues: [{ id: '987', name: 'A candidate', season: '2026', url: 'https://sleeper.com/leagues/987', sourceManagerAccountIds: [actor] }] });
    expect(dto).not.toHaveProperty('scanId');
    expect(dto).not.toHaveProperty('teams');
    expect(dto).not.toHaveProperty('decisionTiming');
    expect(s.port.readDiscovery).toHaveBeenCalledExactlyOnceWith(demandId, expect.any(String));
    expect(s.port.admit).not.toHaveBeenCalled();
  });
  it('never turns exhaustive empty account lists into complete current-team evidence', () => {
    expect(storedSleeperDiscovery(actor, { ...retained, candidates: [] }).status).toBe('partial');
  });
  it('withholds revoked/foreign/unavailable retained results and unsupported candidate seasons', async () => {
    const s = setup(); s.port.readDiscovery.mockResolvedValue({ result: { status: 'denied', reason: 'unavailable' } as never, decisionTiming: timing });
    const input = new Request(`https://test.invalid/internal/acquisition?demandId=${demandId}`, { headers: { 'x-expected-account-id': actor } });
    expect((await accountAcquisitionResponse(input, 'stored-discovery', s.dependencies)).status).toBe(503);
    expect(() => storedSleeperDiscovery(actor, { ...retained, completedSeasons: [2025] })).toThrow();
    expect(() => storedSleeperDiscovery(actor, { ...retained, candidates: [{ ...retained.candidates[0], id: '../../other' }] })).toThrow();
  });
});
