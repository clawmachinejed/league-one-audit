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

/** Collection lanes can progress healthy members without losing intended membership. */
export async function loadIsolatedAdministrationRegistry(
  store: LeagueAdministrationStore = getLeagueAdministrationStore(), season?: number,
): Promise<LeagueRegistryPort> {
  if (!store.enabled) return bootstrapLeagueRegistry();
  const { entries } = await store.listEnrollmentInventory(season);
  if (!entries.length) throw new Error('No accepted league enrollment is available.');
  const failures = new Map(entries.flatMap(entry => entry.status === 'unavailable'
    ? [[entry.intended.leagueKey, { leagueKey: entry.intended.leagueKey, reason: entry.reason }] as const] : []));
  return createLeagueRegistry(entries.flatMap(entry => entry.status === 'ready' ? [{
    key: entry.enrollment.leagueKey, displayName: entry.enrollment.displayName,
    leagueRef: externalLeagueRef(providerKey(entry.enrollment.provider), entry.enrollment.externalLeagueId),
    matchupWeekRange: { firstWeek: FIRST_MATCHUP_WEEK, lastWeek: LAST_MATCHUP_WEEK },
  }] : []), { intendedLeagueKeys: [...new Set(entries.map(entry => entry.intended.leagueKey))],
    failures: [...failures.values()] });
}

/** React cache deduplicates one render, without retaining a head across requests. */
export const getAdministrationRegistry = cache(loadAdministrationRegistry);

export const getCurrentLeagueIds = cache(async (): Promise<Partial<Record<LeagueKey, string>>> => {
  const store = getLeagueAdministrationStore();
  if (!store.enabled) return { ...LEAGUE_IDS };
  const rows = await Promise.all((Object.keys(LEAGUE_IDS) as LeagueKey[]).map(async key => {
    const entry = await store.readEnrollment({ leagueKey: key });
    return entry.status === 'ready' ? [[key, entry.enrollment.externalLeagueId] as const] : [];
  }));
  return Object.fromEntries(rows.flat());
});

export const getCurrentLeagueId = cache(async (key: LeagueKey): Promise<string> => {
  const store = getLeagueAdministrationStore();
  if (!store.enabled) return LEAGUE_IDS[key];
  const entry = await store.readEnrollment({ leagueKey: key });
  if (entry.status !== 'ready') throw new Error('The requested league registration is unavailable.');
  return entry.enrollment.externalLeagueId;
});

/** Route files retain permanent public keys while annual source IDs change in Neon. */
export async function resolveCurrentLeagueId(bootstrapId: string): Promise<string> {
  const key = (Object.keys(LEAGUE_IDS) as LeagueKey[]).find((candidate) => LEAGUE_IDS[candidate] === bootstrapId);
  if (!key) return bootstrapId;
  return getCurrentLeagueId(key);
}

export async function findCurrentLeagueKey(externalId: string): Promise<string | null> {
  const store = getLeagueAdministrationStore();
  if (!store.enabled) return bootstrapLeagueRegistry().listActiveLeagues()
    .find(league => String(league.leagueRef.externalId) === externalId)?.key ?? null;
  const entry = await store.readEnrollment({ provider: 'sleeper', externalLeagueId: externalId });
  if (entry.status === 'unavailable') throw new Error('The requested league registration is unavailable.');
  return entry.status === 'ready' ? entry.enrollment.leagueKey : null;
}
