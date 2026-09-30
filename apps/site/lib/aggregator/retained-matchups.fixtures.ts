/** Synthetic immutable evidence shared by planner/projection tests; never imported by runtime code. */
import type { AdministrationEnvelope, JsonValue } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { RetainedMatchupEvidence, RetainedMatchupSelection } from '../league-administration/retained-matchups-contracts';

export const retainedMatchupId = (number: number) => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export const retainedMatchupSelection: RetainedMatchupSelection = {
  leagueSeasonId: retainedMatchupId(1),
  scope: { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: 'source-2026', season: 2026 }, nativeWeeks: [3],
};
export const retainedMatchupPayload: JsonValue = [
  { roster_id: 1, matchup_id: 8, players: ['001', 'DEF'], starters: ['001', '0'],
    starters_points: [0, null], players_points: { '001': 13.25, DEF: -2.5 }, points: 10.75, custom_points: 0 },
  { roster_id: 2, matchup_id: 8, players: ['c'], starters: ['c'],
    starters_points: [7.5], players_points: { c: 9 }, points: 7.5 },
  { roster_id: 3, matchup_id: null, players: [], starters: [], points: null },
];

export function retainedMatchupFixture(options: {
  selection?: RetainedMatchupSelection; payload?: JsonValue; observationNumber?: number;
  contentNumber?: number; week?: number; capturedMapping?: boolean;
} = {}): RetainedMatchupEvidence {
  const selection = options.selection ?? retainedMatchupSelection;
  const week = options.week ?? selection.nativeWeeks[0];
  const envelope: AdministrationEnvelope = { schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: selection.scope,
    family: 'matchups', week, completeness: 'complete', payload: options.payload ?? retainedMatchupPayload,
    provenance: { origin: 'network', requestStartedAt: '2026-09-29T12:00:00.000000Z',
      requestCompletedAt: '2026-09-29T12:00:01.000123Z', sourceObservedAt: '2026-09-29T12:00:01.000123Z',
      checkedAt: '2026-09-29T12:00:02.000456Z' } };
  const normalized = normalizeAdministrationObservation(envelope);
  if (normalized.status !== 'accepted' || normalized.value?.family !== 'matchups') throw new Error('Invalid synthetic matchup fixture.');
  const observationId = retainedMatchupId(options.observationNumber ?? 2);
  const contentId = retainedMatchupId(options.contentNumber ?? 3);
  return { league: { leagueSeasonId: selection.leagueSeasonId, leagueKey: selection.scope.leagueKey, season: selection.scope.season },
    observation: { id: observationId, leagueSeasonId: selection.leagueSeasonId, family: 'matchups', week,
      contentId, provenance: envelope.provenance, orderingAt: envelope.provenance.sourceObservedAt!,
      recordedAt: '2026-09-29T12:00:03.000789Z', outcome: 'changed' },
    content: { id: contentId, leagueSeasonId: selection.leagueSeasonId, provider: selection.scope.provider,
      externalLeagueId: selection.scope.externalLeagueId, family: 'matchups', week,
      normalizerVersion: envelope.normalizerVersion, contentHash: normalized.contentHash,
      semanticHash: normalized.semanticHash, completeness: 'complete', accepted: true,
      payload: envelope.payload, normalizedValue: normalized.value as JsonValue },
    teamLinks: normalized.value.matchups.map((source, index) => ({ contentId, leagueSeasonId: selection.leagueSeasonId,
      teamId: retainedMatchupId(100 + index), sourceValue: source as JsonValue,
      team: { id: retainedMatchupId(100 + index), leagueSeasonId: selection.leagueSeasonId,
        provider: selection.scope.provider, externalLeagueId: selection.scope.externalLeagueId,
        externalRosterId: source.externalRosterId } })),
    mappingCandidates: [],
    mapping: options.capturedMapping ? { observationId, revisionId: retainedMatchupId(4), revision: {
      id: retainedMatchupId(4), connectionId: retainedMatchupId(5), leagueSeasonId: selection.leagueSeasonId,
      provider: selection.scope.provider, externalLeagueId: selection.scope.externalLeagueId,
      sourceNamespace: `nfl:${selection.scope.season}`, generation: 1 } } : null };
}
