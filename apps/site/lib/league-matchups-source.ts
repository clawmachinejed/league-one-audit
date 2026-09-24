import 'server-only';

import type { SiteWeekRollover } from '../components/use-site-week-rollover';
import type { CurrentStandings } from './current-standings';
import { resolveCurrentLeagueId } from './league-administration/registry';
import type { LeagueKey } from './leagues';
import { currentMatchupWeek, type MatchupPeriodContext } from './matchup-period';
import { readStoredMatchups } from './projection-reader';
import {
  getCurrentMatchupPeriodContext, getCurrentStandings, getOfficialMatchups, getSiteWeekRollover,
} from './sleeper';
import type { MatchupsData } from './types';

export interface LeagueMatchupsSource {
  leagueId: string;
  data: MatchupsData;
  periodContext: MatchupPeriodContext;
  snapshotRevision: string | null;
  verifiedAt: string | null;
  rollover: SiteWeekRollover | null;
  standings: CurrentStandings | null;
}

async function loadRollover(leagueId: string): Promise<SiteWeekRollover | null> {
  try { return await getSiteWeekRollover(leagueId); } catch { return null; }
}

async function loadCurrentStandings(leagueId: string): Promise<CurrentStandings | null> {
  try { return await getCurrentStandings(leagueId); } catch { return null; }
}

function contextForSelectedWeek(context: MatchupPeriodContext, week: number): MatchupPeriodContext {
  const currentWeek = currentMatchupWeek(context);
  return {
    ...context,
    temporalState: context.lifecycle === 'preseason' ? 'future'
      : context.lifecycle === 'complete' ? 'past'
        : week < currentWeek ? 'past' : week > currentWeek ? 'future' : 'active',
  };
}

/** The same exact-week snapshot and official fallback policy for every matchup view. */
export async function loadLeagueMatchups(
  leagueId: string, leagueKey: LeagueKey, requestedWeek?: number,
): Promise<LeagueMatchupsSource> {
  leagueId = await resolveCurrentLeagueId(leagueId);
  const [rollover, initialStored, standings] = await Promise.all([
    loadRollover(leagueId),
    readStoredMatchups(leagueKey, requestedWeek),
    loadCurrentStandings(leagueId),
  ]);
  let persisted = initialStored;
  let periodContext: MatchupPeriodContext | undefined = 'context' in persisted
    ? persisted.context : undefined;
  let selectedWeek = requestedWeek ?? rollover?.week;
  let storedWeek = requestedWeek ?? periodContext?.defaultWeek;
  if (requestedWeek === undefined && periodContext) {
    // Follow a rollover discovered by the first exact read, but bound retries.
    // A newer authority after this budget uses the latest week in official fallback.
    for (let reread = 0; reread < 2; reread += 1) {
      selectedWeek = rollover?.week ?? currentMatchupWeek(periodContext);
      if (selectedWeek === storedWeek) break;
      persisted = await readStoredMatchups(leagueKey, selectedWeek);
      storedWeek = selectedWeek;
      if ('context' in persisted && persisted.context) periodContext = persisted.context;
    }
    selectedWeek = rollover?.week ?? currentMatchupWeek(periodContext);
  }
  const authorityAgrees = !rollover || !periodContext || currentMatchupWeek(periodContext) === rollover.week;
  if (persisted.kind === 'usable' && authorityAgrees
    && (selectedWeek === undefined || persisted.payload.week === selectedWeek)) {
    return {
      leagueId, data: persisted.payload, periodContext: persisted.context,
      snapshotRevision: persisted.snapshotRevision, verifiedAt: persisted.verifiedAt, rollover, standings,
    };
  }

  if (!authorityAgrees) periodContext = undefined;
  if (!periodContext) {
    try {
      periodContext = await getCurrentMatchupPeriodContext(leagueId, selectedWeek);
    } catch {
      // The complete Sleeper matchup load below remains the final safe fallback.
    }
  }
  selectedWeek ??= periodContext ? currentMatchupWeek(periodContext) : undefined;
  const data = await getOfficialMatchups(leagueId, selectedWeek);
  periodContext ??= {
    defaultSeason: Number(data.league.season),
    defaultWeek: data.league.week,
    activeSeason: Number(data.league.season),
    activeWeek: data.league.week,
    lifecycle: 'active',
    nflPhase: 'unknown',
    temporalState: data.week < data.league.week ? 'past'
      : data.week > data.league.week ? 'future' : 'active',
    refreshDue: false,
  };
  return {
    leagueId, data, periodContext: contextForSelectedWeek(periodContext, data.week),
    snapshotRevision: null, verifiedAt: null, rollover, standings,
  };
}
