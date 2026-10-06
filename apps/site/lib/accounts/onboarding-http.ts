import 'server-only';
import { createAccountResponseDelivery } from './response-authority';
import { getAccountAuthorizedPrincipalV2, sameAccountAuthority, type AccountPrincipal } from './auth';
import { createAccountDatabaseForPrincipal } from './database';
import { createAccountStore, accountRevisionExpectation } from './store';
import { accountUuid, AccountInputError } from './validation';
import { requireAccountOrigin, readAccountJson, accountErrorResponse } from './http';
import { previewSleeperUsername, importSleeperTeam } from './onboarding';

const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
const defaults = { principal: getAccountAuthorizedPrincipalV2, sameAuthority: sameAccountAuthority,
  store: (principal: AccountPrincipal) => createAccountStore(createAccountDatabaseForPrincipal(principal)),
  preview: previewSleeperUsername, importTeam: importSleeperTeam };

export async function onboardingResponse(request: Request, dependencies = defaults): Promise<Response> {
  try {
    requireAccountOrigin(request);
    const expected = accountUuid(request.headers.get('x-expected-account-id'));
    const body = await readAccountJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AccountInputError();
    const input = body as Record<string, unknown>;
    const confirming = input.action === 'confirm';
    const fields = confirming ? ['action','userId','leagueId','rosterId'] : ['action','username'];
    if (Object.keys(input).some(key => !fields.includes(key)) || !['preview','confirm'].includes(String(input.action))) throw new AccountInputError();
    if (confirming ? typeof input.userId !== 'string' || !/^[1-9]\d{0,31}$/u.test(input.userId)
      || typeof input.leagueId !== 'string' || !/^[1-9]\d{0,31}$/u.test(input.leagueId)
      || typeof input.rosterId !== 'number' || !Number.isSafeInteger(input.rosterId) || input.rosterId<1
      : typeof input.username !== 'string' || !/^[a-zA-Z0-9_]{1,100}$/u.test(input.username)) throw new AccountInputError();
    const principal = await dependencies.principal();
    if (!principal) return Response.json({ error: 'unauthenticated' }, { status: 401, headers });
    const store = dependencies.store(principal);
    const actor = await store.resolve(principal);
    if (actor !== expected) return Response.json({ error: 'account_changed' }, { status: 409, headers });
    const initial = accountRevisionExpectation(await store.read(actor));
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(50_000)]);
    if (!confirming) {
      const preview = await dependencies.preview(String(input.username), signal);
      signal.throwIfAborted();
      const delivery = createAccountResponseDelivery(signal);
      const latest = await dependencies.principal();
      if (!latest || !dependencies.sameAuthority(principal, latest)) {
        return Response.json({ error: 'account_changed' }, { status: 409, headers });
      }
      const latestStore = dependencies.store(latest);
      if (await latestStore.resolve(latest) !== actor) return Response.json({ error: 'account_changed' }, { status: 409, headers });
      const final = delivery.beginFinalSql();
      const checked = await latestStore.readFinal(actor);
      if (JSON.stringify(accountRevisionExpectation(checked.value)) !== JSON.stringify(initial)) {
        return Response.json({ error: 'account_changed' }, { status: 409, headers });
      }
      return final.deliver(preview, checked.decisionTiming);
    }
    await dependencies.importTeam(String(input.userId), String(input.leagueId), Number(input.rosterId), signal);
    signal.throwIfAborted();
    const delivery = createAccountResponseDelivery(signal);
    const latest = await dependencies.principal();
    if (!latest || !dependencies.sameAuthority(principal, latest)) {
      return Response.json({ error: 'account_changed' }, { status: 409, headers });
    }
    const latestStore = dependencies.store(latest);
    if (await latestStore.resolve(latest) !== actor) return Response.json({ error: 'account_changed' }, { status: 409, headers });
    const view = await latestStore.read(actor);
    if (JSON.stringify(accountRevisionExpectation(view)) !== JSON.stringify(initial)) {
      return Response.json({ error: 'account_changed' }, { status: 409, headers });
    }
    const profile = view.library.availableProviderAccounts.find(account => account.externalId === input.userId);
    if (!profile) throw new Error('Accepted profile evidence unavailable.');
    const final = delivery.beginFinalSql();
    const decisionTiming = await latestStore.mutate(actor, { kind: 'link', body: { sourceManagerAccountId: profile.id } }, initial);
    return final.deliver({ ok: true }, decisionTiming);
  } catch (error) {
    if (error instanceof AccountInputError) return Response.json({ error: 'invalid_request', message: error.message }, { status: 400, headers });
    return accountErrorResponse(error);
  }
}
