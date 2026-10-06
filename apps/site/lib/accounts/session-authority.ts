import 'server-only';
import { createHash } from 'node:crypto';

/** Ephemeral server parameters. Never log, cache, enqueue or serialize to HTTP. */
export type AuthReceiptV2 = Readonly<{
  sessionId: string; subject: string; expiresAt: string; issuer: string;
  admissionEpochRevision: string; configHash: string; clockDomain: string;
  admittedEmailDigest: string; sessionTokenDigest: string;
}>;

const keys = ['sessionId', 'subject', 'expiresAt', 'issuer', 'admissionEpochRevision',
  'configHash', 'clockDomain', 'admittedEmailDigest', 'sessionTokenDigest'];
const digestPattern = /^[a-f0-9]{64}$/u;
export const authorityDigest = (exactValue: string): string => createHash('sha256').update(exactValue, 'utf8').digest('hex');

/** Versioned, nonsecret admission configuration; collection order is immaterial. */
export function accountAdmissionConfigHash(issuer: string, invitedEmails: ReadonlySet<string>): string {
  return authorityDigest(JSON.stringify(['account-admission-v2', issuer, [...invitedEmails].sort()]));
}

export function readAuthReceiptV2(value: unknown): AuthReceiptV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Account authority is unavailable.');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key) || typeof row[key] !== 'string' || !row[key])
    || !/^[1-9]\d{0,18}$/u.test(row.admissionEpochRevision as string)
    || BigInt(row.admissionEpochRevision as string) > 9223372036854775807n
    || !['configHash', 'admittedEmailDigest', 'sessionTokenDigest'].every(key => digestPattern.test(row[key] as string))
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(row.expiresAt as string)
    || !Number.isFinite(Date.parse(row.expiresAt as string))
    || new Date(row.expiresAt as string).toISOString() !== row.expiresAt) {
    throw new Error('Account authority is unavailable.');
  }
  return Object.freeze(Object.fromEntries(keys.map(key => [key, row[key]]))) as AuthReceiptV2;
}
