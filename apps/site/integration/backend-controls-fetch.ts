import { neonConfig } from '@neondatabase/serverless';

/** Fixture transport matching only. The existing client still owns every query
 * and AbortSignal; the original fetch receives its input and init unchanged. */
export function createBackendControlsDatabaseFetchGuard(runtimeDatabaseUrl: string) {
  const runtime = new URL(runtimeDatabaseUrl);
  const endpoint = neonConfig.fetchEndpoint;
  if (neonConfig.fetchFunction !== undefined || endpoint !== neonConfig.defaults.fetchEndpoint) {
    throw new Error('Unsupported control database transport.');
  }
  const permitted = new URL(typeof endpoint === 'function'
    ? endpoint(runtime.hostname, runtime.port || 5432, { jwtAuth: false }) : endpoint);
  if (permitted.protocol !== 'https:' || permitted.username || permitted.password
    || permitted.pathname !== '/sql' || permitted.search || permitted.hash) {
    throw new Error('Invalid control database HTTP endpoint.');
  }
  return (input: Parameters<typeof fetch>[0], init?: RequestInit): boolean => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request ? request.url : String(input));
    const headers = new Headers(init?.headers ?? request?.headers);
    return neonConfig.fetchFunction === undefined && neonConfig.fetchEndpoint === endpoint
      && url.href === permitted.href && (init?.method ?? request?.method ?? 'GET') === 'POST'
      && headers.get('Neon-Connection-String') === runtimeDatabaseUrl;
  };
}
