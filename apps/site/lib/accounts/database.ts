import 'server-only';

// Composition facade: private role/transport details stay in the Neon adapter.
export { ACCOUNT_DATABASE_GUARD, AccountStoreUnavailableError, AccountWriteRateLimitError,
  accountDatabaseUrl, createAccountDatabase, type AccountDatabase } from './neon/database';
