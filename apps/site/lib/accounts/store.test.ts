import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { type AccountDatabase, AccountStoreUnavailableError } from './database';
import { ACCOUNT_VIEW_SQL } from './neon/source-sql';
import { AccountConflictError, createAccountStore } from './store';

const actor = '10000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000002';
function fixture() {
  const transaction = vi.fn<AccountDatabase['transaction']>();
  return { transaction, store: createAccountStore({ transaction }) };
}
describe('account store boundary', () => {
  it('resolves only the verified identity pair, with a new request ID and no inherited actor context', async () => {
    const { store, transaction } = fixture();
    transaction.mockResolvedValue([[{ id: actor }]]);
    expect(await store.resolve({ issuer: 'https://auth.example.test', subject: 'opaque-subject', displayName: 'Same name' })).toBe(actor);
    expect(transaction).toHaveBeenCalledTimes(1);
    const [statements, context] = transaction.mock.calls[0];
    expect(context).toBeUndefined();
    expect(statements[0].parameters.slice(0, 3)).toEqual(['https://auth.example.test', 'opaque-subject', 'Same name']);
    expect(statements[0].parameters[3]).toMatch(/^[0-9a-f-]{36}$/u);
  });
  it('rejects missing, ambiguous and malformed resolved identities', async () => {
    const { store, transaction } = fixture();
    for (const rows of [[], [{ id: actor }, { id: other }], [{ id: 'not-an-id' }]]) {
      transaction.mockResolvedValueOnce([rows]);
      await expect(store.resolve({ issuer: 'issuer', subject: 'subject', displayName: 'Name' })).rejects.toThrow();
    }
  });
  it('uses the canonical account query and actor context without creating a public projection read', async () => {
    const { store, transaction } = fixture();
    transaction.mockResolvedValue([[{ view: { profile: { id: actor, displayName: 'Person', revision: 1 },
      links: [], saved: [], sources: [], providerAccounts: [], groups: [] } }]]);
    expect((await store.read(actor)).profile.id).toBe(actor);
    expect(transaction.mock.calls[0][0]).toEqual([{ statement: ACCOUNT_VIEW_SQL, parameters: [] }]);
    expect(transaction.mock.calls[0][1]).toMatchObject({ actorUserId: actor });
  });
  it('refuses missing/malformed private view data instead of showing another identity or synthetic profile', async () => {
    const { store, transaction } = fixture();
    for (const result of [[], [{ view: null }], [{ view: { profile: null } }]]) {
      transaction.mockResolvedValueOnce([result]);
      await expect(store.read(actor)).rejects.toBeInstanceOf(AccountStoreUnavailableError);
    }
  });
  it('rejects actor, lifecycle and assurance fields before any database mutation', async () => {
    const { store, transaction } = fixture();
    await expect(store.mutate(actor, { kind: 'profile', body: { displayName: 'Name', revision: 1, appUserId: other } })).rejects.toThrow();
    await expect(store.mutate(actor, { kind: 'profile', body: { displayName: 'Name', revision: 1, status: 'active' } })).rejects.toThrow();
    await expect(store.mutate(actor, { kind: 'link', body: { sourceManagerAccountId: other, assurance: 'verified' } })).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
  it('serializes a mutation and treats stale or missing update results as conflicts', async () => {
    const { store, transaction } = fixture();
    transaction.mockResolvedValueOnce([[{ id: actor }], []]);
    await expect(store.mutate(actor, { kind: 'profile', body: { displayName: ' New name ', revision: 4 } }))
      .rejects.toBeInstanceOf(AccountConflictError);
    const [statements, context] = transaction.mock.calls[0];
    expect(statements).toHaveLength(2);
    expect(statements[0].statement).toContain('FOR UPDATE');
    expect(statements[1].parameters).toEqual(['New name', 4]);
    expect(context).toMatchObject({ actorUserId: actor });
  });
  it('makes removal revisioned and scopes unlink IDs through the authenticated transaction', async () => {
    const { store, transaction } = fixture();
    transaction.mockResolvedValue([[{ id: actor }], [{ id: other }]]);
    await store.mutate(actor, { kind: 'unlink', id: other, body: { revision: 2 } });
    expect(transaction.mock.calls[0][0][1].parameters).toEqual([other, 2]);
    expect(transaction.mock.calls[0][1]?.actorUserId).toBe(actor);
    await expect(store.mutate(actor, { kind: 'remove-league', id: other, body: {} })).rejects.toThrow();
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

describe('active Sleeper association discovery query', () => {
  const row = { linkId: actor, revision: '2', sourceManagerAccountId: other, externalId: '123456789012345678', displayName: 'Stored profile' };
  it('reads immutable provider IDs from actor-scoped active links even when display evidence is missing', async () => {
    const { store, transaction } = fixture();
    transaction.mockResolvedValue([[row]]);
    expect(await store.readDiscoveryProfiles(actor)).toEqual([{ ...row, revision: 2 }]);
    const [statements, context] = transaction.mock.calls[0];
    expect(context?.actorUserId).toBe(actor);
    expect(statements[0].statement).toContain('link.app_user_id=public.current_app_actor()');
    expect(statements[0].statement).toContain('link.revoked_at IS NULL');
    expect(statements[0].statement).toContain('LEFT JOIN provider_accounts');
    expect(statements[0].statement).toContain('manager.external_manager_id');
  });
  it('refuses oversized or malformed stored association sets without silently truncating', async () => {
    const { store, transaction } = fixture();
    for (const rows of [Array.from({ length: 21 }, () => row), [{ ...row, revision: 'bad' }],
      [{ ...row, linkId: 'bad' }], [{ ...row, externalId: null }]]) {
      transaction.mockResolvedValueOnce([rows]);
      await expect(store.readDiscoveryProfiles(actor)).rejects.toBeInstanceOf(AccountStoreUnavailableError);
    }
  });
});
