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
import type { BracketFamily } from '../aggregator/playoff-brackets';
import type { RosterAttempt, RosterPopulationEvidence } from '../aggregator/current-roster';
import { isCalculationSourceCapture, type CalculationSourceCapture, type CalculationSourceAssociation } from './calculation-capture';
import { assertOriginalPublicCapture, type PublicCaptureWitness } from './public-capture-witness';
import { buildLegacyAdministrationInput } from './legacy-administration-input';
import { buildSleeperCanonicalStandingsDelivery } from './sleeper-canonical-standings';
import type { CanonicalSourceMappingV1 } from './canonical-source-contracts';
import type { CanonicalResourceAttempt, CanonicalStandingsPolicy, CanonicalObservationWriteResult } from './canonical-standings-contracts';

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
  results: readonly Readonly<{ family: AdministrationFamily; result: AdministrationWriteResult;
    canonicalStandings?: CanonicalObservationWriteResult }>[];
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
    /** Deployment-selected companion reserved before the original native players attempt. */
    canonicalStandings?: Readonly<{ mapping: CanonicalSourceMappingV1; policy: CanonicalStandingsPolicy;
      attempt: CanonicalResourceAttempt; captureId: string }>;
    managerAttempt?: RosterAttempt;
    /** Explicit sibling evidence; primary-complete v1 remains independently reserved. */
    managerEvidenceVersion?: 'v2';
    managerEvidenceAttempt?: RosterAttempt;
    leagueSettingsAttempt?: RosterAttempt;
    matchupAttempt?: Readonly<{ week: number; attempt: RosterAttempt }>;
    transactionAttempt?: Readonly<{ week: number; attempt: RosterAttempt }>;
    /** Both reservations precede the original witnessed bracket requests. */
    bracketAttempts?: Readonly<Record<BracketFamily, RosterAttempt>>;
    /** Exact report reservation, made before its original network request. */
    weeklyReportAttempt?: Readonly<{ week: number; attempt: RosterAttempt }>;
    /** One original ordinary draft endpoint, routed through the existing typed receipt writer. */
    draftAttempt?: Readonly<{ kind: 'metadata' | 'selections' | 'trades'; attempt: RosterAttempt }>;
    populationEvidence?: RosterPopulationEvidence;
    calendarEvidence?: SleeperCalendarEvidence;
    calculationCapture?: Readonly<{ week: number; reservation: CalculationSourceCapture }>;
    /** Expected pre-HTTP context; never attached to an older document by this writer. */
    expectedAcquisition?: PublicCaptureWitness;
    /** Public core only: retain the independently captured roster after a sibling league write failure. */
    retainIndependentCoreCaptures?: boolean;
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
  if (options.draftAttempt && (!options.mapping || !options.fence || options.expectedAcquisition?.work.kind !== 'drafts'
    || options.expectedAcquisition.attempts[options.draftAttempt.kind === 'metadata' ? 'draftMetadata'
      : options.draftAttempt.kind === 'selections' ? 'draftSelections' : 'tradedPicks']?.id !== options.draftAttempt.attempt.id
    || documents.length !== 1 || documents[0].family !== 'drafts' || documents[0].origin !== 'network')) {
    throw new Error('Draft capture requires its original reserved endpoint.');
  }
  if (options.retainIndependentCoreCaptures && (!options.mapping || !options.fence
    || options.expectedAcquisition?.work.kind !== 'core' || options.expectedAcquisition.work.season !== 2026
    || options.mapping.scope.season !== 2026 || options.populationEvidence !== undefined
    || options.expectedRosterCount !== undefined || options.calculationCapture !== undefined
    || documents.some(document => !['league', 'rosters'].includes(document.family)
      || document.week !== null || document.origin !== 'network'))) {
    throw new Error('Independent core capture requires its original public core witness and source documents.');
  }
  if (options.calculationCapture && (!options.mapping
    || !isCalculationSourceCapture(options.calculationCapture.reservation)
    || !Number.isInteger(options.calculationCapture.week) || options.calculationCapture.week < 1 || options.calculationCapture.week > 18
    || documents.filter(document => document.family === 'league').length !== 1
    || documents.filter(document => document.family === 'matchups' && document.week === options.calculationCapture!.week).length !== 1)) {
    throw new Error('Calculation source capture requires an exact league and matchup input.');
  }
  const results: { family: AdministrationFamily; result: AdministrationWriteResult; canonicalStandings?: CanonicalObservationWriteResult }[] = [];
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
    if (options.expectedAcquisition !== undefined) assertOriginalPublicCapture(document, options.expectedAcquisition);
    else if (document.acquisition !== undefined) throw new Error('Public capture requires its original acquisition context.');
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
        ...(document.acquisition !== undefined ? { acquisition: document.acquisition } : {}),
      },
      completeness: document.completeness ?? 'complete', payload: document.payload as JsonValue,
    }, { ...(expectedRosterCount === undefined ? {} : { expectedRosterCount }),
      ...(options.managerEvidenceVersion === 'v2' ? { managerEvidenceVersion: 'v2' as const } : {}) });
    const bracketAttempt = origin === 'network' && (document.family === 'winners_bracket' || document.family === 'losers_bracket')
      ? options.bracketAttempts?.[document.family] : undefined;
    const weeklyReportAttempt = origin === 'network' && document.family === 'weekly_report'
      && options.weeklyReportAttempt?.week === document.week ? options.weeklyReportAttempt.attempt : undefined;
    const draftAttempt = origin === 'network' && document.family === 'drafts' ? options.draftAttempt : undefined;
    let mapping = Boolean(draftAttempt) || Boolean(bracketAttempt) || Boolean(weeklyReportAttempt) || ['rosters', 'league'].includes(document.family)
      || document.family === 'transactions' && options.transactionAttempt?.week === document.week
      || (document.family === 'matchups' && (options.matchupAttempt?.week === document.week
        || options.calculationCapture?.week === document.week))
      ? options.mapping ?? undefined : undefined;
    let attempt = origin === 'network' && mapping && document.family === 'rosters' ? options.rosterAttempt : undefined;
    let managerAttempt = origin === 'network' && mapping && document.family === 'rosters' ? options.managerAttempt : undefined;
    let managerEvidenceAttempt = options.managerEvidenceVersion === 'v2' && origin === 'network' && mapping
      && document.family === 'rosters' ? options.managerEvidenceAttempt : undefined;
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
    let canonicalResult: CanonicalObservationWriteResult | undefined;
    const write = async (): Promise<AdministrationWriteResult> => {
      if (options.canonicalStandings && document.family === 'rosters') {
        if (!store.recordCanonicalObservation || !options.fence || !mapping || !attempt || origin !== 'network'
          || options.expectedAcquisition?.work.kind !== 'core') throw new Error('Canonical standings requires the original core capture.');
        const selected = options.canonicalStandings;
        const legacyInput = buildLegacyAdministrationInput(normalized, options.fence, mapping,
          { attempt, ...(population ? { population } : {}) },
          managerAttempt ? { attempt: managerAttempt, ...(population ? { population } : {}) } : undefined,
          undefined, undefined, undefined, undefined, undefined,
          managerEvidenceAttempt ? { attempt: managerEvidenceAttempt, ...(population ? { population } : {}) } : undefined);
        const delivery = buildSleeperCanonicalStandingsDelivery({ normalized, mapping: selected.mapping, policy: selected.policy,
          attempt: selected.attempt, fence: options.fence, captureId: selected.captureId, normalizedAt: now().toISOString(), legacyInput });
        canonicalResult = await store.recordCanonicalObservation(delivery, selected.mapping, selected.attempt, options.fence);
        if (!canonicalResult.legacyResult) throw new Error('Canonical bridge omitted its original native result.');
        return canonicalResult.legacyResult;
      }
      return draftAttempt
      ? store.recordObservation(normalized, options.fence, mapping, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        draftAttempt.kind === 'metadata' ? { attempt: draftAttempt.attempt } : undefined,
        draftAttempt.kind === 'selections' ? { attempt: draftAttempt.attempt } : undefined,
        draftAttempt.kind === 'trades' ? { attempt: draftAttempt.attempt } : undefined)
      : weeklyReportAttempt
      ? store.recordObservation(normalized, options.fence, mapping, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, { attempt: weeklyReportAttempt })
      : bracketAttempt
      ? store.recordObservation(normalized, options.fence, mapping, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, { attempt: bracketAttempt })
      : managerEvidenceAttempt
      ? store.recordObservation(normalized, options.fence, mapping,
        attempt ? { attempt, ...(population ? { population } : {}) } : undefined,
        managerAttempt ? { attempt: managerAttempt, ...(population ? { population } : {}) } : undefined,
        undefined, undefined, undefined, undefined, undefined,
        { attempt: managerEvidenceAttempt, ...(population ? { population } : {}) })
      : transactionAttempt
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
    };
    let result: AdministrationWriteResult;
    try { result = await write(); }
    catch (error) {
      // Each document owns a separate atomic write. Keep only the already captured
      // sibling; never retry, replace its witness, borrow prior population or extend work.
      if (!options.retainIndependentCoreCaptures || document.family !== 'league') throw error;
      signal.throwIfAborted();
      if (!options.fence || Date.parse(options.fence.deadlineAt) <= now().getTime()) throw error;
      results.push({ family: document.family, result: { status: 'rejected', reason: 'public_core_document_write_failed' } });
      continue;
    }
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
        if (options.managerEvidenceVersion === 'v2') {
          if (!store.beginTeamManagerEvidenceAttempt) throw new Error('Manager evidence v2 capture is unsupported by this store.');
          managerEvidenceAttempt = await store.beginTeamManagerEvidenceAttempt(mapping, randomUUID(), options.fence);
        }
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
          checkedAt: now().toISOString() } }, { ...(expectedRosterCount === undefined ? {} : { expectedRosterCount }),
        ...(options.managerEvidenceVersion === 'v2' ? { managerEvidenceVersion: 'v2' as const } : {}) });
      // Retain the pre-acquisition token through verification. A remap never
      // authorizes this older capture by substituting today's revision.
      result = await write();
      // The caller already transformed its original source. Retain the newer
      // evidence, but never label that older calculation with the newer version.
      sourceChangedDuringVerification ||= normalized.contentHash !== originalContentHash;
    }
    results.push({ family: document.family, result, ...(canonicalResult ? { canonicalStandings: canonicalResult } : {}) });
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

/** Shared directory evidence uses the same administration writer; acquisition must precede this call. */
export async function recordCapturedPlayerDirectory(
  attempt: import('./player-directory-contracts').PlayerDirectoryAttempt,
  capture: import('./player-directory-contracts').PlayerDirectoryCapture,
  options: Readonly<{ store: LeagueAdministrationStore; fence: AdministrationWriteFence; signal: AbortSignal }>,
) {
  const { assertOriginalPlayerDirectoryCapture } = await import('./player-directory');
  options.signal.throwIfAborted();
  if (!options.store.enabled) return { status: 'disabled' } as const;
  if (!options.fence || !options.store.recordPlayerDirectoryCapture) throw new Error('Player directory writer is unavailable.');
  assertOriginalPlayerDirectoryCapture(capture, attempt);
  return options.store.recordPlayerDirectoryCapture(attempt, capture, options.fence);
}
