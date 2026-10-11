import type { SourceScope } from './contracts';
import type { AdministrationEnvelope, JsonObject, JsonValue, NormalizedAdministrationObservation } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../league-administration/source-mapping';
import { compatibleRevision } from '../projections/shared/revision-compatibility';

export const BRACKET_VALUE_VERSION = 'sleeper-playoff-brackets-v1' as const;
export const BRACKET_POLICY = Object.freeze({ audienceId: 'public', coverageSpecId: BRACKET_VALUE_VERSION,
  canonicalNormalizerVersion: BRACKET_VALUE_VERSION, validationVersion: 'latest-network-attempt-v1' });
export const BRACKET_MATCH_LIMIT = 1_024;
export const BRACKET_PAYLOAD_BYTE_LIMIT = 8 * 1_024 * 1_024;
export type BracketFamily = 'winners_bracket' | 'losers_bracket';
/** Raw JSON preserves numeric/string roster identities and unknown reference fields. */
export type BracketField<T> = Readonly<{ state: 'missing' | 'null'; raw: null; value: null }>
  | Readonly<{ state: 'unsupported'; raw: JsonValue; value: null }>
  | Readonly<{ state: 'supplied'; raw: JsonValue; value: T }>;
export type BracketAdvancement = Readonly<{ outcome: 'winner' | 'loser'; externalMatchupId: string }>;
export type BracketEntrantValue = Readonly<{ kind: 'roster'; externalRosterId: string }>
  | Readonly<{ kind: 'advancement' } & BracketAdvancement>;
export type BracketEntrant = Readonly<{
  slot: 1 | 2; native: BracketField<BracketEntrantValue>; from: BracketField<BracketAdvancement>;
}>;
export type BracketMatch = Readonly<{
  externalMatchupId: string; round: number; sourceOrdinal: number;
  entrants: readonly BracketEntrant[];
  winner: BracketField<string>; loser: BracketField<string>;
  /** The provider sample contains p but does not define it as rank, seed or final placement. */
  nativePosition: BracketField<JsonValue>; extensions: JsonObject;
}>;
export type BracketEdge = Readonly<{
  targetMatchupId: string; slot: 1 | 2; sourceMatchupId: string; outcome: 'winner' | 'loser';
  origin: 'embedded' | 'explicit' | 'both'; sourceMatchPresent: boolean;
}>;
/** Rounds and match IDs belong to this bracket. Neither is a native scoring period or weekly matchup ID. */
export type PlayoffBracketValue = Readonly<{
  family: BracketFamily; season: 2026; publication: 'published' | 'unpublished';
  rounds: readonly Readonly<{ round: number; externalMatchupIds: readonly string[] }>[];
  matches: readonly BracketMatch[]; edges: readonly BracketEdge[];
  limitations: readonly ('unsupported_entrant_reference' | 'unresolved_advancement_source')[];
}>;
export type BracketDiagnostic = Readonly<{ code: string; path: string }>;
export type BracketNormalization = Readonly<{
  status: 'accepted'; version: typeof BRACKET_VALUE_VERSION; value: PlayoffBracketValue; diagnostics: readonly [];
}> | Readonly<{
  status: 'rejected'; version: typeof BRACKET_VALUE_VERSION; value: null; diagnostics: readonly BracketDiagnostic[];
}>;
export type BracketSelection = Readonly<{ family: BracketFamily; bracketReceiptId?: string }>;
export type AcceptedBracketRead = Readonly<{
  status: 'available'; version: typeof BRACKET_VALUE_VERSION; selection: 'current' | 'receipt';
  contentId: string; bracketReceiptId: string; acceptanceId: string; acceptedGeneration: number;
  sourceMappingRevisionId: string; provenance: AdministrationEnvelope['provenance']; value: PlayoffBracketValue;
}> | Readonly<{ status: 'missing' | 'disabled' | 'unavailable'; reason?: string }>;

export function bracketScope(mapping: AdministrationSourceMapping, family: BracketFamily): SourceScope {
  if (!isAdministrationSourceMapping(mapping) || mapping.scope.season !== 2026
    || family !== 'winners_bracket' && family !== 'losers_bracket') throw new Error('Invalid current-season bracket scope.');
  return { kind: 'enrolled-resource', connectionId: mapping.connectionId, leagueSeasonId: mapping.leagueSeasonId,
    family: 'playoff-brackets', entityId: family, scoringPeriodId: null,
    audienceId: BRACKET_POLICY.audienceId, coverageSpecId: BRACKET_POLICY.coverageSpecId };
}

class InvalidBracket extends Error {
  constructor(readonly code: string, readonly path: string) { super(code); }
}
function invalid(code: string, path: string): never { throw new InvalidBracket(code, path); }
function object(value: JsonValue): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid('invalid_bracket_object', 'payload');
  return value as JsonObject;
}
function field<T>(row: JsonObject, key: string, parse: (value: JsonValue) => T | null): BracketField<T> {
  if (!Object.hasOwn(row, key)) return { state: 'missing', raw: null, value: null };
  const raw = row[key];
  if (raw === null) return { state: 'null', raw: null, value: null };
  const value = parse(raw);
  return value === null ? { state: 'unsupported', raw, value: null } : { state: 'supplied', raw, value };
}
function advancement(value: JsonValue): BracketAdvancement | null {
  const reference = object(value);
  const key = reference.w != null ? 'w' : reference.l != null ? 'l' : null;
  return key === null ? null : { outcome: key === 'w' ? 'winner' : 'loser', externalMatchupId: String(reference[key]) };
}
function entrant(value: JsonValue): BracketEntrantValue | null {
  if (typeof value !== 'object') return { kind: 'roster', externalRosterId: String(value) };
  const reference = advancement(value);
  return reference === null ? null : { kind: 'advancement', ...reference };
}
function roster(value: BracketEntrant): string | null {
  return value.native.state === 'supplied' && value.native.value.kind === 'roster' ? value.native.value.externalRosterId : null;
}
function reject(code: string, path: string): BracketNormalization {
  return { status: 'rejected', version: BRACKET_VALUE_VERSION, value: null, diagnostics: [{ code, path }] };
}

/** An additive projection of the exact existing envelope; v1 values, hashes and acceptance never change here. */
export function projectPlayoffBracket(normalized: NormalizedAdministrationObservation): BracketNormalization {
  try {
    const envelope = normalized.envelope;
    if ((envelope.family !== 'winners_bracket' && envelope.family !== 'losers_bracket')
      || envelope.scope.provider !== 'sleeper' || envelope.scope.season !== 2026 || envelope.week !== null) {
      return reject('invalid_bracket_scope', 'envelope');
    }
    if (envelope.completeness !== 'complete') return reject('incomplete_bracket_capture', 'envelope.completeness');
    if (Array.isArray(envelope.payload) && envelope.payload.length > BRACKET_MATCH_LIMIT
      || Buffer.byteLength(JSON.stringify(envelope.payload), 'utf8') > BRACKET_PAYLOAD_BYTE_LIMIT) {
      return reject('bracket_capture_limit', 'payload');
    }
    // Revalidate the exact raw/v1 pair so callers cannot supply forged normalized facts or content identities.
    const checked = normalizeAdministrationObservation(envelope);
    if (checked.status !== 'accepted') return { status: 'rejected', version: BRACKET_VALUE_VERSION,
      value: null, diagnostics: checked.diagnostics.map(({ code, path }) => ({ code, path })) };
    if (normalized.status !== 'accepted' || normalized.contentHash !== checked.contentHash
      || normalized.semanticHash !== checked.semanticHash || compatibleRevision(normalized.value) !== compatibleRevision(checked.value)) {
      return reject('bracket_native_normalized_mismatch', 'value');
    }
    if (envelope.payload === null) return { status: 'accepted', version: BRACKET_VALUE_VERSION, diagnostics: [],
      value: { family: envelope.family, season: 2026, publication: 'unpublished', rounds: [], matches: [], edges: [], limitations: [] } };
    const rows = envelope.payload as readonly JsonValue[];
    const matches: BracketMatch[] = rows.map((entry, sourceOrdinal) => {
      const row = object(entry);
      return { externalMatchupId: String(row.m), round: row.r as number, sourceOrdinal,
        entrants: ([1, 2] as const).map(slot => ({ slot, native: field(row, `t${slot}`, entrant),
          from: field(row, `t${slot}_from`, advancement) })),
        winner: field(row, 'w', value => String(value)), loser: field(row, 'l', value => String(value)),
        nativePosition: field(row, 'p', value => value),
        extensions: Object.fromEntries(Object.entries(row).filter(([key]) => !['r', 'm', 't1', 't2', 't1_from', 't2_from', 'w', 'l', 'p'].includes(key))) };
    });
    const byId = new Map(matches.map(match => [match.externalMatchupId, match]));
    const edges: BracketEdge[] = [];
    const limitations = new Set<PlayoffBracketValue['limitations'][number]>();
    for (const match of matches) {
      const path = `payload[${match.sourceOrdinal}]`;
      const first = roster(match.entrants[0]), second = roster(match.entrants[1]);
      if (first !== null && first === second) invalid('duplicate_bracket_entrant', path);
      if (match.winner.state === 'supplied' && match.loser.state === 'supplied' && match.winner.value === match.loser.value) {
        invalid('conflicting_bracket_results', path);
      }
      for (const [key, result] of [['w', match.winner], ['l', match.loser]] as const) {
        if (result.state === 'supplied' && first !== null && second !== null && result.value !== first && result.value !== second) {
          invalid('bracket_result_outside_entrants', `${path}.${key}`);
        }
      }
      for (const participant of match.entrants) {
        if (participant.native.state === 'unsupported' || participant.from.state === 'unsupported') {
          limitations.add('unsupported_entrant_reference');
        }
        const embedded = participant.native.state === 'supplied' && participant.native.value.kind === 'advancement'
          ? participant.native.value : null;
        const explicit = participant.from.state === 'supplied' ? participant.from.value : null;
        const reference = explicit ?? embedded;
        if (reference === null) continue;
        const source = byId.get(reference.externalMatchupId);
        const resolvedRoster = roster(participant);
        const result = source?.[reference.outcome];
        if (resolvedRoster !== null && result?.state === 'supplied' && resolvedRoster !== result.value) {
          invalid('conflicting_bracket_advancement', `${path}.t${participant.slot}`);
        }
        if (!source) limitations.add('unresolved_advancement_source');
        edges.push({ targetMatchupId: match.externalMatchupId, slot: participant.slot,
          sourceMatchupId: reference.externalMatchupId, outcome: reference.outcome,
          origin: embedded && explicit ? 'both' : explicit ? 'explicit' : 'embedded', sourceMatchPresent: !!source });
      }
    }
    // Kahn's bounded graph traversal catches cycles without imposing any unproved round/week ordering.
    const degree = new Map(matches.map(match => [match.externalMatchupId, 0]));
    const outgoing = new Map<string, string[]>();
    for (const edge of edges) if (edge.sourceMatchPresent) {
      degree.set(edge.targetMatchupId, degree.get(edge.targetMatchupId)! + 1);
      outgoing.set(edge.sourceMatchupId, [...(outgoing.get(edge.sourceMatchupId) ?? []), edge.targetMatchupId]);
    }
    const queue = [...degree].filter(([, count]) => count === 0).map(([id]) => id);
    for (let index = 0; index < queue.length; index++) for (const target of outgoing.get(queue[index]) ?? []) {
      degree.set(target, degree.get(target)! - 1);
      if (degree.get(target) === 0) queue.push(target);
    }
    if (queue.length !== matches.length) invalid('cyclic_bracket_advancement', 'payload');
    const rounds = new Map<number, string[]>();
    for (const match of matches) rounds.set(match.round, [...(rounds.get(match.round) ?? []), match.externalMatchupId]);
    return { status: 'accepted', version: BRACKET_VALUE_VERSION, diagnostics: [], value: {
      family: envelope.family, season: 2026, publication: 'published',
      rounds: [...rounds].sort(([left], [right]) => left - right).map(([round, externalMatchupIds]) => ({ round, externalMatchupIds })),
      matches, edges, limitations: [...limitations].sort() } };
  } catch (error) {
    return error instanceof InvalidBracket ? reject(error.code, error.path) : reject('invalid_bracket_observation', 'envelope');
  }
}
