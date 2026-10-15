import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { assertFreshInstallCatalog, assertFreshInstallPrivileges, readFreshInstallSources,
  readFreshInstallCatalog, FRESH_INSTALL_MANIFEST_SHA256, FreshInstallCatalogMismatchError,
  type FreshInstallCatalog } from './fresh-install-catalog';
import { createHash } from 'node:crypto';
import { types } from '@neondatabase/serverless';

type Row = Record<string, unknown>;
const text = readFileSync(new URL('./fresh-install-catalog.json', import.meta.url), 'utf8');
const frozen = JSON.parse(text) as { catalog: Record<string, Row[]> };
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
    bootstrap: { name: 'postgres', oid: 10, superuser: true }, sections,
    membershipEvidence: sections.memberships.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
      [key, value === '$INSTALLER' ? installer : value === '$BOOTSTRAP' ? 'postgres' : value]))),
  };
}
function mutable(catalog: FreshInstallCatalog): Record<string, Row[]> { return catalog.sections as Record<string, Row[]>; }

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
  it('binds the reviewed manifest and all 56 migration and three provisioner bytes', async () => {
    expect(createHash('sha256').update(text.replace(/\r\n?/gu, '\n')).digest('hex')).toBe(FRESH_INSTALL_MANIFEST_SHA256);
    const sources = await readFreshInstallSources();
    expect(sources.migrations).toHaveLength(56);
    expect(sources.provisioners).toHaveLength(3);
    expect(Buffer.byteLength(JSON.stringify(baseline()))).toBeLessThan(4 * 1024 * 1024);
  });
  it.each([false, true])('accepts only the preimplementation installer variant nonsuper=%s', (nonsuper) => {
    const catalog = baseline(nonsuper);
    expect(() => assertFreshInstallCatalog(catalog)).not.toThrow();
    expect(() => assertFreshInstallPrivileges(catalog)).not.toThrow();
  });
  it('collects policy roles as text arrays through the installed Neon decoder', async () => {
    const expected = baseline();
    const query = vi.fn(async (statement: string): Promise<readonly Row[]> => {
      if (statement.includes('AS installer_name')) return [{ current_user: 'postgres', session_user: 'postgres',
        version: '180003', installer_name: 'postgres', installer_superuser: true, installer_inherit: true,
        installer_create_role: true, bootstrap_name: 'postgres', bootstrap_oid: 10, bootstrap_superuser: true }];
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
});
