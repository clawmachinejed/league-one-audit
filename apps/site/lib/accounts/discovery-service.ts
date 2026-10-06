import 'server-only';
import { accountPrincipalAuthority, type AccountPrincipal } from './auth';
import { createAccountDatabaseForPrincipal } from './database';
import { createAccountStore } from './store';
import { createNeonAccountAcquisitionPort } from './neon/discovery';

/** Internal composition root. Resolution and acquisition use the same
 * request-owned authority database; the receipt never leaves this boundary.
 * No provider HTTP is performed by the account request. */
export function createAccountDiscoveryService(principal: AccountPrincipal) {
  const database = createAccountDatabaseForPrincipal(principal);
  const store = createAccountStore(database);
  return {
    resolve: () => store.resolve(principal),
    forActor: (actor: string) => createNeonAccountAcquisitionPort(database, actor, accountPrincipalAuthority(principal)),
  };
}
