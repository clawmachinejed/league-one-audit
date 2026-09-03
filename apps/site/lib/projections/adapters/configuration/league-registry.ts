import type { LeagueConfiguration } from '../../domain/contracts';
import type { LeagueRegistryPort } from '../../ports/league-registry';
import { externalReferenceKey } from '../../shared/provider-identity';

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be blank.`);
  return normalized;
}

/**
 * Builds the active-league registry from values supplied by the runtime
 * composition root. Provider IDs, league IDs, and display names deliberately
 * remain outside this adapter.
 */
export function createLeagueRegistry(
  configurations: readonly LeagueConfiguration[],
): LeagueRegistryPort {
  const active = configurations.map((configuration) => ({
    ...configuration,
    key: requiredText(configuration.key, 'League key'),
    displayName: requiredText(configuration.displayName, 'League display name'),
  }));
  const keys = new Set<string>();
  const references = new Set<string>();

  for (const configuration of active) {
    if (keys.has(configuration.key)) {
      throw new Error(`Duplicate league key: ${configuration.key}`);
    }
    keys.add(configuration.key);

    const reference = externalReferenceKey(configuration.leagueRef);
    if (references.has(reference)) {
      throw new Error('An external league reference was configured more than once.');
    }
    references.add(reference);
  }

  return { listActiveLeagues: () => active };
}
