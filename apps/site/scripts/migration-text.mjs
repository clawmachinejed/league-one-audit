import { createHash } from 'node:crypto';

/**
 * Migration checksums identify the committed SQL, independent of the checkout's
 * operating-system line endings. Git stores migration files with LF endings,
 * while some Windows checkouts materialize them with CRLF endings.
 *
 * @param {string} statement
 * @returns {string}
 */
export function normalizeMigrationText(statement) {
  return statement.replace(/\r\n?/gu, '\n');
}

/**
 * @param {string} statement
 * @returns {string}
 */
export function migrationChecksum(statement) {
  return createHash('sha256').update(normalizeMigrationText(statement)).digest('hex');
}

/** Rejects duplicate or skipped numeric prefixes before taking the schema lock. */
export function validateMigrationSequence(names) {
  names.forEach((name, index) => {
    const expected = String(index + 1).padStart(3, '0');
    if (!name.startsWith(`${expected}_`)) {
      throw new Error(`Database migration sequence is not contiguous at ${name}.`);
    }
  });
  return names;
}
