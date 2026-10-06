/** Pure validation only; an attestation is a release prerequisite, not proof of
 * a load balancer drain. Release evidence must independently verify that fact. */
export function accountTransitionApproval(value, checksums) {
  let input;
  try { input = JSON.parse(value ?? ''); } catch { throw new Error('Reviewed account transition approval is required.'); }
  const keys = ['reviewedSha', 'compatibleRecoverySha', 'maintenanceEvidenceHash', 'drainEvidenceHash', 'migrationChecksums', 'databaseIdentity'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== keys.length
    || keys.some(key => !Object.hasOwn(input, key))
    || !/^[a-f0-9]{40}$/u.test(input.reviewedSha ?? '') || !/^[a-f0-9]{40}$/u.test(input.compatibleRecoverySha ?? '')
    || !/^[a-f0-9]{64}$/u.test(input.maintenanceEvidenceHash ?? '') || !/^[a-f0-9]{64}$/u.test(input.drainEvidenceHash ?? '')
    || !input.migrationChecksums || Object.keys(input.migrationChecksums).length !== Object.keys(checksums).length
    || Object.entries(checksums).some(([name, hash]) => input.migrationChecksums[name] !== hash)) {
    throw new Error('Reviewed account transition approval is invalid.');
  }
  return { ...input, databaseIdentity: migrationDatabaseIdentity(input.databaseIdentity) };
}

/** Explicit non-secret identity from independently reviewed infrastructure
 * evidence. Never infer target authorization from the supplied credential. */
export function migrationDatabaseIdentity(input) {
  const fields=['projectId','branchId','tenantId','timelineId','databaseName','databaseOid','clockDomain'];
  if (!input || typeof input!=='object' || Array.isArray(input)
    || Object.keys(input).length!==fields.length || fields.some(key=>typeof input[key]!=='string' || !input[key])
    || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/u.test(input.projectId)
    || !/^br-[a-z0-9-]+$/u.test(input.branchId)
    || !/^[a-f0-9]{32}$/u.test(input.tenantId) || !/^[a-f0-9]{32}$/u.test(input.timelineId)
    || !/^[1-9]\d{0,9}$/u.test(input.databaseOid) || BigInt(input.databaseOid)>4294967295n
    || input.databaseName.length>63 || /[\u0000-\u001f]/u.test(input.databaseName)
    || input.clockDomain!==`neon:${input.tenantId}:${input.timelineId}:${input.databaseOid}`) {
    throw new Error('Approved migration database identity is required.');
  }
  return Object.freeze(Object.fromEntries(fields.map(key=>[key,input[key]])));
}

/** Raw built-in catalog proof works before 036 exists. No function from the
 * schema being installed participates in proving the destination. */
export async function verifyMigrationDatabaseIdentity(client, expected) {
  const approved=migrationDatabaseIdentity(expected);
  const result=await client.query(`SELECT current_database() AS "databaseName",
    (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()) AS "databaseOid",
    (SELECT jsonb_object_agg(name,jsonb_build_object('setting',setting,'context',context,'pendingRestart',pending_restart))
      FROM pg_catalog.pg_settings WHERE name IN
      ('neon.project_id','neon.branch_id','neon.tenant_id','neon.timeline_id')) AS settings`);
  if (result.rows.length!==1) throw new Error('Migration destination identity was not verified.');
  const row=result.rows[0];
  const names={projectId:'neon.project_id',branchId:'neon.branch_id',tenantId:'neon.tenant_id',timelineId:'neon.timeline_id'};
  if (row.databaseName!==approved.databaseName || row.databaseOid!==approved.databaseOid
    || Object.entries(names).some(([key,name])=>row.settings?.[name]?.setting!==approved[key]
      || row.settings[name].context!=='postmaster' || row.settings[name].pendingRestart!==false)) {
    throw new Error('Migration destination identity was not verified.');
  }
  return approved;
}

/** Parse before constructing a driver. Only explicit credentials are accepted;
 * no driver-specific query overrides, URL aliases, duplicates or TLS downgrades. */
export function migrationOwnerUrl(value, { allowLocal = false } = {}) {
  try {
    const url = new URL(value ?? '');
    const local = allowLocal && ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    const database = decodeURIComponent(url.pathname.slice(1));
    if (!['postgres:','postgresql:'].includes(url.protocol)
      || (!local && (!url.hostname.endsWith('.neon.tech') || !url.hostname.startsWith('ep-')))
      || !decodeURIComponent(url.username) || !url.password || !database || /[\/\\\u0000-\u001f]/u.test(database)
      || url.hash || (url.port && url.port !== '5432')
      || [...url.searchParams.keys()].some(key => !['sslmode','channel_binding'].includes(key))
      || url.searchParams.getAll('sslmode').length > 1
      || (!local && !['require','verify-ca','verify-full'].includes(url.searchParams.get('sslmode')))
      || (local && url.searchParams.has('sslmode') && !['require','verify-ca','verify-full'].includes(url.searchParams.get('sslmode')))
      || url.searchParams.getAll('channel_binding').length > 1
      || (url.searchParams.has('channel_binding') && url.searchParams.get('channel_binding') !== 'require')) throw new Error();
    return url.toString();
  } catch { throw new Error('Explicit owner database credential is invalid or unavailable.'); }
}

/** Ledger evidence only: even `applied` requires independent catalog/canary
 * qualification. Never fills gaps or retries a partially installed cutover. */
export function accountTransitionState(migrations, rows) {
  const expected = new Map(migrations.map(item => [item.name, item.checksum]));
  const relevant = rows.filter(row => expected.has(row.name));
  if (new Set(relevant.map(row => row.name)).size !== relevant.length
    || relevant.some(row => expected.get(row.name) !== row.checksum)) return 'drift';
  if (!relevant.length) return 'absent';
  return relevant.length === expected.size ? 'applied' : 'partial';
}

/** The caller has independently established maintenance, drain, source and
 * owner authority. One transaction commits all mandatory guard migrations and
 * their ledger entries. An acknowledgement loss is never reported as rollback. */
export async function installAccountTransition(client, migrations, expectedIdentity) {
  let committing = false;
  try {
    await client.query('BEGIN');
    await verifyMigrationDatabaseIdentity(client, expectedIdentity);
    await client.query('SELECT pg_advisory_xact_lock(19740517,1)');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('league-one-schema-migrations'))");
    await client.query(`DO $owner$ BEGIN
      IF current_user<>session_user OR NOT EXISTS(SELECT 1 FROM pg_namespace
        WHERE nspname='website_auth' AND nspowner=session_user::regrole) THEN
        RAISE EXCEPTION 'Actual account schema owner LOGIN is required';
      END IF;
    END $owner$;`);
    const ledger = await client.query('SELECT name, checksum FROM public.app_schema_migrations');
    const state = accountTransitionState(migrations, ledger.rows);
    if (state === 'partial' || state === 'drift') throw new Error('Transition requires independent catalog reconciliation.');
    if (state === 'absent') {
      for (const migration of migrations) {
        await client.query(migration.statement);
        await client.query('INSERT INTO public.app_schema_migrations (name, checksum) VALUES ($1, $2)',
          [migration.name, migration.checksum]);
      }
    }
    committing = true;
    await client.query('COMMIT');
    return state === 'applied' ? 'already-applied' : 'committed';
  } catch {
    let rolledBack = false;
    try { await client.query('ROLLBACK'); rolledBack = true; } catch { /* Do not replace or expose driver errors. */ }
    const outcome = committing || !rolledBack ? 'unknown' : 'rolled-back';
    throw Object.assign(new Error(`Account transition ${outcome}. Keep private maintenance enabled; independently reconcile exact ledger checksums and catalog before another operation. No retry was performed.`), { outcome });
  }
}
