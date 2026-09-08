export const TRANSACTION_TIME_ZONE = 'America/New_York';

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TRANSACTION_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function transactionCalendarDay(timestamp: number): string | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(new Date(timestamp).getTime())) return null;
  const parts = dayFormatter.formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return values.year && values.month && values.day ? `${values.year}-${values.month}-${values.day}` : null;
}
