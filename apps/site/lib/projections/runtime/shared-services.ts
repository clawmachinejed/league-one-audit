import 'server-only';

import { randomUUID } from 'node:crypto';
import { LEAGUE_IDS } from '../../config';
import { LEAGUE_SITES, type LeagueKey } from '../../leagues';
import { FIRST_MATCHUP_WEEK, LAST_MATCHUP_WEEK } from '../../matchup-week';
import { createLeagueRegistry } from '../adapters/configuration/league-registry';
import type { ClockPort } from '../ports/clock';
import type { IdGeneratorPort } from '../ports/id-generator';
import type { LeagueRegistryPort } from '../ports/league-registry';
import type { ProjectionLoggerPort } from '../ports/logger';
import { externalLeagueRef, providerKey } from '../shared/provider-identity';

export const officialProvider = providerKey('sleeper');

/** Shared configuration and infrastructure only; never loads projection calculation or feeds. */
export function createProductionSharedServices(service: string): Readonly<{
  leagueRegistry: LeagueRegistryPort;
  clock: ClockPort;
  idGenerator: IdGeneratorPort;
  logger: ProjectionLoggerPort;
}> {
  return {
    leagueRegistry: createLeagueRegistry((Object.keys(LEAGUE_IDS) as LeagueKey[]).map((key) => ({
      key,
      displayName: LEAGUE_SITES[key].name,
      leagueRef: externalLeagueRef(officialProvider, LEAGUE_IDS[key]),
      matchupWeekRange: { firstWeek: FIRST_MATCHUP_WEEK, lastWeek: LAST_MATCHUP_WEEK },
    }))),
    clock: { now: () => new Date(), monotonicNow: () => performance.now() },
    idGenerator: { generate: randomUUID },
    logger: {
      write(level, context) {
        const entry = JSON.stringify({ service, ...context });
        if (level === 'error') console.error(entry);
        else if (level === 'warn') console.warn(entry);
        else console.info(entry);
      },
    },
  };
}
