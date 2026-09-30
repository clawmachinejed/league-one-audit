import { randomUUID } from 'node:crypto';
import type { DatabaseClient } from '../lib/database';
import type { BundleTwoReadInput } from '../lib/aggregator/bundle-two';
import type { SeasonOverviewSourceInput } from '../lib/aggregator/season-overview-source';
import type { AdministrationFamily, JsonObject, JsonValue } from '../lib/league-administration/contracts';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createSleeperCalendarEvidence } from '../lib/league-administration/period-mapping';
import { createProjectionStore } from '../lib/projection-store';
import type { SleeperMatchup } from '../lib/transform';
import type { League } from '../lib/types';
import schedule from '../test-support/fixtures/sleeper-2026-season-schedule.json';
import { enrollIntegrationSeason } from './administration-enrollment-fixture';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { ownerQuery } from './neon-integration-harness';

export const b2Rules = { rec: 0.5 };
export const b2Players = ['99001001', '99001002'] as const;
export const b2RosterRows = (): Record<string, JsonValue>[] => [1, 2].map((id, index) => ({
  roster_id: id, players: [b2Players[index]], starters: [b2Players[index], '0'], reserve: [], taxi: [],
  owner_id: `b2-manager-${id}`, co_owners: [], metadata: { team_name: index ? 'Alpha' : 'Zulu' },
  settings: { wins: 1, losses: 1, ties: 1, fpts: 100, fpts_decimal: 0.001,
    fpts_against: index ? 95 : 105, rank: index ? 1 : 2, waiver_position: id, waiver_budget_used: index ? 0 : -10 },
}));

export async function b2Instant() {
  const [clock] = await ownerQuery('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
  return exactMatchupClockInstant(clock.at);
}

/** All writes use the already guarded disposable target. No role or harness setup is duplicated. */
export async function createB2Fixture(database: DatabaseClient) {
  const administration = createLeagueAdministrationMethods(database);
  const projection = createProjectionStore(database);
  const leagueKey = `b2-acceptance-${randomUUID()}`, externalLeagueId = `b2-source-${randomUUID()}`;
  const registered = await projection.registerLeagueSeason({ leagueKey, leagueName: 'Synthetic B2 acceptance',
    season: 2026, sleeperLeagueId: externalLeagueId, scoringRules: b2Rules });
  if (registered.kind !== 'stored') throw new Error('Missing isolated B2 registration.');
  await enrollIntegrationSeason(ownerQuery, [leagueKey], 2026);
  const mapping = await administration.readSourceMapping(externalLeagueId);
  if (!mapping) throw new Error('Missing isolated B2 mapping.');
  const league: League = { season: '2026', week: 4, maxWeek: 18, rosterPositions: ['QB', 'RB'] };
  const leaguePayload: JsonObject = { league_id: externalLeagueId, season: '2026', sport: 'nfl',
    season_type: 'regular', status: 'in_season', total_rosters: 2, roster_positions: ['QB', 'RB', 'BN'],
    scoring_settings: b2Rules, settings: { leg: 4, start_week: 1, best_ball: 0,
      league_average_match: 0, playoff_week_start: 15, waiver_budget: 100 } };
  const evidence = createSleeperCalendarEvidence({ season: '2026',
    seasonSchedule: schedule.body.map(game => ({ ...game, status: game.week < 4 ? 'complete' : game.status })),
    evaluatedAt: '2026-09-30T12:00:00.000Z', retrievalStartedAt: '2026-09-30T12:00:00.000Z',
    retrievalCompletedAt: '2026-09-30T12:00:00.000Z' });
  if (!evidence) throw new Error('Invalid isolated B2 calendar.');
  const calendar = { leagueSeasonId: mapping.leagueSeasonId, sourceMappingRevisionId: mapping.revisionId,
    evidenceRef: `synthetic-b2-calendar-${randomUUID()}`, evidence };
  async function document(family: AdministrationFamily, payload: JsonValue, week: number | null = null,
    completeness: 'complete' | 'partial' = 'complete') {
    const at = await b2Instant();
    return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping!.scope,
      family, week, completeness, payload, provenance: { origin: 'network', requestStartedAt: at,
        requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
  }
  const settingsAttempt = await administration.beginLeagueSettingsAttempt(mapping, randomUUID());
  const settings = await document('league', leaguePayload);
  const settingsWrite = await administration.recordObservation(settings, undefined, mapping,
    undefined, undefined, { attempt: settingsAttempt });
  if (!settingsWrite.observationId || settingsWrite.leagueSettingsAcceptance?.status !== 'accepted') {
    throw new Error('Missing isolated B2 settings acceptance.');
  }
  const proof = { observationId: settingsWrite.observationId, contentHash: settings.contentHash, envelope: settings.envelope };
  async function roster(rows = b2RosterRows(), options: { managers?: boolean; partial?: boolean } = {}) {
    const attempts = await administration.beginRosterCapture(mapping!, randomUUID(), randomUUID());
    const normalized = await document('rosters', rows, null, options.partial ? 'partial' : 'complete');
    const written = await administration.recordObservation(normalized, undefined, mapping!,
      { attempt: attempts.players, population: proof },
      options.managers === false ? undefined : { attempt: attempts.managers, population: proof });
    const read = await administration.readAcceptedCurrentRoster(mapping!, { includeSeasonOverview: true });
    if (read.status !== 'available' || read.seasonOverview?.status !== 'available') {
      throw new Error('Missing isolated B2 roster acceptance.');
    }
    const input: SeasonOverviewSourceInput = { mapping: mapping!, normalized,
      accepted: read.accepted, receipt: read.receipt, seasonTeams: read.teams };
    return { rows, normalized, written, read, input };
  }
  async function matchup(week: number, rows: readonly SleeperMatchup[]) {
    const attempt = await administration.beginExactMatchupAttempt(mapping!, week, randomUUID());
    // Exact-matchup acceptance binds independently captured population after its reservation.
    const population = await document('league', leaguePayload);
    const populationWrite = await administration.recordObservation(population);
    if (!populationWrite.observationId) throw new Error('Missing isolated B2 matchup population.');
    const normalized = await document('matchups', rows as unknown as JsonValue, week);
    const written = await administration.recordObservation(normalized, undefined, mapping!, undefined, undefined,
      undefined, { attempt, population: { observationId: populationWrite.observationId,
        contentHash: population.contentHash, envelope: population.envelope } });
    if (written.matchupAcceptance?.status !== 'accepted') throw new Error('Missing isolated B2 matchup acceptance.');
    return { normalized, written, read: await administration.readAcceptedExactMatchups(mapping!, week) };
  }
  await administration.recordObservation(await document('users', [1, 2].map(id => ({
    user_id: `b2-manager-${id}`, display_name: `Manager ${id}`, avatar: null,
  }))));
  const initial = await roster();
  async function request(overrides: Partial<BundleTwoReadInput> = {}): Promise<BundleTwoReadInput> {
    const now = new Date(Math.max(Date.parse(await b2Instant()), Date.parse(evidence!.retrievalCompletedAt) + 1_000));
    return { expectedMapping: mapping!, league, selectedWeek: 4,
      selectedSeasonTeamId: initial.read.teams[0].seasonTeamId, now, calendar,
      context: { defaultSeason: 2026, defaultWeek: 4, activeSeason: 2026, activeWeek: 4,
        lifecycle: 'active', nflPhase: 'regular', temporalState: 'active', refreshDue: false },
      scheduleRange: null, snapshot: null, ...overrides };
  }
  return { database, administration, projection, ...registered.value, mapping, leagueKey, externalLeagueId,
    league, leaguePayload, calendar, settings, proof, document, roster, matchup, initial, request };
}
export type B2Fixture = Awaited<ReturnType<typeof createB2Fixture>>;

/** Exact retained evidence, accepted pointers and existing publications must survive B2 reads unchanged. */
export async function b2Fingerprint(leagueSeasonId: string) {
  return ownerQuery(`SELECT
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM league_administration_contents c WHERE league_season_id=$1) AS contents,
    (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM league_administration_observations o WHERE league_season_id=$1) AS observations,
    (SELECT jsonb_agg(to_jsonb(h) ORDER BY family,week) FROM league_administration_heads h WHERE league_season_id=$1) AS heads,
    (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.scope_id) FROM league_roster_resource_heads h
      JOIN league_roster_resource_scopes s ON s.id=h.scope_id WHERE s.league_season_id=$1) AS accepted_heads,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM league_roster_capture_receipts r
      JOIN league_roster_resource_attempts a ON a.id=r.attempt_id
      JOIN league_roster_resource_scopes s ON s.id=a.scope_id WHERE s.league_season_id=$1) AS receipts,
    (SELECT count(*)::integer FROM projection_snapshots WHERE league_season_id=$1) AS snapshots,
    (SELECT count(*)::integer FROM all_player_stat_observations) AS metric_observations,
    (SELECT count(*)::integer FROM all_player_score_sets) AS metric_score_sets`, [leagueSeasonId]);
}
