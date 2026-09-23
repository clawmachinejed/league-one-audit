import 'server-only';
import { randomUUID } from 'node:crypto';
import type { AccountLibraryInput, AccountView, LinkedSleeperProfile } from '../contracts';
import { type AccountDatabase, AccountStoreUnavailableError } from './database';
import { buildAccountView } from '../library';
import { ACCOUNT_SOURCE_CTES, ACCOUNT_VIEW_SQL } from './source-sql';
import { accountUuid, deleteInput, profileInput, providerLinkInput, savedLeagueInput } from '../validation';

export class AccountConflictError extends Error {
  constructor() { super('This setting changed or is no longer available. Refresh and try again.'); this.name = 'AccountConflictError'; }
}
export type VerifiedAccountPrincipal = { issuer: string; subject: string; displayName: string };
export type AccountMutation =
  | { kind: 'profile'; body: unknown }
  | { kind: 'link'; body: unknown }
  | { kind: 'unlink'; id: string; body: unknown }
  | { kind: 'save-league'; id: string; body: unknown }
  | { kind: 'remove-league'; id: string; body: unknown };

function readInput(value: unknown): AccountLibraryInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AccountStoreUnavailableError();
  const input = value as AccountLibraryInput;
  if (!input.profile || !input.profile.id || !Number.isSafeInteger(input.profile.revision)
    || typeof input.profile.displayName !== 'string'
    || ![input.links, input.saved, input.sources, input.providerAccounts, input.groups].every(Array.isArray)) throw new AccountStoreUnavailableError();
  return input;
}

export function createAccountStore(database: AccountDatabase) {
  return {
    async resolve(principal: VerifiedAccountPrincipal): Promise<string> {
      const results = await database.transaction([{ statement: `SELECT public.resolve_app_login_identity($1,$2,$3,$4::uuid) AS id`,
        parameters: [principal.issuer, principal.subject, principal.displayName, randomUUID()] }]);
      if (results[0]?.length !== 1) throw new AccountStoreUnavailableError();
      return accountUuid(results[0][0].id);
    },
    async read(actorUserId: string): Promise<AccountView> {
      const results = await database.transaction([{ statement: ACCOUNT_VIEW_SQL, parameters: [] }], { actorUserId, requestId: randomUUID() });
      if (results[0]?.length !== 1) throw new AccountStoreUnavailableError();
      return buildAccountView(readInput(results[0][0].view));
    },
    async readDiscoveryProfiles(actorUserId: string): Promise<LinkedSleeperProfile[]> {
      const results = await database.transaction([{ statement: `${ACCOUNT_SOURCE_CTES}
        SELECT link.id AS "linkId",link.revision,manager.id AS "sourceManagerAccountId",
          manager.external_manager_id AS "externalId",
          coalesce(account.display_name,manager.external_manager_id) AS "displayName"
        FROM public.app_provider_account_links link
        JOIN public.league_source_manager_accounts manager ON manager.id=link.source_manager_account_id
        LEFT JOIN provider_accounts account ON account.id=manager.id
        WHERE link.app_user_id=public.current_app_actor() AND link.revoked_at IS NULL AND manager.provider='sleeper'
        ORDER BY link.id LIMIT 21`, parameters: [] }], { actorUserId, requestId: randomUUID() });
      const rows = results[0];
      if (results.length !== 1 || !rows || rows.length > 20) throw new AccountStoreUnavailableError();
      try {
        return rows.map(row => {
          // PostgreSQL bigint revisions can arrive as strings with the Neon driver.
          const revision = Number(row.revision);
          if (!Number.isSafeInteger(revision) || revision < 1 || typeof row.externalId !== 'string'
            || typeof row.displayName !== 'string' || !row.displayName.trim()) throw new AccountStoreUnavailableError();
          return { linkId: accountUuid(row.linkId), revision,
            sourceManagerAccountId: accountUuid(row.sourceManagerAccountId),
            externalId: row.externalId, displayName: row.displayName };
        });
      } catch { throw new AccountStoreUnavailableError(); }
    },
    async mutate(actorUserId: string, mutation: AccountMutation): Promise<void> {
      const actor = accountUuid(actorUserId);
      let statement: string;
      let parameters: unknown[];
      switch (mutation.kind) {
        case 'profile': {
          const input = profileInput(mutation.body);
          statement = `UPDATE public.app_users SET display_name=$1 WHERE id=public.current_app_actor() AND revision=$2 RETURNING id`;
          parameters = [input.displayName, input.revision];
          break;
        }
        case 'link': {
          const input = providerLinkInput(mutation.body);
          statement = `${ACCOUNT_SOURCE_CTES}, existing AS (
            SELECT id FROM public.app_provider_account_links WHERE source_manager_account_id=$1::uuid AND revoked_at IS NULL
          ), inserted AS (
            INSERT INTO public.app_provider_account_links(app_user_id,source_manager_account_id)
              SELECT public.current_app_actor(),account.id FROM provider_accounts account
              WHERE account.id=$1::uuid AND NOT EXISTS(SELECT 1 FROM existing)
                AND (SELECT count(*) FROM public.app_provider_account_links WHERE revoked_at IS NULL)<20
              ON CONFLICT DO NOTHING RETURNING id
          ) SELECT id FROM existing UNION ALL SELECT id FROM inserted`;
          parameters = [input.sourceManagerAccountId];
          break;
        }
        case 'unlink': {
          const input = deleteInput(mutation.body);
          statement = `UPDATE public.app_provider_account_links SET revoked_at=clock_timestamp()
            WHERE id=$1::uuid AND revision=$2 AND revoked_at IS NULL RETURNING id`;
          parameters = [accountUuid(mutation.id), input.revision];
          break;
        }
        case 'save-league': {
          const input = savedLeagueInput(mutation.body);
          parameters = [accountUuid(mutation.id), input.favorite, input.sortPosition, input.preferredSeasonTeamId];
          if (input.revision === null) {
            statement = `${ACCOUNT_SOURCE_CTES} INSERT INTO public.app_user_leagues(app_user_id,league_id,favorite,sort_position,preferred_season_team_id)
              SELECT public.current_app_actor(),id,$2,$3,$4::uuid FROM enrolled WHERE id=$1::uuid AND active
              ON CONFLICT DO NOTHING RETURNING league_id AS id`;
          } else {
            statement = `${ACCOUNT_SOURCE_CTES} UPDATE public.app_user_leagues SET favorite=$2,sort_position=$3,preferred_season_team_id=$4::uuid
              WHERE league_id=$1::uuid AND revision=$5 AND EXISTS(SELECT 1 FROM enrolled WHERE id=$1::uuid) RETURNING league_id AS id`;
            parameters.push(input.revision);
          }
          break;
        }
        case 'remove-league': {
          const input = deleteInput(mutation.body);
          statement = `DELETE FROM public.app_user_leagues WHERE league_id=$1::uuid AND revision=$2 RETURNING league_id AS id`;
          parameters = [accountUuid(mutation.id), input.revision];
          break;
        }
      }
      // Serialize each user's mutations. The subsequent statement gets a fresh
      // READ COMMITTED snapshot after the lock, including any concurrent save.
      const results = await database.transaction([
        { statement: 'SELECT id FROM public.app_users WHERE id=public.current_app_actor() FOR UPDATE', parameters: [] },
        { statement, parameters },
      ], { actorUserId: actor, requestId: randomUUID() });
      if (results[0]?.length !== 1 || results[1]?.length !== 1) throw new AccountConflictError();
    },
  };
}
