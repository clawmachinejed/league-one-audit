/** PostgreSQL 18.6 catalogs, including type `n` NOT NULL constraints. */
export const ADMINISTRATION_POSTGRES_VERSION = 180006;
export const ADMINISTRATION_TABLES = Object.freeze([
  'league_administration_enrollments', 'league_administration_enrollment_seasons',
  'league_source_connection_history', 'league_configuration_versions', 'league_administration_contents',
  'league_administration_observations', 'league_administration_heads', 'league_configuration_activations',
  'league_configuration_heads', 'league_season_teams', 'league_source_manager_accounts',
  'league_administration_team_entries', 'league_administration_manager_entries',
  'league_administration_memberships', 'league_administration_transaction_entries',
]);
export const ADMINISTRATION_NEW_FUNCTIONS = Object.freeze([
  'prevent_league_administration_history_change()',
  'record_league_administration_observation(jsonb)',
  'guard_league_administration_entry()',
  'validate_official_administration_lineage()',
  'validate_published_administration_lineage()',
  'guard_league_source_connection_history()',
  'remap_league_source_connection(uuid,text,text,text,text)',
  'connect_league_administration_season(uuid,smallint,text,text,text,jsonb,text)',
  'activate_league_configuration_component(uuid,text,text,smallint,smallint,text,bigint)',
]);
export const ADMINISTRATION_REPLACED_FUNCTIONS = Object.freeze([
  'all_player_score_set_is_publication_ready(uuid,jsonb,uuid)',
  'advance_current_all_player_score_set(text,smallint,text,smallint,uuid,text,uuid,uuid,timestamp with time zone)',
]);
export const ADMINISTRATION_EXISTING_TABLE_TRIGGERS = Object.freeze([
  'league_week_observations.official_administration_lineage',
  'current_projection_snapshots.published_administration_lineage',
  'league_source_connections.guard_administration_connection',
  'league_source_connections.record_administration_connection',
]);

export function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
const sqlArray = (values) => `ARRAY[${values.map(sqlLiteral).join(',')}]::text[]`;
const signature = "p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')'";

/** Readable source definitions accompany the compact release fingerprints. */
export function leagueAdministrationDefinitionsSql(scope = {}) {
  const tables = sqlArray(scope.tables ?? ADMINISTRATION_TABLES);
  const functions = sqlArray(scope.functions ?? [...ADMINISTRATION_NEW_FUNCTIONS, ...ADMINISTRATION_REPLACED_FUNCTIONS]);
  const triggers = sqlArray(scope.triggers ?? ADMINISTRATION_EXISTING_TABLE_TRIGGERS);
  return `SELECT jsonb_build_object(
    'tables',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',t.relname,
      'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
        'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped),
      'constraints',(SELECT jsonb_agg(jsonb_build_object('name',c.conname,'type',c.contype,
        'validated',c.convalidated,'definition',pg_get_constraintdef(c.oid,true)) ORDER BY c.conname)
        FROM pg_constraint c WHERE c.conrelid=t.oid),
      'indexes',(SELECT jsonb_agg(jsonb_build_object('name',i.indexname,'definition',i.indexdef) ORDER BY i.indexname)
        FROM pg_indexes i WHERE i.schemaname='public' AND i.tablename=t.relname)) ORDER BY t.relname)
      FROM pg_class t WHERE t.relnamespace='public'::regnamespace AND t.relkind IN ('r','p')
        AND t.relname=ANY(${tables})),'[]'::jsonb),
    'functions',COALESCE((SELECT jsonb_agg(jsonb_build_object('signature',${signature},
      'definition',pg_get_functiondef(p.oid)) ORDER BY ${signature})
      FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'
        AND ${signature}=ANY(${functions})),'[]'::jsonb),
    'triggers',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',t.relname||'.'||tr.tgname,
      'definition',pg_get_triggerdef(tr.oid,true)) ORDER BY t.relname,tr.tgname)
      FROM pg_trigger tr JOIN pg_class t ON t.oid=tr.tgrelid
      WHERE t.relnamespace='public'::regnamespace AND NOT tr.tgisinternal
        AND (t.relname=ANY(${tables}) OR (t.relname||'.'||tr.tgname)=ANY(${triggers}))),'[]'::jsonb)
  ) AS definitions`;
}

/**
 * Affected capture is compared to independently reviewed before/after manifests.
 * Unaffected capture is compared within the release transaction, preserving all
 * remaining public catalog objects, ACLs, roles and schema/default privileges.
 */
export function leagueAdministrationCatalogSql({ affected = true, runtimeRole = 'league_one_runtime', scope = {} } = {}) {
  const tables = sqlArray(scope.tables ?? ADMINISTRATION_TABLES);
  const functions = sqlArray(scope.functions ?? [...ADMINISTRATION_NEW_FUNCTIONS, ...ADMINISTRATION_REPLACED_FUNCTIONS]);
  const triggers = sqlArray(scope.triggers ?? ADMINISTRATION_EXISTING_TABLE_TRIGGERS);
  const tableFilter = `t.relname ${affected ? '=ANY' : '<>ALL'}(${tables})`;
  const functionFilter = `${signature} ${affected ? '=ANY' : '<>ALL'}(${functions})`;
  const triggerFilter = affected
    ? `(t.relname=ANY(${tables}) OR (t.relname||'.'||tr.tgname)=ANY(${triggers}))`
    : `(t.relname<>ALL(${tables}) AND (t.relname||'.'||tr.tgname)<>ALL(${triggers}))`;
  return `SELECT jsonb_build_object(
    'tables', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name',t.relname,'kind',t.relkind,'owner',owner.rolname,'acl',COALESCE(t.relacl::text,''),
      'rls',t.relrowsecurity,'forceRls',t.relforcerowsecurity,
      'runtimePrivileges',(SELECT jsonb_agg(privilege ORDER BY privilege) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege
        WHERE has_table_privilege(${sqlLiteral(runtimeRole)},t.oid,privilege)),
      'publicPrivileges',COALESCE((SELECT jsonb_agg(acl.privilege_type ORDER BY acl.privilege_type)
        FROM aclexplode(COALESCE(t.relacl,acldefault('r',t.relowner))) acl WHERE acl.grantee=0),'[]'::jsonb),
      'columns',columns.n,'columnHash',columns.hash,
      'constraints',constraints.n,'notNullConstraints',constraints.nn,'constraintHash',constraints.hash,
      'indexes',indexes.n,'indexHash',indexes.hash,'policyHash',policies.hash
    ) ORDER BY t.relname) FROM pg_class t JOIN pg_namespace ns ON ns.oid=t.relnamespace
    JOIN pg_roles owner ON owner.oid=t.relowner
    CROSS JOIN LATERAL (SELECT count(*) AS n,md5(COALESCE(string_agg(
      a.attname||chr(31)||format_type(a.atttypid,a.atttypmod)||chr(31)||a.attnotnull::text
      ||chr(31)||COALESCE(a.attacl::text,'')||chr(31)||COALESCE(pg_get_expr(d.adbin,d.adrelid),''),chr(30) ORDER BY a.attnum),'')) AS hash
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped) columns
    CROSS JOIN LATERAL (SELECT count(*) AS n,count(*) FILTER(WHERE c.contype='n') AS nn,
      md5(COALESCE(string_agg(c.conname||chr(31)||c.contype::text||chr(31)||c.convalidated::text||chr(31)
      ||pg_get_constraintdef(c.oid,true),chr(30) ORDER BY c.conname),'')) AS hash
      FROM pg_constraint c WHERE c.conrelid=t.oid) constraints
    CROSS JOIN LATERAL (SELECT count(*) AS n,md5(COALESCE(string_agg(i.indexname||chr(31)||i.indexdef,
      chr(30) ORDER BY i.indexname),'')) AS hash FROM pg_indexes i WHERE i.schemaname='public' AND i.tablename=t.relname) indexes
    CROSS JOIN LATERAL (SELECT md5(COALESCE(string_agg(p.polname||chr(31)||p.polcmd::text||chr(31)||p.polpermissive::text
      ||chr(31)||p.polroles::text||chr(31)||COALESCE(pg_get_expr(p.polqual,p.polrelid),'')||chr(31)
      ||COALESCE(pg_get_expr(p.polwithcheck,p.polrelid),''),chr(30) ORDER BY p.polname),'')) AS hash
      FROM pg_policy p WHERE p.polrelid=t.oid) policies
    WHERE ns.nspname='public' AND t.relkind IN ('r','p','v','m','f') AND ${tableFilter}),'[]'::jsonb),
    'constraintTypes',COALESCE((SELECT jsonb_agg(jsonb_build_array(kind,n) ORDER BY kind) FROM (
      SELECT c.contype::text AS kind,count(*) AS n FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      WHERE t.relnamespace='public'::regnamespace AND ${tableFilter} GROUP BY c.contype) kinds),'[]'::jsonb),
    'functions',COALESCE((SELECT jsonb_agg(jsonb_build_object('signature',${signature},
      'definitionHash',md5(pg_get_functiondef(p.oid)),'owner',owner.rolname,'securityDefiner',p.prosecdef,
      'configuration',p.proconfig,'acl',COALESCE(p.proacl::text,''),
      'runtimeExecute',has_function_privilege(${sqlLiteral(runtimeRole)},p.oid,'EXECUTE'),
      'publicExecute',EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')) ORDER BY ${signature})
      FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner
      WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' AND ${functionFilter}),'[]'::jsonb),
    'triggers',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',t.relname||'.'||tr.tgname,
      'function',p.proname,'enabled',tr.tgenabled,'definitionHash',md5(pg_get_triggerdef(tr.oid,true))) ORDER BY t.relname,tr.tgname)
      FROM pg_trigger tr JOIN pg_class t ON t.oid=tr.tgrelid JOIN pg_proc p ON p.oid=tr.tgfoid
      WHERE t.relnamespace='public'::regnamespace AND NOT tr.tgisinternal AND ${triggerFilter}),'[]'::jsonb)
${affected ? '' : `    ,
    'schemas',(SELECT md5(COALESCE(string_agg(n.nspname||chr(31)||r.rolname||chr(31)||COALESCE(n.nspacl::text,''),chr(30) ORDER BY n.nspname),''))
      FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname !~ '^pg_(toast_)?temp_'),
    'sequences',(SELECT md5(COALESCE(string_agg(t.relname||chr(31)||r.rolname||chr(31)||COALESCE(t.relacl::text,''),chr(30) ORDER BY t.relname),''))
      FROM pg_class t JOIN pg_roles r ON r.oid=t.relowner WHERE t.relnamespace='public'::regnamespace AND t.relkind='S'),
    'roles',(SELECT md5(COALESCE(string_agg(r.rolname||chr(31)||r.rolsuper::text||chr(31)||r.rolinherit::text||chr(31)
      ||r.rolcreaterole::text||chr(31)||r.rolcreatedb::text||chr(31)||r.rolcanlogin::text||chr(31)||r.rolreplication::text
      ||chr(31)||r.rolbypassrls::text,chr(30) ORDER BY r.rolname),'')) FROM pg_roles r),
    'memberships',(SELECT md5(COALESCE(string_agg(m.rolname||chr(31)||r.rolname||chr(31)||a.admin_option::text
      ||chr(31)||a.inherit_option::text||chr(31)||a.set_option::text,chr(30) ORDER BY m.rolname,r.rolname),''))
      FROM pg_auth_members a JOIN pg_roles m ON m.oid=a.member JOIN pg_roles r ON r.oid=a.roleid),
    'defaultPrivileges',(SELECT md5(COALESCE(string_agg(r.rolname||chr(31)||COALESCE(n.nspname,'')||chr(31)||a.defaclobjtype::text
      ||chr(31)||a.defaclacl::text,chr(30) ORDER BY r.rolname,n.nspname,a.defaclobjtype),''))
      FROM pg_default_acl a JOIN pg_roles r ON r.oid=a.defaclrole LEFT JOIN pg_namespace n ON n.oid=a.defaclnamespace)`}
  ) AS catalog`;
}
