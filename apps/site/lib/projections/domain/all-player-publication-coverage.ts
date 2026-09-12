import { NFL_TEAM_CODES } from './contracts';
import { allPlayerEvidenceMatchesPeriod } from './all-player-eligibility';
import type { AllPlayerStatEntry, AllPlayerStatObservation } from './all-player-observation-evidence';

const FINGERPRINT_FIELDS = [
  'expectedInventoryFingerprint', 'rosterInventoryFingerprint',
  'projectionInventoryFingerprint', 'byeInventoryFingerprint',
] as const;

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasWeeklyRow(entry: AllPlayerStatEntry): boolean {
  const evidence = entry.eligibilityEvidence;
  return evidence.kind === 'weekly-stat' || evidence.kind === 'unknown-weekly-stat'
    || evidence.kind === 'combined-ineligible' || evidence.kind === 'conflict'
    || evidence.kind === 'period-participation' && evidence.weekly !== undefined;
}

/**
 * Deterministic publication metadata shared by shadow and the writer. Complete
 * observations must substantiate the physical inventory that SQL publishes.
 * Partial observations may retain a smaller raw evidence shape, but any declared
 * coverage counts must be truthful. Source authority is checked by the caller;
 * a correctly shaped fingerprint or reviewed-source label is not its proof.
 */
export function validateAllPlayerPublicationCoverage(
  observation: AllPlayerStatObservation,
  options: Readonly<{ requireFinalCoverage?: boolean }> = {},
): readonly string[] {
  const errors = new Set<string>();
  const fail = (field: string) => { errors.add(`invalid-publication-coverage:${field}`); };
  const complete = observation.quality === 'complete';
  const coverage = observation.coverage;
  if (!record(coverage)) return ['invalid-publication-coverage:object'];
  if (!['complete', 'partial'].includes(observation.quality)
    || coverage.complete !== complete) fail('complete');
  if (complete && (observation.seasonType !== 'reg'
    || !Number.isInteger(observation.season) || observation.season < 2026 || observation.season > 2200
    || !Number.isInteger(observation.week) || observation.week < 1 || observation.week > 18)) fail('period');

  const count = (key: string, actual?: number, required = complete): number | null => {
    const value = coverage[key];
    if (value === undefined && !required) return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0
      || actual !== undefined && value !== actual) {
      fail(key);
      return null;
    }
    return value;
  };
  for (const key of FINGERPRINT_FIELDS) {
    if (complete || coverage[key] !== undefined) {
      if (typeof coverage[key] !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(coverage[key])) fail(key);
    }
  }
  for (const key of ['catalogRevision', 'scheduleRevision'] as const) {
    if ((complete || coverage[key] !== undefined)
      && (typeof coverage[key] !== 'string' || !coverage[key].trim())) fail(key);
  }

  const entries = observation.entries;
  const players = entries.filter((entry) => entry.entityKind === 'player');
  const defenses = entries.filter((entry) => entry.entityKind === 'team_defense');
  const unknown = entries.filter((entry) => entry.eligibleGameCount === null
    || entry.appearanceGameCount === null).length;
  const unmapped = entries.filter((entry) => entry.eligibleGameCount === 1 && entry.nflGameId === null).length;
  const present = entries.filter(hasWeeklyRow).length;
  count('expectedEntityCount', entries.length);
  count('fantasyEntityCount', entries.length);
  count('expectedPlayerCount', players.length);
  count('expectedTeamDefenseCount', defenses.length);
  count('providerPresentEntityCount', present);
  count('providerMissingEntityCount', entries.length - present);
  count('unknownEligibilityCount', unknown);
  count('unmappedGameCount', unmapped);
  const unexpected = count('unexpectedResponseEntityCount');
  const excluded = count('excludedResponseEntityCount', undefined, false);
  const response = count('responseEntityCount', undefined, false);
  if (response !== null && excluded !== null && unexpected !== null
    && response !== present + excluded + unexpected) fail('responseEntityCount');
  if (complete && (unknown > 0 || unmapped > 0 || unexpected !== 0)) fail('complete-counts');

  const canonicalTeams = new Set<string>(NFL_TEAM_CODES);
  if (complete && (defenses.length !== NFL_TEAM_CODES.length
    || new Set(defenses.map((entry) => entry.providerExternalId)).size !== NFL_TEAM_CODES.length
    || defenses.some((entry) => !canonicalTeams.has(entry.providerExternalId)
      || entry.position !== 'DEF' || entry.nflTeam !== entry.providerExternalId))) fail('canonical-defenses');

  const periodEvidence = coverage.periodInventoryEvidence;
  if (complete && coverage.periodInventoryComplete !== true) fail('periodInventoryComplete');
  if (coverage.periodInventoryComplete !== undefined && typeof coverage.periodInventoryComplete !== 'boolean') {
    fail('periodInventoryComplete');
  }
  if (complete || coverage.periodInventoryComplete === true || periodEvidence != null) {
    if (!record(periodEvidence)
      || !['official-period-inventory', 'manual-review'].includes(String(periodEvidence.source))
      || !allPlayerEvidenceMatchesPeriod(periodEvidence, {
        season: observation.season, seasonType: 'reg', week: observation.week,
      })
      || Date.parse(String(periodEvidence.observedAt)) > Date.parse(observation.observedAt)
      || !record(periodEvidence.excludedPlayerReasons) || !record(periodEvidence.teamsByPlayerId)) {
      fail('periodInventoryEvidence');
    } else {
      const reasons = periodEvidence.excludedPlayerReasons;
      const teams = periodEvidence.teamsByPlayerId;
      if (Object.entries(reasons).some(([id, reason]) => !id.trim()
        || typeof reason !== 'string' || !reason.trim()
        || players.some((entry) => entry.providerExternalId === id))
        || Object.entries(teams).some(([id, team]) => !id.trim()
          || team !== null && (typeof team !== 'string' || !canonicalTeams.has(team)))
        || players.some((entry) => !Object.prototype.hasOwnProperty.call(teams, entry.providerExternalId)
          || teams[entry.providerExternalId] !== entry.nflTeam)) fail('periodInventoryEvidence');
    }
  }

  const mode = coverage.mode;
  if (complete && !['completed-backfill', 'recurring-current-week'].includes(String(mode))) fail('mode');
  const finalRequired = options.requireFinalCoverage === true || mode === 'completed-backfill';
  // Every scheduled game has both canonical defenses even if neither provider
  // row has appeared. This deliberately does not assume a 16-game week.
  const games = new Map<string, AllPlayerStatEntry[]>();
  for (const defense of defenses) {
    if (!defense.nflGameId) continue;
    const game = games.get(defense.nflGameId) ?? [];
    game.push(defense);
    games.set(defense.nflGameId, game);
  }
  const nonFinalGames = [...games.values()].filter((game) => (
    game.length !== 2 || game.some((entry) => entry.gamePhase !== 'final')
  )).length;
  const final = games.size > 0 && nonFinalGames === 0;
  count('scheduledGameCount', complete ? games.size : undefined);
  count('nonFinalScheduledGameCount', complete ? nonFinalGames : undefined);
  if (complete && [...games.values()].some((game) => game.length !== 2)) fail('canonical-game-context');
  if (complete || coverage.scheduleFinalityComplete !== undefined) {
    if (typeof coverage.scheduleFinalityComplete !== 'boolean'
      || complete && coverage.scheduleFinalityComplete !== final) fail('scheduleFinalityComplete');
  }
  const nonFinalEligible = entries.filter((entry) => entry.eligibleGameCount === 1 && entry.gamePhase !== 'final').length;
  count('nonFinalEligibleCount', finalRequired ? nonFinalEligible : 0, complete);
  if (complete && finalRequired && (!final || nonFinalEligible > 0)) fail('completed-period-finality');
  return [...errors].sort();
}
