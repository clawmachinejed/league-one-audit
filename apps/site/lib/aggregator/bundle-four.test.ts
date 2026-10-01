import { describe, expect, it, vi } from 'vitest';
import type { JsonObject } from '../league-administration/contracts';
import type { LeagueAdministrationStoreRead } from '../league-administration/store-contracts';
import { createSleeperCalendarEvidence } from '../league-administration/period-mapping';
import schedule from '../../test-support/fixtures/sleeper-2026-season-schedule.json';
import { createBundleFourReadService, compareFrozenHistoricalContinuity, type BundleFourDependencies } from './bundle-four';
import { b4Fixture, b4SourceKey } from './b4-acceptance.fixtures';

vi.mock('server-only', () => ({}));
function setup() {
  const f = b4Fixture();
  const dependencies = { enabled: true,
    readSourceMapping: vi.fn(async (id: string) => f.mappings.get(id) ?? null),
    readSource: vi.fn(async (input: Parameters<BundleFourDependencies['readSource']>[0]) => f.reads.get(b4SourceKey(input)) ?? { status: 'missing' as const }),
  } satisfies BundleFourDependencies;
  return { ...f, dependencies, service: createBundleFourReadService(dependencies) };
}
async function read(f: ReturnType<typeof setup>, request = f.request) {
  const result = await f.service.readBundleFour(request);
  if (result.status !== 'read' || result.history.status !== 'available') throw new Error(`Missing B4 fixture history: ${JSON.stringify(result)}`);
  return { ...result, history: result.history };
}
function original(f: ReturnType<typeof setup>, season: 2025 | 2026, family: 'league' | 'rosters' | 'users' | 'matchups', week: number | null = null) {
  const mapping = season === 2025 ? f.previous : f.current;
  const key = b4SourceKey({ ...mapping.scope, family, week }), value = f.reads.get(key);
  if (value?.status !== 'available') throw new Error('Missing fixture source.');
  return { key, value };
}

describe('B4 bounded retained annual history', () => {
  it('uses explicit predecessor identity and preserves season teams, exact points and existing rounded history', async () => {
    const f = setup(), { history, frozen } = await read(f);
    expect(history).toMatchObject({ historyCompleteness: 'complete', identityCompleteness: 'complete',
      range: { firstSeason: 2025, currentSeason: 2026, firstWeek: 1, lastWeek: 14 }, seasons: [
        { mapping: f.current, throughWeek: 0, predecessor: { status: 'verified', leagueSeasonId: f.previous.leagueSeasonId } },
        { mapping: f.previous, throughWeek: 2, predecessor: { status: 'outside-range' }, weeks: [
          { week: 1, scores: [{ rawPoints: 1.004, effectivePoints: 1.004, compatibilityResult: 'tie' }, { rawPoints: 1.003 }] },
          { week: 2, scores: [{ rawPoints: -2, customPoints: 0, effectivePoints: 0, compatibilityResult: 'tie' }, {}] },
        ] },
      ] });
    expect(history.compatibility.managers).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerId: 'current-owner', currentTeamId: 1, wins: 0, losses: 0, ties: 0, seasons: [2026] }),
      expect.objectContaining({ ownerId: 'previous-owner', currentTeamId: null, wins: 0, losses: 0, ties: 2, seasons: [2025] }),
      expect.objectContaining({ ownerId: 'same-owner', currentTeamId: 2, wins: 0, losses: 0, ties: 2, seasons: [2025, 2026] }),
    ]));
    expect(history.seasons[0].teams[0].seasonTeamId).not.toBe(history.seasons[1].teams[0].seasonTeamId);
    expect(history.seasons[0].teams[0].sourceTeam.nativeNamespace).not.toBe(history.seasons[1].teams[0].sourceTeam.nativeNamespace);
    expect(history.seasons[1].teams[0].providerAttribution).toMatchObject({ owner: { nativeId: 'previous-owner' },
      effectiveFrom: null, effectiveTo: null, temporalEvidence: 'season-capture-only' });
    expect(compareFrozenHistoricalContinuity(JSON.parse(JSON.stringify(frozen)))).toEqual(history);
    // Every source is captured once then rechecked once; no completed-season weeks beyond the configured range.
    expect(f.dependencies.readSource.mock.calls).toHaveLength(16);
    expect(f.dependencies.readSource.mock.calls.filter(([input]) => input.family === 'matchups').map(([input]) => input.week)).toEqual([1, 2, 1, 2]);
    expect(f.dependencies.readSourceMapping).toHaveBeenCalledTimes(4);
  });

  it.each(['missing', 'partial', 'wrong-scope'] as const)('keeps memberships but withholds totals for %s weekly evidence', async kind => {
    const f = setup(), { key, value } = original(f, 2025, 'matchups', 1);
    const changed: LeagueAdministrationStoreRead = kind === 'missing' ? { status: 'missing' }
      : { ...value, envelope: { ...value.envelope, ...(kind === 'partial' ? { completeness: 'partial' as const }
        : { scope: { ...value.envelope.scope, leagueKey: 'league1' } }) } };
    f.reads.set(key, changed);
    const { history } = await read(f);
    expect(history.historyCompleteness).toBe('partial');
    expect(history.seasons[1].weeks[0]).toMatchObject({ completeness: 'unavailable', scores: [] });
    expect(history.compatibility.managers).toHaveLength(3);
    expect(history.compatibility.managers.every(manager => manager.wins === null && manager.losses === null && manager.ties === null)).toBe(true);
  });

  it('never assigns historical ownership from current metadata or duplicate manager names', async () => {
    const f = setup();
    f.source(f.current, 'users', [{ user_id: 'current-owner', display_name: 'Past display name' }, { user_id: 'same-owner', display_name: 'Past display name' }]);
    const { history } = await read(f);
    expect(history.managers.map(manager => manager.sourceManager.nativeId).sort()).toEqual(['current-owner', 'previous-owner', 'same-owner']);
    expect(history.managers.find(manager => manager.sourceManager.nativeId === 'current-owner')?.record).toMatchObject({ wins: 0, losses: 0, ties: 0 });
    expect(history.seasons[1].teams[0].effectiveAttribution.manager?.nativeId).toBe('previous-owner');
  });

  it.each(['cross-league', 'wrong-year', 'missing', 'cycle'] as const)('stops a %s predecessor without borrowing its managers', async kind => {
    const f = setup();
    if (kind === 'missing') f.mappings.delete(f.previous.scope.externalLeagueId);
    else if (kind === 'cycle') {
      const { key, value } = original(f, 2026, 'league');
      f.reads.set(key, { ...value, envelope: { ...value.envelope,
        payload: { ...(value.envelope.payload as JsonObject), previous_league_id: f.current.scope.externalLeagueId } } });
    }
    else f.mappings.set(f.previous.scope.externalLeagueId, { ...f.previous, scope: { ...f.previous.scope,
      ...(kind === 'cross-league' ? { leagueKey: 'league1' } : { season: 2024 }) } });
    const { history } = await read(f);
    expect(history.historyCompleteness).toBe('partial');
    expect(history.seasons).toHaveLength(1);
    expect(history.compatibility.managers.map(manager => manager.ownerId)).not.toContain('previous-owner');
    expect(history.compatibility.managers.every(manager => manager.wins === null)).toBe(true);
  });

  it('withholds current completed results until a compatible completion boundary is proved', async () => {
    const f = setup();
    f.source(f.current, 'league', { ...(f.leaguePayload(f.current) as JsonObject), status: 'in_season' });
    const { history } = await read(f, { ...f.request, context: { ...f.request.context,
      lifecycle: 'active', activeSeason: 2026, activeWeek: 4, defaultWeek: 4, temporalState: 'active', nflPhase: 'regular' } });
    expect(history).toMatchObject({ historyCompleteness: 'partial', seasons: [{ throughWeek: null }, { throughWeek: 2 }] });
    expect(f.dependencies.readSource.mock.calls.filter(([input]) => input.season === 2026 && input.family === 'matchups')).toHaveLength(0);
  });

  it('does not treat a pre-draft source as completed history when the external calendar is active', async () => {
    const f = setup();
    f.source(f.current, 'matchups', [{ roster_id: 1, matchup_id: 1, points: 100 }, { roster_id: 2, matchup_id: 1, points: 50 }], 1);
    const evidence = createSleeperCalendarEvidence({ season: '2026', seasonSchedule: schedule.body,
      evaluatedAt: '2026-09-15T17:30:00.000Z', retrievalStartedAt: '2026-09-15T17:33:43.000Z',
      retrievalCompletedAt: '2026-09-15T17:33:44.000Z' });
    if (!evidence) throw new Error('Invalid B4 calendar fixture.');
    const { history } = await read(f, { ...f.request,
      calendar: { leagueSeasonId: f.current.leagueSeasonId, sourceMappingRevisionId: f.current.revisionId, evidenceRef: 'fixture', evidence },
      context: { ...f.request.context, lifecycle: 'active', activeSeason: 2026, activeWeek: 2,
        defaultWeek: 2, temporalState: 'active', nflPhase: 'regular' },
    });
    expect(history.historyCompleteness).toBe('partial');
    expect(history.seasons[0].throughWeek).toBeNull();
    expect(history.managers.find(manager => manager.sourceManager.nativeId === 'current-owner')?.record.wins).toBeNull();
    expect(f.dependencies.readSource.mock.calls.filter(([input]) => input.season === 2026 && input.family === 'matchups')).toHaveLength(0);
  });

  it('does not finalize older pre-final scores when a newer completed configuration arrives', async () => {
    const f = setup(), { key, value } = original(f, 2025, 'matchups', 1);
    f.reads.set(key, { ...value, verifiedAt: '2026-01-01T11:59:59.999Z' });
    const { history, frozen } = await read(f);
    expect(history.historyCompleteness).toBe('partial');
    expect(history.seasons[1].weeks[0]).toMatchObject({ completeness: 'unavailable', scores: [] });
    expect(history.reasons).toContain('2025:matchups:1:unavailable');
    expect(frozen.sourceEvidence.find(source => source.request.season === 2025 && source.request.family === 'matchups' && source.request.week === 1))
      .toMatchObject({ guard: 'rejected', guardReason: 'history_source_stale', observationId: value.observationId,
        verifiedAt: '2026-01-01T11:59:59.999Z', sourceObservedAt: value.envelope.provenance.sourceObservedAt });
    expect(compareFrozenHistoricalContinuity({ ...frozen, evaluatedAt: '2026-10-01T00:00:00.000Z' }))
      .toEqual({ status: 'unavailable', reason: 'historical_comparison_manifest_invalid' });
    expect(compareFrozenHistoricalContinuity({ ...frozen, sourceEvidence: [] }))
      .toEqual({ status: 'unavailable', reason: 'historical_comparison_manifest_invalid' });
  });

  it('accepts the exact completed-verification boundary without restamping retained source time', async () => {
    const f = setup(), { value } = original(f, 2025, 'matchups', 1);
    const { history } = await read(f);
    expect(history.historyCompleteness).toBe('complete');
    expect(history.seasons[1].sources.find(source => source.family === 'matchups' && source.week === 1))
      .toMatchObject({ verifiedAt: '2026-01-01T12:00:00.000Z', provenance: value.envelope.provenance });
  });

  it.each(['old-current', 'unknown-cache'] as const)('does not promote %s evidence to fresh source authority', async kind => {
    const f = setup(), { key, value } = original(f, kind === 'old-current' ? 2026 : 2025, 'league');
    f.reads.set(key, { ...value, verifiedAt: kind === 'old-current' ? '2026-09-30T11:59:00.000Z' : null });
    const { history } = await read(f);
    expect(history.historyCompleteness).toBe('partial');
    expect(history.compatibility.managers.every(manager => manager.wins === null)).toBe(true);
  });

  it('fences a remap during capture', async () => {
    const f = setup();
    f.dependencies.readSourceMapping.mockResolvedValueOnce(f.current).mockResolvedValueOnce(f.previous)
      .mockResolvedValueOnce({ ...f.current, generation: 2 });
    expect(await f.service.readBundleFour(f.request)).toEqual({ status: 'unavailable', reason: 'historical_mapping_changed' });
  });

  it('fences an accepted correction during capture instead of combining source heads', async () => {
    const f = setup(); let reads = 0;
    const { key, value } = original(f, 2025, 'matchups', 1);
    f.dependencies.readSource.mockImplementation(async input => {
      if (b4SourceKey(input) === key && ++reads > 1) return { ...value, generation: 2 };
      return f.reads.get(b4SourceKey(input)) ?? { status: 'missing' as const };
    });
    expect(await f.service.readBundleFour(f.request)).toEqual({ status: 'unavailable', reason: 'historical_source_changed' });
  });

  it('restarts frozen comparison after a correction without following heads, allocating IDs or changing original evidence', async () => {
    const f = setup(), first = await read(f), frozen = JSON.parse(JSON.stringify(first.frozen));
    f.source(f.previous, 'matchups', [{ roster_id: 1, matchup_id: 1, points: 1.004, custom_points: 0 },
      { roster_id: 2, matchup_id: 1, points: 1.003 }], 1, '2026-02-01T12:00:00.000Z');
    const corrected = await read(f);
    expect(corrected.history.compatibility.managers.find(manager => manager.ownerId === 'previous-owner'))
      .toMatchObject({ wins: 0, losses: 1, ties: 1 });
    const sourceCalls = f.dependencies.readSource.mock.calls.length, mappingCalls = f.dependencies.readSourceMapping.mock.calls.length;
    expect(compareFrozenHistoricalContinuity(frozen)).toEqual(first.history);
    expect(f.dependencies.readSource).toHaveBeenCalledTimes(sourceCalls);
    expect(f.dependencies.readSourceMapping).toHaveBeenCalledTimes(mappingCalls);
    expect(compareFrozenHistoricalContinuity({ ...frozen, projectionDigest: 'changed-policy' }))
      .toEqual({ status: 'unavailable', reason: 'historical_comparison_policy_changed' });
    frozen.input.currentSeason = 2027;
    expect(compareFrozenHistoricalContinuity(frozen)).toEqual({ status: 'unavailable', reason: 'historical_comparison_manifest_invalid' });
  });
});
