import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createDecisionDelivery } from './decision-timing';

const timing = { dbSampleAt: '2026-10-06T12:00:00.000Z', minimumAuthorityExpiresAt: '2026-10-06T12:00:01.000Z', remainingLifetimeMs: '1000' };
const envelope = { result: { status: 'available', roster: 'private' }, decisionTiming: timing };
function setup() {
  let now = 0;
  const decoder = vi.fn((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const input = value as Record<string, unknown>;
    if (input.status === 'available' && Object.keys(input).sort().join() === 'roster,status' && typeof input.roster === 'string') {
      return { value: input, protected: true };
    }
    if (input.status === 'denied' && input.reason === 'membership_expired' && Object.keys(input).sort().join() === 'reason,status') {
      return { value: input, protected: false };
    }
    throw new Error();
  });
  const request = createDecisionDelivery({ decodeResult: decoder, monotonicNow: () => now });
  return { request, decoder, set: (value: number) => { now = value; } };
}
async function expectSafe(response: Response) {
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: 'indeterminate', reason: 'authority_unavailable' });
}
describe('post-commit private decision delivery', () => {
  it('strips timing, hands off only the validated DTO and prevents caching', async () => {
    const { request, set } = setup();
    const decision = request.beginFinalSql(); set(998.1);
    const response = decision.deliver(envelope, 'confirmed');
    expect(await response.json()).toEqual(envelope.result);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it.each([999.01, 1000, 1001, NaN, Infinity, -1])('suppresses elapsed/invalid clock %s', async elapsed => {
    const { request, set } = setup(); const decision = request.beginFinalSql(); set(elapsed);
    await expectSafe(decision.deliver(envelope, 'confirmed'));
  });
  it('does not release a result after uncertain commit or decode it', async () => {
    const { request, decoder } = setup();
    await expectSafe(request.beginFinalSql().deliver(envelope, 'unknown'));
    expect(decoder).not.toHaveBeenCalled();
  });
  it('rejects replay of a decision receipt and another final decision in the request', async () => {
    const { request } = setup(); const decision = request.beginFinalSql();
    expect(decision.deliver(envelope, 'confirmed').status).toBe(200);
    await expectSafe(decision.deliver(envelope, 'confirmed'));
    expect(() => request.beginFinalSql()).toThrow();
  });
  it('includes earlier request work in the twelve-second budget', async () => {
    const { request, set } = setup(); set(11_500); const decision = request.beginFinalSql(); set(12_000);
    await expectSafe(decision.deliver(envelope, 'confirmed'));
  });
  it('rejects backward movement between request entry and final SQL', () => {
    const { request, set } = setup(); set(-1); expect(() => request.beginFinalSql()).toThrow();
  });
  it('refuses an invalid initial clock even if the later clock is valid', () => {
    let now = -1;
    const request = createDecisionDelivery({ decodeResult: value => ({ value, protected: true }), monotonicNow: () => now });
    now = 0;
    expect(() => request.beginFinalSql()).toThrow();
  });
  it.each([
    null, { ...timing, extra: true }, { ...timing, remainingLifetimeMs: '0' },
    { ...timing, remainingLifetimeMs: '1000.1' }, { ...timing, remainingLifetimeMs: 1000 },
    { ...timing, remainingLifetimeMs: '1001' }, { ...timing, remainingLifetimeMs: '998' },
    { ...timing, remainingLifetimeMs: '9223372036854775808' },
    { ...timing, dbSampleAt: '2026-10-06T12:00:00Z' },
    { ...timing, dbSampleAt: '2026-02-30T12:00:00.000Z' },
    { ...timing, minimumAuthorityExpiresAt: timing.dbSampleAt },
  ])('rejects malformed or inconsistent lifetime %#', async invalid => {
    const { request } = setup();
    await expectSafe(request.beginFinalSql().deliver({ ...envelope, decisionTiming: invalid }, 'confirmed'));
  });
  it('accepts a one-millisecond display truncation discrepancy using SQL lifetime', async () => {
    const { request, set } = setup(); const decision = request.beginFinalSql(); set(998);
    expect(decision.deliver({ ...envelope, decisionTiming: { ...timing, remainingLifetimeMs: '999' } }, 'confirmed').status).toBe(200);
  });
  it('delivers exact denial only with null timing', async () => {
    const denied = { status: 'denied', reason: 'membership_expired' };
    expect(await setup().request.beginFinalSql().deliver({ result: denied, decisionTiming: null }, 'confirmed').json()).toEqual(denied);
    await expectSafe(setup().request.beginFinalSql().deliver({ result: denied, decisionTiming: timing }, 'confirmed'));
  });
  it('rejects extra envelope/result fields instead of serializing them', async () => {
    await expectSafe(setup().request.beginFinalSql().deliver({ ...envelope, session: 'secret' }, 'confirmed'));
    await expectSafe(setup().request.beginFinalSql().deliver({ ...envelope, result: { ...envelope.result, token: 'secret' } }, 'confirmed'));
  });
  it('counts synchronous DTO validation and serialization before handoff', async () => {
    let now = 0;
    const request = createDecisionDelivery({ monotonicNow: () => now, decodeResult: () => {
      now = 1000; return { value: envelope.result, protected: true };
    } });
    await expectSafe(request.beginFinalSql().deliver(envelope, 'confirmed'));
  });
});
