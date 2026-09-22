import 'server-only';

// Stable server facade; pages and handlers never import SQL implementation files.
export { AccountConflictError, createAccountStore, type AccountMutation,
  type VerifiedAccountPrincipal } from './neon/store';
