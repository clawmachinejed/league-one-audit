import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "yaml";

const root = process.cwd();
const outDir = path.join(root, "audit");
fs.mkdirSync(outDir, { recursive: true });

function run(name, cmd, args) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return { name, status: r.status === 0 ? "pass" : "fail" };
}

function maybe(name, script) {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  return pkg.scripts && pkg.scripts[script]
    ? run(name, "pnpm", [script])
    : { name, status: "skip" };
}

function walk(d) {
  const out = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (
      [".git", "node_modules", ".next", "coverage", "dist", ".turbo"].some(
        (s) => e.name.startsWith(s),
      )
    )
      continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const contractPath = path.join(root, "audit/acceptance-contract.yml");
const contract = yaml.parse(fs.readFileSync(contractPath, "utf8"));

const pipeline = [];
pipeline.push(maybe("format", "format:check"));
pipeline.push(maybe("lint", "lint"));
pipeline.push(maybe("typecheck", "typecheck"));
pipeline.push(run("build", "pnpm", ["build"]));
pipeline.push(maybe("unit", "test"));
pipeline.push(maybe("e2e", "test:e2e"));
pipeline.push(maybe("a11y", "a11y"));

const checks = [];
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

// BUILD-001
const ruleBuild = contract.rules.find((r) => r.id === "BUILD-001");
if (ruleBuild) {
  const passPkgMgr = (pkg.packageManager || "").startsWith("pnpm@9");
  const passNode = (pkg.engines?.node || "").includes(">=20");
  const passType =
    pipeline.find((p) => p.name === "typecheck")?.status !== "fail";
  const passBuild = pipeline.find((p) => p.name === "build")?.status !== "fail";
  checks.push({
    id: "BUILD-001",
    pass: passPkgMgr && passNode && passType && passBuild,
    notes:
      "packageManager: pnpm@9, engines.node: >=20 <21, typecheck/build must pass",
  });
}

// STRUCT-002
const ruleStruct = contract.rules.find((r) => r.id === "STRUCT-002");
if (ruleStruct) {
  const files = walk(".");
  const seen = new Set();
  let dup = false;
  for (const f of files) {
    const k = f.toLowerCase();
    if (seen.has(k)) {
      dup = true;
      break;
    }
    seen.add(k);
  }
  checks.push({
    id: "STRUCT-002",
    pass: !dup,
    notes: "No duplicate filenames (case-insensitive)",
  });
}

// A11Y-014
const ruleA11y = contract.rules.find((r) => r.id === "A11Y-014");
if (ruleA11y) {
  const cssPaths = (ruleA11y.scope?.code_paths || []).filter((p) =>
    p.endsWith("globals.css"),
  );
  let cssOk = false;
  for (const cssPath of cssPaths) {
    if (fs.existsSync(cssPath)) {
      const css = fs.readFileSync(cssPath, "utf8");
      if (css.includes("@media (prefers-reduced-motion: reduce)")) {
        cssOk = true;
        break;
      }
    }
  }
  function grepAriaLive() {
    const files = walk(".").filter((f) => /\.(tsx|jsx|ts|js)$/.test(f));
    return files.some((f) =>
      fs.readFileSync(f, "utf8").includes('aria-live="polite"'),
    );
  }
  const domOk = grepAriaLive();
  checks.push({
    id: "A11Y-014",
    pass: cssOk && domOk,
    notes: "Needs aria-live polite and reduced-motion CSS",
  });
}

let mode = null;
const modePath = path.join(outDir, "mode.txt");
if (fs.existsSync(modePath)) {
  const raw = fs.readFileSync(modePath, "utf8").trim();
  if (raw.startsWith("single-file:")) mode = raw;
}

const summary = {
  pipeline: Object.fromEntries(pipeline.map((p) => [p.name, p.status])),
  checks: Object.fromEntries(
    checks.map((c) => [c.id, c.pass ? "pass" : "fail"]),
  ),
  mode,
};

fs.writeFileSync(
  path.join(outDir, "audit.json"),
  JSON.stringify(
    {
      contractVersion: contract.version,
      summary,
      details: checks,
    },
    null,
    2,
  ),
);

console.log("\n=== AUDIT SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));

const failed =
  pipeline.some((p) => p.status === "fail") || checks.some((c) => !c.pass);
process.exit(failed ? 1 : 0);
