# Internal transaction activity

This B3 resource implements the transaction and claim portions of Step 2 rows 23–25.
The [Step 2 checklist](step-2-checklist.md) is the sole completion ledger. Public
and account readers keep their existing routes, loaders and presenters. Current
waiver priority and budget remain B2 season-overview resources; this resource
neither recalculates them nor infers prior balances from transactions.

## Source and capture

The existing administration maintenance and operator acquisitions reserve each
native transaction week before its request. `beginTransactionAttempt` uses the
existing scopes, attempts, receipts, acceptances and heads. The existing writer
stores raw content and its v1 normalized value once, then the additive
`033_transaction_capture_acceptance.sql` wrapper binds the receipt to the exact
mapping, native week, request provenance and optional job fence. Week 0 is valid;
the supported native range is 0–18. It is not an inferred NFL-period mapping.

Only a complete valid array can advance the internal accepted resource. An empty
array qualifies as an empty week. Latest reservation, expected head generation,
current source mapping, live job fence and legacy accepted-content checks remain
required. Partial, invalid, stale and equal-time conflicting evidence preserves
the prior accepted resource. Identical receipt retries are idempotent; altered
evidence cannot reuse an attempt. Receipts retain their own acquisition time even
when the old writer reuses a content or observation ID. An incomplete network
request can leave a reservation without a receipt; that alone cannot prove the
request's failure. The feed accepts separately identified failure evidence.

`readAcceptedTransactions` reads the exact current receipt. It withholds the read
if the legacy head has an equal-time conflict or diverges from the accepted
receipt content; the prior typed acceptance remains stored. Bounded
`scanRetainedTransactions` and `readRetainedTransactions` inventory original
immutable v1 observations for an explicit league-season, provider, external
league and native-week set. They do not follow today's source mapping. The
inventory bound is 1,000 observations and exact reads accept at most 100 IDs.
Overflow is unavailable rather than silently truncated.

Retained mapping proof requires a receipt with the original observation's exact
provenance. A later equal-content receipt cannot retroactively prove an old
capture's mapping. This inventory describes original observations, not every
later equal-content receipt acquisition. An accepted receipt can be read and
frozen separately. Older captures remain useful native evidence with
`mapping_revision_not_captured`. Team references are scoped by provider,
league-season and source league; missing UUIDs stay unresolved and display names
never establish identity.

## Typed facts and bounded feed

`projectTransactionCapture` validates raw hash, semantic hash and normalized value
through `normalizeAdministrationObservation`. It adds a typed projection without
changing old hashes, contents or IDs. Native and mapped status stay separate.
Adds/drops, pick original/from/to teams and FAAB sender/receiver preserve
direction and exact parsed amounts. Created and updated timestamps remain
separate from the existing effective display time.

Absent, null, known empty, zero and invalid optional evidence stay distinct.
Unknown types retain their native labels with limited support. All three bid
candidates survive with raw values; existing settings → root → metadata
precedence supplies the compatibility bid. Notes and other supplied native claim
details are retained. Losing-claim inventory remains unknown: only supplied
claims can appear. A complete week does not establish that all losing bids were
exposed.

`buildTransactionActivity` takes immutable captures and optional failed-attempt
evidence. Every selected week has its own coverage result. Later failed, invalid
or partial evidence can retain a prior complete capture with a last-good label.
Source observation time orders revisions independently of arrival time.
Equal-time/raw-content weekly conflicts retain the existing conservative writer
policy. Overlapping events use scoped identity and the existing effective event
timestamp; contradictory equal-time copies are withheld explicitly.

Intervals include `from` and exclude `to`; unknown event times cannot satisfy a
bounded interval. Team filters use season-team UUIDs and include consenters and
asset participants; type filters use exact native values. Pages contain at most
100 events, with a 20,000-event processing bound. Cursors bind transformation
version, complete input set, failures, interval and filters. Source changes
invalidate them. Source completeness, window/conflict coverage, output pagination
and claim visibility are independent fields.

## Compatibility and retained comparison

`compareTransactionCapture` and `compareTransactionActivity` reuse the league and
manager formatters on the same source versus reconstructed typed facts. League
presentation excludes pending statuses case-insensitively; manager presentation
retains them with its existing case-sensitive result labels. Comparison preserves
both behaviors, bid precedence, notes, directional assets, metadata fallbacks and
America/New_York calendar days across DST. Waiver day grouping is presentation
policy, not a provider processing-event identity. Withholding contradictory
cross-week copies is an explained difference from the old formatter's last-copy
selection, not a claim of exact parity.

The manifest freezes captures, mappings, original times, team/catalog values and
their independent observation metadata, intervals and transformation/comparison
versions. Sorted entries, input/result hashes and bounded cursors support
repeatable batches and serialized restart. New observations require a new
manifest. Catalog and names are current display evidence, not historical facts.

This is read-only comparison, not database-persisted replay or crash-safe durable
backfill. It makes no provider requests, creates no observations or receipts,
advances no heads and publishes no snapshots. Production processing is outside
this implementation.

## Qualification and rollout boundary

Ordinary unit/adapter tests cover resources and existing acquisition wiring. Real
persistence needs the existing disposable integration harness at the final
reviewed SHA, protected approval, test totals and full cleanup receipt. No
production credentials are needed. Database-disabled Preview qualifies public
regression behavior only.

A later rollout needs fresh source/service identity checks and isolated
qualification of final 033 plus old/new callers. Apply only reviewed pending 033
through the existing migration runner under separate production migration
authority; do not rerun 030–032, repair unrelated late-role grants, backfill or
change cron/provider settings. Verify the existing runtime role's exact function
grants and old-caller behavior before separately authorized merge/release.

Rollback restores prior callers while retaining additive receipts and history.
Calls without transaction acceptance delegate to the original writer. Step 3
public/account activation, a populated pilot, production coverage, replay,
backfill, B4 and provider enrollment remain separate gates.
