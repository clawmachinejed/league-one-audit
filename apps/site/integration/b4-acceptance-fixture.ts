import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { vi } from 'vitest';
import type { DatabaseClient } from '../lib/database';
import type { AdministrationFamily, JsonObject, JsonValue } from '../lib/league-administration/contracts';
import { createLeagueAdministrationStore } from '../lib/league-administration/store';
import { captureAdministrationSourceMapping, recordCapturedAdministration } from '../lib/league-administration/runtime';
import { getOfficialAdministrationObservation } from '../lib/sleeper';
import type { BundleFourReadInput } from '../lib/aggregator/bundle-four';
import { registerEnrolledIntegrationSeason } from './administration-enrollment-fixture';
import { createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { exactMatchupClockInstant } from './exact-matchup-clock';

type Enrollment = { league_id: string; provider: string; active: boolean; evidence: string; enrolled_at: string };
type EnrollmentSeason = { league_id: string; season: number; provider: string; evidence: string; recorded_at: string };
type EnrollmentState = { enrollment: Enrollment | null; seasons: EnrollmentSeason[] | null };

function assertEnrollmentIntegrity(before: EnrollmentState, after: EnrollmentState, createdSeasons: readonly number[]) {
  assert.ok(after.enrollment, 'B4 fixture enrollment must remain present.');
  if (before.enrollment) assert.deepEqual(after.enrollment, before.enrollment, 'B4 must preserve original enrollment evidence.');
  else {
    assert.match(after.enrollment.league_id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu);
    assert.ok(Number.isFinite(Date.parse(after.enrollment.enrolled_at)), 'B4 enrollment must have its recorded timestamp.');
    assert.deepEqual(after.enrollment, { league_id: after.enrollment.league_id, provider: 'sleeper', active: true,
      evidence: 'isolated fixture owner approval', enrolled_at: after.enrollment.enrolled_at });
  }
  const originalSeasons = before.seasons ?? [], retainedSeasons = after.seasons ?? [];
  assert.deepEqual(retainedSeasons.map(row => row.season), [...originalSeasons.map(row => row.season), ...createdSeasons]
    .sort((a, b) => a - b), 'B4 must retain exactly the original and explicitly enrolled seasons.');
  for (const original of originalSeasons) assert.deepEqual(retainedSeasons.find(row => row.season === original.season),
    original, 'B4 must preserve original season enrollment evidence.');
  for (const season of createdSeasons) {
    const membership = retainedSeasons.find(row => row.season === season)!;
    assert.ok(Number.isFinite(Date.parse(membership.recorded_at)), 'B4 membership must have its recorded timestamp.');
    assert.deepEqual(membership, { league_id: after.enrollment.league_id, season, provider: 'sleeper',
      evidence: 'isolated fixture season approval', recorded_at: membership.recorded_at });
  }
}

export const b4Rosters = (season: number): JsonObject[] => [1, 2].map(id => ({ roster_id: id,
  owner_id: id === 1 ? (season === 2026 ? 'b4-new-owner' : 'b4-old-owner') : 'b4-returning-owner',
  co_owners: [], players: [`b4-player-${id}`], starters: [`b4-player-${id}`], reserve: [], taxi: [],
  settings: { wins: 99, losses: 99, ties: 99, fpts: 9999, fpts_against: 9999 } }));
export const b4WeeklyRows = (week: number): JsonObject[] => week === 1
  ? [{ roster_id: 1, matchup_id: 1, points: 1.004 }, { roster_id: 2, matchup_id: 1, points: 1.003 }]
  : [{ roster_id: 1, matchup_id: 2, points: -2, custom_points: 0 }, { roster_id: 2, matchup_id: 2, points: 0 }];

/** Uses only the supervisor's synthetic database; registration is explicit owner setup. */
export async function createB4Fixture(database: DatabaseClient) {
  const administration = createLeagueAdministrationStore(database);
  const suffix = BigInt(`0x${randomUUID().replaceAll('-', '')}`).toString().slice(0, 20);
  const externalIds = { 2026: `992026${suffix}`, 2025: `992025${suffix}` };
  const enrollmentState = async () => (await ownerQuery<EnrollmentState>(`SELECT
    (SELECT to_jsonb(enrollment) FROM league_administration_enrollments enrollment JOIN leagues league ON league.id=enrollment.league_id
      WHERE league.league_key='league2') AS enrollment,
    (SELECT jsonb_agg(to_jsonb(membership) ORDER BY membership.season) FROM league_administration_enrollment_seasons membership
      JOIN leagues league ON league.id=membership.league_id WHERE league.league_key='league2') AS seasons`))[0];
  const originalEnrollment = await enrollmentState();
  const existingSeasons = originalEnrollment.seasons ?? [];
  const createdSeasons = [2025, 2026].filter(season => !existingSeasons.some(row => row.season === season));
  let registeredEnrollment: EnrollmentState | undefined;
  async function cleanup() {
    // Committed enrollment/history is immutable. Only the existing guarded global schema teardown removes it.
    const after = await enrollmentState();
    assertEnrollmentIntegrity(originalEnrollment, after, createdSeasons);
    if (registeredEnrollment) assert.deepEqual(after, registeredEnrollment, 'B4 committed enrollment evidence must remain unchanged.');
    return after;
  }
  // Existing owner registration requires the historical-connection proof and insertion in the same transaction.
  const owner = await createPinnedIntegrationDatabase('owner');
  try {
    await owner.database.query('BEGIN');
    for (const season of [2025, 2026] as const) await registerEnrolledIntegrationSeason(owner.database.query, {
      leagueKey: 'league2', season, sleeperLeagueId: externalIds[season], scoringRules: { rec: 0.5 },
    });
    await owner.database.query('COMMIT');
  } catch (error) { await owner.database.query('ROLLBACK'); throw error; }
  finally { await owner.close(); }
  async function mapping(season: 2025 | 2026) {
    const value = await captureAdministrationSourceMapping(externalIds[season], administration);
    if (!value) throw new Error('Missing B4 fixture mapping.'); return value;
  }
  const league = (season: 2025 | 2026): JsonObject => ({ league_id: externalIds[season], season: String(season),
    previous_league_id: season === 2026 ? externalIds[2025] : null, name: 'Synthetic B4 annual league',
    sport: 'nfl', season_type: 'regular', status: season === 2026 ? 'pre_draft' : 'complete', total_rosters: 2,
    roster_positions: ['QB', 'BN'], scoring_settings: { rec: 0.5 },
    settings: { start_week: 1, playoff_week_start: 3, league_average_match: 0, best_ball: 0 } });
  async function capture(season: 2025 | 2026, family: AdministrationFamily, payload: JsonValue,
    week: number | null = null, completeness: 'complete' | 'partial' = 'complete') {
    const capturedMapping = await mapping(season);
    // The official adapter is exercised against one exact synthetic endpoint; it cannot reach a provider.
    const path = `/v1/league/${externalIds[season]}${family === 'league' ? '' : `/${family}${week === null ? '' : `/${week}`}`}`;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async target => {
      const url = new URL(String(target));
      if (url.origin !== 'https://api.sleeper.app' || url.pathname !== path) throw new Error('Unexpected B4 fixture provider request.');
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    let document;
    try { document = await getOfficialAdministrationObservation(externalIds[season], family, week, 0); }
    finally { fetch.mockRestore(); }
    // The DB clock supplies monotonically ordered synthetic observation instants, including rapid corrections.
    const [clock] = await ownerQuery('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
    const at = new Date(exactMatchupClockInstant(clock.at)).toISOString();
    document = { ...document, requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, completeness };
    const result = await recordCapturedAdministration(capturedMapping.scope, [document], {
      store: administration, mapping: capturedMapping, now: () => new Date(at), expectedRosterCount: 2,
      verify: async () => { throw new Error('Synthetic network evidence cannot request provider verification.'); },
    });
    const read = await administration.readSource({ ...capturedMapping.scope, family, week });
    return { document, result, read, mapping: capturedMapping };
  }
  async function seed() {
    for (const season of [2025, 2026] as const) {
      await capture(season, 'league', league(season));
      await capture(season, 'rosters', b4Rosters(season));
      await capture(season, 'users', [{ user_id: season === 2026 ? 'b4-new-owner' : 'b4-old-owner', display_name: 'Same name' },
        { user_id: 'b4-returning-owner', display_name: 'Returning manager' }]);
    }
    await capture(2025, 'matchups', b4WeeklyRows(1), 1); await capture(2025, 'matchups', b4WeeklyRows(2), 2);
  }
  async function request(overrides: Partial<BundleFourReadInput> = {}): Promise<BundleFourReadInput> {
    const [clock] = await ownerQuery('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
    return { expectedMapping: await mapping(2026), now: new Date(exactMatchupClockInstant(clock.at)), calendar: null,
      context: { defaultSeason: 2026, defaultWeek: 1, activeSeason: null, activeWeek: null,
        lifecycle: 'preseason', nflPhase: 'preseason', temporalState: 'future', refreshDue: false }, ...overrides };
  }
  let seasons: string[];
  try {
    registeredEnrollment = await enrollmentState();
    assertEnrollmentIntegrity(originalEnrollment, registeredEnrollment, createdSeasons);
    seasons = [(await mapping(2025)).leagueSeasonId, (await mapping(2026)).leagueSeasonId];
  }
  catch (error) { await cleanup(); throw error; }
  async function fingerprint() {
    return ownerQuery(`SELECT
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM league_administration_contents c WHERE league_season_id=ANY($1::uuid[])) AS contents,
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM league_administration_observations o WHERE league_season_id=ANY($1::uuid[])) AS observations,
      (SELECT jsonb_agg(to_jsonb(h) ORDER BY league_season_id,family,week) FROM league_administration_heads h WHERE league_season_id=ANY($1::uuid[])) AS heads,
      (SELECT jsonb_agg(to_jsonb(m) ORDER BY observation_id) FROM league_administration_observation_mappings m
        JOIN league_administration_observations o ON o.id=m.observation_id WHERE o.league_season_id=ANY($1::uuid[])) AS mappings`, [seasons]);
  }
  return { administration, externalIds, mapping, league, capture, seed, request, fingerprint, cleanup };
}
export type B4Fixture = Awaited<ReturnType<typeof createB4Fixture>>;

/** Read-only fixture validation must never prevent the independent restricted connection from closing. */
export async function closeB4Fixture(fixture: Pick<B4Fixture, 'cleanup'> | undefined,
  connection: Pick<IndependentDatabase, 'close'> | undefined) {
  try { await fixture?.cleanup(); }
  finally { await connection?.close(); }
}
