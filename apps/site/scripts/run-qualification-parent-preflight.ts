import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runParentPreflight, validateParentApproval } from '../integration/qualification-parent-preflight';

// Deliberately not wired into verify:full or ordinary integration setup. Running
// this exact command requires separate key-use, parent-access and cost approval.
const timeout = setTimeout(()=>process.exit(1),600_000);
try {
  if (process.argv.length!==3) throw new Error('One non-secret reviewed approval file is required.');
  const approval = validateParentApproval(JSON.parse(await readFile(process.argv[2],'utf8')));
  const root = fileURLToPath(new URL('../../..',import.meta.url));
  const options = {cwd:root,encoding:'utf8' as const,windowsHide:true,timeout:2000};
  if (execFileSync('git',['rev-parse','HEAD'],options).trim()!==approval.reviewedSha
    || execFileSync('git',['status','--porcelain'],options).trim()) throw new Error('Clean reviewed source required.');
  const key = process.env.NEON_TEST_API_KEY;
  if (!key) throw new Error('Protected test credential required.');
  const result = await runParentPreflight(key,approval,AbortSignal.timeout(570_000));
  if (execFileSync('git',['rev-parse','HEAD'],options).trim()!==approval.reviewedSha
    || execFileSync('git',['status','--porcelain'],options).trim()) throw new Error('Source changed.');
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stderr.write('Test-parent inspection failed; no database qualification is claimed. Credentials and driver errors are withheld.\n');
  process.exitCode=1;
} finally { clearTimeout(timeout); }
