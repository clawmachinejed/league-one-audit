/** Synthetic existing-schema rows for reader qualification; never used by runtime. */
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import type { JsonValue } from '../league-administration/contracts';

export function lineupApplicabilityFixture(mapping: AdministrationSourceMapping, configuration: JsonValue, week: number) {
  const at = '2026-09-29T12:00:00.000Z';
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope,
    family: 'league', week: null, completeness: 'complete', payload: configuration,
    provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
  if (normalized.status !== 'accepted' || normalized.value?.family !== 'league') throw new Error('Invalid lineup fixture configuration.');
  const versionId = '11111111-2222-4333-8444-000000000001';
  return {
    activation: { id: '11111111-2222-4333-8444-000000000002', league_season_id: mapping.leagueSeasonId,
      configuration_version_id: versionId, component: 'roster', component_hash: normalized.value.components.find(c => c.name === 'roster')!.hash,
      applicability: 'evidenced_period', season_type: 'regular', from_week: week, through_week: week,
      evidence: 'synthetic explicit owner confirmation', generation: 2, recorded_at: '2026-09-29T12:00:00.123456+00:00' },
    version: { id: versionId, league_season_id: mapping.leagueSeasonId, dialect: 'sleeper-nfl-v1',
      normalizer_version: 'sleeper-administration-v1', semantic_hash: normalized.semanticHash, components: normalized.value.components },
    source: { configurationContentId: '11111111-2222-4333-8444-000000000003', configurationVersionId: versionId,
      leagueSeasonId: mapping.leagueSeasonId, provider: mapping.scope.provider, externalLeagueId: mapping.scope.externalLeagueId,
      normalizedValue: normalized.value, sourceMapping: mapping },
  };
}
