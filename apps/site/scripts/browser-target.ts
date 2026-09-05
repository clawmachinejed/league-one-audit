import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type LocalBrowserTarget = {
  mode: 'local';
  baseURL: string;
  siteDir: string;
  runId: string;
  source: ReturnType<typeof sourceIdentity>;
};

export type BrowserTarget = LocalBrowserTarget | { mode: 'explicit'; baseURL: string };

export const markerPath = '/_next/static/browser-verification.json';

function sourceIdentity(siteDir: string) {
  const git = (...args: string[]) => execFileSync('git', args, {
    cwd: siteDir, encoding: 'utf8', windowsHide: true,
  }).trim();
  const root = git('rev-parse', '--show-toplevel');
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  }).split('\0').filter(Boolean).sort();
  const digest = createHash('sha256');
  for (const file of files) {
    const path = join(root, file);
    const content = existsSync(path) ? readFileSync(path) : null;
    digest.update(JSON.stringify([file, content?.length ?? null]));
    if (content) digest.update(content);
  }
  return { gitSha: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain')), digest: digest.digest('hex') };
}

export function selectBrowserTarget(env: Record<string, string | undefined>, siteDir: string): BrowserTarget {
  const suppliedBaseUrl = env.BASE_URL?.trim();
  if (suppliedBaseUrl) return { mode: 'explicit', baseURL: suppliedBaseUrl };
  const port = env.PORT?.trim() || '3000';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('Local browser verification requires PORT to be an integer from 1 to 65535.');
  }
  return {
    mode: 'local', baseURL: `http://localhost:${port}`, siteDir: realpathSync(siteDir),
    runId: randomUUID(), source: sourceIdentity(siteDir),
  };
}

export function localBuildIdentity(target: LocalBrowserTarget) {
  const source = sourceIdentity(target.siteDir);
  if (JSON.stringify(source) !== JSON.stringify(target.source)) {
    throw new Error(`Local browser provenance failed: checkout changed during verification (${target.siteDir}). Rerun against a stable checkout.`);
  }
  return {
    runId: target.runId,
    checkout: realpathSync(target.siteDir),
    gitSha: source.gitSha,
    dirty: source.dirty,
    sourceDigest: source.digest,
    buildId: readFileSync(join(target.siteDir, '.next/BUILD_ID'), 'utf8').trim(),
  };
}

// Only the local Playwright build command writes this ignored build artifact.
// Regular builds and Vercel deployments never publish a verification marker.
export function writeLocalBuildMarker(target: LocalBrowserTarget) {
  const identity = localBuildIdentity(target);
  if (!identity.runId || !identity.buildId) throw new Error('Missing local browser run or build identity.');
  const staticDir = join(target.siteDir, '.next/static');
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(join(staticDir, 'browser-verification.json'), JSON.stringify(identity));
  return identity;
}

export function describeBrowserTarget(target: BrowserTarget) {
  const url = new URL(target.baseURL);
  const address = `${url.origin}${url.pathname}${url.search || url.hash ? ' (query/fragment omitted)' : ''}`;
  return `Browser target: ${address} | ${target.mode === 'local' ? 'fresh local production build' : 'explicit BASE_URL; local build provenance not asserted'}`;
}

export async function verifyBrowserTarget(target: BrowserTarget, report: (message: string) => void = console.log) {
  report(describeBrowserTarget(target));
  if (target.mode === 'explicit') return;

  const expected = localBuildIdentity(target);
  const failure = `Local browser provenance failed for ${target.baseURL}: expected this run's checkout and build. No browser feature tests were run.`;
  try {
    const response = await fetch(new URL(markerPath, target.baseURL), {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200) throw new Error(failure);
    const actual = await response.json();
    if (!expected.buildId || !actual || Object.entries(expected).some(([key, value]) => actual[key] !== value)) {
      throw new Error(failure);
    }
  } catch {
    throw new Error(failure);
  }
  report(`Local browser provenance verified: checkout=${expected.checkout} | Git SHA=${expected.gitSha} | ${expected.dirty ? 'working tree has changes' : 'clean working tree'} | build=${expected.buildId} | run=${expected.runId}`);
}
