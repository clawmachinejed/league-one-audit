// The Neon driver returns timestamptz as Date; String(Date) drops milliseconds.
export function exactMatchupClockInstant(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid PostgreSQL clock instant.');
  return date.toISOString();
}
