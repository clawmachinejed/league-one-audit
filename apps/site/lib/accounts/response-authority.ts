import 'server-only';
import { createDecisionDelivery } from './decision-timing';
import { AccountStoreUnavailableError } from './database';

/** Request-owned response guard. Only the handler's constructed public DTO is
 * accepted; SQL envelopes and receipts are never passed through to HTTP. */
export function createAccountResponseDelivery(signal?: AbortSignal) {
  let expected: unknown;
  const delivery = createDecisionDelivery({ decodeResult: value => {
    if (value !== expected) throw new AccountStoreUnavailableError();
    return { value, protected: true };
  } });
  return {
    beginFinalSql() {
      signal?.throwIfAborted();
      const decision = delivery.beginFinalSql();
      return {
        deliver(value: unknown, decisionTiming: unknown): Response {
          signal?.throwIfAborted();
          expected = value;
          const response = decision.deliver({ result: value, decisionTiming }, 'confirmed');
          // Preserve the established private route failure contract. A withheld
          // acknowledgement does not imply that a mutation was rolled back.
          if (response.status !== 200) throw new AccountStoreUnavailableError();
          response.headers.set('Cache-Control', 'private, no-store, max-age=0');
          response.headers.set('Vary', 'Cookie');
          response.headers.set('X-Content-Type-Options', 'nosniff');
          return response;
        },
      };
    },
  };
}
