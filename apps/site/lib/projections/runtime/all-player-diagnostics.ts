import { createHash } from 'node:crypto';

/** Bound durable/log output; original provider identities remain in raw evidence. */
export function prepareAllPlayerDiagnostics(values: readonly string[]) {
  return {
    diagnosticCount: values.length,
    diagnostics: values.slice(0, 32).map((value) => {
      const cleaned = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim();
      if (Buffer.byteLength(cleaned, 'utf8') <= 256) return cleaned;
      return `oversized-diagnostic:sha256:${createHash('sha256').update(value).digest('hex')}`;
    }),
  };
}
