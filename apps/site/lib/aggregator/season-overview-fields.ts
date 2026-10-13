import type { Decimal } from './contracts';
import type { JsonObject, JsonValue } from '../league-administration/contracts';
import type { SeasonFact, SeasonPointsFact } from './season-overview-source-contracts';

/** Shared native field semantics; no roster acceptance, display defaults or source clocks. */
export function seasonObject(value: JsonValue | undefined): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}
export function seasonField<T>(container: JsonObject | null, key: string, sourcePath: string,
  valid: (value: JsonValue) => value is T & JsonValue): SeasonFact<T> {
  if (container === null) return { state: 'invalid', value: null, sourcePath };
  if (!Object.hasOwn(container, key)) return { state: 'absent', value: null, sourcePath };
  const value = container[key];
  return value === null ? { state: 'null', value: null, sourcePath }
    : valid(value) ? { state: 'known', value, sourcePath } : { state: 'invalid', value: null, sourcePath };
}
export const seasonFinite = (value: JsonValue): value is number => typeof value === 'number' && Number.isFinite(value);
export const seasonInteger = (minimum: number) => (value: JsonValue): value is number =>
  seasonFinite(value) && Number.isSafeInteger(value) && value >= minimum;

/** Parsed JSON numbers retain their shortest round-trippable decimal, not lost lexical source scale. */
function decimalParts(value: number): { units: bigint; scale: number } {
  const [mantissa, exponent = '0'] = String(Object.is(value, -0) ? 0 : value).split(/[eE]/u);
  const [whole, fraction = ''] = mantissa.split('.');
  const scale = fraction.length - Number(exponent);
  const units = BigInt(`${whole}${fraction}`);
  return scale < 0 ? { units: units * 10n ** BigInt(-scale), scale: 0 } : { units, scale };
}
function totalDecimal(whole: number, fraction: number): Decimal {
  const left = decimalParts(whole); const right = decimalParts(fraction);
  right.scale += 2;
  const scale = Math.max(left.scale, right.scale);
  const units = left.units * 10n ** BigInt(scale - left.scale) + right.units * 10n ** BigInt(scale - right.scale);
  const negative = units < 0n; const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const result = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/u, '');
  return `${negative ? '-' : ''}${result}`;
}
export function seasonPoints(settings: JsonObject | null, wholeKey: string, fractionKey: string): SeasonPointsFact {
  const whole = seasonField(settings, wholeKey, `settings.${wholeKey}`, seasonFinite);
  const fraction = seasonField(settings, fractionKey, `settings.${fractionKey}`, seasonFinite);
  // The optional fractional component is hundredths. Explicit null/invalid fractions and
  // an absent whole part never become a known zero.
  const state = whole.state !== 'known' ? whole.state : fraction.state === 'known' || fraction.state === 'absent' ? 'known' : fraction.state;
  return { whole, fraction, state, value: state === 'known' ? totalDecimal(whole.value!, fraction.value ?? 0) : null,
    policy: 'sleeper-whole-plus-hundredths-v1' };
}
