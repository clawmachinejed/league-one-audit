import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { assertCapacityOwner, CAPACITY_RECEIPT_KIND, priorCapacityBackends, superviseCapacityChild,
  verifyCapacityBackends, type CapacityBackend, type CapacitySnapshot, type CapacityQuery } from './collection-capacity-supervision';

const target = { database: 'capacity_integration_test', branch: 'br-synthetic-test' };
const start = '2026-09-23T21:00:00.000Z';
const end = '2026-09-23T21:10:00.000Z';
const backend: CapacityBackend = { pid: 1234, role: 'league_one_runtime', state: 'idle',
  backendStart: '2026-09-23T21:01:00.000Z', transactionStart: null };
const snapshot = (backends: readonly CapacityBackend[] = []): CapacitySnapshot => ({
  ...target, relations: 0, otherSessions: backends.length, backends,
});
const receipt = () => ({ kind: CAPACITY_RECEIPT_KIND, ...target, childPid: 3456,
  startedAt: start, finishedAt: end, childClosed: true, cleanupVerified: true,
  before: snapshot(), after: snapshot([backend]) });

describe('capacity supervisor ownership and idle HTTP attribution', () => {
  it('allows only exact previously verified backend identities and matching target receipts', () => {
    const prior = priorCapacityBackends([receipt()], target);
    expect(() => verifyCapacityBackends(snapshot([backend]), target, prior)).not.toThrow();
    expect(() => verifyCapacityBackends(snapshot([{ ...backend, pid: 1235 }]), target, prior)).toThrow();
    expect(priorCapacityBackends([{ ...receipt(), branch: 'br-other-test' }], target).size).toBe(0);
  });
  it.each([
    { state: 'active' }, { transactionStart: start }, { role: 'neondb_owner' },
    { backendStart: '2026-09-23T20:59:59.000Z' }, { backendStart: 'bad-time' }, { pid: -1 },
  ])('rejects unsafe or unowned backend %j', change => {
    expect(() => verifyCapacityBackends(snapshot([{ ...backend, ...change }]), target, new Set(),
      [Date.parse(start), Date.parse(end)])).toThrow();
  });
  it('admits a new idle/no-transaction runtime backend only within the current child window', () => {
    expect(() => verifyCapacityBackends(snapshot([backend]), target, new Set(),
      [Date.parse(start), Date.parse(end)])).not.toThrow();
  });
  it('refuses a prior unresolved child, a dirty receipt and mismatched backend counts', () => {
    expect(() => priorCapacityBackends([{ ...receipt(), childClosed: false }], target)).toThrow();
    expect(() => priorCapacityBackends([{ ...receipt(), after: { ...snapshot([backend]), relations: 1 } }], target)).toThrow();
    expect(() => priorCapacityBackends([{ ...receipt(), before: snapshot([{ ...backend, state: 'active' }]) }], target)).toThrow();
    expect(() => verifyCapacityBackends({ ...snapshot([backend]), otherSessions: 0 }, target, new Set())).toThrow();
  });
  it('requires the exact live mutex owner session before a reset is authorized', async () => {
    const proof = JSON.stringify({ ...target, pid: 99, backendStart: start,
      applicationName: 'capacity-owner-12345678-1234-1234-1234-123456789abc' });
    const query = vi.fn<CapacityQuery>(async () => [{ owned: true }]);
    await expect(assertCapacityOwner(query, target, undefined)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    await expect(assertCapacityOwner(query, target, proof)).resolves.toBeUndefined();
    expect(query.mock.calls[0]?.[0]).toContain('lock.objsubid=1');
    await expect(assertCapacityOwner(async () => [{ owned: false }], target, proof)).rejects.toThrow();
  });
});

function fakeChild() {
  const events = new EventEmitter();
  const child = Object.assign(events, { pid: 12345, unref: vi.fn(), kill: vi.fn() });
  return { events, child: child as unknown as ChildProcess };
}

describe('capacity owned child closure', () => {
  it('confirms a natural close without any tree termination', async () => {
    const { events, child } = fakeChild(); const controller = new AbortController();
    const kill = vi.fn(async () => undefined);
    const supervised = superviseCapacityChild(child, controller.signal, kill);
    events.emit('close', 0);
    expect(await supervised.completion).toEqual({ closed: true, code: 0, childError: false });
    expect(kill).not.toHaveBeenCalled();
  });
  it('does not confuse a tree stop request with verified descendant closure', async () => {
    const { events, child } = fakeChild(); const controller = new AbortController();
    let finishTree!: () => void;
    const kill = vi.fn(() => new Promise<void>(resolve => { finishTree = resolve; }));
    const supervised = superviseCapacityChild(child, controller.signal, kill);
    let settled = false; void supervised.completion.then(() => { settled = true; });
    controller.abort(); await Promise.resolve(); events.emit('close', 1); await Promise.resolve();
    expect(settled).toBe(false); finishTree();
    expect((await supervised.completion).closed).toBe(true);
    expect(kill).toHaveBeenCalledWith(12345);
  });
  it('reports failed tree verification instead of claiming cleanup safety', async () => {
    const { events, child } = fakeChild(); const controller = new AbortController();
    const supervised = superviseCapacityChild(child, controller.signal, async () => { throw new Error('not closed'); });
    controller.abort(); await Promise.resolve(); await Promise.resolve(); events.emit('close', 1);
    expect((await supervised.completion).closed).toBe(false);
  });
});
