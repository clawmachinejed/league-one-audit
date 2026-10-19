#!/usr/bin/env node
// Offline sensitivity arithmetic only: local JSON reads and stdout; no SQL, network, child processes, or writes.
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
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

function main() {
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
