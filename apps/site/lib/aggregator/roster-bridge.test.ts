import { describe, expect, it } from 'vitest';
import { projectRetainedRoster } from './roster-bridge';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { AdministrationEnvelope, JsonValue } from '../league-administration/contracts';
import type { LeagueAdministrationStoreRead } from '../league-administration/store-contracts';

const observed = '2026-09-28T12:00:01.000Z';
const checked = '2026-09-28T12:00:02.000Z';
const payload = [{ roster_id: 7, owner_id: 'manager', players: ['001', 'DEF'],
  starters: ['001', '0'], reserve: [], taxi: null, settings: { fpts: 87, fpts_decimal: 25 },
  future_provider_field: { unknown: 'retained verbatim' } }];

function capture(raw: JsonValue = payload) {
  const envelope: AdministrationEnvelope = {
    schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: 'source', season: 2026 },
    family: 'rosters', week: null, completeness: 'complete', payload: raw,
    provenance: { origin: 'network', requestStartedAt: '2026-09-28T12:00:00.000Z',
      requestCompletedAt: observed, sourceObservedAt: observed, checkedAt: checked },
  };
  const normalized = normalizeAdministrationObservation(envelope);
  const read: Extract<LeagueAdministrationStoreRead, { status: 'available' }> = {
    status: 'available', envelope, observationId: 'observation-uuid', versionId: null,
    generation: 3, checkedAt: checked, verifiedAt: observed,
  };
  const evidence = { league_season_id: 'season-uuid', content_id: 'content-uuid', content_hash: normalized.contentHash,
    observation_checked_at: checked, roster_team_identities: [{ seasonTeamId: 'existing-team-uuid', externalRosterId: '7' }] };
  return { read, evidence, normalized };
}

describe('retained Sleeper roster common projection', () => {
  it('exposes exact observation mapping without claiming v2 acceptance, and refuses malformed linkage', () => {
    const { read, evidence, normalized } = capture();
    const linked = { ...evidence, source_mapping_revision_id: 'revision-a', source_connection_id: 'connection-a', source_mapping_generation: '3',
      mapping_league_season_id: evidence.league_season_id, mapping_provider: 'sleeper', mapping_external_league_id: 'source' };
    expect(projectRetainedRoster(read, linked, normalized)).toMatchObject({ kind: 'legacy-retained-roster',
      lineage: { sourceMappingRevisionId: 'revision-a', sourceConnectionId: 'connection-a', mappingGeneration: 3,
        reasons: ['v2_acceptance_not_qualified'] } });
    expect(projectRetainedRoster(read, { ...linked, source_connection_id: null }, normalized))
      .toEqual({ status: 'unavailable', reason: 'retained_mapping_lineage_invalid' });
    for (const corrupt of [{ mapping_league_season_id: 'other-season' }, { mapping_provider: 'yahoo' }, { mapping_external_league_id: 'other-source' }]) {
      expect(projectRetainedRoster(read, { ...linked, ...corrupt }, normalized))
        .toEqual({ status: 'unavailable', reason: 'retained_mapping_lineage_invalid' });
    }
  });
  it('preserves persisted identity, native evidence and source age without claiming complete v2 mapping lineage', () => {
    const { read, evidence, normalized } = capture();
    const before = JSON.stringify(read);
    const result = projectRetainedRoster(read, evidence, normalized);
    expect(result).toMatchObject({ status: 'available', kind: 'legacy-retained-roster',
      scope: { leagueSeasonId: 'season-uuid' }, source: { sourceObservedAt: observed, sourceUpdatedAt: null, checkedAt: checked },
      lineage: { rawContentRef: 'content-uuid', observationId: 'observation-uuid', generation: 3,
        sourceMappingRevisionId: null, reasons: ['mapping_revision_not_captured'] },
      comparison: { status: 'equal' },
      featureSupport: { officialRoster: 'limited', exactPeriodLineup: 'unverified' },
      teams: [{ seasonTeamId: 'existing-team-uuid', groups: {
        roster: { availability: 'present', authority: 'provider-official', temporalContext: 'current-display', value: [
          { sourceEntity: { nativeId: '001' }, canonicalEntityId: null, identityState: 'unresolved', section: 'roster',
            effectiveFrom: null, effectiveEvidence: 'unknown' },
          { sourceEntity: { nativeId: 'DEF' } },
        ] }, reserve: { availability: 'empty', value: [], completeness: 'complete' },
        taxi: { availability: 'missing', value: null, completeness: 'unknown', reasons: ['source_field_missing'] },
      } }],
    });
    expect(JSON.stringify(read)).toBe(before);
    expect(read.envelope.payload).toEqual(payload); // Includes official numeric facts and unknown native extensions.
    expect(projectRetainedRoster(read, evidence, normalized)).toEqual(result);
  });

  it('separates original observation time from equal-content re-verification and does not infer cache age', () => {
    const { read, evidence } = capture();
    const later = '2026-09-28T12:05:00.000Z';
    const refreshed = { ...read, checkedAt: later, verifiedAt: later,
      envelope: { ...read.envelope, provenance: { ...read.envelope.provenance, checkedAt: later } } };
    expect(projectRetainedRoster(refreshed, evidence, normalizeAdministrationObservation(refreshed.envelope)))
      .toMatchObject({ source: { checkedAt: checked, sourceObservedAt: observed }, lineage: { verifiedAt: later } });
    const cached = { ...read, verifiedAt: null, envelope: { ...read.envelope, provenance: {
      ...read.envelope.provenance, origin: 'cache' as const, sourceObservedAt: null } } };
    expect(projectRetainedRoster(cached, evidence, normalizeAdministrationObservation(cached.envelope)))
      .toMatchObject({ source: { sourceObservedAt: null }, teams: [{ groups: { roster: { freshness: 'unknown' } } }] });
  });

  it('keeps corrections separate while reusing the existing team ID and preserving the previous projection', () => {
    const first = capture();
    const a = projectRetainedRoster(first.read, first.evidence, first.normalized);
    const next = capture([{ ...payload[0], players: ['replacement'], taxi: [] }]);
    const b = projectRetainedRoster({ ...next.read, observationId: 'correction-observation', generation: 4 },
      { ...next.evidence, content_id: 'correction-content' }, next.normalized);
    expect(b).toMatchObject({ lineage: { observationId: 'correction-observation', rawContentRef: 'correction-content' },
      teams: [{ seasonTeamId: 'existing-team-uuid', groups: { roster: { value: [{ sourceEntity: { nativeId: 'replacement' } }] } } }] });
    expect(projectRetainedRoster(first.read, first.evidence, first.normalized)).toEqual(a);
  });

  it.each([
    ['missing IDs', { roster_team_identities: [] }, 'retained_identity_incomplete'],
    ['duplicate aliases', { roster_team_identities: [{ seasonTeamId: 'one', externalRosterId: '7' }, { seasonTeamId: 'two', externalRosterId: '7' }] }, 'retained_identity_conflict'],
    ['extra alias', { roster_team_identities: [{ seasonTeamId: 'one', externalRosterId: '7' }, { seasonTeamId: 'two', externalRosterId: '8' }] }, 'retained_identity_incomplete'],
    ['other raw content', { content_hash: 'wrong' }, 'retained_content_mismatch'],
    ['unknown observation time', { observation_checked_at: null }, 'retained_observation_time_missing'],
  ])('withholds only the common projection for %s', (_label, patch, reason) => {
    const { read, evidence, normalized } = capture();
    expect(projectRetainedRoster(read, { ...evidence, ...patch }, normalized)).toEqual({ status: 'unavailable', reason });
    expect(read.status).toBe('available');
  });

  it('never treats partial or invalid collections as a complete replacement', () => {
    const { read, evidence } = capture();
    const envelope = { ...read.envelope, completeness: 'partial' as const };
    expect(projectRetainedRoster({ ...read, envelope }, evidence, normalizeAdministrationObservation(envelope)))
      .toMatchObject({ status: 'unavailable', reason: 'complete_roster_capture_required' });
    const bad = capture([{ roster_id: 7 }, { roster_id: 7 }]);
    expect(projectRetainedRoster(bad.read, bad.evidence, bad.normalized)).toMatchObject({ status: 'unavailable' });
  });

  it('does not merge reused roster numbers across league or season namespaces', () => {
    const one = capture(); const two = capture();
    const other = { ...two.read, envelope: { ...two.read.envelope, scope: {
      ...two.read.envelope.scope, externalLeagueId: 'other', season: 2027 } } };
    const a = projectRetainedRoster(one.read, one.evidence, one.normalized);
    const b = projectRetainedRoster(other, { ...two.evidence, league_season_id: 'other-season',
      roster_team_identities: [{ seasonTeamId: 'other-team', externalRosterId: '7' }] }, normalizeAdministrationObservation(other.envelope));
    if (a.status !== 'available' || b.status !== 'available') throw new Error('Expected available projections.');
    expect(b.teams[0].sourceTeam.nativeNamespace).not.toBe(a.teams[0].sourceTeam.nativeNamespace);
    expect(b.teams[0].seasonTeamId).not.toBe(a.teams[0].seasonTeamId);
  });
});
