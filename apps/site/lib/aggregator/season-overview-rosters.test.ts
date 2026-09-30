import { describe, expect, it } from 'vitest';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { AdministrationEnvelope, JsonObject, JsonValue } from '../league-administration/contracts';
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import type { LeagueAdministrationStoreRead } from '../league-administration/store-contracts';
import { compareTeams, normalizeTeams } from '../transform';
import { resolveSiteWeek, resolveWeeklyPlayerMetrics } from '../site-week';
import { CURRENT_ROSTER_POLICY, currentRosterScope, type AcceptedCurrentRosterRead } from './current-roster';
import { projectCurrentRosterGroups } from './current-roster-groups';
import { TEAM_MANAGERS_POLICY, teamManagersScope, type AcceptedTeamManagersRead } from './team-managers';
import { EXACT_MATCHUPS_POLICY, exactMatchupsScope, projectExactMatchups, type AcceptedExactMatchupsRead } from './exact-matchups';
import { projectSeasonOverviewSource } from './season-overview-source';
import { buildSeasonManagerDirectory, buildSeasonRosterSummaries, buildSeasonTeamCompatibility,
  joinSeasonPlayerMetrics, type SeasonPlayerMetricInput } from './season-overview-rosters';
import type { RosterMembership } from './contracts';
import schedule from '../../test-support/fixtures/sleeper-2026-season-schedule.json';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const mapping: AdministrationSourceMapping = { connectionId: id(1), leagueSeasonId: id(2), revisionId: id(3), generation: 1,
  scope: { provider: 'sleeper', leagueKey: 'league1', externalLeagueId: 'fixture-source', season: 2026 } };
const provenance: AdministrationEnvelope['provenance'] = { origin: 'network', requestStartedAt: '2026-09-25T12:00:00.000Z',
  requestCompletedAt: '2026-09-25T12:00:01.000Z', sourceObservedAt: '2026-09-25T12:00:01.000Z', checkedAt: '2026-09-25T12:00:02.000Z' };
const now = new Date('2026-09-26T12:00:00.000Z');
const rawRosters: JsonObject[] = [1, 2].map(roster => ({ roster_id: roster, owner_id: `owner${roster}`, co_owners: [],
  players: [String(1000 + roster)], starters: [String(1000 + roster)], reserve: [], taxi: [],
  settings: { wins: 1, losses: 0, ties: 0, fpts: 100, fpts_decimal: 0, fpts_against: roster * 10 },
  metadata: { team_name: roster === 1 ? 'Alpha' : 'Zulu' } }));

function envelope(family: AdministrationEnvelope['family'], payload: JsonValue, scope = mapping.scope, week: number | null = null): AdministrationEnvelope {
  return { schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope, family, week, completeness: 'complete', provenance, payload };
}
function fixture(raw: readonly JsonObject[] = rawRosters, sourceMapping = mapping) {
  const normalized = normalizeAdministrationObservation(envelope('rosters', raw, sourceMapping.scope), { expectedRosterCount: raw.length });
  if (normalized.value?.family !== 'rosters') throw new Error('Invalid fixture.');
  const accepted = { scope: currentRosterScope(sourceMapping), canonicalNormalizerVersion: CURRENT_ROSTER_POLICY.canonicalNormalizerVersion,
    sourceMappingRevisionId: sourceMapping.revisionId, contentId: id(4), observationIds: [id(5)],
    validationVersion: CURRENT_ROSTER_POLICY.validationVersion, acceptedGeneration: 1,
    verifiedAt: provenance.sourceObservedAt, effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' as const };
  const receipt = { id: id(5), attemptId: id(6), ordinal: 1, provenance, configurationContentId: id(7), expectedTeamCount: raw.length, legacyObservationId: id(8) };
  const teams = normalized.value.teams.map(team => {
    const seasonTeamId = id(20 + Number(team.externalRosterId));
    const sourceTeam = { provider: 'sleeper' as const, resourceKind: 'team',
      nativeNamespace: JSON.stringify(['nfl', sourceMapping.scope.season, sourceMapping.scope.externalLeagueId]), nativeId: team.externalRosterId };
    const players: RosterMembership[] = (team.playerExternalIds ?? []).map(nativeId => ({ seasonTeamId, sourceTeam,
      sourceEntity: { provider: 'sleeper', resourceKind: 'scoring-entity', nativeNamespace: 'nfl', nativeId }, canonicalEntityId: null,
      identityState: 'unresolved', nativeSection: 'players', section: 'roster', effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' }));
    return { seasonTeamId, externalRosterId: team.externalRosterId, players, currentGroups: projectCurrentRosterGroups(team, players, receipt.id, provenance) };
  });
  const source = projectSeasonOverviewSource({ normalized, mapping: sourceMapping, accepted, receipt, seasonTeams: teams });
  if (source.status !== 'available') throw new Error('Invalid source.');
  const currentRoster: AcceptedCurrentRosterRead = { status: 'available', accepted, receipt, teams };
  const managerIdentity = (externalId: string) => ({ providerManagerId: id(externalId === 'owner1' ? 31 : 32),
    sourceManager: { provider: 'sleeper' as const, resourceKind: 'manager', nativeNamespace: 'account', nativeId: externalId } });
  const managers: AcceptedTeamManagersRead = { status: 'available', accepted: { ...accepted, scope: teamManagersScope(sourceMapping),
    canonicalNormalizerVersion: TEAM_MANAGERS_POLICY.canonicalNormalizerVersion, observationIds: [id(9)] }, receipt: { ...receipt, id: id(9) },
  teams: normalized.value.teams.map(team => ({ seasonTeamId: id(20 + Number(team.externalRosterId)),
    sourceTeam: { provider: 'sleeper', resourceKind: 'team', nativeNamespace: JSON.stringify(['nfl', sourceMapping.scope.season, sourceMapping.scope.externalLeagueId]), nativeId: team.externalRosterId },
    primaryOwner: team.primaryOwnerExternalId === null ? { state: 'unowned', manager: null } : { state: 'owned', manager: managerIdentity(team.primaryOwnerExternalId) },
    coManagers: { state: 'known', completeness: 'complete', sourceRefs: [id(9)], observedAt: provenance.sourceObservedAt!,
      managers: team.coOwnerExternalIds.map(managerIdentity) }, assurance: 'provider-observed', effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' })) };
  const users: LeagueAdministrationStoreRead = { status: 'available', observationId: id(40), versionId: null, generation: 1,
    checkedAt: '2026-09-24T12:00:02.000Z', verifiedAt: '2026-09-24T12:00:01.000Z',
    envelope: { ...envelope('users', [{ user_id: 'owner1', display_name: 'First', avatar: 'avatar1' },
      { user_id: 'owner2', username: 'Second' }], sourceMapping.scope), provenance: { ...provenance,
      requestStartedAt: '2026-09-24T12:00:00.000Z', requestCompletedAt: '2026-09-24T12:00:01.000Z',
      sourceObservedAt: '2026-09-24T12:00:01.000Z', checkedAt: '2026-09-24T12:00:02.000Z' } } };
  return { mapping: sourceMapping, source, currentRoster, managers, users, now };
}
function matchup(week: number, scores: readonly (number | null)[] = [10, 20], customZero = false): AcceptedExactMatchupsRead {
  const normalized = normalizeAdministrationObservation(envelope('matchups', scores.map((points, index) => ({ roster_id: index + 1,
    matchup_id: 1, players: [String(1001 + index)], starters: [String(1001 + index)], points,
    ...(customZero && index === 0 ? { custom_points: 0 } : {}) })), mapping.scope, week), { expectedRosterCount: scores.length });
  const value = projectExactMatchups(normalized, scores.map((_, index) => ({ seasonTeamId: id(21 + index), externalRosterId: String(index + 1) })));
  return { status: 'available', value, accepted: { ...fixture().currentRoster.accepted, scope: exactMatchupsScope(mapping, week),
    canonicalNormalizerVersion: EXACT_MATCHUPS_POLICY.canonicalNormalizerVersion, contentId: id(100 + week) },
  receipt: { ...fixture().currentRoster.receipt, id: id(200 + week), legacyObservationId: id(300 + week), rawContentHash: normalized.contentHash },
  periodMapping: { status: 'unmapped', reason: 'calendar_evidence_missing' }, comparison: { status: 'equal', fields: [] } };
}
function summaries(input = fixture(), history: readonly AcceptedExactMatchupsRead[] = [matchup(1)]) {
  return buildSeasonRosterSummaries({ ...input, history,
    boundary: { selectedWeek: 2, activeWeek: 2, lastScoredWeek: 1, lifecycle: 'active' } });
}
function metricInput(): SeasonPlayerMetricInput {
  return { mapping, sourceMapping: mapping, expectedScoringProfileId: id(70), selectedWeek: 2, now,
    window: { throughWeek: 2, asOf: '2026-09-22T08:00:00.000Z', nextRefreshAt: '2026-09-29T08:00:00.000Z', holdReason: null },
    request: { leagueKey: 'league1', provider: 'sleeper', season: 2026, seasonType: 'reg', throughWeek: 2,
      provisionalWeek: null, scorerVersion: 'sleeper-actual-v1', asOf: '2026-09-22T08:00:00.000Z' },
    read: { status: 'provisional', observedAt: '2026-09-22T04:00:00.000Z', throughWeek: 2, rowsRead: 2,
      metrics: [{ scoringProfileId: id(70), scoringEntityId: id(71), providerExternalId: '1001', entityKind: 'player', position: 'QB',
        totalFantasyPoints: 30, appearanceGameCount: 2, publishedWeekCount: 0, pointsPerGame: 15, positionRank: 1 }] } };
}

describe('season team compatibility and manager directory', () => {
  it('uses the exact legacy normalizer/display values and separately dates users', () => {
    const input = fixture(), result = buildSeasonTeamCompatibility(input);
    expect(result.status).toBe('available'); if (result.status !== 'available') return;
    expect(result.teams).toEqual(normalizeTeams([...input.source.compatibility.sourceRosters], [
      { user_id: 'owner1', display_name: 'First', avatar: 'avatar1' }, { user_id: 'owner2', username: 'Second' }]));
    expect(result.sourceRefs.roster.observedAt).toBe(provenance.sourceObservedAt);
    expect(result.sourceRefs.users?.observedAt).toBe('2026-09-24T12:00:01.000Z');
    expect(result.teams.map(team => team.id)).toEqual([2, 1]);
    expect(result.semantics).toBe('legacy-compatibility');
  });
  it('retains fallback names and exact records when users are missing or wrong-season', () => {
    const input = fixture();
    for (const users of [{ status: 'missing' as const }, { ...input.users,
      envelope: { ...input.users.envelope, scope: { ...mapping.scope, season: 2025 } } }]) {
      const result = buildSeasonManagerDirectory({ ...input, users });
      expect(result).toMatchObject({ status: 'available', coverage: { status: 'partial' } });
      if (result.status !== 'available') continue;
      expect(result.teams[0].display.managerName).toBe('Unassigned manager');
      expect(result.teams[0].currentRecord.wins.value).toBe(1);
      expect(result.teams[0].relationship?.primaryOwner.state).toBe('owned');
      expect(result.sourceRefs.users).toBeNull();
    }
  });
  it('does not turn an unproved users observation age into roster age', () => {
    const input = fixture(); const result = buildSeasonTeamCompatibility({ ...input, users: { ...input.users,
      envelope: { ...input.users.envelope, provenance: { ...input.users.envelope.provenance, origin: 'cache', sourceObservedAt: null } } } });
    expect(result).toMatchObject({ status: 'available', sourceRefs: { users: { observedAt: null, sourceAgeMilliseconds: null } },
      coverage: { reasons: ['users_source_age_unknown'] } });
  });
  it('withholds relationships from another capture but keeps current team profiles', () => {
    const input = fixture(); const result = buildSeasonManagerDirectory({ ...input,
      managers: { ...input.managers, receipt: { ...input.managers.receipt, legacyObservationId: id(999) } } });
    expect(result.status).toBe('available'); if (result.status !== 'available') return;
    expect(result.ownership).toBeNull(); expect(result.teams[0].relationship).toBeNull();
    expect(result.teams[0].profileTarget).toEqual({ seasonTeamId: id(21), externalRosterId: '1' });
  });
  it('keeps League Two display curation separate from provider ownership', () => {
    const sourceMapping = { ...mapping, scope: { ...mapping.scope, leagueKey: 'league2', externalLeagueId: '1378850360529014784' } };
    const input = fixture([{ ...rawRosters[0], owner_id: '95628446075863040', co_owners: ['862177751849877504'] }, rawRosters[1]], sourceMapping);
    const result = buildSeasonManagerDirectory(input);
    expect(result.status).toBe('available'); if (result.status !== 'available') return;
    expect(result.teams[0].display.managerName).toBe('tylerawildman');
    expect(result.teams[0].relationship?.primaryOwner).toMatchObject({ state: 'owned', manager: { sourceManager: { nativeId: '95628446075863040' } } });
    expect(result.teams[0].displayAttribution).toEqual({ kind: 'curated', externalManagerId: '862177751849877504' });
  });
  it('represents unowned teams without inventing a provider manager', () => {
    const result = buildSeasonManagerDirectory(fixture([{ ...rawRosters[0], owner_id: null }, rawRosters[1]]));
    expect(result.status).toBe('available'); if (result.status !== 'available') return;
    expect(result.teams[0].relationship?.primaryOwner).toEqual({ state: 'unowned', manager: null });
    expect(result.teams[0].reasons).toContain('team_unowned');
  });
  it('rejects cross-mapping source composition', () => {
    expect(buildSeasonTeamCompatibility({ ...fixture(), mapping: { ...mapping, revisionId: id(99) } }))
      .toEqual({ status: 'unavailable', reason: 'season_source_scope_mismatch' });
  });
});

describe('season roster summary composition', () => {
  it('preserves the distinct Rosters tie-break and compares existing official averages including custom zero', () => {
    const input = fixture(), result = summaries(input, [matchup(1, [99, 20], true)]);
    expect(result.status).toBe('available'); if (result.status !== 'available') return;
    expect(result.teams.map(team => [team.externalRosterId, team.standingsRank])).toEqual([['1', 1], ['2', 2]]);
    expect(normalizeTeams([...input.source.compatibility.sourceRosters], []).sort(compareTeams).map(team => team.id)).toEqual([2, 1]);
    expect(result.teams.map(team => [team.averagePpg, team.averagePpgRank])).toEqual([[0, 2], [20, 1]]);
    expect(result.teams[0].heldPlayerCount).toBe(1);
    expect(result.history.sources[0].source.observationId).toBe(id(301));
  });
  it('withholds only the missing team average and all average ranks', () => {
    const result = summaries(fixture(), [matchup(1, [null, 20])]);
    expect(result.status).toBe('available'); if (result.status !== 'available') return;
    expect(result.teams.map(team => [team.averagePpg, team.averagePpgRank])).toEqual([[null, null], [20, null]]);
    expect(result.teams.map(team => team.standingsRank)).toEqual([1, 2]);
  });
  it('does not manufacture averages from absent, duplicate or wrong-mapping weeks', () => {
    const first = matchup(1); if (first.status !== 'available') throw new Error('fixture');
    const histories = [[], [first, first], [{ ...first, accepted: { ...first.accepted, sourceMappingRevisionId: id(99) } }]];
    for (const history of histories) {
      const result = summaries(fixture(), history);
      expect(result.status).toBe('available'); if (result.status !== 'available') continue;
      expect(result.teams.every(team => team.averagePpg === null && team.averagePpgRank === null)).toBe(true);
    }
  });
  it('caps history by selection while current record and membership stay current', () => {
    const result = buildSeasonRosterSummaries({ ...fixture(), history: [matchup(1), matchup(2, [99, 99])],
      boundary: { selectedWeek: 1, activeWeek: 3, lastScoredWeek: 2, lifecycle: 'active' } });
    expect(result.status).toBe('available'); if (result.status !== 'available') return;
    expect(result.history.throughWeek).toBe(1); expect(result.teams[0].averagePpg).toBe(10);
    expect(result.teams[0].currentRecord.wins.value).toBe(1); expect(result.teams[0].heldPlayerCount).toBe(1);
  });
  it('withholds Rosters rank on absent official record without replacing the fact with compatibility zero', () => {
    const input = fixture([{ ...rawRosters[0], settings: { fpts: 100 } }, rawRosters[1]]);
    const result = summaries(input);
    expect(result.status).toBe('available'); if (result.status !== 'available') return;
    expect(result.teams[0].currentRecord.wins).toMatchObject({ state: 'absent', value: null });
    expect(result.teams[0].display.wins).toBe(0); expect(result.teams.every(team => team.standingsRank === null)).toBe(true);
    expect(result.teams[0].averagePpg).toBe(10);
  });
  it('withholds mismatched current roster membership without losing record/history', () => {
    const input = fixture(); const result = summaries({ ...input, currentRoster: { ...input.currentRoster,
      receipt: { ...input.currentRoster.receipt, legacyObservationId: id(99) } } });
    expect(result.status).toBe('available'); if (result.status !== 'available') return;
    expect(result.teams[0].heldPlayerCount).toBeNull(); expect(result.teams[0].averagePpg).toBe(10);
  });
  it('does not assign tied local ranks from fallback names while a missing users capture could reverse them', () => {
    const input = fixture(rawRosters.map(roster => ({ ...roster, metadata: {} })));
    const unavailable = buildSeasonRosterSummaries({ ...input, users: { status: 'missing' }, history: [matchup(1)],
      boundary: { selectedWeek: 2, activeWeek: 2, lastScoredWeek: 1, lifecycle: 'active' } });
    expect(unavailable.status).toBe('available'); if (unavailable.status !== 'available') return;
    expect(unavailable.teams.map(team => team.standingsRank)).toEqual([null, null]);
    const corrected = summaries({ ...input, users: { ...input.users,
      envelope: { ...input.users.envelope, payload: [{ user_id: 'owner1', display_name: 'Zulu' }, { user_id: 'owner2', display_name: 'Alpha' }] } } });
    expect(corrected.status).toBe('available'); if (corrected.status !== 'available') return;
    expect(corrected.teams.map(team => team.standingsRank)).toEqual([2, 1]);
  });
});

describe('season player metric references', () => {
  it('retains exact existing values, denominator and observation age without claiming publication', () => {
    const input = metricInput(), result = joinSeasonPlayerMetrics(input);
    expect(result.status).toBe('available'); if (result.status !== 'available') return;
    expect(result.metrics).toEqual(input.read.metrics); expect(result.metrics).not.toBe(input.read.metrics);
    expect(result.reference).toMatchObject({ request: input.request, observedAt: input.read.observedAt, status: 'provisional',
      publicationEvidence: 'immutable_publication_unproved' });
    expect(result.coverage.status).toBe('partial');
  });
  it('preserves qualified source-only identities and independent unavailable PPG/rank', () => {
    const input = metricInput(), metric = { ...input.read.metrics[0], scoringEntityId: null, pointsPerGame: null, positionRank: null };
    const result = joinSeasonPlayerMetrics({ ...input, read: { ...input.read, metrics: [metric] } });
    expect(result.status).toBe('available'); if (result.status !== 'available') return;
    expect(result.metrics).toEqual([metric]); expect(result.coverage.reasons).toContain('provisional_source_only_identity');
    expect(result.coverage.reasons).toContain('player_position_rank_unavailable');
  });
  it.each(['league', 'season', 'profile', 'mapping', 'cutoff', 'week', 'identity'] as const)('rejects incompatible %s evidence', kind => {
    const input = metricInput();
    const changed = kind === 'league' ? { ...input, request: { ...input.request, leagueKey: 'league2' } }
      : kind === 'season' ? { ...input, request: { ...input.request, season: 2025 } }
        : kind === 'profile' ? { ...input, expectedScoringProfileId: id(99) }
          : kind === 'mapping' ? { ...input, sourceMapping: { ...mapping, generation: 2 } }
            : kind === 'cutoff' ? { ...input, request: { ...input.request, asOf: '2026-09-23T08:00:00.000Z' } }
              : kind === 'week' ? { ...input, request: { ...input.request, throughWeek: 3 } }
                : { ...input, read: { ...input.read, metrics: [...input.read.metrics, ...input.read.metrics] } };
    expect(joinSeasonPlayerMetrics(changed).status).toBe('unavailable');
  });
  it('withholds missing cutoff and unavailable or empty metrics instead of empty success', () => {
    const input = metricInput();
    expect(joinSeasonPlayerMetrics({ ...input, window: null }).status).toBe('unavailable');
    expect(joinSeasonPlayerMetrics({ ...input, read: { status: 'unavailable', observedAt: null, throughWeek: null, rowsRead: 0, metrics: [] } }).status).toBe('unavailable');
    expect(joinSeasonPlayerMetrics({ ...input, read: { ...input.read, metrics: [] } }).status).toBe('unavailable');
  });
  it('rejects observations newer than cutoff and published claims for cutoff reads', () => {
    const input = metricInput();
    expect(joinSeasonPlayerMetrics({ ...input, read: { ...input.read, observedAt: '2026-09-22T08:00:01.000Z' } }).status).toBe('unavailable');
    expect(joinSeasonPlayerMetrics({ ...input, read: { ...input.read, status: 'published' } }).status).toBe('unavailable');
  });
  it('uses the 4 AM cutoff independently of the noon display rollover', () => {
    const input = metricInput(); const evaluatedAt = '2026-09-22T09:00:00.000Z';
    const calendar = { season: '2026', seasonSchedule: schedule.body.map(game => game.week === 2 ? { ...game, status: 'complete' } : game), evaluatedAt };
    const window = resolveWeeklyPlayerMetrics(calendar), display = resolveSiteWeek(calendar);
    expect(window.throughWeek).toBe(2); expect(display.week).toBe(2);
    const result = joinSeasonPlayerMetrics({ ...input, window, now: new Date(evaluatedAt) });
    expect(result.status).toBe('available');
    const later = resolveSiteWeek({ ...calendar, evaluatedAt: '2026-09-22T17:00:00.000Z' });
    expect(later.week).toBe(3);
  });
  it('caps a historical selection while using the same latest correction cutoff', () => {
    const input = metricInput(); const result = joinSeasonPlayerMetrics({ ...input, selectedWeek: 1,
      request: { ...input.request, throughWeek: 1 }, read: { ...input.read, throughWeek: 1,
        metrics: input.read.metrics.map(metric => ({ ...metric, appearanceGameCount: 1 })) } });
    expect(result).toMatchObject({ status: 'available', reference: { throughWeek: 1, asOf: input.window?.asOf } });
  });
});
