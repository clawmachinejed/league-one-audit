import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRouteEvidence, evaluateRouteEvidence, evaluateWorkflowEvidence, redactDoctorDetail } from './doctor-evidence.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const canonicalRepository = 'clawmachinejed/league-one-audit';
const productionUrl = 'https://www.league1fantasy.com';
const expectedProject = 'league_one_fantasy';
const expectedScope = 'robert-finchums-projects';
const expectedProjectId = 'prj_ltHyQzM7bZfSlTNd2CTalJDLKpVG';
const expectedOrgId = 'team_2O6dBmAQpRm6ZAUJOE0nPMBO';
const results = [];

function add(status, area, detail) {
  results.push({ status, area, detail: redactDoctorDetail(detail) });
}

function run(command, args, cwd = root, timeout = 20_000) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    timeout,
    windowsHide: true,
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
    error: result.error,
    status: result.status,
  };
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function parseWorktrees(text) {
  return text.split(/\r?\n\r?\n/).filter(Boolean).map((block) => {
    const record = {};
    for (const line of block.split(/\r?\n/)) {
      const space = line.indexOf(' ');
      if (space > 0) record[line.slice(0, space)] = line.slice(space + 1);
    }
    return record;
  });
}

function normalizeOrigin(value) {
  return value.trim().replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '').replace(/^https:\/\/github\.com\//, '').toLowerCase();
}

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const origin = run('git', ['remote', 'get-url', 'origin']);
if (origin.ok && normalizeOrigin(origin.stdout) === canonicalRepository) add('Healthy', 'Repository identity', canonicalRepository);
else add(origin.ok ? 'Unhealthy' : 'Unverified', 'Repository identity', origin.ok ? `Git remote differs from ${canonicalRepository}.` : 'Git remote unavailable.');

const nodeMajor = Number(process.versions.node.split('.')[0]);
add(nodeMajor === 24 ? 'Healthy' : 'Unhealthy', 'Node.js', `${process.version}; package requires ${packageJson.engines?.node ?? 'an unspecified version'}.`);
const pnpmEntrypoint = process.env.npm_execpath;
const pnpmVersion = pnpmEntrypoint ? run(process.execPath, [pnpmEntrypoint, '--version']) : run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--version']);
add(pnpmVersion.ok && pnpmVersion.stdout === '11.19.0' ? 'Healthy' : pnpmVersion.ok ? 'Unhealthy' : 'Unverified', 'pnpm', pnpmVersion.ok ? `Installed version ${/^\d+\.\d+\.\d+$/.test(pnpmVersion.stdout) ? pnpmVersion.stdout : 'unrecognized'}; package requires 11.19.0.` : 'pnpm unavailable.');

const rootLock = resolve(root, 'pnpm-lock.yaml');
const installedLock = resolve(root, 'node_modules/.pnpm/lock.yaml');
if (!existsSync(installedLock)) add('Unhealthy', 'Dependencies', 'node_modules is not installed; run pnpm install --frozen-lockfile.');
else add(hashFile(rootLock) === hashFile(installedLock) ? 'Healthy' : 'Unhealthy', 'Dependencies', hashFile(rootLock) === hashFile(installedLock) ? 'Installed lockfile matches pnpm-lock.yaml.' : 'Installed lockfile differs from pnpm-lock.yaml.');

const currentBranch = run('git', ['branch', '--show-current']);
const currentStatus = run('git', ['status', '--porcelain']);
add(currentStatus.ok && !currentStatus.stdout ? 'Healthy' : currentStatus.ok ? 'Unhealthy' : 'Unverified', 'Current worktree', currentStatus.ok ? `${currentBranch.stdout || 'detached HEAD'}; ${currentStatus.stdout ? 'uncommitted changes present' : 'clean'}.` : 'Worktree status unavailable.');

const worktreeResult = run('git', ['worktree', 'list', '--porcelain']);
let worktrees = [];
if (worktreeResult.ok) {
  worktrees = parseWorktrees(worktreeResult.stdout);
  add('Healthy', 'Worktrees', `${worktrees.length} observed: ${worktrees.map((item) => `${item.branch?.replace('refs/heads/', '') || 'detached'} at ${item.worktree}`).join('; ')}`);
} else add('Unverified', 'Worktrees', 'Unable to list worktrees.');

const mainWorktree = worktrees.find((item) => item.branch === 'refs/heads/main');
let mainClean = false;
let remoteMainSha = '';
let localMainSha = '';
if (mainWorktree) {
  const mainStatus = run('git', ['-C', mainWorktree.worktree, 'status', '--porcelain']);
  const localMain = run('git', ['rev-parse', 'refs/heads/main']);
  const remoteMain = run('git', ['ls-remote', 'origin', 'refs/heads/main'], root, 30_000);
  mainClean = mainStatus.ok && !mainStatus.stdout;
  localMainSha = localMain.ok && /^[a-f0-9]{40}$/.test(localMain.stdout) ? localMain.stdout : '';
  const remoteSha = remoteMain.ok ? remoteMain.stdout.split(/\s+/)[0] : '';
  remoteMainSha = /^[a-f0-9]{40}$/.test(remoteSha) ? remoteSha : '';
  if (!mainClean) add('Unhealthy', 'Primary main checkout', 'Primary main worktree has uncommitted changes.');
  else if (!remoteMainSha || !localMainSha) add('Unverified', 'Primary main alignment', 'Main commit evidence unavailable or malformed.');
  else add(localMainSha === remoteMainSha ? 'Healthy' : 'Unhealthy', 'Primary main alignment', localMainSha === remoteMainSha ? `Clean and aligned at ${localMainSha}.` : `Local ${localMainSha}; GitHub ${remoteMainSha}.`);
} else add('Unverified', 'Primary main checkout', 'No main worktree was observed.');

const ghAuth = run('gh', ['auth', 'status', '--active']);
if (!ghAuth.ok) {
  add('Unverified', 'GitHub authentication', 'GitHub CLI authentication unavailable.');
  add('Unverified', 'GitHub Actions', 'Workflow evidence unavailable without GitHub authentication.');
}
let openPullRequests = null;
if (ghAuth.ok) {
  const repo = run('gh', ['repo', 'view', canonicalRepository, '--json', 'nameWithOwner,defaultBranchRef,viewerPermission']);
  try {
    const value = JSON.parse(repo.stdout);
    const matches = value.nameWithOwner?.toLowerCase() === canonicalRepository && value.defaultBranchRef?.name === 'main';
    add(matches ? 'Healthy' : 'Unhealthy', 'GitHub access', matches ? 'Canonical repository access; default branch main.' : 'Repository or default branch differs from the canonical identity.');
  } catch {
    add('Unverified', 'GitHub access', 'Repository metadata unavailable or malformed.');
  }
  const prs = run('gh', ['pr', 'list', '--repo', canonicalRepository, '--state', 'open', '--json', 'number,url,headRefName,isDraft,author,updatedAt']);
  try {
    openPullRequests = JSON.parse(prs.stdout);
    add('Healthy', 'Open pull requests', openPullRequests.length ? `${openPullRequests.length} observed: ${openPullRequests.map((pr) => `#${pr.number} ${pr.headRefName}`).join(', ')}` : 'None observed.');
  } catch {
    add('Unverified', 'Open pull requests', 'Pull request metadata unavailable or malformed.');
  }
  const runs = run('gh', ['run', 'list', '--repo', canonicalRepository, '--branch', 'main', '--workflow', 'verify.yml', '--limit', '10', '--json', 'headSha,status,conclusion,workflowName,databaseId']);
  const workflowEvidence = evaluateWorkflowEvidence(runs, remoteMainSha);
  add(workflowEvidence.status, 'GitHub Actions', `${workflowEvidence.reason}: ${workflowEvidence.detail}`);
}

const linkCandidates = [resolve(root, '.vercel/project.json'), resolve(root, 'apps/site/.vercel/project.json')];
const linkPath = linkCandidates.find(existsSync);
if (linkPath) {
  try {
    const link = JSON.parse(readFileSync(linkPath, 'utf8'));
    const matches = link.projectName === expectedProject && link.projectId === expectedProjectId && link.orgId === expectedOrgId;
    add(matches ? 'Healthy' : 'Unhealthy', 'Vercel local linkage', matches
      ? `${expectedScope}/${expectedProject}; project and organization IDs match.`
      : `Expected ${expectedScope}/${expectedProject} with project ${expectedProjectId} and organization ${expectedOrgId}; local linkage differs.`);
  } catch {
    add('Unhealthy', 'Vercel local linkage', 'Project linkage metadata is malformed.');
  }
} else add('Unverified', 'Vercel local linkage', 'No ignored .vercel/project.json was found in this worktree.');

let vercelCommand = 'vercel';
let vercelPrefix = [];
if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
  const localShim = resolve(process.env.LOCALAPPDATA, 'pnpm/bin/vercel');
  if (existsSync(localShim)) {
    const target = readFileSync(localShim, 'utf8').match(/^# cmd-shim-target=(.+)$/m)?.[1]?.trim();
    if (target && existsSync(target)) {
      vercelCommand = process.execPath;
      vercelPrefix = [target];
    }
  }
}
const vercelVersion = process.platform === 'win32' && !vercelPrefix.length
  ? { ok: false, stdout: '', stderr: 'Vercel CLI is not installed in the user-local pnpm area.', status: 1 }
  : run(vercelCommand, [...vercelPrefix, '--version']);
let vercelVerified = false;
if (!vercelVersion.ok) add('Unverified', 'Vercel authentication and deployment', 'Vercel CLI unavailable.');
else {
  const whoami = run(vercelCommand, [...vercelPrefix, 'whoami']);
  const inspect = run(vercelCommand, [...vercelPrefix, 'inspect', productionUrl, '--scope', expectedScope, '--json'], resolve(root, 'apps/site'), 45_000);
  try {
    const deployment = JSON.parse(inspect.stdout);
    vercelVerified = whoami.ok && deployment.name === expectedProject && deployment.target === 'production' && deployment.readyState === 'READY' && deployment.aliases?.includes('www.league1fantasy.com');
    add(vercelVerified ? 'Healthy' : 'Unhealthy', 'Vercel authentication and deployment', vercelVerified ? `${expectedProject} production is Ready and serves www.league1fantasy.com.` : 'Vercel authentication or deployment metadata could not be verified.');
    const deployedCrons = deployment.builds?.[0]?.config?.vercelConfig?.crons;
    const localCrons = JSON.parse(readFileSync(resolve(root, 'apps/site/vercel.json'), 'utf8')).crons;
    add(JSON.stringify(deployedCrons) === JSON.stringify(localCrons) ? 'Healthy' : 'Unhealthy', 'Cron declarations', JSON.stringify(deployedCrons) === JSON.stringify(localCrons) ? 'The production deployment carries the three tracked every-minute schedules.' : 'Production and tracked cron declarations differ.');
  } catch {
    add('Unverified', 'Vercel authentication and deployment', 'Deployment metadata unavailable or malformed.');
    add('Unverified', 'Cron declarations', 'Remote cron configuration could not be compared.');
  }
}
const sourceEvidence = 'Unverified';
add(sourceEvidence, 'Vercel source binding, branch, and production Git SHA', `The installed CLI deployment payload does not expose enough Git source metadata to verify ${canonicalRepository}, main, and the exact production SHA. Verify all three in the authenticated Vercel deployment view before implementation or release.`);

async function checkRoute(area, path, marker) {
  const expectedUrl = `${productionUrl}${path}`;
  const evidence = evaluateRouteEvidence(await collectRouteEvidence(expectedUrl), expectedUrl, marker);
  add(evidence.status, area, `${evidence.reason}: ${evidence.detail}`);
}

await checkRoute('League One public route', '/matchups', 'League One');
await checkRoute('League Two public route', '/league2/matchups', 'League Two');

let leaseEvidence = 'Unverified';
if (!process.env.DATABASE_URL) {
  add('Unverified', 'Database and worker leases', 'DATABASE_URL is not present in this process; no database connection was attempted.');
} else {
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);
    const [jobs, watches] = await Promise.all([
      sql`SELECT job_type, count(*)::int AS count FROM projection_jobs WHERE state = 'running' AND lease_until > now() GROUP BY job_type ORDER BY job_type`,
      sql`SELECT materialization_lane, count(*)::int AS count FROM league_week_lineup_watch_states WHERE active_attempt_id IS NOT NULL AND lease_expires_at > now() GROUP BY materialization_lane ORDER BY materialization_lane`,
    ]);
    leaseEvidence = 'Healthy';
    add('Healthy', 'Database and worker leases', `Active job leases: ${jobs.map((row) => `${row.job_type}=${row.count}`).join(', ') || 'none'}; active lineup leases: ${watches.map((row) => `${row.materialization_lane}=${row.count}`).join(', ') || 'none'}.`);
  } catch {
    add('Unverified', 'Database and worker leases', 'Read-only lease evidence unavailable.');
  }
}

const otherFeatureWorktrees = worktrees.filter((item) => resolve(item.worktree) !== root && item.branch !== 'refs/heads/main');
const ownershipGaps = [];
if (openPullRequests === null) ownershipGaps.push('open pull request visibility');
else if (openPullRequests.length) ownershipGaps.push(`${openPullRequests.length} open pull request(s)`);
if (!worktreeResult.ok) ownershipGaps.push('worktree visibility');
else if (otherFeatureWorktrees.length) ownershipGaps.push(`${otherFeatureWorktrees.length} other feature worktree(s)`);
if (!vercelVerified) ownershipGaps.push('Vercel deployment evidence');
if (sourceEvidence !== 'Healthy') ownershipGaps.push('Vercel source repository, branch, and SHA evidence');
if (leaseEvidence !== 'Healthy') ownershipGaps.push('database lease evidence');

if (ownershipGaps.length) {
  add('Unverified', 'Release ownership', `No competing owner observed in the accessible evidence, but ownership remains Unverified because of: ${ownershipGaps.join('; ')}. This does not establish whether another chat exists.`);
} else {
  add('Healthy', 'Release ownership', 'No competing owner observed in accessible GitHub, worktree, Vercel, and database lease evidence. This does not establish whether another chat exists.');
}

console.log('\nLeague One Doctor\n');
for (const result of results) console.log(`[${result.status}] ${result.area}: ${result.detail}`);
const totals = Object.fromEntries(['Healthy', 'Unhealthy', 'Unverified', 'Not applicable'].map((status) => [status, results.filter((item) => item.status === status).length]));
console.log(`\nTotals: ${totals.Healthy} Healthy, ${totals.Unhealthy} Unhealthy, ${totals.Unverified} Unverified, ${totals['Not applicable']} Not applicable.`);
if (totals.Unhealthy) process.exitCode = 1;
