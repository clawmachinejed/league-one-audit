/** Same PostgreSQL 18 catalog representation consumed by the existing reviewed
 * release assertions. Capture only on the guarded isolated database. */
export const ALL_PLAYER_REPAIR_CATALOG_SQL = `
SELECT jsonb_build_object(
  'tables', (SELECT jsonb_agg(jsonb_build_array(t.relname,
    columns.n, columns.hash, constraints.n, constraints.nn, constraints.hash,
    indexes.n, indexes.hash, t.relname <> 'current_all_player_score_sets') ORDER BY t.relname)
    FROM pg_class t JOIN pg_namespace ns ON ns.oid=t.relnamespace
    CROSS JOIN LATERAL (SELECT count(*) AS n, md5(string_agg(
      a.attname || chr(31) || format_type(a.atttypid,a.atttypmod) || chr(31) || a.attnotnull::text
      || chr(31) || COALESCE(pg_get_expr(d.adbin,d.adrelid),''),chr(30) ORDER BY a.attnum)) AS hash
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped) columns
    CROSS JOIN LATERAL (SELECT count(*) AS n,count(*) FILTER(WHERE c.contype='n') AS nn,
      md5(string_agg(c.conname || chr(31) || c.contype::text || chr(31)
        || pg_get_constraintdef(c.oid,true),chr(30) ORDER BY c.conname)) AS hash
      FROM pg_constraint c WHERE c.conrelid=t.oid) constraints
    CROSS JOIN LATERAL (SELECT count(*) AS n,md5(string_agg(i.indexname || chr(31) || i.indexdef,
      chr(30) ORDER BY i.indexname)) AS hash FROM pg_indexes i
      WHERE i.schemaname='public' AND i.tablename=t.relname) indexes
    WHERE ns.nspname='public' AND t.relkind='r'
      AND (t.relname LIKE 'all_player_%' OR t.relname='current_all_player_score_sets')),
  'constraintTypes', (SELECT jsonb_agg(jsonb_build_array(kind,n) ORDER BY kind) FROM (
    SELECT c.contype::text AS kind,count(*) AS n FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    WHERE t.relnamespace='public'::regnamespace
      AND (t.relname LIKE 'all_player_%' OR t.relname='current_all_player_score_sets') GROUP BY c.contype) types),
  'triggers', (SELECT jsonb_agg(jsonb_build_array(tr.tgname,t.relname,p.proname,
    md5(pg_get_triggerdef(tr.oid,true))) ORDER BY tr.tgname)
    FROM pg_trigger tr JOIN pg_class t ON t.oid=tr.tgrelid JOIN pg_proc p ON p.oid=tr.tgfoid
    WHERE t.relnamespace='public'::regnamespace AND NOT tr.tgisinternal
      AND (tr.tgname LIKE '%all_player%' OR p.proname LIKE '%all_player%')),
  'functions', (SELECT jsonb_agg(jsonb_build_array(p.proname,
    pg_get_function_identity_arguments(p.oid),md5(pg_get_functiondef(p.oid)),
    has_function_privilege('league_one_runtime',p.oid,'EXECUTE'))
    ORDER BY p.proname,pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%all_player%')
) AS catalog`;
