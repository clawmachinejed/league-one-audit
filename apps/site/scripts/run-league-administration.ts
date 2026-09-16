import { parseAdministrationOperatorInput, runAdministrationOperator } from '../lib/league-administration/operator';

try {
  const result = await runAdministrationOperator(parseAdministrationOperatorInput(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'completed') process.exitCode = 1;
} catch {
  process.stderr.write(`${JSON.stringify({ status: 'failed', stage: 'operator-preflight', reason: 'administration-operator-refused' })}\n`);
  process.exitCode = 1;
}
