import type { AcceptedResource, Decimal, ProviderReference, SourceScope } from './contracts';
import type { AdministrationEnvelope, JsonValue, NormalizedAdministrationObservation, SourceMatchup,
  ConfigurationBinding, ConfigurationPeriod } from '../league-administration/contracts';
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import { startingSlots } from '../sleeper-lineup';

export const EXACT_MATCHUPS_POLICY = Object.freeze({
  audienceId: 'public', coverageSpecId: 'sleeper-exact-period-all-teams-matchups-v1',
  canonicalNormalizerVersion: 'sleeper-exact-matchups-v1', validationVersion: 'latest-network-attempt-v1',
});

/** Sleeper's matchup endpoint week is a native competition period. An NFL mapping needs separate calendar proof. */
export function exactMatchupsScope(mapping: AdministrationSourceMapping, week: number): SourceScope {
  if (!Number.isSafeInteger(week) || week < 1 || week > 18) throw new Error('Invalid native matchup period.');
  return { kind: 'enrolled-resource', connectionId: mapping.connectionId, leagueSeasonId: mapping.leagueSeasonId,
    family: 'matchups', entityId: null, scoringPeriodId: `sleeper:matchup-week:${week}`,
    audienceId: EXACT_MATCHUPS_POLICY.audienceId, coverageSpecId: EXACT_MATCHUPS_POLICY.coverageSpecId };
}

export type NativeMatchupPeriod = Readonly<{
  source: ProviderReference; season: number; nativeWeek: number;
  /** Empty until calendar evidence proves the relationship. */
  nflWeekMappings: readonly Readonly<{ season: number; seasonType: string; week: number; evidenceRef: string }>[];
}>;
export type OfficialPoint = Decimal | null;
export type ExactLineupSlot = Readonly<{
  index: number; nativeSlot: string | null; playerExternalId: string | null; empty: boolean;
  officialPoints: OfficialPoint; pointSource: 'starter-index' | 'player-map' | 'missing';
}>;
export type ExactBenchEntry = Readonly<{ playerExternalId: string; officialPoints: OfficialPoint }>;
export type ExactMatchupTeam = Readonly<{
  seasonTeamId: string; externalRosterId: string; nativeMatchupId: string | null;
  players: readonly string[] | null; starters: readonly ExactLineupSlot[] | null;
  bench: readonly ExactBenchEntry[] | null;
  /** Exact nonstarter membership is weaker than a complete, slot-qualified bench. */
  nonstarters: Readonly<{ state: 'known'; players: readonly ExactBenchEntry[] }>
    | Readonly<{ state: 'unknown'; reason: 'membership_or_starters_missing' | 'membership_inconsistent' }>;
  reserveAndTaxi: { state: 'unknown'; reason: 'period_reserve_evidence_missing' };
  officialPlayerPoints: Readonly<Record<string, OfficialPoint>> | null;
  officialTeamPoints: Readonly<{ raw: OfficialPoint; custom: OfficialPoint; effective: OfficialPoint;
    adjustment: 'custom-override' | 'none' | 'unknown'; adjustmentReason: null }>;
  coverage: { status: 'complete' | 'partial'; reasons: readonly string[] };
}>;
export type ExactMatchupGroup = Readonly<{
  nativeMatchupId: string | null; identity: string;
  participantTeamIds: readonly string[];
  /** A single participant is represented without a synthetic opponent. */
  format: 'paired' | 'unpaired' | 'multiple-participants';
  resultSupport: 'supported' | 'limited';
}>;
export type ExactMatchupValue = Readonly<{
  period: NativeMatchupPeriod; teams: readonly ExactMatchupTeam[]; groups: readonly ExactMatchupGroup[];
  state: { provider: 'unknown'; local: 'unknown'; reason: 'no_matchup_finality_evidence' };
  lineupDefinitionRef: string | null; playerMetadataRef: null; gameStateRef: null; projectionRef: null;
}>;
export type ExactPeriodMappingQualification = Readonly<{
  status: 'mapped'; purpose: 'native-period-identity'; evidenceRef: string;
  policyVersion: string; scheduleRevision: string; evaluatedAt: string;
  retrievalStartedAt: string; retrievalCompletedAt: string; sourceObservedAt: null;
  season: number; seasonType: 'regular'; week: number;
}> | Readonly<{ status: 'unmapped'; reason: 'calendar_evidence_missing' | 'calendar_evidence_invalid' | 'league_format_unqualified' }>;

export type ExactLineupApplicability = Readonly<{
  status: 'available'; activationRef: string; configurationVersionId: string; componentHash: string;
  sourceMappingRevisionId: string; periodMappingRef: string; period: ConfigurationPeriod;
  recordedAt: string; evidence: ConfigurationBinding['evidence'];
  nativeRosterPositions: readonly string[]; startingSlots: readonly string[];
}> | Readonly<{ status: 'unavailable'; reason: 'period_mapping_unproved' | 'no_binding'
  | 'missing_version' | 'inconsistent_binding' | 'roster_positions_missing' | 'invalid_applicability_evidence' }>;

export type AcceptedExactMatchupsRead = Readonly<{
  status: 'available'; accepted: AcceptedResource; value: ExactMatchupValue;
  periodMapping: ExactPeriodMappingQualification;
  lineupApplicability?: ExactLineupApplicability;
  receipt: { id: string; attemptId: string; ordinal: number; legacyObservationId: string; configurationContentId: string;
    provenance: AdministrationEnvelope['provenance']; rawContentHash: string; expectedTeamCount: number };
  comparison: { status: 'equal'; fields: readonly string[] };
}> | Readonly<{ status: 'missing' | 'unavailable' | 'disabled'; reason?: string }>;

function record(value: JsonValue, path: string): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${path}.`);
  return value as Record<string, JsonValue>;
}
function sourceNumber(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
/** The shortest round-trippable decimal of the parsed JSON number, never a claim about lost source lexical scale. */
export function parsedOfficialDecimal(value: number | null): Decimal | null {
  if (value === null) return null;
  const source = Object.is(value, -0) ? '0' : String(value);
  if (!/[eE]/.test(source)) return source;
  const [mantissa, exponentText] = source.split(/[eE]/);
  const negative = mantissa.startsWith('-');
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const point = unsigned.indexOf('.');
  const digits = unsigned.replace('.', '');
  const offset = (point < 0 ? unsigned.length : point) + Number(exponentText);
  const expanded = offset <= 0 ? `0.${'0'.repeat(-offset)}${digits}`
    : offset >= digits.length ? `${digits}${'0'.repeat(offset - digits.length)}`
      : `${digits.slice(0, offset)}.${digits.slice(offset)}`;
  return negative ? `-${expanded}` : expanded;
}
function score(value: JsonValue | undefined): Decimal | null { return parsedOfficialDecimal(sourceNumber(value)); }
function ids(value: JsonValue | undefined): string[] | null {
  return Array.isArray(value) ? value as string[] : null;
}

/** Pure same-capture projection. The legacy normalized value/hash is never changed. */
export function projectExactMatchups(
  normalized: NormalizedAdministrationObservation,
  seasonTeams: readonly Readonly<{ seasonTeamId: string; externalRosterId: string }>[],
  slotEvidence?: Readonly<{ nativePeriodWeek: number; season: number; externalLeagueId: string;
    nativeRosterPositions: readonly string[]; evidenceRef: string }>,
): ExactMatchupValue {
  const { envelope, value } = normalized;
  if (normalized.status !== 'accepted' || value?.family !== 'matchups' || envelope.family !== 'matchups'
    || envelope.week === null || envelope.completeness !== 'complete' || !Array.isArray(envelope.payload)) {
    throw new Error('Complete exact matchup capture required.');
  }
  const teamIds = new Map(seasonTeams.map(team => [team.externalRosterId, team.seasonTeamId]));
  if (teamIds.size !== seasonTeams.length || teamIds.size !== value.matchups.length || envelope.payload.length !== value.matchups.length) {
    throw new Error('Matchup population identity mismatch.');
  }
  const slots = slotEvidence?.nativePeriodWeek === envelope.week && slotEvidence.season === envelope.scope.season
    && slotEvidence.externalLeagueId === envelope.scope.externalLeagueId && slotEvidence.evidenceRef
    ? startingSlots(slotEvidence.nativeRosterPositions) : null;
  const rawByRoster = new Map<string, Record<string, JsonValue>>();
  for (const source of envelope.payload) {
    const raw = record(source, 'matchup row');
    const id = String(raw.roster_id);
    if (rawByRoster.has(id)) throw new Error('Duplicate matchup roster.');
    rawByRoster.set(id, raw);
  }
  const teams = value.matchups.map((entry: SourceMatchup): ExactMatchupTeam => {
    const seasonTeamId = teamIds.get(entry.externalRosterId);
    const raw = rawByRoster.get(entry.externalRosterId);
    if (!seasonTeamId || !raw) throw new Error('Unmapped matchup participant.');
    const rawPlayers = ids(raw.players);
    const rawStarters = ids(raw.starters);
    const starterPoints = Array.isArray(raw.starters_points) ? raw.starters_points : null;
    const pointMap = raw.players_points == null ? null : record(raw.players_points, 'players_points');
    if (JSON.stringify(rawPlayers) !== JSON.stringify(entry.playerExternalIds)
      || JSON.stringify(rawStarters) !== JSON.stringify(entry.starterExternalIds)
      || sourceNumber(raw.points) !== entry.points || sourceNumber(raw.custom_points) !== entry.customPoints) {
      throw new Error('Legacy and raw matchup evidence disagree.');
    }
    const slotCountProved = slots !== null && rawStarters !== null && slots.length === rawStarters.length;
    const starters = rawStarters?.map((player, index): ExactLineupSlot => {
      const empty = player === '0';
      const indexed = starterPoints && index < starterPoints.length ? score(starterPoints[index]) : null;
      const mapped = empty || !pointMap ? null : score(pointMap[player]);
      return { index, nativeSlot: slotCountProved ? slots[index] : null, playerExternalId: empty ? null : player, empty,
        officialPoints: empty ? null : indexed ?? mapped,
        pointSource: empty ? 'missing' : indexed !== null ? 'starter-index' : mapped !== null ? 'player-map' : 'missing' };
    }) ?? null;
    const starterIds = new Set(rawStarters?.filter(player => player !== '0') ?? []);
    const reasons: string[] = [];
    if (rawStarters === null) reasons.push('starters_missing');
    if (rawPlayers === null) reasons.push('players_missing');
    if (!slotCountProved) reasons.push('slot_definition_unproved');
    if (rawPlayers?.includes('0')) reasons.push('invalid_player_vacancy');
    if (rawPlayers && rawStarters && rawStarters.some(player => player !== '0' && !rawPlayers.includes(player))) {
      reasons.push('starter_outside_membership');
    }
    if (entry.points === null && entry.customPoints === null) reasons.push('team_points_missing');
    if (rawPlayers && rawPlayers.some(player => score(pointMap?.[player]) === null)) reasons.push('player_points_incomplete');
    const nonstarterPlayers = rawPlayers && rawStarters
      && !reasons.includes('starter_outside_membership') && !reasons.includes('invalid_player_vacancy')
      ? rawPlayers.filter(player => !starterIds.has(player)).map(player => ({
        playerExternalId: player, officialPoints: pointMap ? score(pointMap[player]) : null,
      })) : null;
    const nonstarters: ExactMatchupTeam['nonstarters'] = nonstarterPlayers !== null
      ? { state: 'known', players: nonstarterPlayers }
      : { state: 'unknown', reason: rawPlayers === null || rawStarters === null
        ? 'membership_or_starters_missing' : 'membership_inconsistent' };
    // Explicitly empty membership has no possible bench members even when slot labels are unknown.
    const bench = slotCountProved || (rawPlayers?.length === 0 && rawStarters?.length === 0) ? nonstarterPlayers : null;
    const effective = entry.customPoints ?? entry.points;
    return { seasonTeamId, externalRosterId: entry.externalRosterId, nativeMatchupId: entry.externalMatchupId,
      players: rawPlayers, starters, bench, nonstarters, reserveAndTaxi: { state: 'unknown', reason: 'period_reserve_evidence_missing' },
      officialPlayerPoints: pointMap ? Object.fromEntries(Object.entries(pointMap).map(([id, points]) => [id, score(points)])) : null,
      officialTeamPoints: { raw: parsedOfficialDecimal(entry.points), custom: parsedOfficialDecimal(entry.customPoints), effective: parsedOfficialDecimal(effective),
        adjustment: entry.customPoints !== null ? 'custom-override' : entry.points !== null ? 'none' : 'unknown',
        adjustmentReason: null },
      coverage: { status: reasons.length ? 'partial' : 'complete', reasons } };
  });
  const grouped = new Map<string, ExactMatchupTeam[]>();
  for (const team of teams) {
    const key = team.nativeMatchupId === null ? `solo:${team.externalRosterId}` : `matchup:${team.nativeMatchupId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), team]);
  }
  const groups = [...grouped].map(([identity, members]): ExactMatchupGroup => ({
    identity: JSON.stringify(['sleeper', envelope.scope.externalLeagueId, envelope.scope.season, envelope.week, identity]),
    nativeMatchupId: members[0].nativeMatchupId,
    participantTeamIds: members.map(team => team.seasonTeamId).sort(),
    format: members.length === 1 ? 'unpaired' : members.length === 2 ? 'paired' : 'multiple-participants',
    resultSupport: members.length === 2 ? 'supported' : 'limited',
  }));
  return { period: { source: { provider: 'sleeper', resourceKind: 'competition-period',
    nativeNamespace: envelope.scope.externalLeagueId, nativeId: String(envelope.week) },
    season: envelope.scope.season, nativeWeek: envelope.week, nflWeekMappings: [] },
    teams, groups, state: { provider: 'unknown', local: 'unknown', reason: 'no_matchup_finality_evidence' },
    lineupDefinitionRef: slots ? slotEvidence!.evidenceRef : null,
    playerMetadataRef: null, gameStateRef: null, projectionRef: null };
}
