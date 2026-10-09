#!/usr/bin/env node
// Local path/checkpoint guard only. No network, database, dependency install, or Git writes.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, lstatSync, realpathSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const MANIFEST = "docs/aggregator-backend/data-backend-scope.json";
const POLICY_PATHS = new Set([
  "AGENTS.md", MANIFEST, "docs/aggregator-backend/data-backend-scope.md",
  "scripts/check-data-backend-scope.mjs", "docs/aggregator-backend/README.md",
  "docs/aggregator-backend/backend-build-plan.md",
  "docs/aggregator-backend/implementation/README.md",
  "docs/aggregator-backend/implementation/backlog.md",
]);
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(message); };
const text = (value) => typeof value === "string" && value.trim().length > 0;
function exactKeys(value, required, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("|") !== [...required].sort().join("|")) fail("Invalid " + label + " fields");
}
function validPath(path) {
  return text(path) && !isAbsolute(path) && !/[\\:\0\r\n]/.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== "..");
}
function git(root, args, accepted = [0]) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: null, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, windowsHide: true,
  });
  if (result.error || !accepted.includes(result.status)) {
    // Do not echo arbitrary Git stderr or repository content.
    fail("Git inspection failed: " + args[0] + " (exit " + result.status + ")");
  }
  return { bytes: result.stdout, status: result.status };
}
const gitText = (root, args) => git(root, args).bytes.toString("utf8").trim();
const gitPaths = (root, args) => git(root, args).bytes.toString("utf8").split("\0").filter(Boolean);
function validate(manifest) {
  exactKeys(manifest, ["version", "scope", "baselines", "allowedDataPaths", "allowedDataPatterns",
    "reviewedExtensions", "governanceChanges", "preservedCheckpoint"], "manifest");
  if (manifest.version !== 1 || manifest.scope !== "fantasy-football-data-backend-v1") fail("Unknown scope/version");
  for (const key of ["baselines", "allowedDataPaths", "allowedDataPatterns", "reviewedExtensions", "governanceChanges"]) {
    if (!Array.isArray(manifest[key])) fail("Invalid list: " + key);
  }
  if (!manifest.baselines.length) fail("No baseline");
  const baselineIds = new Set();
  const baselineNames = new Set();
  for (const entry of manifest.baselines) {
    exactKeys(entry, ["name", "sha"], "baseline");
    if (!text(entry.name) || !SHA.test(entry.sha) || baselineIds.has(entry.sha) || baselineNames.has(entry.name)) fail("Invalid/duplicate baseline");
    baselineIds.add(entry.sha); baselineNames.add(entry.name);
  }
  const paths = new Set();
  for (const path of manifest.allowedDataPaths) {
    if (!validPath(path) || POLICY_PATHS.has(path) || paths.has(path)) fail("Invalid/duplicate data path");
    paths.add(path);
  }
  const patterns = manifest.allowedDataPatterns.map((pattern) => {
    if (!text(pattern) || pattern.length > 1000 || !pattern.startsWith("^") || !pattern.endsWith("$")) fail("Unanchored/invalid data pattern");
    try { return new RegExp(pattern); } catch { fail("Invalid data pattern"); }
  });
  const extensions = new Map();
  for (const entry of manifest.reviewedExtensions) {
    exactKeys(entry, ["path", "resource", "purpose", "proof", "reviewer", "reviewReference"], "reviewed extension");
    if (!validPath(entry.path) || POLICY_PATHS.has(entry.path) || extensions.has(entry.path) ||
        !["resource", "purpose", "proof", "reviewer", "reviewReference"].every((key) => text(entry[key]))) fail("Invalid/duplicate reviewed extension");
    extensions.set(entry.path, entry);
  }
  const governance = new Map();
  for (const entry of manifest.governanceChanges) {
    exactKeys(entry, ["id", "purpose", "paths"], "governance declaration");
    if (!text(entry.id) || !text(entry.purpose) || governance.has(entry.id) || !Array.isArray(entry.paths) ||
        !entry.paths.length || new Set(entry.paths).size !== entry.paths.length ||
        entry.paths.some((path) => !POLICY_PATHS.has(path))) fail("Invalid governance declaration");
    governance.set(entry.id, new Set(entry.paths));
  }
  const checkpoint = manifest.preservedCheckpoint;
  exactKeys(checkpoint, ["base", "meaning", "files"], "preserved checkpoint");
  if (!baselineIds.has(checkpoint.base) || !text(checkpoint.meaning) || !Array.isArray(checkpoint.files)) fail("Invalid preserved checkpoint");
  const preserved = new Map();
  for (const entry of checkpoint.files) {
    exactKeys(entry, ["path", "sha256", "gitBlobOid"], "preserved file");
    if (!validPath(entry.path) || POLICY_PATHS.has(entry.path) || !HASH.test(entry.sha256) ||
        !SHA.test(entry.gitBlobOid) || preserved.has(entry.path)) fail("Invalid/duplicate preserved file");
    preserved.set(entry.path, entry);
  }
  return { patterns, extensions, governance, preserved };
}
function knownCommit(root, sha) {
  if (!SHA.test(sha)) fail("Base must be an explicit full lowercase Git SHA");
  if (gitText(root, ["rev-parse", "--verify", sha + "^{commit}"]) !== sha) fail("Unknown base commit");
}
const ancestor = (root, older, newer) => git(root, ["merge-base", "--is-ancestor", older, newer], [0, 1]).status === 0;
function selectBase(root, manifest, options) {
  const profile = options.profile ?? "data-backend";
  const entries = manifest.baselines.filter((entry) => entry.name === profile);
  if (entries.length !== 1) fail("Unknown or ambiguous workstream profile");
  const base = entries[0].sha;
  if (options.base && options.base !== base) fail("--base must equal the configured, reviewed base for this profile; arbitrary HEAD overrides are forbidden");
  knownCommit(root, base);
  if (!ancestor(root, base, gitText(root, ["rev-parse", "HEAD"]))) fail("Configured base is not an ancestor of HEAD");
  return base;
}
function treeEntries(root, ref) {
  const entries = new Map();
  for (const record of gitPaths(root, ["ls-tree", "-r", "-z", ref, "--"])) {
    const match = /^([0-9]+) \S+ ([a-f0-9]{40})\t(.+)$/.exec(record);
    if (match) entries.set(match[3], match[1] + " " + match[2]);
  }
  return entries;
}
function indexEntries(root) {
  const entries = new Map();
  for (const record of gitPaths(root, ["ls-files", "--stage", "-z"])) {
    const match = /^([0-9]+) ([a-f0-9]{40}) ([0-3])\t(.+)$/.exec(record);
    if (!match) fail("Unrecognized index entry");
    entries.set(match[4], match[3] === "0" && !entries.has(match[4]) ? match[1] + " " + match[2] : "unmerged");
  }
  return entries;
}
function safeBytes(root, path) {
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (!validPath(path) || isAbsolute(rel) || rel.startsWith("..")) fail("Unsafe repository path");
  try {
    if (!lstatSync(absolute).isFile()) return null; // Reject directories and symlinks.
    const resolved = realpathSync.native(absolute);
    const resolvedRelative = relative(realpathSync.native(root), resolved);
    if (isAbsolute(resolvedRelative) || resolvedRelative.startsWith("..")) fail("Path escapes repository");
    return readFileSync(absolute);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function check(root, options = {}) {
  const observedRoot = realpathSync.native(gitText(root, ["rev-parse", "--show-toplevel"]));
  if (relative(observedRoot, realpathSync.native(root)) !== "") fail("Checker must target a repository root: observed " + observedRoot + ", requested " + realpathSync.native(root));
  const manifestBytes = safeBytes(root, MANIFEST);
  if (!manifestBytes) fail("Missing regular-file scope manifest");
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString("utf8")); } catch { fail("Malformed JSON scope manifest"); }
  const policy = validate(manifest);
  const base = selectBase(root, manifest, options);
  const declared = options.governance ? policy.governance.get(options.governance) : null;
  if (options.governance && !declared) fail("Unknown governance-change declaration");
  const preserving = base === manifest.preservedCheckpoint.base;
  const changed = new Set([
    ...gitPaths(root, ["diff", "--name-only", "-z", "--no-renames", base, "HEAD", "--"]),
    ...gitPaths(root, ["diff", "--name-only", "-z", "--no-renames", base, "--"]),
    ...gitPaths(root, ["diff", "--cached", "--name-only", "-z", "--no-renames", base, "--"]),
    ...gitPaths(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ...(preserving ? policy.preserved.keys() : []),
  ]);
  const baseEntries = preserving ? treeEntries(root, base) : new Map();
  const headEntries = preserving ? treeEntries(root, "HEAD") : new Map();
  const currentIndex = preserving ? indexEntries(root) : new Map();
  const rows = [];
  for (const path of [...changed].sort()) {
    let kind = "rejected";
    let reason = "outside declared data paths; name the resource, necessary file purpose and objective proof for independent review";
    if (!validPath(path)) {
      reason = "invalid repository-relative path";
    } else if (POLICY_PATHS.has(path)) {
      if (declared?.has(path)) { kind = "governance"; reason = "declared policy edit; independent review still required"; }
      else reason = "policy/notice changed; requires an explicit --governance-change declaration";
    } else {
      const preserved = preserving ? policy.preserved.get(path) : null;
      const bytes = preserved ? safeBytes(root, path) : null;
      const acceptedGitStates = preserved ? new Set([baseEntries.get(path), "100644 " + preserved.gitBlobOid]) : null;
      const committedAndIndexMatch = !preserved ||
        (acceptedGitStates.has(headEntries.get(path)) && acceptedGitStates.has(currentIndex.get(path)));
      if (preserved && bytes && digest(bytes) === preserved.sha256 && committedAndIndexMatch) {
        kind = "preserved"; reason = "exact existing checkpoint; preservation is not acceptance";
      } else if (policy.extensions.has(path)) {
        kind = "reviewed-extension"; reason = policy.extensions.get(path).purpose;
      } else if (preserved) {
        reason = "preserved checkpoint working/committed/index content or mode changed or removed; review this exact file before further work";
      } else if (path.startsWith("apps/site/lib/accounts/")) {
        reason = "mixed account/provider code requires an exact-file reviewed data extension";
      } else if (manifest.allowedDataPaths.includes(path) || policy.patterns.some((pattern) => pattern.test(path))) {
        kind = "data-path"; reason = "path eligible; semantic scope and evidence require review";
      }
    }
    rows.push({ path, kind, reason });
  }
  return { base, head: gitText(root, ["rev-parse", "HEAD"]), rows, ok: rows.every((row) => row.kind !== "rejected") };
}
function selfTest() {
  const temporaryRoot = realpathSync.native(tmpdir());
  const root = mkdtempSync(join(temporaryRoot, "data scope guard "));
  let total = 0;
  const run = (name, action) => { action(); total++; console.log("PASS " + name); };
  try {
    const put = (path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
    git(root, ["init", "-q"]);
    git(root, ["config", "core.autocrlf", "false"]);
    put("apps/site/components/existing account.tsx", "original\n");
    put("apps/site/lib/league-administration/store.ts", "original\n");
    git(root, ["add", "."]);
    git(root, ["-c", "user.name=Scope fixture", "-c", "user.email=scope-fixture@example.invalid", "commit", "-qm", "fixture"]);
    const base = gitText(root, ["rev-parse", "HEAD"]);
    const checkpointPath = "apps/site/components/existing account.tsx";
    put(checkpointPath, "preserved\n");
    const manifest = {
      version: 1, scope: "fantasy-football-data-backend-v1",
      baselines: [{ name: "data-backend", sha: base }],
      allowedDataPaths: [], allowedDataPatterns: ["^apps/site/lib/league-administration/[a-z-]+\\.ts$"],
      reviewedExtensions: [],
      governanceChanges: [{ id: "fixture-governance", purpose: "Test policy handling", paths: [...POLICY_PATHS] }],
      preservedCheckpoint: { base, meaning: "Preservation only", files: [{
        path: checkpointPath, sha256: digest(readFileSync(join(root, checkpointPath))),
        gitBlobOid: gitText(root, ["hash-object", "--", checkpointPath]),
      }] },
    };
    const save = () => put(MANIFEST, JSON.stringify(manifest));
    save();
    const inspect = () => check(root, { governance: "fixture-governance" });
    const remove = (path) => rmSync(join(root, path));
    run("preserved checkpoint and repository path with spaces", () => assert.equal(inspect().ok, true));
    run("policy changes rejected without declaration", () => assert.equal(check(root).ok, false));
    run("unknown declaration rejected", () => assert.throws(() => check(root, { governance: "anything" }), /Unknown governance/));
    run("unknown full base rejected", () => assert.throws(() => check(root, { base: "f".repeat(40) })));
    run("short base rejected", () => assert.throws(() => check(root, { base: base.slice(0, 7) }), /configured, reviewed base/));
    run("untracked data path admitted", () => {
      put("apps/site/lib/league-administration/new-reader.ts", "reader\n");
      assert.equal(inspect().ok, true); remove("apps/site/lib/league-administration/new-reader.ts");
    });
    run("new UI path rejected even with governance declaration", () => {
      put("apps/site/components/new page.tsx", "UI\n");
      assert.equal(inspect().ok, false); remove("apps/site/components/new page.tsx");
    });
    run("mixed account ingestion needs exact reviewed extension", () => {
      put("apps/site/lib/accounts/discovery.ts", "source\n");
      assert.equal(inspect().ok, false);
      manifest.reviewedExtensions.push({ path: "apps/site/lib/accounts/discovery.ts", resource: "league discovery",
        purpose: "Fixture exact-file adapter reuse", proof: "Fixture test", reviewer: "Fixture reviewer", reviewReference: "fixture-only" });
      save(); assert.equal(inspect().ok, true);
      manifest.reviewedExtensions = []; save(); remove("apps/site/lib/accounts/discovery.ts");
    });
    run("modified checkpoint rejected", () => {
      put(checkpointPath, "modified\n"); assert.equal(inspect().ok, false); put(checkpointPath, "preserved\n");
    });
    run("deleted checkpoint rejected", () => {
      remove(checkpointPath); assert.equal(inspect().ok, false); put(checkpointPath, "preserved\n");
    });
    run("staged checkpoint mismatch cannot hide behind restored worktree", () => {
      put(checkpointPath, "staged drift\n"); git(root, ["add", "--", checkpointPath]);
      put(checkpointPath, "preserved\n"); assert.equal(inspect().ok, false);
      git(root, ["reset", "-q", "HEAD", "--", checkpointPath]);
    });
    run("exact preserved staged content admitted", () => {
      git(root, ["add", "--", checkpointPath]); assert.equal(inspect().ok, true);
      git(root, ["reset", "-q", "HEAD", "--", checkpointPath]);
    });
    run("checkpoint restored to base cannot disappear from inspection", () => {
      put(checkpointPath, "original\n"); assert.equal(inspect().ok, false); put(checkpointPath, "preserved\n");
    });
    run("committed checkpoint drift cannot hide behind restored working bytes", () => {
      put(checkpointPath, "committed drift\n"); git(root, ["add", "--", checkpointPath]);
      git(root, ["-c", "user.name=Scope fixture", "-c", "user.email=scope-fixture@example.invalid", "commit", "-qm", "drift"]);
      put(checkpointPath, "preserved\n"); assert.equal(inspect().ok, false);
      git(root, ["reset", "--soft", base]); git(root, ["reset", "-q", "HEAD", "--", checkpointPath]);
    });
    run("committed exact checkpoint is preserved", () => {
      git(root, ["add", "--", checkpointPath]);
      git(root, ["-c", "user.name=Scope fixture", "-c", "user.email=scope-fixture@example.invalid", "commit", "-qm", "exact checkpoint"]);
      assert.equal(inspect().ok, true);
      git(root, ["reset", "--soft", base]); git(root, ["reset", "-q", "HEAD", "--", checkpointPath]);
    });
    run("committed out-of-scope path cannot hide behind staged restoration", () => {
      const path = "apps/site/components/committed drift.tsx";
      put(path, "drift\n"); git(root, ["add", "--", path]);
      git(root, ["-c", "user.name=Scope fixture", "-c", "user.email=scope-fixture@example.invalid", "commit", "-qm", "new UI"]);
      git(root, ["rm", "-q", "--", path]); assert.equal(inspect().ok, false);
      git(root, ["reset", "--soft", base]);
    });
    run("tracked checkpoint index deletion is rejected", () => {
      git(root, ["rm", "--cached", "-q", "--", checkpointPath]); assert.equal(inspect().ok, false);
      git(root, ["reset", "-q", "HEAD", "--", checkpointPath]);
    });
    run("renamed out-of-scope file rejected", () => {
      put("apps/site/components/renamed.tsx", "preserved\n"); remove(checkpointPath);
      assert.equal(inspect().ok, false); remove("apps/site/components/renamed.tsx"); put(checkpointPath, "preserved\n");
    });
    run("malformed manifest fails closed", () => {
      put(MANIFEST, "{"); assert.throws(inspect, /Malformed JSON/); save();
    });
    run("unknown manifest field fails closed", () => {
      put(MANIFEST, JSON.stringify({ ...manifest, bypass: true })); assert.throws(inspect, /Invalid manifest/); save();
    });
    run("governance cannot grant application paths", () => {
      manifest.governanceChanges[0].paths.push(checkpointPath); save(); assert.throws(inspect, /Invalid governance/);
      manifest.governanceChanges[0].paths.pop(); save();
    });
    run("invalid regex fails closed", () => {
      manifest.allowedDataPatterns.push("^[bad$"); save(); assert.throws(inspect, /Invalid data pattern/);
      manifest.allowedDataPatterns.pop(); save();
    });
    run("arbitrary later HEAD cannot skip prior scope changes", () => {
      git(root, ["-c", "user.name=Scope fixture", "-c", "user.email=scope-fixture@example.invalid", "commit", "--allow-empty", "-qm", "later"]);
      const later = gitText(root, ["rev-parse", "HEAD"]);
      assert.throws(() => check(root, { base: later, governance: "fixture-governance" }), /arbitrary HEAD/);
    });
    console.log("Self-test: " + total + " passed; isolated local fixtures only.");
  } finally {
    const resolved = realpathSync.native(root);
    if (dirname(resolved) !== temporaryRoot || !resolved.startsWith(join(temporaryRoot, "data scope guard "))) fail("Refusing unsafe fixture cleanup");
    rmSync(resolved, { recursive: true, force: true });
  }
}
function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--self-test") return selfTest();
  if (args.length === 1 && args[0] === "--help") {
    console.log("node scripts/check-data-backend-scope.mjs [--profile NAME] [--base CONFIGURED_FULL_SHA] [--governance-change DECLARED_ID]\nnode scripts/check-data-backend-scope.mjs --self-test");
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = { "--base": "base", "--profile": "profile", "--governance-change": "governance" }[args[i]];
    if (!key || !args[i + 1] || options[key]) fail("Unknown, missing, or duplicate argument; use --help");
    options[key] = args[i + 1];
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = check(root, options);
  console.log("Data scope base: " + result.base + "\nHEAD: " + result.head);
  for (const row of result.rows) console.log(row.kind.toUpperCase() + " " + JSON.stringify(row.path) + " — " + row.reason);
  const counts = {};
  for (const row of result.rows) counts[row.kind] = (counts[row.kind] || 0) + 1;
  console.log((result.ok ? "PASS" : "FAIL") + " path/checkpoint check: " + JSON.stringify(counts));
  console.log("Not proof of semantic scope, reviewer approval, data correctness, SQL qualification, or release authority. Ignored files are not inspected.");
  if (!result.ok) process.exitCode = 1;
}
try { main(); } catch (error) { console.error("FAIL scope check: " + error.message); process.exitCode = 1; }
