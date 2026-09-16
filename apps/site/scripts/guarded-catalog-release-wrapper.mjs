import { createHash } from 'node:crypto';
import { sqlLiteral } from './league-administration-catalog.mjs';
const migrationChecksum = value => createHash('sha256').update(value.replace(/\r\n?/gu, '\n')).digest('hex');

/** Shared transaction, ownership barriers, history/collateral guards and commit sentinel. */
export function buildGuardedCatalogReleaseWrapper({ migrations, expectedDatabase, expectedOwner, runtimeRole, manifest,
  installedLedger, catalogSql, historyTables, release }) {
  if (![expectedDatabase, expectedOwner].every(value => typeof value === 'string' && /^[a-zA-Z0-9_-]+$/u.test(value))
    || runtimeRole !== 'league_one_runtime' || manifest.reviewed !== true || manifest.expectedOwner !== expectedOwner
    || manifest.postgresVersion !== 180006 || release.postgresVersion !== 180006
    || !/^[a-z][a-z0-9_]*$/u.test(release.key) || !/^league_one\.[a-z][a-z0-9_]*$/u.test(release.marker)
    || !historyTables.every(value => /^[a-z][a-z0-9_]*$/u.test(value))) throw new Error('Invalid guarded catalog release contract.');
  const ledger = [...installedLedger];
  const completedLedger = [...ledger, ...migrations.map(({ name, sql }) => [name, migrationChecksum(sql)])];
  const ledgerQuery = "SELECT jsonb_agg(jsonb_build_array(name,checksum) ORDER BY name) FROM public.app_schema_migrations";
  const affected = catalogSql({ runtimeRole });
  const unaffected = catalogSql({ affected: false, runtimeRole });
  const counts = historyTables.map((name) => `SELECT ${sqlLiteral(name)} AS name,count(*)::bigint AS rows FROM public.${name}`).join('\nUNION ALL\n');
  const migrationsSql = migrations.map(({ name, sql }) => `${sql.replace(/\r\n?/gu, '\n').trimEnd()}\nINSERT INTO public.app_schema_migrations(name,checksum) VALUES (${sqlLiteral(name)},${sqlLiteral(migrationChecksum(sql))});`).join('\n\n');
  const sentinel = release.sentinel;
  return `-- ${release.title}. Installed migrations ${release.installedLabel} remain untouched.
-- Rendered for ${expectedDatabase}/${expectedOwner}. Obtain release authority and revalidate service identities before execution.
-- Execute from an idle session, outside any existing transaction. The marker is
-- cleared before BEGIN and can survive COMMIT only after every postcondition passes.
SELECT set_config('${release.marker}','',false) AS ${release.key}_release_marker_reset;
-- End the reset's implicit transaction even when submitted as one simple-query
-- batch. Otherwise a later error could restore this session's prior success marker.
COMMIT;
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SET LOCAL search_path=pg_catalog,public;
SELECT pg_advisory_xact_lock(hashtext('league-one-schema-migrations'));
LOCK TABLE public.app_schema_migrations IN EXCLUSIVE MODE;
LOCK TABLE public.projection_jobs,public.league_week_lineup_watch_states,
  public.projection_period_refresh_states,public.league_week_materialization_states IN SHARE ROW EXCLUSIVE MODE;
DO $${release.key}_before$
DECLARE actual_catalog jsonb;
BEGIN
  IF current_database() IS DISTINCT FROM ${sqlLiteral(expectedDatabase)} OR current_user IS DISTINCT FROM ${sqlLiteral(expectedOwner)}
    THEN RAISE EXCEPTION '${release.key} release database or owner identity mismatch'; END IF;
  IF current_setting('server_version_num')::integer<>${release.postgresVersion}
    THEN RAISE EXCEPTION '${release.key} release requires reviewed PostgreSQL 180006 constraint catalog'; END IF;
  IF (${ledgerQuery}) IS DISTINCT FROM ${sqlLiteral(JSON.stringify(ledger))}::jsonb
    THEN RAISE EXCEPTION '${release.key} release expected exactly migrations ${release.installedLabel} and their accepted checksums'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${sqlLiteral(runtimeRole)} AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls)
    OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname<>${sqlLiteral(runtimeRole)} AND pg_has_role(${sqlLiteral(runtimeRole)},oid,'SET'))
    THEN RAISE EXCEPTION '${release.key} runtime role is privileged or can assume another role'; END IF;
  IF EXISTS(SELECT 1 FROM public.projection_jobs WHERE state='running' AND lease_until>clock_timestamp())
    OR EXISTS(SELECT 1 FROM public.league_week_lineup_watch_states WHERE active_attempt_id IS NOT NULL AND lease_expires_at>clock_timestamp())
    OR EXISTS(SELECT 1 FROM public.projection_period_refresh_states WHERE active_attempt_id IS NOT NULL AND active_attempt_expires_at>clock_timestamp())
    OR EXISTS(SELECT 1 FROM public.league_week_materialization_states WHERE active_attempt_id IS NOT NULL AND active_attempt_expires_at>clock_timestamp())
    THEN RAISE EXCEPTION '${release.key} release found an active worker owner'; END IF;
${manifest.protectedTables ? `  IF (SELECT jsonb_agg(t.relname ORDER BY t.relname) FROM pg_class t WHERE t.relnamespace='public'::regnamespace AND t.relkind IN ('r','p') AND t.relname<>'app_schema_migrations') IS DISTINCT FROM ${sqlLiteral(JSON.stringify([...manifest.protectedTables].sort()))}::jsonb
    THEN RAISE EXCEPTION 'release protected physical-table inventory mismatch'; END IF;
` : ''}  SELECT catalog INTO actual_catalog FROM (${affected}) captured;
  IF actual_catalog IS DISTINCT FROM ${sqlLiteral(JSON.stringify(manifest.before))}::jsonb
    THEN RAISE EXCEPTION '${release.key} installed ${release.catalogLabel} catalog, ownership, or grants mismatch'; END IF;
END; $${release.key}_before$;
CREATE TEMP TABLE ${release.key}_release_unaffected_before ON COMMIT DROP AS ${unaffected};
CREATE TEMP TABLE ${release.key}_release_history_before ON COMMIT DROP AS ${counts};

${migrationsSql}

DO $${release.key}_after$
DECLARE actual_catalog jsonb; old_count record; new_count bigint;
BEGIN
  IF (${ledgerQuery}) IS DISTINCT FROM ${sqlLiteral(JSON.stringify(completedLedger))}::jsonb
    THEN RAISE EXCEPTION '${release.key} release final migration ledger mismatch'; END IF;
  SELECT catalog INTO actual_catalog FROM (${affected}) captured;
  IF actual_catalog IS DISTINCT FROM ${sqlLiteral(JSON.stringify(manifest.after))}::jsonb
    THEN RAISE EXCEPTION '${release.key} final catalog, NOT NULL constraints, ownership, or grants mismatch'; END IF;
  SELECT catalog INTO actual_catalog FROM (${unaffected}) captured;
${manifest.unaffectedConstraintTypes ? `  IF actual_catalog->'constraintTypes' IS DISTINCT FROM ${sqlLiteral(JSON.stringify(manifest.unaffectedConstraintTypes))}::jsonb
    THEN RAISE EXCEPTION 'release PostgreSQL 180006 constraint manifest mismatch'; END IF;
` : ''}  IF actual_catalog IS DISTINCT FROM (SELECT catalog FROM ${release.key}_release_unaffected_before)
    THEN RAISE EXCEPTION '${release.key} release changed unaffected functions, triggers, tables, policies, ACLs, roles, or defaults'; END IF;
  FOR old_count IN SELECT * FROM ${release.key}_release_history_before LOOP
    EXECUTE format('SELECT count(*)::bigint FROM public.%I',old_count.name) INTO new_count;
    IF new_count IS DISTINCT FROM old_count.rows THEN RAISE EXCEPTION '${release.key} release altered historical row counts for %',old_count.name; END IF;
  END LOOP;
  PERFORM set_config('${release.marker}',${sqlLiteral(sentinel)},false);
END; $${release.key}_after$;
COMMIT;
-- Even a SQL client configured to continue after errors cannot emit success
-- after an aborted invocation: its transactionally committed marker must match.
SELECT ${sqlLiteral(sentinel)} AS success_sentinel
WHERE current_setting('${release.marker}',true)=${sqlLiteral(sentinel)}
  AND current_database()=${sqlLiteral(expectedDatabase)} AND current_user=${sqlLiteral(expectedOwner)}
  AND current_setting('server_version_num')::integer=${release.postgresVersion}
  AND (${ledgerQuery})=${sqlLiteral(JSON.stringify(completedLedger))}::jsonb
  AND (SELECT catalog FROM (${affected}) committed)=${sqlLiteral(JSON.stringify(manifest.after))}::jsonb;
`;
}
