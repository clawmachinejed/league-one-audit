# Collection capacity evidence — September 23, 2026

Application source: `864580c67bae2380049c978346e3da076d5cdee5` (PR #251). No runtime, migration, cron, provider configuration, enrollment or production data was changed for this measurement. These are local Node-to-isolated-Neon backend measurements with synthetic providers, not production throughput certification.

Read the [capacity report](../../../../docs/collection-capacity-validation.md), [independent method review](method-review.md) and [verification record](validation.md).

## Qualified measurements

| Evidence | Scope and result | Cleanup |
| --- | --- | --- |
| [Main measurement](evidence/collection-capacity-measurement-6a9e51e0-e99a-45ae-9814-321c0a2e95a5.json) | 19 correct captures: shared profiles at 3/8/16/32 leagues, three distinct profiles, mixed failure isolation. | [Receipt](evidence/collection-capacity-supervision-2fc3c46a-00d1-45f9-8bd8-b18bf13666f9.json): closed child, empty schemas, verified guarded recovery after teardown connection-close error. |
| [Distinct-profile extension](evidence/collection-capacity-measurement-b7e252ff-a4a6-4cbd-bbb3-145a12e67ef7.json) | Seven correct captures. Eight distinct profiles completed in 31.12–41.35 s; the changed capture left 8.65 s, below the predefined 10 s reserve. Sixteen/thirty-two distinct profiles were not attempted. | [Receipt](evidence/collection-capacity-supervision-a5182b64-0b17-4b0f-ae6b-ae0c03de686d.json): closed child and cleanup verified. |
| [Scheduling policy](scheduling-policy.json) | 24 fleet/week scenarios and 12 preseason/default sensitivities. Real scheduling APIs, instantaneous work, no DB or provider. | No external work. |
| [Production baseline](evidence/collection-capacity-production-baseline.json) | Read-only Neon aggregate metadata and bounded naturally scheduled Vercel log observations. | No writes or forced cron/provider requests. |

All 26 main/extension captures passed their logical invariants. The main run's distinct-eight stop was its global test-time budget, not application capacity; the extension measures that level separately. No timeout was required to identify the reduced margin at eight distinct profiles. This evidence establishes no maximum supported fleet or fixed refresh guarantee.

## Retained qualification attempts

| Attempt | Measurement | Interpretation | Supervisor receipt |
| --- | --- | --- | --- |
| Initial fixture | [Raw record](evidence/collection-capacity-measurement-de88429c-62ef-4856-95bf-51cb2140742c.json) | Excluded from capacity conclusions: invented lowercase IDs caused parity-fingerprint ordering mismatch; identity context also needed setup. | [Receipt](evidence/collection-capacity-supervision-9c970d78-ec8b-477c-92a2-bd3e0dc81737.json), initially cleanup-unverified because idle HTTP pool sessions remained despite closed child/empty schemas. |
| Diagnostic replay | [Raw record](evidence/collection-capacity-measurement-887fe71d-6314-4b7e-862b-c3524ac8b79e.json) | Zero point mismatches; SQLSTATE P0001 and differing parity fingerprints confirmed identifier ordering. | [Receipt](evidence/collection-capacity-supervision-e688b112-b873-4fb2-a80e-4cfd057d6054.json), cleanup verified. |
| Corrected probe | [Raw record](evidence/collection-capacity-measurement-68514295-f8b3-4f74-bbe2-dc19b04e4630.json) | Three accepted leagues, all checks passed, 22.497 s. | [Receipt](evidence/collection-capacity-supervision-d90c7c0a-aa80-4584-b5f7-7a95e968bd17.json), cleanup verified. |
| History-context qualification | [Raw record](evidence/collection-capacity-measurement-e825c1f2-f97a-4c8e-92e2-72d5877ee641.json) | Stopped on unchanged-content assertion. Earliest history is established by the first capture, so second capture has changed context. Final method retains this as explicit warmup and tests unchanged on the third capture. | [Receipt](evidence/collection-capacity-supervision-a78c46df-b88a-4902-b05f-2d8c7256e111.json), cleanup verified. |

The first receipt is preserved as originally failed. A fresh subsequent check found no active transactions and only idle restricted-runtime HTTP pool connections consistent with the owned run interval; subsequent guarded preflights also confirmed empty schemas. No database connections were terminated.

## Reproduction and interpretation

The final supervised command is documented in the capacity report. It takes exclusive ownership, proves that ownership inside global setup, supervises its child, and verifies cleanup. It is Windows-specific. The main and extension were captured before that reusable supervisor improvement, under a separately reviewed external supervisor with the same mutex and identity/cleanup gates. Each measurement preserves exact application/harness hashes; the later runner change does not rewrite them.

Do not compare source timestamps or total process RSS as independent cold-start samples. Higher league levels reuse earlier contents and database pages. Serialization counters are SQL/JSON measurements, not billed wire traffic. Relation allocation is not a season storage estimate. Failed qualification attempts must not be counted as passing capacity samples.
