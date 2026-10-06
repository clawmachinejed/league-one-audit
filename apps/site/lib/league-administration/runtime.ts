import 'server-only';
import { randomUUID } from 'node:crypto';
import { validateSleeperCalendarEvidence, type SleeperCalendarEvidence } from './period-mapping';

import { ADMINISTRATION_SCHEMA_VERSION, ADMINISTRATION_NORMALIZER_VERSION, ADMINISTRATION_DIALECT,
  type AdministrationScope, type AdministrationFamily, type JsonValue, type CapturedAdministrationDocument } from './contracts';
import { normalizeAdministrationObservation } from './normalize';
import { createLeagueAdministrationStore } from './store';
import { getDatabase, withDatabaseAbortSignal } from '../database';
import type { AdministrationWriteResult, AdministrationWriteFence, LeagueAdministrationStore } from './store-contracts';
import { isAdministrationSourceMapping, type AdministrationSourceMapping } from './source-mapping';
import type { RosterAttempt, RosterPopulationEvidence } from '../aggregator/current-roster';
import { isCalculationSourceCapture, type CalculationSourceCapture, type CalculationSourceAssociation } from './calculation-capture';

/** Called by existing enrolled collectors before loading any roster document. */
export async function captureAdministrationSourceMapping(externalLeagueId: string,
  store = createLeagueAdministrationStore(withDatabaseAbortSignal(getDatabase(), AbortSignal.timeout(3_000)))) {
  return store.enabled ? store.readSourceMapping(externalLeagueId) : null;
}

/** Independent lineage reservation; never changes any accepted-resource attempt or head. */
export async function beginCalculationSourceCapture(mapping: AdministrationSourceMapping, week: number,
  store = createLeagueAdministrationStore(withDatabaseAbortSignal(getDatabase(), AbortSignal.timeout(3_000)))) {
  return store.enabled ? store.beginCalculationSourceCapture(mapping, week, randomUUID()) : null;
}

/** These documents come from the existing official loaders, never from page reads. */
export type { CapturedAdministrationDocument } from './contracts';
export type AdministrationCalculationContext = Readonly<{
  observationId: string; configurationVersionId: string; generation: number;
  sourceCapture?: CalculationSourceAssociation;
}>;
export type AdministrationCaptureResult = Readonly<{
  status: 'stored' | 'disabled' | 'unavailable';
  results: readonly Readonly<{ family: AdministrationFamily; result: AdministrationWriteResult }>[];
  context?: AdministrationCalculationContext;
  /** The same run may collect later periods after its independently observed league document. */
  population?: RosterPopulationEvidence;
}>;

/** A collection failure remains visible; it never makes a rejected setting current. */
export async function recordCapturedAdministration(
  scope: AdministrationScope,
  documents: readonly CapturedAdministrationDocument[],
  options: Readonly<{ store?: LeagueAdministrationStore; now?: () => Date; fence?: AdministrationWriteFence;
    signal?: AbortSignal; expectedRosterCount?: number; mapping?: AdministrationSourceMapping | null;
    rosterAttempt?: RosterAttempt;
    managerAttempt?: RosterAttempt;
    leagueSettingsAttempt?: RosterAttempt;
    matchupAttempt?: Readonly<{ week: number; attempt: RosterAttempt }>;
    transactionAttempt?: Readonly<{ week: number; attempt: RosterAttempt }>;
    populationEvidence?: RosterPopulationEvidence;
    calendarEvidence?: SleeperCalendarEvidence;
    calculationCapture?: Readonly<{ week: number; reservation: CalculationSourceCapture }>;
    verify?: (document: CapturedAdministrationDocument, signal: AbortSignal) => Promise<CapturedAdministrationDocument> }> = {},
): Promise<AdministrationCaptureResult> {
  const signal = options.signal ?? AbortSignal.timeout(8_000);
  const store = options.store ?? createLeagueAdministrationStore(withDatabaseAbortSignal(getDatabase(), signal));
  if (!store.enabled) return { status: 'disabled', results: [] };
  if (options.mapping && (!isAdministrationSourceMapping(options.mapping)
    || Object.entries(scope).some(([key, value]) => options.mapping!.scope[key as keyof AdministrationScope] !== value))) {
    throw new Error('Administration capture mapping does not match the requested scope.');
  }
  const now = options.now ?? (() => new Date());
  if (options.calculationCapture && (!options.mapping
    || !isCalculationSourceCapture(options.calculationCapture.reservation)
    || !Number.isInteger(options.calculationCapture.week) || options.calculationCapture.week < 1 || options.calculationCapture.week > 18
    || documents.filter(document => document.family === 'league').length !== 1
    || documents.filter(document => document.family === 'matchups' && document.week === options.calculationCapture!.week).length !== 1)) {
    throw new Error('Calculation source capture requires an exact league and matchup input.');
  }
  const results: { family: AdministrationFamily; result: AdministrationWriteResult }[] = [];
  let context: AdministrationCalculationContext | undefined;
  let sourceChangedDuringVerification = false;
  let captureInputReplaced = false;
  let leagueInputId: string | undefined;
  let matchupInputId: string | undefined;
  let expectedRosterCount = options.expectedRosterCount;
  let population: RosterPopulationEvidence | undefined = options.populationEvidence;
  // Configuration first supplies the expected roster population, not the other way around.
  const ordered = [...documents].sort((left, right) => Number(right.family === 'league') - Number(left.family === 'league'));
  for (const document of ordered) {
    signal.throwIfAborted();
    const origin = document.origin ?? 'cache';
    let normalized = normalizeAdministrationObservation({
      schemaVersion: ADMINISTRATION_SCHEMA_VERSION,
      normalizerVersion: ADMINISTRATION_NORMALIZER_VERSION,
      dialect: ADMINISTRATION_DIALECT,
      scope, family: document.family, week: document.week,
      provenance: {
        origin, requestStartedAt: document.requestStartedAt, requestCompletedAt: document.requestCompletedAt,
        sourceObservedAt: document.sourceObservedAt !== undefined ? document.sourceObservedAt
          : origin === 'network' ? document.requestCompletedAt : null,
        checkedAt: now().toISOString(),
      },
      completeness: document.completeness ?? 'complete', payload: document.payload as JsonValue,
    }, expectedRosterCount === undefined ? undefined : { expectedRosterCount });
    let mapping = ['rosters', 'league'].includes(document.family)
      || document.family === 'transactions' && options.transactionAttempt?.week === document.week
      || (document.family === 'matchups' && (options.matchupAttempt?.week === document.week
        || options.calculationCapture?.week === document.week))
      ? options.mapping ?? undefined : undefined;
    let attempt = origin === 'network' && mapping && document.family === 'rosters' ? options.rosterAttempt : undefined;
    let managerAttempt = origin === 'network' && mapping && document.family === 'rosters' ? options.managerAttempt : undefined;
    let leagueSettingsAttempt = origin === 'network' && mapping && document.family === 'league' ? options.leagueSettingsAttempt : undefined;
    let matchupAttempt = origin === 'network' && mapping && document.family === 'matchups'
      && options.matchupAttempt?.week === document.week ? options.matchupAttempt.attempt : undefined;
    let transactionAttempt = origin === 'network' && mapping && document.family === 'transactions'
      && options.transactionAttempt?.week === document.week ? options.transactionAttempt.attempt : undefined;
    let matchupPopulationEligible = true;
    let calculationCapture = mapping && normalized.status === 'accepted' && normalized.envelope.completeness === 'complete'
      && ((document.family === 'league' && (origin === 'cache' || origin === 'network'))
        || (document.family === 'matchups' && document.week === options.calculationCapture?.week && origin === 'network'))
      ? options.calculationCapture?.reservation : undefined;
    // Retain only evidence acquired alongside this exact original league document.
    // Unknown cache age is preserved, and verification never grafts this proof onto a new document.
    const payload = normalized.envelope.payload;
    const leaguePayload = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Readonly<Record<string, JsonValue>> : null;
    let calendarEvidence = document.family === 'league' && mapping && normalized.status === 'accepted'
      && normalized.envelope.completeness === 'complete' && leaguePayload
      && leaguePayload.sport === 'nfl' && leaguePayload.season_type === 'regular'
      ? validateSleeperCalendarEvidence(options.calendarEvidence, String(scope.season)) ?? undefined : undefined;
    const write = () => transactionAttempt
      ? store.recordObservation(normalized, options.fence, mapping, undefined, undefined, undefined,
        undefined, undefined, undefined, { attempt: transactionAttempt })
      : calculationCapture
      ? store.recordObservation(normalized, options.fence, mapping,
        attempt ? { attempt, ...(population ? { population } : {}) } : undefined,
        managerAttempt ? { attempt: managerAttempt, ...(population ? { population } : {}) } : undefined,
        leagueSettingsAttempt ? { attempt: leagueSettingsAttempt } : undefined,
        matchupAttempt ? { attempt: matchupAttempt, ...(population && matchupPopulationEligible ? { population } : {}) } : undefined,
        calendarEvidence, calculationCapture)
      : calendarEvidence
      ? store.recordObservation(normalized, options.fence, mapping, undefined, undefined,
        leagueSettingsAttempt ? { attempt: leagueSettingsAttempt } : undefined, undefined, calendarEvidence)
      : matchupAttempt
      ? store.recordObservation(normalized, options.fence, mapping, undefined, undefined, undefined,
        { attempt: matchupAttempt, ...(population && matchupPopulationEligible ? { population } : {}) })
      : attempt || managerAttempt || leagueSettingsAttempt
        ? store.recordObservation(normalized, options.fence, mapping,
        attempt ? { attempt, ...(population ? { population } : {}) } : undefined,
        managerAttempt ? { attempt: managerAttempt, ...(population ? { population } : {}) } : undefined,
        leagueSettingsAttempt ? { attempt: leagueSettingsAttempt } : undefined)
        : store.recordObservation(normalized, options.fence, document.family === 'rosters' ? mapping : undefined);
    let result = await write();
    if (result.status === 'stale' && result.reason === 'unproven_cache_change' && origin === 'cache') {
      // Only changed cached documents need a fresh verification. Never overwrite a
      // newer network observation using an unknown cache age, or refetch a whole league.
      signal.throwIfAborted();
      // Reserve only this already-needed NETWORK acquisition. Ordinary cache
      // checks cannot suppress another in-flight network capture.
      if (mapping && document.family === 'league') {
        leagueSettingsAttempt = await store.beginLeagueSettingsAttempt(mapping, randomUUID(), options.fence);
      } else if (mapping && document.family === 'rosters') {
        const attempts = await store.beginRosterCapture(mapping, randomUUID(), randomUUID(), options.fence);
        attempt = attempts.players; managerAttempt = attempts.managers;
      } else if (document.family === 'matchups' && options.mapping && document.week !== null) {
        mapping = options.mapping;
        matchupAttempt = await store.beginExactMatchupAttempt(mapping, document.week, randomUUID(), options.fence);
        // The prior league document predates this newly reserved verification.
        // Preserve the legacy verification write without claiming shadow population.
        matchupPopulationEligible = false;
      } else if (document.family === 'transactions' && options.mapping && document.week !== null) {
        mapping = options.mapping;
        transactionAttempt = await store.beginTransactionAttempt(mapping, document.week, randomUUID(), options.fence);
      }
      const source = options.verify ? null : await import('../sleeper');
      const verified: CapturedAdministrationDocument = options.verify ? await options.verify(document, signal)
        : document.family === 'drafts'
          ? (await source!.getOfficialDraftAdministration(scope.externalLeagueId, scope.season, { signal, maxRequests: 25 })).observations[0]
          : await source!.getOfficialAdministrationObservation(scope.externalLeagueId, document.family, document.week, 0, signal);
      if (verified.family !== document.family || verified.week !== document.week || verified.origin !== 'network') {
        throw new Error('Administration verification did not return the requested network document.');
      }
      const originalContentHash = normalized.contentHash;
      // The caller consumed the original document. A verification result cannot
      // become that document's capture evidence, even when its content is equal.
      captureInputReplaced ||= document.family === 'league' || document.family === 'matchups';
      calculationCapture = undefined;
      calendarEvidence = undefined;
      normalized = normalizeAdministrationObservation({ schemaVersion: ADMINISTRATION_SCHEMA_VERSION,
        normalizerVersion: ADMINISTRATION_NORMALIZER_VERSION, dialect: ADMINISTRATION_DIALECT,
        scope, family: verified.family, week: verified.week, completeness: verified.completeness ?? 'complete',
        payload: verified.payload as JsonValue,
        provenance: { origin: 'network', requestStartedAt: verified.requestStartedAt,
          requestCompletedAt: verified.requestCompletedAt, sourceObservedAt: verified.sourceObservedAt !== undefined
            ? verified.sourceObservedAt : verified.requestCompletedAt,
          checkedAt: now().toISOString() } }, expectedRosterCount === undefined ? undefined : { expectedRosterCount });
      // Retain the pre-acquisition token through verification. A remap never
      // authorizes this older capture by substituting today's revision.
      result = await write();
      // The caller already transformed its original source. Retain the newer
      // evidence, but never label that older calculation with the newer version.
      sourceChangedDuringVerification ||= normalized.contentHash !== originalContentHash;
    }
    results.push({ family: document.family, result });
    if (calculationCapture && ['changed', 'unchanged', 'replayed'].includes(result.status) && result.calculationInput) {
      if (document.family === 'league') leagueInputId = result.calculationInput.id;
      if (document.family === 'matchups') matchupInputId = result.calculationInput.id;
    }
    if (document.family === 'league') {
      if (normalized.status === 'accepted' && normalized.value?.family === 'league') {
        expectedRosterCount = normalized.value.totalRosters ?? undefined;
        if (normalized.envelope.provenance.origin === 'network'
          && result.observationId && (['changed', 'unchanged', 'replayed'].includes(result.status)
            || result.leagueSettingsAcceptance?.status === 'accepted')) {
          population = { observationId: result.observationId, contentHash: normalized.contentHash, envelope: normalized.envelope };
        }
      }
      if (['changed', 'unchanged', 'replayed'].includes(result.status)
        && result.observationId && result.versionId && result.generation !== undefined) {
        context = { observationId: result.observationId,
          configurationVersionId: result.versionId, generation: result.generation };
      }
    }
  }
  if (context && options.calculationCapture && leagueInputId && matchupInputId && !captureInputReplaced) {
    context = { ...context, sourceCapture: { captureId: options.calculationCapture.reservation.id, leagueInputId, matchupInputId } };
  }
  return {
    status: sourceChangedDuringVerification || results.some(({ result }) => ['rejected', 'stale', 'disabled'].includes(result.status))
      ? 'unavailable' : 'stored', results, ...(context && !sourceChangedDuringVerification ? { context } : {}),
    ...(population ? { population } : {}),
  };
}
