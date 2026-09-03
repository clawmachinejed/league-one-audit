import type { LiveProjectionKind } from '../domain/live-calculation';
import type {
  LeagueWeekState,
  LineupSlot,
  OccupiedLineupSlot,
  ProjectionObservation,
  ProjectionSlate,
  ScoringEntity,
} from '../domain/contracts';
import type { ScoringEntityIdentityInput } from '../ports/identity-crosswalk';
import {
  externalReferenceKey,
  sameExternalReference,
  type ExternalScoringEntityRef,
} from '../shared/provider-identity';
import type { ActiveStarter, ProviderGroup } from './contracts';

export function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isEmptySlot(slot: LineupSlot): slot is Extract<LineupSlot, { kind: 'empty' }> {
  return slot.kind === 'empty';
}

export function isDefense(entity: ScoringEntity): boolean {
  return entity.kind === 'team-defense';
}

export function projectionKind(entity: ScoringEntity): LiveProjectionKind {
  if (entity.kind === 'team-defense') return 'defense';
  return entity.position.trim().toUpperCase() === 'K' ? 'kicker' : 'offense';
}

export function entityKind(entity: ScoringEntity): ScoringEntity['kind'] {
  return entity.kind;
}

export function entityKey(entity: ScoringEntity): string {
  return externalReferenceKey(entity.externalRef);
}

export function activeStarters(source: LeagueWeekState): ActiveStarter[] {
  return source.matchups.flatMap((matchup) => matchup.sides.flatMap((side) => side.starters
    .filter((slot): slot is OccupiedLineupSlot => slot.kind === 'occupied')
    .map((starter) => ({ rosterRef: side.rosterRef, starter }))));
}

export function projectionEntities(source: LeagueWeekState): ScoringEntity[] {
  const entities = new Map<string, ScoringEntity>();
  for (const entity of source.rosteredEntities) entities.set(entityKey(entity), entity);
  for (const { starter } of activeStarters(source)) {
    entities.set(entityKey(starter.entity), starter.entity);
  }
  return [...entities.values()];
}

export function assertUniqueStarters(starters: readonly ActiveStarter[]): void {
  const seen = new Set<string>();
  for (const { starter } of starters) {
    const key = entityKey(starter.entity);
    if (seen.has(key)) throw new Error('The league source returned a duplicate starter.');
    seen.add(key);
  }
}

function canonicalPosition(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'PK') return 'K';
  if (normalized === 'D/ST' || normalized === 'DST') return 'DEF';
  return normalized || null;
}

function observationReferences(observation: ProjectionObservation): readonly ExternalScoringEntityRef[] {
  return [observation.identity.primary, ...observation.identity.aliases];
}

function compatibleObservation(
  entity: ScoringEntity,
  observation: ProjectionObservation,
): boolean {
  if (entity.kind === 'team-defense') {
    return observation.identity.primary.entityKind === 'team-defense'
      && observation.nflTeam === entity.nflTeam;
  }
  return observation.identity.primary.entityKind === 'player'
    && entity.nflTeam !== null
    && observation.nflTeam === entity.nflTeam
    && canonicalPosition(observation.position) === canonicalPosition(entity.position);
}

/**
 * Resolves a provider observation only when both its explicit alias and current
 * football identity agree. Team defenses without a provider crosswalk may use
 * one unique canonical NFL-team match.
 */
export function projectionObservationForEntity(
  entity: ScoringEntity,
  slate: ProjectionSlate,
): ProjectionObservation | null {
  const direct = slate.projections.filter((observation) => (
    observationReferences(observation).some((reference) => (
      sameExternalReference(reference, entity.externalRef)
    )) && compatibleObservation(entity, observation)
  ));
  if (direct.length === 1) return direct[0];
  if (direct.length > 1 || entity.kind !== 'team-defense') return null;

  const byTeam = slate.projections.filter((observation) => compatibleObservation(entity, observation));
  return byTeam.length === 1 ? byTeam[0] : null;
}

/**
 * Resolves the provider identity independently from scoring eligibility. An
 * explicit provider crosswalk remains valid while a projection row carries
 * stale team or position metadata; the stricter scoring lookup above still
 * rejects that row until its football metadata agrees with the league source.
 */
function identityObservationForEntity(
  entity: ScoringEntity,
  slate: ProjectionSlate,
): ProjectionObservation | null {
  const direct = slate.projections.filter((observation) => (
    observationReferences(observation).some((reference) => (
      sameExternalReference(reference, entity.externalRef)
    ))
  ));
  if (direct.length === 1) return direct[0];
  if (direct.length > 1 || entity.kind !== 'team-defense') return null;

  const byTeam = slate.projections.filter((observation) => compatibleObservation(entity, observation));
  return byTeam.length === 1 ? byTeam[0] : null;
}

export function scoringIdentityInputs(
  group: ProviderGroup,
  projections: ProjectionSlate,
): ScoringEntityIdentityInput[] {
  const result = new Map<string, ScoringEntityIdentityInput>();
  for (const league of group.leagues) {
    for (const entity of projectionEntities(league.source)) {
      const key = entityKey(entity);
      if (result.has(key)) continue;
      const observation = identityObservationForEntity(entity, projections);
      const references = [
        entity.externalRef,
        ...(observation ? observationReferences(observation) : []),
      ];
      const providerRefs = [...new Map(references.map((reference) => [
        externalReferenceKey(reference),
        reference,
      ])).values()];
      result.set(key, { key, entity, providerRefs });
    }
  }
  return [...result.values()];
}

export function projectionStats(
  entity: ScoringEntity,
  result: ProjectionSlate,
): Readonly<Record<string, unknown>> {
  return projectionObservationForEntity(entity, result)?.stats ?? {};
}
