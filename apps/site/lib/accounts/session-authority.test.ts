import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { accountAdmissionConfigHash, authorityDigest, readAuthReceiptV2 } from './session-authority';

const receipt = { sessionId: 'opaque session', subject: 'opaque subject', expiresAt: '2030-01-01T00:00:00.000Z',
  issuer: 'https://example.test/api/auth', admissionEpochRevision: '1', configHash: 'a'.repeat(64),
  clockDomain: 'synthetic-db-clock', admittedEmailDigest: 'b'.repeat(64), sessionTokenDigest: 'c'.repeat(64) };

describe('ephemeral session authority receipt', () => {
  it('preserves opaque identity and maximum BIGINT revision without number conversion', () => {
    expect(readAuthReceiptV2({ ...receipt, admissionEpochRevision: '9223372036854775807' }))
      .toEqual({ ...receipt, admissionEpochRevision: '9223372036854775807' });
  });
  it.each(['0', '-1', '01', '1.0', '9223372036854775808', '999999999999999999999'])('rejects invalid revision %s', revision => {
    expect(() => readAuthReceiptV2({ ...receipt, admissionEpochRevision: revision })).toThrow('unavailable');
  });
  it.each([null, [], { ...receipt, extra: 'sensitive' }, { ...receipt, sessionId: null },
    { ...receipt, sessionTokenDigest: 'F'.repeat(64) }, { ...receipt, expiresAt: '2030-01-01T00:00:00Z' },
    { ...receipt, expiresAt: '2030-02-31T00:00:00.000Z' }])('rejects malformed authority %#', value => {
    expect(() => readAuthReceiptV2(value)).toThrow('unavailable');
  });
  it('copies and freezes the receipt so later caller mutation cannot change an admitted transaction', () => {
    const source = { ...receipt };
    const validated = readAuthReceiptV2(source);
    source.subject = 'different subject';
    expect(validated.subject).toBe('opaque subject');
    expect(Object.isFrozen(validated)).toBe(true);
  });
  it('rejects inherited authority fields and unexpected own fields even when key count matches', () => {
    const { subject, ...rest } = receipt;
    const inherited = Object.assign(Object.create({ subject }), rest, { extra: true });
    expect(Object.keys(inherited)).toHaveLength(9);
    expect(() => readAuthReceiptV2(inherited)).toThrow('unavailable');
    expect(() => readAuthReceiptV2(Object.assign(Object.create(null), receipt))).toThrow('unavailable');
  });
  it('hashes exact persisted UTF8, including case and surrounding whitespace', () => {
    expect(authorityDigest(' A@example.test ')).not.toBe(authorityDigest('a@example.test'));
    expect(authorityDigest('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('binds admission to issuer and canonical invite set but not insertion order', () => {
    const hash = accountAdmissionConfigHash(receipt.issuer, new Set(['a@test.test', 'b@test.test']));
    expect(accountAdmissionConfigHash(receipt.issuer, new Set(['b@test.test', 'a@test.test']))).toBe(hash);
    expect(accountAdmissionConfigHash('https://other.test/api/auth', new Set(['a@test.test', 'b@test.test']))).not.toBe(hash);
    expect(accountAdmissionConfigHash(receipt.issuer, new Set(['a@test.test']))).not.toBe(hash);
  });
});
