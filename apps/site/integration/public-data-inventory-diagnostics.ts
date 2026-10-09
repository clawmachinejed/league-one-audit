import { qualificationBinding, qualificationDigest } from './qualification-profile';
import { writeIntegrationArtifact } from './integration-artifacts';

const profiles = {
  inventory: 'data-period-inventory-v1',
  'capacity-same-season': 'data-period-capacity-v1',
  'capacity-cumulative': 'data-period-capacity-v1',
  'capacity-all-candidates': 'data-period-capacity-v1',
  upgrade: 'data-period-upgrade-v1',
} as const;
export type InventoryDiagnosticKind = keyof typeof profiles;
export type InventoryDiagnosticStage = 'setup' | 'discovery' | 'configuration' | 'acquisition' | 'recovery'
  | 'readback' | 'history' | 'capacity' | 'downlevel' | 'migration' | 'permissions' | 'settlement' | 'cleanup' | 'complete';
const stages = new Set<InventoryDiagnosticStage>(['setup','discovery','configuration','acquisition','recovery',
  'readback','history','capacity','downlevel','migration','permissions','settlement','cleanup','complete']);
const states = new Set(['23502','23503','23505','23514','42501','42883','42P01','40P01','40001','57014','P0001','P0002']);

/** Fixed-case, descriptor-only evidence. No source bodies, SQL, messages, IDs or caller-selected filenames. */
export function createPublicInventoryDiagnostics(kind: InventoryDiagnosticKind) {
  if (!Object.hasOwn(profiles, kind)) throw new Error('Unknown inventory diagnostic case.');
  const started = performance.now();
  let stage: InventoryDiagnosticStage = 'setup';
  let first: { stage: InventoryDiagnosticStage; category: 'sql' | 'assertion' | 'abort' | 'unexpected'; sqlState: string | null } | null = null;
  let original: Error | undefined;
  let databaseVersion: { serverVersion: string; serverVersionNum: number } | null = null;
  let acquisitions = 0;
  const fail = (error: unknown) => {
    if (original) return original;
    const own = (key: string): unknown => {
      try { const property = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, key) : undefined;
        return property && 'value' in property ? property.value : undefined; } catch { return undefined; }
    };
    const code = own('code'), name = own('name');
    first = { stage, category: typeof code === 'string' && states.has(code) ? 'sql'
      : name === 'AssertionError' ? 'assertion' : name === 'AbortError' || name === 'TimeoutError' ? 'abort' : 'unexpected',
    sqlState: typeof code === 'string' && states.has(code) ? code : null };
    original = new Error(`Public inventory proof failed at ${stage} (${first.category}).`);
    return original;
  };
  const save = async () => {
    try {
      const binding = qualificationBinding();
      if (!binding || (binding.context.profile !== 'full' && binding.context.profile !== profiles[kind])) throw new Error();
      await writeIntegrationArtifact(`public-period-${kind}-diagnostics.json`, {
        kind: 'public-period-inventory-diagnostics-v1', caseKind: kind,
        contextDigest: qualificationDigest(binding.context), runId: binding.context.runId,
        gitSha: binding.context.gitSha, profile: binding.context.profile,
        stage, acquisitions, elapsedMs: Math.round(performance.now() - started), databaseVersion, firstFailure: first,
      });
    } catch {
      if (!original) throw fail(undefined);
      process.stderr.write('PUBLIC_PERIOD_DIAGNOSTIC_ARTIFACT_WRITE_FAILED\n');
    }
  };
  return {
    stage(value: InventoryDiagnosticStage) { if (!stages.has(value)) throw fail(undefined); stage = value; },
    acquired() { if (++acquisitions > 40) throw fail(undefined); },
    database(row: Readonly<Record<string, unknown>>) {
      const descriptors = Object.getOwnPropertyDescriptors(row);
      const value = (key: string) => descriptors[key] && 'value' in descriptors[key] ? descriptors[key].value : undefined;
      const text = value('server_version'), number = value('server_version_num');
      const parts = typeof text === 'string' && text.length <= 64 ? /^([1-9][0-9])\.([0-9]{1,4})(?: \([0-9a-f]{7,40}\))?$/u.exec(text) : null;
      if (value('role') !== 'league_one_runtime' || value('effective_role') !== 'league_one_runtime'
        || !parts || typeof number !== 'string' || !/^[1-9][0-9]{5}$/u.test(number)
        || Number(parts[1]) * 10_000 + Number(parts[2]) !== Number(number)) throw fail(undefined);
      databaseVersion = { serverVersion: text as string, serverVersionNum: Number(number) };
    },
    fail,
    save,
    async finish(cleanups: readonly (() => unknown | Promise<unknown>)[]) {
      // Every closure is attempted; the first sanitized proof/cleanup failure wins.
      for (const cleanup of cleanups) {
        try { await cleanup(); } catch (error) { stage = 'cleanup'; fail(error); }
      }
      try { await save(); } catch (error) { fail(error); }
      if (original) throw original;
    },
  };
}
