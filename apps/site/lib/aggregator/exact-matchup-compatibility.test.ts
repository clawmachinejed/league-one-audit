import { describe, expect, it } from 'vitest';
import type { AdministrationEnvelope, JsonValue } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { compatibleScoringRulesHash } from '../projections/shared/revision-compatibility';
import type { CalculationObservationSourceHistory } from '../projections/shared/source-history';
import type { MatchupsData, Player } from '../types';
import { EXACT_MATCHUPS_POLICY, exactMatchupsScope, projectExactMatchups } from './exact-matchups';
import { joinAcceptedExactMatchupDerived, type JoinAcceptedExactMatchupDerivedInput,
  type CompatibilityConfigurationEvidence } from './exact-matchup-compatibility';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-29T16:00:00.000Z';
const later = '2026-09-29T16:01:00.000Z';
type Depth = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8];
type Mutable<T, D extends number = 8> = D extends 0 ? T : T extends Date ? Date
  : T extends object ? { -readonly [K in keyof T]: Mutable<T[K], Depth[D]> } : T;
function mutableClone<T>(value: T): Mutable<T> { return structuredClone(value) as Mutable<T>; }
type Input = Mutable<JoinAcceptedExactMatchupDerivedInput>;

function fixture(): Input {
  const mapping = { connectionId: id(1), leagueSeasonId: id(2), revisionId: id(3), generation: 1,
    scope: { provider: 'sleeper' as const, leagueKey: 'league1', externalLeagueId: 'source-2026', season: 2026 } };
  const provenance = { origin: 'network' as const, requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at };
  const envelope = (family: 'league' | 'matchups', payload: JsonValue): AdministrationEnvelope => ({
    schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: mapping.scope, family, week: family === 'matchups' ? 4 : null, completeness: 'complete', provenance, payload });
  const rules = { pass_yd: 0.04, pass_td: 4 };
  const leaguePayload = { league_id: 'source-2026', season: '2026', sport: 'nfl', season_type: 'regular',
    total_rosters: 2, roster_positions: ['QB', 'FLEX'], scoring_settings: rules, settings: { leg: 4 }, status: 'in_season' };
  const raw: JsonValue[] = [
    { roster_id: 1, matchup_id: 7, players: ['a'], starters: ['a', '0'], points: 8.25, custom_points: 0,
      starters_points: [8.25, 0], players_points: { a: 9.5 } },
    { roster_id: 2, matchup_id: 7, players: ['b'], starters: ['b', '0'], points: 2, custom_points: null,
      starters_points: [2, 0], players_points: { b: 2 } },
  ];
  const normalized = normalizeAdministrationObservation(envelope('matchups', raw), { expectedRosterCount: 2 });
  const leagueNormalized = normalizeAdministrationObservation(envelope('league', leaguePayload));
  if (normalized.status !== 'accepted' || leagueNormalized.status !== 'accepted') throw new Error('Bad test source.');
  const periodMapping = { status: 'mapped' as const, purpose: 'native-period-identity' as const,
    evidenceRef: id(10), policyVersion: 'sleeper-native-week-to-nfl-regular-v1', scheduleRevision: 'schedule-v1',
    evaluatedAt: at, retrievalStartedAt: at, retrievalCompletedAt: at, sourceObservedAt: null,
    season: 2026, seasonType: 'regular' as const, week: 4 };
  const configuration: CompatibilityConfigurationEvidence = { contentId: id(11), contentHash: leagueNormalized.contentHash,
    leagueSeasonId: id(2), provider: 'sleeper', externalLeagueId: 'source-2026', configurationVersionId: id(12),
    scoringProfileId: id(13), payload: leaguePayload, periodMapping };
  const original = { leagueWeekObservationId: id(20), matchupContentId: id(21), matchupContentHash: normalized.contentHash,
    matchupPayload: raw, configuration };
  const verification = { ...original, leagueWeekObservationId: id(30) };
  const linked = (n: number, checkedAt: string): CalculationObservationSourceHistory => ({ status: 'linked', captureId: id(n), reservedAt: at,
    mapping, leagueInput: { id: id(n + 1), family: 'league', observationId: id(n + 2), contentId: id(11),
      contentHash: leagueNormalized.contentHash, configurationVersionId: id(12), provenance: { ...provenance, checkedAt },
      legacyObservationProvenance: provenance, acquisitionSourceEpoch: 'capture_mapping_proved' },
    matchupInput: { id: id(n + 3), family: 'matchups', observationId: id(n + 4), contentId: id(21),
      contentHash: normalized.contentHash, configurationVersionId: null, provenance: { ...provenance, checkedAt },
      legacyObservationProvenance: provenance, acquisitionSourceEpoch: 'capture_mapping_proved' } });
  const team = (n: number) => ({ id: n, managerName: `Manager ${n}`, name: `Team ${n}`, avatar: null,
    wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 });
  const player = (n: number): Player => ({ id: n === 1 ? 'a' : 'b', name: 'Player', position: 'QB',
    nflTeam: n === 1 ? 'NYJ' : 'BAL', injuryStatus: null, slot: 'QB', points: n === 1 ? 8.25 : 2, projectedPoints: n === 1 ? 21.23 : 18.45,
    game: { kind: 'scheduled', opponent: n === 1 ? 'BAL' : 'NYJ', location: n === 1 ? 'home' : 'away',
      date: '2026-09-29', kickoffAt: '2026-09-29T16:00:00.000Z' } });
  const empty: Player = { id: 'empty-FLEX-1', name: 'Empty slot', position: '—', nflTeam: null, injuryStatus: null,
    game: null, slot: 'FLEX', points: null, projectedPoints: null };
  const payload: MatchupsData = { league: { season: '2026', week: 4, maxWeek: 18, rosterPositions: ['QB', 'FLEX'] },
    week: 4, updatedAt: at, teams: [team(1), team(2)], matchups: [{ id: '7', status: 'live',
      sides: [1, 2].map(n => ({ team: team(n), points: n === 1 ? 0 : 2, projectedPoints: n === 1 ? 21.23 : 18.45,
        starters: [player(n), { ...empty }] })),
      winProbability: { modelVersion: 'normal-v3', status: 'estimated', teams: [{ teamId: 1, probability: 0.2 }, { teamId: 2, probability: 0.8 }] } }] };
  const request = { snapshotId: id(40), leagueSeasonId: id(2), season: 2026, week: 4, modelVersion: 'clock-v1' };
  return mutableClone<JoinAcceptedExactMatchupDerivedInput>({ request, expectedMapping: mapping,
    accepted: { status: 'available', accepted: { scope: exactMatchupsScope(mapping, 4),
      canonicalNormalizerVersion: EXACT_MATCHUPS_POLICY.canonicalNormalizerVersion, sourceMappingRevisionId: id(3),
      contentId: id(21), observationIds: [id(50)], validationVersion: EXACT_MATCHUPS_POLICY.validationVersion,
      acceptedGeneration: 2, verifiedAt: later, effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' },
    value: projectExactMatchups(normalized, [{ seasonTeamId: id(51), externalRosterId: '1' }, { seasonTeamId: id(52), externalRosterId: '2' }]),
    periodMapping, receipt: { id: id(50), attemptId: id(53), ordinal: 2, legacyObservationId: id(54),
      configurationContentId: id(11), provenance, rawContentHash: normalized.contentHash, expectedTeamCount: 2 },
    comparison: { status: 'equal', fields: ['raw-content'] } },
    snapshot: { snapshotId: id(40), leagueSeasonId: id(2), week: 4, modelVersion: 'clock-v1', revisionKey: 'revision-original',
      calculatedAt: at, verifiedAt: later, publishedAt: at, isCurrent: true,
      activityWindows: [{ startsAt: '2026-09-29T14:00:00.000Z', endsAt: '2026-09-29T23:00:00.000Z' }], payload },
    sourceHistory: { status: 'available', purpose: 'calculation-input-source-history', analyticsCompatibility: 'not_evaluated', scope: request,
      original: { leagueWeekObservationId: id(20), gameStateObservationIds: [id(60)], source: linked(70, at) },
      verification: { status: 'current_snapshot', leagueWeekObservationId: id(30), source: linked(80, later) } },
    immutableEvidence: { profile: { id: id(13), rulesHash: compatibleScoringRulesHash(rules), rules },
      acceptedConfiguration: configuration, original, verification,
      games: { leagueWeekObservationId: id(20), expectedGameCount: 1, expectedGameIds: [id(61)],
        observations: [{ id: id(60), nflGameId: id(61), provider: 'tank01', season: 2026, seasonType: 'reg', week: 4,
          observedAt: at, requestStartedAt: at, requestCompletedAt: at, homeTeam: 'NYJ', awayTeam: 'BAL' }] } },
    context: { defaultSeason: 2026, defaultWeek: 4, activeSeason: 2026, activeWeek: 4, lifecycle: 'active', nflPhase: 'regular',
      temporalState: 'active', refreshDue: false }, now: new Date(later) });
}

function available(input: Input) {
  if (input.accepted.status !== 'available' || input.sourceHistory.status !== 'available' || !input.snapshot || !input.immutableEvidence
    || input.sourceHistory.original.source.status !== 'linked' || input.sourceHistory.verification.source?.status !== 'linked'
    || !input.immutableEvidence.verification || !input.immutableEvidence.games) throw new Error('Expected available fixture.');
  return { accepted: input.accepted, snapshot: input.snapshot, history: input.sourceHistory, evidence: input.immutableEvidence,
    original: input.sourceHistory.original.source, verification: input.sourceHistory.verification.source,
    verificationEvidence: input.immutableEvidence.verification, games: input.immutableEvidence.games };
}
function expectUnavailable(input: Input, reason: string) {
  const read = joinAcceptedExactMatchupDerived(input);
  expect(read.official).toBe(input.accepted);
  expect(read.forecast).toEqual({ status: 'unavailable', reason });
  expect(read.gameState).toEqual({ status: 'unavailable', reason });
  expect(read.probability).toEqual({ status: 'unavailable', reason });
}

/** Rebuild all immutable matchup fixtures from one complete official source change. */
function replaceRaw(input: Input, raw: JsonValue[]) {
  const f = available(input);
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: input.expectedMapping.scope,
    family: 'matchups', week: input.request.week, completeness: 'complete', provenance: f.accepted.receipt.provenance,
    payload: raw }, { expectedRosterCount: raw.length });
  if (normalized.status !== 'accepted') throw new Error('Bad changed source.');
  f.accepted.receipt.expectedTeamCount = raw.length;
  f.accepted.receipt.rawContentHash = normalized.contentHash;
  f.accepted.value = mutableClone(projectExactMatchups(normalized, raw.map((row, index) => ({
    externalRosterId: String((row as { roster_id: number }).roster_id), seasonTeamId: id(51 + index),
  }))));
  for (const evidence of [f.evidence.original, f.verificationEvidence]) {
    evidence.matchupPayload = structuredClone(raw) as Mutable<JsonValue>;
    evidence.matchupContentHash = normalized.contentHash;
  }
  f.original.matchupInput.contentHash = normalized.contentHash;
  f.verification.matchupInput.contentHash = normalized.contentHash;
}

describe('exact matchup compatibility join', () => {
  it('copies stored values and exact identities with separate original/verification times', () => {
    const input = fixture();
    const { snapshot, evidence } = available(input);
    const before = structuredClone(input);
    const result = joinAcceptedExactMatchupDerived(input);
    expect(result.official).toBe(input.accepted);
    expect(result.sourceHistory).toBe(input.sourceHistory);
    expect(result.forecast).toMatchObject({ status: 'available', reference: { snapshotId: id(40), revisionKey: 'revision-original',
      modelVersion: 'clock-v1', scoringProfileId: id(13), scoringRulesHash: evidence.profile.rulesHash,
      calculatedAt: at, verifiedAt: later }, teams: [{ seasonTeamId: id(51), projectedPoints: 21.23,
      starters: [{ index: 0, playerExternalId: 'a', projectedPoints: 21.23 }, { index: 1, playerExternalId: null, projectedPoints: null }] },
    { seasonTeamId: id(52), projectedPoints: 18.45 }] });
    expect(result.gameState).toMatchObject({ status: 'available', observations: [{ id: id(60), observedAt: at }] });
    expect(result.probability).toMatchObject({ status: 'available', groups: [{ value: snapshot.payload.matchups[0].winProbability,
      teams: [{ seasonTeamId: id(51), externalRosterId: '1' }, { seasonTeamId: id(52), externalRosterId: '2' }] }] });
    expect(input).toEqual(before);
    expect(result).not.toHaveProperty('gameState.verificationGameStateObservationIds');
  });

  it('preserves custom zero and compares starter-index scores rather than player-map scores', () => {
    const input = fixture();
    const { accepted, snapshot } = available(input);
    expect(accepted.value.teams[0].officialTeamPoints).toMatchObject({ raw: '8.25', custom: '0', effective: '0' });
    expect(accepted.value.teams[0].starters![0]).toMatchObject({ officialPoints: '8.25', pointSource: 'starter-index' });
    expect(joinAcceptedExactMatchupDerived(input).forecast.status).toBe('available');
    snapshot.payload.matchups[0].sides[0].points = 8.25;
    expectUnavailable(input, 'official_facts_mismatch');
  });

  it('keeps probability on team identity after side and probability-array reversal', () => {
    const input = fixture();
    const { snapshot } = available(input);
    snapshot.payload.matchups[0].sides.reverse();
    const chance = snapshot.payload.matchups[0].winProbability!;
    if (chance.status === 'unavailable') throw new Error('Expected probability.');
    chance.teams.reverse();
    const result = joinAcceptedExactMatchupDerived(input);
    expect(result.probability).toMatchObject({ status: 'available', groups: [{ value: { teams: [
      { teamId: 2, probability: 0.8 }, { teamId: 1, probability: 0.2 },
    ] } }] });
  });

  it.each(['missing', 'unavailable'] as const)('leaves forecast and games available when probability is %s', kind => {
    const input = fixture();
    const { snapshot } = available(input);
    if (kind === 'missing') delete snapshot.payload.matchups[0].winProbability;
    else snapshot.payload.matchups[0].winProbability = { modelVersion: 'normal-v3', status: 'unavailable', reason: 'missing-baseline' };
    const result = joinAcceptedExactMatchupDerived(input);
    expect(result.forecast.status).toBe('available');
    expect(result.gameState.status).toBe('available');
    expect(result.probability).toEqual({ status: 'unavailable', reason: 'probability_unavailable' });
  });

  it('retains games when forecast is absent', () => {
    const input = fixture();
    const { snapshot } = available(input);
    for (const side of snapshot.payload.matchups[0].sides) side.projectedPoints = null;
    const result = joinAcceptedExactMatchupDerived(input);
    expect(result.forecast).toEqual({ status: 'unavailable', reason: 'forecast_unavailable' });
    expect(result.gameState.status).toBe('available');
  });

  it.each([
    ['team correction', (f: ReturnType<typeof available>) => { f.accepted.value.teams[0].officialTeamPoints.effective = '0.5'; }],
    ['starter correction', (f: ReturnType<typeof available>) => { f.accepted.value.teams[0].starters![0].officialPoints = '8.5'; }],
    ['missing starter list', (f: ReturnType<typeof available>) => { f.accepted.value.teams[0].starters = null; }],
    ['empty starter list', (f: ReturnType<typeof available>) => { f.accepted.value.teams[0].starters = []; }],
    ['starter order', (f: ReturnType<typeof available>) => { f.accepted.value.teams[0].starters!.reverse(); }],
    ['vacancy', (f: ReturnType<typeof available>) => { f.accepted.value.teams[0].starters![0].empty = true; }],
    ['group participants', (f: ReturnType<typeof available>) => { f.accepted.value.groups[0].participantTeamIds[0] = id(999); }],
    ['native group', (f: ReturnType<typeof available>) => { f.accepted.value.teams[0].nativeMatchupId = '8'; }],
  ] as const)('rejects %s despite retained content/hash identity', (_name, mutate) => {
    const input = fixture();
    mutate(available(input));
    expectUnavailable(input, 'original_official_facts_mismatch');
  });

  it.each([
    ['starter points', (f: ReturnType<typeof available>) => { f.snapshot.payload.matchups[0].sides[0].starters[0].points = 9.5; }],
    ['starter order', (f: ReturnType<typeof available>) => { f.snapshot.payload.matchups[0].sides[0].starters.reverse(); }],
    ['vacancy shifted', (f: ReturnType<typeof available>) => { f.snapshot.payload.matchups[0].sides[0].starters[1].id = 'empty-FLEX-0'; }],
    ['extra population', (f: ReturnType<typeof available>) => { f.snapshot.payload.teams.push({ ...f.snapshot.payload.teams[0], id: 3 }); }],
    ['duplicate side', (f: ReturnType<typeof available>) => { f.snapshot.payload.matchups[0].sides[1].team.id = 1; delete f.snapshot.payload.matchups[0].winProbability; }],
    ['wrong native group', (f: ReturnType<typeof available>) => { f.snapshot.payload.matchups[0].id = '8'; }],
  ] as const)('rejects snapshot %s independently of raw content equality', (_name, mutate) => {
    const input = fixture();
    mutate(available(input));
    expectUnavailable(input, 'official_facts_mismatch');
  });

  it('does not require historical native slot labels', () => {
    const input = fixture();
    const { accepted } = available(input);
    expect(accepted.value.lineupDefinitionRef).toBeNull();
    expect(accepted.value.teams[0].starters!.every(slot => slot.nativeSlot === null)).toBe(true);
    expect(joinAcceptedExactMatchupDerived(input).forecast.status).toBe('available');
  });

  it.each(['team', 'starter'] as const)('never treats missing %s points as zero', which => {
    const input = fixture();
    const { snapshot } = available(input);
    if (which === 'team') snapshot.payload.matchups[0].sides[0].points = null;
    else snapshot.payload.matchups[0].sides[0].starters[0].points = null;
    expectUnavailable(input, 'official_facts_mismatch');
  });

  it.each(['missing', 'empty'] as const)('distinguishes %s starters using valid captured source evidence', kind => {
    const input = fixture();
    const f = available(input);
    const raw = structuredClone(f.evidence.original.matchupPayload) as Array<Record<string, JsonValue>>;
    raw[0].starters = kind === 'missing' ? null : [];
    raw[0].starters_points = kind === 'missing' ? null : [];
    replaceRaw(input, raw);
    f.snapshot.payload.matchups[0].sides[0].starters = [];
    f.snapshot.payload.matchups[0].sides[0].projectedPoints = null;
    delete f.snapshot.payload.matchups[0].winProbability;
    if (kind === 'missing') expectUnavailable(input, 'official_facts_mismatch');
    else expect(joinAcceptedExactMatchupDerived(input).forecast).toMatchObject({ status: 'available', teams: [
      { projectedPoints: null, starters: [] }, { projectedPoints: 18.45 },
    ] });
  });

  it('preserves unpaired official groups without synthetic analytics opponents', () => {
    const input = fixture();
    const raw = structuredClone(available(input).evidence.original.matchupPayload) as Array<Record<string, JsonValue>>;
    for (const row of raw) row.matchup_id = null;
    replaceRaw(input, raw);
    expect(available(input).accepted.value.groups.every(group => group.format === 'unpaired')).toBe(true);
    expectUnavailable(input, 'official_facts_mismatch');
  });

  it('preserves multiple participant official groups without paired analytics', () => {
    const input = fixture();
    const f = available(input);
    const raw = structuredClone(f.evidence.original.matchupPayload) as Array<Record<string, JsonValue>>;
    raw.push({ ...raw[1], roster_id: 3 });
    replaceRaw(input, raw);
    const leaguePayload = f.evidence.acceptedConfiguration.payload as Mutable<Record<string, JsonValue>>;
    leaguePayload.total_rosters = 3;
    const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: input.expectedMapping.scope,
      family: 'league', week: null, completeness: 'complete', provenance: f.accepted.receipt.provenance, payload: leaguePayload });
    f.evidence.acceptedConfiguration.contentHash = normalized.contentHash;
    f.original.leagueInput.contentHash = normalized.contentHash;
    f.verification.leagueInput.contentHash = normalized.contentHash;
    delete f.snapshot.payload.matchups[0].winProbability;
    expect(f.accepted.value.groups[0].format).toBe('multiple-participants');
    expectUnavailable(input, 'official_facts_mismatch');
  });

  it.each(['final', 'tie'] as const)('copies stored %s probability without promoting official finality', kind => {
    const input = fixture();
    const f = available(input);
    if (kind === 'tie') {
      const raw = structuredClone(f.evidence.original.matchupPayload) as Array<Record<string, JsonValue>>;
      raw[0].custom_points = 2;
      replaceRaw(input, raw);
      f.snapshot.payload.matchups[0].sides[0].points = 2;
    }
    f.snapshot.payload.matchups[0].status = 'final';
    f.snapshot.payload.matchups[0].winProbability = { modelVersion: 'normal-v3', status: kind,
      teams: [{ teamId: 1, probability: 0 }, { teamId: 2, probability: kind === 'tie' ? 0 : 1 }] };
    const result = joinAcceptedExactMatchupDerived(input);
    expect(result.probability).toMatchObject({ status: 'available', groups: [{ value: { status: kind } }] });
    expect(f.accepted.value.state).toEqual({ provider: 'unknown', local: 'unknown', reason: 'no_matchup_finality_evidence' });
    expect(result.forecast).toMatchObject({ status: 'available', teams: [{ projectedPoints: 21.23 }, { projectedPoints: 18.45 }] });
  });

  it.each(['original', 'verification'] as const)('checks the %s mapping epoch separately, including ABA', which => {
    const input = fixture();
    const f = available(input);
    f[which].mapping = { ...f[which].mapping, revisionId: id(999), generation: 3 };
    expectUnavailable(input, `${which}_source_mismatch`);
  });

  it.each(['original', 'verification'] as const)('checks the %s configuration independently', which => {
    const input = fixture();
    const f = available(input);
    const source = f[which];
    const evidence = which === 'original' ? f.evidence.original : f.verificationEvidence;
    const changed = { ...evidence.configuration, contentId: id(998), configurationVersionId: id(999), scoringProfileId: id(997) };
    evidence.configuration = changed;
    source.leagueInput = { ...source.leagueInput, contentId: changed.contentId, configurationVersionId: changed.configurationVersionId };
    expectUnavailable(input, `${which}_configuration_mismatch`);
  });

  it.each(['original', 'verification'] as const)('does not upgrade %s unlinked source', which => {
    const input = fixture();
    const f = available(input);
    f.history[which].source = { status: 'source_epoch_unproved', reason: 'legacy_unlinked' };
    if (which === 'original') input.immutableEvidence = null;
    expectUnavailable(input, `${which}_source_unproved`);
  });

  it('does not retroactively prove an originally cached league input', () => {
    const input = fixture();
    available(input).original.leagueInput.acquisitionSourceEpoch = 'source_epoch_unproved';
    expectUnavailable(input, 'original_source_unproved');
  });

  it.each([
    ['profile hash', (f: ReturnType<typeof available>) => { f.evidence.profile.rulesHash = '0'.repeat(64); }, 'scoring_profile_mismatch'],
    ['accepted configuration id', (f: ReturnType<typeof available>) => { f.accepted.receipt.configurationContentId = id(999); }, 'accepted_configuration_mismatch'],
    ['accepted period mapping', (f: ReturnType<typeof available>) => { f.accepted.periodMapping = { status: 'unmapped', reason: 'calendar_evidence_missing' }; }, 'period_mapping_unproved'],
    ['snapshot model', (f: ReturnType<typeof available>) => { f.snapshot.modelVersion = 'other'; }, 'snapshot_scope_mismatch'],
    ['snapshot week', (f: ReturnType<typeof available>) => { f.snapshot.week = 3; }, 'snapshot_scope_mismatch'],
    ['snapshot season', (f: ReturnType<typeof available>) => { f.snapshot.payload.league.season = '2025'; }, 'snapshot_scope_mismatch'],
    ['source history scope', (f: ReturnType<typeof available>) => { f.history.scope = { ...f.history.scope, week: 3 }; }, 'source_history_unavailable'],
  ] as const)('rejects %s mismatch', (_name, mutate, reason) => {
    const input = fixture(); mutate(available(input)); expectUnavailable(input, reason);
  });

  it.each([
    ['missing game', (f: ReturnType<typeof available>) => { f.games.observations = []; }],
    ['count without expected rows', (f: ReturnType<typeof available>) => { f.games.expectedGameIds = []; }],
    ['wrong provider', (f: ReturnType<typeof available>) => { f.games.observations[0].provider = 'sleeper'; }],
    ['wrong week', (f: ReturnType<typeof available>) => { f.games.observations[0].week = 3; }],
    ['wrong season', (f: ReturnType<typeof available>) => { f.games.observations[0].season = 2025; }],
    ['wrong season type', (f: ReturnType<typeof available>) => { f.games.observations[0].seasonType = 'post'; }],
    ['wrong game', (f: ReturnType<typeof available>) => { f.games.observations[0].nflGameId = id(999); }],
    ['wrong original observation', (f: ReturnType<typeof available>) => { f.games.leagueWeekObservationId = id(30); }],
    ['wrong game teams', (f: ReturnType<typeof available>) => { f.games.observations[0].awayTeam = 'CLE'; }],
    ['bad time order', (f: ReturnType<typeof available>) => { f.games.observations[0].requestStartedAt = later; }],
    ['later game IDs substituted', (f: ReturnType<typeof available>) => { f.games.observations[0].id = id(999); }],
  ] as const)('refuses %s without suppressing official facts', (_name, mutate) => {
    const input = fixture(); mutate(available(input)); expectUnavailable(input, 'game_evidence_unavailable');
  });

  it('fails closed on stale active data and contradictory past context', () => {
    const input = fixture();
    input.now = new Date('2026-09-29T16:10:00.000Z');
    expectUnavailable(input, 'snapshot_stale');
    input.context.temporalState = 'past';
    expectUnavailable(input, 'freshness_context_mismatch');
  });

  it('rejects original game skew even when later verification is fresh', () => {
    const input = fixture();
    const f = available(input);
    const stale = '2026-09-29T15:58:29.999Z';
    f.games.observations[0] = { ...f.games.observations[0], requestStartedAt: stale, requestCompletedAt: stale, observedAt: stale };
    expectUnavailable(input, 'game_evidence_unavailable');
    const boundary = '2026-09-29T15:58:30.000Z';
    f.games.observations[0] = { ...f.games.observations[0], requestStartedAt: boundary, requestCompletedAt: boundary, observedAt: boundary };
    expect(joinAcceptedExactMatchupDerived(input).forecast.status).toBe('available');
  });

  it('rejects original calculation time skew without substituting verifiedAt', () => {
    const input = fixture();
    available(input).snapshot.calculatedAt = '2026-09-29T15:58:29.999Z';
    expectUnavailable(input, 'game_evidence_unavailable');
  });

  it('checks the entire source-time span rather than each game only against the midpoint', () => {
    const input = fixture();
    const f = available(input);
    const earlier = '2026-09-29T15:58:40.000Z', laterGame = '2026-09-29T16:01:20.000Z';
    f.games.observations[0] = { ...f.games.observations[0], requestStartedAt: earlier, observedAt: earlier };
    f.games.observations.push({ ...f.games.observations[0], id: id(62), nflGameId: id(63), homeTeam: 'CLE', awayTeam: 'KC',
      requestStartedAt: laterGame, requestCompletedAt: laterGame, observedAt: laterGame });
    f.games.expectedGameCount = 2; f.games.expectedGameIds.push(id(63)); f.history.original.gameStateObservationIds.push(id(62));
    expectUnavailable(input, 'game_evidence_unavailable');
  });

  it('preserves official facts when game evidence is independently malformed', () => {
    const input = fixture(); available(input).evidence.games = null;
    expectUnavailable(input, 'game_evidence_unavailable');
  });

  it('keeps historical data durable and future data last-known-good with refreshDue', () => {
    const input = fixture();
    input.now = new Date('2026-10-06T16:00:00.000Z');
    input.context.activeWeek = 5; input.context.temporalState = 'past';
    expect(joinAcceptedExactMatchupDerived(input).forecast.status).toBe('available');
    input.context.activeWeek = 3; input.context.temporalState = 'future';
    expect(joinAcceptedExactMatchupDerived(input).forecast).toMatchObject({ status: 'available', reference: { refreshDue: true } });
  });

  it('returns official data with absent or noncurrent snapshot evidence', () => {
    const input = fixture();
    input.snapshot = null;
    expectUnavailable(input, 'snapshot_missing');
    if (input.sourceHistory.status !== 'available') throw new Error('Expected history.');
    input.sourceHistory.verification = { status: 'not_current_snapshot', leagueWeekObservationId: null, source: null };
    expectUnavailable(input, 'snapshot_not_current');
  });

  it('returns missing official evidence unchanged', () => {
    const input = fixture(); input.accepted = { status: 'missing' };
    expectUnavailable(input, 'official_unavailable');
  });
});
