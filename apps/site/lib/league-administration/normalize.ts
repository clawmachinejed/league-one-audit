import { compatibleRevision, compatibleScoringRulesHash } from '../projections/shared/revision-compatibility';
import {
  ADMINISTRATION_DIALECT,
  ADMINISTRATION_NORMALIZER_VERSION,
  ADMINISTRATION_SCHEMA_VERSION,
  type AdministrationDiagnostic,
  type AdministrationEnvelope,
  type AdministrationNormalizationExpectations,
  type ConfigurationComponent,
  type ConfigurationComponentName,
  type JsonObject,
  type JsonValue,
  type NormalizedAdministrationObservation,
  type NormalizedAdministrationValue,
  type NormalizedLeagueConfiguration,
  type SourceBudgetMovement,
  type SourceBracketAdvancement,
  type SourceDraftPickMovement,
  type SourceManager,
  type SourceMatchup,
  type SourceMembership,
  type SourcePlayerMovement,
  type SourceTeam,
  type SourceTransaction,
} from './contracts';

/** Only these observed source counters are excluded. Unknown fields remain material. */
export const OPERATIONAL_LEAGUE_SETTING_KEYS: ReadonlySet<string> = new Set([
  'leg', 'last_scored_leg', 'daily_waivers_last_ran', 'last_report',
]);

const operationalLeagueFields = new Set(['status']);
const representedLeagueFields = new Set([
  'league_id', 'season', 'previous_league_id', 'total_rosters',
  'scoring_settings', 'settings', 'roster_positions', 'name', 'avatar', 'metadata',
]);

class InvalidDocument extends Error {
  constructor(readonly diagnostic: AdministrationDiagnostic) { super(diagnostic.message); }
}

function invalid(code: string, path: string, message: string): never {
  throw new InvalidDocument({ code, path, message });
}

function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('invalid_object', path, 'Expected a source JSON object.');
  }
  return value as JsonObject;
}

function rows(value: unknown, path: string): readonly JsonValue[] {
  if (!Array.isArray(value)) invalid('invalid_array', path, 'Expected a source JSON array.');
  return value;
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) {
    invalid('invalid_identifier', path, 'Expected a nonempty, unmodified string identifier.');
  }
  return value;
}

function safeInteger(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    invalid('invalid_integer', path, `Expected a safe integer of at least ${minimum}.`);
  }
  return value;
}

function rosterIdentifier(value: unknown, path: string): string {
  return String(safeInteger(value, path, 1));
}

function optionalText(value: unknown, path: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') invalid('invalid_string', path, 'Expected a string or null.');
  return value;
}

function nullableNumber(value: unknown, path: string): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid('invalid_number', path, 'Expected a finite source number or null.');
  }
  return value;
}

function nullableTimestampMilliseconds(value: unknown, path: string): number | null {
  return value == null ? null : safeInteger(value, path);
}

function sourceSeason(value: unknown, path: string): number {
  if (typeof value !== 'string' || !/^[1-9][0-9]{3}$/.test(value)) {
    invalid('invalid_season', path, 'Expected a four-digit source season string.');
  }
  return Number(value);
}

function unique<T>(values: readonly T[], key: (value: T) => string, path: string): readonly T[] {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const id = key(value);
    if (seen.has(id)) invalid('duplicate_identifier', `${path}[${index}]`, 'A scoped source identifier occurs more than once.');
    seen.add(id);
  });
  return values;
}

function idArray(value: unknown, path: string, options?: { roster?: boolean; vacantStarters?: boolean }): readonly string[] | null {
  if (value == null) return null;
  const ids = rows(value, path).map((entry, index) => (
    options?.roster ? rosterIdentifier(entry, `${path}[${index}]`) : identifier(entry, `${path}[${index}]`)
  ));
  unique(options?.vacantStarters ? ids.filter((id) => id !== '0') : ids, (id) => id, path);
  return ids;
}

function countMatches(actual: number, expectations: AdministrationNormalizationExpectations, path: string): void {
  if (expectations.expectedRosterCount === undefined) return;
  safeInteger(expectations.expectedRosterCount, 'expectations.expectedRosterCount', 1);
  if (actual !== expectations.expectedRosterCount) {
    invalid('incomplete_roster_set', path, 'The document does not contain the expected complete roster set.');
  }
}

/** Refuse values JSON would silently discard or coerce before creating a content identity. */
function assertJson(value: unknown, path: string, ancestors = new Set<object>()): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') invalid('invalid_json', path, 'The source document must contain only finite JSON values.');
  if (ancestors.has(value)) invalid('invalid_json', path, 'The source document must not contain cycles.');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    invalid('invalid_json', path, 'The source document must contain only plain JSON objects.');
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) assertJson(value[index], `${path}[${index}]`, ancestors);
  } else {
    for (const [key, entry] of Object.entries(value)) assertJson(entry, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}

function frozenCopy<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => frozenCopy(item))) as T;
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, frozenCopy(entry)]))) as T;
  }
  return value;
}

function time(value: unknown, path: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    invalid('invalid_timestamp', path, 'Expected an ISO timestamp with an explicit timezone.');
  }
  return Date.parse(value);
}

function validateEnvelope(envelope: AdministrationEnvelope): void {
  if (envelope.schemaVersion !== ADMINISTRATION_SCHEMA_VERSION || envelope.normalizerVersion !== ADMINISTRATION_NORMALIZER_VERSION || envelope.dialect !== ADMINISTRATION_DIALECT) {
    invalid('unsupported_version', 'envelope', 'The observation uses an unsupported schema, normalizer, or dialect.');
  }
  const scope = object(envelope.scope, 'scope');
  identifier(scope.leagueKey, 'scope.leagueKey');
  identifier(scope.externalLeagueId, 'scope.externalLeagueId');
  if (scope.provider !== 'sleeper') invalid('unsupported_provider', 'scope.provider', 'Only the Sleeper source dialect is supported.');
  if (safeInteger(scope.season, 'scope.season', 1000) > 9999) invalid('invalid_season', 'scope.season', 'Expected a four-digit season.');
  if (!['league', 'rosters', 'users', 'matchups', 'transactions', 'drafts', 'traded_picks', 'winners_bracket', 'losers_bracket'].includes(envelope.family)) {
    invalid('unsupported_family', 'family', 'This source family is not supported.');
  }
  if (envelope.family === 'matchups' || envelope.family === 'transactions') safeInteger(envelope.week, 'week', envelope.family === 'matchups' ? 1 : 0);
  else if (envelope.week !== null) invalid('invalid_scope', 'week', 'This family has a season scope rather than a weekly scope.');
  if (!['complete', 'partial'].includes(envelope.completeness)) invalid('invalid_completeness', 'completeness', 'Completeness must be stated explicitly.');
  const provenance = object(envelope.provenance, 'provenance');
  if (!['network', 'cache', 'bootstrap'].includes(String(provenance.origin))) invalid('invalid_origin', 'provenance.origin', 'Expected a supported source origin.');
  const checked = time(provenance.checkedAt, 'provenance.checkedAt');
  const started = provenance.requestStartedAt === null ? null : time(provenance.requestStartedAt, 'provenance.requestStartedAt');
  const completed = provenance.requestCompletedAt === null ? null : time(provenance.requestCompletedAt, 'provenance.requestCompletedAt');
  const observed = provenance.sourceObservedAt === null ? null : time(provenance.sourceObservedAt, 'provenance.sourceObservedAt');
  if ((started === null) !== (completed === null) || (started !== null && completed !== null && (completed < started || completed > checked)) || (observed !== null && observed > checked)) {
    invalid('invalid_time_order', 'provenance', 'Request and observation times must not contradict the check time.');
  }
}

function component(name: ConfigurationComponentName, value: JsonObject): ConfigurationComponent {
  return { name, value, hash: compatibleRevision({ normalizerVersion: ADMINISTRATION_NORMALIZER_VERSION, dialect: ADMINISTRATION_DIALECT, name, value }) };
}

function selected(raw: JsonObject, keys: readonly string[]): JsonObject {
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(raw, key)).map((key) => [key, raw[key]]));
}

function normalizeLeague(raw: JsonObject, envelope: AdministrationEnvelope): NormalizedLeagueConfiguration {
  const externalLeagueId = identifier(raw.league_id, 'payload.league_id');
  const season = sourceSeason(raw.season, 'payload.season');
  if (externalLeagueId !== envelope.scope.externalLeagueId || season !== envelope.scope.season) {
    invalid('source_identity_mismatch', 'payload', 'The league document does not match the approved source scope.');
  }
  if (raw.sport !== undefined && raw.sport !== 'nfl') invalid('unsupported_sport', 'payload.sport', 'This normalizer only supports the NFL source dialect.');
  let rawScoringRulesHash: string | null = null;
  if (raw.scoring_settings !== undefined && raw.scoring_settings !== null) {
    const scoring = object(raw.scoring_settings, 'payload.scoring_settings');
    Object.entries(scoring).forEach(([key, weight]) => {
      if (typeof weight !== 'number' || !Number.isFinite(weight)) invalid('invalid_scoring_weight', `payload.scoring_settings.${key}`, 'Source scoring weights must be finite numbers.');
    });
    if (Object.keys(scoring).length > 0) rawScoringRulesHash = compatibleScoringRulesHash(scoring as Record<string, number>);
  }
  if (raw.roster_positions !== undefined && raw.roster_positions !== null) {
    rows(raw.roster_positions, 'payload.roster_positions').forEach((slot, index) => identifier(slot, `payload.roster_positions[${index}]`));
  }
  let competition = selected(raw, ['settings', 'total_rosters']);
  if (raw.settings !== undefined && raw.settings !== null) {
    const settings = object(raw.settings, 'payload.settings');
    competition = { ...competition, settings: Object.fromEntries(Object.entries(settings).filter(([key]) => !OPERATIONAL_LEAGUE_SETTING_KEYS.has(key))) };
  }
  const previousExternalLeagueId = raw.previous_league_id == null ? null : identifier(raw.previous_league_id, 'payload.previous_league_id');
  if (previousExternalLeagueId === externalLeagueId) invalid('invalid_predecessor', 'payload.previous_league_id', 'An annual source league cannot be its own predecessor.');
  const totalRosters = raw.total_rosters == null ? null : safeInteger(raw.total_rosters, 'payload.total_rosters', 1);
  const extensions = Object.fromEntries(Object.entries(raw).filter(([key]) => !representedLeagueFields.has(key) && !operationalLeagueFields.has(key)));
  return {
    family: 'league', externalLeagueId, season, previousExternalLeagueId, totalRosters, rawScoringRulesHash,
    components: [
      component('scoring', selected(raw, ['scoring_settings'])),
      component('roster', selected(raw, ['roster_positions'])),
      component('competition', competition),
      component('display', selected(raw, ['name', 'avatar', 'metadata'])),
      component('extensions', extensions),
    ],
  };
}

function normalizeRosters(raw: readonly JsonValue[], expectations: AdministrationNormalizationExpectations): NormalizedAdministrationValue {
  countMatches(raw.length, expectations, 'payload');
  const memberships: SourceMembership[] = [];
  const teams: SourceTeam[] = raw.map((entry, index) => {
    const path = `payload[${index}]`;
    const row = object(entry, path);
    const externalRosterId = rosterIdentifier(row.roster_id, `${path}.roster_id`);
    const primaryOwnerExternalId = row.owner_id == null ? null : identifier(row.owner_id, `${path}.owner_id`);
    const coOwnerExternalIds = idArray(row.co_owners, `${path}.co_owners`) ?? [];
    if (primaryOwnerExternalId !== null) {
      if (coOwnerExternalIds.includes(primaryOwnerExternalId)) invalid('duplicate_membership', `${path}.co_owners`, 'The primary owner also occurs as a co-owner.');
      memberships.push({ externalRosterId, externalManagerId: primaryOwnerExternalId, role: 'owner' });
    }
    coOwnerExternalIds.forEach((externalManagerId) => memberships.push({ externalRosterId, externalManagerId, role: 'co_owner' }));
    return {
      externalRosterId, primaryOwnerExternalId, coOwnerExternalIds,
      playerExternalIds: idArray(row.players, `${path}.players`),
      starterExternalIds: idArray(row.starters, `${path}.starters`, { vacantStarters: true }),
      reserveExternalIds: idArray(row.reserve, `${path}.reserve`),
      taxiExternalIds: idArray(row.taxi, `${path}.taxi`),
    };
  });
  unique(teams, (team) => team.externalRosterId, 'payload');
  return { family: 'rosters', teams, memberships };
}

function normalizeUsers(raw: readonly JsonValue[]): NormalizedAdministrationValue {
  const managers: SourceManager[] = raw.map((entry, index) => {
    const path = `payload[${index}]`;
    const row = object(entry, path);
    return {
      externalManagerId: identifier(row.user_id, `${path}.user_id`),
      displayName: optionalText(row.display_name, `${path}.display_name`),
      username: optionalText(row.username, `${path}.username`),
      avatar: optionalText(row.avatar, `${path}.avatar`),
    };
  });
  unique(managers, (manager) => manager.externalManagerId, 'payload');
  return { family: 'users', managers };
}

function normalizeMatchups(raw: readonly JsonValue[], expectations: AdministrationNormalizationExpectations): NormalizedAdministrationValue {
  countMatches(raw.length, expectations, 'payload');
  const matchups: SourceMatchup[] = raw.map((entry, index) => {
    const path = `payload[${index}]`;
    const row = object(entry, path);
    if (row.starters_points != null) {
      const points = rows(row.starters_points, `${path}.starters_points`);
      points.forEach((point, position) => nullableNumber(point, `${path}.starters_points[${position}]`));
      if (Array.isArray(row.starters) && points.length !== row.starters.length) invalid('mismatched_lineup_points', `${path}.starters_points`, 'Starter points must align with source starter positions.');
    }
    if (row.players_points != null) {
      Object.entries(object(row.players_points, `${path}.players_points`)).forEach(([id, points]) => {
        identifier(id, `${path}.players_points`);
        nullableNumber(points, `${path}.players_points.${id}`);
      });
    }
    return {
      externalRosterId: rosterIdentifier(row.roster_id, `${path}.roster_id`),
      externalMatchupId: row.matchup_id == null ? null : rosterIdentifier(row.matchup_id, `${path}.matchup_id`),
      playerExternalIds: idArray(row.players, `${path}.players`),
      starterExternalIds: idArray(row.starters, `${path}.starters`, { vacantStarters: true }),
      points: nullableNumber(row.points, `${path}.points`),
      customPoints: nullableNumber(row.custom_points, `${path}.custom_points`),
    };
  });
  unique(matchups, (matchup) => matchup.externalRosterId, 'payload');
  return { family: 'matchups', matchups };
}

function playerMovements(row: JsonObject, path: string): SourcePlayerMovement[] {
  return (['adds', 'drops'] as const).flatMap((field) => {
    if (row[field] == null) return [];
    return Object.entries(object(row[field], `${path}.${field}`)).map(([player, roster]) => ({
      externalPlayerId: identifier(player, `${path}.${field}`),
      externalRosterId: rosterIdentifier(roster, `${path}.${field}.${player}`),
      direction: field === 'adds' ? 'add' as const : 'drop' as const,
    }));
  });
}

function draftPickMovements(value: JsonValue | undefined, path: string): SourceDraftPickMovement[] {
  if (value == null) return [];
  const picks = rows(value, path).map((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const pick = object(entry, itemPath);
    return {
      season: sourceSeason(pick.season, `${itemPath}.season`),
      round: safeInteger(pick.round, `${itemPath}.round`, 1),
      originalExternalRosterId: rosterIdentifier(pick.roster_id, `${itemPath}.roster_id`),
      previousOwnerExternalRosterId: rosterIdentifier(pick.previous_owner_id, `${itemPath}.previous_owner_id`),
      ownerExternalRosterId: rosterIdentifier(pick.owner_id, `${itemPath}.owner_id`),
    };
  });
  unique(picks, (pick) => `${pick.season}/${pick.round}/${pick.originalExternalRosterId}`, path);
  return picks;
}

function budgetMovements(value: JsonValue | undefined, path: string): SourceBudgetMovement[] {
  if (value == null) return [];
  return rows(value, path).map((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const move = object(entry, itemPath);
    const amount = nullableNumber(move.amount, `${itemPath}.amount`);
    if (amount === null || amount < 0) invalid('invalid_budget_movement', `${itemPath}.amount`, 'A source budget transfer must have a nonnegative amount.');
    return {
      senderExternalRosterId: rosterIdentifier(move.sender, `${itemPath}.sender`),
      receiverExternalRosterId: rosterIdentifier(move.receiver, `${itemPath}.receiver`),
      amount,
    };
  });
}

function normalizeTransactions(raw: readonly JsonValue[]): NormalizedAdministrationValue {
  const transactions: SourceTransaction[] = raw.map((entry, index) => {
    const path = `payload[${index}]`;
    const row = object(entry, path);
    return {
      externalTransactionId: identifier(row.transaction_id, `${path}.transaction_id`),
      type: optionalText(row.type, `${path}.type`),
      status: optionalText(row.status, `${path}.status`),
      createdAtMilliseconds: nullableTimestampMilliseconds(row.created, `${path}.created`),
      statusUpdatedAtMilliseconds: nullableTimestampMilliseconds(row.status_updated, `${path}.status_updated`),
      externalRosterIds: idArray(row.roster_ids, `${path}.roster_ids`, { roster: true }) ?? [],
      consenterExternalRosterIds: idArray(row.consenter_ids, `${path}.consenter_ids`, { roster: true }) ?? [],
      playerMovements: playerMovements(row, path),
      draftPickMovements: draftPickMovements(row.draft_picks, `${path}.draft_picks`),
      budgetMovements: budgetMovements(row.waiver_budget, `${path}.waiver_budget`),
    };
  });
  unique(transactions, (transaction) => transaction.externalTransactionId, 'payload');
  return { family: 'transactions', transactions };
}

function normalizeDrafts(raw: readonly JsonValue[], envelope: AdministrationEnvelope): NormalizedAdministrationValue {
  if (raw.length > 8) invalid('draft_inventory_limit', 'payload', 'The bounded collector supports at most eight draft bundles.');
  const drafts = raw.map((entry, index) => {
    const path = `payload[${index}]`;
    const bundle = object(entry, path);
    const catalog = object(bundle.catalog, `${path}.catalog`);
    const draft = object(bundle.draft, `${path}.draft`);
    const externalDraftId = identifier(catalog.draft_id, `${path}.catalog.draft_id`);
    for (const [field, source] of [['catalog', catalog], ['draft', draft]] as const) {
      if (identifier(source.draft_id, `${path}.${field}.draft_id`) !== externalDraftId
        || identifier(source.league_id, `${path}.${field}.league_id`) !== envelope.scope.externalLeagueId
        || sourceSeason(source.season, `${path}.${field}.season`) !== envelope.scope.season) {
        invalid('source_identity_mismatch', `${path}.${field}`, 'The draft does not belong to the approved league season and catalog.');
      }
      if (source.sport !== undefined && source.sport !== 'nfl') invalid('unsupported_sport', `${path}.${field}.sport`, 'Expected the NFL source dialect.');
    }
    const picks = rows(bundle.picks, `${path}.picks`).map((entry, pickIndex) => {
      const pickPath = `${path}.picks[${pickIndex}]`;
      const pick = object(entry, pickPath);
      if (pick.draft_id !== undefined && identifier(pick.draft_id, `${pickPath}.draft_id`) !== externalDraftId) {
        invalid('source_identity_mismatch', pickPath, 'The pick belongs to a different source draft.');
      }
      if (pick.is_keeper != null && typeof pick.is_keeper !== 'boolean') invalid('invalid_boolean', `${pickPath}.is_keeper`, 'Expected a source keeper boolean or null.');
      return { playerId: identifier(pick.player_id, `${pickPath}.player_id`), pickNumber: safeInteger(pick.pick_no, `${pickPath}.pick_no`, 1),
        round: pick.round == null ? null : safeInteger(pick.round, `${pickPath}.round`, 1),
        draftSlot: pick.draft_slot == null ? null : safeInteger(pick.draft_slot, `${pickPath}.draft_slot`, 1),
        rosterId: pick.roster_id == null ? null : metadataRosterIdentifier(pick.roster_id, `${pickPath}.roster_id`),
        pickedBy: pick.picked_by == null ? null : identifier(pick.picked_by, `${pickPath}.picked_by`),
        keeper: pick.is_keeper == null ? null : pick.is_keeper as boolean };
    });
    unique(picks, pick => String(pick.pickNumber), `${path}.picks`);
    // Unlike optional transaction movement arrays, a complete inventory must
    // explicitly contain the source array, including a verified empty array.
    rows(bundle.traded_picks, `${path}.traded_picks`);
    return { externalDraftId, selections: picks, pickedPlayerExternalIds: picks.map(pick => pick.playerId),
      pickNumbers: picks.map(pick => pick.pickNumber), tradedPicks: metadataTradedPicks(bundle.traded_picks, `${path}.traded_picks`) };
  });
  unique(drafts, draft => draft.externalDraftId, 'payload');
  return { family: 'drafts', drafts };
}

function metadataRosterIdentifier(value: unknown, path: string): string {
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) {
    if (!Number.isSafeInteger(Number(value))) invalid('invalid_identifier', path, 'The roster identifier is outside the safe numeric range.');
    return value;
  }
  return rosterIdentifier(value, path);
}

function uniqueTradedPickRows(value: JsonValue, path: string): readonly JsonValue[] {
  const found = new Map<string, JsonValue>();
  rows(value, path).forEach((entry, index) => {
    const pick = draftPickMovements([entry], `${path}[${index}]`)[0];
    const key = `${pick.season}/${pick.round}/${pick.originalExternalRosterId}`;
    const previous = found.get(key);
    if (previous !== undefined && compatibleRevision(previous) !== compatibleRevision(entry)) {
      invalid('conflicting_pick_ownership', `${path}[${index}]`, 'The same source draft-pick asset has conflicting ownership evidence.');
    }
    found.set(key, entry);
  });
  return [...found.values()];
}

function metadataTradedPicks(value: JsonValue, path: string): SourceDraftPickMovement[] {
  return draftPickMovements(uniqueTradedPickRows(value, path), path);
}

function normalizeBracket(raw: readonly JsonValue[], family: 'winners_bracket' | 'losers_bracket'): NormalizedAdministrationValue {
  const matches = raw.map((entry, index) => {
    const path = `payload[${index}]`;
    const match = object(entry, path);
    const externalMatchupId = String(safeInteger(match.m, `${path}.m`, 1));
    const roster = (key: string) => match[key] == null ? null : metadataRosterIdentifier(match[key], `${path}.${key}`);
    const advancement = (value: JsonValue | undefined, at: string): SourceBracketAdvancement | null => {
      if (value == null) return null;
      const reference = object(value, at);
      const fields = ['w', 'l'].filter(field => reference[field] != null);
      if (fields.length > 1) invalid('conflicting_bracket_reference', at, 'An entrant cannot advance from both winner and loser of a source match.');
      // An unknown future source relationship stays raw without fabricated meaning.
      if (fields.length === 0) return null;
      const id = String(safeInteger(reference[fields[0]], `${at}.${fields[0]}`, 1));
      if (id === externalMatchupId) invalid('self_referencing_bracket', at, 'A source match cannot advance a participant to itself.');
      return { outcome: fields[0] === 'w' ? 'winner' : 'loser', externalMatchupId: id };
    };
    const entrant = (key: 't1' | 't2') => {
      const value = match[key];
      const isReference = value !== null && typeof value === 'object';
      const embedded = isReference ? advancement(value, `${path}.${key}`) : null;
      const explicit = advancement(match[`${key}_from`], `${path}.${key}_from`);
      if (embedded && explicit && (embedded.externalMatchupId !== explicit.externalMatchupId || embedded.outcome !== explicit.outcome)) {
        invalid('conflicting_bracket_reference', `${path}.${key}`, 'Embedded and explicit advancement evidence conflict.');
      }
      return { roster: isReference ? null : roster(key), from: explicit ?? embedded };
    };
    const first = entrant('t1'); const second = entrant('t2');
    return { externalMatchupId, round: safeInteger(match.r, `${path}.r`, 1),
      teamOneExternalRosterId: first.roster, teamTwoExternalRosterId: second.roster,
      winnerExternalRosterId: roster('w'), loserExternalRosterId: roster('l'),
      teamOneFrom: first.from, teamTwoFrom: second.from };
  });
  unique(matches, match => match.externalMatchupId, 'payload');
  return { family, matches };
}

function isCompleteUnpublishedBracket(envelope: AdministrationEnvelope): boolean {
  return (envelope.family === 'winners_bracket' || envelope.family === 'losers_bracket')
    && envelope.completeness === 'complete' && envelope.payload === null;
}

function materialCollection(envelope: AdministrationEnvelope): readonly JsonValue[] | null {
  // A successful null bracket is unpublished source state, distinct from an empty array.
  if (isCompleteUnpublishedBracket(envelope)) return null;
  if (envelope.family === 'drafts') return [...rows(envelope.payload, 'payload')].sort((left, right) =>
    String(object(object(left, 'payload').catalog, 'payload.catalog').draft_id)
      .localeCompare(String(object(object(right, 'payload').catalog, 'payload.catalog').draft_id)));
  if (envelope.family === 'traded_picks') return [...uniqueTradedPickRows(envelope.payload, 'payload')].sort((left, right) => {
    const key = (value: JsonValue) => { const row = object(value, 'payload'); return `${row.season}/${row.round}/${row.roster_id}`; };
    return key(left).localeCompare(key(right));
  });
  if (envelope.family === 'winners_bracket' || envelope.family === 'losers_bracket') {
    return [...rows(envelope.payload, 'payload')].sort((left, right) => Number(object(left, 'payload').m) - Number(object(right, 'payload').m));
  }
  const key = envelope.family === 'users' ? 'user_id' : envelope.family === 'transactions' ? 'transaction_id' : 'roster_id';
  // These endpoints return sets of scoped entities. Preserve their exact raw
  // order as evidence, but do not manufacture versions when only that order changes.
  return [...rows(envelope.payload, 'payload')].sort((left, right) => (
    String(object(left, 'payload')[key]).localeCompare(String(object(right, 'payload')[key]))
  ));
}

/**
 * Pure boundary validation. Raw provider data is retained, never converted into
 * inferred franchise/player/account identity or an effective historical rule.
 * Transport must be JSON; non-JSON input is a caller error, not provider evidence.
 */
export function normalizeAdministrationObservation(
  input: AdministrationEnvelope,
  expectations: AdministrationNormalizationExpectations = {},
): NormalizedAdministrationObservation {
  assertJson(input, 'envelope');
  const envelope = frozenCopy(input);
  const contentHash = compatibleRevision(envelope.payload);
  try {
    validateEnvelope(envelope);
    let value: NormalizedAdministrationValue;
    switch (envelope.family) {
      case 'league': value = normalizeLeague(object(envelope.payload, 'payload'), envelope); break;
      case 'rosters': value = normalizeRosters(rows(envelope.payload, 'payload'), expectations); break;
      case 'users': value = normalizeUsers(rows(envelope.payload, 'payload')); break;
      case 'matchups': value = normalizeMatchups(rows(envelope.payload, 'payload'), expectations); break;
      case 'transactions': value = normalizeTransactions(rows(envelope.payload, 'payload')); break;
      case 'drafts': value = normalizeDrafts(rows(envelope.payload, 'payload'), envelope); break;
      case 'traded_picks': value = { family: 'traded_picks', picks: metadataTradedPicks(envelope.payload, 'payload') }; break;
      case 'winners_bracket': case 'losers_bracket':
        value = normalizeBracket(isCompleteUnpublishedBracket(envelope) ? [] : rows(envelope.payload, 'payload'), envelope.family); break;
    }
    // League operational state is retained raw but does not manufacture a settings version.
    // Other families retain all unknown fields as material rather than silently ignoring them.
    const material = envelope.family === 'league' ? value : materialCollection(envelope);
    return frozenCopy({
      status: 'accepted', envelope, contentHash,
      semanticHash: compatibleRevision({ schemaVersion: envelope.schemaVersion, normalizerVersion: envelope.normalizerVersion, dialect: envelope.dialect, family: envelope.family, value: material }),
      diagnostics: [], value,
    });
  } catch (error) {
    if (!(error instanceof InvalidDocument)) throw error;
    return frozenCopy({ status: 'rejected', envelope, contentHash, semanticHash: null, diagnostics: [error.diagnostic], value: null });
  }
}
