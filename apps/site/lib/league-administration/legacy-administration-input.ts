import 'server-only';
import type { LeagueAdministrationStore } from './store-contracts';
import { TRADED_PICKS_LIMITS, projectTradedPicks } from '../aggregator/traded-picks';
import { DRAFT_SELECTIONS_LIMITS, projectDraftSelections } from '../aggregator/draft-selections';
import { DRAFT_METADATA_LIMITS, projectDraftMetadata } from '../aggregator/draft-metadata';
import { projectWeeklyReport } from '../aggregator/weekly-reports';
import { projectOfficialStandings } from '../aggregator/official-standings';
import { projectPlayoffBracket } from '../aggregator/playoff-brackets';

/** Exact original native submission. The canonical bridge retains this object without augmentation. */
export function buildLegacyAdministrationInput(...[input, fence, mapping, acceptance, managerAcceptance,
  leagueSettingsAcceptance, matchupAcceptance, calendarEvidence, calculationCapture, transactionAcceptance,
  managerEvidenceAcceptance, bracketAcceptance, weeklyReportAcceptance, draftMetadataAcceptance,
  draftSelectionsAcceptance, tradedPicksAcceptance]: Parameters<LeagueAdministrationStore['recordObservation']>) {
  const draftAddition = draftMetadataAcceptance ? { draftMetadataAcceptance, draftMetadataProjection: projectDraftMetadata(input) } : {};
  const selectionAddition = draftSelectionsAcceptance ? { draftSelectionsAcceptance, draftSelectionsProjection: projectDraftSelections(input) } : {};
  const tradeAddition = tradedPicksAcceptance ? { tradedPicksAcceptance, tradedPicksProjection: projectTradedPicks(input) } : {};
  const legacyInput = { ...input, ...draftAddition, ...selectionAddition, ...tradeAddition, ...(fence ? { writeFence: fence } : {}), ...(mapping ? { sourceMapping: mapping } : {}),
    ...(acceptance ? { rosterAcceptance: acceptance } : {}),
    ...(managerAcceptance ? { teamManagerAcceptance: managerAcceptance } : {}),
    ...(managerEvidenceAcceptance ? { teamManagerEvidenceAcceptance: managerEvidenceAcceptance } : {}),
    ...(leagueSettingsAcceptance ? { leagueSettingsAcceptance } : {}),
    ...(matchupAcceptance ? { matchupAcceptance } : {}), ...(calendarEvidence ? { calendarEvidence } : {}),
    ...(calculationCapture ? { calculationCapture } : {}), ...(transactionAcceptance ? { transactionAcceptance } : {}),
    ...(bracketAcceptance ? { bracketAcceptance, bracketProjection: projectPlayoffBracket(input) } : {}),
    ...(weeklyReportAcceptance ? { weeklyReportAcceptance, weeklyReportProjection: projectWeeklyReport(input) } : {}),
    ...(acceptance && input.envelope.family === 'rosters' && input.envelope.scope.season === 2026
      && input.envelope.provenance.acquisition?.work.kind === 'core'
      ? { officialStandings: projectOfficialStandings(input) } : {}) };
  const submission = JSON.stringify(legacyInput);
  if (draftMetadataAcceptance) {
    const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
    // Compact relational entries/links are no larger than their projection.
    // Reserve fixed receipt/header/UUID framing for at most eight facts, plus
    // every possible duplicate of the otherwise unbounded native league ID.
    const readAllowance = bytes(input.envelope.payload) + bytes(draftAddition.draftMetadataProjection?.value)
      + bytes(mapping) + bytes(input.envelope.provenance) + DRAFT_METADATA_LIMITS.framingBytes
      + DRAFT_METADATA_LIMITS.drafts * bytes(input.envelope.scope.externalLeagueId);
    if (Buffer.byteLength(submission, 'utf8') > DRAFT_METADATA_LIMITS.persistedBytes
      || readAllowance > DRAFT_METADATA_LIMITS.persistedBytes) throw new Error('Draft metadata persistence budget exceeded.');
  }
  if (draftSelectionsAcceptance) {
    const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
    const selected = selectionAddition.draftSelectionsProjection?.value;
    const rowFraming = (selected?.entries.length ?? 0) * (1_536 + 2 * bytes(input.envelope.scope.externalLeagueId)
      + 2 * bytes(selected?.kind === 'selections' ? selected.externalDraftId : null));
    const readAllowance = bytes(input.envelope.payload) + bytes(selectionAddition.draftSelectionsProjection?.value)
      + bytes(mapping) + bytes(input.envelope.provenance) + DRAFT_SELECTIONS_LIMITS.framingBytes + rowFraming;
    if (Buffer.byteLength(submission, 'utf8') > DRAFT_SELECTIONS_LIMITS.persistedBytes
      || readAllowance > DRAFT_SELECTIONS_LIMITS.persistedBytes - DRAFT_SELECTIONS_LIMITS.nativeBytes) throw new Error('Draft selections persistence budget exceeded.');
  }
  if (tradedPicksAcceptance) {
    const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
    const selected = tradeAddition.tradedPicksProjection?.value;
    const rowFraming = (selected?.entries.length ?? 0) * (2_048 + 2 * bytes(input.envelope.scope.externalLeagueId)
      + 2 * bytes(selected?.kind === 'draft' ? selected.externalDraftId : null));
    const readAllowance = bytes(input.envelope.payload) + bytes(selected) + bytes(mapping) + bytes(input.envelope.provenance)
      + TRADED_PICKS_LIMITS.framingBytes + rowFraming;
    if (Buffer.byteLength(submission, 'utf8') > TRADED_PICKS_LIMITS.persistedBytes
      || readAllowance > TRADED_PICKS_LIMITS.persistedBytes) throw new Error('Traded picks persistence budget exceeded.');
  }

  return legacyInput;
}
