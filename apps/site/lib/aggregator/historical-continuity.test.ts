import { describe, expect, it, vi } from 'vitest';
import type { AdministrationEnvelope, AdministrationFamily, JsonValue } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import type { LeagueAdministrationStoreRead } from '../league-administration/store-contracts';
import { buildManagerHistory } from '../manager-history';
import { normalizeTeams, type SleeperMatchup, type SleeperRoster, type SleeperUser } from '../transform';
import { projectRetainedRoster } from './roster-bridge';
import { projectHistoricalContinuity, type HistoricalContinuityInput, type HistoricalContinuitySeasonInput } from './historical-continuity';
import capturedHistory from '../../test-support/fixtures/manager-history-2025-2026.json';
import leagueOne2024 from '../../test-support/fixtures/manager-history-league-one-2024.json';

vi.mock('server-only', () => ({}));

type Available = Extract<LeagueAdministrationStoreRead, { status: 'available' }>;
type Mutable<T> = T extends object ? { -readonly [K in keyof T]: K extends 'payload' ? T[K] : Mutable<T[K]> } : T;
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const time = '2026-09-30T12:00:00.000Z';
const families: AdministrationFamily[] = ['league', 'rosters', 'users', 'matchups'];
function mapping(season: number, leagueKey = 'dynasty'): AdministrationSourceMapping {
  return { connectionId: id(season * 100), leagueSeasonId: id(season * 100 + 1), revisionId: id(season * 100 + 2),
    generation: 1, scope: { leagueKey, provider: 'sleeper', season, externalLeagueId: `100${season}` } };
}
function read(source: AdministrationSourceMapping, family: AdministrationFamily, payload: unknown, week: number | null = null): Available {
  const envelope: AdministrationEnvelope = { schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: { ...source.scope }, family, week, completeness: 'complete', payload: payload as JsonValue,
    provenance: { origin: 'network', requestStartedAt: time, requestCompletedAt: time, sourceObservedAt: time, checkedAt: time } };
  const offset = source.scope.season * 1000 + families.indexOf(family) * 30 + (week ?? 0);
  return { status: 'available', envelope, observationId: id(offset), versionId: family === 'league' ? id(offset + 800000) : null,
    generation: 1, checkedAt: time, verifiedAt: time };
}
function bridge(source: Available, scope: AdministrationSourceMapping): Available {
  const normalized = normalizeAdministrationObservation(source.envelope);
  if (normalized.value?.family !== 'rosters') throw new Error('Invalid fixture.');
  return { ...source, commonRoster: projectRetainedRoster(source, {
    league_season_id: scope.leagueSeasonId, content_id: id(scope.scope.season * 1000 + 500), content_hash: normalized.contentHash,
    observation_checked_at: time, source_mapping_revision_id: scope.revisionId, source_connection_id: scope.connectionId,
    source_mapping_generation: scope.generation, mapping_league_season_id: scope.leagueSeasonId,
    mapping_provider: 'sleeper', mapping_external_league_id: scope.scope.externalLeagueId,
    roster_team_identities: normalized.value.teams.map(team => ({ externalRosterId: team.externalRosterId,
      seasonTeamId: id(scope.scope.season * 1000 + 600 + Number(team.externalRosterId)) })),
  }, normalized) };
}
function annual(season: number, leagueKey = 'dynasty'): HistoricalContinuitySeasonInput {
  const scope = mapping(season, leagueKey);
  const rosters = [1, 2].map(rosterId => ({ roster_id: rosterId, owner_id: `owner-${rosterId}`,
    players: [], starters: [], co_owners: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } }));
  return { mapping: scope,
    league: read(scope, 'league', { league_id: scope.scope.externalLeagueId, season: String(season), name: 'An annual league', sport: 'nfl',
      total_rosters: 2, roster_positions: ['QB'], status: season === 2026 ? 'in_season' : 'complete',
      previous_league_id: `100${season - 1}`, settings: { playoff_week_start: 3 }, scoring_settings: { pass_yd: 0.04 } }),
    rosters: bridge(read(scope, 'rosters', rosters), scope),
    users: read(scope, 'users', [{ user_id: 'owner-1', display_name: season === 2026 ? 'Renamed manager' : 'Old display', avatar: 'one' },
      { user_id: 'owner-2', display_name: 'Second manager', avatar: 'two' }]),
    throughWeek: season === 2026 ? 1 : 2,
    matchups: [1, 2].map(week => read(scope, 'matchups', [
      { roster_id: 1, matchup_id: 1, points: week === 1 ? 123.456789 : -1.01, custom_points: week === 1 ? 0 : null },
      { roster_id: 2, matchup_id: 1, points: week === 1 ? 0 : -2.02 },
    ], week)),
  };
}
function input(leagueKey = 'dynasty'): Mutable<HistoricalContinuityInput> {
  return structuredClone({ leagueKey, currentSeason: 2026, seasons: [annual(2026, leagueKey), annual(2025, leagueKey),
    ...(leagueKey === 'league1' ? [annual(2024, leagueKey)] : [])] }) as Mutable<HistoricalContinuityInput>;
}
function available(source: HistoricalContinuityInput = input()) {
  const result = projectHistoricalContinuity(source);
  if (result.status !== 'available') throw new Error(`Unavailable fixture: ${result.reason}`);
  return result;
}
function existingHistory(source: HistoricalContinuityInput) {
  return buildManagerHistory(source.seasons.map(season => ({ season: season.mapping.scope.season,
    externalLeagueId: season.mapping.scope.externalLeagueId,
    rosters: (season.rosters as Available).envelope.payload as unknown as SleeperRoster[],
    teams: normalizeTeams((season.rosters as Available).envelope.payload as unknown as SleeperRoster[],
      (season.users as Available).envelope.payload as unknown as SleeperUser[]),
    throughWeek: season.throughWeek,
    rows: season.matchups.map(row => (row as Available).envelope.payload as unknown as SleeperMatchup[]).slice(0, season.throughWeek!),
  })), source.currentSeason, source.leagueKey);
}
function mutatePayload(source: Mutable<HistoricalContinuityInput>, season: number, family: 'league' | 'rosters' | 'users', payload: unknown) {
  const annual = source.seasons[season];
  const revised = read(annual.mapping, family, payload);
  annual[family] = structuredClone(family === 'rosters' ? bridge(revised, annual.mapping) : revised) as Mutable<Available>;
}

describe('bounded retained B4 historical continuity', () => {
  it('preserves exact score components, source age, annual UUIDs and existing manager calculations', () => {
    const source = input(); const result = available(source);
    expect(result.historyCompleteness).toBe('complete');
    expect(result.identityCompleteness).toBe('complete');
    expect(result.compatibility).toEqual(existingHistory(source));
    expect(result.compatibility.managers[0]).toMatchObject({ ownerId: 'owner-1', managerName: 'Renamed manager',
      currentTeamId: 1, wins: 1, losses: 0, ties: 2, seasons: [2025, 2026] });
    expect(result.seasons[0].predecessor).toEqual({ status: 'verified', leagueSeasonId: source.seasons[1].mapping.leagueSeasonId });
    expect(result.seasons[1].predecessor).toEqual({ status: 'outside-range', leagueSeasonId: null });
    expect(result.seasons[0].teams[0].seasonTeamId).not.toBe(result.seasons[1].teams[0].seasonTeamId);
    expect(result.seasons[0].weeks[0].scores[0]).toMatchObject({ rawPoints: 123.456789, customPoints: 0,
      effectivePoints: 0, compatibilityResult: 'tie', authority: 'provider-official' });
    expect(result.seasons[1].weeks[1].scores[0]).toMatchObject({ rawPoints: -1.01, customPoints: null,
      effectivePoints: -1.01, compatibilityResult: 'win' });
    expect(result.seasons[0].sources[0]).toMatchObject({ observationId: (source.seasons[0].league as Available).observationId,
      checkedAt: time, verifiedAt: time, provenance: (source.seasons[0].league as Available).envelope.provenance });
    expect(result.managers[0].record).toMatchObject({ authority: 'league-one-derived', calculator: 'buildManagerHistory' });
  });

  it('keeps provider owner/coowners and approved attribution separate, including curated honors', () => {
    const source = input('league2');
    for (let index = 0; index < source.seasons.length; index += 1) {
      const rosterPayload = structuredClone((source.seasons[index].rosters as Available).envelope.payload) as unknown as SleeperRoster[];
      rosterPayload[0] = { ...rosterPayload[0], owner_id: '95628446075863040', co_owners: ['862177751849877504'] };
      mutatePayload(source, index, 'rosters', rosterPayload);
      mutatePayload(source, index, 'users', [{ user_id: '95628446075863040', display_name: 'eneerg', avatar: 'raw-owner' },
        { user_id: 'owner-2', display_name: 'Second manager' }]);
    }
    const result = available(source);
    expect(result.compatibility).toEqual(existingHistory(source));
    expect(result.seasons.every(season => season.teams[0].providerAttribution.owner?.nativeId === '95628446075863040')).toBe(true);
    expect(result.seasons[0].teams[0]).toMatchObject({
      providerAttribution: { coOwners: [{ nativeId: '862177751849877504' }], effectiveFrom: null, effectiveTo: null },
      effectiveAttribution: { manager: { nativeId: '862177751849877504' }, authority: 'league-one-curated' },
    });
    expect(result.compatibility.managers.find(manager => manager.ownerId === '862177751849877504'))
      .toMatchObject({ managerName: 'tylerawildman', wins: 1, losses: 0, ties: 2, avatar: null });
    expect(result.managers.some(manager => manager.sourceManager.nativeId === '95628446075863040')).toBe(false);
    const uncorrected = input('league1');
    for (let index = 0; index < uncorrected.seasons.length; index += 1) {
      const rosterPayload = structuredClone((uncorrected.seasons[index].rosters as Available).envelope.payload) as unknown as SleeperRoster[];
      rosterPayload[0] = { ...rosterPayload[0], owner_id: '95628446075863040', co_owners: ['862177751849877504'] };
      mutatePayload(uncorrected, index, 'rosters', rosterPayload);
      mutatePayload(uncorrected, index, 'users', [{ user_id: '95628446075863040', display_name: 'eneerg' },
        { user_id: 'owner-2', display_name: 'Second manager' }]);
    }
    const honors = available(uncorrected).managers.find(manager => manager.sourceManager.nativeId === '95628446075863040')!;
    expect(honors.curatedHonors).toEqual([2010, 2012, 2017].map(season => ({ leagueKey: 'league1', season, title: 'Trophy Bowl',
      authority: 'league-one-curated', policy: 'existing-manager-championships', curation: { authority: 'owner-confirmed',
        approvedOn: '2026-09-19', version: 'manager-championships-2026-09-19', reference: 'apps/site/lib/manager-championships.ts' } })));
  });

  it('does not infer owners across reused roster slots or identical names', () => {
    const source = input(); const raw = structuredClone((source.seasons[1].rosters as Available).envelope.payload) as unknown as SleeperRoster[];
    raw[0].owner_id = 'former-owner'; mutatePayload(source, 1, 'rosters', raw);
    mutatePayload(source, 1, 'users', [{ user_id: 'former-owner', display_name: 'Renamed manager' }, { user_id: 'owner-2', display_name: 'Second manager' }]);
    const result = available(source);
    expect(result.compatibility.managers).toHaveLength(3);
    expect(result.compatibility.managers.find(manager => manager.ownerId === 'former-owner'))
      .toMatchObject({ currentTeamId: null, wins: 1, ties: 1, seasons: [2025] });
    expect(result.compatibility.managers.find(manager => manager.ownerId === 'owner-1')).toMatchObject({ wins: 0, ties: 1, seasons: [2026] });
  });

  it('represents missing bridge identity without inventing UUIDs or dropping valid legacy history', () => {
    const source = input(); delete (source.seasons[1].rosters as Mutable<Available>).commonRoster;
    const result = available(source);
    expect(result.identityCompleteness).toBe('partial'); expect(result.historyCompleteness).toBe('complete');
    expect(result.compatibility).toEqual(existingHistory(source));
    expect(result.seasons[1].teams.every(team => team.seasonTeamId === null && team.identityEvidence === null)).toBe(true);
    expect(result.seasons[1].weeks[0].scores.every(score => score.seasonTeamId === null)).toBe(true);
    expect(result.seasons[1].reasons).toContain('season-team-identity:unavailable');
  });

  it('retains absent original mapping proof rather than grafting a current revision onto legacy identity', () => {
    const source = input(); const bridge = (source.seasons[1].rosters as Mutable<Available>).commonRoster;
    if (bridge?.status !== 'available') throw new Error('Bridge required.');
    bridge.lineage.sourceMappingRevisionId = null; delete bridge.lineage.sourceConnectionId; delete bridge.lineage.mappingGeneration;
    bridge.lineage.reasons = ['mapping_revision_not_captured'];
    const result = available(source);
    expect(result.seasons[1].teams[0].identityEvidence).toEqual({ sourceMappingRevisionId: null,
      mappingProof: 'not-captured', reasons: ['mapping_revision_not_captured'] });
    expect(result.seasons[1].teams[0].seasonTeamId).not.toBeNull();
  });

  it.each(['hash', 'observation', 'mapping', 'namespace', 'uuid', 'duplicate'] as const)('rejects %s bridge linkage without weakening legacy source validation', change => {
    const source = input(); const bridge = (source.seasons[1].rosters as Mutable<Available>).commonRoster;
    if (bridge?.status !== 'available') throw new Error('Bridge required.');
    if (change === 'hash') bridge.lineage.rawContentHash = 'wrong';
    if (change === 'observation') bridge.lineage.observationId = id(1);
    if (change === 'mapping') bridge.lineage.sourceMappingRevisionId = id(2);
    if (change === 'namespace') bridge.teams[0].sourceTeam.nativeNamespace = 'other-season';
    if (change === 'uuid') bridge.teams[0].seasonTeamId = '1';
    if (change === 'duplicate') bridge.teams[0].seasonTeamId = bridge.teams[1].seasonTeamId;
    const result = available(source);
    expect(result.seasons[1].teams.every(team => team.seasonTeamId === null)).toBe(true);
    expect(result.historyCompleteness).toBe('complete');
  });

  it.each(['missing', 'disabled', 'unavailable', 'conflict'] as const)('withholds every combined total for a %s week but retains known manager identities', status => {
    const source = input(); source.seasons[1].matchups[1] = { status };
    const result = available(source);
    expect(result.historyCompleteness).toBe('partial');
    expect(result.compatibility.managers).toHaveLength(2);
    expect(result.compatibility.managers.every(manager => manager.wins === null && manager.losses === null && manager.ties === null)).toBe(true);
    expect(result.seasons[1].weeks[1]).toEqual({ week: 2, completeness: 'unavailable', scores: [] });
    expect(result.seasons[1].weeks[0].scores).toHaveLength(2);
  });

  it.each(['foreign-league', 'foreign-season', 'wrong-family', 'wrong-week', 'partial', 'invalid-score'] as const)('rejects %s weekly source and does not count an unsafe result', change => {
    const source = input(); const row = source.seasons[1].matchups[0] as Mutable<Available>;
    if (change === 'foreign-league') row.envelope.scope.externalLeagueId = 'other';
    if (change === 'foreign-season') row.envelope.scope.season = 2024;
    if (change === 'wrong-family') row.envelope.family = 'rosters';
    if (change === 'wrong-week') row.envelope.week = 2;
    if (change === 'partial') row.envelope.completeness = 'partial';
    if (change === 'invalid-score') (row.envelope.payload as unknown as { points: unknown }[])[0].points = '0';
    const result = available(source);
    expect(result.historyCompleteness).toBe('partial');
    expect(result.seasons[1].weeks[0].scores).toEqual([]);
    expect(result.compatibility.managers.every(manager => manager.wins === null)).toBe(true);
  });

  it.each(['missing-link', 'wrong-link', 'not-complete', 'name-match'] as const)('never infers a predecessor for %s', change => {
    const source = input();
    const current = (source.seasons[0].league as Mutable<Available>).envelope.payload as Record<string, JsonValue>;
    const previous = (source.seasons[1].league as Mutable<Available>).envelope.payload as Record<string, JsonValue>;
    if (change === 'missing-link' || change === 'name-match') current.previous_league_id = null;
    if (change === 'wrong-link') current.previous_league_id = '1002024';
    if (change === 'not-complete') previous.status = 'in_season';
    if (change === 'name-match') previous.name = current.name;
    const result = available(source);
    expect(result.seasons).toHaveLength(1);
    expect(result.historyCompleteness).toBe('partial');
    expect(result.compatibility.managers.every(manager => manager.wins === null)).toBe(true);
  });

  it('requires the bounded 2024 League One endpoint and ignores no missing season in a complete total', () => {
    const source = input('league1');
    expect(available(source).historyCompleteness).toBe('complete');
    source.seasons.pop(); const result = available(source);
    expect(result.compatibility.warning).toContain('2024 boundary is not verified');
    expect(result.historyCompleteness).toBe('partial');
  });

  it.each(['league_average_match', 'best_ball', 'start_week'])('keeps official score evidence while withholding unsupported %s records', setting => {
    const source = input(); const league = (source.seasons[1].league as Mutable<Available>).envelope.payload as Record<string, JsonValue>;
    (league.settings as Record<string, JsonValue>)[setting] = setting === 'start_week' ? 2 : 1;
    const result = available(source);
    expect(result.compatibility.warning).toContain('unsupported');
    expect(result.managers.every(manager => manager.record.wins === null)).toBe(true);
    expect(result.seasons[1].weeks[0].scores[0]).toMatchObject({ effectivePoints: 0, compatibilityResult: null });
  });

  it('does not count unconfirmed current weeks or a shortened completed-season range', () => {
    const source = input(); source.seasons[0].throughWeek = null;
    let result = available(source);
    expect(result.seasons[0].weeks).toEqual([]); expect(result.historyCompleteness).toBe('partial');
    const short = input(); short.seasons[1].throughWeek = 1;
    result = available(short); expect(result.seasons[1].weeks).toEqual([]);
    expect(result.historyCompleteness).toBe('partial');
  });

  it('does not use current user names as missing historical ownership or user evidence', () => {
    const source = input(); source.seasons[1].users = { status: 'missing' };
    const result = available(source);
    expect(result.historyCompleteness).toBe('partial');
    expect(result.seasons[1].teams[0].providerAttribution.owner?.nativeId).toBe('owner-1');
    expect(result.seasons[1].sources.every(value => value.family !== 'users')).toBe(true);
    expect(result.compatibility.managers.every(manager => manager.wins === null)).toBe(true);
  });

  it('withholds all records when effective owners are duplicated or missing, retaining known source relationships', () => {
    for (const owner of ['owner-2', null]) {
      const source = input(); const raw = structuredClone((source.seasons[1].rosters as Available).envelope.payload) as unknown as SleeperRoster[];
      raw[0].owner_id = owner; mutatePayload(source, 1, 'rosters', raw);
      const result = available(source);
      expect(result.historyCompleteness).toBe('partial');
      expect(result.compatibility.warning).toContain('ownership');
      expect(result.compatibility.managers.every(manager => manager.wins === null)).toBe(true);
      expect(result.seasons[1].teams[0].providerAttribution.owner?.nativeId ?? null).toBe(owner);
    }
  });

  it('rejects duplicate seasons, foreign mappings and unbounded capture lists', () => {
    const duplicate = input(); duplicate.seasons.push(duplicate.seasons[1]);
    expect(projectHistoricalContinuity(duplicate)).toMatchObject({ status: 'unavailable' });
    const foreign = input(); foreign.seasons[1].mapping.scope.leagueKey = 'league2';
    expect(projectHistoricalContinuity(foreign)).toMatchObject({ status: 'unavailable' });
    const long = input(); long.seasons[0].matchups = Array.from({ length: 15 }, () => ({ status: 'missing' }));
    expect(projectHistoricalContinuity(long)).toMatchObject({ status: 'unavailable' });
  });

  it('replays serialized captures deterministically after restart and keeps corrected versions independent', () => {
    const source = input(); const before = JSON.stringify(source);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('No network from B4 projection.'); });
    try {
      const first = available(source);
      expect(available(JSON.parse(before))).toEqual(first);
      expect(JSON.stringify(source)).toBe(before);
      expect(Object.isFrozen(first.seasons[0].teams[0])).toBe(true);
      const corrected = JSON.parse(before) as Mutable<HistoricalContinuityInput>;
      const score = corrected.seasons[1].matchups[0] as Mutable<Available>;
      (score.envelope.payload as unknown as { custom_points?: number }[])[0].custom_points = 2.0001;
      score.observationId = id(999); score.generation = 2;
      const changed = available(corrected);
      expect(changed.revision).not.toBe(first.revision);
      expect(changed.compatibility.managers[0]).toMatchObject({ wins: 2, ties: 1 });
      expect(changed.seasons[1].weeks[0].scores[0].effectivePoints).toBe(2.0001);
      expect(available(JSON.parse(before))).toEqual(first);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it('distinguishes head verification from a provable original observation check', () => {
    const source = input(); const rosters = source.seasons[1].rosters as Mutable<Available>;
    rosters.checkedAt = '2026-10-01T12:00:00.000Z'; rosters.envelope.provenance.checkedAt = rosters.checkedAt;
    const result = available(source);
    const rosterSource = result.seasons[1].sources.find(value => value.family === 'rosters')!;
    expect(rosterSource).toMatchObject({ acceptedHeadCheckedAt: '2026-10-01T12:00:00.000Z', observationCheckedAt: time });
    expect(result.seasons[1].sources.find(value => value.family === 'league')?.observationCheckedAt).toBeNull();
    delete rosters.commonRoster;
    expect(available(source).seasons[1].sources.find(value => value.family === 'rosters')?.observationCheckedAt).toBeNull();
  });

  for (const captured of capturedHistory.leagues) {
    it(`${captured.leagueKey}: reproduces independently recorded manager results from saved 2024–2026 source values`, () => {
      const saved = [...captured.seasons, ...(captured.leagueKey === 'league1' ? [leagueOne2024.season] : [])];
      const seasons: HistoricalContinuitySeasonInput[] = saved.map(season => {
        const scope: AdministrationSourceMapping = { ...mapping(season.season, captured.leagueKey),
          scope: { ...mapping(season.season, captured.leagueKey).scope, externalLeagueId: season.externalLeagueId } };
        const previous = saved.find(value => value.season === season.season - 1);
        // The sanitized evidence retains identities/scores, not full league/roster documents.
        // These synthetic transport/required-settings fields do not qualify a real stored capture.
        const rosters = season.rosters.map(roster => ({ ...roster, settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } }));
        const users = rosters.map(roster => ({ user_id: roster.owner_id,
          display_name: season.teams.find(team => team.id === roster.roster_id)!.managerName }));
        return { mapping: scope,
          league: read(scope, 'league', { league_id: season.externalLeagueId, season: String(season.season),
            name: 'Sanitized history adapter fixture', sport: 'nfl', status: season.season === 2026 ? 'in_season' : 'complete',
            total_rosters: rosters.length, roster_positions: ['QB'], previous_league_id: previous?.externalLeagueId ?? null,
            settings: { playoff_week_start: 15 }, scoring_settings: {} }),
          rosters: bridge(read(scope, 'rosters', rosters), scope), users: read(scope, 'users', users),
          throughWeek: season.throughWeek,
          matchups: season.rows.map((rows, index) => read(scope, 'matchups', rows, index + 1)) };
      });
      const source: HistoricalContinuityInput = { leagueKey: captured.leagueKey, currentSeason: 2026, seasons };
      const result = available(source);
      expect(result.compatibility).toEqual(existingHistory(source));
      expect(result.historyCompleteness).toBe('complete');
      const byOwner = (left: { ownerId: string }, right: { ownerId: string }) => left.ownerId.localeCompare(right.ownerId);
      const expected = captured.leagueKey === 'league1' ? leagueOne2024.expected.combinedManagers : captured.expected.managers;
      const comparable = result.compatibility.managers.map(({ ownerId, managerName, currentTeamId, seasons, wins, losses, ties }) =>
        ({ ownerId, managerName, currentTeamId, seasons, wins, losses, ties }));
      expect(comparable.sort(byOwner)).toEqual([...expected].sort(byOwner));
      for (const season of result.seasons) {
        const savedSeason = saved.find(value => value.season === season.mapping.scope.season)!;
        expect(season.weeks.map(week => week.scores.map(score => ({ roster_id: Number(score.sourceTeam.nativeId),
          matchup_id: Number(score.externalMatchupId), points: score.rawPoints }))))
          .toEqual(savedSeason.rows.map(rows => rows.map(row => ({ roster_id: row.roster_id, matchup_id: row.matchup_id, points: row.points }))));
      }
    });
  }
});
