import 'server-only';

/** TX01/BS-P01: these values belong only to the committing SQL transaction.
 * They must never be cached, logged or returned in a public response. */
export type DecisionTiming = {
  dbSampleAt: string;
  minimumAuthorityExpiresAt: string;
  remainingLifetimeMs: string;
};

type DecodedDecision<T> = { value: T; protected: boolean };
type DeliveryOptions<T> = {
  /** A closed, operation-specific DTO decoder; must reject unknown fields. */
  decodeResult: (value: unknown) => DecodedDecision<T>;
  monotonicNow?: () => number;
};
const SAFE_RESULT = '{"status":"indeterminate","reason":"authority_unavailable"}';
const RESPONSE_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' };

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid decision');
  return value as Record<string, unknown>;
}

function instant(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new Error('Invalid timing');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error('Invalid timing');
  return parsed;
}

function lifetime(value: unknown): bigint {
  const timing = record(value, ['dbSampleAt', 'minimumAuthorityExpiresAt', 'remainingLifetimeMs']);
  const sample = instant(timing.dbSampleAt);
  const expiry = instant(timing.minimumAuthorityExpiresAt);
  if (expiry <= sample || typeof timing.remainingLifetimeMs !== 'string'
    || !/^[1-9]\d{0,18}$/.test(timing.remainingLifetimeMs)) throw new Error('Invalid timing');
  const remaining = BigInt(timing.remainingLifetimeMs);
  // SQL floors its full-precision difference. Display instants are truncated,
  // so their difference is at most one millisecond larger. Never derive the
  // authorized lifetime by subtracting these display strings or local time.
  const displayedDifference = BigInt(expiry - sample);
  if (remaining > 9_223_372_036_854_775_807n || remaining > displayedDifference
    || displayedDifference - remaining > 1n) throw new Error('Invalid timing');
  return remaining;
}

/** Start at request entry, then call beginFinalSql immediately before dispatch.
 * Each delivery is single-use. Failed/unknown commit never releases a result;
 * it says nothing about whether a mutation committed on the server. */
export function createDecisionDelivery<T>({ decodeResult, monotonicNow = () => performance.now() }: DeliveryOptions<T>) {
  const requestStart = monotonicNow();
  let lastSample = requestStart;
  let begun = false;
  const sample = () => {
    const now = monotonicNow();
    if (!Number.isFinite(now) || now < 0 || !Number.isFinite(lastSample) || lastSample < 0 || now < lastSample) throw new Error('Invalid clock');
    lastSample = now;
    if (Math.ceil(now - requestStart) >= 12_000) throw new Error('Expired request');
    return now;
  };
  return {
    beginFinalSql() {
      if (begun) throw new Error('Final decision already started');
      begun = true;
      const sqlStart = sample();
      let delivered = false;
      return {
        deliver(envelope: unknown, commit: 'confirmed' | 'unknown'): Response {
          const safe = () => new Response(SAFE_RESULT, { status: 503, headers: RESPONSE_HEADERS });
          if (delivered) return safe();
          delivered = true;
          if (commit !== 'confirmed') return safe();
          try {
            const object = record(envelope, ['result', 'decisionTiming']);
            const decoded = decodeResult(object.result);
            const remaining = decoded.protected ? lifetime(object.decisionTiming) : null;
            if (!decoded.protected && object.decisionTiming !== null) return safe();
            // Serialize privately first; custom decoding/serialization can cost
            // time. The final clock check includes that time and commit latency.
            const body = JSON.stringify(decoded.value);
            if (typeof body !== 'string') return safe();
            const now = sample();
            if (remaining !== null && remaining - BigInt(Math.ceil(now - sqlStart)) <= 0n) return safe();
            // No await or callback between the last check and body handoff.
            return new Response(body, { status: 200, headers: RESPONSE_HEADERS });
          } catch { return safe(); }
        },
      };
    },
  };
}
