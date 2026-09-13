import 'server-only';

import { LEAGUE_IDS } from './config';
import { LEAGUE_SITES, type LeagueKey } from './leagues';
import { getProjectionStore, type StoredAllPlayerMetricRead } from './projection-store';
import { scoreSparseStatistics } from './projections/domain/scoring';
import { getRostersWithMetricContext, type RostersLoad } from './sleeper';
import type { RostersData } from './types';

const responseHeaders = { 'Cache-Control': 'private, no-store' };

function isLeagueKey(value: string): value is LeagueKey {
  return Object.hasOwn(LEAGUE_SITES, value);
}

type LoadRosters = (leagueId: string, week: number) => Promise<RostersLoad>;
type LoadMetrics = (input: Readonly<{
  leagueKey: LeagueKey;
  season: number;
  throughWeek: number;
  provisionalWeek: number | null;
}>) => Promise<StoredAllPlayerMetricRead>;

async function loadPlayerMetrics(input: Parameters<LoadMetrics>[0]): Promise<StoredAllPlayerMetricRead> {
  return getProjectionStore().readAllPlayerPlayerMetrics({
    leagueKey: input.leagueKey,
    provider: 'sleeper',
    season: input.season,
    seasonType: 'reg',
    throughWeek: input.throughWeek,
    provisionalWeek: input.provisionalWeek,
    scorerVersion: 'sleeper-actual-v1',
  }, scoreSparseStatistics);
}

function applyPlayerMetrics(data: RostersData, read: StoredAllPlayerMetricRead): RostersData {
  const byIdentity = new Map(read.metrics.map((metric) => [
    `${metric.entityKind}:${metric.providerExternalId}`,
    metric,
  ]));
  return {
    ...data,
    playerMetrics: {
      status: read.status,
      observedAt: read.observedAt,
      throughWeek: read.throughWeek,
    },
    teams: data.teams.map((team) => ({
      ...team,
      sections: team.sections.map((section) => ({
        ...section,
        players: section.players.map((player) => {
          const kind = player.position === 'DEF' ? 'team_defense' : 'player';
          const metric = byIdentity.get(`${kind}:${player.id}`);
          const valid = metric?.position === player.position;
          return {
            ...player,
            positionRank: valid ? metric.positionRank : null,
            ppg: valid ? metric.pointsPerGame : null,
          };
        }),
      })),
    })),
  };
}

export async function handleLeagueRostersRequest(
  request: Request,
  league: string,
  loadRosters: LoadRosters = getRostersWithMetricContext,
  loadMetrics: LoadMetrics = loadPlayerMetrics,
): Promise<Response> {
  if (!isLeagueKey(league)) {
    return Response.json({ error: 'Unknown league.' }, { status: 404, headers: responseHeaders });
  }
  const scopedHeaders = { ...responseHeaders, 'X-Roster-League': league };
  const rawWeek = new URL(request.url).searchParams.get('week');
  if (rawWeek === null || !/^\d{1,2}$/u.test(rawWeek)) {
    return Response.json({ error: 'A valid roster week is required.' }, { status: 400, headers: responseHeaders });
  }
  const week = Number(rawWeek);
  if (!Number.isInteger(week) || week < 1 || week > 18) {
    return Response.json({ error: 'A valid roster week is required.' }, { status: 400, headers: responseHeaders });
  }
  try {
    const loaded = await loadRosters(LEAGUE_IDS[league], week);
    const boundary = loaded.metricContext;
    // The active metric week can differ from the public default display week.
    // Retain this scope even when the database metric read is unavailable.
    const metricHeaders = { ...scopedHeaders,
      'X-Roster-Provisional-Week': !boundary.activeWeekKnown ? 'unknown'
        : boundary.provisionalWeek === null ? 'none' : String(boundary.provisionalWeek) };
    if (boundary.season === null || boundary.throughWeek === null) {
      return Response.json(loaded.data, { headers: metricHeaders });
    }
    try {
      const metrics = await loadMetrics({
        leagueKey: league,
        season: boundary.season,
        throughWeek: boundary.throughWeek,
        provisionalWeek: boundary.provisionalWeek,
      });
      return Response.json(applyPlayerMetrics(loaded.data, metrics), { headers: metricHeaders });
    } catch {
      return Response.json(loaded.data, { headers: metricHeaders });
    }
  } catch {
    return Response.json(
      { error: 'League rosters are temporarily unavailable. Please try again.' },
      { status: 503, headers: responseHeaders },
    );
  }
}
