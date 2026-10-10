import type { AdministrationSourceMapping, AdministrationWriteFence, PublicCaptureWitness, PublicIntakeWork } from './contracts';
import { isAdministrationSourceMapping } from './source-mapping';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
export type { PublicCaptureWitness } from './contracts';
const originalCaptures = new WeakMap<object, Readonly<{ witness: string; capture: string }>>();
function freezeCapture(value: object): void {
  const pending: object[] = [value], seen = new Set<object>();
  while (pending.length) {
    const item = pending.pop()!;
    if (seen.has(item)) continue;
    seen.add(item);
    for (const child of Object.values(item)) if (child !== null && typeof child === 'object') pending.push(child);
    Object.freeze(item);
  }
}
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: readonly string[]) =>
  Object.keys(value).sort().join('|') === [...expected].sort().join('|');

export function parsePublicCaptureWitness(value: unknown): PublicCaptureWitness {
  if (!object(value) || !keys(value, ['version', 'work', 'fence', 'dispatchNonce', 'mapping', 'attempts'])
    || value.version !== 'public-network-capture-v1' || !uuid(value.dispatchNonce)
    || !object(value.work) || !uuid(value.work.requestId) || !Number.isSafeInteger(value.work.revision)
    || Number(value.work.revision) < 0 || !object(value.fence)
    || !keys(value.fence, ['jobKey', 'workerId', 'generation', 'deadlineAt'])
    || value.fence.jobKey !== 'league-administration-public-intake' || !uuid(value.fence.workerId)
    || !Number.isSafeInteger(value.fence.generation) || Number(value.fence.generation) < 1
    || typeof value.fence.deadlineAt !== 'string' || !Number.isFinite(Date.parse(value.fence.deadlineAt))
    || !object(value.attempts)) throw new Error('Invalid public capture witness.');
  const work = value.work, kind = work.kind;
  const workKeys = ['requestId', 'revision', 'kind', ...(kind === 'identity' ? ['username']
    : kind === 'leagues' ? ['userId', 'season'] : ['externalLeagueId', 'season']),
  ...(kind === 'exact-matchups' ? ['nativeWeek'] : [])];
  if (!['identity', 'leagues', 'bootstrap', 'core', 'users', 'exact-matchups'].includes(String(kind))
    || !keys(work, workKeys)
    || (kind === 'identity' ? typeof work.username !== 'string' || !/^[a-zA-Z0-9_]{1,100}$/u.test(work.username)
      : !Number.isInteger(work.season) || Number(work.season) < 1920 || Number(work.season) > 2200
        || typeof work[kind === 'leagues' ? 'userId' : 'externalLeagueId'] !== 'string'
        || !/^[1-9][0-9]{0,31}$/u.test(String(work[kind === 'leagues' ? 'userId' : 'externalLeagueId'])))
    || (kind === 'exact-matchups' && (!Number.isInteger(work.nativeWeek) || Number(work.nativeWeek) < 1 || Number(work.nativeWeek) > 18))) {
    throw new Error('Invalid public capture work.');
  }
  const mapped = ['core', 'users', 'exact-matchups'].includes(String(kind));
  if (mapped ? !isAdministrationSourceMapping(value.mapping)
    || value.mapping.scope.externalLeagueId !== work.externalLeagueId || value.mapping.scope.season !== work.season
    : value.mapping !== null) throw new Error('Invalid public capture mapping.');
  const roles = kind === 'core' ? ['settings', 'players', 'managers',
    ...(Object.hasOwn(value.attempts, 'managersV2') ? ['managersV2'] : [])]
    : kind === 'exact-matchups' ? ['settings', 'matchups'] : [];
  if (!keys(value.attempts, roles)) throw new Error('Invalid public capture group.');
  const ids = new Set<string>(), nonces = new Set<string>();
  for (const attempt of Object.values(value.attempts)) {
    if (!object(attempt) || !keys(attempt, ['id', 'nonce']) || !uuid(attempt.id) || !uuid(attempt.nonce)
      || ids.has(attempt.id) || nonces.has(attempt.nonce)) throw new Error('Invalid public capture attempt.');
    ids.add(attempt.id); nonces.add(attempt.nonce);
  }
  // Copy and freeze before any await; later caller mutation cannot change a request's identity.
  const copy = JSON.parse(JSON.stringify(value)) as PublicCaptureWitness;
  freezeCapture(copy);
  return copy;
}

export function assertPublicCaptureWitness(value: unknown, expected: PublicCaptureWitness): void {
  if (compatibleRevision(parsePublicCaptureWitness(value)) !== compatibleRevision(expected)) {
    throw new Error('Public capture acquisition mismatch.');
  }
}

/** Transport completion only: never call this while recording an older document.
 * The process-local seal prevents accidental copies/retags from becoming a new
 * capture. It is not a cryptographic claim about an untrusted SQL writer. */
export function sealPublicCapture<T extends object>(capture: T, witness: PublicCaptureWitness | undefined): T {
  if (witness !== undefined) {
    originalCaptures.set(capture, { witness: compatibleRevision(witness), capture: compatibleRevision(capture) });
    freezeCapture(capture);
  }
  return capture;
}

export function assertOriginalPublicCapture(capture: object & { acquisition?: PublicCaptureWitness },
  expected: PublicCaptureWitness): void {
  assertPublicCaptureWitness(capture.acquisition, expected);
  const original = originalCaptures.get(capture);
  if (!original || original.witness !== compatibleRevision(expected) || original.capture !== compatibleRevision(capture)) {
    throw new Error('Original public transport capture required.');
  }
}

export function validateRequestedPublicCaptureWitness(value: unknown, work: PublicIntakeWork,
  mapping: AdministrationSourceMapping | null, fence: AdministrationWriteFence,
  attempts: Readonly<Record<string, string>> = {}): PublicCaptureWitness {
  const witness = parsePublicCaptureWitness(value);
  if (compatibleRevision(witness.work) !== compatibleRevision(work)
    || compatibleRevision(witness.mapping) !== compatibleRevision(mapping)
    || compatibleRevision(witness.fence) !== compatibleRevision(fence)
    || !keys(witness.attempts, Object.keys(attempts))
    || Object.entries(attempts).some(([role, id]) => witness.attempts[role].id !== id)) {
    throw new Error('Public capture reservation group mismatch.');
  }
  return witness;
}

/** Called at the actual transport entry, before starting the provider request. */
export function publicCaptureForRequest(value: PublicCaptureWitness | undefined,
  family: 'identity' | 'leagues' | 'league' | 'rosters' | 'users' | 'matchups', identity: string,
  period: number | null = null): PublicCaptureWitness | undefined {
  if (value === undefined) return undefined;
  const witness = parsePublicCaptureWitness(value), work = witness.work;
  const matches = family === 'identity' ? work.kind === 'identity' && work.username === identity && period === null
    : family === 'leagues' ? work.kind === 'leagues' && work.userId === identity && work.season === period
      : 'externalLeagueId' in work && work.externalLeagueId === identity
        && (family === 'league' ? ['bootstrap', 'core', 'exact-matchups'].includes(work.kind) && period === null
          : family === 'rosters' ? work.kind === 'core' && period === null
            : family === 'users' ? work.kind === 'users' && period === null
              : work.kind === 'exact-matchups' && work.nativeWeek === period);
  if (!matches) throw new Error('Public capture request scope mismatch.');
  return witness;
}
