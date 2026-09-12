import { getProjectionStore } from '../lib/projection-store';
import { runProductionAllPlayerOperation } from '../lib/projections/runtime/all-player-composition';
import { parseAllPlayerOperatorInput } from '../lib/projections/runtime/all-player-operator-guards';

let stage = 'operator-input';
async function main(): Promise<void> {
  const input = parseAllPlayerOperatorInput(process.argv.slice(2));
  stage = 'database-identity';
  const store = getProjectionStore();
  if (!store.enabled) throw new Error('The authorized database target is unavailable.');
  const identity = await store.readDatabaseIdentity();
  if (identity.databaseName !== input.expectedDatabase || identity.roleName !== input.expectedRole) {
    throw new Error('The connected database identity does not match the authorization.');
  }
  stage = 'ingestion';
  const result = await runProductionAllPlayerOperation(input.mode, input.period);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'completed' && result.status !== 'skipped') process.exitCode = 1;
}

await main().catch((error: unknown) => {
  void error;
  process.stderr.write(`${JSON.stringify({ status: 'failed', reason: 'operator-failed', stage,
    retryDisposition: 'inspect-stage-before-retry' })}\n`);
  process.exitCode = 1;
});
