export type AccountRecovery = { kind: 'none' | 'invalid' } | { kind: 'reset'; token: string };

/** Parse only the managed recovery callback. Tokens stay opaque and in memory. */
export function accountRecovery(search: string): AccountRecovery {
  const params = new URLSearchParams(search);
  if (params.has('error')) return { kind: 'invalid' };
  const tokens = params.getAll('token');
  if (tokens.length === 0) return { kind: 'none' };
  const token = tokens[0];
  if (tokens.length !== 1 || !token || token.length > 2048 || /[\s\x00-\x1f\x7f]/.test(token)) return { kind: 'invalid' };
  return { kind: 'reset', token };
}
