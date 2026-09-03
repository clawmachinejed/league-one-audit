import { createHash } from 'node:crypto';
import { stableJson } from './stable-json';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Matches the pre-canonical worker revision algorithm. */
export function compatibleRevision(value: unknown): string {
  return sha256(stableJson(value, { nonFiniteNumbers: 'json-null' }));
}

/** Matches the existing persisted scoring-profile hash algorithm. */
export function compatibleScoringRulesHash(rules: Readonly<Record<string, number>>): string {
  return sha256(stableJson(rules));
}

/** Matches the deterministic UUIDs already persisted for natural identities. */
export function compatibleDeterministicUuid(scope: string, key: string): string {
  const digest = sha256(`${scope}\0${key}`).slice(0, 32);
  const variant = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20)}`;
}
