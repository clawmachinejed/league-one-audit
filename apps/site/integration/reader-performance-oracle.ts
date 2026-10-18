import assert from 'node:assert/strict';
import type { AssertStrict } from 'node:assert';

const jsonAssert: AssertStrict = new assert.Assert({ skipPrototype: true });

function requireJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  assert(value !== null && typeof value === 'object', 'Reader oracle requires JSON values.');
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  assert(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null,
    'Reader oracle requires plain JSON records and arrays.');
  assert(!ancestors.has(value), 'Reader oracle rejects cyclic evidence.');
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  if (array) assert.equal(keys.length, value.length + 1, 'Reader oracle rejects sparse or extended arrays.');
  for (const key of keys) {
    assert.equal(typeof key, 'string', 'Reader oracle rejects symbol keys.');
    if (array && key === 'length') continue;
    if (array) assert(/^(?:0|[1-9][0-9]*)$/u.test(String(key)) && Number(key) < value.length,
      'Reader oracle rejects non-index array properties.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert(descriptor?.enumerable && Object.hasOwn(descriptor, 'value'), 'Reader oracle requires enumerable data properties.');
    requireJson(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

/** Compare exact JSON facts while preserving the reader's null-prototype dictionaries.
 * No serialization may erase undefined, non-finite numbers, sparse slots or own keys. */
export function assertReaderJsonEqual(actual: unknown, expected: unknown): void {
  requireJson(actual); requireJson(expected);
  jsonAssert.deepStrictEqual(actual, expected);
}
