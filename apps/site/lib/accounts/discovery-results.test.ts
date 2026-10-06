import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }));
import { decodeAcquisitionAdmission, decodeAcquisitionProgress, decodeAcquisitionActivation, decodeStoredDiscovery } from './discovery-results';
import { normalizeSleeperAccountIdentity } from '../sleeper';

const id = '10000000-0000-4000-8000-000000000001';
const complete = { status: 'available', demandId: id, scanId: id, providerAccountId: id, nativeAccountId: '123',
  displayName: 'Manager', currentSeason: 2026, coverage: 'complete', requiredSeasons: [2026, 2025, 2024],
  completedSeasons: [2026, 2025, 2024], candidates: [{ id: '987', name: 'Candidate', season: '2026', avatar: null }] };
describe('closed acquisition result decoding', () => {
  it('accepts only the operation-specific retained shapes', () => {
    expect(decodeAcquisitionAdmission({ status: 'joined', demandId: id, retryAfterSeconds: 2 })).toEqual({ status: 'joined', demandId: id, retryAfterSeconds: 2 });
    expect(decodeAcquisitionActivation({ status: 'active', associationId: id, associationRevision: '9223372036854775807', assurance: 'user_asserted' }).status).toBe('active');
    expect(decodeStoredDiscovery(complete)).toEqual(complete);
  });
  it('never upgrades public identity recognition into proof of external account control', () => {
    expect(() => decodeAcquisitionActivation({ status: 'active', associationId: id, associationRevision: '1', assurance: 'authenticated' })).toThrow();
    expect(() => decodeAcquisitionActivation({ status: 'active', associationId: id, associationRevision: '1' })).toThrow();
  });
  it.each([null, [], {}, { status: 'pending', demandId: id, retryAfterSeconds: 2, receipt: 'private' },
    { status: 'pending', demandId: id, retryAfterSeconds: 0 }, { status: 'denied', reason: { secret: 'private' } },
    { status: 'denied', reason: 'database connection password detail' }, { status: 'active', associationId: id, associationRevision: '1' }])(
    'rejects malformed or cross-operation admission data: %j', value => expect(() => decodeAcquisitionAdmission(value)).toThrow());
  it('preserves canonical absent/null/invalid identity display distinctions without fallback', () => {
    const providerAccount = { id, provider: 'sleeper', namespace: 'sleeper:user', nativeAccountId: '123',
      username: { state: 'absent', value: null }, displayName: { state: 'null', value: null }, avatar: { state: 'invalid', value: null },
      identityEvidenceKind: 'lookup', identityEvidenceRef: id };
    expect(decodeAcquisitionProgress({ status: 'identified', demandId: id, lookupCaptureId: id, providerAccount }))
      .toEqual({ status: 'identified', demandId: id, lookupCaptureId: id, providerAccount });
    expect(() => decodeAcquisitionProgress({ status: 'identified', demandId: id, lookupCaptureId: id,
      providerAccount: { ...providerAccount, sessionToken: 'must-not-leak' } })).toThrow();
    expect(() => decodeAcquisitionProgress({ status: 'identified', demandId: id, lookupCaptureId: id,
      providerAccount: { ...providerAccount, namespace: 'another-provider:user' } })).toThrow();
  });
  it('accepts the existing normalizer display domain without suppressing independently valid identity', () => {
    const normalized = normalizeSleeperAccountIdentity({ user_id: '123', username: 'alice', display_name: 'A\nmanager', avatar: 123 }, 'alice');
    const display = { nativeAccountId: normalized.nativeAccountId, username: normalized.username,
      displayName: normalized.displayName, avatar: normalized.avatar };
    const providerAccount = { ...display, id, provider: 'sleeper', namespace: 'sleeper:user', identityEvidenceKind: 'lookup', identityEvidenceRef: id };
    const result = decodeAcquisitionProgress({ status: 'identified', demandId: id, lookupCaptureId: id, providerAccount });
    expect(result).toMatchObject({ status: 'identified', providerAccount: { nativeAccountId: '123',
      displayName: { state: 'known', value: 'A\nmanager' }, avatar: { state: 'invalid', value: null } } });
    expect(JSON.stringify(result)).toContain('A\\nmanager');
  });
  it.each([
    { ...complete, completedSeasons: [2023] },
    { ...complete, completedSeasons: [2026], candidates: [] },
    { ...complete, requiredSeasons: [2026], completedSeasons: [2026] },
    { ...complete, coverage: 'pending' },
    { ...complete, requiredSeasons: [2026, 2026] },
    { ...complete, candidates: [...complete.candidates, ...complete.candidates] },
    { ...complete, candidates: [{ ...complete.candidates[0], avatar: 'https://foreign.invalid/a' }] },
    { ...complete, candidates: [{ ...complete.candidates[0], membership: true }] },
    { ...complete, candidates: [{ ...complete.candidates[0], season: '2022' }] },
  ])('rejects unsupported scope or extra candidate authority: %j', value => expect(() => decodeStoredDiscovery(value)).toThrow());
});
