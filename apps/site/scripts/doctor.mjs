import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const canonicalRepository = 'clawmachinejed/league-one-audit';
const productionUrl = 'https://www.league1fantasy.com';
const expectedProject = 'league_one_fantasy';
const expectedScope = 'robert-finchums-projects';
const results = [];

function add(status, area, detail) {
  results.push({ status, area, detail: String(detail).replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, '[redacted-database-url]') });
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
else add(origin.ok ? 'Unhealthy' : 'Unverified', 'Repository identity', origin.ok ? `Expected ${canonicalRepository}; found ${normalizeOrigin(origin.stdout) || 'none'}.` : origin.stderr || 'Git remote unavailable.');

const nodeMajor = Number(process.versions.node.split('.')[0]);
add(nodeMajor === 24 ? 'Healthy' : 'Unhealthy', 'Node.js', `${process.version}; package requires ${packageJson.engines?.node ?? 'an unspecified version'}.`);
const pnpmEntrypoint = process.env.npm_execpath;
const pnpmVersion = pnpmEntrypoint ? run(process.execPath, [pnpmEntrypoint, '--version']) : run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--version']);
add(pnpmVersion.ok && pnpmVersion.stdout === '11.19.0' ? 'Healthy' : pnpmVersion.ok ? 'Unhealthy' : 'Unverified', 'pnpm', pnpmVersion.ok ? `${pnpmVersion.stdout}; package requires 11.19.0.` : pnpmVersion.stderr || 'pnpm unavailable.');

const rootLock = resolve(root, 'pnpm-lock.yaml');
const installedLock = resolve(root, 'node_modules/.pnpm/lock.yaml');
if (!existsSync(installedLock)) add('Unhealthy', 'Dependencies', 'node_modules is not installed; run pnpm install --frozen-lockfile.');
else add(hashFile(rootLock) === hashFile(installedLock) ? 'Healthy' : 'Unhealthy', 'Dependencies', hashFile(rootLock) === hashFile(installedLock) ? 'Installed lockfile matches pnpm-lock.yaml.' : 'Installed lockfile differs from pnpm-lock.yaml.');

const currentBranch = run('git', ['branch', '--show-current']);
const currentStatus = run('git', ['status', '--porcelain']);
add(currentStatus.ok && !currentStatus.stdout ? 'Healthy' : currentStatus.ok ? 'Unhealthy' : 'Unverified', 'Current worktree', currentStatus.ok ? `${currentBranch.stdout || 'detached HEAD'}; ${currentStatus.stdout ? 'uncommitted changes present' : 'clean'}.` : currentStatus.stderr);

const worktreeResult = run('git', ['worktree', 'list', '--porcelain']);
let worktrees = [];
if (worktreeResult.ok) {
  worktrees = parseWorktrees(worktreeResult.stdout);
  add('Healthy', 'Worktrees', `${worktrees.length} observed: ${worktrees.map((item) => `${item.branch?.replace('refs/heads/', '') || 'detached'} at ${item.worktree}`).join('; ')}`);
} else add('Unverified', 'Worktrees', worktreeResult.stderr || 'Unable to list worktrees.');

const mainWorktree = worktrees.find((item) => item.branch === 'refs/heads/main');
let mainClean = false;
let remoteMainSha = '';
let localMainSha = '';
if (mainWorktree) {
  const mainStatus = run('git', ['-C', mainWorktree.worktree, 'status', '--porcelain']);
  const localMain = run('git', ['rev-parse', 'refs/heads/main']);
  const remoteMain = run('git', ['ls-remote', 'origin', 'refs/heads/main'], root, 30_000);
  mainClean = mainStatus.ok && !mainStatus.stdout;
  localMainSha = localMain.stdout;
  remoteMainSha = remoteMain.ok ? remoteMain.stdout.split(/\s+/)[0] : '';
  if (!mainClean) add('Unhealthy', 'Primary main checkout', 'Primary main worktree has uncommitted changes.');
  else if (!remoteMain.ok) add('Unverified', 'Primary main alignment', remoteMain.stderr || 'Remote main unavailable.');
  else add(localMainSha === remoteMainSha ? 'Healthy' : 'Unhealthy', 'Primary main alignment', localMainSha === remoteMainSha ? `Clean and aligned at ${localMainSha}.` : `Local ${localMainSha}; GitHub ${remoteMainSha}.`);
} else add('Unverified', 'Primary main checkout', 'No main worktree was observed.');

const ghAuth = run('gh', ['auth', 'status', '--active']);
if (!ghAuth.ok) add('Unverified', 'GitHub authentication', ghAuth.stderr || 'GitHub CLI authentication unavailable.');
let openPullRequests = null;
if (ghAuth.ok) {
  const repo = run('gh', ['repo', 'view', canonicalRepository, '--json', 'nameWithOwner,defaultBranchRef,viewerPermission']);
  try {
    const value = JSON.parse(repo.stdout);
    const matches = value.nameWithOwner?.toLowerCase() === canonicalRepository && value.defaultBranchRef?.name === 'main';
    add(matches ? 'Healthy' : 'Unhealthy', 'GitHub access', matches ? `${value.viewerPermission} access; default branch main.` : 'Repository or default branch differs from the canonical identity.');
  } catch {
    add('Unverified', 'GitHub access', repo.stderr || 'Could not parse repository metadata.');
  }
  const prs = run('gh', ['pr', 'list', '--repo', canonicalRepository, '--state', 'open', '--json', 'number,url,headRefName,isDraft,author,updatedAt']);
  try {
    openPullRequests = JSON.parse(prs.stdout);
    add('Healthy', 'Open pull requests', openPullRequests.length ? `${openPullRequests.length} observed: ${openPullRequests.map((pr) => `#${pr.number} ${pr.headRefName}`).join(', ')}` : 'None observed.');
  } catch {
    add('Unverified', 'Open pull requests', prs.stderr || 'Could not parse pull requests.');
  }
  const runs = run('gh', ['run', 'list', '--repo', canonicalRepository, '--branch', 'main', '--limit', '10', '--json', 'headSha,status,conclusion,url,workflowName']);
  try {
    const active = JSON.parse(runs.stdout).filter((item) => item.status !== 'completed');
    add('Healthy', 'GitHub Actions', active.length ? `${active.length} active main run(s) observed.` : 'No active main run observed; recent-run visibility confirmed.');
  } catch {
    add('Unverified', 'GitHub Actions', runs.stderr || 'Could not parse workflow runs.');
  }
}

const linkCandidates = [resolve(root, '.vercel/project.json'), resolve(root, 'apps/site/.vercel/project.json')];
const linkPath = linkCandidates.find(existsSync);
if (linkPath) {
  try {
    const link = JSON.parse(readFileSync(linkPath, 'utf8'));
    add(link.projectName === expectedProject ? 'Healthy' : 'Unhealthy', 'Vercel local linkage', link.projectName === expectedProject ? `${expectedScope}/${expectedProject}` : `Expected ${expectedProject}; found ${link.projectName || 'unknown'}.`);
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
if (!vercelVersion.ok) add('Unverified', 'Vercel authentication and deployment', vercelVersion.stderr || 'Vercel CLI unavailable.');
else {
  const whoami = run(vercelCommand, [...vercelPrefix, 'whoami']);
  const inspect = run(vercelCommand, [...vercelPrefix, 'inspect', productionUrl, '--scope', expectedScope, '--json'], resolve(root, 'apps/site'), 45_000);
  try {
    const deployment = JSON.parse(inspect.stdout);
    vercelVerified = whoami.ok && deployment.name === expectedProject && deployment.target === 'production' && deployment.readyState === 'READY' && deployment.aliases?.includes('www.league1fantasy.com');
    add(vercelVerified ? 'Healthy' : 'Unhealthy', 'Vercel authentication and deployment', vercelVerified ? `${expectedProject} production is Ready and serves www.league1fantasy.com.` : whoami.stderr || inspect.stderr || 'Unexpected deployment metadata.');
    const deployedCrons = deployment.builds?.[0]?.config?.vercelConfig?.crons;
    const localCrons = JSON.parse(readFileSync(resolve(root, 'apps/site/vercel.json'), 'utf8')).crons;
    add(JSON.stringify(deployedCrons) === JSON.stringify(localCrons) ? 'Healthy' : 'Unhealthy', 'Cron declarations', JSON.stringify(deployedCrons) === JSON.stringify(localCrons) ? 'The production deployment carries the three tracked every-minute schedules.' : 'Production and tracked cron declarations differ.');
  } catch {
    add('Unverified', 'Vercel authentication and deployment', inspect.stderr || 'Could not parse deployment metadata.');
    add('Unverified', 'Cron declarations', 'Remote cron configuration could not be compared.');
  }
}
add('Unverified', 'Vercel production Git SHA', 'The installed CLI deployment payload does not expose Git source metadata; verify the exact SHA in the authenticated Vercel deployment view before implementation or release.');

async function checkRoute(area, path, marker) {
  try {
    const response = await fetch(`${productionUrl}${path}`, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    const body = (await response.text()).slice(0, 1_000_000);
    add(response.ok && body.includes(marker) ? 'Healthy' : 'Unhealthy', area, `HTTP ${response.status}; ${marker} marker ${body.includes(marker) ? 'present' : 'missing'}.`);
  } catch (error) {
    add('Unverified', area, error instanceof Error ? error.message : 'Request failed.');
  }
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
  } catch (error) {
    add('Unverified', 'Database and worker leases', error instanceof Error ? error.message : 'Read-only lease query failed.');
  }
}

const otherFeatureWorktrees = worktrees.filter((item) => resolve(item.worktree) !== root && item.branch !== 'refs/heads/main');
if (openPullRequests?.length === 0 && otherFeatureWorktrees.length === 0) {
  const gaps = [];
  if (!vercelVerified) gaps.push('Vercel');
  if (leaseEvidence !== 'Healthy') gaps.push('database lease');
  add('Healthy', 'Release ownership', `No competing owner observed in accessible GitHub and worktree evidence.${gaps.length ? ` ${gaps.join(' and ')} evidence is Unverified.` : ''} This does not establish whether another chat exists.`);
} else {
  add('Healthy', 'Release ownership', 'Potential activity is listed above; inspect it before claiming release ownership. This does not establish whether another chat exists.');
}

console.log('\nLeague One Doctor\n');
for (const result of results) console.log(`[${result.status}] ${result.area}: ${result.detail}`);
const totals = Object.fromEntries(['Healthy', 'Unhealthy', 'Unverified', 'Not applicable'].map((status) => [status, results.filter((item) => item.status === status).length]));
console.log(`\nTotals: ${totals.Healthy} Healthy, ${totals.Unhealthy} Unhealthy, ${totals.Unverified} Unverified, ${totals['Not applicable']} Not applicable.`);
if (totals.Unhealthy) process.exitCode = 1;
