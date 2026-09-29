import type { FieldGroup, RosterMembership } from './contracts';
import type { AdministrationEnvelope, SourceTeam } from '../league-administration/contracts';

export type CurrentRosterStarterSlot = Readonly<{
  index: number;
  /** Exact provider entry, including its literal vacancy marker. No slot rule is inferred. */
  nativePlayerId: string;
  empty: boolean;
  membership: RosterMembership | null;
}>;

/** Field evidence from accepted held-player content; it does not widen players-only acceptance. */
export type CurrentRosterGroups = Readonly<{
  kind: 'current-roster-field-evidence'; projectionVersion: 'sleeper-current-groups-v1';
  historicalApplicability: 'unverified';
  source: AdministrationEnvelope['provenance'];
  /** Retained source lists remain inspectable even when conflicting placement is withheld. */
  nativeLists: Readonly<{ starters: readonly string[] | null; reserve: readonly string[] | null; taxi: readonly string[] | null }>;
  starters: FieldGroup<readonly CurrentRosterStarterSlot[]>;
  reserve: FieldGroup<readonly RosterMembership[]>;
  taxi: FieldGroup<readonly RosterMembership[]>;
  /** Derived only when every exclusion group is known from this same capture. */
  bench: FieldGroup<readonly RosterMembership[]>;
}>;

type Group = 'starters' | 'reserve' | 'taxi';
const groups: readonly Group[] = ['starters', 'reserve', 'taxi'];

/** Called only after the existing reader verifies content, normalizer, team identity and receipt. */
export function projectCurrentRosterGroups(team: SourceTeam, players: readonly RosterMembership[],
  receiptId: string, provenance: AdministrationEnvelope['provenance']): CurrentRosterGroups {
  const held = new Map(players.map(player => [player.sourceEntity.nativeId, player]));
  const ids: Record<Group, readonly string[] | null> = {
    starters: team.starterExternalIds, reserve: team.reserveExternalIds, taxi: team.taxiExternalIds,
  };
  const occupied = (group: Group) => ids[group]?.filter(id => id !== '0') ?? [];
  const reasons: Record<Group, string[]> = { starters: [], reserve: [], taxi: [] };
  for (const group of groups) {
    if (ids[group] === null) reasons[group].push('source_field_missing');
    if (group !== 'starters' && ids[group]?.includes('0')) reasons[group].push('group_contains_vacancy_marker');
    if (occupied(group).some(id => !held.has(id))) reasons[group].push('group_player_not_held');
    for (const other of groups) {
      if (group !== other && occupied(group).some(id => occupied(other).includes(id))) {
        reasons[group].push(`group_overlaps_${other}`);
      }
    }
  }
  const field = <T>(value: readonly T[] | null, fieldReasons: string[],
    authority: FieldGroup<readonly T[]>['authority'] = 'provider-official'): FieldGroup<readonly T[]> => ({
    value, availability: value === null ? 'missing' : value.length ? 'present' : 'empty',
    completeness: value === null ? 'unknown' : 'complete', freshness: 'unknown', authority,
    temporalContext: 'current-display', sourceRefs: [receiptId], reasons: fieldReasons,
  });
  const member = (id: string, group: Group | 'bench'): RosterMembership => ({ ...held.get(id)!,
    nativeSection: group === 'bench' ? 'players' : group, section: group === 'starters' ? 'active' : group });
  const starters = reasons.starters.length ? null : ids.starters!.map((id, index) => ({
    index, nativePlayerId: id, empty: id === '0', membership: id === '0' ? null : member(id, 'starters'),
  }));
  const reserve = reasons.reserve.length ? null : ids.reserve!.map(id => member(id, 'reserve'));
  const taxi = reasons.taxi.length ? null : ids.taxi!.map(id => member(id, 'taxi'));
  const exclusions = new Set(groups.flatMap(occupied));
  const benchReasons = groups.filter(group => reasons[group].length).map(group => `${group}_evidence_unknown`);
  if (held.has('0')) benchReasons.push('held_players_contains_vacancy_marker');
  const bench = benchReasons.length ? null : players.filter(player => !exclusions.has(player.sourceEntity.nativeId))
    .map(player => member(player.sourceEntity.nativeId, 'bench'));
  return {
    kind: 'current-roster-field-evidence', projectionVersion: 'sleeper-current-groups-v1',
    historicalApplicability: 'unverified', source: { ...provenance },
    nativeLists: { starters: ids.starters, reserve: ids.reserve, taxi: ids.taxi },
    starters: field(starters, reasons.starters), reserve: field(reserve, reasons.reserve), taxi: field(taxi, reasons.taxi),
    bench: field(bench, benchReasons, 'presentation-derived'),
  };
}
