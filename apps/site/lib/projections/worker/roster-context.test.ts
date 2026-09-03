import { describe, expect, it } from 'vitest';
import type {
  LeagueWeekState,
  ProjectionObservation,
  ProjectionSlate,
  ScoringEntity,
} from '../domain/contracts';
import {
  externalReferenceKey,
  externalLeagueRef,
  externalPlayerRef,
  externalMatchupRef,
  externalRosterRef,
  externalTeamDefenseRef,
  providerKey,
} from '../shared/provider-identity';
import type { ProviderGroup } from './contracts';
import {
  activeStarters,
  assertUniqueStarters,
  projectionEntities,
  projectionKind,
  projectionObservationForEntity,
  projectionStats,
  scoringIdentityInputs,
} from './roster-context';

const official = providerKey('official-source');
const projectionProvider = providerKey('projection-source');
const leagueRef = externalLeagueRef(official, 'league-1');
const rosterOne = externalRosterRef(leagueRef, '1');
const rosterTwo = externalRosterRef(leagueRef, '2');
const period = { season: 2026, seasonType: 'regular' as const, week: 1 };

function player(
  id: string,
  overrides: Partial<ScoringEntity> = {},
): ScoringEntity {
  return {
    kind: 'player',
    externalRef: externalPlayerRef(official, id),
    displayName: `Player ${id}`,
    nflTeam: 'KC',
    position: 'RB',
    injuryStatus: null,
    ...overrides,
  } as ScoringEntity;
}

const starterCopy = player('p1', { displayName: 'Starter Copy' });
const benchCopy = player('p1', { displayName: 'Bench Copy' });
const defense: ScoringEntity = {
  kind: 'team-defense',
  externalRef: externalTeamDefenseRef(official, 'JAX'),
  displayName: 'JAX Defense',
  nflTeam: 'JAX',
  position: 'DEF',
  injuryStatus: null,
};

function leagueSource(): LeagueWeekState {
  return {
    configuration: { key: 'league', displayName: 'League', leagueRef, matchupWeekRange: { firstWeek: 1, lastWeek: 18 } },
    lineupShape: { expectedRosterCount: 2, expectedStarterSlotCount: 3, expectedRosterRefs: [rosterOne, rosterTwo] },
    leagueName: 'League',
    period,
    maxWeek: 18,
    rosterPositions: ['RB', 'FLEX', 'DEF'],
    participants: [],
    matchups: [{
      matchupRef: externalMatchupRef(leagueRef, period, '1'),
      status: 'upcoming',
      sides: [
        {
          rosterRef: rosterOne,
          officialPoints: 0,
          starters: [
            { kind: 'occupied', slot: 'RB', entity: starterCopy, officialPoints: 0 },
            { kind: 'empty', slot: 'FLEX' },
            { kind: 'occupied', slot: 'DEF', entity: defense, officialPoints: 0 },
          ],
        },
        {
          rosterRef: rosterTwo,
          officialPoints: 0,
          starters: [{
            kind: 'occupied',
            slot: 'RB',
            entity: player('p2', { nflTeam: 'LAC' }),
            officialPoints: 0,
          }],
        },
      ],
    }],
    rosteredEntities: [benchCopy, player('bench'), defense],
    schedule: {},
    scoringSettings: { provider: official, rawRules: { rush_yd: 0.1 } },
    requestStartedAt: '2026-09-01T00:00:00.000Z',
    requestCompletedAt: '2026-09-01T00:00:01.000Z',
    observedAt: '2026-09-01T00:00:01.000Z',
    sourceRevision: 'source-revision',
    lineup: { revisionVersion: 'lineup-v1', lineupRevision: '1'.repeat(64) },
  };
}

function observation(
  entity: ScoringEntity,
  overrides: Partial<ProjectionObservation> = {},
): ProjectionObservation {
  const externalId = String(entity.externalRef.externalId);
  return {
    identity: {
      primary: entity.kind === 'team-defense'
        ? externalTeamDefenseRef(projectionProvider, externalId)
        : externalPlayerRef(projectionProvider, `tank-${externalId}`),
      aliases: [entity.externalRef],
    },
    nflTeam: entity.nflTeam,
    position: entity.position,
    stats: { raw: externalId },
    scoringStats: entity.kind === 'team-defense'
      ? { kind: 'defense', sacks: 2 }
      : { kind: 'offense', rushingYards: 80 },
    missingFields: [],
    ...overrides,
  };
}

function slate(projections: readonly ProjectionObservation[]): ProjectionSlate {
  return {
    source: projectionProvider,
    period,
    quality: 'complete',
    requestStartedAt: '2026-09-01T00:00:00.000Z',
    requestCompletedAt: '2026-09-01T00:00:01.000Z',
    observedAt: '2026-09-01T00:00:01.000Z',
    sourceRevision: 'projection-revision',
    projections,
    coverage: {
      crosswalkRows: 2,
      crosswalkEntries: 2,
      malformedCrosswalkRows: 0,
      ambiguousCrosswalkRows: 0,
      playerRows: 2,
      matchedPlayers: 2,
      unmatchedPlayers: 0,
      malformedPlayers: 0,
      incompletePlayers: 0,
      defenseRows: 1,
      usableDefenses: 1,
      malformedDefenses: 0,
      incompleteDefenses: 0,
    },
    warnings: [],
  };
}

describe('canonical worker roster context', () => {
  it('preserves starter order, excludes empty slots, and lets starter metadata refresh roster metadata', () => {
    const source = leagueSource();
    expect(activeStarters(source).map(({ rosterRef, starter }) => [
      rosterRef.externalId,
      starter.entity.externalRef.externalId,
    ])).toEqual([
      ['1', 'p1'],
      ['1', 'JAX'],
      ['2', 'p2'],
    ]);
    expect(projectionEntities(source).map((entity) => [entity.externalRef.externalId, entity.displayName]))
      .toEqual([
        ['p1', 'Starter Copy'],
        ['bench', 'Player bench'],
        ['JAX', 'JAX Defense'],
        ['p2', 'Player p2'],
      ]);
    expect(projectionKind(starterCopy)).toBe('offense');
    expect(projectionKind({ ...starterCopy, position: 'K' })).toBe('kicker');
    expect(projectionKind(defense)).toBe('defense');
  });

  it('rejects the same provider-scoped entity in more than one starter slot', () => {
    const source = leagueSource();
    const duplicate = {
      ...source,
      matchups: [{
        ...source.matchups[0],
        sides: [
          source.matchups[0].sides[0],
          {
            ...source.matchups[0].sides[1],
            starters: [{ kind: 'occupied' as const, slot: 'RB', entity: starterCopy, officialPoints: 0 }],
          },
        ],
      }],
    };
    expect(() => assertUniqueStarters(activeStarters(duplicate))).toThrow('duplicate starter');
  });

  it('requires alias, team, and position agreement before accepting a player projection', () => {
    const valid = observation(starterCopy);
    const wrongTeam = observation(starterCopy, { nflTeam: 'BUF' });
    const wrongPosition = observation(starterCopy, { position: 'WR' });

    expect(projectionObservationForEntity(starterCopy, slate([valid]))).toBe(valid);
    expect(projectionObservationForEntity(starterCopy, slate([wrongTeam]))).toBeNull();
    expect(projectionObservationForEntity(starterCopy, slate([wrongPosition]))).toBeNull();
    expect(projectionStats(starterCopy, slate([valid]))).toBe(valid.stats);
  });

  it('retains an explicit provider identity across stale football metadata without scoring it', () => {
    const staleObservation = observation(starterCopy, { nflTeam: 'BUF', position: 'WR' });
    const group: ProviderGroup = {
      period,
      leagues: [{ configuration: leagueSource().configuration, source: leagueSource(), cadence: 'hourly' }],
    };

    expect(projectionObservationForEntity(starterCopy, slate([staleObservation]))).toBeNull();
    expect(scoringIdentityInputs(group, slate([staleObservation])))
      .toContainEqual(expect.objectContaining({
        key: externalReferenceKey(starterCopy.externalRef),
        providerRefs: [starterCopy.externalRef, staleObservation.identity.primary],
      }));
  });

  it('links one unaliased team-defense observation by canonical NFL team without inventing an alias', () => {
    const defenseObservation = observation(defense, { identity: {
      primary: externalTeamDefenseRef(projectionProvider, 'JAX'),
      aliases: [],
    } });
    const result = projectionObservationForEntity(defense, slate([defenseObservation]));
    expect(result).toBe(defenseObservation);

    const group: ProviderGroup = {
      period,
      leagues: [{ configuration: leagueSource().configuration, source: leagueSource(), cadence: 'hourly' }],
    };
    const inputs = scoringIdentityInputs(group, slate([
      observation(starterCopy),
      defenseObservation,
    ]));
    const defenseInput = inputs.find((input) => input.entity.kind === 'team-defense');
    expect(defenseInput?.providerRefs).toEqual([
      defense.externalRef,
      defenseObservation.identity.primary,
    ]);
  });

  it('fails closed when multiple unaliased defense observations claim the same NFL team', () => {
    const first = observation(defense, { identity: {
      primary: externalTeamDefenseRef(projectionProvider, 'JAX-a'),
      aliases: [],
    } });
    const second = observation(defense, { identity: {
      primary: externalTeamDefenseRef(projectionProvider, 'JAX-b'),
      aliases: [],
    } });
    expect(projectionObservationForEntity(defense, slate([first, second]))).toBeNull();
  });
});
