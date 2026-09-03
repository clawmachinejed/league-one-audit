declare const providerKeyBrand: unique symbol;
declare const externalIdBrand: unique symbol;

export type ProviderKey = string & Readonly<{ [providerKeyBrand]: 'ProviderKey' }>;

export type ExternalResource =
  | 'league' | 'roster' | 'scoring-entity' | 'game' | 'matchup' | 'lineup-entry';

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

/** Kept here to avoid a shared-identity dependency on the domain module. */
export type ExternalPeriodScope = Readonly<{
  season: number;
  seasonType: 'preseason' | 'regular' | 'postseason';
  week: number;
}>;

export type ExternalMatchupRef = ExternalRef<'matchup'> & Readonly<{
  league: ExternalLeagueRef;
  period: ExternalPeriodScope;
}>;

/** A raw assignment is not a scoring entity; its opaque ID conveys no entity kind. */
export type ExternalLineupEntryRef = ExternalRef<'lineup-entry'> & Readonly<{
  league: ExternalLeagueRef;
}>;

export type ExternalResourceRef =
  | ExternalLeagueRef
  | ExternalRosterRef
  | ExternalScoringEntityRef
  | ExternalGameRef
  | ExternalMatchupRef
  | ExternalLineupEntryRef;

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

export function externalMatchupRef(
  league: ExternalLeagueRef,
  period: ExternalPeriodScope,
  value: string,
): ExternalMatchupRef {
  if (!Number.isInteger(period.season) || period.season < 1920 || period.season > 2200
    || !['preseason', 'regular', 'postseason'].includes(period.seasonType)
    || !Number.isInteger(period.week) || period.week < 1 || period.week > 18) {
    throw new Error('Matchup period scope is invalid.');
  }
  return {
    resource: 'matchup', provider: league.provider,
    externalId: externalId(value, 'matchup'), league, period: { ...period },
  };
}

export function externalLineupEntryRef(
  league: ExternalLeagueRef,
  value: string,
): ExternalLineupEntryRef {
  return {
    resource: 'lineup-entry', provider: league.provider,
    externalId: externalId(value, 'lineup-entry'), league,
  };
}

/** Stable, collision-safe key for maps only. External IDs remain opaque. */
export function externalReferenceKey(reference: ExternalResourceRef): string {
  if (reference.resource === 'matchup') {
    return JSON.stringify([
      reference.provider, reference.resource, reference.league.externalId,
      reference.period.season, reference.period.seasonType, reference.period.week,
      reference.externalId,
    ]);
  }
  if (reference.resource === 'roster' || reference.resource === 'lineup-entry') {
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
