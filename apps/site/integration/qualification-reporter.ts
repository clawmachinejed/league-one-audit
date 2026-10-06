import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestCase, TestModule, TestSpecification, Vitest } from 'vitest/node';
import type { Reporter, ReportedHookContext, TestRunEndReason } from 'vitest/reporters';
import { markQualificationFailure, qualificationBinding, qualificationDigest, qualificationRelativePath,
  qualificationSourceDigest, writeQualificationArtifact, type QualificationBinding, type QualificationReport } from './qualification-profile';

/** Public Vitest 4 API only. No raw exception text, metadata or credentials in
 * evidence. Verbose output keeps the supervisor's existing redaction. */
export default class QualificationReporter implements Reporter {
  private binding!: QualificationBinding;
  private root = '';
  private globalPattern: string | null = null;
  private starts = 0;
  private ends = 0;
  private specifications: QualificationReport['specifications'] = [];
  private collected: string[] = [];
  private ready = new Map<string, number>();
  private results = new Map<string, number>();
  private hooks = new Map<string, { key: string; starts: number; ends: number }>();
  onInit(vitest: Vitest): void {
    const binding = qualificationBinding();
    assert(binding, 'The qualification reporter requires supervisor-generated context.');
    this.binding = binding; this.root = vitest.config.root;
    this.globalPattern = vitest.config.testNamePattern?.source ?? null;
  }
  async onTestRunStart(specifications: readonly TestSpecification[]): Promise<void> {
    this.starts++;
    this.specifications = specifications.map(spec => ({
      path: qualificationRelativePath(this.root, spec.moduleId), pattern: spec.testNamePattern?.source ?? this.globalPattern,
      otherFilters: Boolean(spec.testLines?.length || spec.testIds?.length || spec.testTagsFilter?.length),
    }));
    for (const entry of this.binding.context.modules) {
      assert.equal(qualificationSourceDigest(await readFile(join(this.root, entry.path), 'utf8')), entry.sourceDigest,
        'Qualification entry changed after its context was created.');
    }
  }
  onTestModuleCollected(module: TestModule): void { this.collected.push(module.relativeModuleId.replace(/\\/gu, '/')); }
  onTestCaseReady(test: TestCase): void { this.ready.set(test.id, (this.ready.get(test.id) ?? 0) + 1); }
  onTestCaseResult(test: TestCase): void { this.results.set(test.id, (this.results.get(test.id) ?? 0) + 1); }
  private hook(context: ReportedHookContext, field: 'starts' | 'ends'): void {
    const key = context.entity.id + ':' + context.name;
    const counts = this.hooks.get(key) ?? { key, starts: 0, ends: 0 };
    counts[field]++; this.hooks.set(key, counts);
  }
  onHookStart(context: ReportedHookContext): void { this.hook(context, 'starts'); }
  onHookEnd(context: ReportedHookContext): void { this.hook(context, 'ends'); }
  async onTestRunEnd(modules: readonly TestModule[], errors: readonly unknown[], reason: TestRunEndReason): Promise<void> {
    this.ends++;
    try {
      const report: QualificationReport = { kind: 'integration-qualification-report-v1',
        contextDigest: qualificationDigest(this.binding.context), starts: this.starts, ends: this.ends, reason,
        unhandledErrors: errors.length, specifications: this.specifications, collected: this.collected,
        hooks: [...this.hooks.values()], modules: modules.map(module => ({
          path: module.relativeModuleId.replace(/\\/gu, '/'), state: module.state(), errors: module.errors().length,
          suites: [...module.children.allSuites()].map(suite => ({ id: suite.id, name: suite.fullName,
            mode: suite.options.mode, errors: suite.errors().length })),
          cases: [...module.children.allTests()].map(test => {
            const result = test.result(), diagnostic = test.diagnostic();
            return { id: test.id, name: test.fullName, state: result.state, mode: test.options.mode,
              expectedFailure: test.options.fails === true, configuredRetries: Boolean(test.options.retry),
              configuredRepeats: test.options.repeats ?? 0, errors: result.errors?.length ?? 0,
              readyEvents: this.ready.get(test.id) ?? 0, resultEvents: this.results.get(test.id) ?? 0,
              diagnostic: diagnostic ? { retryCount: diagnostic.retryCount, repeatCount: diagnostic.repeatCount,
                flaky: diagnostic.flaky, duration: diagnostic.duration, startTime: diagnostic.startTime } : null };
          }),
        })) };
      await writeQualificationArtifact(this.binding, 'report', report);
    } catch (error) { await markQualificationFailure(this.binding, 'reporter-failure'); throw error; }
  }
  async onProcessTimeout(): Promise<void> {
    process.exitCode = 1;
    await markQualificationFailure(this.binding, 'process-timeout');
  }
}
