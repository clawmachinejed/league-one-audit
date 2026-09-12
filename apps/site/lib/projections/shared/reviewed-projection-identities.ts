import type { ProjectionObservation } from '../domain/contracts';

/** Reviewed incompatible provider assertion. The original source remains
 * immutable evidence. No substitute identity is inferred from metadata. */
export function projectionIdentityQuarantined(observation: ProjectionObservation): boolean {
  const references = [observation.identity.primary, ...observation.identity.aliases];
  return references.some((reference) => reference.provider === 'tank01'
    && reference.entityKind === 'player' && String(reference.externalId) === '4429835')
    && references.some((reference) => reference.provider === 'sleeper'
      && reference.entityKind === 'player' && String(reference.externalId) === '8063');
}
