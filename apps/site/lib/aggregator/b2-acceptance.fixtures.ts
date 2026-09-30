/** Synthetic same-capture fixture; never imported by runtime code. */
import type { JsonObject } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { currentRosterMethods } from '../league-administration/neon/current-roster';
import { b1CaptureEnvelope, b1CompatibilityFixture, b1CurrentRosterFixture, b1Mapping, b1Uuid } from './b1-acceptance.fixtures';
import type { DatabaseClient } from '../database';
import type { SeasonOverviewSourceInput } from './season-overview-source';
import type { LeagueAdministrationStoreRead } from '../league-administration/store-contracts';
import { leagueSettingsScope, LEAGUE_SETTINGS_POLICY, type AcceptedLeagueSettingsRead } from './league-settings';

export async function b2Capture(change?: (rows: JsonObject[]) => void) {
  const b1 = b1CompatibilityFixture();
  const row = b1CurrentRosterFixture(b1);
  const rows = (row.payload as JsonObject[]).map((team, index) => ({ ...team,
    owner_id: `manager-${index + 1}`, metadata: { team_name: index ? 'Alpha' : 'Zulu' },
    settings: { wins: 1, losses: 1, ties: 0, fpts: 100, fpts_decimal: 0.001,
      fpts_against: index ? 95 : 105, fpts_against_decimal: 0,
      waiver_position: index + 1, waiver_budget_used: index ? 0 : -10 },
  }));
  change?.(rows);
  const normalized = normalizeAdministrationObservation({ ...b1CaptureEnvelope(b1), family: 'rosters', week: null, payload: rows },
    { expectedRosterCount: 2 });
  Object.assign(row, { payload: rows, content_hash: normalized.contentHash, normalized_value: normalized.value });
  const database = { enabled: true, query: async () => [row] } as unknown as DatabaseClient;
  const roster = await currentRosterMethods(database).readAcceptedCurrentRoster(b1Mapping, { includeSeasonOverview: true });
  if (roster.status !== 'available' || roster.seasonOverview?.status !== 'available') throw new Error('Invalid B2 fixture.');
  const input: SeasonOverviewSourceInput = { normalized, mapping: b1Mapping,
    accepted: roster.accepted, receipt: roster.receipt, seasonTeams: roster.teams };
  const users: LeagueAdministrationStoreRead = { status: 'available', observationId: b1Uuid(80), versionId: null,
    generation: 1, checkedAt: row.provenance.checkedAt, verifiedAt: row.provenance.sourceObservedAt,
    envelope: { ...normalized.envelope, family: 'users', payload: [
      { user_id: 'manager-1', display_name: 'Manager Zulu' }, { user_id: 'manager-2', display_name: 'Manager Alpha' },
    ] } };
  const configuration = normalizeAdministrationObservation({ ...normalized.envelope, family: 'league',
    payload: { league_id: b1Mapping.scope.externalLeagueId, season: '2026', sport: 'nfl', season_type: 'regular',
      status: 'in_season', total_rosters: 2, settings: { waiver_budget: 100 }, scoring_settings: { rec: 0.5 } } });
  if (!configuration.leagueSettings?.value) throw new Error('Invalid settings fixture.');
  const settings: AcceptedLeagueSettingsRead = { status: 'available', leagueId: b1Uuid(81), leagueSeasonId: b1Mapping.leagueSeasonId,
    accepted: { ...roster.accepted, scope: leagueSettingsScope(b1Mapping), contentId: b1Uuid(82),
      canonicalNormalizerVersion: LEAGUE_SETTINGS_POLICY.canonicalNormalizerVersion },
    receipt: { id: b1Uuid(83), attemptId: b1Uuid(84), ordinal: 1, legacyObservationId: b1Uuid(85), provenance: row.provenance,
      sourceUpdatedAt: null, rawContentHash: configuration.contentHash, configurationVersionId: b1Uuid(86),
      configurationSemanticHash: configuration.semanticHash },
    value: configuration.leagueSettings.value, comparison: { status: 'equal', fields: [], legacyConfiguration: 'equal' } };
  return { b1, row, database, roster, source: roster.seasonOverview, input, mapping: b1Mapping, users, settings,
    now: new Date('2026-09-29T12:03:00.000Z') };
}
