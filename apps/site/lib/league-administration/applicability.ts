import type {
  AdministrationScope,
  CanonicalSeasonSourceIdentity,
  ConfigurationBinding,
  ConfigurationComponent,
  ConfigurationComponentName,
  ConfigurationPeriod,
  ConfigurationResolution,
  NormalizedAdministrationObservation,
} from './contracts';

export type ConfigurationVersion = Readonly<{
  id: string;
  leagueSeasonId: string;
  components: readonly ConfigurationComponent[];
}>;

function samePeriod(left: ConfigurationPeriod, right: ConfigurationPeriod): boolean {
  return left.season === right.season && left.seasonType === right.seasonType && left.week === right.week;
}

/**
 * Resolves only explicit evidence for this component and exact period. A current
 * pointer, checkedAt, or another component's binding cannot fill a historical gap.
 * Storage expands its effective intervals to the requested exact period first.
 */
export function resolveConfigurationComponent(input: Readonly<{
  leagueSeasonId: string;
  component: ConfigurationComponentName;
  period: ConfigurationPeriod;
  bindings: readonly ConfigurationBinding[];
  versions: readonly ConfigurationVersion[];
}>): ConfigurationResolution {
  const candidates = input.bindings.filter((binding) => (
    binding.leagueSeasonId === input.leagueSeasonId
    && binding.component === input.component
    && samePeriod(binding.period, input.period)
  ));
  if (candidates.length === 0) return { status: 'unknown', reason: 'no_binding' };
  if (candidates.some((binding) => (
    !Number.isSafeInteger(binding.generation) || binding.generation < 1
    || !binding.evidence.reference.trim()
    || !['owner_confirmed', 'source_effective'].includes(binding.evidence.kind)
  ))) return { status: 'unknown', reason: 'inconsistent_binding' };
  const generation = Math.max(...candidates.map((binding) => binding.generation));
  const newest = candidates.filter((binding) => binding.generation === generation);
  // Duplicate/forked generations are corruption, not a reason to choose by clock time.
  if (newest.length !== 1) return { status: 'unknown', reason: 'inconsistent_binding' };
  const binding = newest[0];
  const versions = input.versions.filter((version) => version.id === binding.configurationVersionId && version.leagueSeasonId === input.leagueSeasonId);
  if (versions.length === 0) return { status: 'unknown', reason: 'missing_version' };
  if (versions.length !== 1) return { status: 'unknown', reason: 'inconsistent_binding' };
  const components = versions[0].components.filter((entry) => entry.name === input.component);
  if (components.length !== 1 || components[0].hash !== binding.componentHash) return { status: 'unknown', reason: 'inconsistent_binding' };
  return { status: 'known', binding, component: components[0] };
}

function sameScope(left: AdministrationScope, right: AdministrationScope): boolean {
  return left.leagueKey === right.leagueKey && left.provider === right.provider
    && left.externalLeagueId === right.externalLeagueId && left.season === right.season;
}

/** Content deduplication never substitutes for comparing the adjacent accepted state. */
export function classifyAdministrationChange(
  previous: NormalizedAdministrationObservation | null,
  incoming: NormalizedAdministrationObservation,
): 'rejected' | 'partial' | 'initial' | 'unchanged' | 'changed' | 'scope_mismatch' {
  if (incoming.status !== 'accepted' || incoming.semanticHash === null) return 'rejected';
  if (incoming.envelope.completeness !== 'complete') return 'partial';
  if (!previous || previous.status !== 'accepted' || previous.envelope.completeness !== 'complete') return 'initial';
  if (!sameScope(previous.envelope.scope, incoming.envelope.scope)
    || previous.envelope.family !== incoming.envelope.family || previous.envelope.week !== incoming.envelope.week) return 'scope_mismatch';
  return previous.semanticHash === incoming.semanticHash ? 'unchanged' : 'changed';
}

export type SourceContinuityValidation =
  | Readonly<{ status: 'valid'; current: CanonicalSeasonSourceIdentity; previous: CanonicalSeasonSourceIdentity }>
  | Readonly<{ status: 'unknown'; reason: 'missing_previous_mapping' | 'missing_source_evidence' }>
  | Readonly<{ status: 'rejected'; reason: 'invalid_identity' | 'different_league' | 'nonadjacent_season' | 'reused_identity' | 'source_predecessor_mismatch' }>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validCanonicalIdentity(identity: CanonicalSeasonSourceIdentity): boolean {
  return uuid.test(identity.leagueId) && uuid.test(identity.leagueSeasonId)
    && identity.provider === 'sleeper'
    && Number.isSafeInteger(identity.season) && identity.season >= 1000 && identity.season <= 9999
    && identity.externalLeagueId.length > 0 && identity.externalLeagueId.trim() === identity.externalLeagueId;
}

/**
 * Checks an explicitly proposed annual mapping. It does not discover or create
 * one, and says nothing about franchise continuity or manager/account identity.
 */
export function validateAnnualSourceContinuity(input: Readonly<{
  current: CanonicalSeasonSourceIdentity;
  previous: CanonicalSeasonSourceIdentity | null;
  reportedPreviousExternalLeagueId: string | null;
}>): SourceContinuityValidation {
  const { current, previous, reportedPreviousExternalLeagueId } = input;
  if (!validCanonicalIdentity(current) || (previous !== null && !validCanonicalIdentity(previous))) return { status: 'rejected', reason: 'invalid_identity' };
  if (previous === null) return { status: 'unknown', reason: 'missing_previous_mapping' };
  if (current.leagueId !== previous.leagueId || current.provider !== previous.provider) return { status: 'rejected', reason: 'different_league' };
  if (current.season !== previous.season + 1) return { status: 'rejected', reason: 'nonadjacent_season' };
  if (current.leagueSeasonId === previous.leagueSeasonId || current.externalLeagueId === previous.externalLeagueId) return { status: 'rejected', reason: 'reused_identity' };
  if (reportedPreviousExternalLeagueId === null) return { status: 'unknown', reason: 'missing_source_evidence' };
  if (reportedPreviousExternalLeagueId !== previous.externalLeagueId) return { status: 'rejected', reason: 'source_predecessor_mismatch' };
  return { status: 'valid', current, previous };
}
