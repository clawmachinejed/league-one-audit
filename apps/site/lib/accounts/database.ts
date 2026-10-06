import 'server-only';
import { accountPrincipalAuthority, type AccountPrincipal } from './auth';
import { createAccountAuthorityDatabase } from './neon/database';

export function createAccountDatabaseForPrincipal(principal: AccountPrincipal) {
  return createAccountAuthorityDatabase(accountPrincipalAuthority(principal));
}

// Composition facade: private role/transport details stay in the Neon adapter.
export { ACCOUNT_DATABASE_GUARD, AccountStoreUnavailableError, AccountWriteRateLimitError, AccountRevisionConflictError,
  accountDatabaseUrl, createAccountDatabase, createAccountAuthorityDatabase, type AccountDatabase, type AccountAuthorityDatabase } from './neon/database';
export { createAcquisitionDatabase } from './neon/acquisition-runtime-database';
