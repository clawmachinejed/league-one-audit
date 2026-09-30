import type { Decimal } from './contracts';
import { currentRosterScope, CURRENT_ROSTER_POLICY } from './current-roster';
import type { JsonObject, JsonValue } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { isAdministrationSourceMapping } from '../league-administration/source-mapping';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import type { SleeperRoster } from '../transform';
import { assertAcceptedResource } from './validation';
import { SEASON_OVERVIEW_SOURCE_VERSION, type SeasonFact, type SeasonPointsFact, type SeasonOverviewSourceInput,
  type SeasonOverviewSourceRead, type SeasonOverviewTeamFacts } from './season-overview-source-contracts';
export { SEASON_OVERVIEW_SOURCE_VERSION } from './season-overview-source-contracts';
export type { SeasonFact, SeasonPointsFact, SeasonOverviewSourceInput,
  SeasonOverviewSourceRead, SeasonOverviewTeamFacts } from './season-overview-source-contracts';

function object(value: JsonValue | undefined): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}
function field<T>(container: JsonObject | null, key: string, sourcePath: string,
  valid: (value: JsonValue) => value is T & JsonValue): SeasonFact<T> {
  if (container === null) return { state: 'invalid', value: null, sourcePath };
  if (!Object.hasOwn(container, key)) return { state: 'absent', value: null, sourcePath };
  const value = container[key];
  return value === null ? { state: 'null', value: null, sourcePath }
    : valid(value) ? { state: 'known', value, sourcePath } : { state: 'invalid', value: null, sourcePath };
}
const finite = (value: JsonValue): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (minimum: number) => (value: JsonValue): value is number => finite(value) && Number.isSafeInteger(value) && value >= minimum;
const signedInteger = (value: JsonValue): value is number => finite(value) && Number.isSafeInteger(value);
const text = (value: JsonValue): value is string => typeof value === 'string' && value.trim().length > 0;

/** Parsed JSON numbers retain their shortest round-trippable decimal, not lost lexical source scale. */
function decimalParts(value: number): { units: bigint; scale: number } {
  const [mantissa, exponent = '0'] = String(Object.is(value, -0) ? 0 : value).split(/[eE]/u);
  const [whole, fraction = ''] = mantissa.split('.');
  const scale = fraction.length - Number(exponent);
  const units = BigInt(`${whole}${fraction}`);
  return scale < 0 ? { units: units * 10n ** BigInt(-scale), scale: 0 } : { units, scale };
}
function totalDecimal(whole: number, fraction: number): Decimal {
  const left = decimalParts(whole); const right = decimalParts(fraction);
  right.scale += 2;
  const scale = Math.max(left.scale, right.scale);
  const units = left.units * 10n ** BigInt(scale - left.scale) + right.units * 10n ** BigInt(scale - right.scale);
  const negative = units < 0n; const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const result = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/u, '');
  return `${negative ? '-' : ''}${result}`;
}
function points(settings: JsonObject | null, wholeKey: string, fractionKey: string): SeasonPointsFact {
  const whole = field(settings, wholeKey, `settings.${wholeKey}`, finite);
  const fraction = field(settings, fractionKey, `settings.${fractionKey}`, finite);
  // Sleeper's optional fractional component is hundredths. Its omission leaves an integer total;
  // explicit null/invalid fractions and an absent whole part never become a known zero.
  const state = whole.state !== 'known' ? whole.state : fraction.state === 'known' || fraction.state === 'absent' ? 'known' : fraction.state;
  return { whole, fraction, state, value: state === 'known' ? totalDecimal(whole.value!, fraction.value ?? 0) : null,
    policy: 'sleeper-whole-plus-hundredths-v1' };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Optional field projection of the same already-validated roster capture. It advances no acceptance
 * or freshness claim and never widens the players-only receipt policy. Failures are isolated from it. */
export function projectSeasonOverviewSource(input: SeasonOverviewSourceInput): SeasonOverviewSourceRead {
  try {
    const { normalized, mapping, accepted, receipt, seasonTeams } = input;
    const { envelope } = normalized;
    assertAcceptedResource(accepted);
    if (!isAdministrationSourceMapping(mapping) || normalized.status !== 'accepted' || normalized.value?.family !== 'rosters'
      || envelope.family !== 'rosters' || envelope.week !== null || envelope.completeness !== 'complete'
      || !Array.isArray(envelope.payload) || compatibleRevision(envelope.scope) !== compatibleRevision(mapping.scope)
      || compatibleRevision(accepted.scope) !== compatibleRevision(currentRosterScope(mapping))
      || accepted.sourceMappingRevisionId !== mapping.revisionId || accepted.observationIds.length !== 1
      || accepted.canonicalNormalizerVersion !== CURRENT_ROSTER_POLICY.canonicalNormalizerVersion
      || accepted.validationVersion !== CURRENT_ROSTER_POLICY.validationVersion
      || accepted.verifiedAt !== envelope.provenance.sourceObservedAt
      || accepted.observationIds[0] !== receipt.id || compatibleRevision(receipt.provenance) !== compatibleRevision(envelope.provenance)
      || seasonTeams.length !== receipt.expectedTeamCount || envelope.payload.length !== seasonTeams.length
      || normalized.value.teams.length !== seasonTeams.length || seasonTeams.length < 1) throw new Error('Invalid season source.');
    const verified = normalizeAdministrationObservation(envelope, { expectedRosterCount: receipt.expectedTeamCount });
    if (verified.status !== 'accepted' || verified.contentHash !== normalized.contentHash
      || verified.semanticHash !== normalized.semanticHash || compatibleRevision(verified.value) !== compatibleRevision(normalized.value)) {
      throw new Error('Invalid same-capture normalized source.');
    }
    const identities = new Map(seasonTeams.map(team => [team.externalRosterId, team.seasonTeamId]));
    if (identities.size !== seasonTeams.length || new Set(identities.values()).size !== seasonTeams.length
      || seasonTeams.some(team => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(team.seasonTeamId))) {
      throw new Error('Invalid season teams.');
    }
    const seen = new Set<string>();
    const teams = envelope.payload.map((raw): SeasonOverviewTeamFacts => {
      const roster = object(raw); const externalRosterId = String(roster?.roster_id);
      const seasonTeamId = identities.get(externalRosterId);
      if (!roster || !seasonTeamId || seen.has(externalRosterId)
        || !normalized.value || normalized.value.family !== 'rosters'
        || !normalized.value.teams.some(team => team.externalRosterId === externalRosterId)) throw new Error('Unmapped roster.');
      seen.add(externalRosterId);
      const settings = roster.settings === undefined ? {} : object(roster.settings);
      const metadata = roster.metadata === undefined ? {} : object(roster.metadata);
      const count = (key: string, minimum = 0) => field(settings, key, `settings.${key}`, integer(minimum));
      return { seasonTeamId, externalRosterId,
        record: { wins: count('wins'), losses: count('losses'), ties: count('ties') },
        pointsFor: points(settings, 'fpts', 'fpts_decimal'), pointsAgainst: points(settings, 'fpts_against', 'fpts_against_decimal'),
        providerRank: count('rank', 1), providerSeed: count('seed', 1), division: count('division'),
        waiver: { priority: count('waiver_position', 1), budgetUsed: field(settings, 'waiver_budget_used', 'settings.waiver_budget_used', signedInteger) },
        display: { name: field(metadata, 'team_name', 'metadata.team_name', text), avatar: field(metadata, 'avatar', 'metadata.avatar', text) } };
    });
    const missing = teams.flatMap(team => Object.entries({ ...team.record, pointsFor: team.pointsFor, pointsAgainst: team.pointsAgainst })
      .filter(([, fact]) => fact.state !== 'known').map(([key, fact]) => `${team.externalRosterId}:${key}:${fact.state}`));
    return freeze(structuredClone({ status: 'available' as const, kind: 'current-season-overview-source' as const,
      version: SEASON_OVERVIEW_SOURCE_VERSION, temporalContext: 'season-to-date' as const,
      historicalApplicability: 'unverified' as const, freshness: 'unknown' as const, mapping,
      source: { receiptId: receipt.id, contentId: accepted.contentId, rawContentHash: normalized.contentHash,
        legacyObservationId: receipt.legacyObservationId, generation: accepted.acceptedGeneration,
        provenance: receipt.provenance, expectedTeamCount: receipt.expectedTeamCount }, teams,
      completeness: missing.length ? 'partial' as const : 'complete' as const, reasons: missing,
      comparison: { status: 'equal' as const, fields: ['record', 'points-components', 'provider-rank-seed', 'waiver-state', 'roster-display'] },
      compatibility: { sourceRosters: envelope.payload as unknown as readonly SleeperRoster[] } }));
  } catch { return { status: 'unavailable', reason: 'season_overview_source_invalid' }; }
}
