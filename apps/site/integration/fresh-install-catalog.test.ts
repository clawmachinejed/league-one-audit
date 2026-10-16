import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { assertFreshInstallCatalog, assertFreshInstallPrivileges, assertFreshInstallInstalledCatalog, readFreshInstallSources,
  readFreshInstallCatalog, FRESH_INSTALL_MANIFEST_SHA256, FreshInstallCatalogMismatchError,
  FreshInstallDatabasePlatformError, assertFreshInstallDatabasePlatformBranch,
  FRESH_INSTALL_COMPARISON_MAX_BYTES, type FreshInstallCatalog } from './fresh-install-catalog';
import { createHash } from 'node:crypto';
import { types } from '@neondatabase/serverless';

type Row = Record<string, unknown>;
const text = readFileSync(new URL('./fresh-install-catalog.json', import.meta.url), 'utf8');
const frozen = JSON.parse(text) as { catalog: Record<string, Row[]>;
  migrations: { name: string; lfSha256: string }[]; provisioners: { name: string; lfSha256: string }[] };
function baseline(nonsuper = false): FreshInstallCatalog {
  const sections = structuredClone(frozen.catalog);
  const installer = nonsuper ? 'test_installer' : 'postgres';
  if (nonsuper) {
    const names = new Set(sections.functions.filter((row) => row.extension === 'pgcrypto').map((row) => row.signature));
    for (const row of sections.functions) if (names.has(row.signature)) row.owner = '$BOOTSTRAP';
    for (const row of sections.functionAcl) if (names.has(row.signature)) {
      if (row.grantee === '$INSTALLER') row.grantee = '$BOOTSTRAP';
      if (row.grantor === '$INSTALLER') row.grantor = '$BOOTSTRAP';
    }
    sections.memberships.push(...['league_one_account', 'league_one_auth', 'league_one_runtime'].map((role) => ({
      role, member: '$INSTALLER', grantor: '$BOOTSTRAP', admin_option: true, inherit_option: false, set_option: false,
    })));
  }
  return { format: 'cp21-installed-catalog-v1', postgresVersion: '180003',
    installer: { name: installer, superuser: !nonsuper, inherit: true, createRole: true },
    bootstrap: { name: 'postgres', oid: 10, superuser: true }, databasePlatform: null, sections,
    membershipEvidence: sections.memberships.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
      [key, value === '$INSTALLER' ? installer : value === '$BOOTSTRAP' ? 'postgres' : value]))),
  };
}
function mutable(catalog: FreshInstallCatalog): Record<string, Row[]> { return catalog.sections as Record<string, Row[]>; }
function neonBaseline(): FreshInstallCatalog {
  const catalog = baseline(true);
  mutable(catalog).databaseAcl.push(...['CONNECT', 'CREATE', 'TEMPORARY'].map((privilege) => ({
    database: '$DATABASE', owner: '$INSTALLER', grantee: 'neon_superuser', grantor: '$INSTALLER', privilege, grantable: false,
  })));
  return { ...catalog, databasePlatform: { kind: 'neon', branchId: 'br-local-model', databaseOwner: catalog.installer.name,
    role: { name: 'neon_superuser', superuser: false, inherit: true, createDb: true, createRole: true,
      login: false, replication: true, bypassRls: true }, installer: { member: true, usage: true },
    applicationRoles: ['league_one_account', 'league_one_auth', 'league_one_runtime'].map((role) => ({ role, member: false, usage: false })),
  } };
}
function comparisonFailure(catalog: FreshInstallCatalog): FreshInstallCatalogMismatchError {
  try { assertFreshInstallInstalledCatalog(catalog); } catch (error) {
    expect(error).toBeInstanceOf(FreshInstallCatalogMismatchError);
    return error as FreshInstallCatalogMismatchError;
  }
  throw new Error('Expected a strict catalog mismatch.');
}

describe('frozen fresh-install catalog', () => {
  it('loads an unchanged Windows CRLF checkout while rejecting changed manifest bytes', async () => {
    vi.resetModules();
    vi.doMock('node:fs', () => ({ readFileSync: () => text.replace(/\r\n?/gu, '\n').replace(/\n/gu, '\r\n') }));
    try {
      const windowsCheckout = await import('./fresh-install-catalog');
      expect(() => windowsCheckout.assertFreshInstallCatalog(baseline())).not.toThrow();
    } finally { vi.doUnmock('node:fs'); vi.resetModules(); }
    vi.doMock('node:fs', () => ({ readFileSync: () => text.replace('cp21-installed-catalog-v1', 'cp21-installed-catalog-v2') }));
    try { await expect(import('./fresh-install-catalog')).rejects.toThrow('frozen manifest digest mismatch'); }
    finally { vi.doUnmock('node:fs'); vi.resetModules(); }
  });
  it('preserves historical CP21 bytes while rejecting the CP24 installation inventory', async () => {
    expect(createHash('sha256').update(text.replace(/\r\n?/gu, '\n')).digest('hex')).toBe(FRESH_INSTALL_MANIFEST_SHA256);
    expect(frozen.migrations).toHaveLength(56);
    expect(frozen.provisioners).toHaveLength(3);
    const digest = (source: string) => createHash('sha256').update(source.replace(/\r\n?/gu, '\n')).digest('hex');
    for (const entry of frozen.migrations) {
      expect(digest(readFileSync(new URL(`../migrations/${entry.name}`, import.meta.url), 'utf8')), entry.name).toBe(entry.lfSha256);
    }
    for (const entry of frozen.provisioners) {
      const actual = digest(readFileSync(new URL(`../scripts/${entry.name}`, import.meta.url), 'utf8'));
      if (entry.name === 'provision-runtime-role.sql') expect(actual, entry.name).not.toBe(entry.lfSha256);
      else expect(actual, entry.name).toBe(entry.lfSha256);
    }
    await expect(readFreshInstallSources()).rejects.toThrow('migration file inventory changed');
    expect(Buffer.byteLength(JSON.stringify(baseline()))).toBeLessThan(4 * 1024 * 1024);
  });
  it.each([false, true])('accepts only the preimplementation installer variant nonsuper=%s', (nonsuper) => {
    const catalog = baseline(nonsuper);
    expect(() => assertFreshInstallCatalog(catalog)).not.toThrow();
    expect(() => assertFreshInstallPrivileges(catalog)).not.toThrow();
    expect(() => assertFreshInstallInstalledCatalog(catalog)).not.toThrow();
  });
  it('collects policy roles as text arrays through the installed Neon decoder', async () => {
    const expected = baseline();
    const query = vi.fn(async (statement: string): Promise<readonly Row[]> => {
      if (statement.includes('AS installer_name')) return [{ current_user: 'postgres', session_user: 'postgres',
        version: '180003', installer_name: 'postgres', installer_superuser: true, installer_inherit: true,
        installer_create_role: true, bootstrap_name: 'postgres', bootstrap_oid: 10, bootstrap_superuser: true }];
      if (statement.includes("current_setting('neon.branch_id'")) return [{ branch_id: null,
        database_owner: 'postgres', platform_name: null }];
      if (statement.includes('FROM pg_policy p')) {
        // The real SQL/type/driver boundary is also checked in the isolated
        // PostgreSQL diagnostic. Retain its text[] transport contract here.
        expect(statement).toContain('ORDER BY 1)::text[] AS roles');
        return expected.sections.policies.map((row) => ({ ...row,
          roles: types.getTypeParser(1009, 'text')('{PUBLIC}') }));
      }
      return [];
    });
    const collected = await readFreshInstallCatalog(query, 'postgres');
    expect(collected.sections.policies).toEqual(expected.sections.policies);
    mutable(expected).policies = [...collected.sections.policies];
    expect(() => assertFreshInstallCatalog(expected)).not.toThrow();
    expect(() => assertFreshInstallPrivileges(expected)).not.toThrow();
  });
  it('rejects the name-array transport mismatch with typed digests and no raw values', () => {
    const catalog = baseline();
    for (const row of mutable(catalog).policies) row.roles = types.getTypeParser(1003, 'text')('{PUBLIC}');
    let error: unknown;
    try { assertFreshInstallCatalog(catalog); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(FreshInstallCatalogMismatchError);
    const mismatch = (error as FreshInstallCatalogMismatchError).mismatch;
    expect(mismatch).toMatchObject({ section: 'policies', expectedRows: 6, observedRows: 6, firstDifferingRow: 0,
      policyFields: [{ field: 'roles', expected: { type: 'array', length: 1 }, observed: { type: 'string', length: 8 } }] });
    expect(mismatch.expectedRowDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(mismatch.observedRowDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(mismatch.expectedRowDigest).not.toBe(mismatch.observedRowDigest);
    expect(JSON.stringify(mismatch)).not.toContain('PUBLIC');
    expect((error as Error).message).toBe('Fresh-install catalog: policies differs from frozen inventory; expected 6 rows, observed 6, first differing row 0.');
  });
  it.each([null, '{league_one_runtime}', '{PUBLIC,league_one_runtime}', '{league_one_runtime,PUBLIC}', '{}'])
  ('continues rejecting changed policy role membership after text-array decoding: %s', (wireValue) => {
    const catalog = baseline();
    mutable(catalog).policies[0].roles = wireValue === null ? null : types.getTypeParser(1009, 'text')(wireValue);
    expect(() => assertFreshInstallCatalog(catalog)).toThrow(FreshInstallCatalogMismatchError);
  });
  it('does not expose unexpected policy values or function source in mismatch diagnostics', () => {
    const policy = baseline();
    const sensitive = 'postgresql://private_user:private_password@example.invalid/database';
    mutable(policy).policies[0].roles = sensitive;
    mutable(policy).policies[0].using_expression = sensitive;
    let policyError: unknown;
    try { assertFreshInstallCatalog(policy); } catch (caught) { policyError = caught; }
    expect(policyError).toBeInstanceOf(FreshInstallCatalogMismatchError);
    expect(JSON.stringify((policyError as FreshInstallCatalogMismatchError).mismatch)).not.toContain(sensitive);
    const functionCatalog = baseline();
    mutable(functionCatalog).functions[0].bodyLfSha256 = sensitive;
    let functionError: unknown;
    try { assertFreshInstallCatalog(functionCatalog); } catch (caught) { functionError = caught; }
    expect(functionError).toBeInstanceOf(FreshInstallCatalogMismatchError);
    const mismatch = (functionError as FreshInstallCatalogMismatchError).mismatch;
    expect(mismatch.section).toBe('functions');
    expect(mismatch.policyFields).toBeUndefined();
    expect(JSON.stringify(mismatch)).not.toContain(sensitive);
  });
  it('describes missing and extra rows by counts and nullable digests', () => {
    for (const extra of [false, true]) {
      const catalog = baseline();
      if (extra) mutable(catalog).enums.push({ unreviewed: 'not retained in the diagnostic' });
      else mutable(catalog).enums = [];
      if (!extra) mutable(catalog).policies = [];
      let error: unknown;
      try { assertFreshInstallCatalog(catalog); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(FreshInstallCatalogMismatchError);
      const mismatch = (error as FreshInstallCatalogMismatchError).mismatch;
      expect(mismatch.firstDifferingRow).toBe(0);
      expect(extra ? mismatch.expectedRowDigest : mismatch.observedRowDigest).toBeNull();
      expect(extra ? mismatch.observedRowDigest : mismatch.expectedRowDigest).toMatch(/^[0-9a-f]{64}$/u);
    }
  });
  it('keeps raw membership-evidence drift a typed bounded mismatch', () => {
    let error: unknown;
    try { assertFreshInstallPrivileges({ ...baseline(), membershipEvidence: [] }); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(FreshInstallCatalogMismatchError);
    const mismatch = (error as FreshInstallCatalogMismatchError).mismatch;
    expect(mismatch).toMatchObject({ section: 'membershipEvidence', expectedRows: 3, observedRows: 0,
      firstDifferingRow: 0, observedRowDigest: null });
    expect(mismatch.expectedRowDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(mismatch.policyFields).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(mismatch))).toBeLessThan(512);
  });
  it.each([
    ['columns', 'not_null', false, (row: Row) => row.not_null === true],
    ['columns', 'default_expression', 'unexpected()', (row: Row) => row.default_expression !== null],
    ['constraints', 'definition', 'FOREIGN KEY (id) REFERENCES public.leagues(id)', (row: Row) => row.kind === 'f'],
    ['constraints', 'validated', false, (row: Row) => row.kind === 'u'],
    ['indexes', 'valid', false, (row: Row) => row.valid === true],
    ['triggers', 'enabled', 'D', (row: Row) => row.internal === false],
    ['functions', 'security_definer', true, (row: Row) => row.security_definer === false && row.extension === null],
    ['functions', 'bodyLfSha256', '0'.repeat(64), (row: Row) => row.extension === null],
    ['functions', 'configuration', ['search_path=public,pg_temp'], (row: Row) => row.security_definer === true],
    ['functions', 'owner', 'league_one_runtime', (row: Row) => row.extension === null],
    ['relations', 'rls', false, (row: Row) => row.rls === true],
    ['policies', 'using_expression', 'true', (row: Row) => row.using_expression !== 'true'],
  ] as const)('rejects changed %s.%s against the independent expected source', (section, key, value, match) => {
    const catalog = baseline();
    const row = mutable(catalog)[section].find(match);
    expect(row).toBeDefined();
    row![key] = value;
    expect(() => assertFreshInstallCatalog(catalog)).toThrow(section);
  });
  it('rejects omitted and unexpected schema objects and catalog sections', () => {
    const missing = baseline(); mutable(missing).relations.pop();
    expect(() => assertFreshInstallCatalog(missing)).toThrow('relations');
    const extra = baseline(); mutable(extra).functions.push({ ...mutable(extra).functions[0], signature: 'public.extra()' });
    expect(() => assertFreshInstallCatalog(extra)).toThrow('functions');
    const section = baseline(); mutable(section).unreviewed = [];
    expect(() => assertFreshInstallCatalog(section)).toThrow('section inventory');
  });
  it.each(['schemaAcl', 'relationAcl', 'columnAcl', 'functionAcl', 'typeAcl', 'databaseAcl', 'defaultAcl',
    'schemaPrivileges', 'tablePrivileges', 'columnPrivileges', 'functionPrivileges', 'typePrivileges'])
  ('rejects an added effective/direct/PUBLIC privilege row in %s', (section) => {
    const catalog = baseline();
    mutable(catalog)[section].push({ schema: 'public', grantee: 'PUBLIC', privilege: 'CREATE', grantable: true });
    expect(() => assertFreshInstallPrivileges(catalog)).toThrow(section);
  });
  it('rejects outgoing role memberships, extra inbound members and changed bootstrap authority', () => {
    for (const edge of [
      { role: '$INSTALLER', member: 'league_one_runtime', grantor: '$INSTALLER', admin_option: false, inherit_option: true, set_option: true },
      { role: 'league_one_auth', member: 'unreviewed_role', grantor: '$INSTALLER', admin_option: false, inherit_option: true, set_option: true },
    ]) {
      const catalog = baseline(); mutable(catalog).memberships.push(edge);
      expect(() => assertFreshInstallPrivileges(catalog)).toThrow('memberships');
    }
    const badBootstrap = baseline(true);
    expect(() => assertFreshInstallPrivileges({ ...badBootstrap, bootstrap: { ...badBootstrap.bootstrap, oid: 11 } })).toThrow('bootstrap');
    const badGrant = baseline(true);
    const edge = mutable(badGrant).memberships.find((row) => row.grantor === '$BOOTSTRAP')!;
    edge.set_option = true;
    expect(() => assertFreshInstallPrivileges(badGrant)).toThrow('memberships');
  });
  it('does not generalize the trusted extension owner variant to application functions', () => {
    const catalog = baseline(true);
    mutable(catalog).functions.find((row) => row.extension === null)!.owner = '$BOOTSTRAP';
    expect(() => assertFreshInstallCatalog(catalog)).toThrow('functions');
    const wrongExtensionOwner = baseline(true);
    mutable(wrongExtensionOwner).functions.find((row) => row.extension === 'pgcrypto')!.owner = '$INSTALLER';
    expect(() => assertFreshInstallCatalog(wrongExtensionOwner)).toThrow('functions');
  });
  it('rejects unreviewed PostgreSQL majors and incomplete membership evidence', () => {
    const catalog = baseline();
    expect(() => assertFreshInstallCatalog({ ...catalog, postgresVersion: '170007' })).toThrow('PostgreSQL 18');
    expect(() => assertFreshInstallPrivileges({ ...catalog, membershipEvidence: [] })).toThrow('membershipEvidence');
  });
  it('collects all 29 strict comparisons, section digests and exact inserted ACL metadata', () => {
    const catalog = baseline();
    mutable(catalog).policies[0].using_expression = 'false';
    mutable(catalog).databaseAcl.push({ database: '$DATABASE', owner: '$INSTALLER', grantee: 'unexpected_admin',
      grantor: '$INSTALLER', privilege: 'CREATE', grantable: true });
    mutable(catalog).roles[0].login = false;
    const error = comparisonFailure(catalog), report = error.diagnostic;
    expect(report.sections).toHaveLength(29);
    expect(report.sections.filter((row) => row.status === 'different').map((row) => row.section))
      .toEqual(['policies', 'roles', 'databaseAcl']);
    for (const section of report.sections) {
      expect(section.expectedDigest).toMatch(/^[a-f0-9]{64}$/u);
      expect(section.observedDigest).toMatch(/^[a-f0-9]{64}$/u);
      expect(section.expectedDigest === section.observedDigest).toBe(section.status === 'matched');
    }
    const acl = report.sections.find((row) => row.section === 'databaseAcl')!;
    expect(acl).toMatchObject({ missingRows: 0, extraRows: 1, changedRows: 0, omitted: { missing: 0, extra: 0, changed: 0 } });
    expect(Object.fromEntries(acl.details.extra[0].fields.map((field) => [field.name, field.value])))
      .toEqual({ database: '$DATABASE', owner: '$INSTALLER', grantee: 'unexpected_admin', grantor: '$INSTALLER', privilege: 'CREATE', grantable: true });
    expect(report.sections.find((row) => row.section === 'policies')!.details.changed[0].differingFields).toEqual(['using_expression']);
    expect(report.truncated).toBe(false);
    expect(Object.isFrozen(report.sections[0].details)).toBe(true);
  });
  it('pairs unique identities only and never conceals duplicate identity ambiguity', () => {
    const changed = baseline(); mutable(changed).databaseAcl[0].grantable = true;
    const report = comparisonFailure(changed).diagnostic.sections.find((row) => row.section === 'databaseAcl')!;
    expect(report).toMatchObject({ missingRows: 0, extraRows: 0, changedRows: 1 });
    expect(report.details.changed[0].differingFields).toEqual(['grantable']);
    const duplicate = baseline();
    mutable(duplicate).databaseAcl.push({ ...mutable(duplicate).databaseAcl[0], grantable: true });
    const ambiguous = comparisonFailure(duplicate).diagnostic.sections.find((row) => row.section === 'databaseAcl')!;
    expect(ambiguous).toMatchObject({ missingRows: 0, extraRows: 1, changedRows: 0 });
    // One original identity remains an exact match. The other residual pair is
    // still ambiguous because uniqueness is checked across the entire section.
    const sample = mutable(duplicate).databaseAcl[0];
    const direct = new FreshInstallCatalogMismatchError('databaseAcl', [sample, { ...sample, grantable: true }],
      [sample, { ...sample, grantable: null }], 1).diagnostic.sections[0];
    expect(direct).toMatchObject({ missingRows: 1, extraRows: 1, changedRows: 0 });
  });
  it('retains all section summaries and explicit omissions under the fixed diagnostic budget', () => {
    const catalog = baseline();
    for (let index = 0; index < 500; index++) mutable(catalog).databaseAcl.push({ database: '$DATABASE', owner: '$INSTALLER',
      grantee: `extra_role_${index}`, grantor: '$INSTALLER', privilege: 'CREATE', grantable: false });
    mutable(catalog).policies[0].roles = ['unexpected_role'];
    const report = comparisonFailure(catalog).diagnostic;
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThanOrEqual(FRESH_INSTALL_COMPARISON_MAX_BYTES);
    expect(report.sections).toHaveLength(29); expect(report.truncated).toBe(true);
    const acl = report.sections.find((row) => row.section === 'databaseAcl')!;
    expect(acl.extraRows).toBe(500); expect(acl.omitted.extra).toBeGreaterThan(0);
    expect(acl.details.extra.length + acl.omitted.extra).toBe(500);
    expect(report.sections.find((row) => row.section === 'policies')!.details.changed).toHaveLength(1);
  });
  it('hashes opaque values, unsafe identifiers and unknown keys in aggregate details', () => {
    const catalog = baseline(), secret = 'postgresql://user:password@example.invalid/database';
    mutable(catalog).policies[0].using_expression = secret.repeat(1000);
    mutable(catalog).policies[0].roles = [secret];
    mutable(catalog).policies[0][secret] = secret;
    mutable(catalog).databaseAcl[0].grantee = '"unmatched';
    const report = comparisonFailure(catalog).diagnostic, serialized = JSON.stringify(report);
    expect(serialized).not.toContain(secret); expect(serialized).not.toContain('unmatched');
    const policy = report.sections.find((row) => row.section === 'policies')!.details.changed[0];
    expect(policy.differingFields).toEqual(['roles', 'using_expression']);
    expect(policy.omittedDifferingFields).toBe(1); expect(policy.observed.omittedFields).toBe(1);
    expect(policy.observed.fields.find((field) => field.name === 'using_expression'))
      .toMatchObject({ type: 'string', length: secret.length * 1000 });
    expect(policy.observed.fields.find((field) => field.name === 'using_expression')!.value).toBeUndefined();
  });
  it('accepts the attested fixed Neon database grant variant without changing the manifest', () => {
    const catalog = neonBaseline();
    expect(() => assertFreshInstallInstalledCatalog(catalog)).not.toThrow();
    expect(() => assertFreshInstallCatalog(catalog)).not.toThrow();
    expect(() => assertFreshInstallPrivileges(catalog)).not.toThrow();
    expect(createHash('sha256').update(text.replace(/\r\n?/gu, '\n')).digest('hex')).toBe(FRESH_INSTALL_MANIFEST_SHA256);
  });
  it.each(['CONNECT', 'CREATE', 'TEMPORARY'])('rejects missing and grantable provider privilege %s', (privilege) => {
    const missing = neonBaseline(); mutable(missing).databaseAcl = mutable(missing).databaseAcl
      .filter((row) => !(row.grantee === 'neon_superuser' && row.privilege === privilege));
    expect(() => assertFreshInstallInstalledCatalog(missing)).toThrow('databaseAcl');
    const grantable = neonBaseline(); mutable(grantable).databaseAcl
      .find((row) => row.grantee === 'neon_superuser' && row.privilege === privilege)!.grantable = true;
    expect(() => assertFreshInstallInstalledCatalog(grantable)).toThrow('databaseAcl');
  });
  it.each(['owner', 'grantor', 'grantee', 'database', 'privilege'])('rejects changed provider ACL %s', (field) => {
    const catalog = neonBaseline(); mutable(catalog).databaseAcl.find((row) => row.grantee === 'neon_superuser')![field] = 'unexpected';
    expect(() => assertFreshInstallInstalledCatalog(catalog)).toThrow('databaseAcl');
  });
  it.each(['superuser', 'inherit', 'createDb', 'createRole', 'login', 'replication', 'bypassRls'])
  ('rejects changed provider role flag %s', (field) => {
    const catalog = neonBaseline(), role = catalog.databasePlatform!.role as unknown as Row;
    role[field] = !role[field];
    expect(() => assertFreshInstallInstalledCatalog(catalog)).toThrow('database platform');
  });
  it('rejects absent, partial, extra, wrongly owned and inconsistently attested platform metadata', () => {
    const absent = { ...baseline() } as unknown as Row; delete absent.databasePlatform;
    expect(() => assertFreshInstallCatalog(absent as unknown as FreshInstallCatalog)).toThrow('platform witness');
    for (const value of [undefined, {}, { ...neonBaseline().databasePlatform, extra: true },
      { ...neonBaseline().databasePlatform, databaseOwner: 'another_owner' },
      { ...neonBaseline().databasePlatform, branchId: 'https://example.invalid/secret' },
      { ...neonBaseline().databasePlatform, role: { ...neonBaseline().databasePlatform!.role, name: 'other_admin' } }]) {
      expect(() => assertFreshInstallInstalledCatalog({ ...neonBaseline(), databasePlatform: value } as FreshInstallCatalog))
        .toThrow('database platform');
    }
    expect(() => assertFreshInstallInstalledCatalog({ ...neonBaseline(), databasePlatform: null })).toThrow('databaseAcl');
    expect(() => assertFreshInstallInstalledCatalog({ ...baseline(), databasePlatform: neonBaseline().databasePlatform }))
      .toThrow('database platform');
  });
  it('rejects provider installer membership loss and every app-role membership or usage escalation', () => {
    for (const field of ['member', 'usage'] as const) {
      const installer = neonBaseline(); (installer.databasePlatform!.installer as { member: boolean; usage: boolean })[field] = false;
      expect(() => assertFreshInstallInstalledCatalog(installer)).toThrow('database platform');
      for (let index = 0; index < 3; index++) {
        const app = neonBaseline(); (app.databasePlatform!.applicationRoles[index] as { member: boolean; usage: boolean })[field] = true;
        expect(() => assertFreshInstallInstalledCatalog(app)).toThrow('database platform');
      }
    }
    const reordered = neonBaseline(); (reordered.databasePlatform!.applicationRoles as unknown[]).reverse();
    expect(() => assertFreshInstallInstalledCatalog(reordered)).toThrow('database platform');
  });
  it('reports exact safe platform flag and branch drift without claiming catalog comparison', () => {
    const catalog = neonBaseline(); (catalog.databasePlatform!.role as { login: boolean }).login = true;
    let failure: FreshInstallDatabasePlatformError | undefined;
    try { assertFreshInstallInstalledCatalog(catalog); } catch (error) { failure = error as FreshInstallDatabasePlatformError; }
    expect(failure).toBeInstanceOf(FreshInstallDatabasePlatformError);
    expect(failure!.postgresVersion).toBe('180003');
    expect(failure!.diagnostic).toMatchObject({ format: 'fresh-install-platform-witness-v1', omittedUnknownFields: 0,
      issues: [{ field: 'role.login', requirement: 'equals', expected: { value: false }, observed: { value: true } }] });
    const valid = neonBaseline();
    expect(() => assertFreshInstallDatabasePlatformBranch(valid, 'br-local-model')).not.toThrow();
    try { assertFreshInstallDatabasePlatformBranch(valid, 'br-another-child'); } catch (error) { failure = error as FreshInstallDatabasePlatformError; }
    expect(failure!.diagnostic.issues).toMatchObject([{ field: 'branchId', expected: { value: 'br-another-child' },
      observed: { value: 'br-local-model' } }]);
    expect(() => assertFreshInstallDatabasePlatformBranch(baseline(), 'br-local-model')).toThrow(FreshInstallDatabasePlatformError);
    expect(() => assertFreshInstallDatabasePlatformBranch(valid, 'https://example.invalid/secret')).toThrow(FreshInstallDatabasePlatformError);
  });
  it('bounds platform metadata and hashes unsafe values and unknown field names', () => {
    const catalog = neonBaseline(), secret = 'postgresql://user:password@example.invalid/database';
    const platform = catalog.databasePlatform as unknown as Row;
    platform.branchId = secret.repeat(1000); platform.databaseOwner = secret; platform[secret] = secret;
    let failure: FreshInstallDatabasePlatformError | undefined;
    try { assertFreshInstallInstalledCatalog(catalog); } catch (error) { failure = error as FreshInstallDatabasePlatformError; }
    expect(failure).toBeInstanceOf(FreshInstallDatabasePlatformError);
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(failure!.diagnostic.omittedUnknownFields).toBe(1);
    expect(failure!.diagnostic.issues.map((issue) => issue.field)).toEqual(['branchId', 'databasePlatform', 'databaseOwner']);
    expect(failure!.diagnostic.issues[0].observed).toMatchObject({ type: 'string', length: secret.length * 1000 });
    expect(failure!.diagnostic.issues[0].observed.value).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(failure!.diagnostic))).toBeLessThan(16 * 1024);
  });
  it.each([
    { branch_id: null, platform_name: 'neon_superuser' },
    { branch_id: 'br-local-model', platform_name: null },
    { branch_id: 'br-local-model', platform_name: 'another_role' },
    { branch_id: undefined, platform_name: undefined },
  ])('rejects incomplete provider signals and rolls back the read-only snapshot: %o', async (signals) => {
    const statements: string[] = [];
    const query = async (statement: string): Promise<readonly Row[]> => {
      statements.push(statement);
      if (statement.includes('AS installer_name')) return [{ current_user: 'test_installer', session_user: 'test_installer',
        version: '180003', installer_name: 'test_installer', installer_superuser: false, installer_inherit: true,
        installer_create_role: true, bootstrap_name: 'postgres', bootstrap_oid: 10, bootstrap_superuser: true }];
      if (statement.includes("current_setting('neon.branch_id'")) return [{ ...signals, database_owner: 'test_installer' }];
      return [];
    };
    await expect(readFreshInstallCatalog(query, 'test_installer')).rejects.toBeInstanceOf(FreshInstallDatabasePlatformError);
    expect(statements[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(statements.at(-1)).toBe('ROLLBACK'); expect(statements).not.toContain('COMMIT');
  });
  it('reads the required provider witness in the same snapshot without inferring false flags', async () => {
    let login: unknown = false;
    const statements: string[] = [];
    const query = async (statement: string): Promise<readonly Row[]> => {
      statements.push(statement);
      if (statement.includes('AS installer_name')) return [{ current_user: 'test_installer', session_user: 'test_installer',
        version: '180003', installer_name: 'test_installer', installer_superuser: false, installer_inherit: true,
        installer_create_role: true, bootstrap_name: 'postgres', bootstrap_oid: 10, bootstrap_superuser: true }];
      if (statement.includes("current_setting('neon.branch_id'")) return [{ branch_id: 'br-local-model', database_owner: 'test_installer',
        platform_name: 'neon_superuser', superuser: false, inherit: true, create_db: true, create_role: true,
        login, replication: true, bypass_rls: true, installer_member: true, installer_usage: true }];
      if (statement.includes("pg_has_role(r.oid,p.oid,'MEMBER')")) return neonBaseline().databasePlatform!.applicationRoles;
      return [];
    };
    const result = await readFreshInstallCatalog(query, 'test_installer');
    expect(result.databasePlatform).toEqual(neonBaseline().databasePlatform);
    login = null; statements.length = 0;
    await expect(readFreshInstallCatalog(query, 'test_installer')).rejects.toBeInstanceOf(FreshInstallDatabasePlatformError);
    expect(statements.some((statement) => statement.includes('FROM pg_namespace n'))).toBe(false);
    expect(statements.at(-1)).toBe('ROLLBACK');
  });
});
