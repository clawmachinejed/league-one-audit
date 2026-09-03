import 'server-only';

import { MATCHUPS_SHAPE, type MatchupsShape } from '../../../matchups-shape';

// Exact IEEE-754 overflow rounding boundary, including finite underflows to zero.
export const JAVASCRIPT_NUMBER_OVERFLOW_BOUNDARY = ((1n << 1024n) - (1n << 970n)).toString();

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Compiles only repository-owned expressions and schema keys, never request input. */
export function matchupsStructureSql(expression: string): string {
  let nextAlias = 0;
  const compile = (shape: MatchupsShape, raw: string): string => {
    const value = `(${raw})`;
    const type = `jsonb_typeof(${value})`;
    switch (shape.kind) {
      case 'string': return `${type} = 'string'`;
      case 'number': return `CASE WHEN ${type} = 'number' THEN
        abs((${value} #>> '{}')::numeric) < ${JAVASCRIPT_NUMBER_OVERFLOW_BOUNDARY}::numeric
        ELSE false END`;
      case 'literal': return `${value} = to_jsonb(${literal(shape.value)}::text)`;
      case 'nullable': return `(${value} = 'null'::jsonb OR (${compile(shape.value, value)}))`;
      case 'optional': return `(${value} IS NULL OR (${compile(shape.value, value)}))`;
      case 'union': return `(${shape.alternatives.map((child) => `(${compile(child, value)})`).join(' OR ')})`;
      // Refinements execute in Node against the compact scalar/atom results.
      case 'refinement': return shape.name === 'date-string' ? `${type} = 'string'` : 'true';
      case 'object': return `CASE WHEN ${type} = 'object' THEN (
        ${Object.entries(shape.properties).map(([key, child]) => (
          `COALESCE((${compile(child, `${value} -> ${literal(key)}`)}), false)`
        )).join(' AND ')}
        ) ELSE false END`;
      case 'array': {
        const alias = `shape_item_${nextAlias++}`;
        const bounds = [
          shape.minimum === undefined ? '' : `jsonb_array_length(${value}) >= ${shape.minimum} AND`,
          shape.maximum === undefined ? '' : `jsonb_array_length(${value}) <= ${shape.maximum} AND`,
        ].filter(Boolean).join(' ');
        return `CASE WHEN ${type} = 'array' THEN ${bounds} NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(${value}) AS ${alias}(value)
          WHERE NOT COALESCE((${compile(shape.item, `${alias}.value`)}), false)
        ) ELSE false END`;
      }
    }
  };
  return `COALESCE((${compile(MATCHUPS_SHAPE, expression)}), false)`;
}

export function safeJsonArray(expression: string): string {
  return `CASE WHEN jsonb_typeof(${expression}) = 'array' THEN ${expression} ELSE '[]'::jsonb END`;
}
