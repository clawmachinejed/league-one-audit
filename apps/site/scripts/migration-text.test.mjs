import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { migrationChecksum, normalizeMigrationText, validateMigrationSequence } from './migration-text.mjs';

describe('migration text', () => {
  it('uses the same SQL and checksum for LF, CRLF, and CR checkouts', () => {
    const lf = 'CREATE TABLE example (\n  id integer\n);\n';
    const crlf = lf.replace(/\n/gu, '\r\n');
    const cr = lf.replace(/\n/gu, '\r');
    const expectedChecksum = createHash('sha256').update(lf).digest('hex');

    expect(normalizeMigrationText(crlf)).toBe(lf);
    expect(normalizeMigrationText(cr)).toBe(lf);
    expect(migrationChecksum(lf)).toBe(expectedChecksum);
    expect(migrationChecksum(crlf)).toBe(expectedChecksum);
    expect(migrationChecksum(cr)).toBe(expectedChecksum);
  });
});

describe('migration sequence', () => {
  it('accepts the additive 001 through 010 sequence', () => {
    const names = Array.from({ length: 10 }, (_, index) => (
      `${String(index + 1).padStart(3, '0')}_migration.sql`
    ));
    expect(validateMigrationSequence(names)).toBe(names);
  });

  it('rejects a skipped or duplicate prefix before migration execution', () => {
    expect(() => validateMigrationSequence(['001_one.sql', '003_three.sql']))
      .toThrow('not contiguous');
    expect(() => validateMigrationSequence(['001_one.sql', '001_again.sql']))
      .toThrow('not contiguous');
  });
});
