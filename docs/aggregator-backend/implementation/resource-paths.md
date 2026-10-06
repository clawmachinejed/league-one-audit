# BC-M1 producer and consumer paths

This execution inventory supplements the canonical contracts; it does not authorize a public cutover. “Wired” means connected in application source, not deployed or SQL-qualified. Hosted Preview keeps accounts disabled. Sleeper is the only implemented league provider.

| Resource | Producer and normalized storage | Authorized reader and intended existing consumer | Current boundary |
| --- | --- | --- | --- |
| Website account/session | Maintained Better Auth writes canonical `website_auth` tables. An owner-approved infrastructure manifest and admission epoch bind the auth/account connections. | Request-owned verified receipt → existing account store transaction/final timing → `/api/me` private routes and existing account/profile/library clients. | Receipt composition wired in source. Actual LOGIN, infrastructure settings, installed grants, epoch activation and migration recovery unqualified. Login display stays independent of provider membership/epoch. |
| Official league/manager/held-roster evidence | Existing Sleeper import and administration job → single administration normalizer/writer → existing contents, observations, accepted heads, manager identities and memberships. | Existing accepted readers and `ACCOUNT_VIEW_SQL` → existing account library and My Fantasy consumers. | Legacy path wired. R035 enriches malformed primary ownership only as unqualified partial-v2 evidence. Full D02 membership/adverse/source-policy authorization and protected target stored-roster delivery remain pending. |
| Provider username recognition and association | Internal account admission → existing `projection_jobs` claim → existing Sleeper adapter/permit transport → immutable pre-enrollment attempts/captures and shared manager identity. Owner-qualified policy/context is mandatory, never automatically seeded. | `read_account_acquisition_v1` under fresh account receipt → canonical `IdentifyProviderAccountResult`; exclusive receipt-pinned activation returns user-asserted assurance. Intended consumer is existing onboarding/account connection service. | Concrete internal composition authored; SQL qualification and public mounting remain pending. Existing onboarding/preview routes remain unchanged. Public recognition never proves provider-account control. Release/disconnect lifecycle is still pending. |
| Provider NFL calendar and discovery scopes | Same job/transport owner acquires `/state/nfl`, then freezes current/prior-two/retained-selection scopes. Existing league-list normalizer → retained normalized candidate identity/display → atomic capture/checkpoint with the existing job fence. | `read_account_discovery_v1` → closed decoder → `storedSleeperDiscovery` → existing `SleeperLeagueDiscovery` account-library DTO. Each read is actor/session/association/context/policy checked and delivery bounded. | Executable internal account → job → adapter → storage → reader → consumer-contract path authored. Public route/cron mounting and actual SQL behavior remain unqualified. Full current-team selection, membership and authorized stored-roster delivery are still pending. Complete account lists remain candidate evidence. |
| Follow intention and preferred team | Existing canonical preference mutations → `app_user_leagues`, revisioned unfollow tombstones and existing audit transaction. | Existing account view → account library and team selection consumers. | Legacy behavior wired. D04 renewal/suspend/resume and D05 durable demand/recovery remain pending; stored intention alone grants no access. |
| Provider request permits | Existing permit transport and exclusive local HTTP owner, with concrete persisted gate/permit helpers for the target acquisition path. | Callable internal `runAccountAcquisitionStep` uses restricted runtime identity, existing job owner and actual Neon ports. | Source wired internally; SQL concurrency/fairness/quarantine qualification is pending. Existing public Sleeper callers have not converged onto the new gate, so no universal provider-start/capacity qualification or activation is claimed. |

## Regenerated private caller inventory

| Existing route/caller | Composition owner |
| --- | --- |
| GET `/api/me`, GET `/api/me/teams`, PATCH `/api/me/profile`, POST `/api/me/provider-links`, DELETE `/api/me/provider-links/[id]`, PUT/DELETE `/api/me/leagues/[id]` | `lib/accounts/http.ts::accountResponse` |
| GET `/api/me/provider-link-preview` | `lib/accounts/http.ts::sleeperLinkPreviewResponse` |
| GET `/api/me/sleeper-leagues` | `lib/accounts/http.ts::sleeperLeagueDiscoveryResponse` |
| POST `/api/me/sleeper-onboarding` | `lib/accounts/onboarding-http.ts::onboardingResponse` |
| GET `/api/me/fantasy` | `lib/accounts/fantasy.ts::accountFantasyResponse` |
| `app/page.tsx` login redirect | `getAccountPrincipal`, with no private account store or provider-membership dependency |

Every private default store is constructed from its own verified principal. Slow provider/artwork paths reacquire authority and a fresh store, compare actor/session/association state, and finish with a coherent account read or revision-checked mutation and database timing. The onboarding provider budget remains 50 seconds; final decision delivery uses the existing 12-second bound after provider work. There is no receiptless final-read/mutation fallback. These account/session checks do not substitute for the pending target membership/source vector.

Auth writes enter through `/api/auth/[...path]` and the maintained auth runtime; session reads may also refresh sessions. Better Auth owns user/session/account/verification/rate-limit mutations. Owner session revocation and epoch activation are separate privileged operations. The installation boundary must drain old private callers and auth writers at the service boundary: pre-034 writers cannot be presumed to observe a new advisory gate. An attestation hash records reviewed external evidence; it does not mechanically prove a service drain.

The source census found no ordinary operator or worker using a receiptless private account store. The low-level adapter remains available to controlled fixtures, not as a production fallback. Re-run this inventory before any authorized installation/cutover.

## Narrow prerequisite and representation additions

The NFL calendar capture is the existing Sleeper `/state/nfl` adapter used to
freeze BC-M1 discovery scope. It is provider/sport scoped and has no fabricated
fantasy league. It does not implement the broader BC-M3 NFL-input backlog.
League-list captures retain the existing normalizer's display projection beside
canonical candidate identity in the same normalized value, so the protected
consumer reads normalized stored names rather than walking raw provider JSON.
That additive display projection does not authorize membership, enrollment,
selection, follow or derived-feature coverage. Future providers must reuse the
same admission, source-owner, storage and reader responsibilities.
