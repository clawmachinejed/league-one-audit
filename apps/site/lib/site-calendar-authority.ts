import 'server-only';

import { cache } from 'react';
import { findCurrentLeagueKey } from './league-administration/registry';
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

async function validatedStoredCalendar(leagueId: string) {
  const leagueKey = await findCurrentLeagueKey(leagueId);
  if (!leagueKey) {
    throw new Error('Site calendar proposal has an invalid league or period.');
  }
  const rows = await readStoredCalendarFloor(leagueKey);
  if (rows === null || (Array.isArray(rows) && rows.length === 0)) return null;
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || rows[0].leagueKey !== leagueKey
    || !['available', 'missing'].includes(rows[0].kind)) {
    throw new Error('Stored site calendar authority is malformed.');
  }
  const row: StoredLeagueAuthorityRead = rows[0];
  if (row.kind === 'missing') return null;
  if (row.kind !== 'available') throw new Error('Stored site calendar authority is malformed.');
  const stored = row.authority;
  if (!stored || stored.leagueKey !== leagueKey || stored.sourceProvider !== 'sleeper'
    || stored.lineupShape?.sourceExternalLeagueId !== leagueId) {
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
  return stored;
}

/** Display-only recovery: retained authority may be old, but cannot invent a new period. */
export async function getRetainedSiteCalendar(leagueId: string, season: number): Promise<{
  week: number; lifecycle: SiteCalendarProposal['lifecycle'];
} | null> {
  if (!validSeason(season)) throw new Error('Site calendar proposal has an invalid league or period.');
  const stored = await validatedStoredCalendar(leagueId);
  if (!stored || stored.defaultSeason !== season) return null;
  return { week: Math.max(stored.defaultWeek, stored.activeWeek ?? stored.defaultWeek),
    lifecycle: stored.leagueLifecycle };
}

/** A retained period remains a monotonic floor without becoming fresh authority. */
export async function assertSiteCalendarNotRegressed(proposal: SiteCalendarProposal): Promise<void> {
  if (!validSeason(proposal.season) || !validWeek(proposal.week)
    || !Object.hasOwn(lifecycleOrder, proposal.lifecycle)) {
    throw new Error('Site calendar proposal has an invalid league or period.');
  }
  const stored = await validatedStoredCalendar(proposal.leagueId);
  if (!stored) return;
  if (stored.defaultSeason > proposal.season
    || (stored.defaultSeason === proposal.season
      && (stored.defaultWeek > proposal.week || (stored.activeWeek !== null && stored.activeWeek > proposal.week)
        || lifecycleOrder[stored.leagueLifecycle] > lifecycleOrder[proposal.lifecycle]))) {
    throw new Error('NFL schedule conflicts with the previously accepted site calendar; a backward week change was rejected.');
  }
}
