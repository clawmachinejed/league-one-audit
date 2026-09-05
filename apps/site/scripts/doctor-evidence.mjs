const shaPattern = /^[a-f0-9]{40}$/;
const activeStatuses = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
const failedConclusions = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'neutral', 'skipped', 'stale', 'startup_failure']);

function result(status, reason, detail) {
  return { status, reason, detail };
}

export function evaluateWorkflowEvidence(command, expectedSha) {
  const unavailable = () => result('Unverified', 'unavailable', 'Workflow evidence unavailable or malformed.');
  if (!shaPattern.test(expectedSha ?? '') || !command?.ok) return unavailable();
  let runs;
  try {
    runs = JSON.parse(command.stdout);
  } catch {
    return unavailable();
  }
  if (!Array.isArray(runs) || runs.some(run => !run || typeof run.workflowName !== 'string')) return unavailable();
  const intended = runs.filter(run => run.workflowName === 'verify');
  if (!intended.length) return result('Unverified', 'absent', `No verify workflow evidence observed for ${expectedSha}.`);
  if (intended.some(run => !shaPattern.test(run.headSha ?? '') || !Number.isSafeInteger(run.databaseId) || run.databaseId <= 0)) return unavailable();
  const exact = intended.filter(run => run.headSha === expectedSha).sort((a, b) => b.databaseId - a.databaseId);
  if (!exact.length) return result('Unhealthy', 'wrong-commit', `Observed verify workflows belong to a different commit; expected ${expectedSha}.`);
  // A newer failed, cancelled, or active run must not be hidden by an older success.
  const latest = exact[0];
  if (activeStatuses.has(latest.status) && !latest.conclusion) return result('Unverified', 'running', `Latest verify workflow for ${expectedSha} is still running or waiting.`);
  if (latest.status !== 'completed') return unavailable();
  if (latest.conclusion === 'success') return result('Healthy', 'success', `Latest verify workflow succeeded for exact commit ${expectedSha}.`);
  if (failedConclusions.has(latest.conclusion)) return result('Unhealthy', 'failure', `Latest verify workflow for ${expectedSha} concluded ${latest.conclusion}.`);
  return unavailable();
}

// Recognize only existing server-rendered shell attributes, never arbitrary text.
// Tokenizing whole tags keeps marker-shaped strings inside attributes out; raw-text,
// comments, and inert subtrees cannot supply the shell's route identity.
function hasRouteMarkers(body, path, leagueName) {
  const rawText = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const stack = [];
  const openTags = new Map();
  let raw = null;
  let brand = false;
  let selector = false;
  let current = false;
  const tokens = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/iy;
  let cursor = 0;
  while (cursor < body.length) {
    let start = body.indexOf('<', cursor);
    if (raw) {
      const close = new RegExp(`</${raw}\\b`, 'ig');
      close.lastIndex = cursor;
      start = close.exec(body)?.index ?? -1;
    }
    if (start < 0) break;
    tokens.lastIndex = start;
    const match = tokens.exec(body);
    // Never resume searching inside a truncated/malformed opening tag or attribute.
    if (!match) return false;
    cursor = tokens.lastIndex;
    if (!match[1]) {
      if (!match[0].startsWith('<!--') && !/^<!doctype\s+html\s*>$/i.test(match[0])) return false;
      continue;
    }
    const tag = match[1].toLowerCase();
    const closing = match[0].startsWith('</');
    if (raw) {
      if (closing && tag === raw) raw = null;
      continue;
    }
    // HTML plaintext has no closing tag: everything after it is text.
    if (!closing && tag === 'plaintext') break;
    if (closing) {
      const index = openTags.get(tag);
      if (index !== undefined) {
        // Every entry is popped at most once; unmatched closes never scan depth.
        while (stack.length > index) {
          const item = stack.pop();
          if (item.previous === undefined) openTags.delete(item.tag);
          else openTags.set(item.tag, item.previous);
        }
      }
      continue;
    }
    if (rawText.has(tag)) { raw = tag; continue; }
    const attrs = new Map();
    const attributes = match[0].slice(tag.length + 1, -1);
    for (const attr of attributes.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const name = attr[1].toLowerCase();
      // Duplicate attributes are ambiguous evidence, regardless of browser recovery.
      if (attrs.has(name)) return false;
      attrs.set(name, attr[2] ?? attr[3] ?? attr[4] ?? '');
    }
    const inert = (stack.at(-1)?.inert ?? false) || ['template', 'noscript', 'svg', 'math'].includes(tag)
      || attrs.has('hidden') || attrs.has('inert') || attrs.get('aria-hidden') === 'true'
      || /(?:^|;)\s*(?:display\s*:\s*none|(?:content-)?visibility\s*:\s*(?:hidden|collapse))\b/i.test(attrs.get('style') ?? '');
    if (!inert) {
      if (tag === 'a' && attrs.get('href') === path) {
        brand ||= attrs.get('aria-label') === `${leagueName} home`;
        current ||= attrs.get('aria-current') === 'page';
      }
      selector ||= tag === 'button' && attrs.get('aria-label') === `Choose league, current ${leagueName}`;
    }
    if (!voidTags.has(tag)) {
      const previous = openTags.get(tag);
      openTags.set(tag, stack.length);
      stack.push({ tag, inert, previous });
    }
  }
  return brand && selector && current;
}

export function evaluateRouteEvidence(evidence, expectedUrl, leagueName) {
  const unavailable = () => result('Unverified', 'unavailable', 'Public route evidence unavailable or malformed.');
  if (!evidence?.available) return unavailable();
  let expected;
  let final;
  try {
    expected = new URL(expectedUrl);
    final = new URL(evidence.url);
  } catch {
    return unavailable();
  }
  if (!Number.isInteger(evidence.status) || evidence.status < 100 || evidence.status > 599 || typeof evidence.redirected !== 'boolean') return unavailable();
  if (evidence.redirected || (evidence.status >= 300 && evidence.status < 400)) return result('Unhealthy', 'redirect', 'Unexpected redirect; destination was not accepted.');
  if (final.origin !== expected.origin || final.pathname !== expected.pathname || final.href !== expected.href
    || final.username || final.password) return result('Unhealthy', 'wrong-url', 'Final URL, origin, or path differs from the expected public route.');
  if (evidence.status >= 500 || evidence.status === 429) return result('Unverified', 'unavailable', `Public route unavailable (HTTP ${evidence.status}).`);
  if (evidence.status < 200 || evidence.status >= 300) return result('Unhealthy', 'failure', `Public route returned HTTP ${evidence.status}.`);
  if (typeof evidence.body !== 'string' || typeof evidence.contentType !== 'string') return unavailable();
  if (evidence.contentType.split(';')[0].trim().toLowerCase() !== 'text/html'
    || !hasRouteMarkers(evidence.body, expected.pathname, leagueName)) return result('Unhealthy', 'marker-mismatch', 'Expected league and active route markup missing.');
  return result('Healthy', 'success', `HTTP ${evidence.status}; exact final URL and league route markup verified; no redirect.`);
}

export async function collectRouteEvidence(expectedUrl, { fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(expectedUrl, {
      method: 'GET', redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(15_000),
    });
    return {
      available: true, url: response.url, status: response.status, redirected: response.redirected,
      contentType: response.headers.get('content-type') ?? '',
      body: response.status >= 200 && response.status < 300 ? (await response.text()).slice(0, 1_000_000) : '',
    };
  } catch {
    // Error messages and response/redirect bodies can contain credentials.
    return { available: false };
  }
}

export function redactDoctorDetail(detail) {
  return String(detail)
    .replace(/(?:https?|postgres(?:ql)?):\/\/[^\s"'`<>]+/gi, '[redacted-url]')
    .replace(/\b(?:bearer|basic)\s+[^\s"'`,;]+/gi, '[redacted-authorization]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[redacted-token]')
    .replace(/(["']?(?:[\w-]*api[_-]?key|token|password|secret)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s"'`,;]+)/gi, '$1[redacted]');
}
