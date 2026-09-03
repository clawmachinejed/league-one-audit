import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { migrationChecksum, normalizeMigrationText } from './migration-text.mjs';

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
