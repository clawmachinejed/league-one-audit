import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ prepare: vi.fn(), clean: vi.fn(), safe: vi.fn(), clock: vi.fn(), owner: vi.fn(), artifacts: vi.fn() }));
vi.mock('./neon-integration-harness', () => ({ prepareIntegrationDatabase: mocked.prepare,
  cleanIntegrationDatabase: mocked.clean, assertSafeIntegrationDatabase: mocked.safe, ownerQuery: vi.fn(),
  integrationEnvironment: () => ({ expectedDatabase: 'fixture_test', expectedBranchId: 'br-fixture-test' }) }));
vi.mock('./all-player-schedule-test-clock', () => ({ installAllPlayerScheduleTestClock: mocked.clock }));
vi.mock('./integration-artifacts', () => ({ initializeIntegrationArtifactDirectory: mocked.artifacts }));
vi.mock('./collection-capacity-supervision', () => ({ assertCapacityOwner: mocked.owner, CAPACITY_OWNER_ENV: 'FIXTURE_UNUSED_PROOF' }));
import standardSetup from './global-setup';
import capacitySetup from './collection-capacity.global-setup';

const originalExitCode = process.exitCode;
afterEach(() => { process.exitCode = originalExitCode; vi.unstubAllEnvs(); });

beforeEach(() => {
  vi.resetAllMocks();
  for (const fn of Object.values(mocked)) fn.mockResolvedValue(undefined);
});

it.each([['standard', standardSetup], ['capacity', capacitySetup]] as const)(
  '%s setup closes central ownership when clock installation fails before teardown registration', async (_name, setup) => {
    mocked.clock.mockRejectedValue(new Error('synthetic clock failure'));
    await expect(setup()).rejects.toThrow('synthetic clock failure');
    expect(mocked.clean).toHaveBeenCalledOnce();
  });

it('delegates expired-parent teardown to central cleanup so its shared session is still released', async () => {
  const teardown = await capacitySetup();
  mocked.owner.mockRejectedValue(new Error('parent disappeared'));
  mocked.clean.mockRejectedValue(new Error('central owner verification failed after releasing its session'));
  await expect(teardown()).rejects.toThrow('central owner verification failed');
  expect(mocked.owner).toHaveBeenCalledTimes(1);
  expect(mocked.clean).toHaveBeenCalledOnce();
});

it('closes standard ownership if artifact directory initialization fails before teardown registration', async () => {
  mocked.artifacts.mockRejectedValue(new Error('artifact directory unavailable'));
  await expect(standardSetup()).rejects.toThrow('artifact directory unavailable');
  expect(mocked.prepare).toHaveBeenCalledOnce();
  expect(mocked.clean).toHaveBeenCalledOnce();
  expect(mocked.clock).not.toHaveBeenCalled();
});

it('rejects a partial supervisor context before preparing any database', async () => {
  vi.stubEnv('PROJECTION_INTEGRATION_QUALIFICATION_CONTEXT', '{}');
  await expect(standardSetup()).rejects.toThrow();
  expect(mocked.prepare).not.toHaveBeenCalled();
});
it('makes standalone teardown failure set a failing process status even when the runner ignores close errors', async () => {
  const cleanup = await standardSetup(); mocked.clean.mockRejectedValue(new Error('failed cleanup'));
  await expect(cleanup()).rejects.toThrow('failed cleanup'); expect(process.exitCode).toBe(1);
});
