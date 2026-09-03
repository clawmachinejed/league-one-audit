import type { KickerProjectionStats, OffenseProjectionStats } from '../../domain/contracts';
import { canonicalNflTeam as canonicalTeam } from '../../../nfl-teams';
import {
  isRecord,
  nonEmptyText,
  nullRecord,
  Tank01ProviderFailure,
  type NormalizedCrosswalk,
  type NormalizedPlayerProjection,
  type NormalizedProjectionSlate,
  type Tank01DefenseProjection,
  type Tank01DefenseStats,
  type Tank01PlayerStats,
} from './projection-internals';

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueAt(record: Record<string, unknown> | null, field: string, path: string, missing: string[]): number | null {
  const value = record ? finiteNumber(record[field]) : null;
  if (value === null) missing.push(path);
  return value;
}

function playerStats(row: Record<string, unknown>): { stats: Tank01PlayerStats; missingFields: string[]; valueCount: number } {
  const missingFields: string[] = [];
  const passing = isRecord(row.Passing) ? row.Passing : null;
  const rushing = isRecord(row.Rushing) ? row.Rushing : null;
  const receiving = isRecord(row.Receiving) ? row.Receiving : null;
  const kicking = isRecord(row.Kicking) ? row.Kicking : null;
  const position = nonEmptyText(row.pos)?.toUpperCase();
  const isKicker = position === 'K' || position === 'PK';
  const validatePassing = !isKicker || passing !== null;
  const validateRushing = !isKicker || rushing !== null;
  const validateReceiving = !isKicker || receiving !== null;
  const validateMisc = !isKicker
    || Object.prototype.hasOwnProperty.call(row, 'twoPointConversion')
    || Object.prototype.hasOwnProperty.call(row, 'fumblesLost');
  // Tank01 documents Kicking as optional. Its absence is expected for non-kickers and must
  // remain unknown rather than being manufactured as four zeroes.
  const validateKicking = kicking !== null || isKicker;
  const positionValue = (
    record: Record<string, unknown> | null,
    field: string,
    path: string,
    validate: boolean,
  ): number | null => (validate ? valueAt(record, field, path, missingFields) : null);
  const kickingValue = (field: string, path: string): number | null => (
    validateKicking ? valueAt(kicking, field, path, missingFields) : null
  );
  const stats: Tank01PlayerStats = {
    passing: {
      attempts: positionValue(passing, 'passAttempts', 'Passing.passAttempts', validatePassing),
      completions: positionValue(passing, 'passCompletions', 'Passing.passCompletions', validatePassing),
      yards: positionValue(passing, 'passYds', 'Passing.passYds', validatePassing),
      touchdowns: positionValue(passing, 'passTD', 'Passing.passTD', validatePassing),
      interceptions: positionValue(passing, 'int', 'Passing.int', validatePassing),
    },
    rushing: {
      carries: positionValue(rushing, 'carries', 'Rushing.carries', validateRushing),
      yards: positionValue(rushing, 'rushYds', 'Rushing.rushYds', validateRushing),
      touchdowns: positionValue(rushing, 'rushTD', 'Rushing.rushTD', validateRushing),
    },
    receiving: {
      targets: positionValue(receiving, 'targets', 'Receiving.targets', validateReceiving),
      receptions: positionValue(receiving, 'receptions', 'Receiving.receptions', validateReceiving),
      yards: positionValue(receiving, 'recYds', 'Receiving.recYds', validateReceiving),
      touchdowns: positionValue(receiving, 'recTD', 'Receiving.recTD', validateReceiving),
    },
    kicking: {
      fieldGoalsMade: kickingValue('fgMade', 'Kicking.fgMade'),
      fieldGoalsMissed: kickingValue('fgMissed', 'Kicking.fgMissed'),
      extraPointsMade: kickingValue('xpMade', 'Kicking.xpMade'),
      extraPointsMissed: kickingValue('xpMissed', 'Kicking.xpMissed'),
    },
    twoPointConversions: positionValue(row, 'twoPointConversion', 'twoPointConversion', validateMisc),
    fumblesLost: positionValue(row, 'fumblesLost', 'fumblesLost', validateMisc),
  };
  const values = [
    ...Object.values(stats.passing),
    ...Object.values(stats.rushing),
    ...Object.values(stats.receiving),
    ...Object.values(stats.kicking),
    stats.twoPointConversions,
    stats.fumblesLost,
  ];
  return { stats, missingFields, valueCount: values.filter((value) => value !== null).length };
}

function defenseStats(row: Record<string, unknown>): { stats: Tank01DefenseStats; missingFields: string[]; valueCount: number } {
  const missingFields: string[] = [];
  const stats: Tank01DefenseStats = {
    returnTouchdowns: valueAt(row, 'returnTD', 'returnTD', missingFields),
    defensiveTouchdowns: valueAt(row, 'defTD', 'defTD', missingFields),
    safeties: valueAt(row, 'safeties', 'safeties', missingFields),
    fumbleRecoveries: valueAt(row, 'fumbleRecoveries', 'fumbleRecoveries', missingFields),
    pointsAllowed: valueAt(row, 'ptsAgainst', 'ptsAgainst', missingFields),
    interceptions: valueAt(row, 'interceptions', 'interceptions', missingFields),
    sacks: valueAt(row, 'sacks', 'sacks', missingFields),
    blockedKicks: valueAt(row, 'blockKick', 'blockKick', missingFields),
  };
  return { stats, missingFields, valueCount: 8 - missingFields.length };
}

function providerBody(envelope: unknown): unknown {
  if (!isRecord(envelope)) throw new Tank01ProviderFailure('invalid-response');
  if (Object.prototype.hasOwnProperty.call(envelope, 'error')
    && envelope.error !== undefined && envelope.error !== null && envelope.error !== '') {
    throw new Tank01ProviderFailure('provider-error');
  }
  const statusCode = finiteNumber(envelope.statusCode);
  if (statusCode !== 200 || !Object.prototype.hasOwnProperty.call(envelope, 'body')) {
    throw new Tank01ProviderFailure('invalid-response');
  }
  return envelope.body;
}

export function normalizeCrosswalk(envelope: unknown): NormalizedCrosswalk {
  const body = providerBody(envelope);
  if (!Array.isArray(body) || body.length === 0) throw new Tank01ProviderFailure('invalid-response');

  const candidates: Array<readonly [string, string]> = [];
  let malformedPlayerListRows = 0;
  for (const value of body) {
    if (!isRecord(value)) {
      malformedPlayerListRows += 1;
      continue;
    }
    const tank01PlayerId = nonEmptyText(value.playerID);
    const sleeperPlayerId = nonEmptyText(value.sleeperBotID);
    if (!tank01PlayerId || !sleeperPlayerId) {
      malformedPlayerListRows += 1;
      continue;
    }
    candidates.push([tank01PlayerId, sleeperPlayerId]);
  }

  const sleepersByTank01 = new Map<string, Set<string>>();
  const tank01BySleeper = new Map<string, Set<string>>();
  for (const [tank01PlayerId, sleeperPlayerId] of candidates) {
    const sleeperIds = sleepersByTank01.get(tank01PlayerId) ?? new Set<string>();
    sleeperIds.add(sleeperPlayerId);
    sleepersByTank01.set(tank01PlayerId, sleeperIds);
    const tank01Ids = tank01BySleeper.get(sleeperPlayerId) ?? new Set<string>();
    tank01Ids.add(tank01PlayerId);
    tank01BySleeper.set(sleeperPlayerId, tank01Ids);
  }

  const sleeperIdByTank01Id = nullRecord<string>();
  let ambiguousPlayerListRows = 0;
  for (const [tank01PlayerId, sleeperPlayerId] of candidates) {
    if (sleepersByTank01.get(tank01PlayerId)?.size !== 1 || tank01BySleeper.get(sleeperPlayerId)?.size !== 1) {
      ambiguousPlayerListRows += 1;
      continue;
    }
    sleeperIdByTank01Id[tank01PlayerId] = sleeperPlayerId;
  }
  if (Object.keys(sleeperIdByTank01Id).length === 0) throw new Tank01ProviderFailure('invalid-response');

  return {
    sleeperIdByTank01Id,
    playerListRows: body.length,
    malformedPlayerListRows,
    ambiguousPlayerListRows,
  };
}

function projectionId(mapKey: string, row: Record<string, unknown>): string | null {
  const keyId = nonEmptyText(mapKey);
  const rowId = nonEmptyText(row.playerID);
  if (keyId && rowId && keyId !== rowId) return null;
  return rowId ?? keyId;
}

export function normalizeProjectionSlate(envelope: unknown, fetchedAtMs: number): NormalizedProjectionSlate {
  const body = providerBody(envelope);
  if (!isRecord(body) || !isRecord(body.playerProjections) || !isRecord(body.teamDefenseProjections)) {
    throw new Tank01ProviderFailure('invalid-response');
  }

  const playerRows = Object.entries(body.playerProjections);
  const defenseRows = Object.entries(body.teamDefenseProjections);
  if (playerRows.length + defenseRows.length === 0) throw new Tank01ProviderFailure('invalid-response');

  const playersByTank01Id = nullRecord<NormalizedPlayerProjection>();
  const duplicatePlayerIds = new Set<string>();
  let malformedPlayerProjections = 0;
  let incompletePlayerProjections = 0;
  for (const [key, value] of playerRows) {
    if (!isRecord(value)) {
      malformedPlayerProjections += 1;
      continue;
    }
    const tank01PlayerId = projectionId(key, value);
    const normalized = playerStats(value);
    if (!tank01PlayerId || normalized.valueCount === 0 || duplicatePlayerIds.has(tank01PlayerId)) {
      malformedPlayerProjections += 1;
      continue;
    }
    if (playersByTank01Id[tank01PlayerId]) {
      delete playersByTank01Id[tank01PlayerId];
      duplicatePlayerIds.add(tank01PlayerId);
      malformedPlayerProjections += 2;
      continue;
    }
    if (normalized.missingFields.length > 0) incompletePlayerProjections += 1;
    const position = nonEmptyText(value.pos)?.toUpperCase() ?? null;
    const isKicker = position === 'K' || position === 'PK';
    const scoringProjection: OffenseProjectionStats | KickerProjectionStats = isKicker
      ? {
          kind: 'kicker',
          fieldGoalsMade: normalized.stats.kicking.fieldGoalsMade,
          fieldGoalsMissed: normalized.stats.kicking.fieldGoalsMissed,
          extraPointsMade: normalized.stats.kicking.extraPointsMade,
          extraPointsMissed: normalized.stats.kicking.extraPointsMissed,
        }
      : {
          kind: 'offense',
          passingYards: normalized.stats.passing.yards,
          passingTouchdowns: normalized.stats.passing.touchdowns,
          passingInterceptions: normalized.stats.passing.interceptions,
          rushingYards: normalized.stats.rushing.yards,
          rushingTouchdowns: normalized.stats.rushing.touchdowns,
          receptions: normalized.stats.receiving.receptions,
          receivingYards: normalized.stats.receiving.yards,
          receivingTouchdowns: normalized.stats.receiving.touchdowns,
          twoPointConversions: normalized.stats.twoPointConversions,
          fumblesLost: normalized.stats.fumblesLost,
        };
    playersByTank01Id[tank01PlayerId] = {
      tank01PlayerId,
      team: canonicalTeam(value.team),
      position,
      stats: normalized.stats,
      scoringProjection,
      missingFields: normalized.missingFields,
    };
  }

  const defensesByTeam = nullRecord<Tank01DefenseProjection>();
  const duplicateDefenseTeams = new Set<string>();
  let malformedDefenseProjections = 0;
  let incompleteDefenseProjections = 0;
  for (const [key, value] of defenseRows) {
    if (!isRecord(value)) {
      malformedDefenseProjections += 1;
      continue;
    }
    const keyTeam = canonicalTeam(key);
    const rowTeam = canonicalTeam(value.teamAbv);
    const team = rowTeam ?? keyTeam;
    const normalized = defenseStats(value);
    if (!team || (keyTeam && rowTeam && keyTeam !== rowTeam) || normalized.valueCount === 0
      || duplicateDefenseTeams.has(team)) {
      malformedDefenseProjections += 1;
      continue;
    }
    if (defensesByTeam[team]) {
      delete defensesByTeam[team];
      duplicateDefenseTeams.add(team);
      malformedDefenseProjections += 2;
      continue;
    }
    if (normalized.missingFields.length > 0) incompleteDefenseProjections += 1;
    defensesByTeam[team] = {
      team,
      stats: normalized.stats,
      scoringProjection: {
        kind: 'defense',
        sacks: normalized.stats.sacks,
        interceptions: normalized.stats.interceptions,
        fumbleRecoveries: normalized.stats.fumbleRecoveries,
        defensiveTouchdowns: normalized.stats.defensiveTouchdowns,
        specialTeamsTouchdowns: normalized.stats.returnTouchdowns,
        safeties: normalized.stats.safeties,
        blockedKicks: normalized.stats.blockedKicks,
        pointsAllowed: normalized.stats.pointsAllowed,
      },
      missingFields: normalized.missingFields,
    };
  }

  if (Object.keys(playersByTank01Id).length + Object.keys(defensesByTeam).length === 0) {
    throw new Tank01ProviderFailure('invalid-response');
  }

  return {
    fetchedAtMs,
    playersByTank01Id,
    defensesByTeam,
    playerProjectionRows: playerRows.length,
    malformedPlayerProjections,
    incompletePlayerProjections,
    defenseProjectionRows: defenseRows.length,
    malformedDefenseProjections,
    incompleteDefenseProjections,
  };
}

