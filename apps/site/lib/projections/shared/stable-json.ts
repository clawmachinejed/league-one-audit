export type NonFiniteNumberPolicy = 'reject' | 'json-null';

export type StableJsonOptions = Readonly<{
  nonFiniteNumbers?: NonFiniteNumberPolicy;
}>;

function canonicalValue(value: unknown, nonFiniteNumbers: NonFiniteNumberPolicy): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalValue(item, nonFiniteNumbers));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item, nonFiniteNumbers)]),
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    if (nonFiniteNumbers === 'json-null') return null;
    throw new Error('Stable JSON cannot contain a non-finite number.');
  }
  return value;
}

export function stableJsonValue(value: unknown, options: StableJsonOptions = {}): unknown {
  return canonicalValue(value, options.nonFiniteNumbers ?? 'reject');
}

export function stableJson(value: unknown, options: StableJsonOptions = {}): string {
  const serialized = JSON.stringify(stableJsonValue(value, options));
  if (serialized === undefined) throw new Error('Stable JSON requires a serializable root value.');
  return serialized;
}
