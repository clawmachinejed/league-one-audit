const transportCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN'] as const;
const postgresCodes = ['08000', '08001', '08003', '08004', '08006', '08007', '08P01', '53300', '53400', '57P01', '57P02', '57P03', '57P04', '57P05'] as const;
const stages = ['preflight', 'provision', 'tests', 'child-shutdown', 'schema-cleanup', 'credential-revocation', 'connection-close', 'branch-deletion', 'complete', 'failed'] as const;
export type IntegrationOwnerLossEvent = 'pool-error' | 'client-error' | 'client-end';
export type IntegrationOwnerLossDiagnostic = Readonly<{
  kind: 'integration-owner-loss-v1'; event: IntegrationOwnerLossEvent;
  category: 'transport' | 'postgresql' | 'unexpected-termination' | 'connection-termination' | 'connection-timeout' | 'query-read-timeout' | 'unknown';
  code: typeof transportCodes[number] | typeof postgresCodes[number] | 'unknown';
  stage: typeof stages[number] | 'unknown'; elapsedMs: number | null;
  lastSuccessfulQueryElapsedMs: number | null; lastSuccessfulQueryAgeMs: number | null;
}>;

function ownString(input: unknown, key: string): string | undefined {
  try {
    if (!input || typeof input !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor && typeof descriptor.value === 'string' ? descriptor.value : undefined;
  } catch { return undefined; } // Hostile getters/proxies must not affect cancellation.
}
function classify(error: unknown): Pick<IntegrationOwnerLossDiagnostic, 'category' | 'code'> {
  const code = ownString(error, 'code');
  if (transportCodes.some(value => value === code)) return { category: 'transport', code: code as typeof transportCodes[number] };
  if (postgresCodes.some(value => value === code)) return { category: 'postgresql', code: code as typeof postgresCodes[number] };
  // Exact literals in the installed Neon 1.1.0 driver; retain only these labels.
  switch (ownString(error, 'message')) {
    case 'Connection terminated unexpectedly': return { category: 'unexpected-termination', code: 'unknown' };
    case 'Connection terminated': return { category: 'connection-termination', code: 'unknown' };
    case 'Connection terminated due to connection timeout': return { category: 'connection-timeout', code: 'unknown' };
    case 'Query read timeout': return { category: 'query-read-timeout', code: 'unknown' };
    default: return { category: 'unknown', code: 'unknown' };
  }
}

/** Observation only. No connection, query, timer, log or recovery action is owned here. */
export function createIntegrationOwnerLossDiagnostics(elapsed: () => number, stage: () => unknown) {
  let first: IntegrationOwnerLossDiagnostic | undefined;
  let lastSuccessfulQueryElapsedMs: number | null = null;
  const now = () => {
    try {
      const value = elapsed();
      return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? Math.floor(value) : null;
    } catch { return null; }
  };
  return {
    queryCompleted(): void {
      const value = now();
      if (value !== null && (lastSuccessfulQueryElapsedMs === null || value >= lastSuccessfulQueryElapsedMs)) lastSuccessfulQueryElapsedMs = value;
    },
    capture(event: IntegrationOwnerLossEvent, error?: unknown): IntegrationOwnerLossDiagnostic {
      if (first) return first;
      const elapsedMs = now();
      let phase: IntegrationOwnerLossDiagnostic['stage'] = 'unknown';
      try { const value = stage(); if (stages.some(candidate => candidate === value)) phase = value as typeof stages[number]; } catch { /* Closed unknown. */ }
      first = Object.freeze({ kind: 'integration-owner-loss-v1', event, ...classify(error), stage: phase, elapsedMs,
        lastSuccessfulQueryElapsedMs, lastSuccessfulQueryAgeMs: elapsedMs !== null && lastSuccessfulQueryElapsedMs !== null
          && elapsedMs >= lastSuccessfulQueryElapsedMs ? elapsedMs - lastSuccessfulQueryElapsedMs : null });
      return first;
    },
  };
}
