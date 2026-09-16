import 'server-only';

import { cache } from 'react';
import { LEAGUE_IDS } from '../config';
import { LEAGUE_SITES, type LeagueKey } from '../leagues';
import { FIRST_MATCHUP_WEEK, LAST_MATCHUP_WEEK } from '../matchup-week';
import { createLeagueRegistry } from '../projections/adapters/configuration/league-registry';
import { externalLeagueRef, providerKey } from '../projections/shared/provider-identity';
import type { LeagueRegistryPort } from '../projections/ports/league-registry';
import { getLeagueAdministrationStore } from './store';
import type { LeagueAdministrationStore } from './store-contracts';

/** Bootstrap is explicit and only used where persistence is disabled (including Preview). */
export function bootstrapLeagueRegistry(): LeagueRegistryPort {
  return createLeagueRegistry((Object.keys(LEAGUE_IDS) as LeagueKey[]).map((key) => ({
    key, displayName: LEAGUE_SITES[key].name,
    leagueRef: externalLeagueRef(providerKey('sleeper'), LEAGUE_IDS[key]),
    matchupWeekRange: { firstWeek: FIRST_MATCHUP_WEEK, lastWeek: LAST_MATCHUP_WEEK },
  })));
}

export async function loadAdministrationRegistry(
  store: LeagueAdministrationStore = getLeagueAdministrationStore(),
  season?: number,
): Promise<LeagueRegistryPort> {
  if (!store.enabled) return bootstrapLeagueRegistry();
  const enrolled = await store.listEnrollments(season);
  if (!enrolled.length) throw new Error('No accepted league enrollment is available.');
  return createLeagueRegistry(enrolled.map((league) => ({
    key: league.leagueKey, displayName: league.displayName,
    leagueRef: externalLeagueRef(providerKey(league.provider), league.externalLeagueId),
    // This horizon is a supported site policy, not a Sleeper administration setting.
    matchupWeekRange: { firstWeek: FIRST_MATCHUP_WEEK, lastWeek: LAST_MATCHUP_WEEK },
  })));
}

/** React cache deduplicates one render, without retaining a head across requests. */
export const getAdministrationRegistry = cache(loadAdministrationRegistry);

export const getCurrentLeagueIds = cache(async (): Promise<Record<LeagueKey, string>> => {
  const configurations = (await getAdministrationRegistry()).listActiveLeagues();
  const result = {} as Record<LeagueKey, string>;
  for (const key of Object.keys(LEAGUE_IDS) as LeagueKey[]) {
    const entry = configurations.find((configuration) => configuration.key === key);
    if (!entry) throw new Error('A routed league is missing its accepted enrollment.');
    result[key] = String(entry.leagueRef.externalId);
  }
  return result;
});

/** Route files retain permanent public keys while annual source IDs change in Neon. */
export async function resolveCurrentLeagueId(bootstrapId: string): Promise<string> {
  const key = (Object.keys(LEAGUE_IDS) as LeagueKey[]).find((candidate) => LEAGUE_IDS[candidate] === bootstrapId);
  if (!key) return bootstrapId;
  return (await getCurrentLeagueIds())[key];
}

export async function findCurrentLeagueKey(externalId: string): Promise<string | null> {
  return (await getAdministrationRegistry()).listActiveLeagues()
    .find((league) => String(league.leagueRef.externalId) === externalId)?.key ?? null;
}
