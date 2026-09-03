import 'server-only';
import type { PeriodCadenceTiming } from '../../domain/period-cadence-timing';

export function normalizePeriodCadenceTiming(value: unknown): PeriodCadenceTiming {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Period cadence is unavailable.');
  const input = value as Record<string, unknown>;
  if (typeof input.isCurrentRegularPeriod !== 'boolean' || !Array.isArray(input.games)
    || input.games.length > 32) throw new Error('Period cadence is malformed.');
  const games = new Map<string, { kickoffAt: string | null; date: string }>();
  for (const game of input.games) {
    if (!game || typeof game !== 'object' || Array.isArray(game)
      || typeof game.date !== 'string'
      || (game.kickoffAt !== null && (typeof game.kickoffAt !== 'string'
        || !Number.isFinite(Date.parse(game.kickoffAt))))) throw new Error('Period cadence game is malformed.');
    const item = { kickoffAt: game.kickoffAt as string | null, date: game.date as string };
    games.set(JSON.stringify(item), item);
  }
  return { isCurrentRegularPeriod: input.isCurrentRegularPeriod,
    games: [...games].sort(([left], [right]) => left.localeCompare(right)).map(([, game]) => game) };
}
