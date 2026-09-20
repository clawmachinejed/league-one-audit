# Shared projection persistence diagnostics

The current-week collector loads one shared provider group before publishing each league. A persistence failure can therefore stop publication for every league in that period. The public page continues using its established official-data fallback when no fresh stored projection is available.

## September 20, 2026 incident

At 20:07 UTC, production Week 2 full/compact readers returned HTTP 503 for League One, League Two and Dynasty. League One Week 3 returned HTTP 200. Scheduled current-worker logs showed all three official league sources available, 492 matched projection rows and 16 game states loaded, followed by `provider-persistence-failed`. The outer log misleadingly reported zero failed leagues.

Read-only production evidence showed all 16 Week 2 games' last accepted observations at 20:01:18.564 UTC. The current job was failed; observation and future jobs were completed. This identifies the shared persistence boundary as the failure area, but does not prove which game, guard or database operation rejected the incoming data. The previous generic catch discarded that detail.

## Diagnostic contract

The existing provider-persist failure event identifies the failing persistence substage and a fixed safe reason when recognized. Substages separate game identity resolution, game-state persistence, scoring identity resolution, coverage and projection-slate persistence. Only approved error labels and SQLSTATE values may be logged. A game-state failure also includes a bounded, sanitized summary of the incoming NFL game states (team pairing, status, period, clock and source times) so the rejected condition can be compared with immutable stored observations. It adds no database or provider requests. Raw exception messages, SQL statements, raw provider payloads, credentials and connection strings must remain absent. Unknown errors retain a generic reason.

The collector retains its existing validation, database operations, provider request counts, atomic game-state batch, publication rules and failure behavior. This diagnostic change does not repair a rejected input, bypass the game-clock guard, serve stale projections as fresh, or create a second ingestion path.

## Validation and operation

Tests must distinguish game-state, identity and slate failures; prove secret-bearing unknown exceptions cannot enter logs; preserve failure behavior; and verify truthful failed-league counts. Run the full repository verification before release and inspect the actual preview. Database guards are unchanged, so this change does not require a migration or destructive integration test.

After an authorized deployment, verify the exact merged SHA and read the next naturally scheduled current-worker failure. Use its safe substage/reason to reproduce the rejected condition with sanitized evidence before changing recovery rules. Recheck the real Week 2 full/compact responses for all leagues; a diagnostic deployment alone is not operational recovery. Do not force a provider request or rewrite immutable observations to obtain a success.

Rollback is a compatible application revert; no data rollback is required.
