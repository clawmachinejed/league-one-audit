# BC-M1 producer and consumer paths

This execution inventory supplements the canonical contracts; it does not authorize a public cutover. “Wired” means connected in application source, not deployed or SQL-qualified. Hosted Preview keeps accounts disabled. Sleeper is the only implemented league provider.

| Resource | Producer and normalized storage | Authorized reader and intended existing consumer | Current boundary |
| --- | --- | --- | --- |
| Website account/session | Maintained Better Auth writes canonical `website_auth` tables. An owner-approved infrastructure manifest and admission epoch bind the auth/account connections. | Request-owned verified receipt → existing account store transaction/final timing → `/api/me` private routes and existing account/profile/library clients. | Receipt composition wired in source. Actual LOGIN, infrastructure settings, installed grants, epoch activation and migration recovery unqualified. Login display stays independent of provider membership/epoch. |
| Official league/manager/held-roster evidence | Existing Sleeper import and administration job → single administration normalizer/writer → existing contents, observations, accepted heads, manager identities and memberships. | Existing accepted readers and `ACCOUNT_VIEW_SQL` → existing account library and My Fantasy consumers. | Legacy path wired. R035 enriches malformed primary ownership only as unqualified partial-v2 evidence. Full D02 membership/adverse/source-policy authorization and protected target stored-roster delivery remain pending. |
| Provider username recognition | Existing Sleeper adapter lookup → immediate public-recognition DTO. | Session/actor/association revalidation → existing onboarding and profile-preview consumers. | Legacy source path wired. This is user-asserted association input, never provider authentication or D03 exclusive-claim proof. Retained target lookup/admission evidence remains pending. |
| Discovery scopes | Existing adapter normalization and required server-owned request admission/capture ports → finite current/prior-two/retained-selection season scan with scope-specific outcomes. | Internal discovery orchestration for future existing-job execution; eventual account library/current-team selection consumer. | Target entrypoint dormant. Concrete Neon scan persistence, atomic job admission, source authorization and final protected result delivery remain pending. Existing public discovery payload/call behavior stays unchanged. A capture-port acknowledgment is not claimed as an installed persistence owner. |
| Follow intention and preferred team | Existing canonical preference mutations → `app_user_leagues`, revisioned unfollow tombstones and existing audit transaction. | Existing account view → account library and team selection consumers. | Legacy behavior wired. D04 renewal/suspend/resume and D05 durable demand/recovery remain pending; stored intention alone grants no access. |
| Provider request permits | Existing dormant permit transport and exclusive local HTTP resource owner. | Future existing worker/adaptor acquisition callsites. | Local deadline/quarantine behavior tested. Global SQL permit ledger, durable jobs, cross-process admission and caller convergence remain pending. No alternate provider feed is activated. |

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
