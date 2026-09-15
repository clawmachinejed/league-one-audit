import 'server-only';

import { cache } from 'react';
import { LEAGUE_IDS } from './config';
import { getProjectionStore, type StoredLeagueAuthorityRead } from './projection-store';

type SiteCalendarProposal = Readonly<{
  leagueId: string;
  season: number;
  week: number;
  lifecycle: 'preseason' | 'active' | 'complete';
}>;

const lifecycleOrder = { preseason: 0, active: 1, complete: 2 } as const;
const validSeason = (value: number) => Number.isInteger(value) && value >= 1920 && value <= 2200;
const validWeek = (value: number) => Number.isInteger(value) && value >= 1 && value <= 18;

/** One existing compact authority read per league/render; no provider access or writes. */
const readStoredCalendarFloor = cache(async (leagueKey: string): Promise<readonly StoredLeagueAuthorityRead[] | null> => {
  try {
    const store = getProjectionStore();
    if (!store.enabled) return null;
    return await store.readLeagueLineupAuthorities([leagueKey]);
  } catch {
    // Persistence outages must retain the existing official-source fallback.
    // Missing proof is not evidence that a proposed period has regressed.
    return null;
  }
});

/**
 * A stored period is a monotonic floor, even when too old to serve as fresh
 * operational authority. It never substitutes for the current schedule policy.
 */
export async function assertSiteCalendarNotRegressed(proposal: SiteCalendarProposal): Promise<void> {
  const registration = Object.entries(LEAGUE_IDS).find(([, leagueId]) => leagueId === proposal.leagueId);
  if (!registration || !validSeason(proposal.season) || !validWeek(proposal.week)
    || !Object.hasOwn(lifecycleOrder, proposal.lifecycle)) {
    throw new Error('Site calendar proposal has an invalid league or period.');
  }
  const [leagueKey] = registration;
  const rows = await readStoredCalendarFloor(leagueKey);
  if (rows === null || (Array.isArray(rows) && rows.length === 0)) return;
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || rows[0].leagueKey !== leagueKey
    || !['available', 'missing'].includes(rows[0].kind)) {
    throw new Error('Stored site calendar authority is malformed.');
  }
  const row: StoredLeagueAuthorityRead = rows[0];
  if (row.kind === 'missing') return;
  if (row.kind !== 'available') throw new Error('Stored site calendar authority is malformed.');
  const stored = row.authority;
  if (!stored || stored.leagueKey !== leagueKey || stored.sourceProvider !== 'sleeper'
    || stored.lineupShape?.sourceExternalLeagueId !== proposal.leagueId) {
    throw new Error('Stored site calendar authority conflicts with the selected league identity.');
  }
  const active = stored.leagueLifecycle === 'active';
  if (!validSeason(stored.defaultSeason) || !validWeek(stored.defaultWeek)
    || stored.defaultSeasonType !== 'reg' || !Object.hasOwn(lifecycleOrder, stored.leagueLifecycle)
    || (active ? stored.activeSeason !== stored.defaultSeason || stored.activeSeasonType !== 'reg'
      || stored.activeWeek === null || !validWeek(stored.activeWeek)
      : stored.activeSeason !== null || stored.activeSeasonType !== null || stored.activeWeek !== null)) {
    throw new Error('Stored site calendar authority has an invalid period.');
  }
  if (stored.defaultSeason > proposal.season
    || (stored.defaultSeason === proposal.season
      && (stored.defaultWeek > proposal.week || (stored.activeWeek !== null && stored.activeWeek > proposal.week)
        || lifecycleOrder[stored.leagueLifecycle] > lifecycleOrder[proposal.lifecycle]))) {
    throw new Error('NFL schedule conflicts with the previously accepted site calendar; a backward week change was rejected.');
  }
}
