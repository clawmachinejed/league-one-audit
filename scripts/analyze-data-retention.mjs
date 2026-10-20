#!/usr/bin/env node
// Offline sensitivity arithmetic only: local JSON reads and stdout; no SQL, network, child processes, or writes.
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import assert from "node:assert/strict";

const GIB = 1024 ** 3;
const PIN = Object.freeze({
  artifactSha256: "acaaf6ab5493e9193c45a8ea4fd7c181aeb63d09cd6b7b585cabbe5ff17450fe",
  artifactBytes: 1038171,
  gitSha: "b41fca034e9982014f3396f960c91c3a718b0169",
  datasetDigest: "627a597e81d7a762ec7c1258eff43471065ba18277fd064a6209d3b59ff843c4",
  tableCountsSha256: "a0593e7de6257cb420ebb4da347951b856f7fd044e9b4f5dbf1d564317a9ce4e",
});
const DATASET = Object.freeze({ leagues: 16, rosters: 320, weeks: 288, players: 160, receiptCount: 848 });
const sha = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => { throw new Error(message); };
function exact(value, names, label) {
  if (!value || Array.isArray(value) || typeof value !== "object" ||
      Object.keys(value).sort().join("|") !== [...names].sort().join("|")) fail("Invalid fields: " + label);
}
function number(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max ||
      (integer && !Number.isSafeInteger(value))) fail("Invalid numeric input: " + label);
  return value;
}
function json(path, maxBytes = 2 * 1024 ** 2) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > maxBytes) fail("Input is not a bounded local JSON file");
  return JSON.parse(readFileSync(path, "utf8"));
}
function validateSeed(seed) {
  exact(seed, ["schemaVersion", "qualification", "provenance", "dataset", "measurements", "tables"], "seed");
  if (seed.schemaVersion !== 1 || seed.qualification !== "UNQUALIFIED") fail("Invalid seed version/status");
  assert.deepEqual(seed.provenance, PIN, "Pinned source/hash mismatch");
  assert.deepEqual(seed.dataset, DATASET, "Pinned dataset count mismatch");
  exact(seed.measurements, ["relationCount", "rowCount", "allocatedBytes", "metric", "indexesAndToastIncluded", "columnSizeMeasured"], "measurements");
  const m = seed.measurements;
  if (m.relationCount !== 113 || m.rowCount !== 101272 || m.allocatedBytes !== 47693824 ||
      m.metric !== "pg_total_relation_size" || m.indexesAndToastIncluded !== true || m.columnSizeMeasured !== false) fail("Pinned measurement mismatch");
  if (!Array.isArray(seed.tables) || seed.tables.length !== m.relationCount) fail("Missing table inventory");
  const names = new Set();
  let rows = 0, bytes = 0;
  for (const t of seed.tables) {
    exact(t, ["table", "rows", "totalBytes"], "table");
    if (typeof t.table !== "string" || !/^[a-z][a-z0-9_]+$/.test(t.table) || names.has(t.table)) fail("Invalid/duplicate table");
    names.add(t.table);
    rows += number(t.rows, "rows", { integer: true });
    bytes += number(t.totalBytes, "totalBytes", { integer: true });
    if (t.rows > 0 && t.totalBytes === 0) fail("Rows without allocation");
  }
  if (rows !== m.rowCount || bytes !== m.allocatedBytes || sha(JSON.stringify(seed.tables)) !== PIN.tableCountsSha256) fail("Table count/content digest mismatch");
  return seed;
}
function validateEvidence(path, seed) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size !== PIN.artifactBytes) fail("Original artifact size mismatch");
  const bytes = readFileSync(path);
  if (sha(bytes) !== PIN.artifactSha256) fail("Original artifact hash mismatch");
  const evidence = JSON.parse(bytes);
  if (evidence.gitSha !== PIN.gitSha || evidence.sourceDigest !== PIN.datasetDigest) fail("Original source mismatch");
  assert.deepEqual(evidence.tableCounts, seed.tables, "Original table extraction mismatch");
  for (const [key, value] of Object.entries(DATASET)) {
    if (evidence.dataset?.[key] !== value) fail("Original dataset count mismatch");
  }
}
const scenarioFields = [
  "name", "activeRefreshMinutes", "heldPlayersPerLeague", "catalogPlayers", "allocationRatioFactor",
  "coreChangedFraction", "exactChangedFraction", "historyChangedFraction", "transactionChangedFraction",
  "bracketChangedFraction", "reportChangedFraction", "draftChangedFraction", "directoryChangedFraction",
  "catalogChangedFraction", "unmeasuredControlReserveFraction", "mvccReserveFraction", "sharedDependencyReserveBytes",
];
function validateAssumptions(a) {
  exact(a, ["schemaVersion", "qualification", "horizon", "budgetBytes", "benchmarkUniqueLeagues", "uniqueLeagueSensitivities", "cadence", "scenarios", "interpretation"], "assumptions");
  if (a.schemaVersion !== 1 || a.qualification !== "UNQUALIFIED") fail("Invalid assumptions version/status");
  exact(a.horizon, ["start", "endExclusive", "days", "activeDays", "inactiveDays", "activeHoursPerDay"], "horizon");
  const h = a.horizon;
  if (h.start !== "2026-01-01" || h.endExclusive !== "2028-04-01" || h.days !== 821 ||
      (Date.parse(h.endExclusive) - Date.parse(h.start)) / 86400000 !== h.days) fail("Invalid retention horizon");
  number(h.activeDays, "activeDays", { integer: true });
  number(h.inactiveDays, "inactiveDays", { integer: true });
  number(h.activeHoursPerDay, "activeHoursPerDay", { min: 1, max: 24 });
  if (h.activeDays + h.inactiveDays !== h.days) fail("Horizon day partition mismatch");
  if (a.budgetBytes !== 10 * GIB || a.benchmarkUniqueLeagues !== 16) fail("Contract budget/benchmark mismatch");
  if (!Array.isArray(a.uniqueLeagueSensitivities) || a.uniqueLeagueSensitivities.length === 0 ||
      new Set(a.uniqueLeagueSensitivities).size !== a.uniqueLeagueSensitivities.length) fail("Missing/duplicate league sensitivities");
  a.uniqueLeagueSensitivities.forEach((n) => number(n, "unique leagues", { min: 16, max: 100000, integer: true }));
  if (!a.uniqueLeagueSensitivities.includes(16)) fail("Benchmark sensitivity missing");
  exact(a.cadence, ["inactiveRefreshesPerDay", "dailyResourceRefreshesPerDay", "bracketAndReportActiveMinutes", "catalogRefreshesPerDay", "historicalPeriodsPerDailySweep", "draftsPerLeague", "rostersPerLeague", "coreTypedCapturesPerDispatch"], "cadence");
  const c = a.cadence;
  for (const [k, v] of Object.entries(c)) number(v, k, { min: 0, max: 100000, integer: true });
  if (c.bracketAndReportActiveMinutes < 1 || c.bracketAndReportActiveMinutes > 1440 ||
      c.rostersPerLeague !== 20 || c.historicalPeriodsPerDailySweep > 17 || c.draftsPerLeague < 1 ||
      ![3, 4].includes(c.coreTypedCapturesPerDispatch)) fail("Impossible cadence or fixture geometry");
  if (typeof a.interpretation !== "string" || a.interpretation.length < 50) fail("Missing assumption interpretation");
  if (!Array.isArray(a.scenarios) || a.scenarios.length === 0) fail("Missing scenarios");
  const names = new Set();
  for (const s of a.scenarios) {
    exact(s, scenarioFields, "scenario");
    if (typeof s.name !== "string" || !/^[a-z][a-z0-9-]*$/.test(s.name) || names.has(s.name)) fail("Invalid/duplicate scenario");
    names.add(s.name);
    number(s.activeRefreshMinutes, "activeRefreshMinutes", { min: 1, max: 1440 });
    number(s.heldPlayersPerLeague, "heldPlayersPerLeague", { min: 1, max: 100000, integer: true });
    number(s.catalogPlayers, "catalogPlayers", { min: 160, max: 1000000, integer: true });
    if (s.heldPlayersPerLeague > s.catalogPlayers) fail("Held players exceed distinct catalog");
    number(s.allocationRatioFactor, "allocationRatioFactor", { min: 0.001, max: 100 });
    for (const k of scenarioFields.filter((x) => x.endsWith("Fraction"))) number(s[k], k, { max: 1 });
    number(s.sharedDependencyReserveBytes, "sharedDependencyReserveBytes", { integer: true });
  }
  return a;
}
// Every relation belongs to at most one incremental group. Existing allocation is added once,
// independently of these ratios. Ratios include indexes/TOAST and are NOT measured marginal slopes.
const GROUPS = {
  proof: ["league_roster_capture_receipts", "league_roster_resource_attempts", "league_roster_resource_acceptances"],
  rosterLinks: ["league_roster_player_link_receipts", "league_roster_player_links"],
  exactValues: ["league_exact_matchup_value_contents", "league_exact_matchup_team_values", "league_exact_matchup_player_points", "league_exact_matchup_starter_points"],
  rawObservations: ["league_administration_contents", "league_administration_observations"],
  rawTeamEntries: ["league_administration_team_entries"],
  transactionEntries: ["league_administration_transaction_entries"],
  catalogContent: ["league_player_directory_contents", "league_player_directory_entries"],
  catalogObservation: ["league_player_directory_attempts", "league_player_directory_captures", "league_player_directory_source_slices", "league_player_directory_versions"],
  dispatch: ["public_data_dispatches", "public_data_dispatch_outcomes"],
  standingsCapture: ["league_official_standings_captures"],
  standingsContent: ["league_official_standings_contents", "league_official_standings_teams"],
  directoryCapture: ["public_data_directory_captures"],
  directoryContent: ["league_manager_directory_versions", "league_manager_directory_entries"],
  brackets: ["league_bracket_contents", "league_bracket_rounds", "league_bracket_matches", "league_bracket_edges", "league_bracket_entrants", "league_bracket_results"],
  reports: ["league_weekly_report_contents", "league_weekly_report_teams"],
  draftValues: ["league_draft_metadata_contents", "league_draft_metadata_entries", "league_draft_metadata_facts", "league_draft_metadata_slot_rosters", "league_draft_metadata_user_slots", "league_draft_selection_contents", "league_draft_selection_entries", "league_traded_pick_contents", "league_traded_pick_entries"],
  draftLinks: ["league_draft_selection_link_receipts", "league_draft_selection_player_links"],
};
const UNITS = {
  proof: [848, "typed capture: receipt + attempt + acceptance"],
  rosterLinks: [32, "roster capture with 160 held-player links"],
  exactValues: [288, "exact league-period content with 20 teams and 160 players"],
  rawObservations: [480, "legacy raw content plus observation"],
  rawTeamEntries: [6080, "legacy raw team entry"],
  transactionEntries: [16, "transaction response containing the seed average of 20 entries"],
  catalogContent: [1, "whole distinct shared catalog content with 160 players"],
  catalogObservation: [1, "shared successful catalog observation"],
  dispatch: [528, "dispatch plus outcome"],
  standingsCapture: [32, "standings capture"],
  standingsContent: [16, "standings content with 20 teams"],
  directoryCapture: [32, "manager directory capture"],
  directoryContent: [16, "manager directory content"],
  brackets: [16, "paired bracket content"],
  reports: [16, "weekly report content"],
  draftValues: [16, "draft cycle with one draft and 20 selections; stable selection/asset identities excluded"],
  draftLinks: [16, "draft-selection acceptance with 20 links"],
};
function groups(seed) {
  const byTable = new Map(seed.tables.map((t) => [t.table, t]));
  const seen = new Set(), result = {};
  for (const [name, tables] of Object.entries(GROUPS)) {
    let allocatedBytes = 0, rows = 0;
    for (const t of tables) {
      if (!byTable.has(t) || seen.has(t)) fail("Missing/overlapping allocation group");
      seen.add(t); allocatedBytes += byTable.get(t).totalBytes; rows += byTable.get(t).rows;
    }
    result[name] = { tables, allocatedBytes, rows, seedDenominator: UNITS[name][0], seedUnit: UNITS[name][1], allocatedBytesPerSeedUnit: allocatedBytes / UNITS[name][0] };
  }
  return { groups: result, snapshotOnlyTables: seed.tables.filter((t) => !seen.has(t.table)) };
}
const rounded = (n) => Math.round(number(n, "calculated result") * 1000) / 1000;
const signedRounded = (n) => Math.round(n * 1000) / 1000;
function forecast(seed, a, s, leagues, rates) {
  const h = a.horizon, c = a.cadence, f = s.allocationRatioFactor;
  const active = h.activeDays * h.activeHoursPerDay * 60 / s.activeRefreshMinutes;
  const inactive = h.inactiveDays * c.inactiveRefreshesPerDay;
  const recurring = active + inactive;
  const daily = h.days * c.dailyResourceRefreshesPerDay;
  const history = daily * c.historicalPeriodsPerDailySweep;
  const brackets = h.activeDays * h.activeHoursPerDay * 60 / c.bracketAndReportActiveMinutes + inactive;
  const draftDispatchesPerCycle = 2 + 3 * c.draftsPerLeague;
  const events = {
    coreDispatches: recurring * leagues,
    currentExactDispatches: recurring * leagues,
    historicalExactDispatches: history * leagues,
    currentTransactionDispatches: recurring * leagues,
    historicalTransactionDispatches: history * leagues,
    bracketDispatches: brackets * leagues,
    reportDispatches: brackets * leagues,
    draftCycles: daily * leagues,
    draftDispatches: daily * draftDispatchesPerCycle * leagues,
    directoryDispatches: daily * leagues,
    catalogObservationsShared: h.days * c.catalogRefreshesPerDay,
  };
  const exact = events.currentExactDispatches + events.historicalExactDispatches;
  const transactions = events.currentTransactionDispatches + events.historicalTransactionDispatches;
  events.typedCaptureTriples = c.coreTypedCapturesPerDispatch * events.coreDispatches + 2 * exact + transactions +
    2 * events.bracketDispatches + events.reportDispatches + events.draftDispatches;
  events.dispatchOutcomePairs = events.coreDispatches + exact + transactions + events.bracketDispatches +
    events.reportDispatches + events.draftDispatches + events.directoryDispatches;
  events.rosterLinkCaptures = events.coreDispatches;
  events.rosterPlayerLinkRows = events.coreDispatches * s.heldPlayersPerLeague;
  events.changedExactContents = events.currentExactDispatches * s.exactChangedFraction + events.historicalExactDispatches * s.historyChangedFraction;
  events.changedCoreCaptures = events.coreDispatches * s.coreChangedFraction;
  events.changedTransactionContents = events.currentTransactionDispatches * s.transactionChangedFraction +
    events.historicalTransactionDispatches * s.historyChangedFraction;
  events.changedCatalogContentsShared = events.catalogObservationsShared * s.catalogChangedFraction;
  events.changedBracketPairs = events.bracketDispatches * s.bracketChangedFraction;
  events.changedReportContents = events.reportDispatches * s.reportChangedFraction;
  events.changedDraftCycles = events.draftCycles * s.draftChangedFraction * c.draftsPerLeague;
  events.changedDirectoryContents = events.directoryDispatches * s.directoryChangedFraction;
  events.draftSelectionLinkCaptures = events.draftCycles * c.draftsPerLeague;
  // Raw event inventory is a separate, deliberately limited model: settings+rosters for changed
  // core, selected matchup for changed exact, and selected transaction response. Other raw growth
  // and control/checkpoint/task/identity growth remain explicit unmeasured families.
  events.modeledChangedRawObservations = 2 * events.changedCoreCaptures + events.changedExactContents + events.changedTransactionContents;
  events.modeledChangedRawTeamRows = c.rostersPerLeague * (events.changedCoreCaptures + events.changedExactContents);
  const components = {};
  const add = (name, value) => { components[name] = number(value, name); };
  const cost = (name, denominator, count) => rates[name].allocatedBytes / denominator * count * f;
  add("captureProof", cost("proof", 848, events.typedCaptureTriples));
  add("rosterLinkFanout", cost("rosterLinks", 32, events.rosterLinkCaptures) * s.heldPlayersPerLeague / 160);
  add("changedExactTypedValues", cost("exactValues", 288, events.changedExactContents) * s.heldPlayersPerLeague / 160);
  add("changedRawObservations", cost("rawObservations", 480, events.modeledChangedRawObservations));
  add("changedRawTeamEntries", cost("rawTeamEntries", 6080, events.modeledChangedRawTeamRows));
  add("changedTransactionEntries", cost("transactionEntries", 16, events.changedTransactionContents));
  add("sharedCatalogObservations", cost("catalogObservation", 1, events.catalogObservationsShared));
  add("sharedChangedCatalogVersions", cost("catalogContent", 1, events.changedCatalogContentsShared) * s.catalogPlayers / 160);
  add("dispatchOutcomes", cost("dispatch", 528, events.dispatchOutcomePairs));
  add("standingsCaptures", cost("standingsCapture", 32, events.coreDispatches));
  add("changedStandingsContents", cost("standingsContent", 16, events.changedCoreCaptures));
  add("directoryCaptures", cost("directoryCapture", 32, events.directoryDispatches));
  add("changedDirectoryContents", cost("directoryContent", 16, events.changedDirectoryContents));
  add("changedBracketContents", cost("brackets", 16, events.changedBracketPairs));
  add("changedReportContents", cost("reports", 16, events.changedReportContents));
  add("changedDraftContents", cost("draftValues", 16, events.changedDraftCycles));
  // Fixture has 20 selections per draft. Every complete selection acceptance retains its link proof.
  add("draftSelectionLinks", cost("draftLinks", 16, events.draftSelectionLinkCaptures));
  const incremental = Object.values(components).reduce((n, x) => n + x, 0);
  const sharedSeed = seed.tables.filter((t) => t.table.startsWith("league_player_directory_")).reduce((n, t) => n + t.totalBytes, 0);
  const additionalLeagueSeed = (seed.measurements.allocatedBytes - sharedSeed) / 16 * (leagues - 16) * f;
  const largerCatalogSeed = rates.catalogContent.allocatedBytes / 160 * (s.catalogPlayers - 160) * f;
  const unmeasuredControlReserve = incremental * s.unmeasuredControlReserveFraction;
  const beforeMvcc = seed.measurements.allocatedBytes + additionalLeagueSeed + largerCatalogSeed + incremental +
    unmeasuredControlReserve + s.sharedDependencyReserveBytes;
  const mvccReserve = beforeMvcc * s.mvccReserveFraction;
  const total = beforeMvcc + mvccReserve;
  number(total, "forecast total");
  const rosterCostPerLeague = rates.rosterLinks.allocatedBytes / 32 * s.heldPlayersPerLeague / 160 * f;
  const rosterOnlyDays = (a.budgetBytes - seed.measurements.allocatedBytes) /
    (leagues * h.activeHoursPerDay * 60 / s.activeRefreshMinutes * rosterCostPerLeague);
  return {
    scenario: s.name, uniqueLeagues: leagues, qualification: "UNQUALIFIED",
    activeCadenceMeetsFiveMinuteSchedulingSensitivity: s.activeRefreshMinutes <= 5,
    freshnessProven: false, events: Object.fromEntries(Object.entries(events).map(([k, v]) => [k, rounded(v)])),
    componentBytes: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, rounded(v)])),
    budget: {
      existingMeasuredPrefixAllocationBytes: seed.measurements.allocatedBytes,
      additionalLeagueSeedAssumptionBytes: rounded(additionalLeagueSeed),
      largerSharedCatalogSeedAssumptionBytes: rounded(largerCatalogSeed),
      incrementalAllocationRatioBytes: rounded(incremental),
      unmeasuredControlAndOmittedFamilyReserveBytes: rounded(unmeasuredControlReserve),
      unmeasuredSharedDependenciesReserveBytes: s.sharedDependencyReserveBytes,
      mvccAndOperationalReserveBytes: rounded(mvccReserve),
      forecastBytes: rounded(total), forecastGiB: rounded(total / GIB),
      budgetBytes: a.budgetBytes, headroomBytes: signedRounded(a.budgetBytes - total),
      modeledBudgetExceeded: total > a.budgetBytes,
      completeBudgetFitProven: false,
    },
    unchangedRosterOnlyBudgetExhaustionActiveDays: rounded(rosterOnlyDays),
    breakEvenMeaning: "10 GiB minus the original seed, divided by only fresh unchanged roster-link fanout at this cadence and occupancy; omits every other growth component and reserve. Active-day units, not a calendar forecast.",
  };
}
function report(seed, assumptions, originalVerified) {
  const inventory = groups(seed);
  return {
    schemaVersion: 1, qualification: "UNQUALIFIED",
    originalEvidenceVerification: originalVerified ? "ORIGINAL_HASH_SOURCE_AND_TABLE_EXTRACTION_REVERIFIED" : "SEED_VALIDATED_ORIGINAL_NOT_REVERIFIED",
    provenance: seed.provenance,
    assumptionsSha256: sha(JSON.stringify(assumptions)),
    measurement: seed.measurements,
    horizon: assumptions.horizon,
    interpretation: assumptions.interpretation,
    warnings: [
      "This is a partial offline allocation-ratio sensitivity, not measured growth, storage qualification, endurance evidence, a capacity guarantee, or statistical bounds. Fractional event counts are expected values under assumed fractions, not observed event counts.",
      "The 113-relation prefix snapshot includes indexes/TOAST already; no added index multiplier or separate pg_column_size measurement exists.",
      "The prefix inventory is not complete attributable DATA storage: scoring_profiles, scoring_entities and external_scoring_entity_ids are omitted; league_week_* tables may include unrelated projection allocation.",
      "Seed allocation is included once. Incremental groups are disjoint. Allocation/count ratios include minimum pages, existing indexes and vacant capacity; true marginal slopes need multiple authorized measurements.",
      "The 821-day exposure is added to one retained seed snapshot as a sensitivity; it is not a chronology reconstructed from the later CP27 snapshot. March 31, 2027 is administrative, not a refresh stop or finality signal.",
      "Every changed fraction means the fraction of modeled captures creating a distinct retained content hash/version, not merely a new observation or a semantic change back to an already retained hash. Catalog changes retain an entire new catalog, not a fraction of its entries. Observation proof grows on unchanged successful captures; shared catalog growth is counted once per fleet.",
      "Twenty rosters per league is benchmark team count, not a roster-size cap. Held-player sensitivity is separate. 400 unique leagues is a capacity sensitivity, not 400 manager memberships or qualified scope.",
      "Percentage/fixed reserves are explicitly synthetic; they do not measure omitted bytes or close completeness gaps. No automatic purge, reduced evidence, annual traversal, production change or new run is authorized.",
    ],
    incrementalAllocationGroups: inventory.groups,
    snapshotOnlyRelationsWithUnmeasuredFutureGrowth: inventory.snapshotOnlyTables,
    missingOrUnmeasuredGrowth: [
      "Shared scoring_profiles, scoring_entities and external_scoring_entity_ids, including indexes/TOAST, are absent from the prefix inventory.",
      "Recurring/resource control rows, cycles, occurrence/intake/identity/list/candidate/selection fanout, resource inventories, task/checkpoint history, retries, failures and rejections lack measured marginal growth.",
      "Raw bracket/report/draft payload versions, configuration/activation/calendar/period authority and manager/membership corrections are not explicitly event-priced.",
      "New canonical draft-selection/traded-pick asset identities are not full-version append rows and are not multiplied by correction counts; their new-identity growth is unmeasured.",
      "Full native transaction, draft-selection, co-owner, unusual format, late-correction and payload-size distributions differ from the synthetic seed.",
      "MVCC/dead tuples, fragmentation, index/page utilization, autovacuum behavior, retained WAL/backups and service billing attribution are not measured; reserves do not prove their bounds.",
    ],
    results: assumptions.uniqueLeagueSensitivities.flatMap((n) => assumptions.scenarios.map((s) => forecast(seed, assumptions, s, n, inventory.groups))),
  };
}
function selfTest(seed, a) {
  let tests = 0;
  const test = (body) => { body(); tests++; };
  const clone = (x) => structuredClone(x);
  test(() => assert.equal(GIB, 1073741824));
  test(() => assert.equal((Date.parse("2028-04-01") - Date.parse("2026-01-01")) / 86400000, 821));
  test(() => validateSeed(seed));
  test(() => validateAssumptions(a));
  for (const mutate of [
    (x) => { x.tables.pop(); },
    (x) => { x.tables[1] = clone(x.tables[0]); },
    (x) => { x.tables[0].rows = -1; },
    (x) => { x.tables[0].totalBytes = 0; },
    (x) => { x.provenance.gitSha = "0".repeat(40); },
    (x) => { x.dataset.leagues = 400; },
    (x) => { x.tables[0].totalBytes += 8192; x.tables[1].totalBytes -= 8192; },
  ]) test(() => { const x = clone(seed); mutate(x); assert.throws(() => validateSeed(x)); });
  for (const mutate of [
    (x) => { delete x.budgetBytes; },
    (x) => { x.uniqueLeagueSensitivities.push(16); },
    (x) => { x.scenarios.push(clone(x.scenarios[0])); },
    (x) => { x.horizon.inactiveDays++; },
    (x) => { x.scenarios[0].activeRefreshMinutes = 0; },
    (x) => { x.scenarios[0].exactChangedFraction = 1.01; },
    (x) => { x.scenarios[0].heldPlayersPerLeague = 9999999; },
    (x) => { x.scenarios[0].allocationRatioFactor = Infinity; },
    (x) => { x.cadence.historicalPeriodsPerDailySweep = 18; },
  ]) test(() => { const x = clone(a); mutate(x); assert.throws(() => validateAssumptions(x)); });
  const g = groups(seed), s = a.scenarios[0];
  const r16 = forecast(seed, a, s, 16, g.groups), r400 = forecast(seed, a, s, 400, g.groups);
  test(() => assert.equal(new Set(Object.values(g.groups).flatMap((x) => x.tables)).size, Object.values(g.groups).flatMap((x) => x.tables).length));
  test(() => assert.equal(Object.values(g.groups).reduce((n, x) => n + x.allocatedBytes, 0) + g.snapshotOnlyTables.reduce((n, x) => n + x.totalBytes, 0), seed.measurements.allocatedBytes));
  test(() => assert.equal(r16.budget.existingMeasuredPrefixAllocationBytes, r400.budget.existingMeasuredPrefixAllocationBytes));
  test(() => assert.equal(r16.componentBytes.sharedChangedCatalogVersions, r400.componentBytes.sharedChangedCatalogVersions));
  test(() => assert.equal(r16.componentBytes.sharedCatalogObservations, r400.componentBytes.sharedCatalogObservations));
  test(() => assert.ok(Math.abs(r400.componentBytes.rosterLinkFanout / r16.componentBytes.rosterLinkFanout - 25) < 1e-9));
  test(() => {
    const zero = { ...s, coreChangedFraction: 0, exactChangedFraction: 0, historyChangedFraction: 0, transactionChangedFraction: 0, catalogChangedFraction: 0 };
    const r = forecast(seed, a, zero, 16, g.groups);
    assert.equal(r.componentBytes.changedExactTypedValues, 0);
    assert.equal(r.componentBytes.sharedChangedCatalogVersions, 0);
    assert.ok(r.componentBytes.captureProof > 0 && r.componentBytes.rosterLinkFanout > 0 && r.componentBytes.sharedCatalogObservations > 0);
  });
  test(() => {
    const doubled = forecast(seed, a, { ...s, heldPlayersPerLeague: s.heldPlayersPerLeague * 2 }, 16, g.groups);
    assert.ok(Math.abs(doubled.componentBytes.rosterLinkFanout - 2 * r16.componentBytes.rosterLinkFanout) < 0.01);
    assert.ok(Math.abs(doubled.unchangedRosterOnlyBudgetExhaustionActiveDays * 2 - r16.unchangedRosterOnlyBudgetExhaustionActiveDays) < 0.002);
  });
  test(() => {
    const r = forecast(seed, a, { ...s, catalogChangedFraction: 1 }, 16, g.groups);
    const expected = g.groups.catalogContent.allocatedBytes / 160 * s.catalogPlayers * a.horizon.days * a.cadence.catalogRefreshesPerDay * s.allocationRatioFactor;
    assert.ok(Math.abs(r.componentBytes.sharedChangedCatalogVersions - expected) < 0.001);
  });
  test(() => {
    const r = report(seed, a, false);
    assert.equal(r.qualification, "UNQUALIFIED");
    assert.ok(r.results.every((x) => x.qualification === "UNQUALIFIED" && !x.budget.completeBudgetFitProven && !x.freshnessProven));
    assert.equal(r.originalEvidenceVerification, "SEED_VALIDATED_ORIGINAL_NOT_REVERIFIED");
  });
  return { qualification: "UNQUALIFIED", selfTestsPassed: tests, failed: 0, sqlOrNetworkExecuted: false };
}

// The measured lane is deliberately separate from the historical full-family sensitivity.
// Its rates already contain core proof, links and standings; adding those old components
// would count the same storage twice. Neither lane is a complete capacity qualification.
const MEASUREMENT_PIN = Object.freeze({
  artifactSha256: "73668875846572a703d5667877e5d715062e82e098b6e0988510f28d123c96c5",
  artifactBytes: 1631137,
  gitSha: "168a856ae44e7431393b0a8a9404483dda294ccc",
  contextDigest: "e2865b381b377484dc50e14b03f3421b033125217f4733bd8e9e9278a263b98a",
  fixtureDigest: "1da88e54b8a058b5bffffd4b5daa08dcf687ef5c46a34af4a0ecfc1e5e72c440",
  runId: "a99011e2-a5e2-43c2-ad7d-6e54e9643ffa",
  hostedRun: "39323139287",
  artifactId: "12220502648",
  originalZipSha256: "4f6162dde2ca6698584d1cdbb3baf7c533f0cf70f9fb3dc69dcb6c161c6b4f01",
});
const MEASUREMENT_SHA = "5a389413238a786f90e9b3003499d8d981dc70905853d97216e3ef3cbeb9a377";
const MEASUREMENT_GROUPS = ["per-league", "shared", "controls", "non-data"];
const PHASE_NAMES = ["S0-empty", "S1-catalog", "S2-A-prerequisites", "S3-A-baseline", "S4-B-prerequisites", "S5-B-baseline", "S6-A-unchanged", "S7-B-unchanged", "S8-A-C1", "S9-B-C1", "S10-A-C2", "S11-B-C2", "S12-A-C3", "S13-B-C3", "S14-A-C4", "S15-B-C4", "S16-read-only"];
const PHASE_UNITS = [0, 1, 0, 1, 0, 1, 16, 16, 1, 1, 1, 1, 1, 1, 1, 1, 0];
const RELATION_METRICS = ["rows", "totalBytes", "tableBytes", "indexBytes", "heapMainBytes", "heapFsmBytes", "heapVmBytes", "heapInitBytes", "toastAndAuxBytes", "tupleBytes", "jsonBytes"];
const MEASUREMENT_DEFAULT = new URL("../docs/aggregator-backend/data-backend-cp28-measurement.json", import.meta.url);
const sum = (values) => values.reduce((a, b) => a + b, 0);
const average = (values) => sum(values) / values.length;
const qualified = (row) => row.schema + "." + row.table;
function metricSum(relations) {
  return Object.fromEntries(["rows", "tupleBytes", "jsonBytes", "allocatedBytes"].map((key) => [key, sum(relations.map((r) => r[key === "allocatedBytes" ? "totalBytes" : key]))]));
}
function phaseDeltas(phases) {
  return phases.slice(1).map((after, i) => {
    const before = phases[i];
    const grouped = Object.fromEntries(MEASUREMENT_GROUPS.map((group) => {
      const a = metricSum(after.relations.filter((r) => r.group === group));
      const b = metricSum(before.relations.filter((r) => r.group === group));
      return [group, Object.fromEntries(Object.keys(a).map((key) => [key, a[key] - b[key]]))];
    }));
    const captures = PHASE_UNITS[i + 1], data = grouped["per-league"].allocatedBytes + grouped.shared.allocatedBytes;
    return { before: before.name, after: after.name, unit: i === 0 ? "shared-catalog" : captures ? "fresh-core" : "no-capture", captures, groups: grouped,
      allocatedBytes: after.allocatedBytes - before.allocatedBytes, dataAllocatedBytes: data, meanDataAllocatedBytesPerCapture: captures ? data / captures : null };
  });
}
function validateMeasurementPhases(phases) {
  assert.deepEqual(phases.map((p) => p.name), PHASE_NAMES, "Measurement phase order mismatch");
  const initial = phases[0], identities = initial.relations.map((r) => ({ schema: r.schema, table: r.table, group: r.group }));
  assert.equal(identities.length, 154, "Measurement inventory size mismatch");
  assert.equal(new Set(identities.map(qualified)).size, 154, "Duplicate measurement relation");
  assert.equal(identities.filter((r) => r.schema === "website_auth").length, 5);
  for (const phase of phases) {
    exact(phase, ["name", "digest", "metadataDigest", "relations", "allocatedBytes", "databaseBytes", "totalRows"], "measurement phase");
    assert.deepEqual(phase.relations.map((r) => ({ schema: r.schema, table: r.table, group: r.group })), identities, "Measurement inventory drift");
    assert.match(phase.digest, /^[a-f0-9]{64}$/);
    assert.equal(phase.metadataDigest, initial.metadataDigest);
    assert.match(phase.metadataDigest, /^[a-f0-9]{64}$/);
    for (const [i, row] of phase.relations.entries()) {
      exact(row, ["schema", "table", "group", "digest", ...RELATION_METRICS], "measurement relation");
      assert.ok(["public", "website_auth"].includes(row.schema));
      assert.match(row.table, /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/);
      assert.ok(MEASUREMENT_GROUPS.includes(row.group));
      assert.match(row.digest, /^[a-f0-9]{32}$/);
      for (const key of RELATION_METRICS) number(row[key], key, { integer: true });
      assert.ok(row.rows <= 200000);
      assert.equal(row.totalBytes, row.tableBytes + row.indexBytes, "Measurement table/index allocation mismatch");
      assert.equal(row.tableBytes, row.heapMainBytes + row.heapFsmBytes + row.heapVmBytes + row.heapInitBytes + row.toastAndAuxBytes, "Measurement fork allocation mismatch");
      if (row.group === "non-data") assert.deepEqual(row, initial.relations[i], "Non-DATA baseline changed");
    }
    assert.equal(phase.digest, sha(JSON.stringify(phase.relations.map((r) => ({ table: qualified(r), rows: r.rows, digest: r.digest })))), "Measurement phase digest mismatch");
    for (const key of ["allocatedBytes", "databaseBytes", "totalRows"]) number(phase[key], key, { integer: true });
    assert.equal(phase.allocatedBytes, sum(phase.relations.map((r) => r.totalBytes)));
    assert.equal(phase.totalRows, sum(phase.relations.map((r) => r.rows)));
    assert.ok(phase.allocatedBytes < 256 * 1024 ** 2 && phase.totalRows <= 1000000);
  }
  assert.deepEqual(phases[16].relations, phases[15].relations, "Final stored reads changed relations");
}
function deriveMeasurement(bytes) {
  assert.equal(bytes.length, MEASUREMENT_PIN.artifactBytes, "Measurement original size mismatch");
  assert.equal(sha(bytes), MEASUREMENT_PIN.artifactSha256, "Measurement original hash mismatch");
  const original = JSON.parse(bytes);
  for (const key of ["gitSha", "contextDigest", "fixtureDigest", "runId"]) assert.equal(original[key], MEASUREMENT_PIN[key], "Measurement source mismatch");
  assert.equal(original.kind, "data-cp28-storage-evidence-v1");
  assert.equal(original.profile, "data-storage-measurement-v1");
  assert.equal(original.state, "passed"); assert.equal(original.cleanupComplete, true); assert.equal(original.failure, null);
  assert.equal(original.captures.length, 42); assert.equal(original.replays.length, 2);
  const phases = original.phases.map((p) => ({ name: p.name, digest: p.digest, metadataDigest: p.metadataDigest,
    relations: p.relations.map((r) => ({ schema: r.schema, table: r.table, group: r.group, digest: r.digest, ...Object.fromEntries(RELATION_METRICS.map((key) => [key, r[key]])) })),
    allocatedBytes: p.allocatedBytes, databaseBytes: p.databaseBytes, totalRows: p.totalRows }));
  validateMeasurementPhases(phases);
  const deltas = phaseDeltas(phases);
  assert.deepEqual(deltas, original.deltas, "Original finite differences do not reconcile");
  return { schemaVersion: 1, kind: "cp28-source-bound-storage-measurement", qualification: "UNQUALIFIED", acceptedExperiment: "PASSED",
    provenance: MEASUREMENT_PIN, fixture: { leagues: 2, teamsPerLeague: 20, catalogPlayers: 12229, initialHeldPlayersPerLeague: 160, correctedHeldPlayersPerLeague: 159, coreCaptures: 42, typedCaptures: 168, unchangedCoreCaptures: 32, correctionCoreCaptures: 8 },
    phases, deltas };
}
function measurementFromFile(path) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size !== MEASUREMENT_PIN.artifactBytes) fail("Measurement original size mismatch");
  return deriveMeasurement(readFileSync(path));
}
function validateMeasurement(m) {
  exact(m, ["schemaVersion", "kind", "qualification", "acceptedExperiment", "provenance", "fixture", "phases", "deltas"], "measurement");
  assert.equal(m.schemaVersion, 1); assert.equal(m.kind, "cp28-source-bound-storage-measurement");
  assert.equal(m.qualification, "UNQUALIFIED"); assert.equal(m.acceptedExperiment, "PASSED");
  assert.deepEqual(m.provenance, MEASUREMENT_PIN, "Measurement provenance mismatch");
  assert.deepEqual(m.fixture, { leagues: 2, teamsPerLeague: 20, catalogPlayers: 12229, initialHeldPlayersPerLeague: 160, correctedHeldPlayersPerLeague: 159, coreCaptures: 42, typedCaptures: 168, unchangedCoreCaptures: 32, correctionCoreCaptures: 8 });
  validateMeasurementPhases(m.phases);
  assert.deepEqual(m.deltas, phaseDeltas(m.phases), "Measurement finite difference mismatch");
  assert.equal(sha(JSON.stringify(m)), MEASUREMENT_SHA, "Pinned measurement extraction mismatch");
  return m;
}
function allocationParts(m, phaseIndex) {
  const before = m.phases[phaseIndex - 1], after = m.phases[phaseIndex];
  const delta = (predicate) => sum(after.relations.filter(predicate).map((r) => r.totalBytes)) - sum(before.relations.filter(predicate).map((r) => r.totalBytes));
  const links = (r) => GROUPS.rosterLinks.includes(r.table);
  const rosterLinkGroupBytes = delta(links);
  const otherPerLeagueBytes = delta((r) => r.group === "per-league" && !links(r));
  const sharedBytes = delta((r) => r.group === "shared");
  const syntheticControlBytes = delta((r) => r.group === "controls");
  return { rosterLinkGroupBytes, otherPerLeagueBytes, sharedBytes, syntheticControlBytes };
}
function meanParts(samples) {
  return Object.fromEntries(Object.keys(samples[0]).map((key) => [key, average(samples.map((s) => s[key]))]));
}
function measuredReport(m, a, originalVerified) {
  const unchanged = [6, 7].map((i) => ({ phase: PHASE_NAMES[i], captures: 16, ...allocationParts(m, i) }));
  const unchangedMean = meanParts(unchanged.map((s) => Object.fromEntries(Object.keys(allocationParts(m, 6)).map((key) => [key, s[key] / s.captures]))));
  const corrections = [8, 9, 10, 11, 12, 13, 14, 15].map((i) => ({ phase: PHASE_NAMES[i], correction: "C" + (1 + Math.floor((i - 8) / 2)), heldPlayers: i < 10 ? 160 : 159, captures: 1, ...allocationParts(m, i), delta: m.deltas[i - 1] }));
  const correctionMean = meanParts(corrections.map((s) => allocationParts(m, PHASE_NAMES.indexOf(s.phase))));
  const initialCatalogDelta = m.deltas[0].groups.shared.allocatedBytes;
  const catalog = (r) => r.table.startsWith("league_player_directory_");
  const coreData = (p) => p.rosterLinkGroupBytes + p.otherPerLeagueBytes + p.sharedBytes;
  const exposure = (leagues, minutes, correctionFraction) => {
    const activeEvents = leagues * a.horizon.activeDays * a.horizon.activeHoursPerDay * 60 / minutes;
    const inactiveEvents = leagues * a.horizon.inactiveDays * a.cadence.inactiveRefreshesPerDay;
    const coreEvents = activeEvents + inactiveEvents;
    const counts = { activeEvents, inactiveEvents, coreEvents, unchangedEvents: coreEvents * (1 - correctionFraction), correctionEvents: coreEvents * correctionFraction };
    const parts = Object.fromEntries(Object.keys(unchangedMean).map((key) => [key, counts.unchangedEvents * unchangedMean[key] + counts.correctionEvents * correctionMean[key]]));
    const dataBytes = coreData(parts), withControls = dataBytes + parts.syntheticControlBytes;
    return { uniqueLeagues: leagues, activeRefreshMinutes: minutes, correctionFraction, expectedEvents: counts, componentBytes: parts,
      coreDataBytes: dataBytes, coreDataGiB: dataBytes / GIB, corePlusSyntheticControlBytes: withControls, corePlusSyntheticControlGiB: withControls / GIB,
      initialCatalogDeltaOnceBytes: initialCatalogDelta, partialDataPlusInitialCatalogBytes: dataBytes + initialCatalogDelta,
      exceeds10GiBInThisPartialSensitivity: dataBytes + initialCatalogDelta > a.budgetBytes,
      qualification: "UNQUALIFIED", completeBudgetFitProven: false, freshnessProven: false };
  };
  const minutes = [...new Set(a.scenarios.map((s) => s.activeRefreshMinutes))];
  const catalogRows = m.phases[1].relations.filter(catalog).map((r) => {
    const before = m.phases[0].relations.find((b) => qualified(b) === qualified(r));
    return { table: qualified(r), initialRows: r.rows, initialAllocatedBytes: r.totalBytes, deltaRows: r.rows - before.rows, deltaAllocatedBytes: r.totalBytes - before.totalBytes, deltaTupleBytes: r.tupleBytes - before.tupleBytes, deltaJsonBytes: r.jsonBytes - before.jsonBytes };
  });
  const rosterSensitivity = a.uniqueLeagueSensitivities.flatMap((leagues) => minutes.flatMap((cadence) => [...new Set(a.scenarios.map((s) => s.heldPlayersPerLeague))].map((heldPlayers) => {
    const coreEvents = exposure(leagues, cadence, 0).expectedEvents.coreEvents;
    const rosterBytes = coreEvents * unchangedMean.rosterLinkGroupBytes / m.fixture.initialHeldPlayersPerLeague * heldPlayers;
    const otherCoreDataBytes = coreEvents * (unchangedMean.otherPerLeagueBytes + unchangedMean.sharedBytes);
    return { uniqueLeagues: leagues, activeRefreshMinutes: cadence, heldPlayers, coreEvents, rosterLinkGroupBytes: rosterBytes, rosterLinkGroupGiB: rosterBytes / GIB,
      otherCoreDataBytesHeldFixed: otherCoreDataBytes, conditionalCoreDataBytes: rosterBytes + otherCoreDataBytes, qualification: "UNQUALIFIED", completeBudgetFitProven: false };
  })));
  return { schemaVersion: 1, kind: "cp28-partial-measured-core-sensitivity", qualification: "UNQUALIFIED", acceptedExperiment: "PASSED",
    originalEvidenceVerification: originalVerified ? "ORIGINAL_CP28_BYTES_AND_EXTRACTION_VERIFIED" : "PINNED_EXTRACTION_VALIDATED_ORIGINAL_NOT_REVERIFIED",
    provenance: { ...MEASUREMENT_PIN, extractionSha256: MEASUREMENT_SHA, historicalAssumptionsSha256: sha(JSON.stringify(a)) },
    horizon: a.horizon, budgetBytes: a.budgetBytes, benchmarkUniqueLeagues: a.benchmarkUniqueLeagues,
    assumptions: { activeRefreshMinutes: minutes, uniqueLeagues: a.uniqueLeagueSensitivities, inactiveRefreshesPerDay: a.cadence.inactiveRefreshesPerDay,
      correctionFractions: [0, 0.01, 0.05], correctionTypeWeights: { C1: 0.25, C2: 0.25, C3: 0.25, C4: 0.25 },
      allocationRateMultiplier: 1, startupCatalogLoadsPerFleet: 1, recurringCatalogVersionRate: null,
      fixedFixtureTeamsPerLeague: 20, unchangedHeldPlayersPerLeague: 160, correctionHeldPlayersPerLeague: [160, 159, 159, 159],
      interpretation: "Illustrative exposure at observed fixture occupancy, not a fleet census or statistical bound. Expected unchanged and correction counts are disjoint. Equal correction-type weights, stationary observed allocation rates and roster-link-only linear scaling are assumptions. No historical allocation ratio factors or reserves are applied in this lane. The full 821-day event exposure is additional to the separately observed two-league startup; it is not a reconstructed calendar history or an inferred16-league seed." },
    observed: { migratedBaseline: { allocatedBytes: m.phases[0].allocatedBytes, groups: Object.fromEntries(MEASUREMENT_GROUPS.map((g) => [g, metricSum(m.phases[0].relations.filter((r) => r.group === g))])) },
      firstCatalog: { sharedDelta: m.deltas[0].groups.shared, syntheticControlDelta: m.deltas[0].groups.controls, initialCatalogTableAllocationBytes: sum(catalogRows.map((r) => r.initialAllocatedBytes)), relations: catalogRows, repeatedVersionOrObservationSlopeMeasured: false },
      prerequisitesAndFirstCore: m.deltas.slice(1, 5), unchangedBatches: unchanged,
      unchangedMeanAllocatedBytesPerCore: { ...unchangedMean, dataBytes: coreData(unchangedMean), withSyntheticControlsBytes: coreData(unchangedMean) + unchangedMean.syntheticControlBytes },
      unchangedDataMeanRangeBetweenTwoBatches: unchanged.map((s) => (s.rosterLinkGroupBytes + s.otherPerLeagueBytes + s.sharedBytes) / s.captures),
      correctionObservations: corrections, correctionMeanAllocatedBytesPerCore: { ...correctionMean, dataBytes: coreData(correctionMean), withSyntheticControlsBytes: coreData(correctionMean) + correctionMean.syntheticControlBytes },
      firstToFinal: { rows: m.phases[16].totalRows - m.phases[0].totalRows, allocatedBytes: m.phases[16].allocatedBytes - m.phases[0].allocatedBytes }, finalReadDelta: m.deltas[15] },
    modeledCoreExposure: a.uniqueLeagueSensitivities.flatMap((n) => minutes.map((c) => exposure(n, c, 0))),
    correctionMixSensitivities: a.uniqueLeagueSensitivities.flatMap((n) => minutes.flatMap((c) => [0.01, 0.05].map((p) => exposure(n, c, p)))),
    rosterLinkOccupancySensitivity: rosterSensitivity,
    unmeasured: [
      "A complete 16-league all-family footprint remains unqualified. Historical full-family sensitivity is preserved separately; no old core proof/link/standings/raw components are added to this measured lane.",
      "Only 32 unchanged cores in two 16-event batches and eight ordered correction cores were measured. Batch means and individual correction allocations reflect spare pages, ordering and index/TOAST steps, not stationary marginal slopes, confidence intervals or lower bounds.",
      "The shared " + unchangedMean.sharedBytes + " bytes/core mean has no new shared rows or logical bytes; it is an observed allocation-only residual. It includes catalog and scoring-entity page changes, not another accepted catalog version.",
      "The initial catalog is counted once per fleet as a delta, never added again as the full catalog-table total. Repeated changed/unchanged catalog versions and observations have no measured rate and are excluded, not zero-cost.",
      "The initial migrated allocation, first-core/prerequisite steps, further league onboarding and shared identity creation remain separately observed startup facts; they are not a 16-league startup model and are excluded from the partial exposure sum.",
      "Exact periods, transactions, brackets, reports, drafts, manager directories, ordinary scheduling control fanout, failures and retries lack measured recurring rates here. Synthetic core controls are shown separately from DATA, not ordinary scheduler proof.",
      "The full catalog retained 12229 entries;160/159 held-player fixture occupancy, 20 teams and these payload shapes are not league population bounds. Only the separate link sensitivity scales held-player fanout; proof, team metadata, catalog and other core bytes remain fixed.",
      "MVCC, fragmentation, long-term page reuse, retention/restore operations, WAL/backups, account-specific capacity and billing remain unmeasured. There is no automatic purge, budget fit, freshness guarantee or new execution authority.",
    ], complete16LeagueCapacityProven: false, retentionPolicyProven: false };
}
function measurementSelfTest(m, a, originalBytes) {
  let tests = 0;
  const test = (body) => { body(); tests++; };
  test(() => validateMeasurement(m));
  for (const mutate of [
    (x) => { x.provenance.gitSha = "0".repeat(40); },
    (x) => { x.provenance.artifactSha256 = "0".repeat(64); },
    (x) => { x.fixture.coreCaptures++; },
    (x) => { x.phases.pop(); },
    (x) => { [x.phases[6], x.phases[7]] = [x.phases[7], x.phases[6]]; },
    (x) => { x.phases[1].relations.pop(); },
    (x) => { x.phases[1].relations[1] = structuredClone(x.phases[1].relations[0]); },
    (x) => { x.phases[1].relations[0].rows = "0"; },
    (x) => { x.phases[1].relations[0].totalBytes++; },
    (x) => { x.phases[1].relations[0].heapMainBytes++; },
    (x) => { x.phases[1].metadataDigest = "0".repeat(64); },
    (x) => { x.phases[1].digest = "0".repeat(64); },
    (x) => { x.deltas[5].groups.shared.allocatedBytes++; },
    (x) => { x.extra = true; },
    // Internally coherent edits still fail the pinned extraction identity.
    (x) => { x.phases.forEach((p) => { p.databaseBytes++; }); },
  ]) test(() => { const x = structuredClone(m); mutate(x); assert.throws(() => validateMeasurement(x)); });
  const r = measuredReport(m, a, false), r16 = r.modeledCoreExposure.find((x) => x.uniqueLeagues === 16 && x.activeRefreshMinutes === 5);
  test(() => assert.equal(r16.expectedEvents.coreEvents, 591728));
  test(() => assert.equal(r.observed.unchangedMeanAllocatedBytesPerCore.dataBytes, 162560));
  test(() => assert.equal(r.observed.unchangedMeanAllocatedBytesPerCore.rosterLinkGroupBytes, 140288));
  test(() => assert.equal(r.observed.unchangedMeanAllocatedBytesPerCore.sharedBytes, 2048));
  test(() => assert.equal(r.observed.unchangedMeanAllocatedBytesPerCore.otherPerLeagueBytes, 20224));
  test(() => assert.equal(r16.coreDataBytes, 591728 * 162560));
  test(() => assert.equal(r16.corePlusSyntheticControlBytes, 591728 * 169984));
  test(() => assert.ok(r.modeledCoreExposure.every((x) => x.initialCatalogDeltaOnceBytes === 31285248)));
  test(() => assert.equal(r.observed.firstCatalog.initialCatalogTableAllocationBytes, 31457280));
  test(() => assert.equal(r.observed.finalReadDelta.allocatedBytes, 0));
  test(() => assert.ok(r.correctionMixSensitivities.every((x) => Math.abs(x.expectedEvents.unchangedEvents + x.expectedEvents.correctionEvents - x.expectedEvents.coreEvents) < 1e-7)));
  test(() => {
    const mixed = r.correctionMixSensitivities.find((x) => x.uniqueLeagues === 16 && x.activeRefreshMinutes === 5 && x.correctionFraction === 0.01);
    assert.equal(mixed.coreDataBytes, sum(["rosterLinkGroupBytes", "otherPerLeagueBytes", "sharedBytes"].map((key) => mixed.componentBytes[key])));
    assert.equal(mixed.componentBytes.rosterLinkGroupBytes, mixed.expectedEvents.unchangedEvents * 140288 + mixed.expectedEvents.correctionEvents * r.observed.correctionMeanAllocatedBytesPerCore.rosterLinkGroupBytes);
  });
  test(() => {
    const rows = r.rosterLinkOccupancySensitivity.filter((x) => x.uniqueLeagues === 16 && x.activeRefreshMinutes === 5);
    assert.equal(rows[1].rosterLinkGroupBytes, 2 * rows[0].rosterLinkGroupBytes);
    assert.equal(rows[1].otherCoreDataBytesHeldFixed, rows[0].otherCoreDataBytesHeldFixed);
  });
  test(() => assert.ok([...r.modeledCoreExposure, ...r.correctionMixSensitivities, ...r.rosterLinkOccupancySensitivity].every((x) => x.qualification === "UNQUALIFIED" && !x.completeBudgetFitProven)));
  test(() => assert.equal(r.complete16LeagueCapacityProven, false));
  if (originalBytes) {
    test(() => assert.deepEqual(deriveMeasurement(originalBytes), m));
    test(() => assert.throws(() => deriveMeasurement(Buffer.concat([originalBytes, Buffer.from(" ")]))));
    test(() => { const bad = Buffer.from(originalBytes); bad[bad.length - 2] ^= 1; assert.throws(() => deriveMeasurement(bad)); });
  }
  return { selfTestsPassed: tests, failed: 0, originalByteTestsExecuted: Boolean(originalBytes), sqlOrNetworkExecuted: false };
}

// Combined A+B1 uses event-conditioned deltas, never independent A/B savings.
const COMBINED_PIN = Object.freeze({
  "base": "4050e768a5b9bcf4e60e266f0da102d4f0dbc35b",
  "sourceBinding": "Precommit overlay bound by72 executed source hashes; not a claim that the overlay equals the base commit.",
  "acceptedAttempt": 3,
  "caseSha256": "458c4d4acb035e8e9ed07bb5dad796f5e4080d239f167d8355356694a4f902b8",
  "originalDirectory": "test-results/cp28-combined-ab/local-postgres18-attempt-3",
  "artifacts": {
    "native-run-evidence.json": {
      "bytes": 27336,
      "sha256": "8c9a789b160712d67c28b4a479227a670696140c44ee1ac4e35a3fd688e1f3ea"
    },
    "native-results.log": {
      "bytes": 879304,
      "sha256": "67c9a6968bf01ae727c1f970a69c4a6ca11e06215e0c9f6ab79c3fc242fd0ac7"
    },
    "native-results.json": {
      "bytes": 7700,
      "sha256": "2954346b699e3dfdeb0b1816c4e0f33db35d6abfe393fdfc2d60bbd4526e237e"
    },
    "setup-evidence.json": {
      "bytes": 35920,
      "sha256": "3f84921c4de637789ed220f7f07a6e3530b47c260aee0fa90302f00689191b97"
    },
    "cleanup-evidence.json": {
      "bytes": 705,
      "sha256": "1350193f040725bc8987848ca45c156fc149ad25ea3afbd67b367b43e24da30a"
    },
    "orchestration-evidence.json": {
      "bytes": 221,
      "sha256": "2254575f8fd4ffb285d9615e0d970c7445b878381e02ab1b2a13a0f0d7aa5516"
    },
    "candidate-manifest.json": {
      "bytes": 13533,
      "sha256": "7ab3114fea202bebb1cbcb274539e24269e82bf0a7a8ed11d254469d7ed346c5"
    },
    "helper-manifest.json": {
      "bytes": 1541,
      "sha256": "51af8751e0e4787b099c184737e7dd0d0fb69d28f7831527a3da5d8080e75d3b"
    }
  },
  "priorFailedAttempts": [
    {
      "attempt": 1,
      "caseSha256": "c3f629ce269bbdb15a548dea2383a93323dcc7137221444e730e97148023d1b8",
      "status": "failed",
      "reservedAttempts": 50,
      "nativeReceipt": {
        "bytes": 27291,
        "sha256": "debc3b1c0e402e6b60873d930227f86b681d0b01c80e8c62de67f0e04a4bab60"
      },
      "cleanupReceipt": {
        "bytes": 695,
        "sha256": "45840f49daea9b233faa8280c46435ea1ab1b8cb2277c9ae76e7bd4d344440f5"
      }
    },
    {
      "attempt": 2,
      "caseSha256": "af48147fa9ea1e834f8f018fe3c424fffc6930a9d1e8e61b9a9c13664fda3ead",
      "status": "failed",
      "reservedAttempts": 53,
      "nativeReceipt": {
        "bytes": 27714,
        "sha256": "a80ed6342568a00fe73d8fbcc78676c5a43e7884a5894d60619dd2cd1dd38254"
      },
      "cleanupReceipt": {
        "bytes": 705,
        "sha256": "e2f72f3bccded78c76806358a4865761de13fd21639f413486ffc5bf8253730f"
      }
    }
  ]
});
const COMBINED_EXTRACTION_SHA = '3667502f7c124f3e2484a7811adfa753bda67c111d6f16a61e9a5b38df5d9435';
const COMBINED_FILES = ['native-run-evidence.json','native-results.log','native-results.json','setup-evidence.json','cleanup-evidence.json','orchestration-evidence.json','candidate-manifest.json','helper-manifest.json'];
const COMBINED_DEFAULT = new URL('../docs/aggregator-backend/data-backend-cp28-combined-measurement.json', import.meta.url);
const CAPACITY_DEFAULT = new URL('../docs/aggregator-backend/data-backend-cp28-capacity-inputs.json', import.meta.url);
const OFFICIAL_FAMILIES = ['leagueSettingsSeasons','teamsManagersCoowners','rostersPlayerIdentities','lineupsMatchups','officialScoresResultsStandings','transactionsWaiversFaab','draftsPicks','schedulesPlayoffsHistory'];
const WORKLOAD_COVERAGE = [['core',[0,1,2,4]],['exactMatchups',[3,4,7]],['transactions',[5]],['brackets',[4,7]],['reports',[4,7]],['drafts',[6]],['managerDirectory',[1]],['playerCatalog',[2]]].map(([id, refs]) => ({id, coverageRefs:refs.map(i => OFFICIAL_FAMILIES[i])}));
const CAPACITY_TERMS = [
  ['coreChangeAndEpochPremium','core','coreEvents'],['exactCurrent','exactMatchups','coreEvents'],['exactEarlier','exactMatchups','earlierEvents'],
  ['transactionsCurrent','transactions','coreEvents'],['transactionsEarlier','transactions','earlierEvents'],['brackets','brackets','resultEvents'],
  ['reports','reports','resultEvents'],['drafts','drafts','dailyLeagueEvents'],['managerDirectory','managerDirectory','dailyLeagueEvents'],['catalogRecurring','playerCatalog','catalogEvents'],
  ...['ordinaryControlsAndFailures','startupAndOnboarding','otherSharedAndMaintenance','beyondAssumedPeriodInventory','benchmarkGeometryAdjustment'].map(id => [id,'all','one']),
];
const AB_AFFECTED = ['league_roster_capture_receipts','league_roster_population_contents','league_roster_player_link_receipts','league_roster_player_links','league_roster_player_link_contents','league_roster_player_link_content_entries'].map(t => 'public.'+t);
const AB_COLUMNS = [
  ['league_roster_resource_attempts','source_mapping'],['league_roster_resource_attempts','write_fence'],
  ['league_roster_capture_receipts','provenance'],['league_roster_capture_receipts','population_evidence'],['league_roster_capture_receipts','coverage'],
  ['league_roster_population_contents','population_evidence'],['league_official_standings_captures','source_mapping'],['league_official_standings_captures','reasons'],['league_roster_player_link_receipts','reasons'],
  ...['league_roster_player_links','league_roster_player_link_content_entries'].flatMap(t => ['mapping_proof','kind_evidence','reasons'].map(c => [t,c])),
].map(([t,c]) => ({name:'public.'+t,column:c}));
const AB_BYTES = ['tupleBytes','heap','indexes','toast','auxiliary','total'];
const AB_METRICS = ['rows',...AB_BYTES];
const AB_BOUNDARIES = ['empty-migrated-schema','synthetic-prerequisites','semantic-legacy','semantic-A','semantic-B1','semantic-AB','unchanged','score-only-correction','membership-correction','return-to-original'];
const AB_FIXTURE = {leagues:2,teamsPerLeague:10,teamsTotal:20,heldPerCore:80,heldAcrossLeagues:160,uniqueCatalogPlayers:80};
const AB_WORKLOAD = {semanticCores:12,warmCoresPerLayout:2,measuredCoresPerLayout:32,directRosterProbes:4,attemptsPerCore:4,receiptsPerCore:4,acceptedStandingsPerCore:1,eligiblePopulationReceiptsPerCore:3};
function byteNumber(value) {
  assert.equal(typeof value,'string','Allocation bytes must be decimal strings'); assert.match(value,/^(?:0|[1-9][0-9]*)$/,'Invalid allocation decimal');
  return number(Number(value),'allocation bytes',{integer:true,max:256*1024**2});
}
function abInventory(historical) {
  return new Map([...historical.phases[0].relations.map(r => [qualified(r),r.group]), ...['league_roster_player_link_contents','league_roster_player_link_content_entries','league_roster_population_contents'].map(t => ['public.'+t,'per-league'])]);
}
function abExpectedTriggers(mode){
  const rows=[{table_name:'league_roster_resource_acceptances',function_name:['A','AB'].includes(mode)?'capture_roster_player_links_shared':'capture_roster_player_links',trigger_name:'roster_player_links_after_acceptance',event_type:5,enabled:'O',public_identity:true,unconditional_no_arguments:true}];
  if(['B1','AB'].includes(mode))rows.unshift({table_name:'league_roster_capture_receipts',function_name:'intern_roster_population_evidence',trigger_name:'roster_population_intern_before_lineage',event_type:7,enabled:'O',public_identity:true,unconditional_no_arguments:true});
  return rows;
}
function validateAbSnapshot(s, inventory) {
  exact(s,['boundary','mode','counters','modeTriggers','relations','columns'],'combined snapshot');
  assert.equal(typeof s.boundary,'string'); assert.ok(['legacy','A','B1','AB'].includes(s.mode));
  exact(s.counters,['witnessedCores','resourceReservations','syntheticCoreHttpResponses'],'snapshot counters');
  Object.values(s.counters).forEach(v => number(v,'counter',{integer:true,max:512}));
  assert.equal(s.counters.syntheticCoreHttpResponses,s.counters.witnessedCores*2,'Fixture response multiplicity mismatch');
  assert.deepEqual(s.modeTriggers,abExpectedTriggers(s.mode),'Exact active-writer mode mismatch');
  validateNativeRelationMetrics(s,inventory,157,AB_COLUMNS);
}
function validateNativeRelationMetrics(s,inventory,relationCount,columns){
  assert.equal(s.relations.length,relationCount,'Full relation inventory missing');
  assert.deepEqual([...new Set(s.relations.map(r => r.name))].sort(),[...inventory.keys()].sort(),'Closed relation inventory mismatch');
  for (const r of s.relations) {
    exact(r,['schema','table','name','rows',...AB_BYTES],'combined relation'); assert.equal(r.name,qualified(r));
    number(r.rows,'rows',{integer:true,max:1000000}); AB_BYTES.forEach(k => byteNumber(r[k]));
    assert.equal(Number(r.total),Number(r.heap)+Number(r.indexes)+Number(r.toast)+Number(r.auxiliary),'Physical allocation does not reconcile');
  }
  assert.equal(s.columns.length,columns.length,'Column diagnostic count mismatch');
  assert.deepEqual(s.columns.map(c=>c.name+'.'+c.column).sort(),columns.map(c=>c.name+'.'+c.column).sort(),'Closed column diagnostic inventory mismatch');
  for (const c of s.columns) {
    exact(c,['name','column','nonnull','datumBytes','jsonTextBytes'],'column diagnostic');
    number(c.nonnull,'nonnull',{integer:true,max:s.relations.find(r=>r.name===c.name).rows}); byteNumber(c.datumBytes);byteNumber(c.jsonTextBytes);
  }
}
function abDelta(before, after, inventory) {
  const rows=after.relations.map(r=>{const b=before.relations.find(x=>x.name===r.name);return {name:r.name,group:inventory.get(r.name),...Object.fromEntries(AB_METRICS.map(k=>[k,Number(r[k])-Number(b[k])]))};});
  const grouped=Object.fromEntries(MEASUREMENT_GROUPS.map(group=>[group,Object.fromEntries(AB_METRICS.map(k=>[k,sum(rows.filter(r=>r.group===group).map(r=>r[k]))]))]));
  const totals=Object.fromEntries(AB_METRICS.map(k=>[k,sum(rows.map(r=>r[k]))]));
  const columns=after.columns.map(c=>{const b=before.columns.find(x=>x.name===c.name&&x.column===c.column);return {name:c.name,column:c.column,...Object.fromEntries(['nonnull','datumBytes','jsonTextBytes'].map(k=>[k,Number(c[k])-Number(b[k])]))};});
  return {before:before.boundary,after:after.boundary,groups:grouped,totals,dataAllocatedBytes:grouped['per-league'].total+grouped.shared.total,syntheticControlAllocatedBytes:grouped.controls.total,relations:rows,nonadditiveColumnDiagnostics:columns};
}
function validateAbAllocation(a, historical) {
  exact(a,['schemaVersion','kind','fixture','workload','semanticBoundaries','legacy','combined','affectedRelations','affectedAllocatedBytes','allPublicAllocatedBytes','counters','historicalDigestChecksPassed','restoredLegacy','externalProviderCalls','limitations'],'combined allocation');
  assert.equal(a.schemaVersion,1);assert.equal(a.kind,'local-native-witnessed-core-combined-ab-v1');
  assert.deepEqual(a.fixture,AB_FIXTURE);assert.deepEqual(a.workload,AB_WORKLOAD);assert.deepEqual(a.affectedRelations,AB_AFFECTED);
  assert.equal(a.historicalDigestChecksPassed,true);assert.equal(a.restoredLegacy,true);assert.equal(a.externalProviderCalls,0);
  assert.ok(Array.isArray(a.limitations)&&a.limitations.length>=8);assert.deepEqual(a.counters,{witnessedCores:80,resourceReservations:325,syntheticCoreHttpResponses:160});
  const inventory=abInventory(historical);assert.deepEqual(a.semanticBoundaries.map(s=>s.boundary),AB_BOUNDARIES,'Semantic boundary inventory mismatch');
  assert.deepEqual(a.semanticBoundaries.map(s=>s.mode),['legacy','legacy','legacy','A','B1','AB','AB','AB','AB','AB'],'Semantic mode order mismatch');
  const snapshots=[...a.semanticBoundaries];
  for (const [key,mode] of [['legacy','legacy'],['combined','AB']]) {
    const p=a[key];exact(p,['mode','beforeWarm','before','after','batches','historicalDigestChecksPassed','reader'],'measured layout');
    assert.equal(p.mode,mode);assert.equal(p.historicalDigestChecksPassed,true);assert.deepEqual(p.batches.map(b=>b.cores),[8,16,24,32]);
    assert.deepEqual(p.after,p.batches[3].snapshot,'Final boundary alias mismatch');
    const chain=[p.beforeWarm,p.before,...p.batches.map(b=>b.snapshot)];
    assert.deepEqual(chain.map(s=>s.boundary),[mode+'-before-warm',mode+'-measured-start',...[8,16,24,32].map(n=>mode+'-measured-'+n)]);
    assert.ok(chain.every(s=>s.mode===mode));snapshots.push(...chain);
    exact(p.reader,['standingsElapsedMs','linksElapsedMs','standingsQueries','linkQueries','teams','held'],'reader evidence');
    ['standingsElapsedMs','linksElapsedMs'].forEach(k=>number(p.reader[k],k));assert.deepEqual([p.reader.standingsQueries,p.reader.linkQueries,p.reader.teams,p.reader.held],[1,1,10,80]);
    for(let i=1;i<chain.length;i++){const cores=i===1?2:8;assert.equal(chain[i].counters.witnessedCores-chain[i-1].counters.witnessedCores,cores,'Batch core count mismatch');assert.equal(chain[i].counters.resourceReservations-chain[i-1].counters.resourceReservations,cores*4,'Batch receipt multiplicity mismatch');}
  }
  snapshots.forEach(s=>validateAbSnapshot(s,inventory));const first=snapshots[0];assert.equal(sum(first.relations.map(r=>r.rows)),65,'Migrated baseline requires 64 ledger rows and singleton');
  for(const s of snapshots){
    assert.deepEqual(s.relations.filter(r=>r.schema==='website_auth').sort((a,b)=>a.name.localeCompare(b.name)),first.relations.filter(r=>r.schema==='website_auth').sort((a,b)=>a.name.localeCompare(b.name)),'Auth baseline changed');
    for(const r of s.relations.filter(r=>inventory.get(r.name)==='non-data')){const b=first.relations.find(x=>x.name===r.name);assert.deepEqual([r.rows,r.tupleBytes],[b.rows,b.tupleBytes],'Non-DATA logical baseline changed');}
  }
  for(const key of ['legacy','combined']){
    const p=a[key],d=abDelta(p.before,p.after,inventory),row=t=>d.relations.find(r=>r.name==='public.'+t).rows;
    for(const t of ['league_roster_resource_attempts','league_roster_capture_receipts','league_roster_resource_acceptances'])assert.equal(row(t),128,'Fresh typed multiplicity mismatch');
    assert.equal(row('league_roster_population_contents'),key==='combined'?32:0,'Population parent multiplicity mismatch');assert.equal(row('league_roster_player_link_receipts'),32);
    assert.equal(row('league_roster_player_links'),key==='combined'?0:2560,'Roster child multiplicity mismatch');
    for(const t of ['league_roster_player_link_contents','league_roster_player_link_content_entries'])assert.equal(row(t),0,'Warmed content reuse mismatch');
    assert.equal(row('league_official_standings_captures'),32);
    assert.equal(a.affectedAllocatedBytes[key],sum(d.relations.filter(r=>AB_AFFECTED.includes(r.name)).map(r=>r.total)),'Affected allocation mismatch');
    assert.equal(a.allPublicAllocatedBytes[key],sum(d.relations.filter(r=>r.name.startsWith('public.')).map(r=>r.total)),'All-public allocation mismatch');
  }
  assert.ok(a.affectedAllocatedBytes.combined<a.affectedAllocatedBytes.legacy);return a;
}
function validateCapacityInputs(input, historicalAssumptions) {
  exact(input,['schemaVersion','kind','qualification','budgetBytes','benchmarkUniqueLeagues','horizon','cadence','officialFamilies','workloads','terms','provenance','interpretation'],'capacity inputs');
  assert.equal(input.schemaVersion,1);assert.equal(input.kind,'cp28-complete-conditional-capacity-inputs');assert.equal(input.qualification,'UNQUALIFIED');
  assert.equal(input.budgetBytes,10*GIB);assert.equal(input.benchmarkUniqueLeagues,16);assert.deepEqual(input.horizon,historicalAssumptions.horizon);
  assert.deepEqual(input.cadence,{primaryActiveMinutes:5,sourceDueSensitivityMinutes:4,inactivePerDay:1,earlierPeriodsPerDailySweep:17,resultActiveMinutes:15,catalogAttemptsPerDay:1});
  assert.deepEqual(input.officialFamilies,OFFICIAL_FAMILIES);assert.deepEqual(input.workloads,WORKLOAD_COVERAGE,'Official family/workload mapping mismatch');
  assert.deepEqual(input.terms.map(t=>[t.id,t.workload,t.volume]),CAPACITY_TERMS,'Complete disjoint term inventory mismatch');
  for(const t of input.terms){
    exact(t,['id','workload','volume','eventUnit','boundary','rate'],'capacity term');
    for(const k of ['eventUnit','boundary'])assert.ok(typeof t[k]==='string'&&t[k].length>0&&t[k].length<2000);
    exact(t.rate,['status','bytesPerEvent','provenance'],'capacity rate');assert.ok(typeof t.rate.provenance==='string'&&t.rate.provenance.length>0&&t.rate.provenance.length<2000);
    if(t.rate.status==='unmeasured')assert.equal(t.rate.bytesPerEvent,null,'Unknown rate cannot become zero');
    else{assert.equal(t.rate.status,'assumed','Only explicitly assumed rates may fill a gap');number(t.rate.bytesPerEvent,'assumed event bytes',{max:1024**4});}
  }
  assert.ok(Array.isArray(input.interpretation));return input;
}
function boundedBytes(path,max=8*1024**2){const s=statSync(path);assert.ok(s.isFile()&&s.size<=max,'Unbounded local input');return readFileSync(path);}
function verifyCombinedOriginal(name,bytes,pin=COMBINED_PIN){assert.deepEqual({bytes:bytes.length,sha256:sha(bytes)},pin.artifacts[name],'Original native artifact mismatch');}
const COMBINED_NATIVE_CONTRACT={pin:COMBINED_PIN,tableCount:157,migrationCount:64,sourceCount:72,totalTests:17,passedTests:3,pendingTests:14,reservedAttempts:325,marker:'CP28_AB_ALLOCATION',measurementKind:'cp28-source-bound-combined-measurement',validateAllocation:validateAbAllocation};
function deriveCombined(path,historical){return deriveNativeMeasurement(path,historical,COMBINED_NATIVE_CONTRACT);}
function deriveNativeMeasurement(path,historical,contract){
  const pin=contract.pin;assert.ok(pin,'No accepted native evidence pin');assert.equal(basename(path),'native-run-evidence.json','Expected original run receipt');
  const files=Object.fromEntries(COMBINED_FILES.map(name=>[name,boundedBytes(join(dirname(resolve(path)),name))]));
  for(const name of COMBINED_FILES)verifyCombinedOriginal(name,files[name],pin);
  const parsed=Object.fromEntries(COMBINED_FILES.filter(n=>n.endsWith('.json')).map(n=>[n,JSON.parse(files[n])]));
  const run=parsed['native-run-evidence.json'],setup=parsed['setup-evidence.json'],cleanup=parsed['cleanup-evidence.json'],orchestration=parsed['orchestration-evidence.json'],candidate=parsed['candidate-manifest.json'],helpers=parsed['helper-manifest.json'];
  assert.equal(run.status,'passed');assert.deepEqual(run.summary,{success:true,total:contract.totalTests,passed:contract.passedTests,failed:0,pending:contract.pendingTests,files:1});
  assert.equal(run.selectedCases,contract.passedTests);assert.equal(run.originalCasesSelected,false);assert.equal(run.sourcesUnchanged,true);
  assert.deepEqual(run.sourceBefore,candidate.sources);assert.deepEqual(run.sourceAfter,candidate.sources);assert.deepEqual(setup.frozenSources,candidate.sources);
  assert.equal(candidate.base,pin.base);assert.equal(candidate.sources.length,contract.sourceCount);assert.equal(helpers.sources.length,contract.helperCount??11);
  assert.equal(run.actualReservedAttempts,contract.reservedAttempts);assert.equal(run.cloudCalls,0);assert.equal(run.hostedAttempts,0);
  assert.equal(run.externalNetworkBlockedExceptOwnedLoopback,true);assert.equal(run.inheritedEnvironmentScrubbed,true);
  assert.equal(run.host,'127.0.0.1');assert.equal(run.port,53125);assert.equal(run.database,'cp28_snapshot_test');
  assert.equal(run.campaign.maximumMs,1800000);assert.equal(run.campaign.maximumAttempts,512);assert.ok(run.campaign.usedAttempts<=512);
  number(Date.parse(cleanup.finishedAt)-Date.parse(run.campaign.startedAt),'Campaign elapsed milliseconds',{max:1800000});
  assert.equal(sum(run.campaign.runs.map(r=>number(r.consumedAttempts,'Campaign consumption',{integer:true,max:353}))),run.campaign.usedAttempts,'Campaign attempt sum mismatch');
  assert.ok(Date.parse(cleanup.finishedAt)>=Date.parse(run.finishedAt),'Cleanup must follow terminal run');
  assert.ok(run.cases.length===contract.passedTests&&run.cases.every(c=>c.status==='passed'&&c.failureMessages.length===0),'Selected cases must all pass');
  assert.equal(setup.status,'passed');assert.equal(setup.tableCount,contract.tableCount);assert.equal(setup.migrations.length,contract.migrationCount);assert.equal(setup.provisioners.length,3);assert.deepEqual(setup.ledger,setup.migrations);
  assert.match(setup.version,/^PostgreSQL 18\.6 /);assert.deepEqual(setup.ownerAndRuntimeMemberships,[]);
  assert.deepEqual(setup.roles.map(r=>r.rolname).sort(),['cp28_snapshot_owner','league_one_account','league_one_auth','league_one_runtime']);
  for(const r of setup.roles){assert.equal(r.rolcanlogin,true);for(const k of ['rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls'])assert.equal(r[k],false);}
  for(const k of ['processAbsent','listenerAbsent','dataDirectoryRemoved','retainedEvidenceContainsNoGeneratedSecrets'])assert.equal(cleanup[k],true);
  assert.equal(cleanup.precleanupEstablishedClients,0);assert.equal(orchestration.testPassed,true);assert.equal(orchestration.cleanupPassed,true);assert.equal(orchestration.failure,null);
  const log=files['native-results.log'].toString('utf8').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g,'');
  assert.match(contract.marker,/^[A-Z0-9_]+$/);const markers=[...log.matchAll(new RegExp('^'+contract.marker+' (\\{[^\\r\\n]*\\})$','gm'))];assert.equal(markers.length,1,'Missing or duplicate native allocation marker');
  if(contract.validateWindow)contract.validateWindow(log,run);
  const allocation=contract.validateAllocation(JSON.parse(markers[0][1]),historical),results=parsed['native-results.json'];
  assert.equal(results.success,true);assert.equal(results.numPassedTests,contract.passedTests);assert.equal(results.numFailedTests,0);assert.equal(results.numPendingTests,contract.pendingTests);
  return {schemaVersion:1,kind:contract.measurementKind,qualification:'UNQUALIFIED',acceptedLocalExperiment:'PASSED',provenance:pin,
    executedOverlay:candidate.sources,helperSources:helpers.sources,terminal:{summary:run.summary,cases:run.cases,actualReservedAttempts:run.actualReservedAttempts,campaignUsedAttempts:run.campaign.usedAttempts,cleanupComplete:true},allocation};
}
function validateCombined(m,historical,pinned=true){
  exact(m,['schemaVersion','kind','qualification','acceptedLocalExperiment','provenance','executedOverlay','helperSources','terminal','allocation'],'combined measurement');
  assert.equal(m.schemaVersion,1);assert.equal(m.kind,'cp28-source-bound-combined-measurement');assert.equal(m.qualification,'UNQUALIFIED');assert.equal(m.acceptedLocalExperiment,'PASSED');
  assert.deepEqual(m.provenance,COMBINED_PIN);validateAbAllocation(m.allocation,historical);
  if(pinned)assert.equal(sha(JSON.stringify(m)),COMBINED_EXTRACTION_SHA,'Pinned combined extraction mismatch');return m;
}
function nativeMeasuredPhase(p,inventory){const measured=abDelta(p.before,p.after,inventory),warm=abDelta(p.beforeWarm,p.before,inventory);
    const incrementalBatches=p.batches.map((b,i)=>({cores:8,...abDelta(i?p.batches[i-1].snapshot:p.before,b.snapshot,inventory)}));
    return {mode:p.mode,warmup:{cores:2,delta:warm},measured:{cores:32,delta:measured},incrementalBatches,
      meanDataAllocatedBytesPerCore:measured.dataAllocatedBytes/32,meanSyntheticControlAllocatedBytesPerCore:measured.syntheticControlAllocatedBytes/32,meanAllRelationTupleBytesPerCore:measured.totals.tupleBytes/32,meanDataTupleBytesPerCore:(measured.groups['per-league'].tupleBytes+measured.groups.shared.tupleBytes)/32,meanSyntheticControlTupleBytesPerCore:measured.groups.controls.tupleBytes/32,reader:p.reader};}
function nativeCapacityScenarios(combined,input,initialCatalogProxy,nextReduction='Review additional lossless metadata normalization (B2) or explicitly revise the capacity contract; finite local sensitivity is not a proven long-run bound.',fixture=AB_FIXTURE){
  return [5,4].map(minutes=>{
    const h=input.horizon,n=input.benchmarkUniqueLeagues,activeCoreEvents=n*h.activeDays*h.activeHoursPerDay*60/minutes,inactiveCoreEvents=n*h.inactiveDays;
    const volumes={coreEvents:activeCoreEvents+inactiveCoreEvents,earlierEvents:n*h.days*input.cadence.earlierPeriodsPerDailySweep,
      resultEvents:n*(h.activeDays*h.activeHoursPerDay*60/input.cadence.resultActiveMinutes+h.inactiveDays),dailyLeagueEvents:n*h.days,catalogEvents:h.days,one:1};
    const terms=input.terms.map(t=>({...t,events:volumes[t.volume],bytes:t.rate.bytesPerEvent===null?null:number(volumes[t.volume]*t.rate.bytesPerEvent,'Assumed term product')}));
    const conditionalCoreDataBytes=volumes.coreEvents*combined.meanDataAllocatedBytesPerCore,pricedSubtotal=conditionalCoreDataBytes+initialCatalogProxy,
      assumedBytes=number(sum(terms.map(t=>t.bytes??0)),'Assumed term sum'),unknown=terms.filter(t=>t.bytes===null).map(t=>t.id);
    number(pricedSubtotal+assumedBytes,'Conditional total');
    return {name:minutes===5?'five-minute-contract-benchmark-sensitivity':'four-minute-source-due-sensitivity',activeMinutes:minutes,status:'CONDITIONAL_UNQUALIFIED',cadenceObserved:false,
      activeCoreEvents,inactiveCoreEvents,volumes,fixedLocalFixture:fixture,conditionalCoreDataBytes,conditionalCoreDataGiB:conditionalCoreDataBytes/GIB,
      historicalInitialCatalogProxyOnceBytes:initialCatalogProxy,pricedSubtotalBytes:pricedSubtotal,pricedSubtotalGiB:pricedSubtotal/GIB,terms,unknownTerms:unknown,
      equation:'conditional total = pricedSubtotalBytes + explicitlyAssumedBytes + U(unpriced terms)',explicitlyAssumedBytes:assumedBytes,
      numericConditionalTotalBytes:unknown.length?null:pricedSubtotal+assumedBytes,pricedAndAssumedBytes:pricedSubtotal+assumedBytes,remainingBudgetBeforeUBytes:input.budgetBytes-pricedSubtotal-assumedBytes,
      exceedsBudgetBeforeUInThisConditionalSensitivity:pricedSubtotal+assumedBytes>input.budgetBytes,
      generousCoreByteCeilingIfEveryOtherCostWereZero:(input.budgetBytes-initialCatalogProxy)/volumes.coreEvents,ceilingIsNotACompleteBudget:true,
      separateSyntheticControlSensitivity:{bytes:volumes.coreEvents*combined.meanSyntheticControlAllocatedBytesPerCore,interpretation:'Not in priced subtotal. Synthetic controls cannot replace ordinary scheduling/failure terms; never add both.'},
      inventoryComplete:true,ratesComplete:unknown.length===0,capacityQualified:false,
      nextDecision:pricedSubtotal+assumedBytes>input.budgetBytes?nextReduction:'Price remaining U and benchmark geometry before a capacity claim; apparent headroom is not a measured pass.'};
  });
}
function combinedForecast(m,input,historical,originalVerified){
  const inventory=abInventory(historical),a=m.allocation;
  const phase=p=>nativeMeasuredPhase(p,inventory);
  const legacy=phase(a.legacy),combined=phase(a.combined),initialCatalogProxy=historical.deltas[0].groups.shared.allocatedBytes;assert.equal(initialCatalogProxy,31285248);
  const scenarios=nativeCapacityScenarios(combined,input,initialCatalogProxy);
  const d=combined.measured.delta;
  return {schemaVersion:1,kind:'cp28-combined-all-family-conditional-forecast',qualification:'UNQUALIFIED',inventoryComplete:true,ratesComplete:input.terms.every(t=>t.rate.bytesPerEvent!==null),capacityQualified:false,
    originalEvidenceVerification:originalVerified?'ACCEPTED_LOCAL_ORIGINAL_BYTES_AND_EXTRACTION_VERIFIED':'PINNED_EXTRACTION_VALIDATED_ORIGINAL_NOT_REVERIFIED',
    provenance:{combined:m.provenance,combinedExtractionSha256:COMBINED_EXTRACTION_SHA,capacityInputsCanonicalSha256:sha(JSON.stringify(input)),historicalCatalog:{...MEASUREMENT_PIN,extractionSha256:MEASUREMENT_SHA,phase:'S0-empty to S1-catalog',sharedDeltaBytes:initialCatalogProxy}},
    budgetBytes:input.budgetBytes,horizon:input.horizon,fixture:a.fixture,officialFamilies:input.officialFamilies,workloadCoverage:input.workloads,
    observed:{uniqueSnapshots:22,relationObservations:22*157,semanticAndStartupBoundaries:a.semanticBoundaries.map((s,i)=>({boundary:s.boundary,mode:s.mode,counters:s.counters,deltaFromPrevious:i?abDelta(a.semanticBoundaries[i-1],s,inventory):null})),legacy,combined,
      affectedAllocationDifferenceBytes:a.affectedAllocatedBytes.legacy-a.affectedAllocatedBytes.combined,allPublicAllocationDifferenceBytes:a.allPublicAllocatedBytes.legacy-a.allPublicAllocatedBytes.combined,
      otherAllocationDifferenceBytes:(a.allPublicAllocatedBytes.legacy-a.allPublicAllocatedBytes.combined)-(a.affectedAllocatedBytes.legacy-a.affectedAllocatedBytes.combined),counters:a.counters,terminal:m.terminal},scenarios,
    residualMetadataAttribution:{status:'DESIGN_INPUT_ONLY_NOT_MEASURED_B2_SAVINGS',fixtureSpecificSharedAccountGrowth:d.relations.find(r=>r.name==='public.league_source_manager_accounts'),relationDeltasDescendingAllocation:[...d.relations].sort((x,y)=>y.total-x.total||x.name.localeCompare(y.name)),nonadditiveColumnDiagnostics:d.nonadditiveColumnDiagnostics,
      instruction:'Columns overlap tuples; tuples are pg_column_size(row), not allocation. Neither is additive to heap/index/TOAST totals. Retain receipt IDs, witness/fence/lineage and logical JSON/hash. No B2 implementation or savings claimed.'},
    operationalMultiplicity:{core:'4 typed captures/core, with one standings acceptance and three eligible B1 receipt references; fresh B1 parent remains once/core.',exactPeriods:'2 typed captures/current or earlier exact-period event. Current/earlier volumes are disjoint.',
      transactions:'Source-exposed transaction periods include week0 where available, corrections and removals; 17 earlier periods is an assumption, with additional periods explicitly unpriced.',
      drafts:'For D source-exposed drafts, 2+3D typed captures per complete cycle, plus selection links per applicable acceptance. D and pick counts are not bounded by the old single-draft/20-pick fixture.',
      historyControls:'Period/history/checkpoint and ordinary scheduling controls remain unpriced; never infer these from synthetic direct prerequisites.',
      rosterEpochs:'Mapping revision, directory version and resolver/storage-version changes can require new A content sets; warmed unchanged reuse does not price those epochs.'},
    limitations:[
      'Official-family/workload inventory is complete as a model mapping; source census, observed rates and capacity qualification are not complete.',
      'One local 10-team/80-held warmed fixture cannot be promoted to hosted 20-team/160-held or full benchmark. No whole-core occupancy scaling.',
      'Four 8-core batches/layout are finite ordered differences affected by spare pages/index/TOAST thresholds/shared residuals; not stationary slopes, confidence intervals or lower bounds.',
      'Whole combined DATA replaces old core/raw/proof/standings/link terms; independent A/B1 savings are not added. Shared tables are event-conditioned, never repeatedly summed as full table totals.',
      'Corrections, directory/mapping epochs and new A content remain U. Fresh B1 parents and every capture receipt remain retained.',
      'Synthetic prerequisites create a fresh league_source_manager_accounts row per core. Its shared DATA growth remains in the measured mean; ordinary repeats for an existing account need not create it. No subtraction or savings is inferred.',
      'Historical catalog first-load delta is once-per-fleet startup proxy. Local catalog/old seed/warmups/semantic startup are not added to recurring rates; other required startup remains U.',
      'Five-minute/four-minute schedules are sensitivities, not measured cadence. Bundled settings receive no daily cost credit. Current/earlier periods are disjoint.',
      'Synthetic controls are separate diagnostics; ordinary controls/failures are U. Missing costs are null, never zero. Explicit assumed prices yield only conditional totals.',
      'All accepted records/versions/provenance retained through March 31, 2028; no automatic purge/cadence reduction. CP29 isolated restore and release qualification remain separate.',
      'WAL/backups/production billing/long-run maintenance/source-shape bounds unproven. No SQL/provider/hosted/publication/deployment authority granted.',
    ]};
}
function combinedSelfTest(m,input,historical,assumptions,originalPath){
  let passed=0;const test=f=>{f();passed++;};test(()=>validateCombined(m,historical));test(()=>validateCapacityInputs(input,assumptions));
  for(const mutate of [
    x=>x.allocation.semanticBoundaries.pop(),x=>x.allocation.combined.before.relations.pop(),
    x=>{x.allocation.combined.before.modeTriggers[0].function_name='capture_roster_player_links';},
    x=>{x.allocation.combined.before.relations[0].total='01';},x=>{x.allocation.combined.before.relations[0].heap=String(Number(x.allocation.combined.before.relations[0].heap)+1);},
    x=>{x.allocation.combined.batches[0].snapshot.counters.resourceReservations++;},x=>{x.allocation.combined.after=x.allocation.combined.before;},
    x=>x.allocation.combined.before.columns.pop(),x=>{x.allocation.fixture.heldPerCore=160;},x=>{x.allocation.affectedAllocatedBytes.combined++;},
    x=>{x.allocation.counters.resourceReservations++;},x=>{x.allocation.historicalDigestChecksPassed=false;},x=>{x.allocation.restoredLegacy=false;},x=>{x.allocation.externalProviderCalls=1;},
  ])test(()=>{const x=structuredClone(m);mutate(x);assert.throws(()=>validateCombined(x,historical,false));});
  for(const mutate of [
    x=>x.terms.pop(),x=>{x.terms[0].rate.bytesPerEvent=0;},x=>{x.terms[0].rate={status:'measured',bytesPerEvent:1,provenance:'unsupported'};},
    x=>{x.terms[0].rate={status:'assumed',bytesPerEvent:-1,provenance:'invalid'};},x=>{x.terms[0].volume='one';},x=>x.workloads[0].coverageRefs.pop(),
    x=>{x.budgetBytes++;},x=>{x.cadence.sourceDueSensitivityMinutes=5;},
  ])test(()=>{const x=structuredClone(input);mutate(x);assert.throws(()=>validateCapacityInputs(x,assumptions));});
  const r=combinedForecast(m,input,historical,false),five=r.scenarios[0],four=r.scenarios[1];
  test(()=>assert.deepEqual(r.scenarios.map(s=>s.volumes.coreEvents),[591728,736880]));
  test(()=>assert.equal(five.volumes.earlierEvents,223312));test(()=>assert.equal(five.volumes.resultEvents,204656));test(()=>assert.equal(five.volumes.dailyLeagueEvents,13136));test(()=>assert.equal(five.volumes.catalogEvents,821));
  test(()=>assert.equal(five.conditionalCoreDataBytes,591728*r.observed.combined.meanDataAllocatedBytesPerCore));
  test(()=>assert.equal(five.pricedSubtotalBytes,five.conditionalCoreDataBytes+31285248));test(()=>assert.equal(four.pricedSubtotalBytes-four.conditionalCoreDataBytes,31285248));
  test(()=>assert.equal(five.numericConditionalTotalBytes,null));test(()=>assert.equal(five.unknownTerms.length,15));test(()=>assert.ok(r.inventoryComplete&&!r.ratesComplete&&!r.capacityQualified));
  test(()=>{const inventory=abInventory(historical),p=m.allocation.combined,reverse=s=>({...s,relations:[...s.relations].reverse(),columns:[...s.columns].reverse()});
    validateAbSnapshot(reverse(p.before),inventory);const original=abDelta(p.before,p.after,inventory),permuted=abDelta(reverse(p.before),reverse(p.after),inventory);
    assert.deepEqual(permuted.groups,original.groups);assert.deepEqual([...permuted.nonadditiveColumnDiagnostics].sort((a,b)=>(a.name+a.column).localeCompare(b.name+b.column)),[...original.nonadditiveColumnDiagnostics].sort((a,b)=>(a.name+a.column).localeCompare(b.name+b.column)));});
  test(()=>assert.equal(sum(r.observed.combined.incrementalBatches.map(b=>b.dataAllocatedBytes)),r.observed.combined.measured.delta.dataAllocatedBytes));
  test(()=>assert.equal(r.observed.combined.measured.delta.totals.total,sum(Object.values(r.observed.combined.measured.delta.groups).map(g=>g.total))));
  test(()=>{const x=structuredClone(input);x.terms.forEach(t=>{t.rate={status:'assumed',bytesPerEvent:1,provenance:'Test-only explicit numeric sensitivity'};});validateCapacityInputs(x,assumptions);const t=combinedForecast(m,x,historical,false);
    assert.equal(t.ratesComplete,true);assert.equal(t.capacityQualified,false);assert.equal(t.scenarios[0].numericConditionalTotalBytes,t.scenarios[0].pricedSubtotalBytes+sum(t.scenarios[0].terms.map(z=>z.events)));});
  test(()=>{const x=structuredClone(m);x.terminal.campaignUsedAttempts++;assert.throws(()=>validateCombined(x,historical));});
  test(()=>{const x=structuredClone(input);x.terms[0].rate={status:'assumed',bytesPerEvent:1024**4,provenance:'Test-only unsafe arithmetic'};validateCapacityInputs(x,assumptions);assert.throws(()=>combinedForecast(m,x,historical,false),/Assumed term product/);});
  if(originalPath){test(()=>assert.deepEqual(deriveCombined(originalPath,historical),m));
    for(const name of COMBINED_FILES){const bytes=boundedBytes(join(dirname(resolve(originalPath)),name));
      test(()=>assert.throws(()=>verifyCombinedOriginal(name,Buffer.concat([bytes,Buffer.from(' ')]))));
      test(()=>{const changed=Buffer.from(bytes);changed[changed.length-2]^=1;assert.throws(()=>verifyCombinedOriginal(name,changed));});}
  }
  return {qualification:'UNQUALIFIED',combinedSelfTestsPassed:passed,failed:0,originalBytesReverified:Boolean(originalPath),sqlOrNetworkExecuted:false};
}
function combinedMain(args){
  const flags=['--combined','--derive-combined','--self-test'],values=['--combined-evidence','--combined-measurement','--capacity-inputs'],opts={};
  for(let i=0;i<args.length;i++){const key=args[i];if(![...flags,...values].includes(key)||Object.hasOwn(opts,key))fail('Unknown/duplicate combined argument');
    if(flags.includes(key))opts[key]=true;else{if(!args[i+1]||args[i+1].startsWith('--'))fail('Missing combined value');opts[key]=args[++i];}}
  const historical=validateMeasurement(json(fileURLToPath(MEASUREMENT_DEFAULT)));
  if(opts['--derive-combined']){assert.equal(Object.keys(opts).length,2);assert.ok(opts['--combined-evidence']);process.stdout.write(JSON.stringify(deriveCombined(opts['--combined-evidence'],historical),null,2)+'\n');return;}
  assert.equal(opts['--combined'],true,'Combined mode must be explicit');
  const assumptions=validateAssumptions(json(fileURLToPath(new URL('../docs/aggregator-backend/data-backend-cp28-assumptions.json',import.meta.url))));
  const input=validateCapacityInputs(json(opts['--capacity-inputs']??fileURLToPath(CAPACITY_DEFAULT)),assumptions);
  const m=validateCombined(json(opts['--combined-measurement']??fileURLToPath(COMBINED_DEFAULT),8*1024**2),historical);
  if(opts['--combined-evidence'])assert.deepEqual(deriveCombined(opts['--combined-evidence'],historical),m,'Combined original extraction parity mismatch');
  const result=opts['--self-test']?combinedSelfTest(m,input,historical,assumptions,opts['--combined-evidence']):combinedForecast(m,input,historical,Boolean(opts['--combined-evidence']));
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}

// Candidate-only capacity is a new, unaccepted source-bound lane. Unit fixtures are never evidence.
const PROVENANCE_PIN = null;
const PROVENANCE_EXTRACTION_SHA = null;
const PROVENANCE_DEFAULT = new URL('../docs/aggregator-backend/data-backend-cp28-provenance-measurement.json',import.meta.url);
const PROVENANCE_COLUMNS = [...AB_COLUMNS,{name:'public.league_roster_provenance_contents',column:'provenance'}];
const PROVENANCE_FIXTURE = {leagues:2,teamsPerLeague:20,teamsTotal:40,heldPerCore:160,heldAcrossLeagues:320,uniqueCatalogPlayers:160};
function provenanceInventory(historical){return new Map([...abInventory(historical),['public.league_roster_provenance_contents','per-league']]);}
function provenanceTriggers(enabled){return enabled?[{name:'roster_metadata_intern_before_lineage',event_type:7,enabled:'O',exact_table:true,exact_function:true,unconditional_no_arguments:true}]:[];}
function validateProvenanceSnapshot(s,inventory){
  exact(s,['boundary','mode','writerMode','counters','modeTriggers','provenanceTriggers','representations','relations','columns'],'provenance snapshot');
  assert.ok(typeof s.boundary==='string'&&s.boundary.length>0);assert.ok(['AB','AB+B2'].includes(s.mode));assert.ok(['legacy','A','B1','AB'].includes(s.writerMode));
  exact(s.counters,['witnessedCores','resourceReservations','syntheticCoreHttpResponses','successfulWitnessedCores'],'provenance counters');
  Object.values(s.counters).forEach(v=>number(v,'counter',{integer:true,max:512}));
  assert.ok(s.counters.successfulWitnessedCores<=s.counters.witnessedCores,'Successful core count exceeds attempts');
  assert.equal(s.counters.syntheticCoreHttpResponses,s.counters.witnessedCores*2,'Fixture response multiplicity mismatch');
  assert.deepEqual(s.modeTriggers,abExpectedTriggers(s.writerMode),'Exact AB writer mode mismatch');
  assert.deepEqual(s.provenanceTriggers,provenanceTriggers(s.mode==='AB+B2'),'Exact B2 writer mode mismatch');
  validateNativeRelationMetrics(s,inventory,158,PROVENANCE_COLUMNS);
  exact(s.representations,['populationSharedReceipts','provenanceSharedReceipts'],'shared receipt representations');
  for(const v of Object.values(s.representations))number(v,'shared receipt count',{integer:true,max:s.relations.find(r=>r.name==='public.league_roster_capture_receipts').rows});
}

const PROVENANCE_WORKLOAD={semanticCores:9,interactionAttemptedCores:3,expectedFailedCores:2,warmCoresPerLayout:2,measuredCoresPerLayout:32,attemptsPerCore:4,receiptsPerSuccessfulCore:4,acceptedStandingsPerSuccessfulCore:1,eligiblePopulationReceiptsPerCore:3,eligibleProvenanceReceiptsPerCore:3,boundaryReservationAllowance:8};
const PROVENANCE_BOUNDARIES=['empty-migrated-schema','synthetic-prerequisites','baseline-AB','candidate-legacy','candidate-A','candidate-B1','candidate-AB','cross-league-correction-return','after-security-and-witnessed-interactions'];
const PROVENANCE_POLICIES=['sleeper-league-settings-v1','sleeper-current-players-v1','sleeper-current-team-managers-v1','sleeper-current-team-manager-evidence-v2'];
const PROVENANCE_NATIVE_CONTRACT={pin:PROVENANCE_PIN,tableCount:158,migrationCount:65,sourceCount:null,helperCount:12,totalTests:21,passedTests:4,pendingTests:17,reservedAttempts:null,marker:'CP28_B2_ALLOCATION',measurementKind:'cp28-source-bound-candidate-capacity-measurement',validateAllocation:validateProvenanceAllocation,validateWindow:validateCandidateMeasurementWindow};
function validateCandidateMeasurementWindow(log,run){
  const matches=[...log.matchAll(/^CP28_B2_MEASUREMENT_WINDOW (\{[^\r\n]*\})$/gm)];
  assert.equal(matches.length,1,'Missing or duplicate candidate measurement window');const w=JSON.parse(matches[0][1]);
  exact(w,['campaignStartedAt','campaignDeadlineAt','checkedAt','remainingMs','minimumRemainingMs'],'candidate measurement window');
  for(const k of ['campaignStartedAt','campaignDeadlineAt','checkedAt']){assert.ok(typeof w[k]==='string'&&Number.isFinite(Date.parse(w[k])),'Invalid measurement window timestamp');assert.equal(new Date(w[k]).toISOString(),w[k],'Measurement timestamps must be canonical ISO');}
  const started=Date.parse(w.campaignStartedAt),deadline=Date.parse(w.campaignDeadlineAt),checked=Date.parse(w.checkedAt);
  assert.equal(w.campaignStartedAt,run.campaign.startedAt,'Measurement campaign start mismatch');assert.equal(run.campaign.maximumMs,1800000);
  assert.equal(deadline-started,1800000,'Measurement campaign deadline was extended');assert.ok(checked>=started&&checked>=Date.parse(run.startedAt)&&checked<=Date.parse(run.finishedAt),'Measurement check outside original run');
  assert.equal(w.minimumRemainingMs,480000);assert.equal(w.remainingMs,deadline-checked,'Measurement remaining time mismatch');number(w.remainingMs,'Measurement remaining milliseconds',{integer:true,min:480000,max:1800000});return w;
}
function validateProvenanceAllocation(a,historical){
  exact(a,['schemaVersion','kind','fixture','workload','semanticBoundaries','candidate','counters','historicalDigestChecksPassed','restoredAllThreeWriters','externalProviderCalls','limitations'],'candidate capacity allocation');
  assert.equal(a.schemaVersion,1);assert.equal(a.kind,'local-native-cp28-candidate-capacity-v1');assert.deepEqual(a.fixture,PROVENANCE_FIXTURE);assert.deepEqual(a.workload,PROVENANCE_WORKLOAD);
  assert.equal(a.historicalDigestChecksPassed,true);assert.equal(a.restoredAllThreeWriters,true);assert.equal(a.externalProviderCalls,0);assert.ok(Array.isArray(a.limitations)&&a.limitations.length>=10);
  exact(a.counters,['witnessedCores','successfulWitnessedCores','expectedFailedCores','resourceReservations','syntheticCoreHttpResponses'],'candidate terminal counters');
  assert.deepEqual(a.counters,{witnessedCores:46,successfulWitnessedCores:44,expectedFailedCores:2,resourceReservations:187,syntheticCoreHttpResponses:92},'Candidate-only terminal counters mismatch');
  assert.deepEqual(a.semanticBoundaries.map(x=>x.boundary),PROVENANCE_BOUNDARIES,'Provenance semantic boundary inventory mismatch');
  assert.deepEqual(a.semanticBoundaries.map(x=>x.mode),['AB','AB','AB','AB+B2','AB+B2','AB+B2','AB+B2','AB+B2','AB+B2']);
  assert.deepEqual(a.semanticBoundaries.map(x=>x.writerMode),['legacy','legacy','AB','legacy','A','B1','AB','AB','AB']);
  assert.deepEqual(a.semanticBoundaries.map(x=>x.counters.witnessedCores),[0,0,2,3,4,5,6,9,12],'Semantic attempted core counts mismatch');
  assert.deepEqual(a.semanticBoundaries.map(x=>x.counters.successfulWitnessedCores),[0,0,2,3,4,5,6,9,10],'Semantic successful core counts mismatch');
  assert.deepEqual(a.candidate.beforeWarm.counters,a.semanticBoundaries.at(-1).counters,'Semantic/candidate counter continuity mismatch');
  const inventory=provenanceInventory(historical),p=a.candidate,mode='AB+B2';
  exact(p,['mode','beforeWarm','before','after','batches','historicalDigestChecksPassed','compression','reader','measured'],'candidate measured phase');
  assert.equal(p.mode,mode);assert.equal(p.historicalDigestChecksPassed,true);assert.deepEqual(p.batches.map(b=>b.cores),[8,16,24,32]);assert.deepEqual(p.after,p.batches[3].snapshot,'Final boundary alias mismatch');
  assert.deepEqual(p.measured,{cores:32,receipts:128,populationParents:32,provenanceParents:32,populationReferences:96,provenanceReferences:96,reusedLinkContents:2});
  const chain=[p.beforeWarm,p.before,...p.batches.map(b=>b.snapshot)],snapshots=[...a.semanticBoundaries,...chain];
  assert.equal(snapshots.length,15);assert.equal(new Set(snapshots.map(x=>x.boundary)).size,15,'Candidate snapshot boundaries must be unique');
  assert.deepEqual(chain.map(x=>x.boundary),[mode+'-before-warm',mode+'-measured-start',...[8,16,24,32].map(n=>mode+'-measured-'+n)]);assert.ok(chain.every(x=>x.mode===mode&&x.writerMode==='AB'));
  for(let i=1;i<chain.length;i++){const cores=i===1?2:8;for(const k of ['witnessedCores','successfulWitnessedCores'])assert.equal(chain[i].counters[k]-chain[i-1].counters[k],cores,'Measured successful core multiplicity mismatch');assert.equal(chain[i].counters.resourceReservations-chain[i-1].counters.resourceReservations,cores*4,'Measured reservation multiplicity mismatch');}
  exact(p.reader,['standingsElapsedMs','linksElapsedMs','publicElapsedMs','standingsQueries','linkQueries','publicQueries','publicResult','teams','held'],'provenance reader evidence');
  for(const k of ['standingsElapsedMs','linksElapsedMs','publicElapsedMs'])number(p.reader[k],k);
  assert.deepEqual([p.reader.standingsQueries,p.reader.linkQueries,p.reader.publicQueries,p.reader.teams,p.reader.held],[1,1,2,20,160]);
  assert.equal(p.reader.publicResult.captureBinding,'intake-dispatch');assert.equal(p.reader.publicResult.resource.status,'available');assert.equal(p.reader.publicResult.resource.teams.length,20);assert.ok(p.reader.publicResult.acquisition);
  assert.equal(p.compression.length,4);assert.deepEqual(p.compression.map(c=>c.policy),PROVENANCE_POLICIES);
  for(let i=0;i<p.compression.length;i++){const c=p.compression[i];exact(c,['policy','provenance_storage_format','receipt_tuple_bytes','logical_provenance_bytes','inline_provenance_bytes','provenance_compression','attempt_tuple_bytes','mapping_bytes','mapping_compression','fence_bytes','fence_compression'],'existing-row compression diagnostic');
    assert.equal(c.provenance_storage_format,i?'shared-v1':'inline-v1');for(const k of ['receipt_tuple_bytes','logical_provenance_bytes','attempt_tuple_bytes','mapping_bytes','fence_bytes'])number(c[k],k,{integer:true,min:1,max:1048576});
    if(i){assert.equal(c.inline_provenance_bytes,null);assert.equal(c.provenance_compression,null);}else number(c.inline_provenance_bytes,'inline provenance bytes',{integer:true,min:1,max:1048576});
    for(const k of ['provenance_compression','mapping_compression','fence_compression'])assert.ok([null,'pglz','lz4'].includes(c[k]));
  }
  snapshots.forEach(x=>validateProvenanceSnapshot(x,inventory));const first=snapshots[0];assert.equal(sum(first.relations.map(r=>r.rows)),66,'Migrated baseline requires65 ledger rows and singleton');
  for(let i=1;i<snapshots.length;i++)assert.ok(snapshots[i].counters.resourceReservations>=snapshots[i-1].counters.resourceReservations,'Reservation counters must never reset');
  for(const snapshot of snapshots){
    assert.deepEqual(snapshot.relations.filter(r=>r.schema==='website_auth').sort((a,b)=>a.name.localeCompare(b.name)),first.relations.filter(r=>r.schema==='website_auth').sort((a,b)=>a.name.localeCompare(b.name)),'Auth baseline changed');
    for(const r of snapshot.relations.filter(r=>inventory.get(r.name)==='non-data')){const before=first.relations.find(x=>x.name===r.name);assert.deepEqual([r.rows,r.tupleBytes],[before.rows,before.tupleBytes],'Non-DATA logical baseline changed');}
  }
  const d=abDelta(p.before,p.after,inventory),rows=t=>d.relations.find(r=>r.name==='public.'+t).rows;
  for(const t of ['league_roster_resource_attempts','league_roster_capture_receipts','league_roster_resource_acceptances'])assert.equal(rows(t),128,'Fresh typed multiplicity mismatch');
  assert.equal(rows('league_roster_population_contents'),32);assert.equal(rows('league_roster_provenance_contents'),32);
  for(const t of ['league_roster_player_link_receipts','league_official_standings_captures'])assert.equal(rows(t),32);
  for(const t of ['league_roster_player_links','league_roster_player_link_contents','league_roster_player_link_content_entries'])assert.equal(rows(t),0,'Warmed link reuse mismatch');
  assert.equal(p.after.representations.populationSharedReceipts-p.before.representations.populationSharedReceipts,96,'Population reference multiplicity mismatch');
  assert.equal(p.after.representations.provenanceSharedReceipts-p.before.representations.provenanceSharedReceipts,96,'Provenance reference multiplicity mismatch');
  assert.deepEqual(p.after.counters,{witnessedCores:46,resourceReservations:a.counters.resourceReservations,syntheticCoreHttpResponses:92,successfulWitnessedCores:44});return a;
}
function deriveProvenance(path,historical){return deriveNativeMeasurement(path,historical,PROVENANCE_NATIVE_CONTRACT);}
function validateProvenance(m,historical,pinned=true){
  assert.ok(PROVENANCE_PIN,'No accepted provenance evidence');exact(m,['schemaVersion','kind','qualification','acceptedLocalExperiment','provenance','executedOverlay','helperSources','terminal','allocation'],'provenance measurement');
  assert.equal(m.schemaVersion,1);assert.equal(m.kind,'cp28-source-bound-candidate-capacity-measurement');assert.equal(m.qualification,'UNQUALIFIED');assert.equal(m.acceptedLocalExperiment,'PASSED');assert.deepEqual(m.provenance,PROVENANCE_PIN);
  validateProvenanceAllocation(m.allocation,historical);assert.equal(m.terminal.actualReservedAttempts,m.allocation.counters.resourceReservations);
  if(pinned)assert.equal(sha(JSON.stringify(m)),PROVENANCE_EXTRACTION_SHA,'Pinned provenance extraction mismatch');return m;
}
function provenanceForecast(m,input,historical,originalVerified){
  const a=m.allocation,inventory=provenanceInventory(historical),candidate=nativeMeasuredPhase(a.candidate,inventory),catalog=historical.deltas[0].groups.shared.allocatedBytes;assert.equal(catalog,31285248);
  const scenarios=nativeCapacityScenarios(candidate,input,catalog,'Review further lossless representation changes or explicitly revise the capacity contract; this finite local sensitivity does not prove a long-run bound.',PROVENANCE_FIXTURE);
  const d=candidate.measured.delta;
  return {schemaVersion:1,kind:'cp28-candidate-capacity-all-family-conditional-forecast',qualification:'UNQUALIFIED',inventoryComplete:true,ratesComplete:input.terms.every(t=>t.rate.bytesPerEvent!==null),capacityQualified:false,
    originalEvidenceVerification:originalVerified?'ACCEPTED_LOCAL_ORIGINAL_BYTES_AND_EXTRACTION_VERIFIED':'PINNED_EXTRACTION_VALIDATED_ORIGINAL_NOT_REVERIFIED',
    provenance:{measurement:m.provenance,extractionSha256:PROVENANCE_EXTRACTION_SHA,capacityInputsCanonicalSha256:sha(JSON.stringify(input)),historicalCatalog:{...MEASUREMENT_PIN,extractionSha256:MEASUREMENT_SHA,phase:'S0-empty to S1-catalog',sharedDeltaBytes:catalog}},
    budgetBytes:input.budgetBytes,horizon:input.horizon,fixture:a.fixture,officialFamilies:input.officialFamilies,workloadCoverage:input.workloads,
    observed:{uniqueSnapshots:15,relationObservations:15*158,semanticAndStartupBoundaries:a.semanticBoundaries.map((s,i)=>({boundary:s.boundary,mode:s.mode,writerMode:s.writerMode,counters:s.counters,deltaFromPrevious:i?abDelta(a.semanticBoundaries[i-1],s,inventory):null})),candidate,counters:a.counters,terminal:m.terminal,
      representationMultiplicities:{candidate:a.candidate.measured},existingRowCompressionDiagnostics:{candidate:a.candidate.compression,interpretation:'Retained-row inspection only; no compression-target tuning, rewrite or causal compression-savings experiment. Composite/column datum sizes are nonadditive diagnostics.'}},scenarios,
    residualMetadataAttribution:{status:'OBSERVED_FINITE_PHASE_ATTRIBUTION_NOT_FUTURE_SAVINGS',fixtureSpecificSharedAccountGrowth:d.relations.find(r=>r.name==='public.league_source_manager_accounts'),relationDeltasDescendingAllocation:[...d.relations].sort((x,y)=>y.total-x.total||x.name.localeCompare(y.name)),nonadditiveColumnDiagnostics:d.nonadditiveColumnDiagnostics,
      instruction:'Columns overlap tuples; tuples are pg_column_size(row), not allocation. Neither is additive to heap/index/TOAST totals. All attempts retain full source mappings/fences. Additional factoring savings are unmeasured.'},
    operationalMultiplicity:{core:'4 fresh typed receipts per successful core;3 B1 references/1 population parent;3 B2 references/1 full-provenance parent in the candidate. The complete candidate DATA mean replaces the earlier AB rate.',
      exactPeriods:'2 typed captures per current or earlier exact-period event; current/earlier event volumes are disjoint.',transactions:'Source-exposed transaction periods include week0, corrections and removals;17 earlier periods is an assumption, with additional periods unpriced.',
      drafts:'For D source-exposed drafts,2+3D typed captures per complete cycle plus selection links per applicable acceptance; D and pick counts remain unpriced source inventory.',
      historyControls:'Period/history/checkpoint and ordinary controls/failures remain U; synthetic prerequisites cannot price ordinary operations.',rosterEpochs:'Mapping/directory/resolver epochs and corrections can require new content; warmed unchanged reuse does not price those events.'},
    limitations:[
      'A successful local candidate-only experiment is separate from CP28 capacity qualification, all-family rates, full-profile qualification and release activation. No matched baseline or savings percentage is measured.',
      'Each local core represents 20 teams/160 held players; two leagues contain 40 teams/320 held players and 160 shared catalog identities. 160 held is a declared fixture, not a maximum for every supported 20-team league; benchmarkGeometryAdjustment remains U for other held/category/payload distributions.',
      'Four 8-core measured candidate batches after 2 warm cores are finite ordered page/index/TOAST allocations, not stationary slopes, causal allocation guarantees, confidence intervals or lower bounds.',
      'Candidate whole-core DATA replaces earlier whole-core/raw/proof/link/standings rates. No independent A/B1/B2 savings or historical baseline differences are added or subtracted.',
      'All15 original unpriced terms remain explicit; core correction/epoch premiums, noncore family costs, startup, ordinary failures and maintenance are not assumed zero.',
      'Fresh synthetic manager accounts remain in measured shared DATA. Zero allocated-page delta is free-page use, not zero tuple cost or projected savings.',
      'Historical full-catalog first-load allocation is a once-per-fleet startup proxy. Local catalog, warmup and semantic setup are not also charged; other startup remains U.',
      'Five-minute and four-minute schedules are conditional sensitivities, not observed cadence. Bundled settings receive no daily cadence credit.',
      'Synthetic control sensitivity is separate and cannot replace or be added to ordinary control/failure pricing.',
      '46 attempted witnessed cores include two expected failures; 44 succeeded. The measured 32 and warm 2 candidate cores all succeeded; failed probes are outside the measured denominator. 187 actual reservations fit the 193 declared workload ceiling; unused 353-run capacity is not authority for unspecified family work.',
      'All original JSON, observation-specific clocks, receipt/attempt IDs, witnesses, mapping/fence and retained history remain required. B2 parents share only exact within-capture roster provenance; settings and other families stay inline.',
      'Existing-row compression inspection and one local candidate reader timing prove neither a TOAST tuning benefit nor a latency SLO. No storage target changed.',
      'Retention through March31,2028,CP29 restore proof, WAL/backups/billing, long-run maintenance and production geometry remain separate. No provider/hosted/publication/deployment action is authorized by this report.'
    ]};
}

function provenanceUnitSnapshot(historical){
  const inventory=provenanceInventory(historical);
  return {boundary:'UNIT_TEST_ONLY_NOT_OBSERVED',mode:'AB+B2',writerMode:'AB',counters:{witnessedCores:0,resourceReservations:0,syntheticCoreHttpResponses:0,successfulWitnessedCores:0},modeTriggers:abExpectedTriggers('AB'),provenanceTriggers:provenanceTriggers(true),representations:{populationSharedReceipts:0,provenanceSharedReceipts:0},
    relations:[...inventory.keys()].map(name=>{const [schema,table]=name.split('.');return {schema,table,name,rows:0,...Object.fromEntries(AB_BYTES.map(k=>[k,'0']))};}),
    columns:PROVENANCE_COLUMNS.map(c=>({...c,nonnull:0,datumBytes:'0',jsonTextBytes:'0'}))};
}
function provenanceUnitTests(historical,input){
  let passed=0;const test=f=>{f();passed++;},inventory=provenanceInventory(historical),sample=provenanceUnitSnapshot(historical);
  test(()=>validateProvenanceSnapshot(sample,inventory));
  for(const mutate of [x=>x.relations.pop(),x=>x.relations.push(x.relations[0]),x=>{x.relations[0].name='public.unknown';},
    x=>{x.relations[0].heap='1';},x=>{x.relations[0].total='01';},x=>{x.relations[0].tupleBytes='-1';},
    x=>x.columns.pop(),x=>{x.columns[0].column='unknown';},x=>{x.columns[0].nonnull=1;},
    x=>{x.writerMode='A';},x=>{x.mode='AB';},x=>{x.provenanceTriggers[0].exact_function=false;},
    x=>{x.provenanceTriggers[0].event_type=5;},x=>{x.modeTriggers[0].function_name='capture_roster_player_links';},
    x=>{x.counters.successfulWitnessedCores=1;},x=>{x.counters.witnessedCores=1;},x=>{x.counters.resourceReservations=513;},
    x=>{x.representations.provenanceSharedReceipts=1;},x=>{delete x.counters.successfulWitnessedCores;}])test(()=>{const bad=structuredClone(sample);mutate(bad);assert.throws(()=>validateProvenanceSnapshot(bad,inventory));});
  test(()=>{const reordered=structuredClone(sample);reordered.relations.reverse();reordered.columns.reverse();validateProvenanceSnapshot(reordered,inventory);assert.deepEqual(abDelta(sample,reordered,inventory).groups,abDelta(sample,sample,inventory).groups);});
  // A deliberate arithmetic fixture exercises the shared formula; it is never exported as evidence.
  const priced={meanDataAllocatedBytesPerCore:12345,meanSyntheticControlAllocatedBytesPerCore:678},scenarios=nativeCapacityScenarios(priced,input,31285248);
  test(()=>assert.deepEqual(scenarios.map(x=>x.volumes.coreEvents),[591728,736880]));
  test(()=>assert.equal(scenarios[0].conditionalCoreDataBytes,591728*12345));
  test(()=>assert.equal(scenarios[0].pricedSubtotalBytes,591728*12345+31285248));
  test(()=>assert.equal(scenarios[0].separateSyntheticControlSensitivity.bytes,591728*678));
  test(()=>assert.ok(scenarios.every(x=>x.unknownTerms.length===15&&x.numericConditionalTotalBytes===null&&!x.capacityQualified)));
  test(()=>assert.ok(scenarios.every(x=>!x.cadenceObserved&&!x.ratesComplete&&x.inventoryComplete)));
  const window={campaignStartedAt:'2026-10-20T00:00:00.000Z',campaignDeadlineAt:'2026-10-20T00:30:00.000Z',checkedAt:'2026-10-20T00:22:00.000Z',remainingMs:480000,minimumRemainingMs:480000};
  const run={startedAt:'2026-10-20T00:01:00.000Z',finishedAt:'2026-10-20T00:29:00.000Z',campaign:{startedAt:window.campaignStartedAt,maximumMs:1800000}},line=w=>'CP28_B2_MEASUREMENT_WINDOW '+JSON.stringify(w)+'\n';
  test(()=>assert.deepEqual(validateCandidateMeasurementWindow(line(window),run),window));
  for(const mutate of [w=>{w.checkedAt='2026-10-20T00:22:00.001Z';w.remainingMs=479999;},w=>{w.campaignStartedAt='2026-10-20T00:01:00.000Z';},
    w=>{w.campaignDeadlineAt='2026-10-20T00:31:00.000Z';w.remainingMs=540000;},w=>{w.checkedAt='2026-10-20T00:22:00Z';},w=>{w.remainingMs++;},w=>{w.minimumRemainingMs=479999;},
    w=>{w.checkedAt='2026-10-19T23:59:00.000Z';w.remainingMs=1860000;}])test(()=>{const bad=structuredClone(window);mutate(bad);assert.throws(()=>validateCandidateMeasurementWindow(line(bad),run));});
  test(()=>assert.throws(()=>validateCandidateMeasurementWindow('',run)));test(()=>assert.throws(()=>validateCandidateMeasurementWindow(line(window)+line(window),run)));
  return passed;
}

function provenanceUnitAllocation(historical){
  // Deliberately invented numbers for oracle tests only; never a persisted measurement.
  let attempted=0,successful=0,reservations=0,shared=0;
  const snapshot=(boundary,writerMode='AB',enabled=false)=>{
    const x=provenanceUnitSnapshot(historical);x.boundary=boundary;x.writerMode=writerMode;x.mode=enabled?'AB+B2':'AB';x.modeTriggers=abExpectedTriggers(writerMode);x.provenanceTriggers=provenanceTriggers(enabled);
    x.counters={witnessedCores:attempted,resourceReservations:reservations,syntheticCoreHttpResponses:attempted*2,successfulWitnessedCores:successful};
    const row=t=>x.relations.find(r=>r.name==='public.'+t);row('app_schema_migrations').rows=65;row('public_data_resource_service').rows=1;
    row('league_roster_resource_attempts').rows=attempted*4;row('league_roster_capture_receipts').rows=successful*4;row('league_roster_resource_acceptances').rows=successful*4;
    for(const t of ['league_roster_population_contents','league_roster_player_link_receipts','league_official_standings_captures'])row(t).rows=successful;
    row('league_roster_provenance_contents').rows=shared;x.representations={populationSharedReceipts:successful*3,provenanceSharedReceipts:shared*3};
    const receiptBytes=(successful-shared)*8192+shared*4096;row('league_roster_capture_receipts').heap=String(receiptBytes);row('league_roster_capture_receipts').total=String(receiptBytes);
    row('league_roster_provenance_contents').heap=String(shared*1024);row('league_roster_provenance_contents').total=String(shared*1024);return x;
  };
  const semanticBoundaries=PROVENANCE_BOUNDARIES.map((boundary,i)=>{attempted=[0,0,2,3,4,5,6,9,12][i];successful=[0,0,2,3,4,5,6,9,10][i];reservations=i?attempted*4+(i===8?3:1):0;return snapshot(boundary,['legacy','legacy','AB','legacy','A','B1','AB','AB','AB'][i],i>=3);});
  const phase=enabled=>{const mode=enabled?'AB+B2':'AB',beforeWarm=snapshot(mode+'-before-warm','AB',enabled);const advance=cores=>{attempted+=cores;successful+=cores;reservations+=4*cores;if(enabled)shared+=cores;};advance(2);const before=snapshot(mode+'-measured-start','AB',enabled),batches=[];
    for(const cores of [8,16,24,32]){advance(8);batches.push({cores,snapshot:snapshot(mode+'-measured-'+cores,'AB',enabled)});}
    return {mode,beforeWarm,before,after:structuredClone(batches[3].snapshot),batches,historicalDigestChecksPassed:true,
      compression:PROVENANCE_POLICIES.map((policy,i)=>({policy,provenance_storage_format:enabled&&i?'shared-v1':'inline-v1',receipt_tuple_bytes:200,logical_provenance_bytes:100,inline_provenance_bytes:enabled&&i?null:100,provenance_compression:null,attempt_tuple_bytes:150,mapping_bytes:50,mapping_compression:null,fence_bytes:30,fence_compression:null})),
      reader:{standingsElapsedMs:1,linksElapsedMs:1,publicElapsedMs:2,standingsQueries:1,linkQueries:1,publicQueries:2,publicResult:{captureBinding:'intake-dispatch',resource:{status:'available',teams:Array.from({length:20},()=>({}))},acquisition:{testOnly:true}},teams:20,held:160},
      measured:{cores:32,receipts:128,populationParents:32,provenanceParents:enabled?32:0,populationReferences:96,provenanceReferences:enabled?96:0,reusedLinkContents:2}};
  };
  const candidate=phase(true);
  return {schemaVersion:1,kind:'local-native-cp28-candidate-capacity-v1',fixture:PROVENANCE_FIXTURE,workload:PROVENANCE_WORKLOAD,semanticBoundaries,candidate,counters:{witnessedCores:46,successfulWitnessedCores:44,expectedFailedCores:2,resourceReservations:187,syntheticCoreHttpResponses:92},historicalDigestChecksPassed:true,restoredAllThreeWriters:true,externalProviderCalls:0,limitations:Array.from({length:10},()=> 'UNIT_TEST_ONLY_NOT_OBSERVED')};
}
function provenanceAllocationTests(a,historical,input){
  let passed=0;const test=f=>{f();passed++;};test(()=>validateProvenanceAllocation(a,historical));
  for(const mutate of [x=>x.semanticBoundaries.pop(),x=>{x.workload.receiptsPerSuccessfulCore=3;},x=>{x.counters.successfulWitnessedCores=46;},x=>{x.counters.resourceReservations=194;},
    x=>{x.restoredAllThreeWriters=false;},x=>{x.externalProviderCalls=1;},x=>{x.historicalDigestChecksPassed=false;},
    x=>{x.semanticBoundaries[2].counters.successfulWitnessedCores--;},x=>{x.semanticBoundaries.at(-1).counters.resourceReservations++;},
    x=>{for(const q of [x.candidate.beforeWarm,x.candidate.before,...x.candidate.batches.map(b=>b.snapshot)]){q.counters.witnessedCores++;q.counters.successfulWitnessedCores++;q.counters.syntheticCoreHttpResponses+=2;}x.candidate.after=structuredClone(x.candidate.batches[3].snapshot);},
    x=>{x.candidate.measured.provenanceParents=31;},x=>{x.candidate.measured.provenanceReferences=95;},x=>{x.candidate.after=x.candidate.before;},
    x=>{x.candidate.batches[0].snapshot.counters.successfulWitnessedCores--;},x=>{x.candidate.batches[0].snapshot.counters.resourceReservations++;},
    x=>{x.candidate.reader.publicQueries=1;},x=>{x.candidate.reader.publicResult.resource.status='unavailable';},
    x=>{x.candidate.compression[1].provenance_storage_format='inline-v1';},x=>{x.candidate.compression[1].provenance_compression='pglz';},
    x=>{x.baseline=structuredClone(x.candidate);},x=>{x.affectedAllocatedBytes={baseline:100,candidate:50};},
    x=>{x.allPublicAllocatedBytes={baseline:100,candidate:50};},x=>{x.affectedRelations=[];},
    x=>{x.kind='local-native-witnessed-core-provenance-b2-v1';},x=>{x.fixture=structuredClone(AB_FIXTURE);},
    x=>{x.fixture.heldAcrossLeagues=160;},x=>{x.fixture.teamsTotal=20;},x=>{x.fixture.uniqueCatalogPlayers=320;},
    x=>{x.candidate.reader.teams=10;},x=>{x.candidate.reader.held=80;},x=>{x.candidate.reader.publicResult.resource.teams.pop();},
    x=>{x.counters.witnessedCores=80;},x=>{x.counters.syntheticCoreHttpResponses=160;},x=>{x.counters.expectedFailedCores=0;},x=>{x.counters.resourceReservations=186;},
    x=>{x.candidate.before.representations.provenanceSharedReceipts++;},x=>{x.candidate.before.relations.find(r=>r.name==='public.league_roster_provenance_contents').rows++;},
    x=>{x.candidate.before.relations.find(r=>r.schema==='website_auth').rows++;},x=>{x.candidate.before.relations.find(r=>r.name==='public.app_schema_migrations').tupleBytes='1';},
  ])test(()=>{const bad=structuredClone(a);mutate(bad);assert.throws(()=>validateProvenanceAllocation(bad,historical));});
  const inventory=provenanceInventory(historical),p=nativeMeasuredPhase(a.candidate,inventory),scenarios=nativeCapacityScenarios(p,input,31285248);
  test(()=>assert.equal(sum(p.incrementalBatches.map(b=>b.dataAllocatedBytes)),p.measured.delta.dataAllocatedBytes));
  test(()=>assert.equal(p.measured.delta.totals.total,sum(Object.values(p.measured.delta.groups).map(g=>g.total))));
  test(()=>assert.equal(scenarios[0].conditionalCoreDataBytes,p.meanDataAllocatedBytesPerCore*591728));
  test(()=>assert.equal(scenarios[1].pricedSubtotalBytes,736880*p.meanDataAllocatedBytesPerCore+31285248));
  test(()=>{const bad=structuredClone(input);bad.terms[0].rate={status:'assumed',bytesPerEvent:1024**4,provenance:'Unit overflow check'};assert.throws(()=>nativeCapacityScenarios(p,bad,31285248),/Assumed term product/);});
  test(()=>{const bad=structuredClone(a);bad.semanticBoundaries[4].counters.resourceReservations=bad.semanticBoundaries[3].counters.resourceReservations-1;assert.throws(()=>validateProvenanceAllocation(bad,historical),/Reservation counters must never reset/);});
  const forecast=provenanceForecast({allocation:a,provenance:null,terminal:{testDataOnly:true}},input,historical,false);
  test(()=>assert.deepEqual([forecast.observed.uniqueSnapshots,forecast.observed.relationObservations],[15,2370]));
  test(()=>assert.deepEqual(forecast.scenarios.map(x=>x.fixedLocalFixture),[PROVENANCE_FIXTURE,PROVENANCE_FIXTURE]));
  test(()=>{for(const key of ['baseline','affectedAllocationDifferenceBytes','allPublicAllocationDifferenceBytes','otherAllocationDifferenceBytes'])assert.equal(Object.hasOwn(forecast.observed,key),false,'Candidate-only forecast must not report savings');});
  test(()=>assert.ok(!forecast.capacityQualified&&!forecast.ratesComplete&&forecast.scenarios.every(x=>x.unknownTerms.length===15&&x.numericConditionalTotalBytes===null)));
  return passed;
}
function provenanceSelfTest(m,input,historical,originalPath){
  let passed=provenanceUnitTests(historical,input)+provenanceAllocationTests(m.allocation,historical,input);validateProvenance(m,historical);passed++;
  const bad=structuredClone(m);bad.terminal.campaignUsedAttempts++;assert.throws(()=>validateProvenance(bad,historical));passed++;
  if(originalPath){assert.deepEqual(deriveProvenance(originalPath,historical),m);passed++;for(const name of COMBINED_FILES){const bytes=boundedBytes(join(dirname(resolve(originalPath)),name));assert.throws(()=>verifyCombinedOriginal(name,Buffer.concat([bytes,Buffer.from(' ')]),PROVENANCE_PIN));passed++;const changed=Buffer.from(bytes);changed[changed.length-2]^=1;assert.throws(()=>verifyCombinedOriginal(name,changed,PROVENANCE_PIN));passed++;}}
  return {qualification:'UNQUALIFIED',provenanceSelfTestsPassed:passed,failed:0,originalBytesReverified:Boolean(originalPath),sqlOrNetworkExecuted:false};
}

function provenanceMain(args){
  const flags=['--provenance','--derive-provenance','--self-test'],values=['--provenance-evidence','--provenance-measurement','--capacity-inputs'],opts={};
  for(let i=0;i<args.length;i++){const key=args[i];if(![...flags,...values].includes(key)||Object.hasOwn(opts,key))fail('Unknown/duplicate provenance argument');
    if(flags.includes(key))opts[key]=true;else{if(!args[i+1]||args[i+1].startsWith('--'))fail('Missing provenance value');opts[key]=args[++i];}}
  const historical=validateMeasurement(json(fileURLToPath(MEASUREMENT_DEFAULT)));
  if(opts['--derive-provenance']){assert.equal(Object.keys(opts).length,2);assert.ok(opts['--provenance-evidence']);assert.ok(PROVENANCE_PIN,'No accepted provenance evidence');process.stdout.write(JSON.stringify(deriveProvenance(opts['--provenance-evidence'],historical),null,2)+'\n');return;}
  assert.equal(opts['--provenance'],true,'Provenance mode must be explicit');
  const assumptions=validateAssumptions(json(fileURLToPath(new URL('../docs/aggregator-backend/data-backend-cp28-assumptions.json',import.meta.url))));
  const input=validateCapacityInputs(json(opts['--capacity-inputs']??fileURLToPath(CAPACITY_DEFAULT)),assumptions);
  if(!PROVENANCE_PIN){assert.equal(opts['--self-test'],true,'No accepted provenance evidence');assert.equal(Object.keys(opts).length,2,'Pre-evidence self-tests accept no evidence or assumptions override');
    process.stdout.write(JSON.stringify({qualification:'UNQUALIFIED',acceptedLocalExperiment:null,testDataOnly:true,provenanceUnitTestsPassed:provenanceUnitTests(historical,input)+provenanceAllocationTests(provenanceUnitAllocation(historical),historical,input),failed:0,acceptedOriginalBytesVerified:false,sqlOrNetworkExecuted:false},null,2)+'\n');return;}
  const m=validateProvenance(json(opts['--provenance-measurement']??fileURLToPath(PROVENANCE_DEFAULT),8*1024**2),historical);
  if(opts['--provenance-evidence'])assert.deepEqual(deriveProvenance(opts['--provenance-evidence'],historical),m,'Provenance original extraction parity mismatch');
  const result=opts['--self-test']?provenanceSelfTest(m,input,historical,opts['--provenance-evidence']):provenanceForecast(m,input,historical,Boolean(opts['--provenance-evidence']));
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}

function main() {
  if(process.argv.slice(2).some(arg=>arg.startsWith("--provenance")||arg==="--derive-provenance"))return provenanceMain(process.argv.slice(2));
  if (process.argv.slice(2).some(arg => arg.startsWith("--combined") || arg === "--derive-combined" || arg === "--capacity-inputs")) return combinedMain(process.argv.slice(2));
  const opts = {}, args = process.argv.slice(2);
  const flags = ["--self-test", "--measured", "--derive-measurement"];
  const allowed = ["--seed", "--assumptions", "--evidence", "--measurement", "--measurement-evidence", ...flags];
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed.includes(key) || Object.hasOwn(opts, key)) fail("Unknown/duplicate argument");
    if (flags.includes(key)) opts[key] = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith("--")) fail("Missing argument value");
      opts[key] = args[++i];
    }
  }
  if (opts["--derive-measurement"]) {
    if (!opts["--measurement-evidence"] || Object.keys(opts).length !== 2) fail("Derivation requires only the original measurement evidence");
    process.stdout.write(JSON.stringify(measurementFromFile(opts["--measurement-evidence"]), null, 2) + "\n");
    return;
  }
  const measured = Boolean(opts["--measured"] || opts["--measurement"] || opts["--measurement-evidence"]);
  if ((opts["--self-test"] || measured) && opts["--evidence"]) fail("Historical evidence verification is a separate mode");
  const seed = validateSeed(json(opts["--seed"] ?? fileURLToPath(new URL("../docs/aggregator-backend/data-backend-cp28-seed.json", import.meta.url))));
  const a = validateAssumptions(json(opts["--assumptions"] ?? fileURLToPath(new URL("../docs/aggregator-backend/data-backend-cp28-assumptions.json", import.meta.url))));
  let result;
  if (measured) {
    const m = validateMeasurement(json(opts["--measurement"] ?? fileURLToPath(MEASUREMENT_DEFAULT)));
    if (opts["--measurement-evidence"]) assert.deepEqual(measurementFromFile(opts["--measurement-evidence"]), m, "Original extraction parity mismatch");
    result = opts["--self-test"] ? { qualification: "UNQUALIFIED", historical: selfTest(seed, a), measured: measurementSelfTest(m, a, opts["--measurement-evidence"] ? readFileSync(opts["--measurement-evidence"]) : null) } : measuredReport(m, a, Boolean(opts["--measurement-evidence"]));
  } else {
    if (opts["--evidence"]) validateEvidence(opts["--evidence"], seed);
    result = opts["--self-test"] ? selfTest(seed, a) : report(seed, a, Boolean(opts["--evidence"]));
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
try { main(); } catch {
  // Do not echo raw local evidence, file contents, arbitrary paths or parser exception text.
  process.stderr.write("CP28 offline analysis rejected invalid input; no qualification or output produced.\n");
  process.exitCode = 1;
}
