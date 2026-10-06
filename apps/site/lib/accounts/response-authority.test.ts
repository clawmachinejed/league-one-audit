import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createAccountResponseDelivery } from './response-authority';

const timing = { dbSampleAt: '2026-10-06T00:00:00.000Z', minimumAuthorityExpiresAt: '2026-10-06T00:00:01.000Z', remainingLifetimeMs: '1000' };
afterEach(() => vi.restoreAllMocks());
it('includes final SQL latency and serialization time before a private body can leave', () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const delivery = createAccountResponseDelivery();
  const final = delivery.beginFinalSql();
  const dto = { toJSON() { now = 1000; return { privateValue: 'never delivered' }; } };
  expect(() => final.deliver(dto, timing)).toThrow('unavailable');
});
it('expires the request budget before another final transaction can dispatch', () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const delivery = createAccountResponseDelivery();
  now = 12_000;
  expect(() => delivery.beginFinalSql()).toThrow('Expired request');
});
it('honors caller cancellation before dispatch and before delivery without assuming SQL rollback', () => {
  const controller = new AbortController();
  const delivery = createAccountResponseDelivery(controller.signal);
  const final = delivery.beginFinalSql();
  controller.abort();
  expect(() => final.deliver({ ok: true }, timing)).toThrow();
  expect(() => createAccountResponseDelivery(controller.signal).beginFinalSql()).toThrow();
});
it('strips timing and allows only one body handoff for a confirmed final transaction', async () => {
  const final = createAccountResponseDelivery().beginFinalSql();
  const response = final.deliver({ ok: true }, timing);
  expect(await response.json()).toEqual({ ok: true });
  expect(response.headers.get('Vary')).toBe('Cookie');
  expect(() => final.deliver({ ok: true }, timing)).toThrow('unavailable');
});
