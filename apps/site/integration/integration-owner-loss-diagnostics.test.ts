import { describe, expect, it, vi } from 'vitest';
import { createIntegrationOwnerLossDiagnostics } from './integration-owner-loss-diagnostics';

describe('bounded owner-loss diagnostics without transport IO', () => {
  it.each([
    ['ECONNRESET', 'transport'], ['ETIMEDOUT', 'transport'], ['EPIPE', 'transport'],
    ['08006', 'postgresql'], ['57P01', 'postgresql'], ['57P05', 'postgresql'],
  ] as const)('retains the allowlisted code %s without error text', (code, category) => {
    const diagnostic = createIntegrationOwnerLossDiagnostics(() => 125.9, () => 'tests');
    const result = diagnostic.capture('client-error', Object.assign(new Error('private password and URL'), { code, detail: 'private detail' }));
    expect(result).toEqual({ kind: 'integration-owner-loss-v1', event: 'client-error', category, code,
      stage: 'tests', elapsedMs: 125, lastSuccessfulQueryElapsedMs: null, lastSuccessfulQueryAgeMs: null });
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it.each([
    ['Connection terminated unexpectedly', 'unexpected-termination'], ['Connection terminated', 'connection-termination'],
    ['Connection terminated due to connection timeout', 'connection-timeout'], ['Query read timeout', 'query-read-timeout'],
  ] as const)('classifies only the exact installed-driver literal %s', (message, category) => {
    const result = createIntegrationOwnerLossDiagnostics(() => 1, () => 'provision').capture('client-error', new Error(message));
    expect(result).toMatchObject({ category, code: 'unknown' });
    expect(JSON.stringify(result)).not.toContain(message);
    expect(createIntegrationOwnerLossDiagnostics(() => 1, () => 'provision').capture('client-error', new Error(message + ' private')))
      .toMatchObject({ category: 'unknown', code: 'unknown' });
  });
  it('preserves the first error and query timing through a later end and query completion', () => {
    let elapsed = 100.8, stage = 'provision';
    const diagnostic = createIntegrationOwnerLossDiagnostics(() => elapsed, () => stage);
    diagnostic.queryCompleted(); elapsed = 150.1; diagnostic.queryCompleted(); elapsed = 499.9; stage = 'tests';
    const first = diagnostic.capture('pool-error', { code: 'ECONNRESET' });
    elapsed = 800; stage = 'connection-close'; diagnostic.queryCompleted();
    expect(diagnostic.capture('client-end')).toBe(first);
    expect(first).toMatchObject({ event: 'pool-error', stage: 'tests', elapsedMs: 499,
      lastSuccessfulQueryElapsedMs: 150, lastSuccessfulQueryAgeMs: 349 });
    expect(Object.isFrozen(first)).toBe(true);
  });
  it('never invokes accessors or serializes hostile codes, causes, messages or stage strings', () => {
    const getter = vi.fn(() => { throw new Error('private getter'); });
    const inputs = [undefined, null, 'private-token', { code: 'postgresql://private:password@host/test' },
      { code: 'PRIVATE_TOKEN' }, { code: 57_001 }, Object.create({ code: 'ECONNRESET' }),
      Object.defineProperties({}, { code: { get: getter }, message: { get: getter } }),
      new Proxy({}, { getOwnPropertyDescriptor: getter }),
      { cause: { code: 'ECONNRESET' }, stack: 'private stack', message: 'private message' }];
    for (const input of inputs) {
      const result = createIntegrationOwnerLossDiagnostics(() => 0, () => 'private-stage').capture('client-error', input);
      expect(result).toMatchObject({ category: 'unknown', code: 'unknown', stage: 'unknown' });
      expect(JSON.stringify(result)).not.toMatch(/private|password|postgresql:\/\//u);
    }
    // Only proxy descriptor traps are touched; property accessors are never invoked.
    expect(getter).toHaveBeenCalledTimes(2);
  });
  it.each([NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1])('fails closed to unknown timing for %s', value => {
    const diagnostic = createIntegrationOwnerLossDiagnostics(() => value, () => 'tests');
    expect(() => diagnostic.queryCompleted()).not.toThrow();
    expect(diagnostic.capture('client-end')).toMatchObject({ elapsedMs: null,
      lastSuccessfulQueryElapsedMs: null, lastSuccessfulQueryAgeMs: null });
  });
  it('survives broken clock and stage callbacks without delaying the caller', () => {
    const diagnostic = createIntegrationOwnerLossDiagnostics(() => { throw new Error('private clock'); }, () => { throw new Error('private stage'); });
    expect(() => diagnostic.queryCompleted()).not.toThrow();
    expect(diagnostic.capture('client-end')).toMatchObject({ stage: 'unknown', elapsedMs: null, lastSuccessfulQueryAgeMs: null });
  });
  it('never moves the last completed query backwards or invents a negative query age', () => {
    let elapsed = 20;
    const diagnostic = createIntegrationOwnerLossDiagnostics(() => elapsed, () => 'tests');
    diagnostic.queryCompleted(); elapsed = 10; diagnostic.queryCompleted();
    expect(diagnostic.capture('client-end')).toMatchObject({ elapsedMs: 10,
      lastSuccessfulQueryElapsedMs: 20, lastSuccessfulQueryAgeMs: null });
  });
});
