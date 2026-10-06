import 'server-only';
import { neon } from '@neondatabase/serverless';
import { accountInfrastructureIdentity } from '../infrastructure-identity';
import { restrictedNeonUrl } from '../../restricted-neon-url';
import type { Database, DatabaseRow, DatabaseQueryOptions } from '../../database';

/** Reuses the restricted runtime credential and Neon transaction owner. This
 * narrow acquisition view refuses URL/manifest errors before creating a driver
 * and pins actual server identity plus genuine runtime LOGIN on every operation.
 * It does not alter legacy projection storage configuration or enable a job. */
export function createAcquisitionDatabase(environment: Readonly<Record<string, string | undefined>>): Database {
  if (environment.VERCEL_ENV === 'preview') return { enabled: false, reason: 'preview-persistence-disabled' };
  if (environment.ACCOUNTS_ENABLED !== 'true' || !environment.DATABASE_URL) return { enabled: false, reason: 'missing-database-url' };
  const url = restrictedNeonUrl(environment.DATABASE_URL, 'league_one_runtime');
  if (!url) return { enabled: false, reason: 'invalid-database-url' };
  let identity: ReturnType<typeof accountInfrastructureIdentity>;
  try {
    identity = accountInfrastructureIdentity(environment);
    if (decodeURIComponent(new URL(url).pathname.slice(1)) !== identity.databaseName) throw new Error('Database mismatch');
  } catch { return { enabled: false, reason: 'invalid-database-url' }; }
  const sql = neon(url);
  return { enabled: true,
    async query<Row extends DatabaseRow = DatabaseRow>(statement: string, parameters: readonly unknown[] = [], options: DatabaseQueryOptions = {}) {
      try {
        const results = await sql.transaction(transaction => [
          transaction.query("SELECT set_config('statement_timeout','8000',true),set_config('lock_timeout','3000',true)", []),
          transaction.query('SELECT public.require_runtime_infrastructure_v1($1::jsonb)', [JSON.stringify(identity)]),
          transaction.query(statement, [...parameters]),
        ], { isolationLevel: 'ReadCommitted', fetchOptions: {
          signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
        } });
        if (results.length !== 3) throw new Error('Invalid acquisition result');
        return results[2] as readonly Row[];
      } catch { throw new Error('Acquisition storage unavailable.'); }
    },
  };
}
