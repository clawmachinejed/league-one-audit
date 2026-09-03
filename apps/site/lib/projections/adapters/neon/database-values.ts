import 'server-only';

import { createHash } from 'node:crypto';
import type { Database, DatabaseClient, DatabaseRow } from '../../../database';

export function provider(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) throw new Error('Provider names must not be blank.');
  return normalized;
}

export function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be blank.`);
  return normalized;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Database JSON cannot contain a non-finite number.');
  }
  return value;
}

export function json(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function rulesHash(rules: Readonly<Record<string, number>>): string {
  return createHash('sha256').update(json(rules)).digest('hex');
}

export function deterministicUuid(scope: string, key: string): string {
  const digest = createHash('sha256').update(`${scope}\0${key}`).digest('hex').slice(0, 32);
  const variant = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20)}`;
}

export function rowText(row: DatabaseRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || !value) throw new Error(`Database did not return ${key}.`);
  return value;
}

export function rowNullableText(row: DatabaseRow, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value ? value : null;
}

export function rowNumber(row: DatabaseRow, key: string): number {
  const value = row[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Database did not return a numeric ${key}.`);
  return parsed;
}

export function rowBoolean(row: DatabaseRow, key: string): boolean {
  const value = row[key];
  return value === true || value === 'true';
}

export function rowObject(row: DatabaseRow, key: string): Readonly<Record<string, unknown>> {
  const value = row[key];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  if (typeof value === 'string') {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Readonly<Record<string, unknown>>;
    }
  }
  throw new Error(`Database did not return an object for ${key}.`);
}

export function normalizeIds(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

export function connected(database: Database): DatabaseClient | null {
  return database.enabled ? database : null;
}
