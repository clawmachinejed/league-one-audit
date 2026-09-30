import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../database';
import { createExactMatchupCompatibilityReader } from '../league-administration/store';
import { getMyFantasyLeagueSummary } from '../my-fantasy';
import { projectCurrentRosterMetadata } from './current-roster-metadata';
import type { RosterMembership } from './contracts';
import { assessAcceptedExactMatchupAttention, type ExactMatchupAttentionInput } from './exact-matchup-attention';
import { b1CompatibilityFixture, b1CompatibilityInput, b1Mapping, b1Uuid } from './b1-acceptance.fixtures';

vi.mock('server-only', () => ({}));
type Mutable<T> = T extends Date ? Date : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
async function fixture() {
  const source = b1CompatibilityFixture();
  const compatibility = await createExactMatchupCompatibilityReader({ enabled: true,
    query: async () => [source] } as DatabaseClient).readExactMatchupCompatibility(b1CompatibilityInput);
  if (compatibility.official.status !== 'available' || compatibility.gameState.status !== 'available') throw new Error('Bad fixture.');
  const accepted = structuredClone(compatibility.official) as Mutable<typeof compatibility.official>;
  accepted.value.lineupDefinitionRef = b1Uuid(501);
  accepted.value.teams.forEach(team => team.starters!.forEach((slot, index) => { slot.nativeSlot = index === 0 ? 'QB' : 'RB'; }));
  const held = accepted.value.teams.map(team => ({ players: (team.players ?? []).map((id): RosterMembership => ({
    seasonTeamId: team.seasonTeamId, sourceTeam: { provider: 'sleeper', resourceKind: 'team', nativeNamespace: 'nfl', nativeId: team.externalRosterId },
    sourceEntity: { provider: 'sleeper', resourceKind: 'scoring-entity', nativeNamespace: 'nfl', nativeId: id },
    canonicalEntityId: null, identityState: 'unresolved', nativeSection: null, section: 'unknown',
    effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown',
  })) }));
  const metadata = projectCurrentRosterMetadata(held, { playerCatalog: { complete: true, sourceRevision: `sha256:${'a'.repeat(64)}`,
    catalog: { a: { full_name: 'Alpha', position: 'QB', team: 'IND', injury_status: 'Out' },
      b: { full_name: 'Beta', position: 'QB', team: 'HOU', injury_status: 'Questionable' } },
    sourceSlices: [{ scope: 'QB', status: 'available', sourceRevision: `sha256:${'a'.repeat(64)}`,
      observedAt: '2026-09-29T11:00:00.000Z', complete: true, playerIds: ['a', 'b'] }] } });
  const input = structuredClone({ accepted, expectedMapping: b1Mapping, compatibility,
    selectedSeasonTeamId: b1Uuid(19), metadata, context: b1CompatibilityInput.context,
    now: b1CompatibilityInput.now }) as Mutable<ExactMatchupAttentionInput>;
  return { input, source };
}
function available(input: Mutable<ExactMatchupAttentionInput>) {
  if (input.accepted.status !== 'available' || input.metadata?.status !== 'available'
    || input.compatibility?.gameState.status !== 'available') throw new Error('Bad fixture.');
  return { accepted: input.accepted, metadata: input.metadata, games: input.compatibility.gameState };
}

describe('exact accepted lineup attention', () => {
  it('reuses the My Fantasy assessment for the selected team regardless of displayed side', async () => {
    const { input, source } = await fixture();
    const side = source.snapshot_rows[0].payload.matchups[0].sides.find(side => side.team.id === 1)!;
    side.starters[0].name = 'Alpha'; side.starters[0].injuryStatus = 'Out';
    const legacy = getMyFantasyLeagueSummary(source.snapshot_rows[0].payload, input.context, null, 1, input.now);
    const before = structuredClone(input);
    const result = assessAcceptedExactMatchupAttention(input);
    expect(result).toMatchObject({ status: 'available', selectedSeasonTeamId: b1Uuid(19), assessment: legacy.attention,
      references: { metadataFreshness: 'unknown', sourceMappingRevisionId: b1Mapping.revisionId } });
    expect(input).toEqual(before);
    expect(assessAcceptedExactMatchupAttention({ ...input, selectedSeasonTeamId: b1Uuid(20) }))
      .toMatchObject({ assessment: { status: 'verified', issues: [{ kind: 'empty' }] } });
  });

  it.each(['catalog', 'slot labels', 'one source date'] as const)('retains confirmed issues under partial %s coverage', async kind => {
    const { input } = await fixture();
    const { accepted, metadata } = available(input);
    if (kind === 'catalog') metadata.catalogComplete = false;
    if (kind === 'slot labels') { accepted.value.lineupDefinitionRef = null; accepted.value.teams[0].starters![0].nativeSlot = null; }
    if (kind === 'one source date') metadata.players[1].sources[0].observedAt = null;
    const result = assessAcceptedExactMatchupAttention(input);
    // Unselected-team missing metadata is irrelevant to selected current coverage.
    expect(result).toMatchObject({ assessment: { status: kind === 'one source date' ? 'verified' : 'unknown',
      issues: [{ kind: 'out' }, { kind: 'empty' }] } });
  });

  it.each(['missing metadata', 'missing mapping', 'missing game state', 'refresh-due snapshot'] as const)(
    'retains the exact vacancy but cannot claim all-clear with %s', async kind => {
      const { input } = await fixture(); const f = available(input);
      if (kind === 'missing metadata') input.metadata = null;
      if (kind === 'missing mapping') f.accepted.periodMapping = { status: 'unmapped', reason: 'calendar_evidence_missing' };
      if (kind === 'missing game state') input.compatibility!.gameState = { status: 'unavailable', reason: 'game_evidence_unavailable' };
      if (kind === 'refresh-due snapshot') f.games.reference.refreshDue = true;
      expect(assessAcceptedExactMatchupAttention(input)).toMatchObject({ assessment: { status: 'unknown', issues: [{ kind: 'empty' }] } });
    });

  it.each(['missing kickoff', 'past unconfirmed kickoff', 'unknown designation'] as const)('keeps %s unknown', async kind => {
    const { input } = await fixture(); const f = available(input);
    const game = f.games.teams.find(team => team.seasonTeamId === b1Uuid(19))!.starters[0].game;
    if (game?.kind !== 'scheduled') throw new Error('Bad fixture.');
    if (kind === 'missing kickoff') game.kickoffAt = null;
    if (kind === 'past unconfirmed kickoff') game.kickoffAt = '2026-09-29T11:00:00.000Z';
    if (kind === 'unknown designation') f.metadata.players[0].injuryStatus.value = 'Unrecognized';
    expect(assessAcceptedExactMatchupAttention(input)).toMatchObject({ assessment: { status: 'unknown', issues: [{ kind: 'empty' }] } });
  });

  it('preserves a confirmed bye without inventing metadata or retrospective injuries after kickoff', async () => {
    const { input } = await fixture(); const f = available(input);
    const starter = f.games.teams.find(team => team.seasonTeamId === b1Uuid(19))!.starters[0];
    starter.game = { kind: 'bye' }; input.metadata = null;
    expect(assessAcceptedExactMatchupAttention(input)).toMatchObject({ assessment: { status: 'unknown', issues: [{ kind: 'bye' }, { kind: 'empty' }] } });
    starter.game = { kind: 'scheduled', opponent: 'HOU', location: 'home', date: '2026-10-04', kickoffAt: null,
      liveScore: { teamScore: 0, opponentScore: 0, phase: 'q1', clockSeconds: 400 } };
    input.metadata = f.metadata;
    expect(assessAcceptedExactMatchupAttention(input)).toMatchObject({ assessment: { status: 'verified', issues: [{ kind: 'empty' }] } });
  });

  it.each(['past', 'future', 'completed', 'rollover'] as const)('does not apply current injury to %s evidence', async kind => {
    const { input } = await fixture();
    if (kind === 'future') { input.context.activeWeek = 3; input.context.temporalState = 'future'; }
    if (kind === 'past') { input.context.activeWeek = 5; input.context.temporalState = 'past'; }
    if (kind === 'completed') { input.context.lifecycle = 'complete'; input.context.temporalState = 'past'; }
    if (kind === 'rollover') { input.context.activeSeason = 2027; input.context.activeWeek = 1; input.context.temporalState = 'past'; }
    expect(assessAcceptedExactMatchupAttention(input)).toMatchObject({ status: 'available',
      assessment: { status: kind === 'future' ? 'unknown' : 'completed', issues: [] } });
  });

  it.each(['wrong team', 'wrong mapping', 'wrong league', 'wrong season', 'wrong context', 'invalid clock'] as const)(
    'isolates %s', async kind => {
      const { input } = await fixture();
      if (kind === 'wrong team') input.selectedSeasonTeamId = null;
      if (kind === 'wrong mapping') input.expectedMapping.revisionId = b1Uuid(999);
      if (kind === 'wrong league') input.expectedMapping.scope.externalLeagueId = 'another';
      if (kind === 'wrong season') input.expectedMapping.scope.season = 2027;
      if (kind === 'wrong context') input.context.temporalState = 'future';
      if (kind === 'invalid clock') input.now = new Date('invalid');
      expect(assessAcceptedExactMatchupAttention(input).status).toBe('unavailable');
    });

  it('does not borrow another accepted capture, reordered starter games, or undated metadata', async () => {
    const { input } = await fixture(); const f = available(input);
    if (input.compatibility!.official.status !== 'available') throw new Error('Bad fixture.');
    input.compatibility!.official.receipt.id = b1Uuid(999);
    expect(assessAcceptedExactMatchupAttention(input)).toMatchObject({ assessment: { status: 'unknown', issues: [{ kind: 'empty' }] } });
    input.compatibility!.official.receipt.id = f.accepted.receipt.id;
    f.games.teams.find(team => team.seasonTeamId === b1Uuid(19))!.starters[0].index = 1;
    expect(assessAcceptedExactMatchupAttention(input)).toMatchObject({ assessment: { status: 'unknown', issues: [{ kind: 'empty' }] } });
  });
  it('does not certify absent availability metadata or a current player moved to another NFL team', async () => {
    const { input } = await fixture(); const f = available(input);
    f.metadata.players[0].injuryStatus = { value: null, availability: 'missing', sourcePaths: ['injury_status'] };
    expect(assessAcceptedExactMatchupAttention(input)).toMatchObject({ assessment: { status: 'unknown', issues: [{ kind: 'empty' }] } });
    f.metadata.players[0].injuryStatus = { value: 'Out', availability: 'present', sourcePaths: ['injury_status'] };
    f.metadata.players[0].nflTeam.value = 'KC';
    expect(assessAcceptedExactMatchupAttention(input)).toMatchObject({ assessment: { status: 'unknown', issues: [{ kind: 'empty' }] } });
  });

  it('preserves existing final-matchup suppression as local interpretation, never provider finality', async () => {
    const { input } = await fixture(); const f = available(input);
    f.games.groups[0].status = 'final';
    expect(assessAcceptedExactMatchupAttention(input)).toMatchObject({ assessment: { status: 'completed', issues: [] },
      limitations: ['local_completion_not_provider_finality'] });
    expect(f.accepted.value.state.provider).toBe('unknown');
  });  it.each([86_400_000 - 1, 86_400_000, 86_400_000 + 1])('uses the existing daily current-catalog window at age %i ms', async age => {
    const { input } = await fixture(); const f = available(input);
    const observedAt = new Date(input.now.getTime() - age).toISOString();
    f.metadata.players[0].sources[0].observedAt = observedAt;
    const result = assessAcceptedExactMatchupAttention(input);
    expect(result).toMatchObject({ status: 'available', assessment: {
      status: age < 86_400_000 ? 'verified' : 'unknown',
      issues: age < 86_400_000 ? [{ kind: 'out' }, { kind: 'empty' }] : [{ kind: 'empty' }],
    }, references: { metadata: { players: [{ sources: [{ observedAt }] }, expect.anything()] } } });
  });

  it('keeps mixed source ages and previous-season injuries dated without asserting a current issue', async () => {
    const { input } = await fixture(); const f = available(input);
    const priorSeason = '2025-09-29T11:00:00.000Z';
    f.metadata.players[0].sources.push({ ...f.metadata.players[0].sources[0], observedAt: priorSeason });
    f.metadata.players[0].sourceAge = 'mixed';
    const result = assessAcceptedExactMatchupAttention(input);
    expect(result).toMatchObject({ assessment: { status: 'unknown', issues: [{ kind: 'empty' }] },
      references: { metadata: { players: [{ sourceAge: 'mixed', sources: [expect.anything(), { observedAt: priorSeason }] }, expect.anything()] } } });
    f.metadata.players[0].sources = [f.metadata.players[0].sources[1]];
    expect(assessAcceptedExactMatchupAttention(input)).toMatchObject({ assessment: { status: 'unknown', issues: [{ kind: 'empty' }] } });
  });});
