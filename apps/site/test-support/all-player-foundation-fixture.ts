import { readFileSync } from 'node:fs';
import type { PlayerCatalog, SleeperMatchup } from '../lib/transform';
import type { AllPlayerPeriodParticipationEvidence } from '../lib/projections/domain/all-player-eligibility';
import type { AllPlayerGamePhase } from '../lib/projections/domain/all-player-statistics';
import type { FantasyPlayerPosition, FantasyPlayerPositionLoader } from '../lib/sleeper-player-catalog';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/all-player-foundation/${name}`, import.meta.url), 'utf8')) as T;
}

export const foundationFixture = {
  period: { season: 2026, seasonType: 'reg' as const, week: 1 },
  capturedAt: '2026-09-12T13:10:38.509Z',
  // The raw response is replayed locally after transcribing reviewed gamebook evidence.
  replayObservedAt: '2026-09-12T14:54:37.000Z',
  weekly: fixture<Readonly<Record<string, Readonly<Record<string, number>>>>>('weekly-stat-response.json'),
  reviewedParticipation: fixture<Record<string, AllPlayerPeriodParticipationEvidence>>('reviewed-participation.json'),
  catalogs: Object.fromEntries((['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const).map((position) => [
    position, fixture<readonly (PlayerCatalog[string] & { id: string; player_id: string })[]>(`catalog-${position}.json`),
  ])) as Record<FantasyPlayerPosition, readonly (PlayerCatalog[string] & { id: string; player_id: string })[]>,
  selectedUnfilteredIdentities: fixture<readonly (PlayerCatalog[string] & { id: string; player_id: string })[]>('selected-unfiltered-identities.json'),
  leagues: (['league1', 'league2'] as const).map((key) => ({
    key,
    rosters: fixture<readonly { roster_id: number; players: readonly string[]; starters: readonly string[];
      reserve: readonly string[] | null; taxi: readonly string[] | null }[]>(`${key}-rosters.json`),
    matchups: fixture<readonly SleeperMatchup[]>(`${key}-matchups-1.json`),
    settings: fixture<{ league_id: string; season: string; scoring_settings: Record<string, number>;
      roster_positions: readonly string[] }>(`${key}-settings.json`),
  })),
  games: fixture<{ games: readonly { nflGameId: string; homeTeam: string; awayTeam: string;
    phase: AllPlayerGamePhase; kickoffAt: string }[] }>('game-context.json').games,
};

export const loadFoundationFixtureCatalogPosition: FantasyPlayerPositionLoader = async (position) => {
  const rows = foundationFixture.catalogs[position];
  return { catalog: Object.fromEntries(rows.map((player) => [player.id, player])),
    sourceRevision: `retained-audit-2026-09-12:${position}`, rowCount: rows.length, malformedRowCount: 0 };
};
