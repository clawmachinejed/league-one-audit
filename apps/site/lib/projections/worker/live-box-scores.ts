import type { LeagueWeekState, GameStateSlate } from '../domain/contracts';
import type { LiveDefenseStatResult } from '../ports/live-defense-stat-source';
import { buildLiveBoxScoreEvidence } from '../shared/live-box-score-evidence';
import { activeStarters, availableBench } from './roster-context';
import { stateForEntity, MAX_SOURCE_SKEW_MS } from './game-context';

/** Descriptive evidence from the same bulk request; never a score or eligibility input. */
export function liveBoxScoresForLeague(source: LeagueWeekState, games: GameStateSlate,
  result: LiveDefenseStatResult | undefined) {
  if (result?.status !== 'available') return null;
  const capture = result.capture;
  if (!capture.bodyHash || !capture.boxScoreRows
    || capture.period.season !== source.period.season
    || capture.period.week !== source.period.week
    || capture.period.seasonType !== source.period.seasonType) return null;
  const rows = capture.boxScoreRows;
  const times = [source.requestCompletedAt, games.requestCompletedAt,
    capture.requestStartedAt, capture.requestCompletedAt].map(Date.parse);
  if (times.some(time => !Number.isFinite(time))
    || Math.max(...times) - Math.min(...times) > MAX_SOURCE_SKEW_MS) return null;
  const entries = [...activeStarters(source), ...availableBench(source)].flatMap(({ starter }) => {
    const entity = starter.entity;
    if (entity.externalRef.provider !== source.configuration.leagueRef.provider) return [];
    const entityKind = entity.kind === 'team-defense' ? 'team_defense' as const : 'player' as const;
    const providerExternalId = String(entity.externalRef.externalId);
    const stats = rows[`${entityKind === 'team_defense' ? 'defense' : 'player'}:${providerExternalId}`];
    if (!stats || Object.keys(stats).length === 0) return [];
    const game = stateForEntity(entity, games, source.schedule);
    // A scheduled, bye or unmapped game cannot be relabeled as live from stats alone.
    if (!game || ![1, 2, 4].includes(game.statusCode)) return [];
    return [{ entityKind, providerExternalId,
      gamePhase: game.statusCode === 2 ? 'final' as const : game.statusCode === 1 ? 'live' as const : 'unknown' as const,
      stats }];
  });
  try {
    return buildLiveBoxScoreEvidence({ period: source.period, sourceRevision: capture.sourceRevision,
      bodyHash: capture.bodyHash, requestStartedAt: capture.requestStartedAt,
      requestCompletedAt: capture.requestCompletedAt, observedAt: capture.observedAt, entries });
  } catch {
    // Invalid optional details stay unavailable without changing official matchup results.
    return null;
  }
}
