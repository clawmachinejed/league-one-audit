import type { JsonObject } from '../league-administration/contracts';
import type { SourceTeamManagers } from './team-managers';

/** FS07.01 synthetic source shapes. N and M are exact opaque fixture keys,
 * not captured people. No live provider or field-completeness qualification.
 */
export const PRIMARY_OWNER_EVIDENCE_FIXTURES: readonly Readonly<{
  name: string; payload: JsonObject; expected: SourceTeamManagers['primaryOwner'];
}>[] = [
  { name: 'owned', payload: { roster_id: 7, owner_id: 'N', co_owners: ['M'] },
    expected: { state: 'owned', externalManagerId: 'N' } },
  { name: 'explicitly unowned', payload: { roster_id: 7, owner_id: null, co_owners: ['M'] },
    expected: { state: 'unowned', externalManagerId: null } },
  { name: 'absent primary', payload: { roster_id: 7, co_owners: ['M'] },
    expected: { state: 'unknown', externalManagerId: null } },
  { name: 'invalid primary', payload: { roster_id: 7, owner_id: { invalid: 'N' }, co_owners: ['M'] },
    expected: { state: 'unknown', externalManagerId: null } },
];
