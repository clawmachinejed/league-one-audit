declare const providerKeyBrand: unique symbol;
declare const externalIdBrand: unique symbol;

export type ProviderKey = string & Readonly<{ [providerKeyBrand]: 'ProviderKey' }>;

export type ExternalResource = 'league' | 'roster' | 'scoring-entity' | 'game';

export type OpaqueExternalId<Resource extends string> = string & Readonly<{
  [externalIdBrand]: Resource;
}>;

type ExternalRef<Resource extends ExternalResource> = Readonly<{
  resource: Resource;
  provider: ProviderKey;
  externalId: OpaqueExternalId<Resource>;
}>;

export type ExternalLeagueRef = ExternalRef<'league'>;

export type ExternalRosterRef = ExternalRef<'roster'> & Readonly<{
  /** Roster identifiers are scoped to a league and may repeat between leagues. */
  league: ExternalLeagueRef;
}>;

export type ExternalPlayerRef = ExternalRef<'scoring-entity'> & Readonly<{
  entityKind: 'player';
}>;

export type ExternalTeamDefenseRef = ExternalRef<'scoring-entity'> & Readonly<{
  entityKind: 'team-defense';
}>;

export type ExternalScoringEntityRef = ExternalPlayerRef | ExternalTeamDefenseRef;
export type ExternalGameRef = ExternalRef<'game'>;

export type ExternalResourceRef =
  | ExternalLeagueRef
  | ExternalRosterRef
  | ExternalScoringEntityRef
  | ExternalGameRef;

function nonBlank(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be blank.`);
  return normalized;
}

export function providerKey(value: string): ProviderKey {
  return nonBlank(value, 'Provider key').toLowerCase() as ProviderKey;
}

function externalId<Resource extends ExternalResource>(
  value: string,
  resource: Resource,
): OpaqueExternalId<Resource> {
  return nonBlank(value, `${resource} external ID`) as OpaqueExternalId<Resource>;
}

export function externalLeagueRef(provider: string | ProviderKey, value: string): ExternalLeagueRef {
  return {
    resource: 'league',
    provider: providerKey(provider),
    externalId: externalId(value, 'league'),
  };
}

export function externalRosterRef(league: ExternalLeagueRef, value: string): ExternalRosterRef {
  return {
    resource: 'roster',
    provider: league.provider,
    externalId: externalId(value, 'roster'),
    league,
  };
}

export function externalPlayerRef(provider: string | ProviderKey, value: string): ExternalPlayerRef {
  return {
    resource: 'scoring-entity',
    entityKind: 'player',
    provider: providerKey(provider),
    externalId: externalId(value, 'scoring-entity'),
  };
}

export function externalTeamDefenseRef(
  provider: string | ProviderKey,
  value: string,
): ExternalTeamDefenseRef {
  return {
    resource: 'scoring-entity',
    entityKind: 'team-defense',
    provider: providerKey(provider),
    externalId: externalId(value, 'scoring-entity'),
  };
}

export function externalGameRef(provider: string | ProviderKey, value: string): ExternalGameRef {
  return {
    resource: 'game',
    provider: providerKey(provider),
    externalId: externalId(value, 'game'),
  };
}

/** Stable, collision-safe key for maps only. External IDs remain opaque. */
export function externalReferenceKey(reference: ExternalResourceRef): string {
  if (reference.resource === 'roster') {
    return JSON.stringify([
      reference.provider,
      reference.resource,
      reference.league.externalId,
      reference.externalId,
    ]);
  }
  if (reference.resource === 'scoring-entity') {
    return JSON.stringify([
      reference.provider,
      reference.resource,
      reference.entityKind,
      reference.externalId,
    ]);
  }
  return JSON.stringify([reference.provider, reference.resource, reference.externalId]);
}

export function sameExternalReference(
  left: ExternalResourceRef,
  right: ExternalResourceRef,
): boolean {
  return externalReferenceKey(left) === externalReferenceKey(right);
}
