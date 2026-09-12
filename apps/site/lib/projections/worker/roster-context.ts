import type { LiveProjectionKind } from '../domain/live-calculation';
import { NFL_TEAM_CODES } from '../domain/contracts';
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
  externalPlayerRef,
  externalReferenceKey,
  externalTeamDefenseRef,
  sameExternalReference,
  type ProviderKey,
  type ExternalScoringEntityRef,
} from '../shared/provider-identity';
import type { ActiveStarter, ProviderGroup } from './contracts';
import { projectionIdentityQuarantined } from '../shared/reviewed-projection-identities';
export { projectionIdentityQuarantined } from '../shared/reviewed-projection-identities';

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

export function canonicalPosition(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'PK') return 'K';
  if (normalized === 'D/ST' || normalized === 'DST') return 'DEF';
  return normalized || null;
}

const ALL_PROJECTION_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K']);

/** Required official roster identities remain a fallback for adapters that do
 * not supply a full catalog. Optional projections never become this inventory. */
export function officialIdentityInventory(group: ProviderGroup): ScoringEntity[] {
  const entities = new Map<string, ScoringEntity>();
  for (const league of group.leagues) {
    for (const entity of [...(league.source.officialIdentityInventory ?? []), ...projectionEntities(league.source)]) {
      const key = entityKey(entity);
      const previous = entities.get(key);
      if (previous && previous.kind !== entity.kind) {
        throw new Error('Official identity inventory contains conflicting entity kinds.');
      }
      entities.set(key, entity);
    }
  }
  return [...entities.values()];
}

/**
 * Gives every safely cross-walked fantasy projection one canonical official
 * identity. Unmatched source rows remain in immutable slate content but cannot
 * become candidates until the existing crosswalk proves their identity.
 */
export function projectionEntityForObservation(
  observation: ProjectionObservation,
  officialProvider: ProviderKey,
  officialInventory: readonly ScoringEntity[] = [],
): ScoringEntity | null {
  if (projectionIdentityQuarantined(observation)) return null;
  if (observation.identity.primary.entityKind === 'team-defense') {
    if (!observation.nflTeam || !NFL_TEAM_CODES.includes(observation.nflTeam)) return null;
    const officialDefenseRefs = observationReferences(observation)
      .filter((reference) => reference.provider === officialProvider);
    if (observationReferences(observation).some((reference) => reference.entityKind !== 'team-defense')
      || officialDefenseRefs.length > 1
      || officialDefenseRefs.some((reference) => String(reference.externalId) !== observation.nflTeam)) return null;
    return {
      kind: 'team-defense',
      externalRef: externalTeamDefenseRef(officialProvider, observation.nflTeam),
      displayName: `${observation.nflTeam} D/ST`,
      nflTeam: observation.nflTeam,
      position: 'DEF',
      injuryStatus: null,
    };
  }
  const officialRefs = observationReferences(observation).filter((reference) => (
    reference.provider === officialProvider
  ));
  if (officialRefs.length !== 1 || officialRefs[0].entityKind !== 'player') return null;
  const officialRef = externalPlayerRef(officialProvider, String(officialRefs[0].externalId));
  const matches = officialInventory.filter((entity) => sameExternalReference(entity.externalRef, officialRef));
  if (matches.length !== 1 || matches[0].kind !== 'player') return null;
  const position = canonicalPosition(matches[0].position);
  if (!position || !ALL_PROJECTION_POSITIONS.has(position)) return null;
  return { ...matches[0], position };
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
      && observation.nflTeam === entity.nflTeam
      && projectionEntityForObservation(observation, entity.externalRef.provider) !== null;
  }
  return observation.identity.primary.entityKind === 'player'
    && entity.nflTeam !== null
    && observation.nflTeam === entity.nflTeam
    && (canonicalPosition(observation.position) === canonicalPosition(entity.position)
      || canonicalPosition(observation.position) === 'FB'
        && ['RB', 'TE'].includes(canonicalPosition(entity.position) ?? ''));
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
    !projectionIdentityQuarantined(observation)
    && observationReferences(observation).filter((reference) => reference.provider === entity.externalRef.provider
      && reference.entityKind === entity.externalRef.entityKind).length === 1
    &&
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
    !projectionIdentityQuarantined(observation)
    && observationReferences(observation).filter((reference) => reference.provider === entity.externalRef.provider
      && reference.entityKind === entity.externalRef.entityKind).length === 1
    &&
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
  const officialProviders = new Set(group.leagues.map((league) => (
    league.configuration.leagueRef.provider
  )));
  if (officialProviders.size !== 1) {
    throw new Error('Provider-group leagues do not share one official identity provider.');
  }
  const officialProvider = [...officialProviders][0];
  if (!officialProvider) throw new Error('The official identity provider is unavailable.');
  const groupEntityByKey = new Map<string, ScoringEntity>();
  for (const league of group.leagues) {
    for (const entity of projectionEntities(league.source)) {
      groupEntityByKey.set(entityKey(entity), entity);
    }
  }
  const groupEntities = [...groupEntityByKey.values()];
  const inventory = officialIdentityInventory(group);
  const existingEntityByObservation = new Map<ProjectionObservation, ScoringEntity>();
  for (const entity of groupEntities) {
    const observation = identityObservationForEntity(entity, projections);
    if (observation && !existingEntityByObservation.has(observation)) {
      existingEntityByObservation.set(observation, entity);
    }
  }
  for (const observation of projections.projections) {
    const existingEntity = existingEntityByObservation.get(observation);
    const entity = existingEntity
      ? existingEntity
      : projectionEntityForObservation(observation, officialProvider, inventory);
    if (!entity) continue;
    const references = [entity.externalRef, ...observationReferences(observation)];
    const providerRefs = [...new Map(references.map((reference) => [
      externalReferenceKey(reference), reference,
    ])).values()];
    const key = entityKey(entity);
    result.set(key, {
      key, entity, providerRefs, requirement: existingEntity ? 'required' : 'optional',
      ...(existingEntity ? {} : { preserveExistingMetadata: true }),
    });
  }
  for (const entity of groupEntities) {
    const key = entityKey(entity);
    const observation = identityObservationForEntity(entity, projections);
    const references = [
      entity.externalRef,
      ...(observation ? observationReferences(observation) : []),
      ...(result.get(key)?.providerRefs ?? []),
    ];
    const providerRefs = [...new Map(references.map((reference) => [
      externalReferenceKey(reference),
      reference,
    ])).values()];
    result.set(key, { key, entity, providerRefs, requirement: 'required' });
  }
  return [...result.values()];
}

export function projectionStats(
  entity: ScoringEntity,
  result: ProjectionSlate,
): Readonly<Record<string, unknown>> {
  return projectionObservationForEntity(entity, result)?.stats ?? {};
}
