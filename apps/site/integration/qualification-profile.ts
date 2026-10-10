import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

export const QUALIFICATION_CONTEXT_ENV = 'PROJECTION_INTEGRATION_QUALIFICATION_CONTEXT';
const ARTIFACT_ENV = 'PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY';
export const QUALIFICATION_FILES = { report: 'qualification-report.json', cleanup: 'qualification-cleanup.json',
  failure: 'qualification-failure.json' } as const;
export const QUALIFICATION_MAX_BYTES = 4 * 1024 * 1024;
export const SELECTED_PROFILE = 'data-core-refresh-v1';
export const INGESTION_PROFILE = 'data-core-ingestion-v1';
export const CORE_COMPATIBILITY_PROFILE = 'data-core-compatibility-v1';
export const TEAM_MANAGER_FACTS_PROFILE = 'data-team-manager-facts-v1';
export const TEAM_MANAGER_FACTS_MODULE = 'integration/team-manager-facts.integration-case.ts';
// New nine-case CP7 fixture; execution requires independent exact-source review and a separate allowance.
export const TEAM_MANAGER_FACTS_SOURCE_DIGEST = '22955191422cb8601647cd31254c9e8aa3b9d555c2d8080bc59f986509127e23';
export const TEAM_MANAGER_FACTS_SUITE = 'current season manager and commissioner facts through restricted PostgreSQL';
export const TEAM_MANAGER_FACTS_TESTS = [
  'stores commissioner presence independently from owners coowners and vacancies',
  'preserves identities corrections immutable history unchanged captures and exact replay',
  'retains valid coowners beside unknown primary ownership without inventing directory roles',
  'orders manager reservations and source revisions without regressing immutable evidence',
  'preserves manager facts through independent partial malformed and unavailable directory evidence',
  'rejects forged directory facts source mappings and worker fences atomically',
  'rolls back relationship and directory publications after observed locks outlive worker deadlines',
  'denies direct history mutations and private helpers through actual restricted privileges',
  'composes ordinary intake directory failure recovery and changed ownership refresh with stored readers',
] as const;
export const TEAM_MANAGER_FACTS_FULL_NAMES = TEAM_MANAGER_FACTS_TESTS.map(name => TEAM_MANAGER_FACTS_SUITE + ' > ' + name);
export const TEAM_MANAGER_FACTS_PATTERN = closedPattern(TEAM_MANAGER_FACTS_FULL_NAMES);
export const ROSTER_PLAYER_LINKS_PROFILE = 'data-roster-player-links-v1';
export const ROSTER_PLAYER_LINKS_MODULE = 'integration/roster-player-links.integration-case.ts';
// Independently reviewed nine-case fixture; changed bytes require renewed review and an explicit re-pin.
export const ROSTER_PLAYER_LINKS_SOURCE_DIGEST = '652a0be4ac216af1a8fd17b03f19a05e8be09f0529a4afe6b7c37ad153d640d0';
export const ROSTER_PLAYER_LINKS_SUITE = 'immutable roster player links through restricted PostgreSQL';
export const ROSTER_PLAYER_LINKS_TESTS = [
  'preserves official membership without directory evidence or a qualified identity owner',
  'shares existing canonical identities across leagues without filtering native player kinds or inventing aliases',
  'freezes corrections transfers categories unchanged captures and exact replay while partial data preserves history',
  'retains explicit unresolved mapping kind vacancy and oversized native identifier evidence without name inference',
  'pins accepted head ordering through failed attempts and source mapping changes without reinterpreting history',
  'reuses the winning canonical identity after a real concurrent first writer commits',
  'rolls back canonical writes links and acceptance when an observed identity lock outlives deadline or lease',
  'keeps capacity outcomes explicit and denies history mutation while preserving runtime identity permissions',
  'stores and reads linked membership through ordinary public intake and one real refresh cycle',
] as const;
export const ROSTER_PLAYER_LINKS_FULL_NAMES = ROSTER_PLAYER_LINKS_TESTS.map(name => ROSTER_PLAYER_LINKS_SUITE + ' > ' + name);
export const ROSTER_PLAYER_LINKS_PATTERN = closedPattern(ROSTER_PLAYER_LINKS_FULL_NAMES);
export const PLAYER_DIRECTORY_PROFILE = 'data-player-directory-v1';
export const PLAYER_DIRECTORY_MODULE = 'integration/player-directory.integration-case.ts';
// Reviewed six-case fixture source; any body change requires a new independent review and pin.
export const PLAYER_DIRECTORY_SOURCE_DIGEST = 'c35a72eab57663a635a4e053f2a3ff2a17dcb7c4d44d610ed7af76c51322eaa9';
export const PLAYER_DIRECTORY_SUITE = 'shared Sleeper player directory through restricted PostgreSQL';
export const PLAYER_DIRECTORY_TESTS = [
  'stores full native rows and bounded stored-only pages through the shared owner',
  'shares unchanged content without restamping replay and retains corrections and removals',
  'preserves last good data through partial invalid conflicting empty and unavailable captures',
  'serializes reservations and rejects raw typed hash and nonce conflicts',
  'denies direct history mutation and private helpers and restores late optional grants',
  'preserves shared admission and daily limits through failed capture and an observed lock expiry',
] as const;
export const PLAYER_DIRECTORY_FULL_NAMES = PLAYER_DIRECTORY_TESTS.map(name => PLAYER_DIRECTORY_SUITE + ' > ' + name);
export const PLAYER_DIRECTORY_PATTERN = closedPattern(PLAYER_DIRECTORY_FULL_NAMES);
export const LIVE_PLAYER_DIRECTORY_PROFILE = 'data-live-player-directory-v1';
export const LIVE_PLAYER_DIRECTORY_MODULE = 'integration/player-directory.live-integration-case.ts';
// Independently reviewed one-case live fixture; changed bytes require renewed review and pin.
export const LIVE_PLAYER_DIRECTORY_SOURCE_DIGEST = '4db8a8e3be986589d2a8e65c8662b20485347db48be83108b259500f5e574e9c';
export const LIVE_PLAYER_DIRECTORY_SUITE = 'live Sleeper full player directory within the existing work deadline';
export const LIVE_PLAYER_DIRECTORY_TEST = 'fetches stores and reads every native row under one real twenty-second owner budget';
export const LIVE_PLAYER_DIRECTORY_FULL_NAME = LIVE_PLAYER_DIRECTORY_SUITE + ' > ' + LIVE_PLAYER_DIRECTORY_TEST;
export const LIVE_PLAYER_DIRECTORY_PATTERN = closedPattern([LIVE_PLAYER_DIRECTORY_FULL_NAME]);
export const LIVE_PROFILE = 'data-live-league-two-v1';
export const LIVE_MODULE = 'integration/league-two.live-integration-case.ts';
export const LIVE_SOURCE_DIGEST = 'bcb3bee63bf12658da7d099fd34397fada96757a5799e05a586456761b173f74';
export const LIVE_SUITE = 'live League Two registered core through existing capture and typed readers';
export const LIVE_TEST = 'retains four bounded public captures and exact official core readback [live slow SQL]';
export const LIVE_FULL_NAME = LIVE_SUITE + ' > ' + LIVE_TEST;
export const LIVE_PATTERN = '^' + (LIVE_SUITE + ' ' + LIVE_TEST).replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&') + '$';
export const JOURNEY_PROFILE = 'data-live-public-intake-v1';
export const JOURNEY_MODULE = 'integration/public-data.live-integration-case.ts';
export const JOURNEY_SOURCE_DIGEST = 'f8f2be393a4ea0d5660feac0c720ac2fffc4817c30ebf9a231f249d7b096615f';
export const JOURNEY_SUITE = 'live public DATA intake and refresh through the existing owner';
export const JOURNEY_TEST = 'retains ClawMachineJedi discovery, all associated leagues and one complete refresh [live slow SQL]';
export const JOURNEY_FULL_NAME = JOURNEY_SUITE + ' > ' + JOURNEY_TEST;
export const JOURNEY_PATTERN = '^' + (JOURNEY_SUITE + ' ' + JOURNEY_TEST).replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&') + '$';
export type QualificationProfile = 'full' | typeof SELECTED_PROFILE | typeof INGESTION_PROFILE | typeof LIVE_PROFILE | typeof JOURNEY_PROFILE | typeof OFFICIAL_PROFILE | typeof GUARDS_PROFILE | typeof CONCURRENCY_PROFILE | typeof LATE_WRITE_PROFILE
  | typeof TEAM_MANAGER_FACTS_PROFILE | typeof ROSTER_PLAYER_LINKS_PROFILE | typeof LIVE_PLAYER_DIRECTORY_PROFILE | typeof PLAYER_DIRECTORY_PROFILE | typeof CORE_COMPATIBILITY_PROFILE | typeof INTAKE_RECOVERY_PROFILE | typeof REFRESH_HISTORY_PROFILE | typeof PERIOD_RECOVERY_PROFILE | typeof PERIOD_EXHAUSTION_PROFILE;
export const SELECTED_SOURCE_DIGEST = '899c526471fd9f9df3917a357721c52b249d44c7aed5660fb658dda39d675abf';
export const SELECTED_MODULE = 'integration/public-data-intake.integration-case.ts';
export const SELECTED_SUITE = 'bounded public DATA refresh cycles through the existing intake owner';
export const SELECTED_TEST = 'refreshes two typed core cycles with real admission spacing, a correction and lost-checkpoint replay [focused slow SQL]';
export const SELECTED_FULL_NAME = SELECTED_SUITE + ' > ' + SELECTED_TEST;
export const SELECTED_PATTERN = '^' + (SELECTED_SUITE + ' ' + SELECTED_TEST).replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&') + '$';

export const INGESTION_SUITE = 'ordinary public DATA ingestion through the existing intake owner';
export const INGESTION_TEST = 'stores one public manager league through canonical bootstrap and typed backend readers [focused slow SQL]';
export const INGESTION_FULL_NAME = INGESTION_SUITE + ' > ' + INGESTION_TEST;
export const INGESTION_PATTERN = '^' + (INGESTION_SUITE + ' ' + INGESTION_TEST).replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&') + '$';
export const OFFICIAL_PROFILE = 'data-official-preconfiguration-v1';
export const OFFICIAL_SUITE = 'official preconfiguration source normalization to restricted typed storage';
export const OFFICIAL_TESTS = [
  'recovers the same NULL-profile identity after canonical registration commits before the bootstrap checkpoint [focused slow SQL]',
  'retains all nine missing/null/empty scoring and slot combinations, rejects malformed fields and versions later rules',
] as const;
export const OFFICIAL_FULL_NAMES = OFFICIAL_TESTS.map(name => OFFICIAL_SUITE + ' > ' + name);
export const OFFICIAL_PATTERN = new RegExp('^(?:' + OFFICIAL_TESTS.map(name => (OFFICIAL_SUITE + ' ' + name)
  .replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&')).join('|') + ')$').source;
export const GUARDS_PROFILE = 'data-ingestion-guards-v1';
// Source order matters: the job-row work-deadline case observes the cycle retained by the first case.
const GUARDS_CASES = [
  [SELECTED_SUITE, 'retains one cycle through concurrent selectors, unknown acknowledgements, poisoned selection and sequential approval checks'],
  [SELECTED_SUITE, 'rejects private helpers and direct cursor/history writes, and rolls back selection after an actual job-lock expiry'],
  ['explicit public native-period intake through retained typed receipts', 'enforces SQL selector validation and identical omitted/empty replay before mutation'],
] as const;
export const GUARDS_FULL_NAMES = GUARDS_CASES.map(path => path.join(' > '));
export const GUARDS_PATTERN = new RegExp('^(?:' + GUARDS_CASES.map(path => path.join(' ')
  .replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&')).join('|') + ')$').source;
export const CONCURRENCY_PROFILE = 'data-refresh-concurrency-v1';
// The first case retains cycle history without admitting its identity step; later cases must preserve it.
export const CONCURRENCY_TESTS = [
  'retains one cycle through concurrent selectors, unknown acknowledgements, poisoned selection and sequential approval checks',
  'serializes competing configuration CAS calls behind one observed lock and retains only the winning revision',
  'observes a pause commit win against an admission already waiting on the target row',
  'rejects approval that expires during an observed target-row admission wait under the original live fence',
  'retains a real admitted capture when a competing pause waits for that admission to commit',
] as const;
export const CONCURRENCY_FULL_NAMES = CONCURRENCY_TESTS.map(name => SELECTED_SUITE + ' > ' + name);
export const CONCURRENCY_PATTERN = new RegExp('^(?:' + CONCURRENCY_TESTS.map(name => (SELECTED_SUITE + ' ' + name)
  .replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&')).join('|') + ')$').source;
export const LATE_WRITE_PROFILE = 'data-late-write-rollback-v1';
export const LATE_WRITE_SUITE = 'public data source to typed PostgreSQL readback and recovery';
export const LATE_WRITE_TESTS = [
  'rejects a restricted bootstrap after an advisory wait expires without leaving identity or reservation',
  'rolls back configured canonical registration and its reservation when an identity-row wait outlives the postcondition fence',
  'rolls back official-only canonical registration and its reservation when an identity-row wait outlives the postcondition fence',
] as const;
export const LATE_WRITE_FULL_NAMES = LATE_WRITE_TESTS.map(name => LATE_WRITE_SUITE + ' > ' + name);
export const LATE_WRITE_PATTERN = new RegExp('^(?:' + LATE_WRITE_TESTS.map(name => (LATE_WRITE_SUITE + ' ' + name)
  .replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&')).join('|') + ')$').source;
export const INTAKE_RECOVERY_PROFILE = 'data-intake-recovery-v1';
export const REFRESH_HISTORY_PROFILE = 'data-refresh-history-v1';
export const PERIOD_RECOVERY_PROFILE = 'data-period-recovery-v1';
export const PERIOD_EXHAUSTION_PROFILE = 'data-period-exhaustion-v1';
export const PERIOD_SUITE = 'explicit public native-period intake through retained typed receipts';
// The configured registration case supplies fairness's genuine second identity.
// The selector case retains the selection-failure history used by later assertions.
export const INTAKE_RECOVERY_FULL_NAMES = [
  LATE_WRITE_SUITE + ' > binds typed receipts, preserves core through interruption, recovers once and permits explicit existing-consumer adoption',
  LATE_WRITE_SUITE + ' > admits generation one after normal completed-job retention while preserving older dispatch history',
  LATE_WRITE_FULL_NAMES[1],
  CONCURRENCY_FULL_NAMES[0],
  SELECTED_SUITE + ' > defers a failed selection without giving it admission credit or monopolizing another verified target',
  PERIOD_SUITE + ' > enforces twenty task ordinals, candidate lineage and immutable scope with rolled-back owner-only negative prerequisites',
];
// Keep both typed cycles before empty cycles and immutable-history/limit checks.
// Metadata consumes the already-settled terminal cycle retained by pending capacity.
export const REFRESH_HISTORY_FULL_NAMES = [
  CONCURRENCY_FULL_NAMES[0], SELECTED_FULL_NAME,
  ...[
    'retains two empty-list cycles without relabeling previous typed data or replaying missed cadence slots [focused slow SQL]',
    'refuses owner UPDATE and DELETE of existing immutable refresh history and preserves later-cycle rows',
    'shares the existing sixteen-pending-request limit with manual submissions without spending admission credit',
    'copies explicit periods into a new ordinary cycle and preserves original scope across replay and configuration CAS [R038 metadata only]',
    'counts paused synthetic metadata targets toward the total16 bound using a genuine restricted configure call',
  ].map(name => SELECTED_SUITE + ' > ' + name),
];
export const PERIOD_RECOVERY_FULL_NAMES = [PERIOD_SUITE + ' > binds both reservations, rejects stale/fenced receipts, recovers an observed lock expiry and lost acknowledgments, and preserves periods through core failure [focused slow SQL]'];
export const PERIOD_EXHAUSTION_FULL_NAMES = [PERIOD_SUITE + ' > exhausts five real exact-period retries without closing core or fabricating a period checkpoint [focused slow SQL]'];
function closedPattern(names: readonly string[]): string {
  return new RegExp('^(?:' + names.map(name => name.replaceAll(' > ', ' ')
    .replace(/[.*+?^{}$()|[\]\\]/gu, '\\$&')).join('|') + ')$').source;
}
export const CLOSEOUT_PROFILES = [
  { profile: INTAKE_RECOVERY_PROFILE, names: INTAKE_RECOVERY_FULL_NAMES, pattern: closedPattern(INTAKE_RECOVERY_FULL_NAMES),
    suites: [LATE_WRITE_SUITE, SELECTED_SUITE, PERIOD_SUITE] },
  { profile: REFRESH_HISTORY_PROFILE, names: REFRESH_HISTORY_FULL_NAMES, pattern: closedPattern(REFRESH_HISTORY_FULL_NAMES),
    suites: [SELECTED_SUITE] },
  { profile: PERIOD_RECOVERY_PROFILE, names: PERIOD_RECOVERY_FULL_NAMES, pattern: closedPattern(PERIOD_RECOVERY_FULL_NAMES),
    suites: [PERIOD_SUITE] },
  { profile: PERIOD_EXHAUSTION_PROFILE, names: PERIOD_EXHAUSTION_FULL_NAMES, pattern: closedPattern(PERIOD_EXHAUSTION_FULL_NAMES),
    suites: [PERIOD_SUITE] },
] as const;
function selectedCase(profile: QualificationProfile) {
  if (profile === TEAM_MANAGER_FACTS_PROFILE) return { names: TEAM_MANAGER_FACTS_FULL_NAMES, pattern: TEAM_MANAGER_FACTS_PATTERN };
  if (profile === ROSTER_PLAYER_LINKS_PROFILE) return { names: ROSTER_PLAYER_LINKS_FULL_NAMES, pattern: ROSTER_PLAYER_LINKS_PATTERN };
  if (profile === LIVE_PLAYER_DIRECTORY_PROFILE) return { names: [LIVE_PLAYER_DIRECTORY_FULL_NAME], pattern: LIVE_PLAYER_DIRECTORY_PATTERN };
  if (profile === PLAYER_DIRECTORY_PROFILE) return { names: PLAYER_DIRECTORY_FULL_NAMES, pattern: PLAYER_DIRECTORY_PATTERN };
  if (profile === CORE_COMPATIBILITY_PROFILE) return { names: CORE_COMPATIBILITY_FULL_NAMES, pattern: CORE_COMPATIBILITY_PATTERN };
  const closeout = CLOSEOUT_PROFILES.find(selection => selection.profile === profile);
  if (closeout) return closeout;
  if (profile === LATE_WRITE_PROFILE) return { names: LATE_WRITE_FULL_NAMES, pattern: LATE_WRITE_PATTERN };
  if (profile === CONCURRENCY_PROFILE) return { names: CONCURRENCY_FULL_NAMES, pattern: CONCURRENCY_PATTERN };
  if (profile === LIVE_PROFILE) return { names: [LIVE_FULL_NAME], pattern: LIVE_PATTERN };
  if (profile === JOURNEY_PROFILE) return { names: [JOURNEY_FULL_NAME], pattern: JOURNEY_PATTERN };
  if (profile === GUARDS_PROFILE) return { names: GUARDS_FULL_NAMES, pattern: GUARDS_PATTERN };
  if (profile === OFFICIAL_PROFILE) return { names: OFFICIAL_FULL_NAMES, pattern: OFFICIAL_PATTERN };
  assert(profile === SELECTED_PROFILE || profile === INGESTION_PROFILE, 'Unknown closed qualification profile.');
  return profile === SELECTED_PROFILE ? { names: [SELECTED_FULL_NAME], pattern: SELECTED_PATTERN }
    : { names: [INGESTION_FULL_NAME], pattern: INGESTION_PATTERN };
}

// Closed collected-case inventory, including the two-value it.each expansion.
// Source changes require renewed review of both the inventory and source digest.
export const SELECTED_INVENTORY = [
  INGESTION_FULL_NAME,
  ...[
    'binds typed receipts, preserves core through interruption, recovers once and permits explicit existing-consumer adoption',
    'admits generation one after normal completed-job retention while preserving older dispatch history',
    'rejects a restricted bootstrap after an advisory wait expires without leaving identity or reservation',
    'rolls back configured canonical registration and its reservation when an identity-row wait outlives the postcondition fence',
    'rolls back official-only canonical registration and its reservation when an identity-row wait outlives the postcondition fence',
  ].map(name => 'public data source to typed PostgreSQL readback and recovery > ' + name),
  ...[
    'retains one cycle through concurrent selectors, unknown acknowledgements, poisoned selection and sequential approval checks',
    'defers a failed selection without giving it admission credit or monopolizing another verified target',
    'rejects private helpers and direct cursor/history writes, and rolls back selection after an actual job-lock expiry',
    'serializes competing configuration CAS calls behind one observed lock and retains only the winning revision',
    'observes a pause commit win against an admission already waiting on the target row',
    'rejects approval that expires during an observed target-row admission wait under the original live fence',
    'retains a real admitted capture when a competing pause waits for that admission to commit',
    SELECTED_TEST,
    'retains two empty-list cycles without relabeling previous typed data or replaying missed cadence slots [focused slow SQL]',
    'refuses owner UPDATE and DELETE of existing immutable refresh history and preserves later-cycle rows',
    'shares the existing sixteen-pending-request limit with manual submissions without spending admission credit',
    'copies explicit periods into a new ordinary cycle and preserves original scope across replay and configuration CAS [R038 metadata only]',
    'counts paused synthetic metadata targets toward the total16 bound using a genuine restricted configure call',
  ].map(name => SELECTED_SUITE + ' > ' + name),
  ...OFFICIAL_FULL_NAMES,
  ...[
    'enforces SQL selector validation and identical omitted/empty replay before mutation',
    'enforces twenty task ordinals, candidate lineage and immutable scope with rolled-back owner-only negative prerequisites',
    'binds both reservations, rejects stale/fenced receipts, recovers an observed lock expiry and lost acknowledgments, and preserves periods through core failure [focused slow SQL]',
    'exhausts five real exact-period retries without closing core or fabricating a period checkpoint [focused slow SQL]',
  ].map(name => 'explicit public native-period intake through retained typed receipts > ' + name),
].sort();

// This one fixed profile reuses the existing three modules and their shared harness.
// Inventories include filtered cases; source order and each selected hook are part of the contract.
export const CORE_COMPATIBILITY_MODULES = [
  { path: "integration/all-player-pregame-empty.integration-case.ts", sourceDigest: "18d3a5c9d9604042069fef3e5d77c1d73ad8278bda2a487bac98a2e9671efb34",
    suite: "018 verified empty pregame outcome under the real SQL ownership guard", beforeEach: true,
    names: [
    "018 verified empty pregame outcome under the real SQL ownership guard > reports the initial genuine restricted LOGIN all-DATA/NULL zero-eligible pregame refusal",
    "018 verified empty pregame outcome under the real SQL ownership guard > completes mixed configured plus DATA/NULL pregame without changing consumed request accounting or stored data",
  ],
    inventory: [
    "018 verified empty pregame outcome under the real SQL ownership guard > reports the initial genuine restricted LOGIN all-DATA/NULL zero-eligible pregame refusal",
    "018 verified empty pregame outcome under the real SQL ownership guard > completes mixed configured plus DATA/NULL pregame without changing consumed request accounting or stored data",
    "018 verified empty pregame outcome under the real SQL ownership guard > keeps ordinary-missing-authority intended and refuses legacy pregame completion without data or accounting changes",
    "018 verified empty pregame outcome under the real SQL ownership guard > keeps invalid-marker intended and refuses legacy pregame completion without data or accounting changes",
    "018 verified empty pregame outcome under the real SQL ownership guard > keeps missing-source intended and refuses legacy pregame completion without data or accounting changes",
    "018 verified empty pregame outcome under the real SQL ownership guard > keeps wrong-source intended and refuses legacy pregame completion without data or accounting changes",
    "018 verified empty pregame outcome under the real SQL ownership guard > keeps wrong-season-source intended and refuses legacy pregame completion without data or accounting changes",
    "018 verified empty pregame outcome under the real SQL ownership guard > refuses a array response presented as normal pregame emptiness",
    "018 verified empty pregame outcome under the real SQL ownership guard > refuses a null response presented as normal pregame emptiness",
    "018 verified empty pregame outcome under the real SQL ownership guard > refuses a invalid-json response presented as normal pregame emptiness",
    "018 verified empty pregame outcome under the real SQL ownership guard > refuses a unreadable response presented as normal pregame emptiness",
    "018 verified empty pregame outcome under the real SQL ownership guard > requires zero entries, a fresh proof, exact game count and an unmodified response",
    "018 verified empty pregame outcome under the real SQL ownership guard > refuses a game beginning between application proof and SQL completion",
    "018 verified empty pregame outcome under the real SQL ownership guard > rechecks kickoff after SQL proof queries wait inside the function",
    "018 verified empty pregame outcome under the real SQL ownership guard > refuses a period rollover after application proof",
    "018 verified empty pregame outcome under the real SQL ownership guard > rejects deadline at durable completion",
    "018 verified empty pregame outcome under the real SQL ownership guard > rejects lease at durable completion",
    "018 verified empty pregame outcome under the real SQL ownership guard > rejects takeover at durable completion",
    "018 verified empty pregame outcome under the real SQL ownership guard > rejects unbudgeted at durable completion",
    "018 verified empty pregame outcome under the real SQL ownership guard > rejects operator at durable completion",
  ],
  },
  { path: "integration/all-player-statistics.integration-case.ts", sourceDigest: "5d60a8962fc8149c96e6b03c689eea13a4093c5062c9f372e0bc5360e700ab0a",
    suite: "all-player statistics foundation", beforeEach: false,
    names: [
    "all-player statistics foundation > refuses all-DATA/NULL publication atomically under the first genuine restricted LOGIN admission",
    "all-player statistics foundation > shares immutable raw content while separating scores by league scoring profile",
    "all-player statistics foundation > uses complete owner-approved season membership without bootstrap names or later-season leakage",
    "all-player statistics foundation > keeps configured publication ready through a genuine runtime replay after exact DATA/NULL enrollment",
  ],
    inventory: [
    "all-player statistics foundation > refuses all-DATA/NULL publication atomically under the first genuine restricted LOGIN admission",
    "all-player statistics foundation > reads canonical profiles, identities, game context, and runtime database identity",
    "all-player statistics foundation > rejects forged eligibility counts and mismatched NFL game context in the database",
    "all-player statistics foundation > requires provider-validated completeness evidence for an all-player parity observation",
    "all-player statistics foundation > shares immutable raw content while separating scores by league scoring profile",
    "all-player statistics foundation > uses complete owner-approved season membership without bootstrap names or later-season leakage",
    "all-player statistics foundation > keeps configured publication ready through a genuine runtime replay after exact DATA/NULL enrollment",
    "all-player statistics foundation > derives player total points and PPG from current pointers with profile isolation",
    "all-player statistics foundation > combines published totals with only the newest compact partial-week correction",
    "all-player statistics foundation > rejects a currently usable partial mapping that disagrees with its published canonical identity",
    "all-player statistics foundation > counts 'a zero-point partial appearance after…' in cumulative PPG",
    "all-player statistics foundation > counts 'a published zero-point appearance bef…' in cumulative PPG",
    "all-player statistics foundation > retains each partial week across rollover, applies per-week corrections, and detects missing history",
    "all-player statistics foundation > rejects self-consistent official points that omit an authoritative roster",
    "all-player statistics foundation > enforces the scorer-version rule allowlist and preserves referenced parity evidence",
    "all-player statistics foundation > rejects a physically complete score set that omits the other canonical profile",
    "all-player statistics foundation > rejects a valid candidate paired with a correctly labelled empty peer profile",
    "all-player statistics foundation > preserves canonical catalog metadata when a full-slate projection adds aliases",
    "all-player statistics foundation > revalidates immutable parity from score-line identities after an unrelated alias is added",
    "all-player statistics foundation > rolls back orphan content when an observation replay conflicts",
    "all-player statistics foundation > rejects a forged score row whose breakdown belongs to another scoring profile",
    "all-player statistics foundation > rejects a forged subset before the guarded current pointer can advance",
    "all-player statistics foundation > replays idempotently and advances only immutable corrections",
    "all-player statistics foundation > serializes concurrent replay and rolls back an equal-time conflicting correction",
    "all-player statistics foundation > retains a newer partial observation without moving either last-verified pointer",
    "all-player statistics foundation > rejects a cross-revision peer even when both profile sets are publication ready",
    "all-player statistics foundation > enforces append-only history and a function-only runtime pointer",
    "all-player statistics foundation > rejects expired and taken-over owners before raw writes or pointer movement",
    "all-player statistics foundation > rechecks deadline changes after waiting for the initial job lock",
    "all-player statistics foundation > rechecks takeover changes after waiting for the initial job lock",
    "all-player statistics foundation > rolls back a deadline that expires inside the SQL pointer statement",
    "all-player statistics foundation > rejects malformed direct-role claims and completion without ownership tokens",
    "all-player statistics foundation > protects the durable global budget against generic runtime job mutation",
    "all-player statistics foundation > rejects valid raw child append to sealed partial history",
    "all-player statistics foundation > keeps new mapping writes strict after expiry while preserving exact historical replay",
    "all-player statistics foundation > retains fresh parity verifications without copying unchanged score rows",
    "all-player statistics foundation > preserves final capture evidence across a real takeover and failed correction",
    "all-player statistics foundation > enforces one global request budget across failure and different periods",
    "all-player statistics foundation > retains bounded preclaim diagnostics without mutating live ownership or request budgets",
    "all-player statistics foundation > measures real retained partial history without publishing incomplete scores",
    "all-player statistics foundation > keeps the pre-010 application store compatible with the expanded schema",
    "all-player statistics foundation > measures explicitly synthetic complete shared and divergent profiles with retained corrections",
    "all-player statistics foundation > enrolls Dynasty between complete batches, requires all canonical parity and preserves history through compensation",
    "all-player statistics foundation > owner-only readiness refuses all-DATA/NULL copied negative prerequisites without publication",
  ],
  },
  { path: SELECTED_MODULE, sourceDigest: SELECTED_SOURCE_DIGEST, suite: INGESTION_SUITE, beforeEach: false,
    names: [INGESTION_FULL_NAME], inventory: SELECTED_INVENTORY },
] as const;
export const CORE_COMPATIBILITY_FULL_NAMES = CORE_COMPATIBILITY_MODULES.flatMap(module => [...module.names]);
export const CORE_COMPATIBILITY_PATTERN = closedPattern(CORE_COMPATIBILITY_FULL_NAMES);

export type QualificationContext = {
  kind: 'integration-qualification-context-v1'; runId: string; nonce: string; gitSha: string;
  profile: QualificationProfile; profileDigest: string; modules: { path: string; sourceDigest: string }[];
};
export type QualificationCase = {
  id: string; name: string; state: string; mode: string; expectedFailure: boolean; configuredRetries: boolean;
  configuredRepeats: number; errors: number; readyEvents: number; resultEvents: number;
  diagnostic: { retryCount: number; repeatCount: number; flaky: boolean; duration: number; startTime: number } | null;
};
export type QualificationReport = {
  kind: 'integration-qualification-report-v1'; contextDigest: string; starts: number; ends: number;
  reason: string; unhandledErrors: number;
  specifications: { path: string; pattern: string | null; otherFilters: boolean }[];
  collected: string[]; hooks: { key: string; starts: number; ends: number }[];
  modules: { path: string; state: string; errors: number; suites: { id: string; name: string; mode: string; errors: number }[];
    cases: QualificationCase[] }[];
};
export type QualificationBinding = { context: QualificationContext; directory: string };
export function qualificationDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
export function qualificationSourceDigest(source: string): string {
  return createHash('sha256').update(source.replace(/\r\n?/gu, '\n'), 'utf8').digest('hex');
}
function selectedModule(profile: QualificationProfile) {
  return profile === TEAM_MANAGER_FACTS_PROFILE ? TEAM_MANAGER_FACTS_MODULE : profile === ROSTER_PLAYER_LINKS_PROFILE ? ROSTER_PLAYER_LINKS_MODULE : profile === LIVE_PLAYER_DIRECTORY_PROFILE ? LIVE_PLAYER_DIRECTORY_MODULE : profile === PLAYER_DIRECTORY_PROFILE ? PLAYER_DIRECTORY_MODULE : profile === JOURNEY_PROFILE ? JOURNEY_MODULE : profile === LIVE_PROFILE ? LIVE_MODULE : SELECTED_MODULE;
}
function selectedDigest(profile: QualificationProfile) {
  return profile === TEAM_MANAGER_FACTS_PROFILE ? TEAM_MANAGER_FACTS_SOURCE_DIGEST : profile === ROSTER_PLAYER_LINKS_PROFILE ? ROSTER_PLAYER_LINKS_SOURCE_DIGEST : profile === LIVE_PLAYER_DIRECTORY_PROFILE ? LIVE_PLAYER_DIRECTORY_SOURCE_DIGEST : profile === PLAYER_DIRECTORY_PROFILE ? PLAYER_DIRECTORY_SOURCE_DIGEST : profile === JOURNEY_PROFILE ? JOURNEY_SOURCE_DIGEST : profile === LIVE_PROFILE ? LIVE_SOURCE_DIGEST : SELECTED_SOURCE_DIGEST;
}
function selectedModules(profile: QualificationProfile) {
  return profile === CORE_COMPATIBILITY_PROFILE ? CORE_COMPATIBILITY_MODULES
    : [{ path: selectedModule(profile), sourceDigest: selectedDigest(profile) }];
}
function selectedInventory(profile: QualificationProfile, path?: string): readonly string[] {
  if (profile === CORE_COMPATIBILITY_PROFILE) {
    const spec = CORE_COMPATIBILITY_MODULES.find(module => module.path === path);
    assert(spec, 'Unexpected core compatibility module.'); return spec.inventory;
  }
  return profile === TEAM_MANAGER_FACTS_PROFILE ? TEAM_MANAGER_FACTS_FULL_NAMES : profile === ROSTER_PLAYER_LINKS_PROFILE ? ROSTER_PLAYER_LINKS_FULL_NAMES : profile === LIVE_PLAYER_DIRECTORY_PROFILE ? [LIVE_PLAYER_DIRECTORY_FULL_NAME] : profile === PLAYER_DIRECTORY_PROFILE ? PLAYER_DIRECTORY_FULL_NAMES : profile === JOURNEY_PROFILE ? [JOURNEY_FULL_NAME] : profile === LIVE_PROFILE ? [LIVE_FULL_NAME] : SELECTED_INVENTORY;
}
function profileDigest(profile: QualificationProfile) {
  if (profile === CORE_COMPATIBILITY_PROFILE) return qualificationDigest({ version: 1, profile,
    modules: CORE_COMPATIBILITY_MODULES, pattern: CORE_COMPATIBILITY_PATTERN });
  return qualificationDigest({ version: 1, profile, module: profile === 'full' ? null : selectedModule(profile),
    pattern: profile === 'full' ? null : selectedCase(profile).pattern, sourceDigest: profile === 'full' ? null : selectedDigest(profile), inventory: profile === 'full' ? null : selectedInventory(profile) });
}
export function parseQualificationArguments(args: readonly string[]): QualificationProfile {
  if (!args.length) return 'full';
  if (args.length === 1 && args[0] === '--profile=' + TEAM_MANAGER_FACTS_PROFILE) return TEAM_MANAGER_FACTS_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + ROSTER_PLAYER_LINKS_PROFILE) return ROSTER_PLAYER_LINKS_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + LIVE_PLAYER_DIRECTORY_PROFILE) return LIVE_PLAYER_DIRECTORY_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + PLAYER_DIRECTORY_PROFILE) return PLAYER_DIRECTORY_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + CORE_COMPATIBILITY_PROFILE) return CORE_COMPATIBILITY_PROFILE;
  const closeout = CLOSEOUT_PROFILES.find(selection => args.length === 1 && args[0] === '--profile=' + selection.profile);
  if (closeout) return closeout.profile;
  if (args.length === 1 && args[0] === '--profile=' + SELECTED_PROFILE) return SELECTED_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + INGESTION_PROFILE) return INGESTION_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + LIVE_PROFILE) return LIVE_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + JOURNEY_PROFILE) return JOURNEY_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + OFFICIAL_PROFILE) return OFFICIAL_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + GUARDS_PROFILE) return GUARDS_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + CONCURRENCY_PROFILE) return CONCURRENCY_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + LATE_WRITE_PROFILE) return LATE_WRITE_PROFILE;
  throw new Error('Only the closed data-team-manager-facts-v1, data-roster-player-links-v1, data-live-player-directory-v1, data-player-directory-v1, data-core-compatibility-v1, data-intake-recovery-v1, data-refresh-history-v1, data-period-recovery-v1, data-period-exhaustion-v1, data-late-write-rollback-v1, data-refresh-concurrency-v1, data-ingestion-guards-v1, data-official-preconfiguration-v1, data-live-public-intake-v1, data-live-league-two-v1, data-core-refresh-v1 and data-core-ingestion-v1 qualification selectors are accepted.');
}
export function qualificationArguments(profile: QualificationProfile, reporter: string): string[] {
  assert(profile === 'full' || profile === TEAM_MANAGER_FACTS_PROFILE || profile === ROSTER_PLAYER_LINKS_PROFILE || profile === LIVE_PLAYER_DIRECTORY_PROFILE || profile === PLAYER_DIRECTORY_PROFILE || profile === CORE_COMPATIBILITY_PROFILE || profile === SELECTED_PROFILE || profile === INGESTION_PROFILE || profile === LIVE_PROFILE || profile === JOURNEY_PROFILE || profile === OFFICIAL_PROFILE || profile === GUARDS_PROFILE || profile === CONCURRENCY_PROFILE || profile === LATE_WRITE_PROFILE || CLOSEOUT_PROFILES.some(selection => selection.profile === profile), 'Unknown qualification profile.');
  return ['--reporter', 'verbose', '--reporter', reporter,
    ...(profile === 'full' ? [] : [...selectedModules(profile).map(module => module.path), '--testNamePattern', selectedCase(profile).pattern])];
}
function exactKeys(value: object, keys: string[]) {
  assert.deepEqual(Object.keys(value).sort(), keys.sort(), 'Malformed qualification evidence keys.');
}
function validateContext(value: QualificationContext): QualificationContext {
  assert(value && typeof value === 'object', 'Qualification context is required.');
  exactKeys(value, ['kind', 'runId', 'nonce', 'gitSha', 'profile', 'profileDigest', 'modules']);
  assert.equal(value.kind, 'integration-qualification-context-v1');
  for (const id of [value.runId, value.nonce]) assert.match(id, /^[0-9a-f]{8}-[0-9a-f-]{27}$/u);
  assert.match(value.gitSha, /^[0-9a-f]{40}$/u);
  assert(value.profile === 'full' || value.profile === TEAM_MANAGER_FACTS_PROFILE || value.profile === ROSTER_PLAYER_LINKS_PROFILE || value.profile === LIVE_PLAYER_DIRECTORY_PROFILE || value.profile === PLAYER_DIRECTORY_PROFILE || value.profile === CORE_COMPATIBILITY_PROFILE || value.profile === SELECTED_PROFILE || value.profile === INGESTION_PROFILE || value.profile === LIVE_PROFILE || value.profile === JOURNEY_PROFILE || value.profile === OFFICIAL_PROFILE || value.profile === GUARDS_PROFILE || value.profile === CONCURRENCY_PROFILE || value.profile === LATE_WRITE_PROFILE || CLOSEOUT_PROFILES.some(selection => selection.profile === value.profile));
  assert.equal(value.profileDigest, profileDigest(value.profile));
  assert(Array.isArray(value.modules) && value.modules.length > 0 && value.modules.length <= 128);
  for (const entry of value.modules) {
    exactKeys(entry, ['path', 'sourceDigest']);
    assert.match(entry.path, /^integration\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:live-integration-case|integration-case)\.ts$/u);
    assert.match(entry.sourceDigest, /^[0-9a-f]{64}$/u);
  }
  unique(value.modules.map(module => module.path));
  if (value.profile === LIVE_PLAYER_DIRECTORY_PROFILE || value.profile === LIVE_PROFILE || value.profile === JOURNEY_PROFILE) assert.equal(value.modules[0].sourceDigest, selectedDigest(value.profile));
  if (value.profile === 'full') assert(value.modules.every(module => !module.path.endsWith('.live-integration-case.ts')));
  if (value.profile !== 'full') assert.deepEqual(value.modules.map(module => module.path), selectedModules(value.profile).map(module => module.path));
  return value;
}
export async function createQualificationContext(siteRoot: string, gitSha: string, runId: string,
  profile: QualificationProfile = 'full'): Promise<QualificationContext> {
  const modules: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(join(siteRoot, directory), { withFileTypes: true })) {
      const path = directory + '/' + entry.name;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith('.integration-case.ts')) modules.push(path);
    }
  };
  if (profile === 'full') await walk('integration'); else { selectedCase(profile); modules.push(...selectedModules(profile).map(module => module.path)); }
  const context = validateContext({ kind: 'integration-qualification-context-v1', gitSha, runId, nonce: randomUUID(), profile,
    profileDigest: profileDigest(profile), modules: await Promise.all(modules.sort().map(async path => ({
      path, sourceDigest: qualificationSourceDigest(await readFile(join(siteRoot, path), 'utf8')),
    }))) });
  if (profile !== 'full') for (const expected of selectedModules(profile)) {
    assert.equal(context.modules.find(module => module.path === expected.path)?.sourceDigest, expected.sourceDigest,
      'Selected qualification source differs from the reviewed LF digest.');
  }
  return context;
}
/** Missing context preserves standalone use. Supplied but partial context fails before DB preparation. */
export function qualificationBinding(environment: Record<string, string | undefined> = process.env): QualificationBinding | undefined {
  const raw = environment[QUALIFICATION_CONTEXT_ENV];
  if (raw === undefined) return undefined;
  assert(raw.length > 0 && Buffer.byteLength(raw) <= 24_000, 'Malformed qualification context.');
  const directory = environment[ARTIFACT_ENV];
  assert(directory && isAbsolute(directory), 'Qualification artifact directory must be absolute.');
  return { context: validateContext(JSON.parse(raw)), directory };
}
export function qualificationRelativePath(root: string, path: string): string {
  return relative(root, path).replace(/\\/gu, '/');
}
async function readBounded(directory: string, filename: string): Promise<string> {
  const path = join(directory, filename);
  const stat = await lstat(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= QUALIFICATION_MAX_BYTES,
    'Qualification artifact must be a bounded regular file.');
  const data = await readFile(path, 'utf8');
  assert(Buffer.byteLength(data) <= QUALIFICATION_MAX_BYTES);
  return data;
}
export async function writeQualificationArtifact(binding: QualificationBinding,
  kind: keyof typeof QUALIFICATION_FILES, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value) + '\n';
  assert(Buffer.byteLength(serialized) <= QUALIFICATION_MAX_BYTES);
  await writeFile(join(binding.directory, QUALIFICATION_FILES[kind]), serialized, { flag: 'wx', mode: 0o600 });
}
export async function markQualificationFailure(binding: QualificationBinding | undefined,
  reason: 'process-timeout' | 'reporter-failure' | 'cleanup-failure'): Promise<void> {
  // Vitest can ignore close errors. Fail before any I/O, including failed marker writes.
  process.exitCode = 1;
  if (!binding) return;
  try { await writeQualificationArtifact(binding, 'failure', {
    kind: 'integration-qualification-failure-v1', contextDigest: qualificationDigest(binding.context), reason,
  }); } catch { /* An existing failure or unavailable storage remains failed. Never erase a prior marker. */ }
}
export async function qualificationCleanup(cleanup: () => Promise<void>, binding?: QualificationBinding): Promise<void> {
  try {
    await cleanup();
    if (binding) {
      const report = await readBounded(binding.directory, QUALIFICATION_FILES.report);
      const parsed = JSON.parse(report) as QualificationReport;
      assert.equal(parsed.contextDigest, qualificationDigest(binding.context));
      await writeQualificationArtifact(binding, 'cleanup', { kind: 'integration-qualification-cleanup-v1',
        contextDigest: qualificationDigest(binding.context), reportDigest: qualificationSourceDigest(report),
        globalDatabaseCleanup: 'complete' });
    }
  } catch (error) { await markQualificationFailure(binding, 'cleanup-failure'); throw error; }
}
function unique(values: readonly string[]): void { assert.equal(new Set(values).size, values.length, 'Duplicate qualification inventory.'); }
function sameInventory(actual: readonly string[], expected: readonly string[]): void { unique(actual); assert.deepEqual([...actual].sort(), [...expected].sort()); }
function zero(value: unknown): void { assert.equal(value, 0); }
export function validateQualificationReport(context: QualificationContext, report: QualificationReport): void {
  validateContext(context);
  exactKeys(report, ['kind', 'contextDigest', 'starts', 'ends', 'reason', 'unhandledErrors', 'specifications', 'collected', 'hooks', 'modules']);
  assert.equal(report.kind, 'integration-qualification-report-v1');
  assert.equal(report.contextDigest, qualificationDigest(context));
  assert.equal(report.starts, 1); assert.equal(report.ends, 1); assert.equal(report.reason, 'passed'); zero(report.unhandledErrors);
  const paths = context.modules.map(module => module.path);
  sameInventory(report.specifications.map(spec => spec.path), paths);
  sameInventory(report.collected, paths); sameInventory(report.modules.map(module => module.path), paths);
  for (const spec of report.specifications) {
    exactKeys(spec, ['path', 'pattern', 'otherFilters']);
    assert.equal(spec.otherFilters, false);
    assert.equal(spec.pattern, context.profile === 'full' ? null : selectedCase(context.profile).pattern);
  }
  unique(report.hooks.map(hook => hook.key));
  for (const hook of report.hooks) {
    exactKeys(hook, ['key', 'starts', 'ends']);
    assert(Number.isSafeInteger(hook.starts) && hook.starts > 0);
    assert.equal(hook.starts, hook.ends);
  }
  const ids: string[] = [];
  const compatibilityHooks: { key: string; starts: number; ends: number }[] = [];
  for (const entry of report.modules) {
    exactKeys(entry, ['path', 'state', 'errors', 'suites', 'cases']);
    assert.equal(entry.state, 'passed'); zero(entry.errors); assert(entry.cases.length > 0);
    for (const suite of entry.suites) {
      exactKeys(suite, ['id', 'name', 'mode', 'errors']);
      ids.push(suite.id); zero(suite.errors);
      assert(suite.mode === 'run' || (context.profile !== 'full' && suite.mode === 'skip'));
    }
    unique(entry.cases.map(test => test.name));
    if (context.profile !== 'full') sameInventory(entry.cases.map(test => test.name), selectedInventory(context.profile, entry.path));
    if (context.profile === CORE_COMPATIBILITY_PROFILE) {
      const spec = CORE_COMPATIBILITY_MODULES.find(module => module.path === entry.path)!;
      const selected = entry.cases.filter(test => (spec.names as readonly string[]).includes(test.name));
      assert.deepEqual(selected.map(test => test.name), spec.names, 'Core compatibility cases must retain source order.');
      const running = entry.suites.filter(suite => suite.mode === 'run');
      assert.equal(running.length, 1); assert.equal(running[0].name, spec.suite);
      assert.equal(entry.suites.filter(suite => suite.name === spec.suite).length, 1);
      compatibilityHooks.push(...['beforeAll', 'afterAll'].map(name => ({ key: running[0].id + ':' + name, starts: 1, ends: 1 })));
      if (spec.beforeEach) compatibilityHooks.push(...selected.map(test => ({ key: test.id + ':beforeEach', starts: 1, ends: 1 })));
      for (let index = 1; index < selected.length; index++) {
        const previous = selected[index - 1].diagnostic, current = selected[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Core compatibility cases must execute in chronological source order.');
      }
    }
    if (context.profile === LIVE_PLAYER_DIRECTORY_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), [LIVE_PLAYER_DIRECTORY_FULL_NAME]);
      assert.equal(entry.suites.length, 1, 'Live directory requires exactly one suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, LIVE_PLAYER_DIRECTORY_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Live directory hooks must execute exactly once.');
    }
    if (context.profile === TEAM_MANAGER_FACTS_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), TEAM_MANAGER_FACTS_FULL_NAMES,
        'Team manager facts cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Team manager facts requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, TEAM_MANAGER_FACTS_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Team manager facts hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Team manager facts cases must execute in chronological source order.');
      }
    }
    if (context.profile === ROSTER_PLAYER_LINKS_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), ROSTER_PLAYER_LINKS_FULL_NAMES,
        'Roster player links cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Roster player links requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, ROSTER_PLAYER_LINKS_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Roster player links hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Roster player links cases must execute in chronological source order.');
      }
    }
    if (context.profile === PLAYER_DIRECTORY_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), PLAYER_DIRECTORY_FULL_NAMES,
        'Player directory cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Player directory requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, PLAYER_DIRECTORY_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Player directory hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Player directory cases must execute in chronological source order.');
      }
    }
    const sharedSuite = context.profile === CONCURRENCY_PROFILE
      ? { names: CONCURRENCY_FULL_NAMES, suite: SELECTED_SUITE, label: 'Refresh concurrency' }
      : context.profile === LATE_WRITE_PROFILE
        ? { names: LATE_WRITE_FULL_NAMES, suite: LATE_WRITE_SUITE, label: 'Late-write rollback' } : undefined;
    if (sharedSuite) {
      assert.deepEqual(entry.cases.filter(test => sharedSuite.names.includes(test.name)).map(test => test.name),
        sharedSuite.names, sharedSuite.label + ' cases must retain their source order.');
      const suites = entry.suites.filter(suite => suite.name === sharedSuite.suite);
      assert.equal(suites.length, 1, sharedSuite.label + ' requires its one shared suite.');
      assert.equal(suites[0].mode, 'run');
      const expectedHooks = ['beforeAll', 'afterAll'].map(name => suites[0].id + ':' + name);
      sameInventory(report.hooks.map(hook => hook.key), expectedHooks);
      for (const hook of report.hooks) assert.equal(hook.starts, 1, sharedSuite.label + ' hooks must execute exactly once.');
    }
    const closeout = CLOSEOUT_PROFILES.find(selection => selection.profile === context.profile);
    if (closeout) {
      const selected = entry.cases.filter(test => closeout.names.includes(test.name));
      assert.deepEqual(selected.map(test => test.name), closeout.names, 'Closed cases must retain their source order.');
      const runningSuites = entry.suites.filter(suite => suite.mode === 'run');
      sameInventory(runningSuites.map(suite => suite.name), [...closeout.suites]);
      for (const name of closeout.suites) assert.equal(entry.suites.filter(suite => suite.name === name).length, 1,
        'Closed qualification requires each selected suite exactly once.');
      const expectedHooks = runningSuites.flatMap(suite => ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      sameInventory(report.hooks.map(hook => hook.key), expectedHooks);
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Closed qualification hooks must execute exactly once.');
      // allTests() reports declaration order; diagnostic start times independently
      // reject reordered execution without changing the reporter or runner.
      for (let index = 1; index < selected.length; index++) {
        const previous = selected[index - 1].diagnostic, current = selected[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Closed cases must execute in chronological source order.');
      }
    }
    if (context.profile === GUARDS_PROFILE) assert.deepEqual(entry.cases.filter(test => GUARDS_FULL_NAMES.includes(test.name))
      .map(test => test.name), GUARDS_FULL_NAMES, 'Ingestion guards must retain their source order.');
    for (const test of entry.cases) {
      exactKeys(test, ['id', 'name', 'state', 'mode', 'expectedFailure', 'configuredRetries', 'configuredRepeats',
        'errors', 'readyEvents', 'resultEvents', 'diagnostic']);
      ids.push(test.id); assert(typeof test.id === 'string' && test.id.length > 0);
      assert.equal(test.expectedFailure, false); zero(test.errors);
      assert.equal(test.configuredRetries, false); zero(test.configuredRepeats);
      const selected = context.profile === 'full' || selectedCase(context.profile).names.includes(test.name);
      if (selected) {
        assert.equal(test.state, 'passed'); assert.equal(test.mode, 'run');
        assert.equal(test.readyEvents, 1); assert.equal(test.resultEvents, 1);
        assert(test.diagnostic);
        exactKeys(test.diagnostic, ['retryCount', 'repeatCount', 'flaky', 'duration', 'startTime']);
        zero(test.diagnostic.retryCount); zero(test.diagnostic.repeatCount);
        assert.equal(test.diagnostic.flaky, false);
        assert(Number.isFinite(test.diagnostic.duration) && test.diagnostic.duration >= 0);
        assert(Number.isFinite(test.diagnostic.startTime) && test.diagnostic.startTime > 0);
      } else {
        assert.equal(test.state, 'skipped'); assert.equal(test.mode, 'skip');
        // Vitest emits ready/result for filtered cases too; no diagnostic means no execution.
        assert.equal(test.readyEvents, 1); assert.equal(test.resultEvents, 1);
        assert.equal(test.diagnostic, null);
      }
    }
  }
  unique(ids);
  if (context.profile === CORE_COMPATIBILITY_PROFILE) {
    sameInventory(report.hooks.map(hook => hook.key), compatibilityHooks.map(hook => hook.key));
    for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Core compatibility hooks must execute exactly once.');
  }
}
/** Only after independently verified child-tree closure; a late timeout marker always wins. */
export async function validateQualificationArtifacts(binding: QualificationBinding): Promise<{ profile: QualificationProfile; collected: number; executed: number; passed: number; skipped: number; filtered: number; reportDigest: string }> {
  try { await lstat(join(binding.directory, QUALIFICATION_FILES.failure)); throw new Error('Sticky qualification failure.'); }
  catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error; }
  const raw = await readBounded(binding.directory, QUALIFICATION_FILES.report);
  const report = JSON.parse(raw) as QualificationReport;
  validateQualificationReport(binding.context, report);
  const ack = JSON.parse(await readBounded(binding.directory, QUALIFICATION_FILES.cleanup));
  exactKeys(ack, ['kind', 'contextDigest', 'reportDigest', 'globalDatabaseCleanup']);
  assert.deepEqual(ack, { kind: 'integration-qualification-cleanup-v1', contextDigest: qualificationDigest(binding.context),
    reportDigest: qualificationSourceDigest(raw), globalDatabaseCleanup: 'complete' });
  const cases = report.modules.flatMap(module => module.cases);
  return { profile: binding.context.profile, collected: cases.length, executed: cases.filter(test => test.diagnostic !== null).length,
    passed: cases.filter(test => test.state === 'passed').length, skipped: cases.filter(test => test.state === 'skipped').length, filtered: cases.filter(test => test.state === 'skipped').length,
    reportDigest: qualificationSourceDigest(raw) };
}

/** The distinct live suffix never matches default full discovery. Only a validated bound profile opts in. */
export function qualificationIncludes(environment: Record<string, string | undefined> = process.env): string[] {
  const profile = qualificationBinding(environment)?.context.profile;
  return profile === TEAM_MANAGER_FACTS_PROFILE ? [TEAM_MANAGER_FACTS_MODULE] : profile === ROSTER_PLAYER_LINKS_PROFILE ? [ROSTER_PLAYER_LINKS_MODULE] : profile === LIVE_PLAYER_DIRECTORY_PROFILE ? [LIVE_PLAYER_DIRECTORY_MODULE] : profile === PLAYER_DIRECTORY_PROFILE ? [PLAYER_DIRECTORY_MODULE]
    : profile === CORE_COMPATIBILITY_PROFILE ? CORE_COMPATIBILITY_MODULES.map(module => module.path)
    : profile === LIVE_PROFILE ? [LIVE_MODULE] : profile === JOURNEY_PROFILE ? [JOURNEY_MODULE] : ['integration/**/*.integration-case.ts'];
}
export function requireLiveQualification(environment: Record<string, string | undefined> = process.env): QualificationBinding {
  const binding = qualificationBinding(environment);
  assert(binding?.context.profile === LIVE_PROFILE, 'Explicit bound live League Two profile required.');
  return binding;
}
export function requireJourneyQualification(environment: Record<string, string | undefined> = process.env): QualificationBinding {
  const binding = qualificationBinding(environment);
  assert(binding?.context.profile === JOURNEY_PROFILE, 'Explicit bound live public DATA intake profile required.');
  return binding;
}

export function requireLivePlayerDirectoryQualification(environment: Record<string, string | undefined> = process.env): QualificationBinding {
  const binding = qualificationBinding(environment);
  assert(binding?.context.profile === LIVE_PLAYER_DIRECTORY_PROFILE, 'Explicit bound live player directory profile required.');
  return binding;
}
