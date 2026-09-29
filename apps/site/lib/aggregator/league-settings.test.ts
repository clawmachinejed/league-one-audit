import { describe, expect, it } from 'vitest';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { AdministrationEnvelope, JsonObject, JsonValue } from '../league-administration/contracts';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import type { LeagueSettingsValue, SettingField } from './league-settings';

const raw: JsonObject = { league_id: '900719925474099312345', season: '2026', sport: 'nfl', name: 'Fixture', avatar: 'artwork',
  previous_league_id: '900719925474099212345', status: 'in_season', season_type: 'regular', total_rosters: 12,
  roster_positions: ['QB', 'RB', 'RB', 'FLEX', 'BN'], scoring_settings: { pass_yd: 0.04, rec: 0.5 },
  settings: { start_week: 1, playoff_week_start: 15, playoff_teams: 6, playoff_type: 0, playoff_round_type: 0,
    playoff_seed_type: 0, league_average_match: 0, best_ball: 0, divisions: 0, type: 2, public: 0,
    reserve_slots: 3, taxi_slots: 4, taxi_years: 2, taxi_allow_vets: 0, taxi_deadline: 0,
    reserve_allow_out: 1, reserve_allow_sus: 0, reserve_allow_doubtful: 0,
    max_subs: 2, sub_lock_if_starter_active: 1, sub_start_time_eligibility: 0,
    waiver_budget: 100, waiver_type: 2, waiver_clear_days: 2, daily_waivers: 1, daily_waivers_hour: 0,
    daily_waivers_days: 5461, trade_deadline: 11, leg: 4, last_scored_leg: 3 } };
function normalize(payload: JsonValue = raw, changes: Partial<AdministrationEnvelope> = {}) {
  return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: { provider: 'sleeper', leagueKey: 'fixture', externalLeagueId: String(raw.league_id), season: 2026 },
    family: 'league', week: null, completeness: 'complete', payload,
    provenance: { origin: 'network', requestStartedAt: '2026-09-29T12:00:00.000Z', requestCompletedAt: '2026-09-29T12:00:01.000Z',
      sourceObservedAt: '2026-09-29T12:00:01.000Z', checkedAt: '2026-09-29T12:00:02.000Z' }, ...changes });
}
function value(payload: JsonValue = raw) {
  const result = normalize(payload); expect(result.leagueSettings?.status).toBe('complete');
  return result.leagueSettings!.value!;
}
describe('same-capture league season and settings', () => {
  it('preserves exact source fields, repeated ordered slots and old configuration identity', () => {
    const result = normalize(); const common = result.leagueSettings!.value!;
    expect(common.sourceLeague.nativeId).toBe(raw.league_id);
    expect(common.slots.value?.map(slot => slot.nativeCode)).toEqual(raw.roster_positions);
    expect(common.slots.value?.map(slot => [slot.ordinal, slot.count])).toEqual([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]]);
    expect(common.scoring.rules.value).toEqual(raw.scoring_settings);
    expect(common.nativeSettings.fields.value).toEqual(raw.settings);
    expect(common.predecessor.value?.nativeId).toBe(raw.previous_league_id);
    expect(common.visibility).toMatchObject({ sourceAccess: 'public-endpoint', native: { value: 0 }, grantsPrivateAccess: false });
    expect(result.semanticHash).toBe(compatibleRevision({ schemaVersion: result.envelope.schemaVersion,
      normalizerVersion: result.envelope.normalizerVersion, dialect: result.envelope.dialect, family: 'league', value: result.value }));
    expect(Object.isFrozen(common)).toBe(true);
  });

  it('maps every named numeric field to exactly its literal source key without defaults', () => {
    const common = value();
    const expected = {
      startPeriod: 'start_week', playoffStartPeriod: 'playoff_week_start', playoffTeamCount: 'playoff_teams', playoffFormat: 'playoff_type',
      playoffRoundFormat: 'playoff_round_type', playoffSeeding: 'playoff_seed_type', additionalMatch: 'league_average_match',
      bestBall: 'best_ball', divisionCount: 'divisions', leagueType: 'type', reserveSlotCount: 'reserve_slots', taxiSlotCount: 'taxi_slots',
      taxiYears: 'taxi_years', taxiVeterans: 'taxi_allow_vets', taxiDeadline: 'taxi_deadline', reserveOut: 'reserve_allow_out',
      reserveSuspended: 'reserve_allow_sus', reserveDoubtful: 'reserve_allow_doubtful', maxSubstitutions: 'max_subs',
      substitutionLockWhenStarterActive: 'sub_lock_if_starter_active', substitutionStartTimeEligibility: 'sub_start_time_eligibility',
      budget: 'waiver_budget', type: 'waiver_type', clearDays: 'waiver_clear_days', dailyEnabled: 'daily_waivers',
      dailyHour: 'daily_waivers_hour', dailyDays: 'daily_waivers_days', tradeDeadline: 'trade_deadline',
    };
    const actual = { ...common.competition, ...common.rosterRules, ...common.waivers };
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, native] of Object.entries(expected)) {
      expect(actual[name as keyof typeof actual]).toEqual({ state: 'known', sourcePath: `settings.${native}`, value: (raw.settings as JsonObject)[native] });
      const changed = value({ ...raw, settings: { ...(raw.settings as JsonObject), [native]: 'unknown-code' } });
      expect({ ...changed.competition, ...changed.rosterRules, ...changed.waivers }[name as keyof typeof actual])
        .toMatchObject({ state: 'invalid', raw: 'unknown-code', value: null });
    }
    expect(common.rosterRules.substitutionLockWhenStarterActive).toMatchObject({ sourcePath: 'settings.sub_lock_if_starter_active', value: 1 });
    expect(common.rosterRules.substitutionStartTimeEligibility).toMatchObject({ sourcePath: 'settings.sub_start_time_eligibility', value: 0 });
  });

  it.each([['absent', undefined], ['null', null], ['invalid', 'bad']] as const)('keeps %s optional settings separate from identity', (state, settings) => {
    const payload = { ...raw }; if (settings === undefined) delete payload.settings; else payload.settings = settings;
    const common = value(payload);
    expect(common.nativeSettings.fields.state).toBe(state);
    expect(common.waivers.budget).toMatchObject({ state, value: null });
    expect(common.competition.playoffTeamCount).toMatchObject({ state, value: null });
  });

  it('retains an empty source container while each omitted field stays absent', () => {
    const common = value({ ...raw, settings: {}, roster_positions: [], scoring_settings: {}, avatar: '', previous_league_id: null });
    expect(common.nativeSettings.fields.state).toBe('empty'); expect(common.slots).toMatchObject({ state: 'empty', value: [] });
    expect(common.scoring.rules).toMatchObject({ state: 'empty', value: {} }); expect(common.artwork).toMatchObject({ state: 'empty', value: '' });
    expect(common.predecessor).toMatchObject({ state: 'null', value: null }); expect(common.teamCount.value).toBe(12);
    expect(common.waivers.budget.state).toBe('absent');
  });

  it.each(['name', 'avatar', 'status', 'season_type', 'total_rosters', 'roster_positions', 'scoring_settings', 'previous_league_id'])
    ('does not reject identity when optional %s is invalid', key => {
      const bad = key === 'total_rosters' ? -1 : key === 'previous_league_id' ? raw.league_id : 42;
      expect(normalize({ ...raw, [key]: bad }).leagueSettings?.status).toBe('complete');
    });

  it.each<JsonObject>([{ league_id: 'other' }, { season: '2025' }, { season: 2026 }, { sport: 'nba' }, { sport: null }])
    ('rejects contradictory identity %j', change => expect(normalize({ ...raw, ...change }).leagueSettings?.status).toBe('invalid'));

  it('retains unknown scoring, slot and competition rules without claiming analytics support', () => {
    const common = value({ ...raw, scoring_settings: { rec: 0.5, exotic_rule: 7 }, roster_positions: ['QB', 'UNKNOWN', 'IDP_FLEX'],
      settings: { ...(raw.settings as JsonObject), best_ball: 1, new_format: { custom: true } } });
    expect(common.interpretation).toMatchObject({ scoring: 'limited', unsupportedScoringRules: ['exotic_rule'],
      roster: 'limited', unknownSlots: ['UNKNOWN', 'IDP_FLEX'], competition: 'limited' });
    expect(common.nativeSettings.fields.value?.new_format).toEqual({ custom: true });
    expect(common.scoring.rules.value).toEqual({ rec: 0.5, exotic_rule: 7 });
  });

  it('keeps operational evidence separate from unchanged configuration hash and never invents NFL mappings', () => {
    const first = normalize();
    const next = normalize({ ...raw, status: 'complete', settings: { ...(raw.settings as JsonObject), leg: 5, last_scored_leg: 4 } });
    expect(next.semanticHash).toBe(first.semanticHash); expect(next.contentHash).not.toBe(first.contentHash);
    expect(next.leagueSettings?.value?.lifecycle.value).toBe('complete');
    expect(next.leagueSettings?.value?.periods.map(field => field.value?.source.nativeId)).toEqual(['5', '4']);
    expect(next.leagueSettings?.value?.nflWeekMappings).toEqual([]);
    expect(next.leagueSettings?.value?.periods.every(field => field.value?.canonicalPeriodId === null)).toBe(true);
  });

  it('retains array order changes and correction content while hashes stay compatible', () => {
    expect(normalize({ ...raw, roster_positions: ['QB', 'RB', 'FLEX', 'RB', 'BN'] }).semanticHash).not.toBe(normalize().semanticHash);
    const changed = normalize({ ...raw, name: 'Corrected' }); expect(changed.semanticHash).not.toBe(normalize().semanticHash);
    expect(normalize(raw).contentHash).toBe(normalize({ ...raw }).contentHash);
  });

  it('can represent documented Yahoo composite keys, counted slots and catalog/modifier rules without a live adapter', () => {
    // Synthetic values on paths documented at https://sports.yahoo.com/developer/docs/.
    // This is a contract specimen, not an acquired/accepted Yahoo resource or XML parser.
    const known = <T>(sourcePath: string, value: T): SettingField<T> => ({ sourcePath, state: 'known', value });
    const absent = <T>(): SettingField<T> => ({ sourcePath: 'not-provided-in-documentation-fixture', state: 'absent', value: null });
    const yahoo: LeagueSettingsValue = { sourceLeague: { provider: 'yahoo', resourceKind: 'league', nativeNamespace: 'nfl', nativeId: '461.l.1234' },
      season: 2026, sport: 'nfl', name: known('name', 'Synthetic Yahoo specimen'), artwork: absent(), predecessor: absent(),
      lifecycle: absent(), seasonType: absent(), teamCount: known('num_teams', 12), nflWeekMappings: [],
      visibility: { sourceAccess: 'authorized', native: known('is_public', 0), grantsPrivateAccess: false },
      slots: known('settings.roster_positions.roster_position', [{ nativeCode: 'WR', count: 3, ordinal: null, semantics: 'counted-definition' }]),
      scoring: { provider: 'yahoo', dialect: 'yahoo-doc-example', format: 'catalog-modifiers',
        rules: known('settings.stat_modifiers.stats.stat', [{ stat_id: '4', value: '0.04' }]),
        statCatalog: known('settings.stat_categories.stats.stat', [{ stat_id: '4', display_name: 'Passing Yards' }]) },
      periods: [known('current_week', { source: { provider: 'yahoo', resourceKind: 'period', nativeNamespace: '461.l.1234', nativeId: '4' },
        kind: 'week', canonicalPeriodId: null, purpose: 'current' })],
      nativeSettings: { provider: 'yahoo', dialect: 'yahoo-doc-example', fields: known('settings', { scoring_type: 'headpoint' }) },
      competition: { startPeriod: absent(), playoffStartPeriod: absent(), playoffTeamCount: absent(), playoffFormat: absent(),
        playoffRoundFormat: absent(), playoffSeeding: absent(), additionalMatch: absent(), bestBall: absent(), divisionCount: absent(), leagueType: absent() },
      rosterRules: { reserveSlotCount: absent(), taxiSlotCount: absent(), taxiYears: absent(), taxiVeterans: absent(), taxiDeadline: absent(),
        reserveOut: absent(), reserveSuspended: absent(), reserveDoubtful: absent(), maxSubstitutions: absent(),
        substitutionLockWhenStarterActive: absent(), substitutionStartTimeEligibility: absent() },
      waivers: { budget: absent(), type: absent(), clearDays: absent(), dailyEnabled: absent(), dailyHour: absent(), dailyDays: absent(), tradeDeadline: absent() },
      interpretation: { scoring: 'unverified', unsupportedScoringRules: [], roster: 'unverified', unknownSlots: [], competition: 'unverified', reasons: ['documentation_only'] } };
    expect(yahoo.sourceLeague.nativeId).toBe('461.l.1234'); expect(yahoo.slots.value?.[0].count).toBe(3);
    expect(yahoo.scoring.format).toBe('catalog-modifiers'); expect(yahoo.nflWeekMappings).toEqual([]);
    expect(yahoo.periods[0].value?.source.nativeNamespace).not.toBe(value().periods[0].value?.source.nativeNamespace);
  });
});
