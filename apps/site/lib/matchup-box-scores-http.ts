import 'server-only';

import { LEAGUE_SITES } from './leagues';
import {
  MATCHUP_BOX_SCORE_STAT_KEYS, type AllPlayerBoxScoreIdentity, type MatchupBoxScores,
  type StoredAllPlayerBoxScores,
} from './matchup-box-score-types';
import { isNflTeam } from './nfl-teams';
import { readStoredMatchups } from './projection-reader';
import { getProjectionStore, type ProjectionStore } from './projection-store';
import type { MatchupsData } from './types';

const noStore = { 'Cache-Control': 'no-store' };
const statKeys = new Set<string>(MATCHUP_BOX_SCORE_STAT_KEYS);

function identitiesFor(data: MatchupsData): AllPlayerBoxScoreIdentity[] {
  const identities = new Map<string, AllPlayerBoxScoreIdentity>();
  for (const matchup of data.matchups) {
    for (const side of matchup.sides) {
      for (const player of [...side.starters, ...(side.bench ?? [])]) {
        if (player.id.startsWith('empty-')) continue;
        const defense = player.position === 'DEF';
        if (defense ? !isNflTeam(player.id) : !/^[1-9]\d{0,19}$/u.test(player.id)) {
          throw new Error('Invalid displayed box-score identity.');
        }
        const entityKind = defense ? 'team_defense' : 'player';
        const key = `${defense ? 'defense' : 'player'}:${player.id}`;
        identities.set(key, { entityKind, providerExternalId: player.id });
      }
    }
  }
  if (identities.size > 512) throw new Error('Invalid displayed box-score inventory.');
  return [...identities.values()];
}

function publicRead(read: StoredAllPlayerBoxScores, identities: readonly AllPlayerBoxScoreIdentity[]) {
  if (read.status === 'unavailable') {
    return { status: 'unavailable' as const, observedAt: null, revision: null, players: {} };
  }
  if (read.status !== 'available' || typeof read.observedAt !== 'string'
    || !Number.isFinite(Date.parse(read.observedAt))
    || typeof read.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(read.revision)) {
    throw new Error('Invalid stored box-score response.');
  }
  const players: MatchupBoxScores['players'] = {};
  for (const identity of identities) {
    const key = `${identity.entityKind === 'team_defense' ? 'defense' : 'player'}:${identity.providerExternalId}`;
    const player = read.players[key];
    if (!player) continue;
    if (player.gamePhase !== null && !['live', 'final', 'unknown'].includes(player.gamePhase)) {
      throw new Error('Invalid stored box-score phase.');
    }
    const stats = Object.fromEntries(Object.entries(player.stats).filter(([key, value]) => (
      statKeys.has(key) && typeof value === 'number' && Number.isFinite(value)
    )));
    if (Object.keys(stats).length) players[key] = { stats, gamePhase: player.gamePhase };
  }
  return { status: 'available' as const, observedAt: new Date(read.observedAt).toISOString(),
    revision: read.revision, players };
}

export async function handleMatchupBoxScoresRequest(
  request: Request,
  league: string,
  suppliedStore?: ProjectionStore,
  now?: Date,
): Promise<Response> {
  if (!Object.hasOwn(LEAGUE_SITES, league)) {
    return Response.json({ error: 'Unknown league.' }, { status: 404, headers: noStore });
  }
  const params = new URL(request.url).searchParams;
  const season = params.get('season');
  const weekText = params.get('week');
  if (params.getAll('season').length !== 1 || params.getAll('week').length !== 1
    || season === null || !/^\d{4}$/u.test(season) || Number(season) < 1920 || Number(season) > 2200
    || weekText === null || !/^(?:[1-9]|1[0-8])$/u.test(weekText)) {
    return Response.json({ error: 'A valid box-score season and week are required.' },
      { status: 400, headers: noStore });
  }
  const week = Number(weekText);
  const unavailable = (status = 200) => Response.json({
    leagueKey: league, season, week, status: 'unavailable', observedAt: null, revision: null, players: {},
  } satisfies MatchupBoxScores, { status, headers: noStore });
  const store = suppliedStore ?? getProjectionStore();
  if (!store.enabled || !store.readAllPlayerBoxScores) return unavailable();
  try {
    const selected = await readStoredMatchups(league, week, { store, now });
    if (selected.kind !== 'usable') return unavailable(503);
    if (selected.payload.league.season !== season || selected.context.defaultSeason !== Number(season)
      || selected.payload.week !== week || selected.payload.league.week !== week) {
      return unavailable(409);
    }
    // Future selections never borrow actual statistics from the current period.
    if (selected.context.temporalState === 'future') return unavailable();
    const identities = identitiesFor(selected.payload);
    if (identities.length === 0) return unavailable();
    const read = publicRead(await store.readAllPlayerBoxScores({
      season: Number(season), week, identities,
    }), identities);
    return Response.json({ leagueKey: league, season, week, ...read } satisfies MatchupBoxScores, {
      // Identity selection follows the accepted lineup, which can change between
      // taps. The browser already shares this bounded read for the whole board.
      headers: noStore,
    });
  } catch {
    return unavailable(503);
  }
}
