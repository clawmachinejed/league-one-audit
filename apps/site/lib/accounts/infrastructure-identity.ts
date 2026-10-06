import 'server-only';

/** Approved, non-secret deployment manifest. Populate from independently
 * reviewed control-plane and SQL evidence, never from a request or a DB URL. */
export type AccountInfrastructureIdentity = Readonly<{
  projectId: string; branchId: string; tenantId: string; timelineId: string;
  databaseName: string; databaseOid: string; clockDomain: string;
}>;
const fields = ['projectId', 'branchId', 'tenantId', 'timelineId', 'databaseName', 'databaseOid', 'clockDomain'] as const;

export function readAccountInfrastructureIdentity(value: unknown): AccountInfrastructureIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Account infrastructure unavailable.');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some(key => typeof row[key] !== 'string' || !row[key])
    || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/u.test(String(row.projectId))
    || !/^br-[a-z0-9-]+$/u.test(String(row.branchId))
    || !/^[a-f0-9]{32}$/u.test(String(row.tenantId)) || !/^[a-f0-9]{32}$/u.test(String(row.timelineId))
    || !/^[1-9]\d{0,9}$/u.test(String(row.databaseOid)) || BigInt(String(row.databaseOid)) > 4294967295n
    || String(row.databaseName).length > 63 || /[\u0000-\u001f]/u.test(String(row.databaseName))
    || row.clockDomain !== `neon:${row.tenantId}:${row.timelineId}:${row.databaseOid}`) {
    throw new Error('Account infrastructure unavailable.');
  }
  return Object.freeze(Object.fromEntries(fields.map(key => [key, row[key]]))) as AccountInfrastructureIdentity;
}

export function accountInfrastructureIdentity(environment: Readonly<Record<string, string | undefined>> = process.env) {
  try { return readAccountInfrastructureIdentity(JSON.parse(environment.ACCOUNTS_DATABASE_IDENTITY ?? '')); }
  catch { throw new Error('Account infrastructure unavailable.'); }
}
