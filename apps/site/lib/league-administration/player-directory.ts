import { createHash } from 'node:crypto';
import { classifySleeperCatalogIdentity } from '../projections/shared/official-catalog-identity';
import type { PlayerCatalog } from '../sleeper-catalog-types';
import type { JsonValue } from './contracts';
import { PLAYER_DIRECTORY_FIELDS, PLAYER_DIRECTORY_MAX_ROWS, PLAYER_DIRECTORY_NAMESPACE,
  PLAYER_DIRECTORY_SCHEMA, type PlayerDirectoryAttempt, type PlayerDirectoryCapture,
  type PlayerDirectoryFieldState, type PlayerDirectoryRow } from './player-directory-contracts';

function record(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function isPlayerDirectoryNativeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && value.trim() === value && !/[\x00-\x1f\x7f]/u.test(value);
}

/** Directory facts retain source spelling and presence; display projection stays in its existing owner. */
export function normalizePlayerDirectoryRow(externalPlayerId: string, source: JsonValue): PlayerDirectoryRow {
  const value = record(source) ? source : {};
  const fieldStates = Object.fromEntries(PLAYER_DIRECTORY_FIELDS.map(field => {
    const supplied = value[field];
    const valid = field === 'active' ? typeof supplied === 'boolean' : field === 'fantasy_positions'
      ? Array.isArray(supplied) && supplied.every(item => typeof item === 'string') : typeof supplied === 'string';
    const state: PlayerDirectoryFieldState = !Object.hasOwn(value, field) ? 'missing'
      : supplied === null ? 'null' : valid ? 'supplied' : 'invalid';
    return [field, state];
  })) as PlayerDirectoryRow['fieldStates'];
  const reasons: string[] = [];
  if (!isPlayerDirectoryNativeId(externalPlayerId)) reasons.push('invalid-native-id');
  if (!record(source)) reasons.push('invalid-player-row');
  for (const field of PLAYER_DIRECTORY_FIELDS) if (fieldStates[field] === 'invalid') reasons.push(`invalid-field:${field}`);
  const conflict = fieldStates.player_id === 'supplied' && value.player_id !== externalPlayerId;
  if (conflict) reasons.push('player-id-conflict');
  const string = (field: typeof PLAYER_DIRECTORY_FIELDS[number]) => fieldStates[field] === 'supplied' ? value[field] as string : null;
  return {
    externalPlayerId, providerPlayerId: string('player_id'), fullName: string('full_name'),
    firstName: string('first_name'), lastName: string('last_name'), position: string('position'), team: string('team'),
    active: fieldStates.active === 'supplied' ? value.active as boolean : null,
    status: string('status'), fantasyPositions: fieldStates.fantasy_positions === 'supplied' ? value.fantasy_positions as string[] : null,
    injuryStatus: string('injury_status'), fieldStates,
    identityStatus: conflict ? 'conflict' : reasons.length ? 'invalid' : 'valid', reasons, source,
  };
}

/** Advisory compatibility classification only; IDP/unfamiliar positions remain native directory rows. */
export function classifyPlayerDirectoryRow(row: PlayerDirectoryRow) {
  if (row.identityStatus !== 'valid' || !record(row.source)) return { status: 'invalid' as const, reason: row.reasons[0] ?? 'invalid-player-row' };
  return classifySleeperCatalogIdentity(Object.fromEntries([[row.externalPlayerId, row.source]]) as PlayerCatalog, row.externalPlayerId);
}

/** Compare decimal source values with the JSON number representation without BigInt
 * expansion or exponent-sized allocations. Zero and insignificant spelling stay equal. */
function canonicalJsonDecimal(token: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(token);
  if (!match) return 'invalid';
  const fraction = match[3] ?? '';
  const digits = (match[2] + fraction).replace(/^0+/u, '');
  if (!digits) return '0';
  const significant = digits.replace(/0+$/u, '');
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent)) return 'invalid-exponent';
  return `${match[1]}${significant}e${exponent - fraction.length + digits.length - significant.length}`;
}
/** JSON.parse has already validated syntax. This iterative scan finds repeated object members
 * without replacing original bytes or choosing a last-wins identity as complete evidence. */
export function playerDirectoryDuplicateMembers(rawJson: string, enforceBounds = false): { count: number; paths: string[]; truncated: boolean } {
  type Frame = { object: boolean; path: string; pathTruncated: boolean; keys: Set<string>; key: string; index: number; expectingKey: boolean };
  const frames: Frame[] = [];
  const paths: string[] = [];
  let count = 0, values = 0, truncated = false;
  const value = () => {
    if (++values > 2_000_000 && enforceBounds) throw new Error('Player directory raw value limit exceeded.');
    if (frames.length >= 64 && enforceBounds) throw new Error('Player directory raw depth limit exceeded.');
  };
  const escape = (text: string) => text.replaceAll('~', '~0').replaceAll('/', '~1');
  // At most 128 paths, each <=256 UTF-16 units and <=512 UTF-8 bytes. Ancestor
  // segments are clipped before concatenation, so long native keys cannot amplify
  // one bounded raw document into unbounded duplicated diagnostic strings.
  const childPath = (parent: Frame, key: string) => {
    const path = `${parent.path}/${escape(key.slice(0, 128))}`;
    return { path: path.slice(0, 256), pathTruncated: parent.pathTruncated || key.length > 128
      || path.length > 256 || Buffer.byteLength(path, 'utf8') > 512 };
  };
  const pathForValue = () => {
    const parent = frames.at(-1);
    return parent ? childPath(parent, parent.object ? parent.key : String(parent.index)) : { path: '', pathTruncated: false };
  };
  for (let i = 0; i < rawJson.length; i++) {
    const character = rawJson[i];
    if (character === '"') {
      const start = i;
      for (++i; i < rawJson.length; i++) {
        if (rawJson[i] === '\\') i++;
        else if (rawJson[i] === '"') break;
      }
      const token = JSON.parse(rawJson.slice(start, i + 1)) as string;
      if (enforceBounds && (token.includes('\u0000') || /[\uD800-\uDFFF]/u.test(token))) throw new Error('Invalid raw DATA JSON Unicode.');
      const parent = frames.at(-1);
      if (parent?.object && parent.expectingKey) {
        if (parent.keys.has(token)) {
          count++;
          if (paths.length < 128) {
            const diagnostic = childPath(parent, token);
            if (!diagnostic.pathTruncated) paths.push(diagnostic.path);
            else truncated = true;
          } else truncated = true;
        }
        parent.keys.add(token); parent.key = token; parent.expectingKey = false;
      } else value();
    } else if (character === '{' || character === '[') {
      value();
      if (frames.length >= 64 && enforceBounds) throw new Error('Player directory raw depth limit exceeded.');
      frames.push({ object: character === '{', ...pathForValue(), keys: new Set(), key: '', index: 0, expectingKey: character === '{' });
    } else if (character === '}' || character === ']') frames.pop();
    else if (character === ',') {
      const parent = frames.at(-1);
      if (parent) { parent.expectingKey = parent.object; if (!parent.object) parent.index++; }
    } else if (character === '-' || /[0-9tfn]/u.test(character)) {
      value();
      const start = i;
      while (i + 1 < rawJson.length && !/[\s,\]}]/u.test(rawJson[i + 1])) i++;
      if (enforceBounds) {
        const number = JSON.parse(rawJson.slice(start, i + 1)) as unknown;
        if (typeof number === 'number' && (!Number.isFinite(number) || Number.isInteger(number) && !Number.isSafeInteger(number)
          || canonicalJsonDecimal(rawJson.slice(start, i + 1)) !== canonicalJsonDecimal(JSON.stringify(number)))) {
          throw new Error('Invalid raw DATA JSON number.');
        }
      }
    }
  }
  return { count, paths, truncated };
}
type CaptureInput = Readonly<{
  attempt: PlayerDirectoryAttempt; rawJson: string | null; requestStartedAt: string | null;
  requestCompletedAt: string | null; sourceObservedAt: string | null; providerRequests: 0 | 1;
  failureReason?: string;
}>;
export function normalizePlayerDirectoryCapture(input: CaptureInput): PlayerDirectoryCapture {
  const rows: PlayerDirectoryRow[] = [];
  const reasons: string[] = [];
  let status: PlayerDirectoryCapture['status'] = 'complete';
  let duplicateMembers = { count: 0, paths: [] as string[], truncated: false };
  const sourceRevision = input.rawJson === null ? null : `sha256:${createHash('sha256').update(input.rawJson).digest('hex')}`;
  if (input.failureReason) { status = 'unavailable'; reasons.push(input.failureReason); }
  else if (input.rawJson === null) { status = 'unavailable'; reasons.push('source-unavailable'); }
  else {
    try {
      const source: unknown = JSON.parse(input.rawJson);
      duplicateMembers = playerDirectoryDuplicateMembers(input.rawJson);
      if (!record(source)) { status = 'invalid'; reasons.push('invalid-root'); }
      else {
        const entries = Object.entries(source);
        if (!entries.length) { status = 'invalid'; reasons.push('empty-directory'); }
        else if (entries.length > PLAYER_DIRECTORY_MAX_ROWS) { status = 'invalid'; reasons.push('directory-row-limit'); }
        else for (const [id, value] of entries) rows.push(normalizePlayerDirectoryRow(id, value));
      }
      if (duplicateMembers.count) { status = 'invalid'; reasons.push('duplicate-json-members'); }
      if (rows.some(row => row.identityStatus === 'invalid')) { if (status === 'complete') status = 'partial'; reasons.push('invalid-player-rows'); }
      if (rows.some(row => row.identityStatus === 'conflict')) { if (status === 'complete') status = 'partial'; reasons.push('conflicting-player-identities'); }
    } catch { status = 'invalid'; reasons.push('invalid-json'); }
  }
  const validRowCount = rows.filter(row => row.identityStatus === 'valid').length;
  const invalidRowCount = rows.filter(row => row.identityStatus === 'invalid').length;
  const conflictRowCount = rows.filter(row => row.identityStatus === 'conflict').length;
  return {
    schemaVersion: PLAYER_DIRECTORY_SCHEMA, normalizerVersion: PLAYER_DIRECTORY_SCHEMA,
    provider: 'sleeper', sport: 'nfl', namespace: PLAYER_DIRECTORY_NAMESPACE,
    attemptId: input.attempt.id, attemptNonce: input.attempt.nonce, origin: 'network',
    requestStartedAt: input.requestStartedAt, requestCompletedAt: input.requestCompletedAt, sourceObservedAt: input.sourceObservedAt,
    rawJson: input.rawJson, sourceRevision, duplicateMemberCount: duplicateMembers.count, duplicateMemberPaths: duplicateMembers.paths, duplicateMemberPathsTruncated: duplicateMembers.truncated,
    status, reasons, rows, providerRequests: input.providerRequests,
    sourceSlices: [{ scope: 'all', endpoint: '/players/nfl', status: status === 'unavailable' ? 'unavailable'
      : status === 'invalid' ? 'invalid' : 'available', sourceRevision, observedAt: input.sourceObservedAt,
      complete: status === 'complete', rowCount: rows.length, validRowCount, invalidRowCount, conflictRowCount }],
  };
}

const originalDirectoryCaptures = new WeakSet<PlayerDirectoryCapture>();
export function validatePlayerDirectoryAttempt(value: PlayerDirectoryAttempt): PlayerDirectoryAttempt {
  const uuid = (id: unknown) => typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(id);
  if (!value || !uuid(value.id) || !uuid(value.nonce) || !Number.isSafeInteger(value.ordinal) || value.ordinal < 1
    || !Number.isSafeInteger(value.expectedGeneration) || value.expectedGeneration < 0
    || typeof value.reservedAt !== 'string' || !Number.isFinite(Date.parse(value.reservedAt))) {
    throw new Error('Invalid player directory reservation.');
  }
  return Object.freeze({ ...value });
}
/** Called only at completion of the maintained loader. Copies cannot retag prior captures. */
export function sealPlayerDirectoryCapture(capture: PlayerDirectoryCapture): PlayerDirectoryCapture {
  const pending: unknown[] = [capture];
  const visited = new WeakSet<object>();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value); Object.freeze(value); for (const child of Object.values(value)) pending.push(child);
  }
  originalDirectoryCaptures.add(capture);
  return capture;
}
export function assertOriginalPlayerDirectoryCapture(capture: PlayerDirectoryCapture, attempt: PlayerDirectoryAttempt): void {
  if (!originalDirectoryCaptures.has(capture) || capture.attemptId !== attempt.id || capture.attemptNonce !== attempt.nonce) {
    throw new Error('Original player directory transport capture required.');
  }
}
