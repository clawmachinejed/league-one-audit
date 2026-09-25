import type { CapabilityStatus, LeagueCapabilityFeature, LeagueCapabilityReport } from './league-capability-contracts';
import { normalizeSleeperScoringProfile, SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS } from './projections/adapters/sleeper/scoring-profile';
import { compatibleRevision, compatibleScoringRulesHash } from './projections/shared/revision-compatibility';
import { providerKey } from './projections/shared/provider-identity';

const VERSION = 'league-capabilities-v1';
const SLOT_TYPES = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX', 'SUPER_FLEX', 'WRRB_FLEX', 'REC_FLEX', 'BN', 'IR', 'TAXI']);
// These omissions already have an approved, documented projection policy. New
// events cannot inherit that exception merely because actual scoring supports them.
const ESTABLISHED_PROJECTION_OMISSIONS = new Set(['pass_td_40p', 'rush_td_40p', 'rec_td_40p', 'fum_rec',
  'fum_rec_td', 'st_td', 'def_2pt', 'def_3_and_out', 'def_4_and_stop', 'fgm_yds_over_30']);
const OPERATIONAL_COUNTERS = new Set(['leg', 'last_scored_leg', 'daily_waivers_last_ran', 'last_report']);
// Known management settings do not implement commissioner actions on this site.
// Unfamiliar material fields remain visible as unverified format evidence.
const KNOWN_SETTINGS = new Set(['type', 'num_teams', 'best_ball', 'league_average_match', 'divisions', 'start_week',
  'playoff_week_start', 'playoff_teams', 'playoff_round_type', 'playoff_type', 'playoff_seed_type',
  'max_subs', 'sub_lock_if_starter_active', 'sub_start_time_eligibility', 'bench_lock', 'capacity_override',
  'commissioner_direct_invite', 'daily_waivers', 'daily_waivers_days', 'daily_waivers_hour', 'disable_adds',
  'disable_trades', 'draft_rounds', 'faab_suggestions', 'max_keepers', 'offseason_adds', 'pick_trading',
  'reserve_allow_cov', 'reserve_allow_dnr', 'reserve_allow_doubtful', 'reserve_allow_na', 'reserve_allow_out',
  'reserve_allow_sus', 'reserve_slots', 'taxi_allow_vets', 'taxi_deadline', 'taxi_slots', 'taxi_years',
  'trade_deadline', 'trade_review_days', 'veto_auto_poll', 'veto_show_votes', 'veto_votes_needed',
  'waiver_bid_min', 'waiver_budget', 'waiver_clear_days', 'waiver_day_of_week', 'waiver_type']);
const LABELS: Record<LeagueCapabilityFeature['id'], string> = {
  roster: 'Roster slot types', actual_scoring: 'Calculated player statistics', projections: 'Player projections',
  standings: 'Projected standings', schedule_history: 'Schedules and history', substitutions: 'Lineup substitutions',
};
const STATUS_ORDER: CapabilityStatus[] = ['supported', 'limited', 'unverified', 'unsupported'];
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function numericDictionary(value: unknown): value is Record<string, number> {
  return record(value) && Object.keys(value).length <= 512 && Object.entries(value).every(([key, weight]) =>
    key.length > 0 && key.length <= 80 && typeof weight === 'number' && Number.isFinite(weight));
}
function feature(id: LeagueCapabilityFeature['id'], status: CapabilityStatus, reason: string, ruleKeys?: string[]): LeagueCapabilityFeature {
  return { id, label: LABELS[id], status, reasons: [reason], ...(ruleKeys?.length ? { ruleKeys: [...ruleKeys].sort() } : {}) };
}
function aggregate(features: readonly LeagueCapabilityFeature[]): CapabilityStatus {
  return STATUS_ORDER[Math.max(...features.map(item => STATUS_ORDER.indexOf(item.status)))];
}
function raise(item: LeagueCapabilityFeature, status: CapabilityStatus, reason: string): void {
  if (STATUS_ORDER.indexOf(status) > STATUS_ORDER.indexOf(item.status)) item.status = status;
  item.reasons.push(reason);
}

export function unverifiedLeagueCapabilities(reason: string, assessedAt = new Date().toISOString()): LeagueCapabilityReport {
  return { version: VERSION, configurationRevision: null, scoringRulesHash: null, assessedAt, status: 'unverified',
    features: (Object.keys(LABELS) as LeagueCapabilityFeature['id'][]).map(id => feature(id, 'unverified', reason)) };
}

/** Pure settings preflight, shared by discovery and operator reports. No enrollment,
 * provider calls, writes, scoring calculations, or promises of current data availability. */
export function assessSleeperLeagueCapabilities(source: unknown, assessedAt = new Date().toISOString()): LeagueCapabilityReport {
  const raw = record(source) ? source : {};
  const settings = numericDictionary(raw.settings) ? raw.settings : null;
  const scoring = numericDictionary(raw.scoring_settings) && Object.keys(raw.scoring_settings).length ? raw.scoring_settings : null;
  const slots = Array.isArray(raw.roster_positions) && raw.roster_positions.length > 0 && raw.roster_positions.length <= 200
    && raw.roster_positions.every(slot => typeof slot === 'string' && slot.length > 0 && slot.length <= 40)
    ? raw.roster_positions as string[] : null;
  const identity = raw.sport === 'nfl' && raw.season_type === 'regular' && typeof raw.season === 'string' && /^\d{4}$/u.test(raw.season);
  const teamCount = typeof raw.total_rosters === 'number' && Number.isInteger(raw.total_rosters)
    && raw.total_rosters >= 2 && raw.total_rosters <= 64 ? raw.total_rosters : null;
  const materialSettings = settings ? Object.fromEntries(Object.entries(settings).filter(([key]) => !OPERATIONAL_COUNTERS.has(key))) : null;
  const configurationRevision = identity && settings && scoring && slots && teamCount !== null ? compatibleRevision({ version: VERSION,
    sport: raw.sport, season: raw.season, season_type: raw.season_type, total_rosters: teamCount,
    settings: materialSettings, scoring_settings: scoring, roster_positions: slots }) : null;
  const result: LeagueCapabilityReport = { version: VERSION, configurationRevision,
    scoringRulesHash: scoring ? compatibleScoringRulesHash(scoring) : null, assessedAt, status: 'unverified', features: [] };
  if (!identity) {
    return unverifiedLeagueCapabilities('A complete NFL regular-season settings document is required.', assessedAt);
  }
  const unknownSlots = slots?.filter(slot => !SLOT_TYPES.has(slot)) ?? [];
  const roster = !slots ? feature('roster', 'unverified', 'The ordered roster slots are missing or invalid.')
    : unknownSlots.length ? feature('roster', 'unsupported', 'Some roster slots are outside the supported player catalog.', [...new Set(unknownSlots)])
      : feature('roster', 'supported', 'These roster slot types are supported. Actual lineup completeness is checked separately.');
  if (teamCount === null
    || settings?.num_teams !== undefined && settings.num_teams !== raw.total_rosters) {
    raise(roster, 'unverified', 'The team count is missing, inconsistent or outside the qualified input range.');
  }
  const unknownActualRules = scoring ? Object.keys(scoring).filter(key => scoring[key] !== 0 && !SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS.has(key)) : [];
  const actual = !scoring ? feature('actual_scoring', 'unverified', 'Valid scoring rules are required.')
    : unknownActualRules.length ? feature('actual_scoring', 'unsupported', 'These active scoring events are not supported for calculated player statistics.', unknownActualRules)
      : feature('actual_scoring', 'supported', 'Active scoring events are supported. Publication still requires complete statistics and agreement with official Sleeper scores.');
  if (Number(raw.season) < 2026 || Number(raw.season) > 2200) {
    raise(actual, 'unsupported', 'Calculated player-stat publication supports regular seasons from 2026 through 2200.');
  }
  if (scoring && !Object.values(scoring).some(weight => weight !== 0)) {
    raise(actual, 'unsupported', 'Calculated player-stat publication requires at least one active scoring rule.');
  }
  const normalized = scoring ? normalizeSleeperScoringProfile({ provider: providerKey('sleeper'), rawRules: scoring }) : null;
  let projections = feature('projections', 'unverified', 'Valid scoring rules are required.');
  if (normalized?.status === 'available') {
    const omitted = [...normalized.profile.provenance.unsupportedSourceKeys];
    const unqualified = omitted.filter(key => !ESTABLISHED_PROJECTION_OMISSIONS.has(key));
    projections = unqualified.length ? feature('projections', 'unsupported', 'The projection feed and calculator do not support every active scoring event. Official Sleeper scores remain usable.', unqualified)
      : omitted.length ? feature('projections', 'limited', 'Projections omit these events under the existing projection policy; actual scores include them.', omitted)
        : feature('projections', 'supported', 'Scoring event types are supported. Exact-week projection data is still required.');
    if (normalized.profile.provenance.usesPointsAllowedBucketProxy) {
      raise(projections, 'limited', 'Team-defense points allowed use the existing projected scoring-tier approximation.');
    }
    if (normalized.profile.provenance.supplementalEstimate) {
      raise(projections, 'limited', 'Distance-based field goals and rare-event bonuses use historical NFL rates applied to Tank01 forecasts. Actual points use the exact Sleeper rules.');
    }
  }
  if (roster.status !== 'supported') raise(projections, roster.status, 'Projection eligibility also depends on supported roster slots and a verified team count.');
  let standings = feature('standings', 'unverified', 'Complete competition settings are required.');
  let history = feature('schedule_history', 'unverified', 'Complete competition settings are required.');
  let substitutions = feature('substitutions', 'unverified', 'The substitution setting has not been verified.');
  if (settings) {
    const knownH2h = ['start_week', 'best_ball', 'league_average_match'].every(key => Number.isInteger(settings[key]));
    const h2h = settings.start_week === 1 && settings.best_ball === 0 && settings.league_average_match === 0;
    const playoffStart = settings.playoff_week_start;
    const validPlayoffs = Number.isInteger(playoffStart) && playoffStart >= 0 && playoffStart <= 18;
    const unknownFormat = Object.keys(settings).filter(key => !KNOWN_SETTINGS.has(key) && !OPERATIONAL_COUNTERS.has(key));
    standings = !knownH2h ? feature('standings', 'unverified', 'The season start, best-ball and extra-match settings must be verified.')
      : !h2h || (settings.divisions ?? 0) !== 0
      ? feature('standings', 'unsupported', 'Projected standings require a Week 1 start, ordinary head-to-head games, no best ball and no divisions.')
      : !validPlayoffs ? feature('standings', 'unverified', 'The playoff start is missing or invalid.')
        : feature('standings', 'supported', 'Regular-season projections use win percentage, points for, then points against. Division and playoff seeding are not calculated.');
    history = !knownH2h ? feature('schedule_history', 'unverified', 'The season start, best-ball and extra-match settings must be verified.')
      : !h2h ? feature('schedule_history', 'unsupported', 'Combined history is not qualified for extra median games, best ball or a later season start.')
      : feature('schedule_history', 'limited', 'My Team schedules cover Weeks 1–15; manager schedules and regular-season history cover up to Week 14. A complete playoff schedule is not provided.');
    if (!validPlayoffs) raise(history, 'unverified', 'The playoff boundary has not been verified.');
    if (teamCount === null) raise(standings, 'unverified', 'The team count must be verified.');
    else if (teamCount % 2 !== 0) raise(standings, 'unsupported', 'Projected standings require an even number of teams.');
    if ((settings.playoff_round_type ?? 0) !== 0) raise(history, 'limited', 'Multiweek playoff totals are not calculated.');
    if (![0, 1, 2].includes(settings.type) || unknownFormat.length > 0) {
      raise(standings, 'unverified', 'Unfamiliar league-format settings require verification.');
      raise(history, 'unverified', 'Unfamiliar league-format settings require verification.');
    }
    if (settings.best_ball !== 0) raise(projections, 'unverified', 'Best-ball lineup selection is not qualified.');
    const knownAutoSubs = Number.isInteger(settings.max_subs) && settings.max_subs >= 0 && settings.max_subs <= 3
      && ['sub_start_time_eligibility', 'sub_lock_if_starter_active'].every(key =>
        settings[key] === undefined || settings[key] === 0 || settings[key] === 1);
    substitutions = knownAutoSubs ? feature('substitutions', 'supported', settings.max_subs === 0
      ? 'Player substitutions are disabled in these settings.'
      : 'Sleeper applies AutoSubs. Official starter changes refresh the same matchup; incoming players retain their own frozen kickoff baseline, including earlier games.')
      : feature('substitutions', 'unverified', 'The AutoSub count or eligibility settings are not recognized.');
    if (!knownAutoSubs) raise(projections, 'unverified', 'Substitution settings have not been verified.');
  } else raise(projections, 'unverified', 'Competition settings are missing or invalid.');
  result.features = [roster, actual, projections, standings, history, substitutions];
  result.status = aggregate(result.features);
  return result;
}
