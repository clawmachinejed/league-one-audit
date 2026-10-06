import { readFile } from 'node:fs/promises';
import { Pool } from '@neondatabase/serverless';
import { migrationOwnerUrl } from './account-transition-preflight.mjs';

// No implicit activation, initialization, retry or credential lookup. The
// explicitly supplied non-secret operation file must be separately reviewed.
if (process.argv.length !== 4 || process.argv[2] !== '--activate-reviewed-epoch') {
  throw new Error('Explicit reviewed epoch activation and an operation file are required.');
}
const operation = JSON.parse(await readFile(process.argv[3], 'utf8'));
const keys = ['previousRevision','nextRevision','configHash','issuer','identity','requestId','releaseEvidenceHash'];
if (!operation || typeof operation !== 'object' || Object.keys(operation).length !== keys.length
  || keys.some(key => !Object.hasOwn(operation,key))
  || !/^(0|[1-9]\d{0,18})$/u.test(operation.previousRevision ?? '')
  || !/^[1-9]\d{0,18}$/u.test(operation.nextRevision ?? '')
  || BigInt(operation.nextRevision)>9223372036854775807n
  || BigInt(operation.nextRevision)<=BigInt(operation.previousRevision)
  || !/^[a-f0-9]{64}$/u.test(operation.configHash ?? '') || !/^[a-f0-9]{64}$/u.test(operation.releaseEvidenceHash ?? '')
  || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(operation.requestId ?? '') || typeof operation.issuer !== 'string'
  || operation.issuer.length>500 || !operation.issuer.startsWith('https://')
  || process.env.ACCOUNTS_PRIVATE_MAINTENANCE !== 'true') {
  throw new Error('Reviewed epoch operation or maintenance prerequisite is invalid.');
}
const url = migrationOwnerUrl(process.env.MIGRATION_DATABASE_URL);
const pool = new Pool({connectionString:url,max:1,connectionTimeoutMillis:5000,query_timeout:15000,statement_timeout:10000});
pool.on('error',()=>{});
try {
  const result = await pool.query(`SELECT website_auth.activate_admission_epoch_v1($1::bigint,$2::bigint,
    $3,$4,$5::jsonb,$6::uuid,$7)::text AS revision`, [operation.previousRevision,operation.nextRevision,
    operation.configHash,operation.issuer,JSON.stringify(operation.identity),operation.requestId,operation.releaseEvidenceHash]);
  if (result.rows[0]?.revision!==operation.nextRevision) throw new Error('Activation result unavailable.');
  process.stdout.write(JSON.stringify({status:'committed',requestId:operation.requestId,revision:result.rows[0].revision})+'\n');
} catch {
  // Driver errors may carry credentials. A lost acknowledgement is not rollback.
  process.stderr.write('Epoch activation was not acknowledged. Keep private maintenance enabled; reconcile the owner-only epoch and activation receipt by request ID before any further operation. No retry was performed.\n');
  process.exitCode=1;
} finally { try { await pool.end(); } catch { process.exitCode=1; } }
