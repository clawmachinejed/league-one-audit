import 'server-only';

// Stable server facade; pages and handlers never import SQL implementation files.
export { AccountConflictError, createAccountStore, accountRevisionExpectation, type AccountRevisionExpectation, type AccountMutation,
  type VerifiedAccountPrincipal } from './neon/store';
