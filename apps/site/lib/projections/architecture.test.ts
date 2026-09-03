import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type ModuleImport = Readonly<{
  line: number;
  specifier: string;
  typeOnly: boolean;
  resolved: string | null;
}>;

type SourceModule = Readonly<{
  absolutePath: string;
  relativePath: string;
  source: string;
  sourceFile: ts.SourceFile;
  imports: readonly ModuleImport[];
}>;

const projectionRoot = dirname(fileURLToPath(import.meta.url));
const libRoot = dirname(projectionRoot);
const siteRoot = dirname(libRoot);

function slashPath(path: string): string {
  return path.split(sep).join('/');
}

function displayPath(path: string): string {
  return slashPath(relative(siteRoot, path));
}

function isProductionTypeScript(path: string): boolean {
  const name = slashPath(path);
  return /\.tsx?$/u.test(name)
    && !/\.(?:test|spec|integration)\.tsx?$/u.test(name)
    && !/(?:^|\/)[^/]*(?:fixtures?|test-support)\.tsx?$/u.test(name)
    && !name.endsWith('.d.ts');
}

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.next' || entry.name === 'node_modules' || entry.name === 'coverage') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (isProductionTypeScript(path)) files.push(resolve(path));
  }
  return files;
}

const productionPaths = [
  ...walk(join(siteRoot, 'app')),
  ...walk(join(siteRoot, 'components')),
  ...walk(libRoot),
].sort();
const productionPathSet = new Set(productionPaths);

function resolveModule(from: string, specifier: string): string | null {
  let candidate: string;
  if (specifier.startsWith('@/')) candidate = resolve(siteRoot, specifier.slice(2));
  else if (specifier.startsWith('.')) candidate = resolve(dirname(from), specifier);
  else return null;

  const extension = extname(candidate);
  const candidates = extension
    ? [candidate, candidate.replace(/\.(?:js|jsx|mjs|cjs)$/u, '.ts'), candidate.replace(/\.(?:js|jsx|mjs|cjs)$/u, '.tsx')]
    : [candidate, `${candidate}.ts`, `${candidate}.tsx`, join(candidate, 'index.ts'), join(candidate, 'index.tsx')];
  return candidates.find((path) => existsSync(path)) ?? null;
}

function importIsTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false;
  return clause.namedBindings.elements.length > 0
    && clause.namedBindings.elements.every((element) => element.isTypeOnly);
}

function exportIsTypeOnly(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  return Boolean(node.exportClause
    && ts.isNamedExports(node.exportClause)
    && node.exportClause.elements.length > 0
    && node.exportClause.elements.every((element) => element.isTypeOnly));
}

function importsFor(absolutePath: string, sourceFile: ts.SourceFile): ModuleImport[] {
  const imports: ModuleImport[] = [];
  const add = (node: ts.Node, specifier: string, typeOnly: boolean) => {
    imports.push({
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      specifier,
      typeOnly,
      resolved: resolveModule(absolutePath, specifier),
    });
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node, node.moduleSpecifier.text, importIsTypeOnly(node));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node, node.moduleSpecifier.text, exportIsTypeOnly(node));
    } else if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])) {
      add(node, node.arguments[0].text, false);
    } else if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'require'
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])) {
      add(node, node.arguments[0].text, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

const modules = new Map<string, SourceModule>(productionPaths.map((absolutePath) => {
  const source = readFileSync(absolutePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    absolutePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  return [absolutePath, {
    absolutePath,
    relativePath: displayPath(absolutePath),
    source,
    sourceFile,
    imports: importsFor(absolutePath, sourceFile),
  }];
}));

function modulesIn(directory: string): SourceModule[] {
  const root = `${slashPath(resolve(directory))}/`;
  return [...modules.values()].filter((sourceModule) => slashPath(sourceModule.absolutePath).startsWith(root));
}

function location(sourceModule: SourceModule, line?: number): string {
  return line === undefined ? sourceModule.relativePath : `${sourceModule.relativePath}:${line}`;
}

function checkPattern(
  selected: readonly SourceModule[],
  pattern: RegExp,
  explanation: string,
): string[] {
  const violations: string[] = [];
  for (const sourceModule of selected) {
    pattern.lastIndex = 0;
    if (pattern.test(sourceModule.source)) violations.push(`${sourceModule.relativePath}: ${explanation}`);
  }
  return violations;
}

function expectNoViolations(rule: string, violations: readonly string[]): void {
  expect([...violations].sort(), `${rule}\n${[...violations].sort().join('\n')}`).toEqual([]);
}

function projectionSqlLiteralLines(sourceModule: SourceModule): number[] {
  const lines: number[] = [];
  const sql = /\b(?:SELECT\s+[\s\S]+?\s+FROM|INSERT\s+INTO|UPDATE\s+[A-Za-z_][A-Za-z0-9_]*\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX)|WITH\s+[A-Za-z_][A-Za-z0-9_]*\s+AS\s*\()/iu;
  const projectionTable = /\b(?:current_projection_snapshots|external_game_ids|external_scoring_entity_ids|game_state_observations|league_seasons|league_source_connections|league_week_expected_games|league_week_observations|leagues|nfl_games|official_player_point_observations|official_roster_point_observations|pregame_projection_baselines|pregame_projection_candidates|pregame_projection_runs|projection_jobs|projection_snapshots|scoring_entities|scoring_profiles)\b/iu;
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (ts.isStringLiteralLike(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) {
      text = `${node.head.text}${node.templateSpans.map((span) => span.literal.text).join('')}`;
    }
    if (text !== null && sql.test(text) && projectionTable.test(text)) {
      lines.push(sourceModule.sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceModule.sourceFile)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceModule.sourceFile);
  return [...new Set(lines)];
}

function isInside(path: string, directory: string): boolean {
  const normalizedPath = slashPath(resolve(path));
  const normalizedDirectory = `${slashPath(resolve(directory))}/`;
  return normalizedPath.startsWith(normalizedDirectory);
}

const domainModules = modulesIn(join(projectionRoot, 'domain'));
const portModules = modulesIn(join(projectionRoot, 'ports'));
const workerModules = modulesIn(join(projectionRoot, 'worker'));
const adapterModules = modulesIn(join(projectionRoot, 'adapters'));
const projectionModules = modulesIn(projectionRoot);
const neonRoot = join(projectionRoot, 'adapters', 'neon');
const runtimeRoot = join(projectionRoot, 'runtime');
const runtimePath = resolve(projectionRoot, 'runtime', 'projection-composition.ts');
const publicPayloadPath = resolve(libRoot, 'types.ts');
const providerIdentityPath = resolve(projectionRoot, 'shared', 'provider-identity.ts');
const domainSharedPaths = new Set([
  providerIdentityPath,
  resolve(projectionRoot, 'shared', 'stable-json.ts'),
  resolve(projectionRoot, 'shared', 'sha256.ts'),
]);

describe('projection architecture', () => {
  it('does not retain the superseded root projection pipeline', () => {
    const obsoleteModules = [
      'projection-scoring.ts',
      'matchup-projections.ts',
      'projection-slate.ts',
      'tank01.ts',
      'tank01-game-state.ts',
      'projection-window.ts',
      'live-projection.ts',
    ];
    expect(obsoleteModules.filter((path) => existsSync(resolve(libRoot, path)))).toEqual([]);
  });

  it('retains exactly one live formula, model declaration, and projected snapshot builder', () => {
    const productionSource = [...modules.values()].map((sourceModule) => sourceModule.source).join('\n');
    expect(productionSource.match(/function\s+calculateLiveProjection\s*\(/gu)).toHaveLength(1);
    expect(productionSource.match(/LIVE_PROJECTION_MODEL_VERSION\s*=\s*['"]clock-v1['"]/gu))
      .toHaveLength(1);
    expect(productionSource.match(/function\s+buildSnapshot\s*\(/gu)).toHaveLength(1);
  });

  it('retains one Tank01 projection-feed orchestration path', () => {
    const feed = modules.get(resolve(
      projectionRoot,
      'adapters',
      'tank01',
      'projection-feed.ts',
    ));
    expect(feed, 'The Tank01 projection-feed adapter must exist.').toBeDefined();
    expect(feed!.source.match(/const\s+getProjectionSlate\s*=/gu)).toHaveLength(1);
    expect(feed!.source).not.toMatch(/createTank01ProjectionFeed\b/u);
  });

  it('keeps the domain free of providers and infrastructure', () => {
    const violations: string[] = [];
    for (const sourceModule of domainModules) {
      if (/\b(?:sleeper|tank01|neon)\b/iu.test(sourceModule.source)) {
        violations.push(`${sourceModule.relativePath}: names a concrete provider`);
      }
      if (/\b(?:process\.env|import\.meta\.env|Deno\.env)\b/u.test(sourceModule.source)) {
        violations.push(`${sourceModule.relativePath}: reads environment configuration`);
      }
      if (/\b(?:fetch|XMLHttpRequest)\s*\(/u.test(sourceModule.source)) {
        violations.push(`${sourceModule.relativePath}: performs an HTTP request`);
      }
      if (/\.query\s*\(/u.test(sourceModule.source)) {
        violations.push(`${sourceModule.relativePath}: performs a database query`);
      }
      for (const dependency of sourceModule.imports) {
        const concreteExternal = /^(?:next(?:\/|$)|react(?:\/|$)|server-only$|node:)/u.test(dependency.specifier);
        const concreteLocal = dependency.resolved !== null
          && !domainSharedPaths.has(dependency.resolved)
          && !isInside(dependency.resolved, join(projectionRoot, 'domain'));
        if (concreteExternal || concreteLocal) {
          violations.push(`${location(sourceModule, dependency.line)}: imports ${dependency.specifier}`);
        }
      }
    }
    expectNoViolations('The domain may depend only on itself and explicitly allowed provider-neutral helpers.', violations);
  });

  it('keeps domain-shared helpers free of provider and infrastructure dependencies', () => {
    const violations: string[] = [];
    for (const path of domainSharedPaths) {
      const sourceModule = modules.get(path);
      if (!sourceModule) { violations.push(`${displayPath(path)}: required helper is missing`); continue; }
      for (const dependency of sourceModule.imports) {
        if (!dependency.resolved || !domainSharedPaths.has(dependency.resolved)) {
          violations.push(`${location(sourceModule, dependency.line)}: imports ${dependency.specifier}`);
        }
      }
      violations.push(...checkPattern([sourceModule],
        /\b(?:process\.env|import\.meta\.env|Deno\.env|fetch\s*\(|XMLHttpRequest|Date\.now|Math\.random|randomUUID)\b/u,
        'uses environment, HTTP, clock, or randomness'));
      violations.push(...checkPattern([sourceModule], /\.query\s*\(/u, 'queries a database'));
    }
    expectNoViolations('Domain-shared helpers must remain deterministic and infrastructure-free.', violations);
  });

  it('keeps ports declaration-only and dependent only on canonical types', () => {
    const violations: string[] = [];
    for (const sourceModule of portModules) {
      for (const dependency of sourceModule.imports) {
        if (!dependency.typeOnly) {
          violations.push(`${location(sourceModule, dependency.line)}: has runtime import ${dependency.specifier}`);
        }
        if (dependency.resolved) {
          const canonicalDependency = isInside(dependency.resolved, join(projectionRoot, 'domain'))
            || dependency.resolved === providerIdentityPath
            || isInside(dependency.resolved, join(projectionRoot, 'ports'))
            // MatchupsData is the stable public payload retained by the repository boundary.
            || dependency.resolved === publicPayloadPath;
          if (!canonicalDependency) {
            violations.push(`${location(sourceModule, dependency.line)}: imports noncanonical type ${dependency.specifier}`);
          }
        } else if (!dependency.specifier.startsWith('.')) {
          violations.push(`${location(sourceModule, dependency.line)}: imports package ${dependency.specifier}`);
        }
      }

      for (const statement of sourceModule.sourceFile.statements) {
        const ambientBrand = ts.isVariableStatement(statement)
          && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)
          && statement.declarationList.declarations.every((declaration) => declaration.initializer === undefined);
        const declarationOnly = ts.isImportDeclaration(statement)
          || ts.isInterfaceDeclaration(statement)
          || ts.isTypeAliasDeclaration(statement)
          || ts.isExportDeclaration(statement)
          || Boolean(ambientBrand);
        if (!declarationOnly) {
          const line = sourceModule.sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceModule.sourceFile)).line + 1;
          violations.push(`${location(sourceModule, line)}: contains runtime statement ${ts.SyntaxKind[statement.kind]}`);
        }
      }
    }
    expectNoViolations('Ports must contain contracts, branded declarations, and type-only imports.', violations);
  });

  it('keeps worker application code provider-neutral and deterministic', () => {
    const violations: string[] = [];
    const allowedRoots = [
      join(projectionRoot, 'domain'),
      join(projectionRoot, 'ports'),
      join(projectionRoot, 'shared'),
      join(projectionRoot, 'worker'),
    ];
    for (const sourceModule of workerModules) {
      for (const dependency of sourceModule.imports) {
        const allowedLocal = dependency.resolved !== null
          && (allowedRoots.some((root) => isInside(dependency.resolved!, root))
            || dependency.resolved === publicPayloadPath);
        if (!allowedLocal) {
          violations.push(`${location(sourceModule, dependency.line)}: imports ${dependency.specifier}`);
        }
      }
      violations.push(...checkPattern(
        [sourceModule],
        /\b(?:process\.env|import\.meta\.env|Deno\.env|globalThis\.fetch|Date\.now|Math\.random|randomUUID|crypto\.randomUUID)\b/u,
        'uses runtime-owned environment, client, clock, or randomness',
      ));
      violations.push(...checkPattern([sourceModule], /new\s+Date\s*\(\s*\)/u, 'reads the system clock'));
      violations.push(...checkPattern([sourceModule], /\bfetch\s*\(/u, 'uses a provider client directly'));
      violations.push(...checkPattern([sourceModule], /\.query\s*\(/u, 'uses a database directly'));
      if (/\b(?:sleeper|tank01|neon)\b/iu.test(sourceModule.source)) {
        violations.push(`${sourceModule.relativePath}: names a concrete provider`);
      }
    }
    expectNoViolations('Worker code may import only canonical contracts, pure helpers, and the stable output DTO.', violations);
  });

  it('requires adapters to receive environment-specific clients and configuration', () => {
    const violations: string[] = [];
    const forbiddenTargets = new Set([
      resolve(libRoot, 'config.ts'),
      resolve(libRoot, 'leagues.ts'),
      resolve(libRoot, 'projection-source-config.ts'),
      resolve(libRoot, 'projection-store.ts'),
    ]);
    for (const sourceModule of adapterModules) {
      violations.push(...checkPattern(
        [sourceModule],
        /\b(?:process\.env|import\.meta\.env|Deno\.env|globalThis\.fetch|Date\.now|Math\.random|randomUUID|crypto\.randomUUID)\b/u,
        'uses a global client, environment, clock, or randomness instead of construction injection',
      ));
      violations.push(...checkPattern([sourceModule], /new\s+Date\s*\(\s*\)/u, 'reads the system clock instead of an injected clock'));

      const findDirectGlobalFetch = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
          const line = sourceModule.sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceModule.sourceFile)).line + 1;
          violations.push(`${location(sourceModule, line)}: calls the global fetch client directly`);
        }
        ts.forEachChild(node, findDirectGlobalFetch);
      };
      findDirectGlobalFetch(sourceModule.sourceFile);

      for (const dependency of sourceModule.imports) {
        if (dependency.resolved && forbiddenTargets.has(dependency.resolved)) {
          violations.push(`${location(sourceModule, dependency.line)}: imports runtime configuration ${dependency.specifier}`);
        }
      }

      const visit = (node: ts.Node) => {
        if (ts.isPropertySignature(node)
          && node.questionToken
          && ts.isIdentifier(node.name)
          && (node.name.text === 'fetch' || node.name.text === 'now')) {
          const line = sourceModule.sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceModule.sourceFile)).line + 1;
          violations.push(`${location(sourceModule, line)}: makes injected ${node.name.text} optional`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceModule.sourceFile);
    }
    expectNoViolations('Adapters must not discover credentials, provider clients, clocks, or league configuration globally.', violations);
  });

  it('keeps production worker composition in its single runtime module', () => {
    const violations: string[] = [];
    const runtimeModules = modulesIn(runtimeRoot);
    if (!runtimeModules.some((sourceModule) => sourceModule.absolutePath === runtimePath)) {
      violations.push('lib/projections/runtime: missing runtime/projection-composition.ts');
    }

    for (const sourceModule of projectionModules) {
      const isRuntime = isInside(sourceModule.absolutePath, runtimeRoot);
      const isAdapter = isInside(sourceModule.absolutePath, join(projectionRoot, 'adapters'));
      for (const dependency of sourceModule.imports) {
        const importsConcreteAdapter = dependency.resolved !== null
          && isInside(dependency.resolved, join(projectionRoot, 'adapters'));
        const importsRuntimeOwnedSource = dependency.resolved !== null && new Set([
          resolve(libRoot, 'config.ts'),
          resolve(libRoot, 'leagues.ts'),
          resolve(libRoot, 'projection-source-config.ts'),
          resolve(libRoot, 'projection-store.ts'),
        ]).has(dependency.resolved);
        if (!isRuntime && !isAdapter && (importsConcreteAdapter || importsRuntimeOwnedSource)) {
          violations.push(`${location(sourceModule, dependency.line)}: composes runtime dependency ${dependency.specifier}`);
        }
      }
      if (!isRuntime && !isAdapter
        && /\b(?:process\.env|import\.meta\.env|Deno\.env|Date\.now|Math\.random|randomUUID|crypto\.randomUUID)\b/u.test(sourceModule.source)) {
        violations.push(`${sourceModule.relativePath}: owns environment, clock, or randomness outside runtime composition`);
      }
      if (!isRuntime && !isAdapter && /new\s+Date\s*\(\s*\)/u.test(sourceModule.source)) {
        violations.push(`${sourceModule.relativePath}: reads system time outside runtime composition`);
      }
    }
    expectNoViolations('Only the runtime composition root may assemble concrete worker dependencies.', violations);
  });

  it('keeps user-facing modules away from projection and game-state feeds', () => {
    const violations: string[] = [];
    const userFacing = [...modules.values()].filter((sourceModule) => {
      const path = sourceModule.relativePath;
      if (path.startsWith('components/')) return true;
      return path.startsWith('app/') && !path.startsWith('app/api/cron/');
    });
    const forbiddenFiles = new Set([
      resolve(libRoot, 'live-projection-worker.ts'),
    ]);
    for (const sourceModule of userFacing) {
      for (const dependency of sourceModule.imports) {
        if (!dependency.resolved) continue;
        const forbiddenProjectionPath = isInside(dependency.resolved, join(projectionRoot, 'worker'))
          || isInside(dependency.resolved, join(projectionRoot, 'runtime'))
          || isInside(dependency.resolved, join(projectionRoot, 'adapters', 'tank01'))
          || dependency.resolved === resolve(projectionRoot, 'ports', 'projection-feed.ts')
          || dependency.resolved === resolve(projectionRoot, 'ports', 'game-state-feed.ts');
        if (forbiddenProjectionPath || forbiddenFiles.has(dependency.resolved)) {
          violations.push(`${location(sourceModule, dependency.line)}: imports live feed path ${dependency.specifier}`);
        }
      }
    }
    expectNoViolations('Pages, components, and user-facing routes must read the published snapshot boundary.', violations);
  });

  it('confines SQL and low-level Neon access to the store package and its two composition facades', () => {
    const violations: string[] = [];
    const rootStoreFacade = resolve(libRoot, 'projection-store.ts');

    for (const sourceModule of modules.values()) {
      const inNeonStore = isInside(sourceModule.absolutePath, neonRoot);
      if (!inNeonStore && /\/\*\s*projection-store:[a-z0-9-]+\s*\*\//u.test(sourceModule.source)) {
        violations.push(`${sourceModule.relativePath}: contains a projection-store SQL marker`);
      }
      if (!inNeonStore) {
        for (const line of projectionSqlLiteralLines(sourceModule)) {
          violations.push(`${location(sourceModule, line)}: contains a projection-store SQL query string`);
        }
      }
      for (const dependency of sourceModule.imports) {
        if (dependency.resolved
          && isInside(dependency.resolved, neonRoot)
          && !inNeonStore
          && sourceModule.absolutePath !== rootStoreFacade
          && !isInside(sourceModule.absolutePath, runtimeRoot)) {
          violations.push(`${location(sourceModule, dependency.line)}: bypasses the root projection-store facade`);
        }
      }
    }

    const reader = modules.get(resolve(libRoot, 'projection-reader.ts'));
    if (!reader?.imports.some((dependency) => dependency.resolved === rootStoreFacade)) {
      violations.push('lib/projection-reader.ts: must read through lib/projection-store.ts');
    }
    expectNoViolations('Legacy SQL stays private to Neon; website consumers use the stable root store facade.', violations);
  });

  it('uses provider- and resource-scoped references at canonical boundaries', () => {
    const violations: string[] = [];
    const canonicalBoundaryModules = [
      ...domainModules,
      ...portModules,
      ...workerModules.filter((sourceModule) => sourceModule.relativePath.endsWith('/contracts.ts')),
    ];
    for (const sourceModule of canonicalBoundaryModules) {
      const providerIds = sourceModule.source.match(/\b(?:sleeper|tank01)[A-Za-z0-9_]*Id\b/gu) ?? [];
      if (providerIds.length > 0) {
        violations.push(`${sourceModule.relativePath}: exposes provider-specific IDs ${[...new Set(providerIds)].join(', ')}`);
      }

      const visit = (node: ts.Node) => {
        if ((ts.isPropertySignature(node) || ts.isParameter(node))
          && ts.isIdentifier(node.name)
          && /^(?:league|roster|player|externalLeague|externalRoster|externalPlayer|externalGame)Id$/u.test(node.name.text)
          && node.type?.kind === ts.SyntaxKind.StringKeyword) {
          const line = sourceModule.sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceModule.sourceFile)).line + 1;
          violations.push(`${location(sourceModule, line)}: exposes unscoped string ${node.name.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceModule.sourceFile);
    }

    const identity = modules.get(providerIdentityPath);
    if (!identity
      || !/resource:\s*Resource/u.test(identity.source)
      || !/provider:\s*ProviderKey/u.test(identity.source)
      || !/externalId:\s*OpaqueExternalId<Resource>/u.test(identity.source)
      || !/league:\s*ExternalLeagueRef/u.test(identity.source)) {
      violations.push('lib/projections/shared/provider-identity.ts: external refs must retain provider, resource, opaque ID, and roster league scope');
    }
    expectNoViolations('Canonical boundaries may expose opaque provider refs or branded internal IDs, not raw provider IDs.', violations);
  });

  it('has no dependency cycles across production TypeScript modules', () => {
    const graph = new Map<string, string[]>(productionPaths.map((path) => [
      path,
      [...new Set(modules.get(path)!.imports
        .map((dependency) => dependency.resolved)
        .filter((dependency): dependency is string => dependency !== null && productionPathSet.has(dependency)))].sort(),
    ]));
    const state = new Map<string, 0 | 1 | 2>();
    const stack: string[] = [];
    const stackIndexes = new Map<string, number>();
    const cycles = new Set<string>();

    const visit = (path: string) => {
      state.set(path, 1);
      stackIndexes.set(path, stack.length);
      stack.push(path);
      for (const dependency of graph.get(path) ?? []) {
        if ((state.get(dependency) ?? 0) === 0) visit(dependency);
        else if (state.get(dependency) === 1) {
          const cycle = stack.slice(stackIndexes.get(dependency)).map(displayPath);
          const rotations = cycle.map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)]);
          rotations.sort((left, right) => left.join(' -> ').localeCompare(right.join(' -> ')));
          cycles.add([...rotations[0], rotations[0][0]].join(' -> '));
        }
      }
      stack.pop();
      stackIndexes.delete(path);
      state.set(path, 2);
    };
    for (const path of productionPaths) {
      if ((state.get(path) ?? 0) === 0) visit(path);
    }
    expectNoViolations('Production TypeScript modules must remain acyclic.', [...cycles]);
  });
});
