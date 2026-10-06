import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
const mocked=vi.hoisted(()=>({safe:vi.fn(),prepare:vi.fn(),pin:vi.fn(),artifact:vi.fn(),pool:vi.fn()}));
vi.mock('./neon-integration-harness',()=>({assertSafeIntegrationDatabase:mocked.safe,
  prepareIntegrationDatabase:mocked.prepare,createPinnedIntegrationDatabase:mocked.pin}));
vi.mock('./integration-artifacts',()=>({writeIntegrationArtifact:mocked.artifact}));
vi.mock('./account-authority-fixture',()=>({setSyntheticAccountReceipt:vi.fn()}));
vi.mock('@neondatabase/serverless',()=>({Pool:mocked.pool}));
import { rehearseAccountTransition } from './account-transition-rehearsal';

beforeEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();mocked.artifact.mockResolvedValue('synthetic.json');});
it('does not connect or reset before the existing target guards succeed',async()=>{
  mocked.safe.mockRejectedValue(new Error('unsafe sentinel'));
  await expect(rehearseAccountTransition()).rejects.toThrow('Guarded account transition rehearsal failed');
  expect(mocked.prepare).not.toHaveBeenCalled();expect(mocked.pin).not.toHaveBeenCalled();expect(mocked.pool).not.toHaveBeenCalled();
  expect(mocked.artifact).toHaveBeenCalledWith('account-transition-rehearsal-failure.json',{
    status:'failed',completed:[],serviceDrainQualified:false,realNetworkInterruptionQualified:false});
});
it('requires a genuine restricted credential before destructive preparation',async()=>{
  vi.stubEnv('ACCOUNT_AUTHORITY_INTEGRATION_DATABASE_URL','');
  await expect(rehearseAccountTransition()).rejects.toThrow();
  expect(mocked.prepare).not.toHaveBeenCalled();expect(mocked.pin).not.toHaveBeenCalled();
});
it('does not continue after guarded legacy preparation fails or leak its error',async()=>{
  vi.stubEnv('ACCOUNT_AUTHORITY_INTEGRATION_DATABASE_URL','synthetic-only');
  mocked.prepare.mockRejectedValue(new Error('postgres://secret@private'));
  await expect(rehearseAccountTransition()).rejects.toThrow('Guarded account transition rehearsal failed; inspect sanitized stage evidence.');
  expect(mocked.prepare).toHaveBeenCalledWith({throughMigration:'033_transaction_capture_acceptance.sql'});
  expect(mocked.pin).not.toHaveBeenCalled();expect(mocked.pool).not.toHaveBeenCalled();
});
