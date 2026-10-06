import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
vi.mock('next/cache',()=>({unstable_cache:<T,>(fn:T)=>fn}));
const mocked=vi.hoisted(()=>({safe:vi.fn(),owner:vi.fn(),environment:vi.fn()}));
vi.mock('./neon-integration-harness',()=>({assertSafeIntegrationDatabase:mocked.safe,
  ownerQuery:mocked.owner,integrationEnvironment:mocked.environment}));
import { createAccountAcquisitionFixture } from './account-acquisition-fixture';
beforeEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});
it('refuses fixture setup before existing target/sentinel/ownership guards pass',async()=>{
  mocked.safe.mockRejectedValue(new Error('Unverified disposable child'));
  await expect(createAccountAcquisitionFixture()).rejects.toThrow('Unverified disposable child');
  expect(mocked.owner).not.toHaveBeenCalled();expect(mocked.environment).not.toHaveBeenCalled();
});
it('requires a genuine account credential before owner policy setup',async()=>{
  vi.stubEnv('ACCOUNT_AUTHORITY_INTEGRATION_DATABASE_URL','');
  await expect(createAccountAcquisitionFixture()).rejects.toThrow('Actual account LOGIN fixture credential required.');
  expect(mocked.safe).toHaveBeenCalledOnce();expect(mocked.owner).not.toHaveBeenCalled();
});
