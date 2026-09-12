import { expect, it } from 'vitest';
import { prepareAllPlayerDiagnostics } from './all-player-diagnostics';

it('bounds UTF-8 bytes and control characters while retaining diagnostic counts', () => {
  const prepared = prepareAllPlayerDiagnostics([
    'sleeper/7527:required-official:missing\nrow',
    ...Array.from({ length: 100 }, () => 'opaque-id:界'.repeat(500)),
  ]);
  expect(prepared.diagnosticCount).toBe(101);
  expect(prepared.diagnostics).toHaveLength(32);
  expect(prepared.diagnostics[0]).toBe('sleeper/7527:required-official:missing row');
  expect(prepared.diagnostics[1]).toMatch(/^oversized-diagnostic:sha256:[a-f0-9]{64}$/u);
  expect(Buffer.byteLength(JSON.stringify(prepared))).toBeLessThan(9_000);
});
