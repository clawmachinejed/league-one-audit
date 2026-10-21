import assert from 'node:assert/strict';
import { CANONICAL_STANDINGS_PROFILE, CANONICAL_STANDINGS_MODULE, CANONICAL_STANDINGS_SUITE,
  CANONICAL_STANDINGS_FULL_NAMES, CANONICAL_STANDINGS_PATTERN, CANONICAL_STANDINGS_CASE_TIMEOUTS_MS,
  CANONICAL_STANDINGS_BEFORE_ALL_MS, CANONICAL_STANDINGS_AFTER_ALL_MS, CANONICAL_STANDINGS_LIMITS } from './canonical-standings-profile';
import { FLEET_HEALTHY_PROFILE, FLEET_HEALTHY_MODULE, FLEET_HEALTHY_SUITE, FLEET_HEALTHY_FULL_NAMES, FLEET_RECOVERY_PROFILE, FLEET_RECOVERY_MODULE, FLEET_RECOVERY_SUITE, FLEET_RECOVERY_FULL_NAMES, FLEET_DAILY_PROFILE, FLEET_DAILY_MODULE, FLEET_DAILY_SUITE, FLEET_DAILY_FULL_NAMES, FLEET_LIVE_PROFILE, FLEET_LIVE_MODULE, FLEET_LIVE_SUITE, FLEET_LIVE_FULL_NAMES, FLEET_OWNERSHIP_PROFILE, FLEET_OWNERSHIP_MODULE, FLEET_OWNERSHIP_SUITE, FLEET_OWNERSHIP_FULL_NAMES } from './freshness-capacity-profile';

import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

/** New RFQ1 source pins only. Historical definitions remain byte-for-byte unchanged. */
export const CANONICAL_STANDINGS_SOURCE_DIGEST = 'de0b5b88e9061ca3f294e5f3714c2ff21b061fa1a07fe401f8ff15d262b9c510';
export const CANONICAL_STANDINGS_SUPPORT_SOURCES: readonly Readonly<{ path: string; sourceDigest: string }>[] = [
  { path: '../../.github/workflows/integration.yml', sourceDigest: 'dcdeba82c2740b19500c6ebf2ab9c51268bd3c4ae227e918e0446fa7dab7e097' },
  { path: '../../docs/aggregator-backend/data-backend-cp28-measurement-fixture.json', sourceDigest: 'a073787759851045909475f7b47a36f5daf01530604d1556a3afe9cf43ff785f' },
  { path: '../../package.json', sourceDigest: 'dd5b106b46cae3023042fac344dfa71575f2744a2695ddee74c96cd94486be67' },
  { path: '../../pnpm-lock.yaml', sourceDigest: '08057fa1ad28d7a8bb89d2688d31a3f8f793c14f4897ba9db0e46b567155eaa4' },
  { path: 'integration/all-player-schedule-test-clock.ts', sourceDigest: '6bdbbd2c833bff7160975062e172787e2fa733cf1b4354c9df94005a4ac1c5ce' },
  { path: 'integration/backend-controls-fetch.ts', sourceDigest: '81a475ec0128ab68a30de5b8e0b9953c5b154d18614a416014ae1152fbce5568' },
  { path: 'integration/canonical-standings-fixture-policy.sql', sourceDigest: '1afaf7abe57a7c757721aaafff5803a57feb438da9f16e0be778db89e4ed45e0' },
  { path: 'integration/canonical-standings-fixtures.ts', sourceDigest: '20e3de0fd59943edda5aadc57a15bcbe7128264ac2a80dc330a8f6f9c5a5cbda' },
  { path: 'integration/canonical-standings-profile.test.ts', sourceDigest: '833cc3166f54cffaebef662525b92e844c3a6624dc0a145d91356830f67cbf64' },
  { path: 'integration/canonical-standings-profile.ts', sourceDigest: 'b6c68816c9eb610358a38900d9447a80a9426172804e883c5a06877cd4d02960' },
  { path: 'integration/collection-capacity-supervision.ts', sourceDigest: '937b7fcd95aa507da489e6f26343de8c229649cb50b614aec04807d6f3680edf' },
  { path: 'integration/disposable-integration.ts', sourceDigest: '06cae505c4930128f5a7b16bb04d6533c5d712d08b7e2c235caf171c0b640414' },
  { path: 'integration/disposable-neon-api.ts', sourceDigest: '6ef0d211273b0df9f08234c9676b8fe9949df67c127feacce356d86b91a15a1c' },
  { path: 'integration/exact-matchup-clock.ts', sourceDigest: '3f7b327bce2dc72766564f804f85ff2dbb2ed7547fcdf2d4f8c8536c55545b69' },
  { path: 'integration/fresh-install-catalog.json', sourceDigest: 'a2dfba7e7c048fe4246cb653785084658d5fafd8ae0dae0a63b907e7ba706f50' },
  { path: 'integration/fresh-install-catalog.ts', sourceDigest: 'c6e3d9a87686cbe008f05e4b6d66c05259d5a204de4a7da7437a32521b1f128a' },
  { path: 'integration/fresh-install-evidence.ts', sourceDigest: 'eadebaeaa344ca78e409c241f22bceaceb0e17724e5df9dffa097de48516ae51' },
  { path: 'integration/freshness-capacity-fixtures.ts', sourceDigest: '2dadd328d0c03b620ad92b15012b788ed90a2275babe2ad2135e337304bcf574' },
  { path: 'integration/freshness-capacity-manifest.ts', sourceDigest: '5928fdf8cc5a7b86a4ed1a6c23e1679ac3b1235fd3c1faadcf95b64fd726a8e0' },
  { path: 'integration/global-setup.ts', sourceDigest: '27badc87a4cfe48db1d786f572866789832b6467614aeba9252a116e355e6a2b' },
  { path: 'integration/integration-artifacts.ts', sourceDigest: '7faab2f3171aa4ea32ba04b451fbd7a3216d635eaaf305e8df742fae0c86b6dc' },
  { path: 'integration/integration-child-process.ts', sourceDigest: 'c53e2e61042e031df57b0c99ddbc019adbbc29ea78a43ff96ca92b964953ab9a' },
  { path: 'integration/integration-database-ownership.ts', sourceDigest: 'cd7bd531f4dd0a649fb8cf8031ec87c09e1a7f63b1169f752758b6a6b57fbd19' },
  { path: 'integration/integration-lifecycle-budget.ts', sourceDigest: 'eb50d2f1ca091c8d0eaa547cb38338951a6501f9cb6f138d6b5641413f4bedc3' },
  { path: 'integration/integration-owner-loss-diagnostics.ts', sourceDigest: '9d37cd5993e3fd324c1472ba6a81ac93d7e253ba81116a5503fd7c73e41747c9' },
  { path: 'integration/integration-receipt-journal.ts', sourceDigest: '380f6307eab23491a54f0b458a5ff172f3c87be371ef8156e0ddafb528b12eeb' },
  { path: 'integration/neon-integration-harness.ts', sourceDigest: '1ea7875c3cae6785ae94572144391a0bce0206ebb575e11dfa4fb4cec3eb7933' },
  { path: 'integration/qualification-profile.test.ts', sourceDigest: '1dd7dbac0d122c8f152b42cb1c3e87f23db60f98c33571d85795a60f4736c9e7' },
  { path: 'integration/qualification-reporter.ts', sourceDigest: '4b75b832dcd832c7f42f0e9dc71996adcd993265f20bb0ccfd1cc9f134f1837c' },
  { path: 'integration/reader-performance-snapshot.ts', sourceDigest: 'd2bf139bb311db505fc1288b11c47fa4626e1a0d4eefcbedd3963365688e89a4' },
  { path: 'integration/reader-performance.ts', sourceDigest: '7581745db06a6237c572c8a3b65ed765667fdae396d4efdd4dbf79c3481f4c9e' },
  { path: 'integration/server-only-stub.ts', sourceDigest: '877c12ede877fbc78f4a5a3181512be55d006f9179c93fea5722bd4bebb265f2' },
  { path: 'lib/aggregator/bundle-one.ts', sourceDigest: 'ee64cf0d07e99b3dbac050cea54ae9e221188e2dce7ff755701f1a9688503e35' },
  { path: 'lib/aggregator/contracts.ts', sourceDigest: 'cada9a1bd1478cde8f91f3cd10299b06a384a0fcd0f26d9ac0b42eaa7c85912d' },
  { path: 'lib/aggregator/current-roster-groups.ts', sourceDigest: '667f2c6c0f1ab233a98a9fbf1a4e5f3d92924c9363d15849071785d5180bdfd9' },
  { path: 'lib/aggregator/current-roster-metadata.ts', sourceDigest: 'b83920428b01267687e568db4c704d2ddfb30ba129fae56f79591fae39df7805' },
  { path: 'lib/aggregator/current-roster.ts', sourceDigest: 'f9710f3e8c6e8f7ac6192053b9249c3848974a0900b44ed9c798c147ff106173' },
  { path: 'lib/aggregator/draft-metadata.ts', sourceDigest: 'c89dc6d19999326b8b63a3b27a2b2e7ae907200ceb0c1c20681632ddc72b7f56' },
  { path: 'lib/aggregator/draft-selections.ts', sourceDigest: '901fe47f3f6afd330a4ac31d11ffa18851e71a0428ba09c5a57dde82b199ca03' },
  { path: 'lib/aggregator/exact-lineup-applicability.ts', sourceDigest: '92ade1f90723ab7bdfa738eb804a92dd3b6cb6f815440c2643d3bffdb60d826f' },
  { path: 'lib/aggregator/exact-matchup-attention.ts', sourceDigest: '3ae88f54886be8b761cc03826a025c3aca3b3fb30f5ec25ad7ab3542e469bb71' },
  { path: 'lib/aggregator/exact-matchup-box-scores.ts', sourceDigest: 'ca2ea52e40450d9fd50e91041b5cef2a04e34c82d31fbd26501837d59462642c' },
  { path: 'lib/aggregator/exact-matchup-compatibility.ts', sourceDigest: '974a1ee628ddc894962a3b9d5022a8c72cce6237c14fe338912888db1dc9658a' },
  { path: 'lib/aggregator/exact-matchup-reference-scope.ts', sourceDigest: 'd15590a96dd208167fe393c05674485fff288d7b227c507142a49c68ae0296f7' },
  { path: 'lib/aggregator/exact-matchup-values.ts', sourceDigest: '0031f5f372d8faf8891431c724f7139083ad7f02eeb13a65bf2daa51914abc26' },
  { path: 'lib/aggregator/exact-matchups.ts', sourceDigest: '3a74f0c595b9cc6c7e45362468e453bddd7b0c62bd9860efddfa6f1db6f6312a' },
  { path: 'lib/aggregator/exact-period-context.ts', sourceDigest: '427fd0973ae673e856f54a6bb62b23b8bf76c8b30fe8c1bfc1034d1d924b761c' },
  { path: 'lib/aggregator/league-settings.ts', sourceDigest: 'b3ed9faffbeb56ea5787a61e6436180a0ca7454b3a5ea78127db87dcc4b247fa' },
  { path: 'lib/aggregator/official-standings.ts', sourceDigest: '63a4c1055b4a9cfc331d7482b6e7b90ca0a90bdf0f622addea9a215969182b85' },
  { path: 'lib/aggregator/playoff-brackets.ts', sourceDigest: '7fcf0d1c52357a39972849c015ef2f39c2537128acefdee6b6f2ff3db3b49fac' },
  { path: 'lib/aggregator/retained-matchups.ts', sourceDigest: '179554c771ab747ad644a6e0f6bf656a98d257f72db11c022681730eaf506bdf' },
  { path: 'lib/aggregator/roster-bridge.ts', sourceDigest: 'b08daf2a83ce32af65793e0e6244598f26070ea8d0201258f4337004606917d8' },
  { path: 'lib/aggregator/roster-player-links.ts', sourceDigest: 'c89487c6a393c84cbbfe469073c6f75453b76f67f0bf30b7c6fc16af20f2386b' },
  { path: 'lib/aggregator/season-overview-fields.ts', sourceDigest: '12fea8dda5c3d8f7669caa001d8fe6c5094898d5b32e7f37479cf98e86d0446c' },
  { path: 'lib/aggregator/season-overview-source-contracts.ts', sourceDigest: '6d298094086a87fb277669794c724f859f082b403cd6a4b4568838a7f8673575' },
  { path: 'lib/aggregator/season-overview-source.ts', sourceDigest: 'ec3645174563d687ad7d4891734d169ed304f19d51959302d877664fdcff4fbd' },
  { path: 'lib/aggregator/team-managers.ts', sourceDigest: '0b60dd2eca04d4e67d7bbaa41e1f0fff25a38c54d2db1ed474580cab645bcb6c' },
  { path: 'lib/aggregator/traded-picks.ts', sourceDigest: 'a0deaffdee1b31fc0584036edff006657fa460ca6d7fa9da81c0c29eb925cc9e' },
  { path: 'lib/aggregator/transaction-activity-contracts.ts', sourceDigest: 'c497c9bac7b78427b7fbb3675b0d343d3ff21328e3528ff07119038689516553' },
  { path: 'lib/aggregator/transaction-activity.ts', sourceDigest: '0810faa2f7c2ff8971461f7ab4978fbd733775b57677903582a44a6e5e53a517' },
  { path: 'lib/aggregator/validation.ts', sourceDigest: '7e082982367019bad5d1c30c8c56ee42c86d5d366cb12765df19edb7a53f71ad' },
  { path: 'lib/aggregator/weekly-report-normalization.ts', sourceDigest: 'c85ae87206f5f46f645839a6381236ea77135e88511858d8d444ba5a60e95e33' },
  { path: 'lib/aggregator/weekly-reports.ts', sourceDigest: 'b326c78c3b03d2ed21741f3561a00d3a5fccdc007ef9a3f6fd505670b0638b53' },
  { path: 'lib/config.ts', sourceDigest: 'a7c752e66a6889a42865b017fb43ab59731354c341cd3f01d4e077551c90765d' },
  { path: 'lib/current-standings.ts', sourceDigest: '127e4e27f571146a11a25866ab55a93a52cc93242ff6fa4a0e04b206737e11b8' },
  { path: 'lib/database.ts', sourceDigest: 'b20ced4e820d9d81477bd22b0925d608c94548917749b54e37be84515f527562' },
  { path: 'lib/injury-status.ts', sourceDigest: 'cbf124396a2c9e40f6a3c7b302f8dcdd909162c28f04db032a59f2ef8fb9de45' },
  { path: 'lib/league-administration/applicability.ts', sourceDigest: '83cd92fe91aa88b6488d002fe53be3256ff52ada8588f254da7ea938e68fdb2a' },
  { path: 'lib/league-administration/calculation-capture.ts', sourceDigest: '3cbda8f47e297c77dada3b3c05842d9918db27c2bd1e8f415a4a4d3bf58bf61a' },
  { path: 'lib/league-administration/administration-write-result.ts', sourceDigest: '76bad6beb8093de7129667c917e4862ecb9de9d29372a88e5b2e77ebfeb2120e' },
  { path: 'lib/league-administration/canonical-source-contracts.ts', sourceDigest: '24e35906a8c39bcc416d0505efd8b45045fd7981b3eb9310c8c96f76ba2d1979' },
  { path: 'lib/league-administration/canonical-standings-contracts.ts', sourceDigest: '13d9f09bf95dbe71a415c5cdd8f4b2bb8662cf83172bcdfde8e7da187cabfb75' },
  { path: 'lib/league-administration/canonical-standings-policy.ts', sourceDigest: 'c19bcfd629c61feaa21178e2816ac836f497bd4b5016efb20315be8f11fbddbd' },
  { path: 'lib/league-administration/contracts.ts', sourceDigest: '89e78482db92555ae01fa5e26819acc2f56f858f88e9b54dbd3960f1fd06a97c' },
  { path: 'lib/league-administration/legacy-administration-input.ts', sourceDigest: '53596025027cd968a1f48db33c7a44af4e1507bff2239406f7ab72af1775834b' },
  { path: 'lib/league-administration/neon/account-enrollment.ts', sourceDigest: '26e3c976d72c65da3b1cdf9265488f8f98247fce962bc6f8ed7440b1f62aa610' },
  { path: 'lib/league-administration/neon/administration.ts', sourceDigest: 'ee017763e47a7801e71aea7d012ccea517881c7274eedb821bd23fc660fc7a38' },
  { path: 'lib/league-administration/neon/brackets.ts', sourceDigest: '0d9ef6baf89f15437692f4df82db9f0ee5f83ea44f6aaae2c00a84d24d7c9aa5' },
  { path: 'lib/league-administration/neon/canonical-identities.ts', sourceDigest: 'ab177379c4edc2af8326891712212a9356a92f110903fe7a078b1b40040c397c' },
  { path: 'lib/league-administration/neon/canonical-official-standings.ts', sourceDigest: '4f7e9574ffd394c3abbbbda18810873e1291e8ad15fa20de6199050ce5aa722b' },
  { path: 'lib/league-administration/neon/current-roster.ts', sourceDigest: 'a632fd26c32fc88fb4d22452c530c60f66be9461d3b0de5e1a4af133f6eabeac' },
  { path: 'lib/league-administration/neon/draft-metadata.ts', sourceDigest: '7220708f1b48a16076232373a77870e47de1c63a625cc84d9450116c799d5bfa' },
  { path: 'lib/league-administration/neon/draft-selections.ts', sourceDigest: '9a8395936e3131f7c68f8d343553d4ada9b6325411ab85524f52d8d3d8e9cfb7' },
  { path: 'lib/league-administration/neon/enrollment.ts', sourceDigest: '499b0543e78754dc0e90b13667a48cf2d1e1533592c7163a3ea9da3c9b87613b' },
  { path: 'lib/league-administration/neon/exact-lineup-applicability.ts', sourceDigest: 'bceffc78a9383b66e22936ed09cae6f1c93b8b1b9891b547a404fd13a00e3d30' },
  { path: 'lib/league-administration/neon/exact-matchup-values.ts', sourceDigest: '4850ad560d8896fa59a726db417971f3af07baba161790cb0e9f596352557b8d' },
  { path: 'lib/league-administration/neon/exact-matchups.ts', sourceDigest: '7fabd09f457d0ac5ce2348e9e9c9a90c888b3175dc377833b0d917d69d6bf00b' },
  { path: 'lib/league-administration/neon/exact-period-context.ts', sourceDigest: '6756da8c6842d64d84face7e3a578f5f2d7b32d31a69b9fe0e8c25d96f3b5dd2' },
  { path: 'lib/league-administration/neon/league-settings.ts', sourceDigest: '5b217dbc131aae5779c78d68b0ee0addca7d54c5ef318344208eb822ed5e366d' },
  { path: 'lib/league-administration/neon/official-standings.ts', sourceDigest: '9988d9911ca4ce2c1b49bff6d3a917f03862f1a201203023747eedccf48f8b7f' },
  { path: 'lib/league-administration/neon/period-mapping.ts', sourceDigest: 'efe6edbae42027b6bd76bb71b071e2acd69179fe64c948b0407f5f0c58ceeee2' },
  { path: 'lib/league-administration/neon/player-directory.ts', sourceDigest: '36dd59796c3ce056af531a43cf3672baa2d80a1b6efad73c4c5a2425693666e1' },
  { path: 'lib/league-administration/neon/public-intake.ts', sourceDigest: 'c4494760da64c2841e1f4c8798327e473413ec213745c70ba8917044c4b8d479' },
  { path: 'lib/league-administration/neon/public-period-inventory-reader.ts', sourceDigest: 'cd7439a7176561ed1d10141a60b765b56ff51c278467877aa27bcbd5a6c0ce5a' },
  { path: 'lib/league-administration/neon/retained-matchups.ts', sourceDigest: 'f0a3b86f77c871c6201c61e35789572704410bddca6fdd4d01299ffe227b798c' },
  { path: 'lib/league-administration/neon/roster-player-links.ts', sourceDigest: '454d22b820be1088d890f0c5d0bd123c0026cdbac78f26f5c0811ac11c401a92' },
  { path: 'lib/league-administration/neon/team-managers.ts', sourceDigest: 'cab46fd21a6b3212ad25eb4b69ea26ba55d0a457a6a7023af695f309bff54fe0' },
  { path: 'lib/league-administration/neon/traded-picks.ts', sourceDigest: 'fb13e24b9bf449083571e3d527f59f85d9e49f88afb16be075603930e08c8aad' },
  { path: 'lib/league-administration/neon/transactions.ts', sourceDigest: '82ce75f4afc73d5b15ce448c1182d294f14555cc4e1f525f269c26c77c6c8aab' },
  { path: 'lib/league-administration/neon/weekly-reports.ts', sourceDigest: '5e9ae14d4a6cbee816cdbca30264a260c4e8a78773737af9e3d72258a71d6ac4' },
  { path: 'lib/league-administration/normalize.ts', sourceDigest: '72e26189a07659d43fcd9163bff2fc2e65bec14c172c87f256373e6fae437d11' },
  { path: 'lib/league-administration/period-mapping.ts', sourceDigest: 'd308332041a00d7da3c5c8f6006525545be2e0a45079b6e4581132777148f9cc' },
  { path: 'lib/league-administration/player-directory-contracts.ts', sourceDigest: 'afcedae0f0a8928b5f22b46375edbed76b1589781a4888c018bcef03bb1b89e4' },
  { path: 'lib/league-administration/player-directory.ts', sourceDigest: '5299aca54138176724c3e25319ee89ebe80d0fbbea17ad699ab434535c7df4fe' },
  { path: 'lib/league-administration/public-capture-witness.ts', sourceDigest: '0aa7ec576bc1f30aa839152ed644206be77f1e6bf2f5bb2fed3ff2512b56fb9d' },
  { path: 'lib/league-administration/public-intake-contracts.ts', sourceDigest: 'cff45b306cca1998a9ae4b4678a98d1b4e9829a8c0220c01664b7f3fc817a4f2' },
  { path: 'lib/league-administration/public-intake.ts', sourceDigest: '58c4f7ccb1dc860341d3dd4cc1f036e4bea7d12defed7e580d908e7bbb1a5162' },
  { path: 'lib/league-administration/public-refresh-contracts.ts', sourceDigest: 'ebf34ecff17ec76a96391f62a5260c117a621a6d434a571c06ed313c47f581bb' },
  { path: 'lib/league-administration/registry.ts', sourceDigest: '551a570a9701122844d58a38d9db54f432d9b09a4db50f38feb9a937dcb2f8f9' },
  { path: 'lib/league-administration/retained-matchup-comparison.ts', sourceDigest: '7552a738a89504c14a3ac0fb663d384814afa5fe4f45bff9f068ae4e1ee97b35' },
  { path: 'lib/league-administration/retained-matchups-contracts.ts', sourceDigest: '4e244faf6358632e60ff00ff1c05635982f9d77d58a8a407216646b3bc2be425' },
  { path: 'lib/league-administration/runtime.ts', sourceDigest: '725b64d0c289823c5c14503d5a51d83490ea9a86913bd45b7ac69221ec59134d' },
  { path: 'lib/league-administration/sleeper-canonical-standings.ts', sourceDigest: '5814ec5208a35cb470f4f8548b504bb4ab701eefa761fdc326a7ad65aaa548f4' },
  { path: 'lib/league-administration/source-mapping.ts', sourceDigest: '989c3c1af618e761f34e8d7575cbdf8623a8e40ffbac1335fd35627ac34245df' },
  { path: 'lib/league-administration/store-contracts.ts', sourceDigest: '0363282a630c8f508d42560175c60f313cbd5ac733f00358f018f2aa340fcb35' },
  { path: 'lib/league-administration/store.ts', sourceDigest: '1d32dee13903131241f6b554999e6220d08f386b88ad63b140521544d24c9591' },
  { path: 'lib/league-administration/transaction-capture-contracts.ts', sourceDigest: 'c1f13eda7c01d1f9fd38e43d8c0f6b7099ca14d3e627dd274bbebca7f39191c6' },
  { path: 'lib/league-capabilities.ts', sourceDigest: '9afcdd8cee0577d05d59ad72dbd913d28f664a54725862449014f863ff973afa' },
  { path: 'lib/league-capability-contracts.ts', sourceDigest: 'ade52c06e1061db5d17ce6ff38c6f24bee8a973343e6f2afc3ef6f95ffb92334' },
  { path: 'lib/league-transactions.ts', sourceDigest: 'a6bb439126f61c6b43cd9bf6c1a3bf1f370eae8b58db3eb244e52b7ed9215d79' },
  { path: 'lib/leagues.ts', sourceDigest: '56739dbd2a2936e76d8712f3d50a09247f49ff4b361921f696ff2ab352e29df2' },
  { path: 'lib/manager-championships.ts', sourceDigest: '2996ae2145451068b7ead907909543281eec431dabe3dea00e70758bbc981385' },
  { path: 'lib/manager-display.ts', sourceDigest: '14508e458f79924fb5a054888f2fe84e3906b676baf00f21368202c8faae9115' },
  { path: 'lib/manager-history-policy.ts', sourceDigest: '4db8d869a377876691d8b3b59c13a447c1245dff6dd3f6e129bce4100c32929a' },
  { path: 'lib/manager-history.ts', sourceDigest: '51a2ca254a8b0ccd851c15846206a05681b9ba816c2eea9184f2fb6c2d69c313' },
  { path: 'lib/manager-honors.ts', sourceDigest: '41a5068e82afe70c240c5bb211bb844856e1e51ac987fdf811ebac778cc4ffde' },
  { path: 'lib/matchup-box-score-types.ts', sourceDigest: '4795fcc9f983b08d805ad2d0b47d32e78b5605ac79c2b8356e9c3d7c4d3ddeb4' },
  { path: 'lib/matchup-box-scores.ts', sourceDigest: 'fa8c582393711437c7c89beddc0ebc4ce823491c5de9cba7d66526e4c17811f7' },
  { path: 'lib/matchup-period.ts', sourceDigest: '190a4cda2f8accaaa57d344a340524c71d98dac5bb9e2053113deadda89a5085' },
  { path: 'lib/matchup-snapshot-metadata.ts', sourceDigest: '9e352f8fe542bea57129d57d7213ffa2b61b6d9ab78fc9aa395ee4267dcb826b' },
  { path: 'lib/matchup-week.ts', sourceDigest: 'fd6ad7b5c0c87cca13555a812ead66f1e66743f84019a2d64499f61ad61e5f44' },
  { path: 'lib/matchup-win-probability-validation.ts', sourceDigest: '4d50407e8d998a4951c2ec995e0076c6ca8cbffbb4ad3f242f0bc5098f9c9644' },
  { path: 'lib/matchups-response.ts', sourceDigest: 'cb3432c069d6e4d6d7d79f0dacb79e3c48592703fc3b6faaa8e31fb0a329fd88' },
  { path: 'lib/matchups-shape.ts', sourceDigest: '600a052a06ae737db41aa9b7cb7488bd747435ec54cd75af9a114067f40a5e41' },
  { path: 'lib/my-fantasy.ts', sourceDigest: '78de9d83d8af8eaf2f526ee4694ffb64977ba36051b19605d41dcb5676e7a105' },
  { path: 'lib/my-team-matchup.ts', sourceDigest: 'd2bdc632a3d03d21aab2500a03a222c913144ff1331d5ced1248c92e9fc0e205' },
  { path: 'lib/my-team-schedule.ts', sourceDigest: '25148d59c1ba8c70f2cacdfa18a4d9347abbc0164bc76b39621c611cc2538973' },
  { path: 'lib/nfl-schedule.ts', sourceDigest: 'eea84b736ada178577f97e79f5a882cc453646b4c9422b46a41afe0485d27a1a' },
  { path: 'lib/nfl-teams.ts', sourceDigest: 'e8042055b84e416ad7a57fd2b309cc4efe42bf9a22b291c9f2d1c5bb71743724' },
  { path: 'lib/page-source.ts', sourceDigest: '7e4afdbfdb1760d5bd16ee2a8bc5a752d0e60f3d0d8b0754960efe8313431a07' },
  { path: 'lib/projected-standings.ts', sourceDigest: '089c42e2a684b2e3f22494bbe3c74b2ab12395f78cf3ddcb698f16d409b5740c' },
  { path: 'lib/projection-freshness.ts', sourceDigest: '9964e33f046d778561130fe1b770e55dd2d9ce95557fe3cd6461c4114297297a' },
  { path: 'lib/projection-store.ts', sourceDigest: 'a921e870093fe021f0fb1a7ad51b785f808616745dfc1473bc26cce40ce1a03e' },
  { path: 'lib/projections/adapters/configuration/league-registry.ts', sourceDigest: 'ae576be52a0298c8ee5ee88afab9e2a6776e460f3bc8d6cb5b90e032c1ab2b10' },
  { path: 'lib/projections/adapters/neon/all-player-box-scores.ts', sourceDigest: '5a5b82fb9c64186102d8804c98642571bc49419afbd603da3ce646e98da5d86b' },
  { path: 'lib/projections/adapters/neon/all-player-context.ts', sourceDigest: 'c8370a05850b906e070b201844d4d2996c5369dbba0f01ae45ec6875d72cab01' },
  { path: 'lib/projections/adapters/neon/all-player-metrics.ts', sourceDigest: 'c024ff5d60a3b6ef055fa6afb1642d3c9bba622766ddec91d2c5f0e6d13b50f1' },
  { path: 'lib/projections/adapters/neon/all-player-statistics.ts', sourceDigest: 'c18d61cc9ca8c60af612711295911a2c04a3ea8982974df5f27c7b7f5999b6d8' },
  { path: 'lib/projections/adapters/neon/authority-reader.ts', sourceDigest: '89e4eabefb61f1df8c6cffe138c19ec8bf76dd9f2e8f5424400ced32da4762c5' },
  { path: 'lib/projections/adapters/neon/contracts.ts', sourceDigest: 'e5a73c470f31a527fb1ba44ea68eab9244c86b63da0520d4d4f8c55c30cbbcab' },
  { path: 'lib/projections/adapters/neon/database-values.ts', sourceDigest: '3532ec3c7d87edcb0c400e9535dd6129d77d0854e69635db40f11f28b2ec2c24' },
  { path: 'lib/projections/adapters/neon/disabled-store.ts', sourceDigest: '3577f97aadecbaba2daf03e6e288664918d117327ca7ff8415d92fb1085b5d96' },
  { path: 'lib/projections/adapters/neon/exact-matchup-compatibility.ts', sourceDigest: '57db93091d1b5db1c9572a21f9984f4fec100ccb9719cf5b31f47c5177607fdf' },
  { path: 'lib/projections/adapters/neon/future-probability-refresh-sql.ts', sourceDigest: 'bd3f31e5d90bdacc98872295168dc60407a83e801c6e5af0edfe10f2dc9f23d8' },
  { path: 'lib/projections/adapters/neon/future-refresh-materialization.ts', sourceDigest: '68bcddc2311ceec6abcf52066babb275b71c34f1a03fe26847430f5f29580937' },
  { path: 'lib/projections/adapters/neon/future-refresh-plan.ts', sourceDigest: '068d1769d19111130f7a793b3b92d6e462bc48e540d2254958c1240fd67ceac7' },
  { path: 'lib/projections/adapters/neon/future-refresh-projection.ts', sourceDigest: 'c411426fa5c080075756257bc4e666af7ce0b5b0a8d82a33221430a0e0ab43b0' },
  { path: 'lib/projections/adapters/neon/future-refresh-values.ts', sourceDigest: 'd77e8de07b702a74992646900313d01edbe02ee55e450d4458fab17878acb233' },
  { path: 'lib/projections/adapters/neon/future-refresh.ts', sourceDigest: '211f3e69479e50a44a69f8e974f808a7a4baa7b704b138de0f71f535653fa4c2' },
  { path: 'lib/projections/adapters/neon/identities.ts', sourceDigest: '02d1f57fc4a9154fbb8edb4d47e7e2f6d270f3997849adde04626f3420d18c26' },
  { path: 'lib/projections/adapters/neon/jobs.ts', sourceDigest: '6636413d4a922b1249041dc81aaad4fff87806da9f484167085c099a2140f839' },
  { path: 'lib/projections/adapters/neon/lineup-acknowledgment-sql.ts', sourceDigest: '855bac98b60aad3639f4ac4821a6991578f53c44d4e7ad102a68fc952e2fa16f' },
  { path: 'lib/projections/adapters/neon/lineup-acknowledgment.ts', sourceDigest: '60d8a0257bfb1ff3f065743516574c43d604bc4d1fd47c155a2fa0592b51c1ab' },
  { path: 'lib/projections/adapters/neon/lineup-full-observation.ts', sourceDigest: 'c1e1e91987f774fac547566d5f143858678a3ac3ad314c2695fc375f6e235452' },
  { path: 'lib/projections/adapters/neon/lineup-publication-contracts.ts', sourceDigest: '2789091cdae8eb24b4e40fb4fc7b4caffde5764f22594561363f2c63ef8c96a7' },
  { path: 'lib/projections/adapters/neon/lineup-publication-sql.ts', sourceDigest: 'd68f01d1ad669dd2dc50716c4e0f85d703870a31bb4f0c0645c17cf52adc1692' },
  { path: 'lib/projections/adapters/neon/lineup-publication-values.ts', sourceDigest: 'b7d46890e24d34828e985f5b315deb2ad1194a9d131072e883d9cf1970e9adce' },
  { path: 'lib/projections/adapters/neon/lineup-watch-claims.ts', sourceDigest: '16707f337a5ff4bd476a42d1c1f090cf473b63a042187a74d2831f8e918d45e7' },
  { path: 'lib/projections/adapters/neon/lineup-watch-contracts.ts', sourceDigest: '03284f89b378895d8c7d5aef4d9be9439201d8295559aba0a24c1139b95b3f25' },
  { path: 'lib/projections/adapters/neon/lineup-watch-observations.ts', sourceDigest: 'cdf6a677677941b59b2957956ce011f254d4b56331a2d7ce5ca11e57d51804b3' },
  { path: 'lib/projections/adapters/neon/lineup-watch-read.ts', sourceDigest: '4467ded45e956654a8c4794f2b3236074e2a071d1299cee9e7f43cadbb74ddfd' },
  { path: 'lib/projections/adapters/neon/lineup-watch-sync.ts', sourceDigest: '87efa1350a61b9a6b9e2ae1b3a1b837a98e84e315f7caa88cb1c5635e478438b' },
  { path: 'lib/projections/adapters/neon/lineup-watch-values.ts', sourceDigest: '94b9819172e06f81dfb8cf82918ba32e01dfb72acc77c827232dd392256bc808' },
  { path: 'lib/projections/adapters/neon/live-defense-evidence.ts', sourceDigest: 'c474a709a6b3abd4239c4c66d11279b59346bb26e8dcafb885061f54df4dbaff' },
  { path: 'lib/projections/adapters/neon/live-defense-reader.ts', sourceDigest: 'ec38d4a1056b35912fed47321007905ad12fa3c755579b8ca50c2ab9851fcfbf' },
  { path: 'lib/projections/adapters/neon/matchup-selection-sql.ts', sourceDigest: 'a687dd88e453a47d08eed51558be986e0302352e2375b732681c7e2ecb73a25d' },
  { path: 'lib/projections/adapters/neon/matchups-shape-sql.ts', sourceDigest: 'ab6dde9de469fc7a7b8cc6342ebb55c7750c378799354893de886f4e9b678278' },
  { path: 'lib/projections/adapters/neon/observations.ts', sourceDigest: '85e237202d41a3422f5a25f2b176f345612d3c5111af43bd89629eae20d864a1' },
  { path: 'lib/projections/adapters/neon/period-cadence-values.ts', sourceDigest: '261d5511da0d36be8454c3c338587dffe9f129e0f182358eeee0e98a5bdd1cbb' },
  { path: 'lib/projections/adapters/neon/period-shape.ts', sourceDigest: 'a985b62b78bc10a80d0468c78464e4636a72547d48239dc4fda64ce349f4a7a3' },
  { path: 'lib/projections/adapters/neon/period-values.ts', sourceDigest: '610e0f8ce84a0450e3d948dd3d640994098b3c9ef3816ac520db0292b3139e8a' },
  { path: 'lib/projections/adapters/neon/periods.ts', sourceDigest: '81a32fe713c62422b5d4cb68f4e7e50471b683c71e2ea7d65ede453b9c4185c2' },
  { path: 'lib/projections/adapters/neon/projection-slates.ts', sourceDigest: '99631a32812bb62b9a51cbf9c890bf8c5036c5ebb42288c324ea2862a7797f7e' },
  { path: 'lib/projections/adapters/neon/projections.ts', sourceDigest: '54e73914f7ed10f34f8c77c1d789180badf1be4c544cc1d3f3bf1480f6fc007f' },
  { path: 'lib/projections/adapters/neon/retention.ts', sourceDigest: 'aea66d9e9f61b4950a1c405e6a83cf79a7e4059c362c0968abc02306d47e3188' },
  { path: 'lib/projections/adapters/neon/row-codec.ts', sourceDigest: 'c93d3751e000134e40a1bd092a9eac68952f0845a67c8e8b0e694bdbc57474ee' },
  { path: 'lib/projections/adapters/neon/snapshot-codec.ts', sourceDigest: '4be49688bce06df863e4d9d2cb10e6f5f5e4513349bc911526ed588dfe4d1d3e' },
  { path: 'lib/projections/adapters/neon/snapshot-revision.ts', sourceDigest: '6580e985687d6e67e881012fa85a674be9fc0350e684ab8eccacc1ae2927d26d' },
  { path: 'lib/projections/adapters/neon/snapshots.ts', sourceDigest: '6c0cef8b4a14cc535d94a6176accf639981307876bff41484f54593adc0a6f97' },
  { path: 'lib/projections/adapters/neon/source-history.ts', sourceDigest: '7a0af916b6a9ed15e1cceb3e6aea67adf390b52bd502e1a18bd9fdc95c55cb2e' },
  { path: 'lib/projections/adapters/sleeper/raw-matchups.ts', sourceDigest: 'a38f598ea9b7571dc31d6c241f87235114705fd7c57b4e4ee42681ae7011b27a' },
  { path: 'lib/projections/adapters/sleeper/schedule.ts', sourceDigest: '69449c4d1e11c819a1d224a8b58377c3a9c6b2c82aac45a4c94f70c56eca23a1' },
  { path: 'lib/projections/adapters/sleeper/scoring-profile.ts', sourceDigest: '49be08b83f5d7060272a3f4ae3c421ea72c08042d4514ea2418f1a468396a31d' },
  { path: 'lib/projections/adapters/sleeper/supplemental-projection-calibration.json', sourceDigest: 'f252296cfe87c845d27691249951550a1c96abd9d9cddb5b864fa3f00077dfef' },
  { path: 'lib/projections/adapters/sleeper/supplemental-projection-rules.ts', sourceDigest: '4fa79e546a0ffd2786c0a5e091b7178ec62fbdd990167cbb72a5ff65402f7dce' },
  { path: 'lib/projections/domain/all-player-eligibility.ts', sourceDigest: '9129a36547b55069fb820a97884223914cf8ac123de463fe288d85be3e551eab' },
  { path: 'lib/projections/domain/all-player-observation-evidence.ts', sourceDigest: '8933427f1d161dde59aa26b361dde214442e40df263fd065e4fb517dfb6a654c' },
  { path: 'lib/projections/domain/all-player-provider-context.ts', sourceDigest: 'dfc5c5d4aac62318f2c7033830c9d4191e09928e1f391a83c19d1e0bd674c398' },
  { path: 'lib/projections/domain/all-player-publication-coverage.ts', sourceDigest: 'aba22c82f373bc1dba8e5df45b8ca0233806f3e9645af0b5a68a4467ca4ce42f' },
  { path: 'lib/projections/domain/all-player-score-material.ts', sourceDigest: 'c39d2ee3b2a5f0a701f1cee11aa0787158dea3a0e771941020ae026646fd7424' },
  { path: 'lib/projections/domain/all-player-statistics.ts', sourceDigest: 'c2b2b07a7c8a0ce1dbdc04367905756abded6ed71eaf5261fff3ba1bad97578a' },
  { path: 'lib/projections/domain/all-player-team-context.ts', sourceDigest: '802c52b6d5b2d085c0c527c8b1c67cdab6a489261a913d38891429f56663fdcd' },
  { path: 'lib/projections/domain/contracts.ts', sourceDigest: '1dd259de6658211017683e7c90e2347cc7d8c701e43fd07ce146a0e4f7acd2dd' },
  { path: 'lib/projections/domain/lineup-publication.ts', sourceDigest: 'c55d7edaac27b05073f25ea7f645236e38a75e4e58fa816468278f473446241a' },
  { path: 'lib/projections/domain/live-calculation.ts', sourceDigest: '008172344e0c07680f61ee4e921c570214ba39d8715c4647a4ab980ee29f041b' },
  { path: 'lib/projections/domain/live-defense.ts', sourceDigest: '10735a840b7f6b0881c0f43ef3b74cdd33fbbe6c88f922b6a6669a1aa9aec02f' },
  { path: 'lib/projections/domain/period-cadence-timing.ts', sourceDigest: '1e1872f0bea659ad9b648ebc450ebfd41810ccc39786e006117cbf76d74f4773' },
  { path: 'lib/projections/domain/player-availability.ts', sourceDigest: '30ae0242f2598a5ddc479a02af6b28b0c50a73b5c0510d7630ae524dd7f33219' },
  { path: 'lib/projections/domain/scoring-events.ts', sourceDigest: 'caafbc82b33a3c68733fd36cf234739fdef4e52b79935ed402564eb7af341b42' },
  { path: 'lib/projections/domain/scoring.ts', sourceDigest: '5ec02fd146ecae0bd7eff4d3b847dfa0c6f373712fcc62d0a98431b5a6a7e914' },
  { path: 'lib/projections/domain/win-probability.ts', sourceDigest: 'ca4980264dff2495675184600f88f1c7bddc9d08f635dfc65034d2f9379b6b64' },
  { path: 'lib/projections/ports/future-refresh-repository.ts', sourceDigest: '09275afdaae2a3ba5f36ea1ead4beac2d4917cc2be97a8a515ecacdc4057e736' },
  { path: 'lib/projections/ports/identity-crosswalk.ts', sourceDigest: 'a7350f66a298a32de11d7fd9cb2cf5c3eda321022a2a7d0fa759a632bb81e078' },
  { path: 'lib/projections/ports/league-registry.ts', sourceDigest: '0573397037da00df68af896be4ed0af0a741b1c68f03816783d0ec3cba36b5cf' },
  { path: 'lib/projections/ports/live-defense-stat-source.ts', sourceDigest: '348b5a72b79fd8e1b4258aefdebcd4e3d38923575cf3fa35fb83220933989eaf' },
  { path: 'lib/projections/ports/logger.ts', sourceDigest: 'a3469917cc6293e132d52fb72904bc0d8e3ec46ba9ce2aa4e0e5957ed0041435' },
  { path: 'lib/projections/ports/projection-repository.ts', sourceDigest: '6502a3be5abec0dcfc5942b7a46d0f3be7a9d546ee4705280d0fd5104b2487eb' },
  { path: 'lib/projections/shared/lineup-cadence.ts', sourceDigest: '24b1ad34f16d05861abbd5e74bff2739341d259cd226ab28ad251fa888bd6c88' },
  { path: 'lib/projections/shared/live-box-score-evidence.ts', sourceDigest: '55cae48a4f1758be165af6d8434fc537e270eb273b49adf6f35b49e7ed4df012' },
  { path: 'lib/projections/shared/official-catalog-identity.ts', sourceDigest: '9453a0c207d6b91ff25c662a66a22980dc2fe1488d8986842160bf6daa218f79' },
  { path: 'lib/projections/shared/projection-versions.ts', sourceDigest: '28937bc9c5a00277bda5a5a5d1042773657d0f60c6dc2e7f98f308bc520fd0cd' },
  { path: 'lib/projections/shared/provider-identity.ts', sourceDigest: '4b45a5ee6efefe77337f6b13b653b12db7c12074835dfa17564a0b02c24f763f' },
  { path: 'lib/projections/shared/revision-compatibility.ts', sourceDigest: 'e419b7d25c93599b132c533615ca7f31fbcd4d953825323816479f9bd3a76631' },
  { path: 'lib/projections/shared/sha256.ts', sourceDigest: '6c5fab40cfe8c12cb9dc5f2d125b0e0487692b9c6872c19173e659fef317941e' },
  { path: 'lib/projections/shared/source-history.ts', sourceDigest: '5210b0c3bbf5b6abee8ca8149d378ebb72a627da7d2b84a458782c3c5cd96e6f' },
  { path: 'lib/projections/shared/source-timing.ts', sourceDigest: '37d120e47a1181a47874cec6a20a420c74a251b296fda9f4aba5866285b6c6d3' },
  { path: 'lib/projections/shared/stable-json.ts', sourceDigest: '079e87a526f8737a4265e3ca40431a14e3f792105d5453124c741e1979473745' },
  { path: 'lib/projections/shared/stored-snapshot.ts', sourceDigest: 'd4860b518b1d7536c2a69d88d94b046d28346638c4d990ab0ea9463a0b6664ba' },
  { path: 'lib/provider-request-telemetry.ts', sourceDigest: '02904402c0d5bc4a11c2351a0ea99294a93bd4e2f6877bf55a97f2b99d9fb39d' },
  { path: 'lib/roster-metrics.ts', sourceDigest: '29e9bd6540b8bd308171808b2b501f0bdee47db67a7b3d43f6d61f9095aaa890' },
  { path: 'lib/site-calendar-authority.ts', sourceDigest: 'eb05990fb261ac7c5c23c3a5b93066b3b76e7a3fa01779a3f2b6c34def9f383d' },
  { path: 'lib/site-week.ts', sourceDigest: '50b00696478812a59b80d144cfd78c083370d99d97e759ab8b912ad96e0c61df' },
  { path: 'lib/sleeper-catalog-types.ts', sourceDigest: 'cdd4c6e67cc289b983957f8977193ae963f25f031f0a17a41732999ddef0c218' },
  { path: 'lib/sleeper-history-validation.ts', sourceDigest: 'f54c85b0d651bdb8c0e86d3d6c78ec15c164374d8cff65aa1d63a598f3240aae' },
  { path: 'lib/sleeper-lineup.ts', sourceDigest: 'c075b2a24c1baeb0de0fd44aa17e6798d7c70f0d5e269f41064908f3e9cb788a' },
  { path: 'lib/sleeper-player-cache-policy.ts', sourceDigest: 'd08c75d3150e584a2b438b842d305550ca7a635dd6d0c161f2c86de492fd346f' },
  { path: 'lib/sleeper-player-catalog.ts', sourceDigest: '7b04d04e6aca3578334b0e916960a705258a166eb7ec0725ab3cf11cf668d1ca' },
  { path: 'lib/sleeper-public-response.ts', sourceDigest: '160dbb8bf04138d95e81ea468492d6477f3a7a4270413a7c733a5132a637e2cb' },
  { path: 'lib/sleeper.ts', sourceDigest: '19311adb64f3993dde952afc39e803121b5d2d9fa4868ff69dd2ed14ed7a827b' },
  { path: 'lib/transaction-time.ts', sourceDigest: 'cd0a282a80c36325a2ad08a260f4122ed86a416d21d5a89393dfa94d6089c787' },
  { path: 'lib/transform.ts', sourceDigest: '2edd33c8745298a06cd88201ee531a84a6c7dadc8be4d9ed8e3d81f78c57e23a' },
  { path: 'lib/types.ts', sourceDigest: '888effbc1cd6146eda6160d05e752cd702ba2d5584c315767a9059772bdab360' },
  { path: 'migrations/001_projection_foundation.sql', sourceDigest: 'eefa3aa224dbc6f0c6bb3edc9e4690425e2d6af7094938f3528059717d205050' },
  { path: 'migrations/002_manager_snapshot_payloads.sql', sourceDigest: '74585dec3e2717eede0579f9281a041a4e3cc0b0cd8378383fe2e3d64fd7214d' },
  { path: 'migrations/003_league_period_authority.sql', sourceDigest: '6f98e09646834cc542a6413e00c0d0c2d84ad4a5ff33905e429aba87c951406e' },
  { path: 'migrations/004_durable_projection_slates.sql', sourceDigest: '8ad48c22dea0d942a0a14027dcb240cda18f1bd728403e41aafa6b76f42f95b9' },
  { path: 'migrations/005_future_projection_refresh.sql', sourceDigest: '02bb6a3c6a183e7074fbea156b5f393d5772619098ab7c07be9dcc5528003c75' },
  { path: 'migrations/006_flexed_kickoff_candidate_index.sql', sourceDigest: 'd2c54c4e17439d3773cfab8db8ed68bf332abd1073fe793f62138efa89e1a3b0' },
  { path: 'migrations/007_lineup_freshness.sql', sourceDigest: '1a92f9517294fe289bd25d74923dd042d0cb394d143b5c89d33ed017963c3e47' },
  { path: 'migrations/008_additive_write_guards.sql', sourceDigest: '2447ffac523e1f5536e218887d5c29895c3a095385f89bd6beb55cb7c5e95814' },
  { path: 'migrations/009_game_clock_plausibility.sql', sourceDigest: '86df8afd868bb4fd589a76bf1e1693cdc546037cfc61b54ae972e660fbda056a' },
  { path: 'migrations/010_all_player_statistics.sql', sourceDigest: 'f9f2aa0c4dc7a0a3097bf770a7f08ef0719ed7f019307dcf629fa17058af31b4' },
  { path: 'migrations/011_all_player_foundation_guards.sql', sourceDigest: '0eaa96bcc0b65053ac8dab48657eb7bfe22fadbfd41b4f4c78c3472ca8a512b6' },
  { path: 'migrations/012_all_player_provider_participation.sql', sourceDigest: 'bea4bd568c05eee7da177811b25a1389180d37329b9061b3e79ee60d546aa4ed' },
  { path: 'migrations/013_all_player_participation_assumption.sql', sourceDigest: '4e03581db2b9a33d0df77110fe32b81745bec7f1ab001a20bfd788c4b4283d80' },
  { path: 'migrations/014_all_player_hourly_collection.sql', sourceDigest: '3aa6e19555c1e38bf7805199d401b0c6acd3ada00716950e04e54573867b1fc3' },
  { path: 'migrations/015_all_player_dynasty_publication.sql', sourceDigest: 'f7bf9b74cc14c0ede7a7534257ea956f99edc2615983b5b66ae546f2812fef8a' },
  { path: 'migrations/016_portable_league_administration.sql', sourceDigest: 'd662d9e9709153a4e9a6cbc93522bdd4d14c5b0a0c74a7c7ea8648455896596c' },
  { path: 'migrations/017_enrolled_all_player_publication.sql', sourceDigest: '1247dbfbdfbc79f41a448cf3b2e95fb4f9387e951a26f340e9533754e5c9c361' },
  { path: 'migrations/018_all_player_partial_context.sql', sourceDigest: 'd8ceba13b99a862a13de74bfa51f27bd2c0afbc16f93e4e9b67b6f79997390cc' },
  { path: 'migrations/019_live_defense_weekly_statistics.sql', sourceDigest: 'e4ab682773a2441000d9403a762b21f917abab59f840a979713418d2b865c77d' },
  { path: 'migrations/020_account_foundation.sql', sourceDigest: '10260342c3ea679b02f99df442c2b9e38d7a20d810b2c720744ef4a57755a918' },
  { path: 'migrations/021_website_auth.sql', sourceDigest: 'ad13e3cb1d6f6b60fbbf08cb161f2f4128ae760b9522a568979b43cf5f34b1e9' },
  { path: 'migrations/022_sleeper_actual_scoring_events.sql', sourceDigest: 'c7b72bb4bd3275744a65722f36d516f54af7fe28532dd1656f63f3e1524340a9' },
  { path: 'migrations/023_all_player_league_acceptance.sql', sourceDigest: 'ce1e15f1bc6891b84bca34b1eb63c446fe3246e5a76baaf646c22e624d73712a' },
  { path: 'migrations/024_all_player_scoped_completion.sql', sourceDigest: 'b03fd10c692f982f712488ecc6b4eaccc5fd483bd544d3275c9ec74ade8ec892' },
  { path: 'migrations/025_account_league_enrollment.sql', sourceDigest: 'fb2dcb87c9b8f437e4c873515b9b9bede6e7b34b683cb59d3a38469e968d241b' },
  { path: 'migrations/026_source_mapping_revisions.sql', sourceDigest: '0785d8d1ddb10c3dfd298edaeb429a88411391fc8f71964000c79a4242bf193e' },
  { path: 'migrations/027_current_roster_acceptance.sql', sourceDigest: 'aa531ad9bbc9b6f6aa137e17294e105ee2ea7120e51e7bc98b72040d1ff687ec' },
  { path: 'migrations/028_team_manager_relationships.sql', sourceDigest: '39d9f939474ce5df41b458bca590fdbeb73162de12fe80909113e5930d7567c5' },
  { path: 'migrations/029_league_season_settings.sql', sourceDigest: '0e2ea29e60fe80bd28d8f275764276683585ce237a653e045b983d3b759f51bd' },
  { path: 'migrations/030_exact_period_matchups.sql', sourceDigest: 'b7345a1a64a639bf7aa9b9bffcd6f0e4676dab0cf1f48919c07a1107e5586b2a' },
  { path: 'migrations/031_native_period_mapping_evidence.sql', sourceDigest: '5c5a95a2788fbc543058fa841af3463cb0354740ba6373eb4773ea16c43ce9f0' },
  { path: 'migrations/032_calculation_source_history.sql', sourceDigest: '5373dbf2451e9a6b33fefbdc3dc835fea8d2d2f9ad69f8ce8848765bd480f042' },
  { path: 'migrations/033_transaction_capture_acceptance.sql', sourceDigest: '0f5d8bf7c2192e46c038d1a232f41f9ad60eba7736a66d0d9230b78c7a299fcd' },
  { path: 'migrations/034_public_data_intake.sql', sourceDigest: '75a80dfe271dae678982cf6c7619e3683ced8711dce21c5895a055c7e4bf9e92' },
  { path: 'migrations/035_team_manager_evidence_v2.sql', sourceDigest: '77c1cb79c9dea2b41e70cc9aff74780c7eed794a68f3b537a0aefced34e74144' },
  { path: 'migrations/036_public_data_refresh.sql', sourceDigest: '1bc1ee30e0244b732fe0b58b6c7586c2a0bd80c0c1b95e39f77504fc901cbd06' },
  { path: 'migrations/037_official_data_registration.sql', sourceDigest: '9a046d2f84af1c705be088b1eff31fab0fcec0e4ecd8c3ce8c306bd94fb5d189' },
  { path: 'migrations/038_public_data_exact_periods.sql', sourceDigest: '0fd9c8415e993714e7f7b01f7da52bf17d81ce6de0b086b3dc4954e4962dcaf8' },
  { path: 'migrations/039_public_data_capture_witness.sql', sourceDigest: '5fd67b14ef40612122beb6e6ffbc5847cd3e89e6c7f085b4451bc18e74cf029a' },
  { path: 'migrations/040_legacy_all_player_data_membership.sql', sourceDigest: 'f3ca03630b786a26242ba881c9f59ea9145a2629369d8a025f5a3324c6ae060c' },
  { path: 'migrations/041_shared_player_directory.sql', sourceDigest: 'f8e2a34fa0bee75094b8afb276c72e6630f3a3cdc155e6dafd2cbe8e4ff0cdbf' },
  { path: 'migrations/042_roster_player_links.sql', sourceDigest: '73bd322087d3de51bc65446d38661aaadfffd81e096202e7168656c968ee0f0c' },
  { path: 'migrations/043_manager_directory_facts.sql', sourceDigest: '0fa81e8c9a61df7716cfbcc723c4b269fe8f3a51a6f9d2984498ee15e4e61f25' },
  { path: 'migrations/044_public_data_period_inventory.sql', sourceDigest: '7562ebe5f48cde351742144bc72dbbd5f6b4aece87d0edec7463c375fda7f76b' },
  { path: 'migrations/045_exact_matchup_values.sql', sourceDigest: '40bf8fa3eb8f1648487dcd1974a772ea15cbae66c0c0e9313a0cf98322367dee' },
  { path: 'migrations/046_official_brackets.sql', sourceDigest: '98f3388e14e7c26d0be4dab4f512f7ccae269ae64c495c5b9a795f6c0418a957' },
  { path: 'migrations/047_public_data_brackets.sql', sourceDigest: 'aa925726e32afe05e83a97dceb9d2e2957ca57aa3b617eae7403d70bbcf520b0' },
  { path: 'migrations/048_official_standings.sql', sourceDigest: '5d5052a19970592fdfdf3db090b734ddde9b164caf2b92c846e3f7c8f7ba8059' },
  { path: 'migrations/049_weekly_reports.sql', sourceDigest: '8b38bbe6c474befc289c4975165d45b04618e303997bd078dd533508b90b8163' },
  { path: 'migrations/050_public_report_intake.sql', sourceDigest: 'db12d902acb9e898ee351fff41bfbcc62040a2e29e866864dde8b45b24a9e609' },
  { path: 'migrations/051_public_transaction_intake.sql', sourceDigest: 'e6e35ef2328708d5f6310dbc3446f2d959b2756025a464654dc21465d6d18a3c' },
  { path: 'migrations/052_public_transaction_history.sql', sourceDigest: 'c6e20295bc21a04158cb0cf1ec83b642d2ece51074613a2c96ac5a87394058b9' },
  { path: 'migrations/053_draft_metadata.sql', sourceDigest: '27b5a34d1b3b1a56424cfffe907f71d1b453e6934a9d70b4eba08986851d736e' },
  { path: 'migrations/054_draft_selections.sql', sourceDigest: 'adea290105f31e8b08e7c35d1de03dc304a365461691b008ed46500a9d71b453' },
  { path: 'migrations/055_traded_pick_ownership.sql', sourceDigest: 'c39f8842e977428db9148b9bc090d38368c70f86efeb94d51f9c282a7a394939' },
  { path: 'migrations/056_public_draft_intake.sql', sourceDigest: '83d709a4132e585642f57cbcec89b23406239474515355ed544b272135b35a00' },
  { path: 'migrations/057_public_data_controls.sql', sourceDigest: '910388a94d449156f508dfab78c73fecdf573233f427f108b5559b0a63be8090' },
  { path: 'migrations/058_public_data_batches.sql', sourceDigest: '9fedc0836f295c20b9004c84292bb80f1066ac4db6f8c725d8bb5e75b1f5c926' },
  { path: 'migrations/059_public_data_resource_schedule.sql', sourceDigest: '97449430a4f8e48df14c9deefa1170ee0eae8c517abd0612b4cc758560b598f8' },
  { path: 'migrations/060_public_data_correction_cycle_admission.sql', sourceDigest: '166aa68fd7eba37a32f935f49702e283b7d9f3828f9c493db31a29972ac895c6' },
  { path: 'migrations/061_public_data_active_brackets.sql', sourceDigest: 'c4daa9c12e1dd4d11e723f05fa1aa4b4932cf431835b7901849cecbbc0f3821c' },
  { path: 'migrations/062_public_data_settled_request_budget.sql', sourceDigest: 'e9f22e0704ec3fc0c2a72b9a3341ac75e06e03ca9356409b40bb814cb76714b3' },
  { path: 'migrations/063_roster_player_link_contents.sql', sourceDigest: '86f92a4100383ac708a20ca01b12ec491f29ad56bdc9092bb6aec00277e33ad6' },
  { path: 'migrations/064_roster_population_contents.sql', sourceDigest: '5598586c948bcac01d706c07b65a6bf0ad99cc50a354e965e6c93e318edcea00' },
  { path: 'migrations/065_roster_provenance_contents.sql', sourceDigest: '57d28d751b0b31e07b8b407b657560d5eb68e993d76efbdde0d4bd0c8a796b33' },
  { path: 'migrations/066_canonical_source_identities.sql', sourceDigest: '45b39660b6d624a0f57b30d1fdc6fce3156127e7aba92f3103a881c7d90a16b1' },
  { path: 'migrations/067_canonical_standings.sql', sourceDigest: '3b13c8be39ab662303b23bc031292cbbbf214319225f046188211966f1d40438' },
  { path: 'migrations/068_canonical_standings_acceptance.sql', sourceDigest: '478ba511ec758c7eb9335684f66a3dc9040b18b8ec9328ae60672b07d973932e' },
  { path: 'migrations/069_canonical_native_compatibility.sql', sourceDigest: '168749fe592935fb773f03dae38a87f25e15bd296ff690ed5706ce51c0888b15' },
  { path: 'package.json', sourceDigest: '814f811d5d578c66c9140ec5b11a68e5bee66bd876b7323da62e3f0c1862e468' },
  { path: 'scripts/provision-account-role.sql', sourceDigest: '1b7d1cac7ebab477640b370364ea8aa46e3e42f417b8e3732299f4288a922d61' },
  { path: 'scripts/provision-auth-role.sql', sourceDigest: 'a65e2df5165bc866fa32646ff9d8796ad83f1b3af6f4c00ed11c628a46c5e8b9' },
  { path: 'scripts/provision-runtime-role.sql', sourceDigest: 'e381cb927af763cc1c9137f547e9d7af9867607ad45c35476a89d83ab912f705' },
  { path: 'scripts/run-disposable-integration.ts', sourceDigest: '8eb64772c886d175b7e5150b9f7c474168b0a94312cb526e374cca11d52d77e5' },
  { path: 'test-support/fixtures/cp26-named-source-2026.json', sourceDigest: '6d816511eb669004ca9e5afc6a5d7ea15c07881ee2c0d34d2452bfbdfa560d2b' },
  { path: 'tsconfig.json', sourceDigest: '9c73cf280ef044e5b2557572af01310c7bb24a714ec22d1a7bdb85e6f152cb0b' },
  { path: 'vitest.integration.config.ts', sourceDigest: 'fa516b6fd4ea253281417d66129ec18ac4f2fd99d3e2be422eeea29b68ed648e' },
];
export async function assertCanonicalStandingsSupportSources(siteRoot: string): Promise<void> {
  assert.match(CANONICAL_STANDINGS_SOURCE_DIGEST, /^[0-9a-f]{64}$/u, 'Canonical standings qualification source is not sealed.');
  assert(CANONICAL_STANDINGS_SUPPORT_SOURCES.length > 0, 'Canonical standings support source manifest is not sealed.');
  for (const entry of CANONICAL_STANDINGS_SUPPORT_SOURCES) assert.equal(
    qualificationSourceDigest(await readFile(join(siteRoot, entry.path), 'utf8')), entry.sourceDigest,
    'Canonical standings source differs from the reviewed LF digest: ' + entry.path);
}

// Closed CP26 fleet candidates. These pins authorize no execution and leave every historical profile unchanged.
export const FLEET_HEALTHY_SOURCE_DIGEST = 'ec3fbb027bfabf4727aa3dd462b7d7517adfaa56b9b14a49b66c0de45eb039f9';
export const FLEET_RECOVERY_SOURCE_DIGEST = '9aded11360b6099c5539251a03d272288ae61873618c571c73d6b55bab5d0200';
export const FLEET_DAILY_SOURCE_DIGEST = 'a3fb6878844c6b2a3a50331d6404215fd6034baaf87e9f054627fb7551afb897';
export const FLEET_LIVE_SOURCE_DIGEST = '527c15650eb3619645e409627441134fc32be3c12d9647ba00adcdbeed767e28';
export const FLEET_OWNERSHIP_SOURCE_DIGEST = '12c486536ef75d28e48d70fcadeafe395f98a1de253779268a8f3490bfcc6d63';
export const FLEET_SUPPORT_SOURCES = [
  { path: 'lib/league-administration/neon/player-directory.ts', sourceDigest: '36dd59796c3ce056af531a43cf3672baa2d80a1b6efad73c4c5a2425693666e1' },
  { path: 'integration/freshness-capacity-daily.ts', sourceDigest: '3f83dd9a7814d1f42058fb4403747e271bf9aaa8c4f0cf290d8b531d98202c73' },
  { path: 'integration/freshness-capacity-worker.ts', sourceDigest: 'de65b40e11b5da4608816359298a7c2e741a8234e46d93e6e05974f9fc1d3334' },
  { path: 'integration/freshness-capacity-protocol.ts', sourceDigest: 'b1b3afacd7dde95de36863dca4840cf8a98ad3fb6ba5357398c4248e9ba317ab' },
  { path: 'integration/freshness-capacity-profile.ts', sourceDigest: '4d2f8a2153a73870d2de065f848f88294b0a37f7c85384d7d0b3510ed36dcd1f' },
  { path: 'integration/freshness-capacity-observer.ts', sourceDigest: '37a173889e1c43ef2d451e468ebd29dda4013b67ea62c964d9a482546e76341f' },
  { path: 'integration/freshness-capacity-manifest.ts', sourceDigest: 'ed871128bea7b2ba384f0661c35dea3e25fe5ea46f92d8e3d9812e67dbdeeed6' },
  { path: 'integration/freshness-capacity-fixtures.ts', sourceDigest: '2dadd328d0c03b620ad92b15012b788ed90a2275babe2ad2135e337304bcf574' },
  { path: 'integration/freshness-capacity-transport.ts', sourceDigest: '1670c438e997a61b526de34f6dd06174137c442ef70717781ba64adaebc393a7' },
  { path: 'integration/freshness-capacity-evidence.ts', sourceDigest: '2425abac7a8f37428b93479802a8ee399091e59d07a2cff2eb9fbcc958edb71c' },
  { path: 'integration/freshness-capacity-recovery.ts', sourceDigest: 'e01e7847eb81ce5f0883f70c7fb43dcdca5187d43abef596c246d744d8ed31eb' },
  { path: 'integration/backend-controls-fetch.ts', sourceDigest: '81a475ec0128ab68a30de5b8e0b9953c5b154d18614a416014ae1152fbce5568' },
  { path: 'integration/neon-integration-harness.ts', sourceDigest: 'a4f2f15362da075160f0a187c4da35ee72902c37ebcf49de1842a92f50942783' },
  { path: 'integration/integration-child-process.ts', sourceDigest: 'c53e2e61042e031df57b0c99ddbc019adbbc29ea78a43ff96ca92b964953ab9a' },
  { path: 'integration/integration-database-ownership.ts', sourceDigest: 'cd7bd531f4dd0a649fb8cf8031ec87c09e1a7f63b1169f752758b6a6b57fbd19' },
  { path: 'integration/integration-lifecycle-budget.ts', sourceDigest: 'eb50d2f1ca091c8d0eaa547cb38338951a6501f9cb6f138d6b5641413f4bedc3' },
  { path: 'integration/disposable-integration.ts', sourceDigest: '57dfd8b2d7c8ab05addb5ba76a50ef7b15eb75ccdb1f1f8baa2d94c671572376' },
  { path: 'integration/disposable-neon-api.ts', sourceDigest: '6ef0d211273b0df9f08234c9676b8fe9949df67c127feacce356d86b91a15a1c' },
  { path: 'scripts/run-disposable-integration.ts', sourceDigest: '8eb64772c886d175b7e5150b9f7c474168b0a94312cb526e374cca11d52d77e5' },
  { path: 'scripts/provision-runtime-role.sql', sourceDigest: 'c013508197c09bb1b43b91ea530dd4b640da5233c4109af33f9530f7d878e279' },
  { path: 'scripts/provision-account-role.sql', sourceDigest: '1b7d1cac7ebab477640b370364ea8aa46e3e42f417b8e3732299f4288a922d61' },
  { path: 'scripts/provision-auth-role.sql', sourceDigest: 'a65e2df5165bc866fa32646ff9d8796ad83f1b3af6f4c00ed11c628a46c5e8b9' },
  { path: 'lib/provider-request-telemetry.ts', sourceDigest: '02904402c0d5bc4a11c2351a0ea99294a93bd4e2f6877bf55a97f2b99d9fb39d' },
  { path: 'lib/projections/runtime/projection-dispatch.ts', sourceDigest: '23215e729f73499adfacde7db9cda4c8d51e91afc9200498dfbd13f11dba2fc4' },
  { path: 'lib/league-administration/public-intake-runtime.ts', sourceDigest: '590a3dfccc1d2db6be08a61a66a8690e49404063578c24b0b40a9b14c29c6c6c' },
  { path: 'lib/league-administration/public-intake.ts', sourceDigest: '46894f0f359611cb9f2dad5b0dcd213ae30c1ac891890683caae3859ea92b3dd' },
  { path: 'lib/league-administration/public-intake-contracts.ts', sourceDigest: 'cff45b306cca1998a9ae4b4678a98d1b4e9829a8c0220c01664b7f3fc817a4f2' },
  { path: 'lib/league-administration/neon/public-intake.ts', sourceDigest: 'c4494760da64c2841e1f4c8798327e473413ec213745c70ba8917044c4b8d479' },
  { path: 'lib/league-administration/public-intake-reader.ts', sourceDigest: '830f347f54325cb9e638f543c1ee01e0475386857d097357f87f3ba3834ab7c1' },
  { path: 'lib/league-administration/public-capture-witness.ts', sourceDigest: '0aa7ec576bc1f30aa839152ed644206be77f1e6bf2f5bb2fed3ff2512b56fb9d' },
  { path: 'lib/league-administration/normalize.ts', sourceDigest: '72e26189a07659d43fcd9163bff2fc2e65bec14c172c87f256373e6fae437d11' },
  { path: 'lib/league-administration/store.ts', sourceDigest: '7bb8b073118ee762abee0f4ceb50e68771566e0384b6e9de4fa9cd66b27e9b64' },
  { path: 'lib/league-administration/store-contracts.ts', sourceDigest: 'bfc744ba9aa9a57eaa1abb42fb06440f610223eb639f760fe9b13e0a729c5015' },
  { path: 'lib/league-administration/runtime.ts', sourceDigest: 'e4ff88d3d46741a89cc3f457ec0583663cc08a251a06818ce353127beb35a1c5' },
  { path: 'lib/league-administration/registry.ts', sourceDigest: '551a570a9701122844d58a38d9db54f432d9b09a4db50f38feb9a937dcb2f8f9' },
  { path: 'lib/sleeper.ts', sourceDigest: '19311adb64f3993dde952afc39e803121b5d2d9fa4868ff69dd2ed14ed7a827b' },
  { path: 'lib/database.ts', sourceDigest: 'b20ced4e820d9d81477bd22b0925d608c94548917749b54e37be84515f527562' },
  { path: 'lib/projection-store.ts', sourceDigest: 'a921e870093fe021f0fb1a7ad51b785f808616745dfc1473bc26cce40ce1a03e' },
  { path: 'lib/projections/adapters/neon/jobs.ts', sourceDigest: '6636413d4a922b1249041dc81aaad4fff87806da9f484167085c099a2140f839' },
  { path: 'test-support/fixtures/cp26-named-source-2026.json', sourceDigest: '6d816511eb669004ca9e5afc6a5d7ea15c07881ee2c0d34d2452bfbdfa560d2b' },
  { path: 'test-support/fixtures/sleeper-2026-season-schedule.json', sourceDigest: 'e058c369b0cfcae77bc7a235763b32bde9a10519bf60fe134e627dbdf1cb3c4a' },
  { path: 'test-support/fixtures/all-player-foundation/catalog-QB.json', sourceDigest: 'ff71617db2825b31afe56f336376b9b6d7e0da1914d072b2900fb5ecde289f8d' },
  { path: 'test-support/fixtures/all-player-foundation/catalog-RB.json', sourceDigest: '0793d7a676c54147bea8664bd2caa2f9ff75f451672a28e5f60160412bbe33c0' },
  { path: 'test-support/fixtures/all-player-foundation/catalog-WR.json', sourceDigest: '5a24680b315070667fc3808e78cb52d3fb6c9effe1824694bbf0c50c01102f6e' },
  { path: 'test-support/fixtures/all-player-foundation/catalog-TE.json', sourceDigest: '37be01b602a39c29b0b2341ff1dbf2809ecf70ba27385eb87ef40edd8cb254a4' },
  { path: 'test-support/fixtures/all-player-foundation/catalog-K.json', sourceDigest: '6d322a549d2f385f7040e01b6fc57a33e210107a79d74d6c296f8e3d00bc4df2' },
  { path: 'test-support/fixtures/all-player-foundation/catalog-DEF.json', sourceDigest: 'a04cc7702edc947ae853ad9690bcbdb4a82e72a74d14008327968e44e092f5ac' },
  { path: '../../docs/aggregator-backend/data-backend-readiness-contract.md', sourceDigest: 'b6d1707fcfed8afa559a7e7e00026a75e3402213488ffd788e4b33ce34612508' },
  { path: '../../docs/aggregator-backend/data-backend-acceptance-baseline.md', sourceDigest: 'f2d3e4379c7ce064f720f54b1044c20a451fb6c460d639941510b597d4cd70c1' },
  { path: 'migrations/001_projection_foundation.sql', sourceDigest: 'eefa3aa224dbc6f0c6bb3edc9e4690425e2d6af7094938f3528059717d205050' },
  { path: 'migrations/002_manager_snapshot_payloads.sql', sourceDigest: '74585dec3e2717eede0579f9281a041a4e3cc0b0cd8378383fe2e3d64fd7214d' },
  { path: 'migrations/003_league_period_authority.sql', sourceDigest: '6f98e09646834cc542a6413e00c0d0c2d84ad4a5ff33905e429aba87c951406e' },
  { path: 'migrations/004_durable_projection_slates.sql', sourceDigest: '8ad48c22dea0d942a0a14027dcb240cda18f1bd728403e41aafa6b76f42f95b9' },
  { path: 'migrations/005_future_projection_refresh.sql', sourceDigest: '02bb6a3c6a183e7074fbea156b5f393d5772619098ab7c07be9dcc5528003c75' },
  { path: 'migrations/006_flexed_kickoff_candidate_index.sql', sourceDigest: 'd2c54c4e17439d3773cfab8db8ed68bf332abd1073fe793f62138efa89e1a3b0' },
  { path: 'migrations/007_lineup_freshness.sql', sourceDigest: '1a92f9517294fe289bd25d74923dd042d0cb394d143b5c89d33ed017963c3e47' },
  { path: 'migrations/008_additive_write_guards.sql', sourceDigest: '2447ffac523e1f5536e218887d5c29895c3a095385f89bd6beb55cb7c5e95814' },
  { path: 'migrations/009_game_clock_plausibility.sql', sourceDigest: '86df8afd868bb4fd589a76bf1e1693cdc546037cfc61b54ae972e660fbda056a' },
  { path: 'migrations/010_all_player_statistics.sql', sourceDigest: 'f9f2aa0c4dc7a0a3097bf770a7f08ef0719ed7f019307dcf629fa17058af31b4' },
  { path: 'migrations/011_all_player_foundation_guards.sql', sourceDigest: '0eaa96bcc0b65053ac8dab48657eb7bfe22fadbfd41b4f4c78c3472ca8a512b6' },
  { path: 'migrations/012_all_player_provider_participation.sql', sourceDigest: 'bea4bd568c05eee7da177811b25a1389180d37329b9061b3e79ee60d546aa4ed' },
  { path: 'migrations/013_all_player_participation_assumption.sql', sourceDigest: '4e03581db2b9a33d0df77110fe32b81745bec7f1ab001a20bfd788c4b4283d80' },
  { path: 'migrations/014_all_player_hourly_collection.sql', sourceDigest: '3aa6e19555c1e38bf7805199d401b0c6acd3ada00716950e04e54573867b1fc3' },
  { path: 'migrations/015_all_player_dynasty_publication.sql', sourceDigest: 'f7bf9b74cc14c0ede7a7534257ea956f99edc2615983b5b66ae546f2812fef8a' },
  { path: 'migrations/016_portable_league_administration.sql', sourceDigest: 'd662d9e9709153a4e9a6cbc93522bdd4d14c5b0a0c74a7c7ea8648455896596c' },
  { path: 'migrations/017_enrolled_all_player_publication.sql', sourceDigest: '1247dbfbdfbc79f41a448cf3b2e95fb4f9387e951a26f340e9533754e5c9c361' },
  { path: 'migrations/018_all_player_partial_context.sql', sourceDigest: 'd8ceba13b99a862a13de74bfa51f27bd2c0afbc16f93e4e9b67b6f79997390cc' },
  { path: 'migrations/019_live_defense_weekly_statistics.sql', sourceDigest: 'e4ab682773a2441000d9403a762b21f917abab59f840a979713418d2b865c77d' },
  { path: 'migrations/020_account_foundation.sql', sourceDigest: '10260342c3ea679b02f99df442c2b9e38d7a20d810b2c720744ef4a57755a918' },
  { path: 'migrations/021_website_auth.sql', sourceDigest: 'ad13e3cb1d6f6b60fbbf08cb161f2f4128ae760b9522a568979b43cf5f34b1e9' },
  { path: 'migrations/022_sleeper_actual_scoring_events.sql', sourceDigest: 'c7b72bb4bd3275744a65722f36d516f54af7fe28532dd1656f63f3e1524340a9' },
  { path: 'migrations/023_all_player_league_acceptance.sql', sourceDigest: 'ce1e15f1bc6891b84bca34b1eb63c446fe3246e5a76baaf646c22e624d73712a' },
  { path: 'migrations/024_all_player_scoped_completion.sql', sourceDigest: 'b03fd10c692f982f712488ecc6b4eaccc5fd483bd544d3275c9ec74ade8ec892' },
  { path: 'migrations/025_account_league_enrollment.sql', sourceDigest: 'fb2dcb87c9b8f437e4c873515b9b9bede6e7b34b683cb59d3a38469e968d241b' },
  { path: 'migrations/026_source_mapping_revisions.sql', sourceDigest: '0785d8d1ddb10c3dfd298edaeb429a88411391fc8f71964000c79a4242bf193e' },
  { path: 'migrations/027_current_roster_acceptance.sql', sourceDigest: 'aa531ad9bbc9b6f6aa137e17294e105ee2ea7120e51e7bc98b72040d1ff687ec' },
  { path: 'migrations/028_team_manager_relationships.sql', sourceDigest: '39d9f939474ce5df41b458bca590fdbeb73162de12fe80909113e5930d7567c5' },
  { path: 'migrations/029_league_season_settings.sql', sourceDigest: '0e2ea29e60fe80bd28d8f275764276683585ce237a653e045b983d3b759f51bd' },
  { path: 'migrations/030_exact_period_matchups.sql', sourceDigest: 'b7345a1a64a639bf7aa9b9bffcd6f0e4676dab0cf1f48919c07a1107e5586b2a' },
  { path: 'migrations/031_native_period_mapping_evidence.sql', sourceDigest: '5c5a95a2788fbc543058fa841af3463cb0354740ba6373eb4773ea16c43ce9f0' },
  { path: 'migrations/032_calculation_source_history.sql', sourceDigest: '5373dbf2451e9a6b33fefbdc3dc835fea8d2d2f9ad69f8ce8848765bd480f042' },
  { path: 'migrations/033_transaction_capture_acceptance.sql', sourceDigest: '0f5d8bf7c2192e46c038d1a232f41f9ad60eba7736a66d0d9230b78c7a299fcd' },
  { path: 'migrations/034_public_data_intake.sql', sourceDigest: '75a80dfe271dae678982cf6c7619e3683ced8711dce21c5895a055c7e4bf9e92' },
  { path: 'migrations/035_team_manager_evidence_v2.sql', sourceDigest: '77c1cb79c9dea2b41e70cc9aff74780c7eed794a68f3b537a0aefced34e74144' },
  { path: 'migrations/036_public_data_refresh.sql', sourceDigest: '1bc1ee30e0244b732fe0b58b6c7586c2a0bd80c0c1b95e39f77504fc901cbd06' },
  { path: 'migrations/037_official_data_registration.sql', sourceDigest: '9a046d2f84af1c705be088b1eff31fab0fcec0e4ecd8c3ce8c306bd94fb5d189' },
  { path: 'migrations/038_public_data_exact_periods.sql', sourceDigest: '0fd9c8415e993714e7f7b01f7da52bf17d81ce6de0b086b3dc4954e4962dcaf8' },
  { path: 'migrations/039_public_data_capture_witness.sql', sourceDigest: '5fd67b14ef40612122beb6e6ffbc5847cd3e89e6c7f085b4451bc18e74cf029a' },
  { path: 'migrations/040_legacy_all_player_data_membership.sql', sourceDigest: 'f3ca03630b786a26242ba881c9f59ea9145a2629369d8a025f5a3324c6ae060c' },
  { path: 'migrations/041_shared_player_directory.sql', sourceDigest: 'f8e2a34fa0bee75094b8afb276c72e6630f3a3cdc155e6dafd2cbe8e4ff0cdbf' },
  { path: 'migrations/042_roster_player_links.sql', sourceDigest: '73bd322087d3de51bc65446d38661aaadfffd81e096202e7168656c968ee0f0c' },
  { path: 'migrations/043_manager_directory_facts.sql', sourceDigest: '0fa81e8c9a61df7716cfbcc723c4b269fe8f3a51a6f9d2984498ee15e4e61f25' },
  { path: 'migrations/044_public_data_period_inventory.sql', sourceDigest: '7562ebe5f48cde351742144bc72dbbd5f6b4aece87d0edec7463c375fda7f76b' },
  { path: 'migrations/045_exact_matchup_values.sql', sourceDigest: '40bf8fa3eb8f1648487dcd1974a772ea15cbae66c0c0e9313a0cf98322367dee' },
  { path: 'migrations/046_official_brackets.sql', sourceDigest: '98f3388e14e7c26d0be4dab4f512f7ccae269ae64c495c5b9a795f6c0418a957' },
  { path: 'migrations/047_public_data_brackets.sql', sourceDigest: 'aa925726e32afe05e83a97dceb9d2e2957ca57aa3b617eae7403d70bbcf520b0' },
  { path: 'migrations/048_official_standings.sql', sourceDigest: '5d5052a19970592fdfdf3db090b734ddde9b164caf2b92c846e3f7c8f7ba8059' },
  { path: 'migrations/049_weekly_reports.sql', sourceDigest: '8b38bbe6c474befc289c4975165d45b04618e303997bd078dd533508b90b8163' },
  { path: 'migrations/050_public_report_intake.sql', sourceDigest: 'db12d902acb9e898ee351fff41bfbcc62040a2e29e866864dde8b45b24a9e609' },
  { path: 'migrations/051_public_transaction_intake.sql', sourceDigest: 'e6e35ef2328708d5f6310dbc3446f2d959b2756025a464654dc21465d6d18a3c' },
  { path: 'migrations/052_public_transaction_history.sql', sourceDigest: 'c6e20295bc21a04158cb0cf1ec83b642d2ece51074613a2c96ac5a87394058b9' },
  { path: 'migrations/053_draft_metadata.sql', sourceDigest: '27b5a34d1b3b1a56424cfffe907f71d1b453e6934a9d70b4eba08986851d736e' },
  { path: 'migrations/054_draft_selections.sql', sourceDigest: 'adea290105f31e8b08e7c35d1de03dc304a365461691b008ed46500a9d71b453' },
  { path: 'migrations/055_traded_pick_ownership.sql', sourceDigest: 'c39f8842e977428db9148b9bc090d38368c70f86efeb94d51f9c282a7a394939' },
  { path: 'migrations/056_public_draft_intake.sql', sourceDigest: '83d709a4132e585642f57cbcec89b23406239474515355ed544b272135b35a00' },
  { path: 'migrations/057_public_data_controls.sql', sourceDigest: '910388a94d449156f508dfab78c73fecdf573233f427f108b5559b0a63be8090' },
  { path: 'migrations/058_public_data_batches.sql', sourceDigest: '9fedc0836f295c20b9004c84292bb80f1066ac4db6f8c725d8bb5e75b1f5c926' },
  { path: 'migrations/059_public_data_resource_schedule.sql', sourceDigest: '97449430a4f8e48df14c9deefa1170ee0eae8c517abd0612b4cc758560b598f8' },
  { path: 'migrations/060_public_data_correction_cycle_admission.sql', sourceDigest: '166aa68fd7eba37a32f935f49702e283b7d9f3828f9c493db31a29972ac895c6' },
  { path: 'migrations/061_public_data_active_brackets.sql', sourceDigest: 'c4daa9c12e1dd4d11e723f05fa1aa4b4932cf431835b7901849cecbbc0f3821c' },
  { path: 'migrations/062_public_data_settled_request_budget.sql', sourceDigest: 'e9f22e0704ec3fc0c2a72b9a3341ac75e06e03ca9356409b40bb814cb76714b3' },
  { path: 'lib/league-administration/neon/current-roster.ts', sourceDigest: 'ee13b0846158d4503414f295473d30cc90d02101a3f89602d7506f9bf2569db9' },
  { path: 'lib/league-administration/neon/roster-player-links.ts', sourceDigest: '678edcd89859a7c9f31a54ae7a6abf21b3a1e1eda67a3dd9a4ead643facf2048' },
  { path: 'lib/league-administration/neon/exact-matchup-values.ts', sourceDigest: '4850ad560d8896fa59a726db417971f3af07baba161790cb0e9f596352557b8d' },
  { path: 'lib/league-administration/neon/transactions.ts', sourceDigest: '82ce75f4afc73d5b15ce448c1182d294f14555cc4e1f525f269c26c77c6c8aab' },
  { path: 'lib/league-administration/neon/official-standings.ts', sourceDigest: '42b9d76cee6c17070b122cbd567d415876914b481741c95837d4eb54100d6ba6' },
  { path: 'lib/league-administration/neon/brackets.ts', sourceDigest: '0d9ef6baf89f15437692f4df82db9f0ee5f83ea44f6aaae2c00a84d24d7c9aa5' },
  { path: 'lib/league-administration/neon/exact-period-context.ts', sourceDigest: '55b96337070b8b040c37f29f87589e5f5d0989d6bc2de83fe845810a77eca48c' },
  { path: 'lib/aggregator/official-results.ts', sourceDigest: '3d30e90cd6386b26234991c92778f2b34e089f1b9bfa3e03a2f34faa6648e8a5' },
  { path: 'lib/transform.ts', sourceDigest: '2edd33c8745298a06cd88201ee531a84a6c7dadc8be4d9ed8e3d81f78c57e23a' },
  { path: 'lib/league-administration/neon/public-period-inventory-reader.ts', sourceDigest: 'cd7439a7176561ed1d10141a60b765b56ff51c278467877aa27bcbd5a6c0ce5a' },
] as const;
function fleetProfile(profile: string) {
  if(profile===FLEET_LIVE_PROFILE)return{profile:FLEET_LIVE_PROFILE,module:FLEET_LIVE_MODULE,suite:FLEET_LIVE_SUITE,names:FLEET_LIVE_FULL_NAMES,pattern:closedPattern(FLEET_LIVE_FULL_NAMES),sourceDigest:FLEET_LIVE_SOURCE_DIGEST};
  if(profile===FLEET_OWNERSHIP_PROFILE)return{profile:FLEET_OWNERSHIP_PROFILE,module:FLEET_OWNERSHIP_MODULE,suite:FLEET_OWNERSHIP_SUITE,names:FLEET_OWNERSHIP_FULL_NAMES,pattern:closedPattern(FLEET_OWNERSHIP_FULL_NAMES),sourceDigest:FLEET_OWNERSHIP_SOURCE_DIGEST};
  if(profile===FLEET_HEALTHY_PROFILE)return{profile:FLEET_HEALTHY_PROFILE,module:FLEET_HEALTHY_MODULE,suite:FLEET_HEALTHY_SUITE,names:FLEET_HEALTHY_FULL_NAMES,pattern:closedPattern(FLEET_HEALTHY_FULL_NAMES),sourceDigest:FLEET_HEALTHY_SOURCE_DIGEST};
  if(profile===FLEET_DAILY_PROFILE)return{profile:FLEET_DAILY_PROFILE,module:FLEET_DAILY_MODULE,suite:FLEET_DAILY_SUITE,names:FLEET_DAILY_FULL_NAMES,pattern:closedPattern(FLEET_DAILY_FULL_NAMES),sourceDigest:FLEET_DAILY_SOURCE_DIGEST};
  if(profile===FLEET_RECOVERY_PROFILE)return{profile:FLEET_RECOVERY_PROFILE,module:FLEET_RECOVERY_MODULE,suite:FLEET_RECOVERY_SUITE,names:FLEET_RECOVERY_FULL_NAMES,pattern:closedPattern(FLEET_RECOVERY_FULL_NAMES),sourceDigest:FLEET_RECOVERY_SOURCE_DIGEST};
  return null;
}

export const QUALIFICATION_CONTEXT_ENV = 'PROJECTION_INTEGRATION_QUALIFICATION_CONTEXT';
const ARTIFACT_ENV = 'PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY';
export const QUALIFICATION_FILES = { report: 'qualification-report.json', cleanup: 'qualification-cleanup.json',
  failure: 'qualification-failure.json' } as const;
export const QUALIFICATION_MAX_BYTES = 4 * 1024 * 1024;
export const SELECTED_PROFILE = 'data-core-refresh-v1';
export const INGESTION_PROFILE = 'data-core-ingestion-v1';
export const CORE_COMPATIBILITY_PROFILE = 'data-core-compatibility-v1';
export const OFFICIAL_RESULTS_PROFILE = 'data-official-results-v1';
export const OFFICIAL_RESULTS_MODULE = 'integration/official-results.integration-case.ts';
// CP13 cases plus six B1, three combined A+B and four B2 provenance local cases; reviewed source pin is separate from hosted SQL qualification.
export const OFFICIAL_RESULTS_SOURCE_DIGEST = '7db5ed992af0a299566f284dda822b67bcafffd90e3608d358924944c8ce550d';
export const OFFICIAL_RESULTS_SUITE = 'official standings and results through restricted PostgreSQL';
export const OFFICIAL_RESULTS_TESTS = [
  'stores provider record points and supplied placement through independent typed receipts',
  'preserves native field states capacity outcomes and missing population without membership inference',
  'retains corrections replay equal captures and current attempt ordering without silent backfill',
  'rejects forged projections foreign receipts and source mapping mismatches atomically',
  'rolls back observed lock expiry and deferred changed or equal capture commits under original fences',
  'denies direct typed mutations and private helpers while stored reads remain source free',
  'composes native scores and reported bracket results without inferring outcomes or finality',
  'composes ordinary failed core recovery and changed refresh through immutable selected results',
  'B1 preserves fresh provenance corrections replay and stored legacy and shared reads',
  'B1 keeps null unproved and other-family population evidence inline',
  'B1 rejects foreign bindings hash mismatches history mutation and unauthorized evidence access',
  'B1 rolls back observed content waits after deadline or lease expiry',
  'B1 reuses one committed evidence winner across concurrent eligible receipts',
  'B1 measures matched witnessed cores while sharing only exact within-capture population evidence',
  'AB preserves four-mode history fresh proofs corrections return and exact replay',
  'AB rolls back both histories after downstream expiry and serializes actual runtime writers',
  'AB measures matched witnessed cores with combined lossless sharing and complete allocation attribution',
  'B2 preserves exact provenance fresh receipts replay and historical reads across storage combinations',
  'B2 rejects foreign bindings incomplete content history mutation and unauthorized provenance access',
  'B2 rolls back provenance after downstream expiry and preserves concurrent writer history',
  'B2 measures absolute final candidate core storage and bounded compression diagnostics',
] as const;
export const OFFICIAL_RESULTS_FULL_NAMES = OFFICIAL_RESULTS_TESTS.map(name => OFFICIAL_RESULTS_SUITE + ' > ' + name);
export const OFFICIAL_RESULTS_PATTERN = closedPattern(OFFICIAL_RESULTS_FULL_NAMES);
// Reuse only the two existing composition cases; retain the full twenty-one-case source inventory.
export const OFFICIAL_RESULTS_PLAYED_PROFILE = 'data-official-results-played-v1';
export const OFFICIAL_RESULTS_PLAYED_FULL_NAMES = [OFFICIAL_RESULTS_FULL_NAMES[6], OFFICIAL_RESULTS_FULL_NAMES[7]];
export const OFFICIAL_RESULTS_PLAYED_PATTERN = closedPattern(OFFICIAL_RESULTS_PLAYED_FULL_NAMES);
export const FRESH_INSTALL_PROFILE = 'data-fresh-install-v1';
export const FRESH_INSTALL_MODULE = 'integration/fresh-install.qualification-case.ts';
// Closed CP21 role-first source inventory; no SQL execution authority.
export const FRESH_INSTALL_SOURCE_DIGEST = 'ca15de14c5859bdac588642c5fc9f1c643a0d060d5f5b108166a96ea91eefade';
export const FRESH_INSTALL_SUITE = 'fresh installation and restricted LOGIN enforcement';
export const FRESH_INSTALL_TESTS = [
  "binds the empty child and three newly created LOGIN identities to the reviewed installation lineage",
  "matches every installed public and website_auth object to the frozen catalog manifest",
  "matches effective role PUBLIC and default privileges without ownership or membership escalation",
  "commits one canonical DATA write and stored read through the actual runtime LOGIN while denying direct private history and DDL access",
  "preserves the installed account boundary through actual account LOGIN writes row isolation and denied DATA auth and DDL access",
  "preserves the installed auth boundary through actual auth LOGIN CRUD foreign keys uniqueness and denied DATA account and DDL access",
  "enforces canonical identity foreign keys uniqueness and task cardinality without cross-scope aliases",
  "preserves receipt cardinality and immutable typed history under duplicate foreign and mutation attempts"
] as const;
export const FRESH_INSTALL_FULL_NAMES = FRESH_INSTALL_TESTS.map(name => FRESH_INSTALL_SUITE + ' > ' + name);
export const FRESH_INSTALL_PATTERN = closedPattern(FRESH_INSTALL_FULL_NAMES);
// CP27 measurement uses the existing guarded supervisor and no enlarged execution budget.
export const READER_PERFORMANCE_PROFILE = 'data-reader-performance-v1';
export const READER_PERFORMANCE_MODULE = 'integration/reader-performance.qualification-case.ts';
export const READER_PERFORMANCE_SOURCE_DIGEST = '4049bf8ba503fa08a2d3630db947ed99115c0b8d737833c1289f0687f0248ec4';
export const READER_PERFORMANCE_SUITE = 'bounded stored DATA reader performance through the existing PostgreSQL composition';
export const READER_PERFORMANCE_TESTS = [
  'stores the fixed sixteen league 2026 dataset through existing typed acceptance',
  'measures all one thousand scheduled composed reads at concurrency ten',
  'records bounded list reads actual query plans and immutable stored state',
] as const;
export const READER_PERFORMANCE_FULL_NAMES = READER_PERFORMANCE_TESTS.map(name => READER_PERFORMANCE_SUITE + ' > ' + name);
export const READER_PERFORMANCE_PATTERN = closedPattern(READER_PERFORMANCE_FULL_NAMES);
export const READER_PERFORMANCE_SUPPORT_SOURCES = [
  // CP27 diagnostics are newly bound; historical supervisor pins remain unchanged.
  { path: 'integration/disposable-integration.ts', sourceDigest: '7f6b9d24c79ee4f6fbd5aa86490475596efaaf219b08b9c4362b60076703749b' },
  { path: 'integration/integration-owner-loss-diagnostics.ts', sourceDigest: '9d37cd5993e3fd324c1472ba6a81ac93d7e253ba81116a5503fd7c73e41747c9' },
  { path: 'integration/freshness-capacity-fixtures.ts', sourceDigest: '2dadd328d0c03b620ad92b15012b788ed90a2275babe2ad2135e337304bcf574' },
  { path: 'integration/freshness-capacity-manifest.ts', sourceDigest: 'ed871128bea7b2ba384f0661c35dea3e25fe5ea46f92d8e3d9812e67dbdeeed6' },
  { path: 'lib/league-administration/public-intake.ts', sourceDigest: '46894f0f359611cb9f2dad5b0dcd213ae30c1ac891890683caae3859ea92b3dd' },
  { path: 'lib/league-administration/neon/public-intake.ts', sourceDigest: 'c4494760da64c2841e1f4c8798327e473413ec213745c70ba8917044c4b8d479' },
  { path: 'lib/league-administration/neon/public-period-inventory-reader.ts', sourceDigest: 'cd7439a7176561ed1d10141a60b765b56ff51c278467877aa27bcbd5a6c0ce5a' },
  { path: 'integration/reader-performance.ts', sourceDigest: '876da0752e80097152e90dd127606039712c238ee166c7541d55b03b4399d83a' },
  { path: 'integration/backend-controls-fetch.ts', sourceDigest: '81a475ec0128ab68a30de5b8e0b9953c5b154d18614a416014ae1152fbce5568' },
  { path: 'integration/neon-integration-harness.ts', sourceDigest: '1ea7875c3cae6785ae94572144391a0bce0206ebb575e11dfa4fb4cec3eb7933' },
  { path: 'lib/database.ts', sourceDigest: 'b20ced4e820d9d81477bd22b0925d608c94548917749b54e37be84515f527562' },
  { path: 'lib/league-administration/normalize.ts', sourceDigest: '72e26189a07659d43fcd9163bff2fc2e65bec14c172c87f256373e6fae437d11' },
  { path: 'lib/league-administration/store.ts', sourceDigest: '7bb8b073118ee762abee0f4ceb50e68771566e0384b6e9de4fa9cd66b27e9b64' },
  { path: 'lib/league-administration/store-contracts.ts', sourceDigest: 'bfc744ba9aa9a57eaa1abb42fb06440f610223eb639f760fe9b13e0a729c5015' },
  { path: 'lib/league-administration/public-intake-contracts.ts', sourceDigest: 'cff45b306cca1998a9ae4b4678a98d1b4e9829a8c0220c01664b7f3fc817a4f2' },
  { path: 'lib/league-administration/public-intake-reader.ts', sourceDigest: '830f347f54325cb9e638f543c1ee01e0475386857d097357f87f3ba3834ab7c1' },
  { path: 'lib/league-administration/public-season-history-reader.ts', sourceDigest: 'b881bbd75a76100bcfedb4f0a365e8af73c9617fd7caf61a4b25f3ead90a8ae5' },
  { path: 'lib/league-administration/public-official-results-reader.ts', sourceDigest: '8930e2208144038637a589bb733ec0065a2d63e56631cfcde8669f16081dda12' },
  { path: 'lib/league-administration/public-transaction-reader.ts', sourceDigest: '7dfd220809f08c90abcb2391e83ef161777cffa80fa31fcae173759d5ae77c49' },
  { path: 'lib/league-administration/public-draft-reader.ts', sourceDigest: '6a3f66295408cb13205cb86a9abea8370d1d3b86e06dcdfae889167559af8e73' },
  { path: 'lib/league-administration/public-bracket-reader.ts', sourceDigest: '15b082618120e796cb4f336b8df3f002ef58e698e0462203341ef879407dab15' },
  { path: 'lib/league-administration/public-weekly-report-reader.ts', sourceDigest: '0b7e07dc82a189a07f6808803921e05a3254be91093345101863854979d72c95' },
  { path: 'lib/aggregator/within-season-history.ts', sourceDigest: '050bc1ff4c8f2e579dbe6d040f9a0dc6222b53e04ae5dc078a77532a17d0dd55' },
  { path: 'lib/aggregator/official-results.ts', sourceDigest: '3d30e90cd6386b26234991c92778f2b34e089f1b9bfa3e03a2f34faa6648e8a5' },
  { path: 'integration/reader-performance-snapshot.ts', sourceDigest: '6139318e6a6d8e748ee0ac29f9995fd6924c7f112beb8f77993189f7df298e00' },
  { path: 'integration/reader-performance-oracle.ts', sourceDigest: '31da717fa4438e7df73c28d841ee92f0afd2614c98bbc2af827dd25fedd00626' },
] as const;
// CP28 local-only selector. Historical CP27 source pins above deliberately remain unchanged.
export const STORAGE_MEASUREMENT_PROFILE = 'data-storage-measurement-v1';
export const STORAGE_MEASUREMENT_MODULE = 'integration/reader-performance.qualification-case.ts';
export const STORAGE_MEASUREMENT_SOURCE_DIGEST = '317903b5fd4f727c31a1151d14c75eac669dad02cd4bce1e1e7d61c17e779466';
export const STORAGE_MEASUREMENT_SUITE = 'bounded two league DATA storage measurement through witnessed core acceptance';
export const STORAGE_MEASUREMENT_TESTS = ['measures the frozen catalog forty two cores four corrections and exact pre acknowledgment replays'] as const;
export const STORAGE_MEASUREMENT_FULL_NAMES = STORAGE_MEASUREMENT_TESTS.map(name => STORAGE_MEASUREMENT_SUITE + ' > ' + name);
export const STORAGE_MEASUREMENT_PATTERN = closedPattern(STORAGE_MEASUREMENT_FULL_NAMES);
export const STORAGE_MEASUREMENT_SUPPORT_SOURCES = [
  { path: 'integration/disposable-integration.ts', sourceDigest: '06cae505c4930128f5a7b16bb04d6533c5d712d08b7e2c235caf171c0b640414' },
  { path: 'integration/integration-owner-loss-diagnostics.ts', sourceDigest: '9d37cd5993e3fd324c1472ba6a81ac93d7e253ba81116a5503fd7c73e41747c9' },
  { path: 'integration/freshness-capacity-fixtures.ts', sourceDigest: '2dadd328d0c03b620ad92b15012b788ed90a2275babe2ad2135e337304bcf574' },
  { path: 'integration/freshness-capacity-manifest.ts', sourceDigest: 'ed871128bea7b2ba384f0661c35dea3e25fe5ea46f92d8e3d9812e67dbdeeed6' },
  { path: 'lib/league-administration/public-intake.ts', sourceDigest: '46894f0f359611cb9f2dad5b0dcd213ae30c1ac891890683caae3859ea92b3dd' },
  { path: 'lib/league-administration/neon/public-intake.ts', sourceDigest: 'c4494760da64c2841e1f4c8798327e473413ec213745c70ba8917044c4b8d479' },
  { path: 'lib/league-administration/neon/public-period-inventory-reader.ts', sourceDigest: 'cd7439a7176561ed1d10141a60b765b56ff51c278467877aa27bcbd5a6c0ce5a' },
  { path: 'integration/reader-performance.ts', sourceDigest: '7581745db06a6237c572c8a3b65ed765667fdae396d4efdd4dbf79c3481f4c9e' },
  { path: 'integration/backend-controls-fetch.ts', sourceDigest: '81a475ec0128ab68a30de5b8e0b9953c5b154d18614a416014ae1152fbce5568' },
  { path: 'integration/neon-integration-harness.ts', sourceDigest: '1ea7875c3cae6785ae94572144391a0bce0206ebb575e11dfa4fb4cec3eb7933' },
  { path: 'lib/database.ts', sourceDigest: 'b20ced4e820d9d81477bd22b0925d608c94548917749b54e37be84515f527562' },
  { path: 'lib/league-administration/normalize.ts', sourceDigest: '72e26189a07659d43fcd9163bff2fc2e65bec14c172c87f256373e6fae437d11' },
  { path: 'lib/league-administration/store.ts', sourceDigest: '7bb8b073118ee762abee0f4ceb50e68771566e0384b6e9de4fa9cd66b27e9b64' },
  { path: 'lib/league-administration/store-contracts.ts', sourceDigest: 'bfc744ba9aa9a57eaa1abb42fb06440f610223eb639f760fe9b13e0a729c5015' },
  { path: 'lib/league-administration/public-intake-contracts.ts', sourceDigest: 'cff45b306cca1998a9ae4b4678a98d1b4e9829a8c0220c01664b7f3fc817a4f2' },
  { path: 'lib/league-administration/public-intake-reader.ts', sourceDigest: '830f347f54325cb9e638f543c1ee01e0475386857d097357f87f3ba3834ab7c1' },
  { path: 'lib/league-administration/public-season-history-reader.ts', sourceDigest: 'b881bbd75a76100bcfedb4f0a365e8af73c9617fd7caf61a4b25f3ead90a8ae5' },
  { path: 'lib/league-administration/public-official-results-reader.ts', sourceDigest: '8930e2208144038637a589bb733ec0065a2d63e56631cfcde8669f16081dda12' },
  { path: 'lib/league-administration/public-transaction-reader.ts', sourceDigest: '7dfd220809f08c90abcb2391e83ef161777cffa80fa31fcae173759d5ae77c49' },
  { path: 'lib/league-administration/public-draft-reader.ts', sourceDigest: '6a3f66295408cb13205cb86a9abea8370d1d3b86e06dcdfae889167559af8e73' },
  { path: 'lib/league-administration/public-bracket-reader.ts', sourceDigest: '15b082618120e796cb4f336b8df3f002ef58e698e0462203341ef879407dab15' },
  { path: 'lib/league-administration/public-weekly-report-reader.ts', sourceDigest: '0b7e07dc82a189a07f6808803921e05a3254be91093345101863854979d72c95' },
  { path: 'lib/aggregator/within-season-history.ts', sourceDigest: '050bc1ff4c8f2e579dbe6d040f9a0dc6222b53e04ae5dc078a77532a17d0dd55' },
  { path: 'lib/aggregator/official-results.ts', sourceDigest: '3d30e90cd6386b26234991c92778f2b34e089f1b9bfa3e03a2f34faa6648e8a5' },
  { path: 'integration/reader-performance-snapshot.ts', sourceDigest: 'd2bf139bb311db505fc1288b11c47fa4626e1a0d4eefcbedd3963365688e89a4' },
  { path: 'integration/reader-performance-oracle.ts', sourceDigest: '31da717fa4438e7df73c28d841ee92f0afd2614c98bbc2af827dd25fedd00626' },
  { path: 'lib/league-administration/runtime.ts', sourceDigest: 'e4ff88d3d46741a89cc3f457ec0583663cc08a251a06818ce353127beb35a1c5' },
  { path: 'lib/league-administration/player-directory.ts', sourceDigest: '5299aca54138176724c3e25319ee89ebe80d0fbbea17ad699ab434535c7df4fe' },
  { path: 'lib/league-administration/player-directory-contracts.ts', sourceDigest: 'afcedae0f0a8928b5f22b46375edbed76b1589781a4888c018bcef03bb1b89e4' },
  { path: 'lib/league-administration/neon/administration.ts', sourceDigest: 'c50e9c498e22ffaac06d773229f56de4b90875f681aebcc85cc2412b8e7657d6' },
  { path: 'lib/league-administration/neon/current-roster.ts', sourceDigest: 'ee13b0846158d4503414f295473d30cc90d02101a3f89602d7506f9bf2569db9' },
  { path: 'lib/league-administration/neon/roster-player-links.ts', sourceDigest: '678edcd89859a7c9f31a54ae7a6abf21b3a1e1eda67a3dd9a4ead643facf2048' },
  { path: 'lib/aggregator/roster-player-links.ts', sourceDigest: 'c89487c6a393c84cbbfe469073c6f75453b76f67f0bf30b7c6fc16af20f2386b' },
  { path: 'lib/aggregator/official-standings.ts', sourceDigest: '63a4c1055b4a9cfc331d7482b6e7b90ca0a90bdf0f622addea9a215969182b85' },
  { path: 'lib/projections/adapters/neon/identities.ts', sourceDigest: '02d1f57fc4a9154fbb8edb4d47e7e2f6d270f3997849adde04626f3420d18c26' },
  { path: 'integration/integration-lifecycle-budget.ts', sourceDigest: 'eb50d2f1ca091c8d0eaa547cb38338951a6501f9cb6f138d6b5641413f4bedc3' },
  { path: '../../docs/aggregator-backend/data-backend-cp28-measurement-fixture.json', sourceDigest: 'a073787759851045909475f7b47a36f5daf01530604d1556a3afe9cf43ff785f' },
  { path: 'migrations/001_projection_foundation.sql', sourceDigest: 'eefa3aa224dbc6f0c6bb3edc9e4690425e2d6af7094938f3528059717d205050' },
  { path: 'migrations/002_manager_snapshot_payloads.sql', sourceDigest: '74585dec3e2717eede0579f9281a041a4e3cc0b0cd8378383fe2e3d64fd7214d' },
  { path: 'migrations/003_league_period_authority.sql', sourceDigest: '6f98e09646834cc542a6413e00c0d0c2d84ad4a5ff33905e429aba87c951406e' },
  { path: 'migrations/004_durable_projection_slates.sql', sourceDigest: '8ad48c22dea0d942a0a14027dcb240cda18f1bd728403e41aafa6b76f42f95b9' },
  { path: 'migrations/005_future_projection_refresh.sql', sourceDigest: '02bb6a3c6a183e7074fbea156b5f393d5772619098ab7c07be9dcc5528003c75' },
  { path: 'migrations/006_flexed_kickoff_candidate_index.sql', sourceDigest: 'd2c54c4e17439d3773cfab8db8ed68bf332abd1073fe793f62138efa89e1a3b0' },
  { path: 'migrations/007_lineup_freshness.sql', sourceDigest: '1a92f9517294fe289bd25d74923dd042d0cb394d143b5c89d33ed017963c3e47' },
  { path: 'migrations/008_additive_write_guards.sql', sourceDigest: '2447ffac523e1f5536e218887d5c29895c3a095385f89bd6beb55cb7c5e95814' },
  { path: 'migrations/009_game_clock_plausibility.sql', sourceDigest: '86df8afd868bb4fd589a76bf1e1693cdc546037cfc61b54ae972e660fbda056a' },
  { path: 'migrations/010_all_player_statistics.sql', sourceDigest: 'f9f2aa0c4dc7a0a3097bf770a7f08ef0719ed7f019307dcf629fa17058af31b4' },
  { path: 'migrations/011_all_player_foundation_guards.sql', sourceDigest: '0eaa96bcc0b65053ac8dab48657eb7bfe22fadbfd41b4f4c78c3472ca8a512b6' },
  { path: 'migrations/012_all_player_provider_participation.sql', sourceDigest: 'bea4bd568c05eee7da177811b25a1389180d37329b9061b3e79ee60d546aa4ed' },
  { path: 'migrations/013_all_player_participation_assumption.sql', sourceDigest: '4e03581db2b9a33d0df77110fe32b81745bec7f1ab001a20bfd788c4b4283d80' },
  { path: 'migrations/014_all_player_hourly_collection.sql', sourceDigest: '3aa6e19555c1e38bf7805199d401b0c6acd3ada00716950e04e54573867b1fc3' },
  { path: 'migrations/015_all_player_dynasty_publication.sql', sourceDigest: 'f7bf9b74cc14c0ede7a7534257ea956f99edc2615983b5b66ae546f2812fef8a' },
  { path: 'migrations/016_portable_league_administration.sql', sourceDigest: 'd662d9e9709153a4e9a6cbc93522bdd4d14c5b0a0c74a7c7ea8648455896596c' },
  { path: 'migrations/017_enrolled_all_player_publication.sql', sourceDigest: '1247dbfbdfbc79f41a448cf3b2e95fb4f9387e951a26f340e9533754e5c9c361' },
  { path: 'migrations/018_all_player_partial_context.sql', sourceDigest: 'd8ceba13b99a862a13de74bfa51f27bd2c0afbc16f93e4e9b67b6f79997390cc' },
  { path: 'migrations/019_live_defense_weekly_statistics.sql', sourceDigest: 'e4ab682773a2441000d9403a762b21f917abab59f840a979713418d2b865c77d' },
  { path: 'migrations/020_account_foundation.sql', sourceDigest: '10260342c3ea679b02f99df442c2b9e38d7a20d810b2c720744ef4a57755a918' },
  { path: 'migrations/021_website_auth.sql', sourceDigest: 'ad13e3cb1d6f6b60fbbf08cb161f2f4128ae760b9522a568979b43cf5f34b1e9' },
  { path: 'migrations/022_sleeper_actual_scoring_events.sql', sourceDigest: 'c7b72bb4bd3275744a65722f36d516f54af7fe28532dd1656f63f3e1524340a9' },
  { path: 'migrations/023_all_player_league_acceptance.sql', sourceDigest: 'ce1e15f1bc6891b84bca34b1eb63c446fe3246e5a76baaf646c22e624d73712a' },
  { path: 'migrations/024_all_player_scoped_completion.sql', sourceDigest: 'b03fd10c692f982f712488ecc6b4eaccc5fd483bd544d3275c9ec74ade8ec892' },
  { path: 'migrations/025_account_league_enrollment.sql', sourceDigest: 'fb2dcb87c9b8f437e4c873515b9b9bede6e7b34b683cb59d3a38469e968d241b' },
  { path: 'migrations/026_source_mapping_revisions.sql', sourceDigest: '0785d8d1ddb10c3dfd298edaeb429a88411391fc8f71964000c79a4242bf193e' },
  { path: 'migrations/027_current_roster_acceptance.sql', sourceDigest: 'aa531ad9bbc9b6f6aa137e17294e105ee2ea7120e51e7bc98b72040d1ff687ec' },
  { path: 'migrations/028_team_manager_relationships.sql', sourceDigest: '39d9f939474ce5df41b458bca590fdbeb73162de12fe80909113e5930d7567c5' },
  { path: 'migrations/029_league_season_settings.sql', sourceDigest: '0e2ea29e60fe80bd28d8f275764276683585ce237a653e045b983d3b759f51bd' },
  { path: 'migrations/030_exact_period_matchups.sql', sourceDigest: 'b7345a1a64a639bf7aa9b9bffcd6f0e4676dab0cf1f48919c07a1107e5586b2a' },
  { path: 'migrations/031_native_period_mapping_evidence.sql', sourceDigest: '5c5a95a2788fbc543058fa841af3463cb0354740ba6373eb4773ea16c43ce9f0' },
  { path: 'migrations/032_calculation_source_history.sql', sourceDigest: '5373dbf2451e9a6b33fefbdc3dc835fea8d2d2f9ad69f8ce8848765bd480f042' },
  { path: 'migrations/033_transaction_capture_acceptance.sql', sourceDigest: '0f5d8bf7c2192e46c038d1a232f41f9ad60eba7736a66d0d9230b78c7a299fcd' },
  { path: 'migrations/034_public_data_intake.sql', sourceDigest: '75a80dfe271dae678982cf6c7619e3683ced8711dce21c5895a055c7e4bf9e92' },
  { path: 'migrations/035_team_manager_evidence_v2.sql', sourceDigest: '77c1cb79c9dea2b41e70cc9aff74780c7eed794a68f3b537a0aefced34e74144' },
  { path: 'migrations/036_public_data_refresh.sql', sourceDigest: '1bc1ee30e0244b732fe0b58b6c7586c2a0bd80c0c1b95e39f77504fc901cbd06' },
  { path: 'migrations/037_official_data_registration.sql', sourceDigest: '9a046d2f84af1c705be088b1eff31fab0fcec0e4ecd8c3ce8c306bd94fb5d189' },
  { path: 'migrations/038_public_data_exact_periods.sql', sourceDigest: '0fd9c8415e993714e7f7b01f7da52bf17d81ce6de0b086b3dc4954e4962dcaf8' },
  { path: 'migrations/039_public_data_capture_witness.sql', sourceDigest: '5fd67b14ef40612122beb6e6ffbc5847cd3e89e6c7f085b4451bc18e74cf029a' },
  { path: 'migrations/040_legacy_all_player_data_membership.sql', sourceDigest: 'f3ca03630b786a26242ba881c9f59ea9145a2629369d8a025f5a3324c6ae060c' },
  { path: 'migrations/041_shared_player_directory.sql', sourceDigest: 'f8e2a34fa0bee75094b8afb276c72e6630f3a3cdc155e6dafd2cbe8e4ff0cdbf' },
  { path: 'migrations/042_roster_player_links.sql', sourceDigest: '73bd322087d3de51bc65446d38661aaadfffd81e096202e7168656c968ee0f0c' },
  { path: 'migrations/043_manager_directory_facts.sql', sourceDigest: '0fa81e8c9a61df7716cfbcc723c4b269fe8f3a51a6f9d2984498ee15e4e61f25' },
  { path: 'migrations/044_public_data_period_inventory.sql', sourceDigest: '7562ebe5f48cde351742144bc72dbbd5f6b4aece87d0edec7463c375fda7f76b' },
  { path: 'migrations/045_exact_matchup_values.sql', sourceDigest: '40bf8fa3eb8f1648487dcd1974a772ea15cbae66c0c0e9313a0cf98322367dee' },
  { path: 'migrations/046_official_brackets.sql', sourceDigest: '98f3388e14e7c26d0be4dab4f512f7ccae269ae64c495c5b9a795f6c0418a957' },
  { path: 'migrations/047_public_data_brackets.sql', sourceDigest: 'aa925726e32afe05e83a97dceb9d2e2957ca57aa3b617eae7403d70bbcf520b0' },
  { path: 'migrations/048_official_standings.sql', sourceDigest: '5d5052a19970592fdfdf3db090b734ddde9b164caf2b92c846e3f7c8f7ba8059' },
  { path: 'migrations/049_weekly_reports.sql', sourceDigest: '8b38bbe6c474befc289c4975165d45b04618e303997bd078dd533508b90b8163' },
  { path: 'migrations/050_public_report_intake.sql', sourceDigest: 'db12d902acb9e898ee351fff41bfbcc62040a2e29e866864dde8b45b24a9e609' },
  { path: 'migrations/051_public_transaction_intake.sql', sourceDigest: 'e6e35ef2328708d5f6310dbc3446f2d959b2756025a464654dc21465d6d18a3c' },
  { path: 'migrations/052_public_transaction_history.sql', sourceDigest: 'c6e20295bc21a04158cb0cf1ec83b642d2ece51074613a2c96ac5a87394058b9' },
  { path: 'migrations/053_draft_metadata.sql', sourceDigest: '27b5a34d1b3b1a56424cfffe907f71d1b453e6934a9d70b4eba08986851d736e' },
  { path: 'migrations/054_draft_selections.sql', sourceDigest: 'adea290105f31e8b08e7c35d1de03dc304a365461691b008ed46500a9d71b453' },
  { path: 'migrations/055_traded_pick_ownership.sql', sourceDigest: 'c39f8842e977428db9148b9bc090d38368c70f86efeb94d51f9c282a7a394939' },
  { path: 'migrations/056_public_draft_intake.sql', sourceDigest: '83d709a4132e585642f57cbcec89b23406239474515355ed544b272135b35a00' },
  { path: 'migrations/057_public_data_controls.sql', sourceDigest: '910388a94d449156f508dfab78c73fecdf573233f427f108b5559b0a63be8090' },
  { path: 'migrations/058_public_data_batches.sql', sourceDigest: '9fedc0836f295c20b9004c84292bb80f1066ac4db6f8c725d8bb5e75b1f5c926' },
  { path: 'migrations/059_public_data_resource_schedule.sql', sourceDigest: '97449430a4f8e48df14c9deefa1170ee0eae8c517abd0612b4cc758560b598f8' },
  { path: 'migrations/060_public_data_correction_cycle_admission.sql', sourceDigest: '166aa68fd7eba37a32f935f49702e283b7d9f3828f9c493db31a29972ac895c6' },
  { path: 'migrations/061_public_data_active_brackets.sql', sourceDigest: 'c4daa9c12e1dd4d11e723f05fa1aa4b4932cf431835b7901849cecbbc0f3821c' },
  { path: 'migrations/062_public_data_settled_request_budget.sql', sourceDigest: 'e9f22e0704ec3fc0c2a72b9a3341ac75e06e03ca9356409b40bb814cb76714b3' },
  { path: 'lib/league-administration/public-intake-runtime.ts', sourceDigest: '590a3dfccc1d2db6be08a61a66a8690e49404063578c24b0b40a9b14c29c6c6c' },
  { path: 'lib/league-administration/public-capture-witness.ts', sourceDigest: '0aa7ec576bc1f30aa839152ed644206be77f1e6bf2f5bb2fed3ff2512b56fb9d' },
  { path: 'lib/projection-store.ts', sourceDigest: 'a921e870093fe021f0fb1a7ad51b785f808616745dfc1473bc26cce40ce1a03e' },
  { path: 'lib/projections/adapters/neon/jobs.ts', sourceDigest: '6636413d4a922b1249041dc81aaad4fff87806da9f484167085c099a2140f839' },
  { path: 'lib/projections/shared/revision-compatibility.ts', sourceDigest: 'e419b7d25c93599b132c533615ca7f31fbcd4d953825323816479f9bd3a76631' },
  { path: 'lib/league-administration/contracts.ts', sourceDigest: '89e78482db92555ae01fa5e26819acc2f56f858f88e9b54dbd3960f1fd06a97c' },
  { path: 'integration/exact-matchup-clock.ts', sourceDigest: '3f7b327bce2dc72766564f804f85ff2dbb2ed7547fcdf2d4f8c8536c55545b69' },
  { path: '../../.github/workflows/integration.yml', sourceDigest: '0bfffec6811e594a4bcb40b4353da8313a4b012d2421fd761fffb02413ca0176' },
] as const;
export const BATCH_CALIBRATION_PROFILE = 'data-batch-calibration-v1';
export const BATCH_CALIBRATION_MODULE = 'integration/batch-calibration.qualification-case.ts';
export const BATCH_CALIBRATION_SOURCE_DIGEST = '305c24f10fd8c7b7ddf3e1915904885e15e7ba537661a7cb9323d9d62867c284';
export const BATCH_CALIBRATION_SUITE = 'four fresh leagues through one ordinary bounded DATA batch';
export const BATCH_CALIBRATION_TESTS = [
  'keeps omitted and false batch selections free of DATA writes and acquisition',
  'completes four fresh leagues in one bounded ordinary backend batch',
  'retains exact source receipt and stored reader parity without protected mutation',
] as const;
export const BATCH_CALIBRATION_FULL_NAMES = BATCH_CALIBRATION_TESTS.map(name => BATCH_CALIBRATION_SUITE + ' > ' + name);
export const BATCH_CALIBRATION_PATTERN = closedPattern(BATCH_CALIBRATION_FULL_NAMES);
// New calibration source bindings only. Historical profile pins remain unchanged.
export const BATCH_CALIBRATION_SUPPORT_SOURCES = [
  { path: 'integration/batch-calibration-worker.ts', sourceDigest: 'ac7b0da8ba8653cdaec732ceac77a6929846ffa2aaf26cdd0a420d7f2b587109' },
  { path: 'integration/batch-calibration-protocol.ts', sourceDigest: 'b5643009bd5c5af10f19f92c2b1d86c0053f5c1ca47c0b20dc30b0df77cb17ba' },
  { path: 'integration/batch-calibration-evidence.ts', sourceDigest: '13f68d877c1db23fcddbf6ba457e5bb77812ff0f5db8cefd9aa1731d5f98bffc' },
  { path: 'integration/runner-cycles-protocol.ts', sourceDigest: 'e77fabcb702b7f861b660c70332b5231eeff68d8bcce076e74cc886cd37681c3' },
  { path: 'integration/backend-controls-fetch.ts', sourceDigest: '81a475ec0128ab68a30de5b8e0b9953c5b154d18614a416014ae1152fbce5568' },
  { path: 'integration/neon-integration-harness.ts', sourceDigest: 'a4f2f15362da075160f0a187c4da35ee72902c37ebcf49de1842a92f50942783' },
  { path: 'integration/integration-child-process.ts', sourceDigest: 'c53e2e61042e031df57b0c99ddbc019adbbc29ea78a43ff96ca92b964953ab9a' },
  { path: 'integration/disposable-integration.ts', sourceDigest: 'ded8c935ffb8c9e009c1e23e2fc7265d9576d3ea48522c4ac773466e904cb562' },
  { path: 'migrations/058_public_data_batches.sql', sourceDigest: '9fedc0836f295c20b9004c84292bb80f1066ac4db6f8c725d8bb5e75b1f5c926' },
  { path: 'scripts/provision-runtime-role.sql', sourceDigest: 'af6485bd567bda033f5f6ca265c6b83af567856242aaa2365cc6af536b241e09' },
  { path: 'lib/league-administration/public-intake-runtime.ts', sourceDigest: '4097126dd86247ce9f61e3411e03f89cf7ef764fc1b8f42a22429cda14d6f2b5' },
  { path: 'lib/league-administration/public-intake.ts', sourceDigest: 'da733e37d5d821f00505d0e5ff36fbc1e7cb045ec6256f98a277688f22b9ec9b' },
  { path: 'lib/league-administration/public-intake-contracts.ts', sourceDigest: '85278e40a2365f1a2fc10506afd67718b182197e791fd3c4c39446ce0ed1b360' },
  { path: 'lib/league-administration/store.ts', sourceDigest: '7bb8b073118ee762abee0f4ceb50e68771566e0384b6e9de4fa9cd66b27e9b64' },
  { path: 'lib/league-administration/store-contracts.ts', sourceDigest: 'bfc744ba9aa9a57eaa1abb42fb06440f610223eb639f760fe9b13e0a729c5015' },
  { path: 'lib/league-administration/neon/public-intake.ts', sourceDigest: 'c5301d15e46a455261b46f6c9888937cd3d4c734b6ae5fea3cd835e9ec4ae9a6' },
  { path: 'lib/database.ts', sourceDigest: 'b20ced4e820d9d81477bd22b0925d608c94548917749b54e37be84515f527562' },
  { path: 'lib/projection-store.ts', sourceDigest: 'a921e870093fe021f0fb1a7ad51b785f808616745dfc1473bc26cce40ce1a03e' },
  { path: 'lib/projections/adapters/neon/jobs.ts', sourceDigest: '6636413d4a922b1249041dc81aaad4fff87806da9f484167085c099a2140f839' },
  { path: 'lib/sleeper.ts', sourceDigest: '19311adb64f3993dde952afc39e803121b5d2d9fa4868ff69dd2ed14ed7a827b' },
  { path: 'lib/league-administration/normalize.ts', sourceDigest: '72e26189a07659d43fcd9163bff2fc2e65bec14c172c87f256373e6fae437d11' },
  { path: 'lib/league-administration/runtime.ts', sourceDigest: 'e4ff88d3d46741a89cc3f457ec0583663cc08a251a06818ce353127beb35a1c5' },
  { path: 'lib/league-administration/public-intake-reader.ts', sourceDigest: '8dd735908a91cd1ee188c1654a4531a56860f444a63d137e6c63d5c5319509e2' },
  { path: 'lib/league-administration/public-capture-witness.ts', sourceDigest: '0aa7ec576bc1f30aa839152ed644206be77f1e6bf2f5bb2fed3ff2512b56fb9d' },
] as const;
export const RUNNER_CYCLES_PROFILE = 'data-runner-cycles-v1';
export const RUNNER_CYCLES_MODULE = 'integration/runner-cycles.qualification-case.ts';
// CP25 closed source inventory only; hosted execution requires separate authority.
export const RUNNER_CYCLES_SOURCE_DIGEST = '07cbe0462988ce9fca97cfd89f34db76e22857422adaa98acc53a203cbd3e896';
export const RUNNER_CYCLES_SUITE = 'complete opt-in DATA cycles through the production runner';
export const RUNNER_CYCLES_TESTS = [
  'keeps omitted and explicit false selections free of DATA acquisition and writes',
  'completes the first cycle across pending pause expiry and an inter-invocation process restart',
  'completes a changed second cycle while admitted work survives pause expiry and later disablement',
  'retains both cycle histories and stored reader parity without non-DATA mutation',
] as const;
export const RUNNER_CYCLES_FULL_NAMES = RUNNER_CYCLES_TESTS.map(name => RUNNER_CYCLES_SUITE + ' > ' + name);
export const RUNNER_CYCLES_PATTERN = closedPattern(RUNNER_CYCLES_FULL_NAMES);
export const RUNNER_CYCLES_SUPPORT_SOURCES = [
  { path: 'integration/runner-cycles-worker.ts', sourceDigest: '93fa9a18fc945541a5b27f3d830b9d2056d429859297b7983130453e0a4ca06d' },
  { path: 'integration/runner-cycles-protocol.ts', sourceDigest: 'e77fabcb702b7f861b660c70332b5231eeff68d8bcce076e74cc886cd37681c3' },
  { path: 'integration/runner-cycles-evidence.ts', sourceDigest: '8b95b2613bf344a9c52d420cd41dd1fe20c1fda3dc3e4d3c81697e9225c6ef2e' },
  { path: 'integration/integration-child-process.ts', sourceDigest: 'c53e2e61042e031df57b0c99ddbc019adbbc29ea78a43ff96ca92b964953ab9a' },
  { path: 'integration/neon-integration-harness.ts', sourceDigest: 'a4f2f15362da075160f0a187c4da35ee72902c37ebcf49de1842a92f50942783' },
  { path: 'integration/integration-database-ownership.ts', sourceDigest: 'cd7bd531f4dd0a649fb8cf8031ec87c09e1a7f63b1169f752758b6a6b57fbd19' },
  { path: 'integration/backend-controls-fetch.ts', sourceDigest: '81a475ec0128ab68a30de5b8e0b9953c5b154d18614a416014ae1152fbce5568' },
  { path: 'integration/disposable-integration.ts', sourceDigest: 'ded8c935ffb8c9e009c1e23e2fc7265d9576d3ea48522c4ac773466e904cb562' },
  { path: 'lib/projections/runtime/projection-dispatch.ts', sourceDigest: 'ae9bddcbeb255b36e04172c7130840bbbf4a49d13daf504f83fa99fad9948078' },
  { path: 'lib/league-administration/public-intake-runtime.ts', sourceDigest: '23904b77698ebed8fc604cb4fb2f1dab5bf029e447a6c6d1a8797231beddd754' },
  { path: 'lib/league-administration/public-intake.ts', sourceDigest: '9b5528c11f7627ad750cb663a479e157bc6295362e8ee46669885685b99fad6e' },
  { path: 'lib/league-administration/public-refresh-reader.ts', sourceDigest: 'ffce78f4db8d2fd90676842a33f02e478b1c97251421051da58ca048712d25ad' },
  { path: 'lib/league-administration/public-intake-reader.ts', sourceDigest: '8dd735908a91cd1ee188c1654a4531a56860f444a63d137e6c63d5c5319509e2' },
  { path: 'lib/league-administration/store.ts', sourceDigest: '7bb8b073118ee762abee0f4ceb50e68771566e0384b6e9de4fa9cd66b27e9b64' },
  { path: 'lib/database.ts', sourceDigest: 'b20ced4e820d9d81477bd22b0925d608c94548917749b54e37be84515f527562' },
  { path: 'lib/projection-store.ts', sourceDigest: 'a921e870093fe021f0fb1a7ad51b785f808616745dfc1473bc26cce40ce1a03e' },
  { path: 'lib/league-administration/neon/public-intake.ts', sourceDigest: 'e071249425a7aa0d0448f962fd059a4e5b2ada2d5d1ae762f30f77a66ee5f456' },
  { path: 'lib/projections/adapters/neon/jobs.ts', sourceDigest: '6636413d4a922b1249041dc81aaad4fff87806da9f484167085c099a2140f839' },
  { path: 'lib/league-administration/registry.ts', sourceDigest: '551a570a9701122844d58a38d9db54f432d9b09a4db50f38feb9a937dcb2f8f9' },
  { path: 'lib/league-administration/neon/enrollment.ts', sourceDigest: '4927f30b3737d826972c4db9acd71fd0692beefff13a7c4c8509b1916767c0d3' },
] as const;
export const BACKEND_CONTROLS_PROFILE = 'data-backend-controls-v1';
export const BACKEND_CONTROLS_MODULE = 'integration/backend-controls.qualification-case.ts';
export const BACKEND_CONTROLS_SOURCE_DIGEST = 'cec47909eb8eff1bff09c2e7d7e9f914e9413502ea68c96174afbfebaa8170a3';
export const BACKEND_CONTROLS_SUITE = 'controlled DATA submission configuration pause and stored status';
export const BACKEND_CONTROLS_TESTS = [
  'validates controlled submissions and retains canonical replay and conflict outcomes',
  'validates refresh identity and scope while preserving exact configuration replay',
  'serializes competing configuration CAS calls and retains only one immutable revision',
  'honors pause and expiry before admission and resumes the same immutable cycle after unpause',
  'preserves an admitted real capture and checkpoint when pause commits afterward',
  'counts paused configurations toward the sixteen target limit without mutating a rejected seventeenth',
  'retains one winner and one immutable capacity receipt under concurrent sixteen request admission',
  'reads missing pending available unavailable and capacity status without acquisition or scheduling writes',
  'enforces restricted control permissions and immutable receipt and configuration history',
] as const;
export const BACKEND_CONTROLS_FULL_NAMES = BACKEND_CONTROLS_TESTS.map(name => BACKEND_CONTROLS_SUITE + ' > ' + name);
export const BACKEND_CONTROLS_PATTERN = closedPattern(BACKEND_CONTROLS_FULL_NAMES);
export const BACKEND_CONTROLS_SUPPORT_SOURCES = [
  { path: 'integration/backend-controls-evidence.ts', sourceDigest: '7938c4502004c5c3f3914cca687c551d5337ea382ffe802ab76bb9862382285f' },
  { path: 'integration/backend-controls-fetch.ts', sourceDigest: '81a475ec0128ab68a30de5b8e0b9953c5b154d18614a416014ae1152fbce5568' },
] as const;
export const COMPETING_WORKERS_PROFILE = 'data-competing-workers-v1';
export const COMPETING_WORKERS_MODULE = 'integration/competing-workers.qualification-case.ts';
// CP23 closed source inventory only; no hosted SQL execution authority.
export const COMPETING_WORKERS_SOURCE_DIGEST = '7f5475f5ffa27debcf8253a5a53c3f9521b813cbbe12c7d8740b4207b977dd1f';
export const COMPETING_WORKERS_SUITE = 'fenced DATA ownership and bounded fairness under competing live workers';
export const COMPETING_WORKERS_TESTS = [
  'admits and accepts one core capture while independent worker processes compete for the same job',
  'rejects the original owner after real fence expiry and lease takeover while a healthy worker accepts',
  'rolls back fenced bootstrap registration after an observed lock wait and preserves healthy worker progress',
  'isolates a pre-admission selection failure while another target acquires and accepts official data',
  'bounds per-target accepted progress across repeated competing-worker rounds with a failing target',
] as const;
export const COMPETING_WORKERS_FULL_NAMES = COMPETING_WORKERS_TESTS.map(name => COMPETING_WORKERS_SUITE + ' > ' + name);
export const COMPETING_WORKERS_PATTERN = closedPattern(COMPETING_WORKERS_FULL_NAMES);
export const COMPETING_WORKERS_SUPPORT_SOURCES = [
  { path: 'integration/competing-workers-worker.ts', sourceDigest: '158bdbd119e52801253108378aa9ea768ffce93079a671e51a5edf39545fe7ee' },
  { path: 'integration/competing-workers-protocol.ts', sourceDigest: '1dfbe3d458471b67df69e2d30233fcd966ee7cd35250351bb803194601aeb8e2' },
  { path: 'integration/neon-integration-harness.ts', sourceDigest: 'a4f2f15362da075160f0a187c4da35ee72902c37ebcf49de1842a92f50942783' },
] as const;
export const PROCESS_RECOVERY_PROFILE = 'data-process-recovery-v1';
export const PROCESS_RECOVERY_MODULE = 'integration/process-recovery.qualification-case.ts';
// CP22 closed source inventory only; no hosted SQL execution authority.
export const PROCESS_RECOVERY_SOURCE_DIGEST = 'c03c0ed3b8959aca2d48a95802e4b3fce424112e2a737d2a30f2b95315f32afb';
export const PROCESS_RECOVERY_SUITE = 'durable DATA recovery after operating-system worker death';
export const PROCESS_RECOVERY_TESTS = [
  'restarts an admitted draft child from its retained catalog after process death before acquisition',
  'recovers unfinished bootstrap after genuine identity-lock rollback and process death',
  'reuses committed canonical identity after process death before bootstrap checkpoint',
  'preserves the first accepted core family across process death before remaining families',
  'reacquires core from durable receipts after process death before intake checkpoint',
  'continues after checkpoint commit and process death before job completion',
  'resumes the same recurring cycle after process death between selection and admission',
] as const;
export const PROCESS_RECOVERY_FULL_NAMES = PROCESS_RECOVERY_TESTS.map(name => PROCESS_RECOVERY_SUITE + ' > ' + name);
export const PROCESS_RECOVERY_PATTERN = closedPattern(PROCESS_RECOVERY_FULL_NAMES);
export const PROCESS_RECOVERY_SUPPORT_SOURCES = [
  { path: 'integration/process-recovery-worker.ts', sourceDigest: '7c1ee40ab51e4e5688087462dcd2928849d4d691dd28d767f666c8650f8ddb12' },
  { path: 'integration/process-recovery-protocol.ts', sourceDigest: 'fc3cca379fa307082b48e2f089eec932c5911ce489105e2ec2ed8e82b1c98d0b' },
] as const;
export const WITHIN_SEASON_HISTORY_PROFILE = 'data-within-season-history-v1';
export const WITHIN_SEASON_HISTORY_MODULE = 'integration/within-season-history.integration-case.ts';
// CP20 source binding only; actual restricted PostgreSQL execution requires separate authorization.
export const WITHIN_SEASON_HISTORY_SOURCE_DIGEST = '19c770060a21ae6d6c56316cffbee799309ac71f946518d079b8deded709c10d';
export const WITHIN_SEASON_HISTORY_SUITE = 'generic within season history through restricted PostgreSQL';
export const WITHIN_SEASON_HISTORY_TESTS = [
  'composes all eighteen native periods and both brackets for three unrelated 2026 formats',
  'keeps page coverage native gaps and missing states distinct without inventing series',
  'retains corrected removed equal and replayed source evidence beside exact receipt history',
  'applies evidenced period settings without rewriting captured configuration',
  'rejects foreign and remapped evidence while bounded stored reads remain source free',
] as const;
export const WITHIN_SEASON_HISTORY_FULL_NAMES = WITHIN_SEASON_HISTORY_TESTS.map(name => WITHIN_SEASON_HISTORY_SUITE + ' > ' + name);
export const WITHIN_SEASON_HISTORY_PATTERN = closedPattern(WITHIN_SEASON_HISTORY_FULL_NAMES);
export const DRAFT_INTAKE_PROFILE = 'data-draft-intake-v1';
export const DRAFT_INTAKE_MODULE = 'integration/public-draft-intake.integration-case.ts';
// Closed source inventory only; this definition authorizes no SQL invocation.
export const DRAFT_INTAKE_SOURCE_DIGEST = '6451e6baee207bccef25682dfd4748e4f7c7a0dd045332e021bfa1a382c5261f';
export const DRAFT_INTAKE_SUITE = 'ordinary draft and pick intake through restricted PostgreSQL';
export const DRAFT_INTAKE_TESTS = ["acquires one catalog and every native draft endpoint with real admission spacing and immutable stored receipts"] as const;
export const DRAFT_INTAKE_FULL_NAMES = DRAFT_INTAKE_TESTS.map(name => DRAFT_INTAKE_SUITE + ' > ' + name);
export const DRAFT_INTAKE_PATTERN = closedPattern(DRAFT_INTAKE_FULL_NAMES);
export const DRAFT_REFRESH_PROFILE = 'data-draft-refresh-v1';
export const DRAFT_REFRESH_MODULE = 'integration/public-draft-refresh.integration-case.ts';
// Closed source inventory only; this definition authorizes no SQL invocation.
export const DRAFT_REFRESH_SOURCE_DIGEST = 'cf96eda469b93cf6a43122fe5e92e9cb19c10f2c9a609ae3db320880c9e822ea';
export const DRAFT_REFRESH_SUITE = 'ordinary draft and pick refresh from disclosed baseline through restricted PostgreSQL';
export const DRAFT_REFRESH_TESTS = ["refreshes corrections equal captures and removals through ordinary recurring ownership without rewriting prior receipts"] as const;
export const DRAFT_REFRESH_FULL_NAMES = DRAFT_REFRESH_TESTS.map(name => DRAFT_REFRESH_SUITE + ' > ' + name);
export const DRAFT_REFRESH_PATTERN = closedPattern(DRAFT_REFRESH_FULL_NAMES);
export const DRAFT_INTAKE_RECOVERY_PROFILE = 'data-draft-intake-recovery-v1';
export const DRAFT_INTAKE_RECOVERY_MODULE = 'integration/draft-intake-recovery.integration-case.ts';
// Closed source inventory only; this definition authorizes no SQL invocation.
export const DRAFT_INTAKE_RECOVERY_SOURCE_DIGEST = '4fede026ece52e27a135677cadff1dde2f652432fec96552a6a33a4aaa70851c';
export const DRAFT_INTAKE_RECOVERY_SUITE = 'bounded draft intake recovery through restricted PostgreSQL';
export const DRAFT_INTAKE_RECOVERY_TESTS = ["reuses one completed catalog and last good selections through real retry exhaustion sibling recovery and lost acknowledgments"] as const;
export const DRAFT_INTAKE_RECOVERY_FULL_NAMES = DRAFT_INTAKE_RECOVERY_TESTS.map(name => DRAFT_INTAKE_RECOVERY_SUITE + ' > ' + name);
export const DRAFT_INTAKE_RECOVERY_PATTERN = closedPattern(DRAFT_INTAKE_RECOVERY_FULL_NAMES);
export const TRADED_PICKS_PROFILE = 'data-traded-picks-v1';
export const TRADED_PICKS_MODULE = 'integration/traded-picks.integration-case.ts';
// Authored source binding; hosted restricted PostgreSQL qualification requires separate authorization.
export const TRADED_PICKS_SOURCE_DIGEST = '34b3aa905c84eb9eaa13108363be3a2258773190cf1638826f37042be611d68c';
export const TRADED_PICKS_SUITE = 'official traded picks through restricted PostgreSQL';
export const TRADED_PICKS_TESTS = [
  "stores endpoint scoped native ownership and future references through fixture HTTP and restricted readers",
  "advances fresh conflict and unknown evidence while preserving field states duplicates and previous owner ambiguity",
  "retains corrections removals equal observations replay and native ordering with stable scoped asset history",
  "retains failed partial malformed capped and oversized evidence without replacing complete endpoint heads",
  "rejects out of order foreign remapped and forged ownership submissions",
  "preserves legacy metadata selections and original twenty second reservation and commit fences",
  "denies direct typed mutations private helpers and history edits while reads remain provider free",
] as const;
export const TRADED_PICKS_FULL_NAMES = TRADED_PICKS_TESTS.map(name => TRADED_PICKS_SUITE + ' > ' + name);
export const TRADED_PICKS_PATTERN = closedPattern(TRADED_PICKS_FULL_NAMES);
export const DRAFT_SELECTIONS_PROFILE = 'data-draft-selections-v1';
export const DRAFT_SELECTIONS_MODULE = 'integration/draft-selections.integration-case.ts';
// Authored source binding; hosted restricted PostgreSQL qualification requires separate authorization.
export const DRAFT_SELECTIONS_SOURCE_DIGEST = '50b1fedb499982b4b6fd4fee3b49ba4c54fe0a3ac34b92c4f8c049e48fa82eb1';
export const DRAFT_SELECTIONS_SUITE = 'official draft selections through restricted PostgreSQL';
export const DRAFT_SELECTIONS_TESTS = [
  'stores native selections and source ordering through fixture HTTP and restricted stored readers',
  'preserves optional field states complete empty keeper evidence and legacy draft compatibility',
  'retains duplicate contradictory malformed capped and failed captures without replacing last good selections',
  'retains corrected removed equal and replayed selections with stable native pick identities',
  'freezes unresolved directory conflict and later resolved player links without rewriting history',
  'rejects out of order foreign remapped and forged selection submissions',
  'rolls back expired reservations and deferred changed or equal commits under original twenty second fences',
  'denies direct typed mutations private helpers and history edits while reads remain provider free',
] as const;
export const DRAFT_SELECTIONS_FULL_NAMES = DRAFT_SELECTIONS_TESTS.map(name => DRAFT_SELECTIONS_SUITE + ' > ' + name);
export const DRAFT_SELECTIONS_PATTERN = closedPattern(DRAFT_SELECTIONS_FULL_NAMES);
export const DRAFT_METADATA_PROFILE = 'data-draft-metadata-v1';
export const DRAFT_METADATA_MODULE = 'integration/draft-metadata.integration-case.ts';
// Authored source binding; actual restricted PostgreSQL qualification requires separate authorization.
export const DRAFT_METADATA_SOURCE_DIGEST = 'ad02626bdd113ead7d71a2f7365238f407f8eb8116b95da0f78f3e413c0fe4da';
export const DRAFT_METADATA_SUITE = 'official draft metadata through restricted PostgreSQL';
export const DRAFT_METADATA_TESTS = [
  'stores multiple native draft identities settings order and status through the fixture HTTP adapter and restricted reader',
  'distinguishes native optional states and accepts metadata independently without changing legacy draft coverage',
  'preserves complete empty eight draft capacity and honest nine draft overflow counts',
  'preserves valid siblings and last good metadata through partial failed malformed and conflicting captures',
  'retains immutable corrections fresh equal content receipts exact replay and both completion orders',
  'rejects foreign receipts wrong season remapping and forged metadata atomically',
  'rolls back observed locks and deferred changed or equal commits after original twenty second fences expire',
  'denies direct typed mutations private helpers and history changes while current and exact reads stay source free',
] as const;
export const DRAFT_METADATA_FULL_NAMES = DRAFT_METADATA_TESTS.map(name => DRAFT_METADATA_SUITE + ' > ' + name);
export const DRAFT_METADATA_PATTERN = closedPattern(DRAFT_METADATA_FULL_NAMES);
export const TRANSACTION_HISTORY_INTAKE_PROFILE = 'data-transaction-history-intake-v1';
export const TRANSACTION_HISTORY_INTAKE_MODULE = 'integration/transaction-history-intake.integration-case.ts';
// Authored source binding; independent review and actual SQL qualification remain separate.
export const TRANSACTION_HISTORY_INTAKE_SOURCE_DIGEST = 'cc41ea92ce0da8ac3622919e3858c665622a5ec9bbd6ff9348b7c235a83512c7';
export const TRANSACTION_HISTORY_INTAKE_SUITE = 'ordinary full transaction history intake through restricted PostgreSQL';
export const TRANSACTION_HISTORY_INTAKE_TESTS = ['acquires every native period with real admission spacing immutable receipts replay and source free historical pages'] as const;
export const TRANSACTION_HISTORY_INTAKE_FULL_NAMES = TRANSACTION_HISTORY_INTAKE_TESTS.map(name => TRANSACTION_HISTORY_INTAKE_SUITE + ' > ' + name);
export const TRANSACTION_HISTORY_INTAKE_PATTERN = closedPattern(TRANSACTION_HISTORY_INTAKE_FULL_NAMES);
export const TRANSACTION_HISTORY_REFRESH_PROFILE = 'data-transaction-history-refresh-v1';
export const TRANSACTION_HISTORY_REFRESH_MODULE = 'integration/transaction-history-refresh.integration-case.ts';
// Authored source binding; independent review and actual SQL qualification remain separate.
export const TRANSACTION_HISTORY_REFRESH_SOURCE_DIGEST = '3e886156d752fa1a05162dd621a745b8b2b6acdb7572a848f97b0d1de39f6ca3';
export const TRANSACTION_HISTORY_REFRESH_SUITE = 'full transaction history refresh from disclosed accepted baseline through restricted PostgreSQL';
export const TRANSACTION_HISTORY_REFRESH_TESTS = ['refreshes all nineteen periods with corrections removals equal content fresh clocks and immutable prior receipts'] as const;
export const TRANSACTION_HISTORY_REFRESH_FULL_NAMES = TRANSACTION_HISTORY_REFRESH_TESTS.map(name => TRANSACTION_HISTORY_REFRESH_SUITE + ' > ' + name);
export const TRANSACTION_HISTORY_REFRESH_PATTERN = closedPattern(TRANSACTION_HISTORY_REFRESH_FULL_NAMES);
export const TRANSACTION_HISTORY_RECOVERY_PROFILE = 'data-transaction-history-recovery-v1';
export const TRANSACTION_HISTORY_RECOVERY_MODULE = 'integration/transaction-history-recovery.integration-case.ts';
// Authored source binding; independent review and actual SQL qualification remain separate.
export const TRANSACTION_HISTORY_RECOVERY_SOURCE_DIGEST = 'df2ced24e2742aea93434ef48767aa8675f5bac8d42672d0de030972f90757f7';
export const TRANSACTION_HISTORY_RECOVERY_SUITE = 'bounded transaction history recovery through restricted PostgreSQL';
export const TRANSACTION_HISTORY_RECOVERY_TESTS = ['preserves nineteen period coverage through lost acknowledgment retry exhaustion and next period recovery'] as const;
export const TRANSACTION_HISTORY_RECOVERY_FULL_NAMES = TRANSACTION_HISTORY_RECOVERY_TESTS.map(name => TRANSACTION_HISTORY_RECOVERY_SUITE + ' > ' + name);
export const TRANSACTION_HISTORY_RECOVERY_PATTERN = closedPattern(TRANSACTION_HISTORY_RECOVERY_FULL_NAMES);
export const TRANSACTION_PERIOD_INTAKE_PROFILE = 'data-transaction-period-intake-v1';
export const TRANSACTION_PERIOD_INTAKE_MODULE = 'integration/transaction-period-intake.integration-case.ts';
// Authored CP14 fixture source pin; exact-source independent review and SQL execution are separate.
export const TRANSACTION_PERIOD_INTAKE_SOURCE_DIGEST = 'a16903ff701c386f2f9d2f2032e6920534139015e83bc1ed6b9d675ceea682f1';
export const TRANSACTION_PERIOD_INTAKE_SUITE = 'ordinary exact transaction period intake through restricted PostgreSQL';
export const TRANSACTION_PERIOD_INTAKE_TESTS = [
  'validates the one period selector immutable request scope and restricted task permissions before admission',
  'composes ordinary failed acquisition recovery and same capture typed facts through immutable witnessed receipt selection',
  'preserves complete empty and last good partial evidence while rejecting foreign receipt selections without source access',
] as const;
export const TRANSACTION_PERIOD_INTAKE_FULL_NAMES = TRANSACTION_PERIOD_INTAKE_TESTS.map(name => TRANSACTION_PERIOD_INTAKE_SUITE + ' > ' + name);
export const TRANSACTION_PERIOD_INTAKE_PATTERN = closedPattern(TRANSACTION_PERIOD_INTAKE_FULL_NAMES);
export const WEEKLY_REPORTS_PROFILE = 'data-weekly-reports-v1';
export const WEEKLY_REPORTS_MODULE = 'integration/weekly-reports.integration-case.ts';
// Authored CP13 report candidate; this source pin is not hosted SQL qualification.
export const WEEKLY_REPORTS_SOURCE_DIGEST = '298dfeec2fa275eea7993c19822541360b5041356c4fc406a924251a9b8d09a2';
export const WEEKLY_REPORTS_SUITE = 'weekly report facts through restricted PostgreSQL and ordinary intake';
export const WEEKLY_REPORTS_TESTS = [
  'replays all twenty four retained native report rows through typed storage with independent clocks',
  'preserves optional native field states decimals round identity and fail closed capacity boundaries',
  'retains corrections equal native times replay ordering failed latest attempts and immutable receipts',
  'rejects forged normalized facts native scope team identity and source mapping substitutions atomically',
  'rolls back observed relation locks and deferred changed or equal receipts under original fences',
  'denies typed mutations private helpers and late history changes while stored reads stay source free',
  'validates optional selectors immutable request scope and report task permissions before admission',
  'composes one post report intake and failed refresh recovery through immutable witnessed selections',
] as const;
export const WEEKLY_REPORTS_FULL_NAMES = WEEKLY_REPORTS_TESTS.map(name => WEEKLY_REPORTS_SUITE + ' > ' + name);
export const WEEKLY_REPORTS_PATTERN = closedPattern(WEEKLY_REPORTS_FULL_NAMES);
export const OFFICIAL_RESULTS_EVIDENCE_PROFILE = 'data-official-results-evidence-v1';
export const OFFICIAL_RESULTS_EVIDENCE_MODULE = 'integration/official-results-evidence.integration-case.ts';
// Separate CP13 retained evidence fixture; authored source is not hosted SQL qualification.
export const OFFICIAL_RESULTS_EVIDENCE_SOURCE_DIGEST = '342f44ca993a2c442f2ffb0075ffb47f8713243e7b5a5d203ac09ffb0598e8ae';
export const OFFICIAL_RESULTS_EVIDENCE_SUITE = 'retained official standings and ordinary recovery through restricted PostgreSQL';
export const OFFICIAL_RESULTS_EVIDENCE_TESTS = [
  'replays retained 2026 standings without refreshing source clocks or claiming membership',
  'preserves accepted membership and exact historical brackets through ordinary refresh failures and recovery',
] as const;
export const OFFICIAL_RESULTS_EVIDENCE_FULL_NAMES = OFFICIAL_RESULTS_EVIDENCE_TESTS.map(name => OFFICIAL_RESULTS_EVIDENCE_SUITE + ' > ' + name);
export const OFFICIAL_RESULTS_EVIDENCE_PATTERN = closedPattern(OFFICIAL_RESULTS_EVIDENCE_FULL_NAMES);
export const BRACKET_INTAKE_PROFILE = 'data-bracket-intake-v1';
export const BRACKET_INTAKE_MODULE = 'integration/bracket-intake.integration-case.ts';
// CP12 authored ordinary intake fixture; SQL execution needs separate exact-source authorization.
export const BRACKET_INTAKE_SOURCE_DIGEST = '6c3d7a31a56d24c31475bc9b13741813c4a8984e31e8bb166a83149a17cf5d7e';
export const BRACKET_INTAKE_SUITE = 'ordinary paired playoff bracket intake through restricted PostgreSQL';
export const BRACKET_INTAKE_TESTS = [
  'validates selected bracket scope and preserves unselected request compatibility before admission',
  'completes ordinary empty discovery without inventing bracket tasks or source availability',
  'composes ordinary paired bracket recovery and changed refresh through witnessed immutable receipts',
  'preserves checkpoint and cycle scope history across replay configuration changes and source remapping',
  'denies direct bracket task mutations and private helpers through restricted roles',
] as const;
export const BRACKET_INTAKE_FULL_NAMES = BRACKET_INTAKE_TESTS.map(name => BRACKET_INTAKE_SUITE + ' > ' + name);
export const BRACKET_INTAKE_PATTERN = closedPattern(BRACKET_INTAKE_FULL_NAMES);
export const TYPED_BRACKETS_PROFILE = 'data-typed-brackets-v1';
export const TYPED_BRACKETS_MODULE = 'integration/typed-brackets.integration-case.ts';
// CP11 authored resource fixture only; SQL execution requires separate exact-source authorization.
export const TYPED_BRACKETS_SOURCE_DIGEST = 'edab995ff8e046b4a3c6dcab40a22f1bebb76e3d3f7a59dc7e3f1cd7bb3c06fe';
export const TYPED_BRACKETS_SUITE = 'typed official playoff brackets through restricted PostgreSQL';
export const TYPED_BRACKETS_TESTS = [
  'stores native bracket rounds entrants advancement edges and supplied results for both families',
  'distinguishes unpublished empty and native field states without inventing results',
  'preserves last good typed brackets through malformed partial and conflicting captures',
  'retains immutable corrections equal content replay and both out of order completion orders',
  'rejects unrelated source mappings receipts and forged normalized bracket facts',
  'rolls back typed bracket acceptance after an observed lock outlives the original worker fence',
  'denies direct typed mutations and private helpers while stored readers remain source free',
] as const;
export const TYPED_BRACKETS_FULL_NAMES = TYPED_BRACKETS_TESTS.map(name => TYPED_BRACKETS_SUITE + ' > ' + name);
export const TYPED_BRACKETS_PATTERN = closedPattern(TYPED_BRACKETS_FULL_NAMES);
export const EXACT_MATCHUP_VALUES_PROFILE = 'data-exact-matchup-values-v1';
export const EXACT_MATCHUP_VALUES_MODULE = 'integration/exact-matchup-values.integration-case.ts';
// CP10 fixture source only; SQL execution requires separate exact-source authorization.
export const EXACT_MATCHUP_VALUES_SOURCE_DIGEST = 'dd53e3f1d40479c30364ed8bae30fd9057399d3ab6acbdc0d8d6488622b6af36';
export const EXACT_MATCHUP_VALUES_SUITE = 'exact native lineup and score values through restricted PostgreSQL';
export const EXACT_MATCHUP_VALUES_TESTS = [
  'stores exact native lineup and score channels with zero negative and exponent values',
  'distinguishes missing null and empty fields while invalid and partial captures preserve the accepted head',
  'retains equal scores unpaired rows and separate native legs without inventing aggregate scores or finality',
  'preserves immutable corrections equal content replay and both out of order completion orders',
  'rejects unrelated source scope and rolls back an observed write after the original fence expires',
  'denies direct typed history mutation and private helpers while stored readers remain restricted and source free',
  'composes ordinary exact score intake and changed refresh through immutable stored receipt reads',
] as const;
export const EXACT_MATCHUP_VALUES_FULL_NAMES = EXACT_MATCHUP_VALUES_TESTS.map(name => EXACT_MATCHUP_VALUES_SUITE + ' > ' + name);
export const EXACT_MATCHUP_VALUES_PATTERN = closedPattern(EXACT_MATCHUP_VALUES_FULL_NAMES);
export const PERIOD_SETTINGS_CONTEXT_PROFILE = 'data-period-settings-context-v1';
export const PERIOD_SETTINGS_CONTEXT_MODULE = 'integration/period-settings-context.integration-case.ts';
// New seven-case CP9 fixture; execution requires independent exact-source review and a separate allowance.
export const PERIOD_SETTINGS_CONTEXT_SOURCE_DIGEST = 'e12c44f20aa6865c379aea0eeb8eb74dfa7f19fa1ce495f0d6fe1a13760cdecb';
export const PERIOD_SETTINGS_CONTEXT_SUITE = 'receipt bound period settings context through restricted PostgreSQL';
export const PERIOD_SETTINGS_CONTEXT_TESTS = [
  'retains captured settings without treating current observations as historical applicability',
  'resolves independently evidenced components at inclusive native period boundaries',
  'preserves missing invalid and contradictory evidence without inventing fantasy phase',
  'retains captured settings through corrections replay and newer unproved decisions',
  'rejects unrelated receipts and mapping revisions while preserving immutable history',
  'composes ordinary recovery and changed refresh context through retained period receipts',
  'denies applicability activation and immutable history writes through actual restricted roles',
] as const;
export const PERIOD_SETTINGS_CONTEXT_FULL_NAMES = PERIOD_SETTINGS_CONTEXT_TESTS.map(name => PERIOD_SETTINGS_CONTEXT_SUITE + ' > ' + name);
export const PERIOD_SETTINGS_CONTEXT_PATTERN = closedPattern(PERIOD_SETTINGS_CONTEXT_FULL_NAMES);
export const PERIOD_INVENTORY_PROFILE = 'data-period-inventory-v1';
export const PERIOD_INVENTORY_MODULE = 'integration/period-inventory.integration-case.ts';
// New six-case CP8 fixture; execution requires independent exact-source review and a separate allowance.
export const PERIOD_INVENTORY_SOURCE_DIGEST = '87204fdc856c2d1e90a589c342a1335f0fc11f95cc2fc9ea13ca58dfed428e09';
export const PERIOD_INVENTORY_SUITE = 'bounded current season period inventory through restricted PostgreSQL';
export const PERIOD_INVENTORY_TESTS = [
  'validates full inventory scope and preserves legacy omitted empty and exact selectors before admission',
  'rolls back a witnessed late inventory write then accounts for one thousand leagues and all admitted period tasks',
  'records an ordinary empty discovery as zero inventory without invented period availability',
  'resumes representative ordinary captures and refresh while retaining the full eighteen task inventories',
  'preserves immutable task capture and cycle history across replay scope CAS and current source fences',
  'denies direct inventory mutations and private helpers and preserves restricted grants through reprovisioning',
] as const;
export const PERIOD_INVENTORY_FULL_NAMES = PERIOD_INVENTORY_TESTS.map(name => PERIOD_INVENTORY_SUITE + ' > ' + name);
export const PERIOD_INVENTORY_PATTERN = closedPattern(PERIOD_INVENTORY_FULL_NAMES);
export const TEAM_MANAGER_FACTS_PROFILE = 'data-team-manager-facts-v1';
export const TEAM_MANAGER_FACTS_MODULE = 'integration/team-manager-facts.integration-case.ts';
// New nine-case CP7 fixture; execution requires independent exact-source review and a separate allowance.
export const TEAM_MANAGER_FACTS_SOURCE_DIGEST = 'cf206755ad34e916cb9606eb9c12259340ef3f603362c2f87d2299a52c0e058d';
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
// Reviewed original nine cases plus six Slice A cases; changed bytes require independent review and an explicit re-pin.
export const ROSTER_PLAYER_LINKS_SOURCE_DIGEST = '8af7186b26068c4346cdaf7a28f9933167768446e378dbf486aab2f020e878ca';
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
  'Slice A preserves legacy reads and measures 32 matched unchanged captures with shared immutable content',
  'Slice A preserves correction provenance exact replay mapping revisions and directory boundaries',
  'Slice A rejects late members collisions history mutation and unauthorized shared storage access',
  'Slice A preserves null directory empty membership and fresh receipt semantics without changing public version',
  'Slice A rolls back shared state after observed identity waits outlive deadline or lease',
  'Slice A reuses the committed shared winner after a real concurrent acceptance wait',
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
export type QualificationProfile = 'full' | typeof CANONICAL_STANDINGS_PROFILE | typeof STORAGE_MEASUREMENT_PROFILE | typeof READER_PERFORMANCE_PROFILE | 'data-freshness-capacity-ownership-v1' | 'data-live-public-batch-v1' | 'data-freshness-capacity-daily-v1' | 'data-freshness-capacity-healthy-v1' | 'data-freshness-capacity-recovery-v1' | typeof BATCH_CALIBRATION_PROFILE | typeof SELECTED_PROFILE | typeof INGESTION_PROFILE | typeof LIVE_PROFILE | typeof JOURNEY_PROFILE | typeof OFFICIAL_PROFILE | typeof GUARDS_PROFILE | typeof CONCURRENCY_PROFILE | typeof LATE_WRITE_PROFILE
  | typeof RUNNER_CYCLES_PROFILE | typeof BACKEND_CONTROLS_PROFILE | typeof COMPETING_WORKERS_PROFILE | typeof PROCESS_RECOVERY_PROFILE | typeof FRESH_INSTALL_PROFILE | typeof WITHIN_SEASON_HISTORY_PROFILE | typeof DRAFT_INTAKE_PROFILE | typeof DRAFT_REFRESH_PROFILE | typeof DRAFT_INTAKE_RECOVERY_PROFILE | typeof TRADED_PICKS_PROFILE | typeof DRAFT_SELECTIONS_PROFILE | typeof DRAFT_METADATA_PROFILE | typeof OFFICIAL_RESULTS_PLAYED_PROFILE | typeof TRANSACTION_HISTORY_INTAKE_PROFILE | typeof TRANSACTION_HISTORY_REFRESH_PROFILE | typeof TRANSACTION_HISTORY_RECOVERY_PROFILE | typeof TRANSACTION_PERIOD_INTAKE_PROFILE | typeof WEEKLY_REPORTS_PROFILE | typeof OFFICIAL_RESULTS_EVIDENCE_PROFILE | typeof OFFICIAL_RESULTS_PROFILE | typeof BRACKET_INTAKE_PROFILE | typeof TYPED_BRACKETS_PROFILE | typeof EXACT_MATCHUP_VALUES_PROFILE | typeof PERIOD_SETTINGS_CONTEXT_PROFILE | typeof PERIOD_INVENTORY_PROFILE | typeof TEAM_MANAGER_FACTS_PROFILE | typeof ROSTER_PLAYER_LINKS_PROFILE | typeof LIVE_PLAYER_DIRECTORY_PROFILE | typeof PLAYER_DIRECTORY_PROFILE | typeof CORE_COMPATIBILITY_PROFILE | typeof INTAKE_RECOVERY_PROFILE | typeof REFRESH_HISTORY_PROFILE | typeof PERIOD_RECOVERY_PROFILE | typeof PERIOD_EXHAUSTION_PROFILE;
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
  if (profile === CANONICAL_STANDINGS_PROFILE) return { names: CANONICAL_STANDINGS_FULL_NAMES, pattern: CANONICAL_STANDINGS_PATTERN };
  if (profile === STORAGE_MEASUREMENT_PROFILE) return { names: STORAGE_MEASUREMENT_FULL_NAMES, pattern: STORAGE_MEASUREMENT_PATTERN };
  const fleet=fleetProfile(profile);if(fleet)return{names:fleet.names,pattern:fleet.pattern};
  if (profile === READER_PERFORMANCE_PROFILE) return { names: READER_PERFORMANCE_FULL_NAMES, pattern: READER_PERFORMANCE_PATTERN };
  if (profile === BATCH_CALIBRATION_PROFILE) return { names: BATCH_CALIBRATION_FULL_NAMES, pattern: BATCH_CALIBRATION_PATTERN };
  if (profile === RUNNER_CYCLES_PROFILE) return { names: RUNNER_CYCLES_FULL_NAMES, pattern: RUNNER_CYCLES_PATTERN };
  if (profile === BACKEND_CONTROLS_PROFILE) return { names: BACKEND_CONTROLS_FULL_NAMES, pattern: BACKEND_CONTROLS_PATTERN };
  if (profile === COMPETING_WORKERS_PROFILE) return { names: COMPETING_WORKERS_FULL_NAMES, pattern: COMPETING_WORKERS_PATTERN };
  if (profile === PROCESS_RECOVERY_PROFILE) return { names: PROCESS_RECOVERY_FULL_NAMES, pattern: PROCESS_RECOVERY_PATTERN };
  if (profile === FRESH_INSTALL_PROFILE) return { names: FRESH_INSTALL_FULL_NAMES, pattern: FRESH_INSTALL_PATTERN };
  if (profile === WITHIN_SEASON_HISTORY_PROFILE) return { names: WITHIN_SEASON_HISTORY_FULL_NAMES, pattern: WITHIN_SEASON_HISTORY_PATTERN };
  if (profile === DRAFT_INTAKE_PROFILE) return { names: DRAFT_INTAKE_FULL_NAMES, pattern: DRAFT_INTAKE_PATTERN };
  if (profile === DRAFT_REFRESH_PROFILE) return { names: DRAFT_REFRESH_FULL_NAMES, pattern: DRAFT_REFRESH_PATTERN };
  if (profile === DRAFT_INTAKE_RECOVERY_PROFILE) return { names: DRAFT_INTAKE_RECOVERY_FULL_NAMES, pattern: DRAFT_INTAKE_RECOVERY_PATTERN };
  if (profile === TRADED_PICKS_PROFILE) return { names: TRADED_PICKS_FULL_NAMES, pattern: TRADED_PICKS_PATTERN };
  if (profile === DRAFT_SELECTIONS_PROFILE) return { names: DRAFT_SELECTIONS_FULL_NAMES, pattern: DRAFT_SELECTIONS_PATTERN };
  if (profile === DRAFT_METADATA_PROFILE) return { names: DRAFT_METADATA_FULL_NAMES, pattern: DRAFT_METADATA_PATTERN };
  if (profile === TRANSACTION_HISTORY_INTAKE_PROFILE) return { names: TRANSACTION_HISTORY_INTAKE_FULL_NAMES, pattern: TRANSACTION_HISTORY_INTAKE_PATTERN };
  if (profile === TRANSACTION_HISTORY_REFRESH_PROFILE) return { names: TRANSACTION_HISTORY_REFRESH_FULL_NAMES, pattern: TRANSACTION_HISTORY_REFRESH_PATTERN };
  if (profile === TRANSACTION_HISTORY_RECOVERY_PROFILE) return { names: TRANSACTION_HISTORY_RECOVERY_FULL_NAMES, pattern: TRANSACTION_HISTORY_RECOVERY_PATTERN };
  if (profile === TRANSACTION_PERIOD_INTAKE_PROFILE) return { names: TRANSACTION_PERIOD_INTAKE_FULL_NAMES, pattern: TRANSACTION_PERIOD_INTAKE_PATTERN };
  if (profile === OFFICIAL_RESULTS_PLAYED_PROFILE) return { names: OFFICIAL_RESULTS_PLAYED_FULL_NAMES, pattern: OFFICIAL_RESULTS_PLAYED_PATTERN };
  if (profile === WEEKLY_REPORTS_PROFILE) return { names: WEEKLY_REPORTS_FULL_NAMES, pattern: WEEKLY_REPORTS_PATTERN };
  if (profile === OFFICIAL_RESULTS_EVIDENCE_PROFILE) return { names: OFFICIAL_RESULTS_EVIDENCE_FULL_NAMES, pattern: OFFICIAL_RESULTS_EVIDENCE_PATTERN };
  if (profile === OFFICIAL_RESULTS_PROFILE) return { names: OFFICIAL_RESULTS_FULL_NAMES, pattern: OFFICIAL_RESULTS_PATTERN };
  if (profile === BRACKET_INTAKE_PROFILE) return { names: BRACKET_INTAKE_FULL_NAMES, pattern: BRACKET_INTAKE_PATTERN };
  if (profile === TYPED_BRACKETS_PROFILE) return { names: TYPED_BRACKETS_FULL_NAMES, pattern: TYPED_BRACKETS_PATTERN };
  if (profile === EXACT_MATCHUP_VALUES_PROFILE) return { names: EXACT_MATCHUP_VALUES_FULL_NAMES, pattern: EXACT_MATCHUP_VALUES_PATTERN };
  if (profile === PERIOD_SETTINGS_CONTEXT_PROFILE) return { names: PERIOD_SETTINGS_CONTEXT_FULL_NAMES, pattern: PERIOD_SETTINGS_CONTEXT_PATTERN };
  if (profile === PERIOD_INVENTORY_PROFILE) return { names: PERIOD_INVENTORY_FULL_NAMES, pattern: PERIOD_INVENTORY_PATTERN };
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
  if (profile === CANONICAL_STANDINGS_PROFILE) return CANONICAL_STANDINGS_MODULE;
  if (profile === STORAGE_MEASUREMENT_PROFILE) return STORAGE_MEASUREMENT_MODULE;
  const fleet=fleetProfile(profile);if(fleet)return fleet.module;
  if (profile === READER_PERFORMANCE_PROFILE) return READER_PERFORMANCE_MODULE;
  if (profile === BATCH_CALIBRATION_PROFILE) return BATCH_CALIBRATION_MODULE;
  if (profile === RUNNER_CYCLES_PROFILE) return RUNNER_CYCLES_MODULE;
  if (profile === BACKEND_CONTROLS_PROFILE) return BACKEND_CONTROLS_MODULE;
  if (profile === COMPETING_WORKERS_PROFILE) return COMPETING_WORKERS_MODULE;
  if (profile === PROCESS_RECOVERY_PROFILE) return PROCESS_RECOVERY_MODULE;
  if (profile === FRESH_INSTALL_PROFILE) return FRESH_INSTALL_MODULE;
  if (profile === WITHIN_SEASON_HISTORY_PROFILE) return WITHIN_SEASON_HISTORY_MODULE;
  if (profile === DRAFT_INTAKE_PROFILE) return DRAFT_INTAKE_MODULE;
  if (profile === DRAFT_REFRESH_PROFILE) return DRAFT_REFRESH_MODULE;
  if (profile === DRAFT_INTAKE_RECOVERY_PROFILE) return DRAFT_INTAKE_RECOVERY_MODULE;
  if (profile === TRADED_PICKS_PROFILE) return TRADED_PICKS_MODULE;
  if (profile === DRAFT_SELECTIONS_PROFILE) return DRAFT_SELECTIONS_MODULE;
  if (profile === DRAFT_METADATA_PROFILE) return DRAFT_METADATA_MODULE;
  if (profile === TRANSACTION_HISTORY_INTAKE_PROFILE) return TRANSACTION_HISTORY_INTAKE_MODULE;
  if (profile === TRANSACTION_HISTORY_REFRESH_PROFILE) return TRANSACTION_HISTORY_REFRESH_MODULE;
  if (profile === TRANSACTION_HISTORY_RECOVERY_PROFILE) return TRANSACTION_HISTORY_RECOVERY_MODULE;
  if (profile === TRANSACTION_PERIOD_INTAKE_PROFILE) return TRANSACTION_PERIOD_INTAKE_MODULE;
  if (profile === OFFICIAL_RESULTS_PLAYED_PROFILE) return OFFICIAL_RESULTS_MODULE;
  return profile === WEEKLY_REPORTS_PROFILE ? WEEKLY_REPORTS_MODULE : profile === OFFICIAL_RESULTS_EVIDENCE_PROFILE ? OFFICIAL_RESULTS_EVIDENCE_MODULE : profile === OFFICIAL_RESULTS_PROFILE ? OFFICIAL_RESULTS_MODULE : profile === BRACKET_INTAKE_PROFILE ? BRACKET_INTAKE_MODULE : profile === TYPED_BRACKETS_PROFILE ? TYPED_BRACKETS_MODULE : profile === EXACT_MATCHUP_VALUES_PROFILE ? EXACT_MATCHUP_VALUES_MODULE : profile === PERIOD_SETTINGS_CONTEXT_PROFILE ? PERIOD_SETTINGS_CONTEXT_MODULE : profile === PERIOD_INVENTORY_PROFILE ? PERIOD_INVENTORY_MODULE : profile === TEAM_MANAGER_FACTS_PROFILE ? TEAM_MANAGER_FACTS_MODULE : profile === ROSTER_PLAYER_LINKS_PROFILE ? ROSTER_PLAYER_LINKS_MODULE : profile === LIVE_PLAYER_DIRECTORY_PROFILE ? LIVE_PLAYER_DIRECTORY_MODULE : profile === PLAYER_DIRECTORY_PROFILE ? PLAYER_DIRECTORY_MODULE : profile === JOURNEY_PROFILE ? JOURNEY_MODULE : profile === LIVE_PROFILE ? LIVE_MODULE : SELECTED_MODULE;
}
function selectedDigest(profile: QualificationProfile) {
  if (profile === CANONICAL_STANDINGS_PROFILE) return CANONICAL_STANDINGS_SOURCE_DIGEST;
  if (profile === STORAGE_MEASUREMENT_PROFILE) return STORAGE_MEASUREMENT_SOURCE_DIGEST;
  const fleet=fleetProfile(profile);if(fleet)return fleet.sourceDigest;
  if (profile === READER_PERFORMANCE_PROFILE) return READER_PERFORMANCE_SOURCE_DIGEST;
  if (profile === BATCH_CALIBRATION_PROFILE) return BATCH_CALIBRATION_SOURCE_DIGEST;
  if (profile === RUNNER_CYCLES_PROFILE) return RUNNER_CYCLES_SOURCE_DIGEST;
  if (profile === BACKEND_CONTROLS_PROFILE) return BACKEND_CONTROLS_SOURCE_DIGEST;
  if (profile === COMPETING_WORKERS_PROFILE) return COMPETING_WORKERS_SOURCE_DIGEST;
  if (profile === PROCESS_RECOVERY_PROFILE) return PROCESS_RECOVERY_SOURCE_DIGEST;
  if (profile === FRESH_INSTALL_PROFILE) return FRESH_INSTALL_SOURCE_DIGEST;
  if (profile === WITHIN_SEASON_HISTORY_PROFILE) return WITHIN_SEASON_HISTORY_SOURCE_DIGEST;
  if (profile === DRAFT_INTAKE_PROFILE) return DRAFT_INTAKE_SOURCE_DIGEST;
  if (profile === DRAFT_REFRESH_PROFILE) return DRAFT_REFRESH_SOURCE_DIGEST;
  if (profile === DRAFT_INTAKE_RECOVERY_PROFILE) return DRAFT_INTAKE_RECOVERY_SOURCE_DIGEST;
  if (profile === TRADED_PICKS_PROFILE) return TRADED_PICKS_SOURCE_DIGEST;
  if (profile === DRAFT_SELECTIONS_PROFILE) return DRAFT_SELECTIONS_SOURCE_DIGEST;
  if (profile === DRAFT_METADATA_PROFILE) return DRAFT_METADATA_SOURCE_DIGEST;
  if (profile === TRANSACTION_HISTORY_INTAKE_PROFILE) return TRANSACTION_HISTORY_INTAKE_SOURCE_DIGEST;
  if (profile === TRANSACTION_HISTORY_REFRESH_PROFILE) return TRANSACTION_HISTORY_REFRESH_SOURCE_DIGEST;
  if (profile === TRANSACTION_HISTORY_RECOVERY_PROFILE) return TRANSACTION_HISTORY_RECOVERY_SOURCE_DIGEST;
  if (profile === TRANSACTION_PERIOD_INTAKE_PROFILE) return TRANSACTION_PERIOD_INTAKE_SOURCE_DIGEST;
  if (profile === OFFICIAL_RESULTS_PLAYED_PROFILE) return OFFICIAL_RESULTS_SOURCE_DIGEST;
  return profile === WEEKLY_REPORTS_PROFILE ? WEEKLY_REPORTS_SOURCE_DIGEST : profile === OFFICIAL_RESULTS_EVIDENCE_PROFILE ? OFFICIAL_RESULTS_EVIDENCE_SOURCE_DIGEST : profile === OFFICIAL_RESULTS_PROFILE ? OFFICIAL_RESULTS_SOURCE_DIGEST : profile === BRACKET_INTAKE_PROFILE ? BRACKET_INTAKE_SOURCE_DIGEST : profile === TYPED_BRACKETS_PROFILE ? TYPED_BRACKETS_SOURCE_DIGEST : profile === EXACT_MATCHUP_VALUES_PROFILE ? EXACT_MATCHUP_VALUES_SOURCE_DIGEST : profile === PERIOD_SETTINGS_CONTEXT_PROFILE ? PERIOD_SETTINGS_CONTEXT_SOURCE_DIGEST : profile === PERIOD_INVENTORY_PROFILE ? PERIOD_INVENTORY_SOURCE_DIGEST : profile === TEAM_MANAGER_FACTS_PROFILE ? TEAM_MANAGER_FACTS_SOURCE_DIGEST : profile === ROSTER_PLAYER_LINKS_PROFILE ? ROSTER_PLAYER_LINKS_SOURCE_DIGEST : profile === LIVE_PLAYER_DIRECTORY_PROFILE ? LIVE_PLAYER_DIRECTORY_SOURCE_DIGEST : profile === PLAYER_DIRECTORY_PROFILE ? PLAYER_DIRECTORY_SOURCE_DIGEST : profile === JOURNEY_PROFILE ? JOURNEY_SOURCE_DIGEST : profile === LIVE_PROFILE ? LIVE_SOURCE_DIGEST : SELECTED_SOURCE_DIGEST;
}
function selectedModules(profile: QualificationProfile) {
  return profile === CORE_COMPATIBILITY_PROFILE ? CORE_COMPATIBILITY_MODULES
    : [{ path: selectedModule(profile), sourceDigest: selectedDigest(profile) }];
}
function selectedInventory(profile: QualificationProfile, path?: string): readonly string[] {
  if (profile === CANONICAL_STANDINGS_PROFILE) return CANONICAL_STANDINGS_FULL_NAMES;
  if (profile === STORAGE_MEASUREMENT_PROFILE) return STORAGE_MEASUREMENT_FULL_NAMES;
  const fleet=fleetProfile(profile);if(fleet)return fleet.names;
  if (profile === READER_PERFORMANCE_PROFILE) return READER_PERFORMANCE_FULL_NAMES;
  if (profile === BATCH_CALIBRATION_PROFILE) return BATCH_CALIBRATION_FULL_NAMES;
  if (profile === RUNNER_CYCLES_PROFILE) return RUNNER_CYCLES_FULL_NAMES;
  if (profile === BACKEND_CONTROLS_PROFILE) return BACKEND_CONTROLS_FULL_NAMES;
  if (profile === COMPETING_WORKERS_PROFILE) return COMPETING_WORKERS_FULL_NAMES;
  if (profile === PROCESS_RECOVERY_PROFILE) return PROCESS_RECOVERY_FULL_NAMES;
  if (profile === FRESH_INSTALL_PROFILE) return FRESH_INSTALL_FULL_NAMES;
  if (profile === WITHIN_SEASON_HISTORY_PROFILE) return WITHIN_SEASON_HISTORY_FULL_NAMES;
  if (profile === DRAFT_INTAKE_PROFILE) return DRAFT_INTAKE_FULL_NAMES;
  if (profile === DRAFT_REFRESH_PROFILE) return DRAFT_REFRESH_FULL_NAMES;
  if (profile === DRAFT_INTAKE_RECOVERY_PROFILE) return DRAFT_INTAKE_RECOVERY_FULL_NAMES;
  if (profile === TRADED_PICKS_PROFILE) return TRADED_PICKS_FULL_NAMES;
  if (profile === DRAFT_SELECTIONS_PROFILE) return DRAFT_SELECTIONS_FULL_NAMES;
  if (profile === DRAFT_METADATA_PROFILE) return DRAFT_METADATA_FULL_NAMES;
  if (profile === TRANSACTION_HISTORY_INTAKE_PROFILE) return TRANSACTION_HISTORY_INTAKE_FULL_NAMES;
  if (profile === TRANSACTION_HISTORY_REFRESH_PROFILE) return TRANSACTION_HISTORY_REFRESH_FULL_NAMES;
  if (profile === TRANSACTION_HISTORY_RECOVERY_PROFILE) return TRANSACTION_HISTORY_RECOVERY_FULL_NAMES;
  if (profile === TRANSACTION_PERIOD_INTAKE_PROFILE) return TRANSACTION_PERIOD_INTAKE_FULL_NAMES;
  if (profile === OFFICIAL_RESULTS_PLAYED_PROFILE) return OFFICIAL_RESULTS_FULL_NAMES;
  if (profile === CORE_COMPATIBILITY_PROFILE) {
    const spec = CORE_COMPATIBILITY_MODULES.find(module => module.path === path);
    assert(spec, 'Unexpected core compatibility module.'); return spec.inventory;
  }
  return profile === WEEKLY_REPORTS_PROFILE ? WEEKLY_REPORTS_FULL_NAMES : profile === OFFICIAL_RESULTS_EVIDENCE_PROFILE ? OFFICIAL_RESULTS_EVIDENCE_FULL_NAMES : profile === OFFICIAL_RESULTS_PROFILE ? OFFICIAL_RESULTS_FULL_NAMES : profile === BRACKET_INTAKE_PROFILE ? BRACKET_INTAKE_FULL_NAMES : profile === TYPED_BRACKETS_PROFILE ? TYPED_BRACKETS_FULL_NAMES : profile === EXACT_MATCHUP_VALUES_PROFILE ? EXACT_MATCHUP_VALUES_FULL_NAMES : profile === PERIOD_SETTINGS_CONTEXT_PROFILE ? PERIOD_SETTINGS_CONTEXT_FULL_NAMES : profile === PERIOD_INVENTORY_PROFILE ? PERIOD_INVENTORY_FULL_NAMES : profile === TEAM_MANAGER_FACTS_PROFILE ? TEAM_MANAGER_FACTS_FULL_NAMES : profile === ROSTER_PLAYER_LINKS_PROFILE ? ROSTER_PLAYER_LINKS_FULL_NAMES : profile === LIVE_PLAYER_DIRECTORY_PROFILE ? [LIVE_PLAYER_DIRECTORY_FULL_NAME] : profile === PLAYER_DIRECTORY_PROFILE ? PLAYER_DIRECTORY_FULL_NAMES : profile === JOURNEY_PROFILE ? [JOURNEY_FULL_NAME] : profile === LIVE_PROFILE ? [LIVE_FULL_NAME] : SELECTED_INVENTORY;
}
function profileDigest(profile: QualificationProfile) {
  if (profile === CANONICAL_STANDINGS_PROFILE) return qualificationDigest({ version: 1, profile,
    module: CANONICAL_STANDINGS_MODULE, pattern: CANONICAL_STANDINGS_PATTERN, sourceDigest: CANONICAL_STANDINGS_SOURCE_DIGEST,
    inventory: CANONICAL_STANDINGS_FULL_NAMES, supportSources: CANONICAL_STANDINGS_SUPPORT_SOURCES,
    caseTimeoutsMs: CANONICAL_STANDINGS_CASE_TIMEOUTS_MS, beforeAllMs: CANONICAL_STANDINGS_BEFORE_ALL_MS,
    afterAllMs: CANONICAL_STANDINGS_AFTER_ALL_MS, limits: CANONICAL_STANDINGS_LIMITS });
  if (profile === STORAGE_MEASUREMENT_PROFILE) return qualificationDigest({ version: 1, profile, module: STORAGE_MEASUREMENT_MODULE, pattern: STORAGE_MEASUREMENT_PATTERN, sourceDigest: STORAGE_MEASUREMENT_SOURCE_DIGEST, inventory: STORAGE_MEASUREMENT_FULL_NAMES, supportSources: STORAGE_MEASUREMENT_SUPPORT_SOURCES });
  const fleet=fleetProfile(profile);if(fleet)return qualificationDigest({version:1,profile,module:fleet.module,pattern:fleet.pattern,sourceDigest:fleet.sourceDigest,inventory:fleet.names,supportSources:FLEET_SUPPORT_SOURCES});
  if (profile === READER_PERFORMANCE_PROFILE) return qualificationDigest({ version: 1, profile,
    module: READER_PERFORMANCE_MODULE, pattern: READER_PERFORMANCE_PATTERN, sourceDigest: READER_PERFORMANCE_SOURCE_DIGEST,
    inventory: READER_PERFORMANCE_FULL_NAMES, supportSources: READER_PERFORMANCE_SUPPORT_SOURCES });
  if (profile === BATCH_CALIBRATION_PROFILE) return qualificationDigest({ version: 1, profile,
    module: BATCH_CALIBRATION_MODULE, pattern: BATCH_CALIBRATION_PATTERN, sourceDigest: BATCH_CALIBRATION_SOURCE_DIGEST,
    inventory: BATCH_CALIBRATION_FULL_NAMES, supportSources: BATCH_CALIBRATION_SUPPORT_SOURCES });
  if (profile === RUNNER_CYCLES_PROFILE) return qualificationDigest({ version: 1, profile,
    module: RUNNER_CYCLES_MODULE, pattern: RUNNER_CYCLES_PATTERN, sourceDigest: RUNNER_CYCLES_SOURCE_DIGEST,
    inventory: RUNNER_CYCLES_FULL_NAMES, supportSources: RUNNER_CYCLES_SUPPORT_SOURCES });
  if (profile === BACKEND_CONTROLS_PROFILE) return qualificationDigest({ profile, module: BACKEND_CONTROLS_MODULE,
    pattern: BACKEND_CONTROLS_PATTERN, sourceDigest: BACKEND_CONTROLS_SOURCE_DIGEST, inventory: BACKEND_CONTROLS_FULL_NAMES,
    supportSources: BACKEND_CONTROLS_SUPPORT_SOURCES });
  if (profile === COMPETING_WORKERS_PROFILE) return qualificationDigest({ version: 1, profile,
    module: COMPETING_WORKERS_MODULE, pattern: COMPETING_WORKERS_PATTERN, sourceDigest: COMPETING_WORKERS_SOURCE_DIGEST,
    inventory: COMPETING_WORKERS_FULL_NAMES, supportSources: COMPETING_WORKERS_SUPPORT_SOURCES });
  if (profile === PROCESS_RECOVERY_PROFILE) return qualificationDigest({ version: 1, profile,
    module: PROCESS_RECOVERY_MODULE, pattern: PROCESS_RECOVERY_PATTERN, sourceDigest: PROCESS_RECOVERY_SOURCE_DIGEST,
    inventory: PROCESS_RECOVERY_FULL_NAMES, supportSources: PROCESS_RECOVERY_SUPPORT_SOURCES });
  if (profile === CORE_COMPATIBILITY_PROFILE) return qualificationDigest({ version: 1, profile,
    modules: CORE_COMPATIBILITY_MODULES, pattern: CORE_COMPATIBILITY_PATTERN });
  return qualificationDigest({ version: 1, profile, module: profile === 'full' ? null : selectedModule(profile),
    pattern: profile === 'full' ? null : selectedCase(profile).pattern, sourceDigest: profile === 'full' ? null : selectedDigest(profile), inventory: profile === 'full' ? null : selectedInventory(profile) });
}
export function parseQualificationArguments(args: readonly string[]): QualificationProfile {
  if (args.length === 1 && args[0] === '--profile=' + CANONICAL_STANDINGS_PROFILE) return CANONICAL_STANDINGS_PROFILE;
  if(args.length===1){for(const profile of [FLEET_HEALTHY_PROFILE,FLEET_RECOVERY_PROFILE,FLEET_DAILY_PROFILE,FLEET_LIVE_PROFILE,FLEET_OWNERSHIP_PROFILE] as const)if(args[0]==='--profile='+profile)return profile;}
  if (args.length === 1 && args[0] === '--profile=' + STORAGE_MEASUREMENT_PROFILE) return STORAGE_MEASUREMENT_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + READER_PERFORMANCE_PROFILE) return READER_PERFORMANCE_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + BATCH_CALIBRATION_PROFILE) return BATCH_CALIBRATION_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + RUNNER_CYCLES_PROFILE) return RUNNER_CYCLES_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + BACKEND_CONTROLS_PROFILE) return BACKEND_CONTROLS_PROFILE;
  if (!args.length) return 'full';
  if (args.length === 1 && args[0] === '--profile=' + COMPETING_WORKERS_PROFILE) return COMPETING_WORKERS_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + PROCESS_RECOVERY_PROFILE) return PROCESS_RECOVERY_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + FRESH_INSTALL_PROFILE) return FRESH_INSTALL_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + WITHIN_SEASON_HISTORY_PROFILE) return WITHIN_SEASON_HISTORY_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + OFFICIAL_RESULTS_PLAYED_PROFILE) return OFFICIAL_RESULTS_PLAYED_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + DRAFT_INTAKE_PROFILE) return DRAFT_INTAKE_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + DRAFT_REFRESH_PROFILE) return DRAFT_REFRESH_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + DRAFT_INTAKE_RECOVERY_PROFILE) return DRAFT_INTAKE_RECOVERY_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + TRADED_PICKS_PROFILE) return TRADED_PICKS_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + DRAFT_SELECTIONS_PROFILE) return DRAFT_SELECTIONS_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + DRAFT_METADATA_PROFILE) return DRAFT_METADATA_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + TRANSACTION_HISTORY_INTAKE_PROFILE) return TRANSACTION_HISTORY_INTAKE_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + TRANSACTION_HISTORY_REFRESH_PROFILE) return TRANSACTION_HISTORY_REFRESH_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + TRANSACTION_HISTORY_RECOVERY_PROFILE) return TRANSACTION_HISTORY_RECOVERY_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + TRANSACTION_PERIOD_INTAKE_PROFILE) return TRANSACTION_PERIOD_INTAKE_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + WEEKLY_REPORTS_PROFILE) return WEEKLY_REPORTS_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + OFFICIAL_RESULTS_EVIDENCE_PROFILE) return OFFICIAL_RESULTS_EVIDENCE_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + OFFICIAL_RESULTS_PROFILE) return OFFICIAL_RESULTS_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + BRACKET_INTAKE_PROFILE) return BRACKET_INTAKE_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + TYPED_BRACKETS_PROFILE) return TYPED_BRACKETS_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + EXACT_MATCHUP_VALUES_PROFILE) return EXACT_MATCHUP_VALUES_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + PERIOD_SETTINGS_CONTEXT_PROFILE) return PERIOD_SETTINGS_CONTEXT_PROFILE;
  if (args.length === 1 && args[0] === '--profile=' + PERIOD_INVENTORY_PROFILE) return PERIOD_INVENTORY_PROFILE;
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
  throw new Error('Only the closed data-reader-performance-v1, data-batch-calibration-v1, data-runner-cycles-v1, data-backend-controls-v1, data-competing-workers-v1, data-process-recovery-v1, data-fresh-install-v1, data-within-season-history-v1, data-traded-picks-v1, data-draft-selections-v1, data-draft-metadata-v1, data-transaction-history-intake-v1, data-transaction-history-refresh-v1, data-transaction-history-recovery-v1, data-transaction-period-intake-v1, data-official-results-played-v1, data-weekly-reports-v1, data-official-results-evidence-v1, data-official-results-v1, data-bracket-intake-v1, data-typed-brackets-v1, data-exact-matchup-values-v1, data-period-settings-context-v1, data-period-inventory-v1, data-team-manager-facts-v1, data-roster-player-links-v1, data-live-player-directory-v1, data-player-directory-v1, data-core-compatibility-v1, data-intake-recovery-v1, data-refresh-history-v1, data-period-recovery-v1, data-period-exhaustion-v1, data-late-write-rollback-v1, data-refresh-concurrency-v1, data-ingestion-guards-v1, data-official-preconfiguration-v1, data-live-public-intake-v1, data-live-league-two-v1, data-core-refresh-v1 and data-core-ingestion-v1 qualification selectors are accepted.');
}
export function qualificationArguments(profile: QualificationProfile, reporter: string): string[] {
  assert(profile === CANONICAL_STANDINGS_PROFILE || fleetProfile(profile)!==null || profile === STORAGE_MEASUREMENT_PROFILE || profile === READER_PERFORMANCE_PROFILE || profile === BATCH_CALIBRATION_PROFILE || profile === RUNNER_CYCLES_PROFILE || profile === BACKEND_CONTROLS_PROFILE || profile === COMPETING_WORKERS_PROFILE || profile === PROCESS_RECOVERY_PROFILE || profile === FRESH_INSTALL_PROFILE || profile === WITHIN_SEASON_HISTORY_PROFILE || profile === DRAFT_INTAKE_PROFILE || profile === DRAFT_REFRESH_PROFILE || profile === DRAFT_INTAKE_RECOVERY_PROFILE || profile === TRADED_PICKS_PROFILE || profile === DRAFT_SELECTIONS_PROFILE || profile === DRAFT_METADATA_PROFILE || profile === TRANSACTION_HISTORY_RECOVERY_PROFILE || profile === TRANSACTION_HISTORY_REFRESH_PROFILE || profile === TRANSACTION_HISTORY_INTAKE_PROFILE || profile === 'full' || profile === TRANSACTION_PERIOD_INTAKE_PROFILE || profile === OFFICIAL_RESULTS_PLAYED_PROFILE || profile === WEEKLY_REPORTS_PROFILE || profile === OFFICIAL_RESULTS_EVIDENCE_PROFILE || profile === OFFICIAL_RESULTS_PROFILE || profile === BRACKET_INTAKE_PROFILE || profile === TYPED_BRACKETS_PROFILE || profile === EXACT_MATCHUP_VALUES_PROFILE || profile === PERIOD_SETTINGS_CONTEXT_PROFILE || profile === PERIOD_INVENTORY_PROFILE || profile === TEAM_MANAGER_FACTS_PROFILE || profile === ROSTER_PLAYER_LINKS_PROFILE || profile === LIVE_PLAYER_DIRECTORY_PROFILE || profile === PLAYER_DIRECTORY_PROFILE || profile === CORE_COMPATIBILITY_PROFILE || profile === SELECTED_PROFILE || profile === INGESTION_PROFILE || profile === LIVE_PROFILE || profile === JOURNEY_PROFILE || profile === OFFICIAL_PROFILE || profile === GUARDS_PROFILE || profile === CONCURRENCY_PROFILE || profile === LATE_WRITE_PROFILE || CLOSEOUT_PROFILES.some(selection => selection.profile === profile), 'Unknown qualification profile.');
  return ['--reporter', 'verbose', '--reporter', reporter,
    // Preserve deferred server-only validator imports while loading these selected profiles.
    ...(profile === CANONICAL_STANDINGS_PROFILE || profile === FLEET_LIVE_PROFILE || profile === FLEET_OWNERSHIP_PROFILE || profile === STORAGE_MEASUREMENT_PROFILE || profile === READER_PERFORMANCE_PROFILE ? ['--configLoader', 'runner'] : []),
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
  assert(value.profile === CANONICAL_STANDINGS_PROFILE || fleetProfile(value.profile)!==null || value.profile === STORAGE_MEASUREMENT_PROFILE || value.profile === READER_PERFORMANCE_PROFILE || value.profile === BATCH_CALIBRATION_PROFILE || value.profile === RUNNER_CYCLES_PROFILE || value.profile === BACKEND_CONTROLS_PROFILE || value.profile === COMPETING_WORKERS_PROFILE || value.profile === PROCESS_RECOVERY_PROFILE || value.profile === FRESH_INSTALL_PROFILE || value.profile === WITHIN_SEASON_HISTORY_PROFILE || value.profile === DRAFT_INTAKE_PROFILE || value.profile === DRAFT_REFRESH_PROFILE || value.profile === DRAFT_INTAKE_RECOVERY_PROFILE || value.profile === TRADED_PICKS_PROFILE || value.profile === DRAFT_SELECTIONS_PROFILE || value.profile === DRAFT_METADATA_PROFILE || value.profile === TRANSACTION_HISTORY_RECOVERY_PROFILE || value.profile === TRANSACTION_HISTORY_REFRESH_PROFILE || value.profile === TRANSACTION_HISTORY_INTAKE_PROFILE || value.profile === 'full' || value.profile === TRANSACTION_PERIOD_INTAKE_PROFILE || value.profile === OFFICIAL_RESULTS_PLAYED_PROFILE || value.profile === WEEKLY_REPORTS_PROFILE || value.profile === OFFICIAL_RESULTS_EVIDENCE_PROFILE || value.profile === OFFICIAL_RESULTS_PROFILE || value.profile === BRACKET_INTAKE_PROFILE || value.profile === TYPED_BRACKETS_PROFILE || value.profile === EXACT_MATCHUP_VALUES_PROFILE || value.profile === PERIOD_SETTINGS_CONTEXT_PROFILE || value.profile === PERIOD_INVENTORY_PROFILE || value.profile === TEAM_MANAGER_FACTS_PROFILE || value.profile === ROSTER_PLAYER_LINKS_PROFILE || value.profile === LIVE_PLAYER_DIRECTORY_PROFILE || value.profile === PLAYER_DIRECTORY_PROFILE || value.profile === CORE_COMPATIBILITY_PROFILE || value.profile === SELECTED_PROFILE || value.profile === INGESTION_PROFILE || value.profile === LIVE_PROFILE || value.profile === JOURNEY_PROFILE || value.profile === OFFICIAL_PROFILE || value.profile === GUARDS_PROFILE || value.profile === CONCURRENCY_PROFILE || value.profile === LATE_WRITE_PROFILE || CLOSEOUT_PROFILES.some(selection => selection.profile === value.profile));
  assert.equal(value.profileDigest, profileDigest(value.profile));
  assert(Array.isArray(value.modules) && value.modules.length > 0 && value.modules.length <= 128);
  for (const entry of value.modules) {
    exactKeys(entry, ['path', 'sourceDigest']);
    if (fleetProfile(value.profile)) assert.equal(entry.path,fleetProfile(value.profile)!.module);
    else if (value.profile === CANONICAL_STANDINGS_PROFILE) assert.equal(entry.path, CANONICAL_STANDINGS_MODULE);
    else if (value.profile === STORAGE_MEASUREMENT_PROFILE) assert.equal(entry.path, STORAGE_MEASUREMENT_MODULE);
    else if (value.profile === READER_PERFORMANCE_PROFILE) assert.equal(entry.path, READER_PERFORMANCE_MODULE);
    else if (value.profile === BATCH_CALIBRATION_PROFILE) assert.equal(entry.path, BATCH_CALIBRATION_MODULE);
    else if (value.profile === RUNNER_CYCLES_PROFILE) assert.equal(entry.path, RUNNER_CYCLES_MODULE);
    else if (value.profile === BACKEND_CONTROLS_PROFILE) assert.equal(entry.path, BACKEND_CONTROLS_MODULE);
    else if (value.profile === COMPETING_WORKERS_PROFILE) assert.equal(entry.path, COMPETING_WORKERS_MODULE);
    else if (value.profile === PROCESS_RECOVERY_PROFILE) assert.equal(entry.path, PROCESS_RECOVERY_MODULE);
    else if (value.profile === FRESH_INSTALL_PROFILE) assert.equal(entry.path, FRESH_INSTALL_MODULE);
    else assert.match(entry.path, /^integration\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:live-integration-case|integration-case)\.ts$/u);
    assert.match(entry.sourceDigest, /^[0-9a-f]{64}$/u);
  }
  unique(value.modules.map(module => module.path));
  if(fleetProfile(value.profile))assert.equal(value.modules[0].sourceDigest,fleetProfile(value.profile)!.sourceDigest,'Fleet source differs from the reviewed LF digest.');
  if (value.profile === CANONICAL_STANDINGS_PROFILE) assert.equal(value.modules[0].sourceDigest, CANONICAL_STANDINGS_SOURCE_DIGEST, 'Canonical standings source differs from the reviewed LF digest.');
  if (value.profile === STORAGE_MEASUREMENT_PROFILE) assert.equal(value.modules[0].sourceDigest, STORAGE_MEASUREMENT_SOURCE_DIGEST, 'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === READER_PERFORMANCE_PROFILE) assert.equal(value.modules[0].sourceDigest, READER_PERFORMANCE_SOURCE_DIGEST,
    'Reader performance source differs from the reviewed LF digest.');
  if (value.profile === BATCH_CALIBRATION_PROFILE) assert.equal(value.modules[0].sourceDigest, BATCH_CALIBRATION_SOURCE_DIGEST, 'Batch calibration source differs from the reviewed LF digest.');
  if (value.profile === RUNNER_CYCLES_PROFILE) assert.equal(value.modules[0].sourceDigest, RUNNER_CYCLES_SOURCE_DIGEST,
    'Runner cycles source differs from the reviewed LF digest.');
  if (value.profile === BACKEND_CONTROLS_PROFILE) assert.equal(value.modules[0].sourceDigest, BACKEND_CONTROLS_SOURCE_DIGEST, 'Control source differs from the reviewed LF digest.');
  if (value.profile === COMPETING_WORKERS_PROFILE) assert.equal(value.modules[0].sourceDigest, COMPETING_WORKERS_SOURCE_DIGEST,
    'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === PROCESS_RECOVERY_PROFILE) assert.equal(value.modules[0].sourceDigest, PROCESS_RECOVERY_SOURCE_DIGEST,
    'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === FRESH_INSTALL_PROFILE) assert.equal(value.modules[0].sourceDigest, FRESH_INSTALL_SOURCE_DIGEST,
    'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === WITHIN_SEASON_HISTORY_PROFILE) assert.equal(value.modules[0].sourceDigest, WITHIN_SEASON_HISTORY_SOURCE_DIGEST,
    'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === OFFICIAL_RESULTS_PLAYED_PROFILE) assert.equal(value.modules[0].sourceDigest, OFFICIAL_RESULTS_SOURCE_DIGEST,
    'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === DRAFT_INTAKE_PROFILE) assert.equal(value.modules[0].sourceDigest, DRAFT_INTAKE_SOURCE_DIGEST,
    'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === DRAFT_REFRESH_PROFILE) assert.equal(value.modules[0].sourceDigest, DRAFT_REFRESH_SOURCE_DIGEST,
    'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === DRAFT_INTAKE_RECOVERY_PROFILE) assert.equal(value.modules[0].sourceDigest, DRAFT_INTAKE_RECOVERY_SOURCE_DIGEST,
    'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === TRADED_PICKS_PROFILE) assert.equal(value.modules[0].sourceDigest, TRADED_PICKS_SOURCE_DIGEST,
    'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === DRAFT_SELECTIONS_PROFILE) assert.equal(value.modules[0].sourceDigest, DRAFT_SELECTIONS_SOURCE_DIGEST,
    'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === DRAFT_METADATA_PROFILE) assert.equal(value.modules[0].sourceDigest, DRAFT_METADATA_SOURCE_DIGEST,
    'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === TRANSACTION_HISTORY_INTAKE_PROFILE) assert.equal(value.modules[0].sourceDigest, TRANSACTION_HISTORY_INTAKE_SOURCE_DIGEST,
    'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === TRANSACTION_HISTORY_REFRESH_PROFILE) assert.equal(value.modules[0].sourceDigest, TRANSACTION_HISTORY_REFRESH_SOURCE_DIGEST,
    'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === TRANSACTION_HISTORY_RECOVERY_PROFILE) assert.equal(value.modules[0].sourceDigest, TRANSACTION_HISTORY_RECOVERY_SOURCE_DIGEST,
    'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === TRANSACTION_PERIOD_INTAKE_PROFILE) assert.equal(value.modules[0].sourceDigest, TRANSACTION_PERIOD_INTAKE_SOURCE_DIGEST,
    'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === WEEKLY_REPORTS_PROFILE) assert.equal(value.modules[0].sourceDigest, WEEKLY_REPORTS_SOURCE_DIGEST,
    'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === OFFICIAL_RESULTS_EVIDENCE_PROFILE) assert.equal(value.modules[0].sourceDigest, OFFICIAL_RESULTS_EVIDENCE_SOURCE_DIGEST,
    'Selected qualification source differs from the reviewed LF digest.');
  if (value.profile === LIVE_PLAYER_DIRECTORY_PROFILE || value.profile === LIVE_PROFILE || value.profile === JOURNEY_PROFILE) assert.equal(value.modules[0].sourceDigest, selectedDigest(value.profile));
  if (value.profile === 'full') assert(value.modules.every(module => !module.path.endsWith('.live-integration-case.ts')));
  if (value.profile !== 'full') assert.deepEqual(value.modules.map(module => module.path), selectedModules(value.profile).map(module => module.path));
  return value;
}
export async function createQualificationContext(siteRoot: string, gitSha: string, runId: string,
  profile: QualificationProfile = 'full'): Promise<QualificationContext> {
  if(fleetProfile(profile))await assertFleetSupportSources(siteRoot);
  if (profile === CANONICAL_STANDINGS_PROFILE) await assertCanonicalStandingsSupportSources(siteRoot);
  if (profile === STORAGE_MEASUREMENT_PROFILE) await assertStorageMeasurementSupportSources(siteRoot);
  if (profile === READER_PERFORMANCE_PROFILE) await assertReaderPerformanceSupportSources(siteRoot);
  if (profile === BATCH_CALIBRATION_PROFILE) await assertBatchCalibrationSupportSources(siteRoot);
  if (profile === RUNNER_CYCLES_PROFILE) await assertRunnerCyclesSupportSources(siteRoot);
  if (profile === BACKEND_CONTROLS_PROFILE) await assertBackendControlsSupportSources(siteRoot);
  if (profile === COMPETING_WORKERS_PROFILE) await assertCompetingWorkersSupportSources(siteRoot);
  if (profile === PROCESS_RECOVERY_PROFILE) await assertProcessRecoverySupportSources(siteRoot);
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
/** Fixed support files are source-bound without pretending they are collected
 * Vitest modules. The fixture and its worker repeat this check at their launch
 * boundary; the unchanged supervisor also binds the complete clean Git SHA. */
export async function assertProcessRecoverySupportSources(siteRoot: string): Promise<void> {
  for (const entry of PROCESS_RECOVERY_SUPPORT_SOURCES) {
    assert.equal(qualificationSourceDigest(await readFile(join(siteRoot, entry.path), 'utf8')), entry.sourceDigest,
      'Process recovery support source differs from the reviewed LF digest.');
  }
}
export async function assertBackendControlsSupportSources(siteRoot: string): Promise<void> {
  for (const entry of BACKEND_CONTROLS_SUPPORT_SOURCES) assert.equal(qualificationSourceDigest(await readFile(join(siteRoot, entry.path), 'utf8')),
    entry.sourceDigest, 'Backend control support source differs from the reviewed LF digest.');
}
export async function assertFleetSupportSources(siteRoot:string):Promise<void>{
  for(const entry of FLEET_SUPPORT_SOURCES)assert.equal(qualificationSourceDigest(await readFile(join(siteRoot,entry.path),'utf8')),entry.sourceDigest,'Fleet support source differs from the reviewed LF digest: '+entry.path);
}
export async function assertStorageMeasurementSupportSources(siteRoot: string): Promise<void> {
  for (const entry of STORAGE_MEASUREMENT_SUPPORT_SOURCES) assert.equal(qualificationSourceDigest(await readFile(join(siteRoot, entry.path), 'utf8')), entry.sourceDigest, 'CP28 support source differs from the reviewed LF digest: ' + entry.path);
}
export async function assertReaderPerformanceSupportSources(siteRoot: string): Promise<void> {
  for (const entry of READER_PERFORMANCE_SUPPORT_SOURCES) assert.equal(qualificationSourceDigest(await readFile(join(siteRoot, entry.path), 'utf8')),
    entry.sourceDigest, 'Reader performance support source differs from the reviewed LF digest: ' + entry.path);
}
export async function assertBatchCalibrationSupportSources(siteRoot: string): Promise<void> {
  for (const entry of BATCH_CALIBRATION_SUPPORT_SOURCES) assert.equal(qualificationSourceDigest(await readFile(join(siteRoot, entry.path), 'utf8')),
    entry.sourceDigest, 'Batch calibration support source differs from the reviewed LF digest.');
}
export async function assertRunnerCyclesSupportSources(siteRoot: string): Promise<void> {
  for (const entry of RUNNER_CYCLES_SUPPORT_SOURCES) assert.equal(qualificationSourceDigest(await readFile(join(siteRoot, entry.path), 'utf8')),
    entry.sourceDigest, 'Runner cycles support source differs from the reviewed LF digest.');
}
export async function assertCompetingWorkersSupportSources(siteRoot: string): Promise<void> {
  for (const entry of COMPETING_WORKERS_SUPPORT_SOURCES) {
    assert.equal(qualificationSourceDigest(await readFile(join(siteRoot, entry.path), 'utf8')), entry.sourceDigest,
      'Competing workers support source differs from the reviewed LF digest.');
  }
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
    if(fleetProfile(context.profile)){const fleet=fleetProfile(context.profile)!;assert.deepEqual(entry.cases.map(test=>test.name),fleet.names,'Fleet cases must retain source order.');assert.equal(entry.suites.length,1);const suite=entry.suites[0];assert.equal(suite.name,fleet.suite);assert.equal(suite.mode,'run');sameInventory(report.hooks.map(hook=>hook.key),['beforeAll','afterAll'].map(name=>suite.id+':'+name));for(const hook of report.hooks)assert.equal(hook.starts,1);for(let index=1;index<entry.cases.length;index++){const previous=entry.cases[index-1].diagnostic,current=entry.cases[index].diagnostic;assert(previous&&current&&current.startTime>=previous.startTime,'Fleet cases must execute in chronological source order.');}}
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
    if (context.profile === OFFICIAL_RESULTS_PROFILE || context.profile === OFFICIAL_RESULTS_PLAYED_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), OFFICIAL_RESULTS_FULL_NAMES,
        'Official results cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Official results requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, OFFICIAL_RESULTS_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Official results hooks must execute exactly once.');
      const selected = entry.cases.filter(test => selectedCase(context.profile).names.includes(test.name));
      assert.deepEqual(selected.map(test => test.name), selectedCase(context.profile).names);
      for (let index = 1; index < selected.length; index++) {
        const previous = selected[index - 1].diagnostic, current = selected[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Official results cases must execute in chronological source order.');
      }
    }
    if (context.profile === DRAFT_INTAKE_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), DRAFT_INTAKE_FULL_NAMES,
        'CP19 draft draft-intake cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'CP19 draft draft-intake requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, DRAFT_INTAKE_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'CP19 draft draft-intake hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'CP19 draft draft-intake cases must execute in chronological source order.');
      }
    }
    if (context.profile === DRAFT_REFRESH_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), DRAFT_REFRESH_FULL_NAMES,
        'CP19 draft draft-refresh cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'CP19 draft draft-refresh requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, DRAFT_REFRESH_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'CP19 draft draft-refresh hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'CP19 draft draft-refresh cases must execute in chronological source order.');
      }
    }
    if (context.profile === CANONICAL_STANDINGS_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), CANONICAL_STANDINGS_FULL_NAMES);
      assert.equal(entry.suites.length, 1); const suite = entry.suites[0];
      assert.equal(suite.name, CANONICAL_STANDINGS_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1);
      for (const [index, test] of entry.cases.entries()) {
        assert(test.diagnostic && test.diagnostic.duration <= CANONICAL_STANDINGS_CASE_TIMEOUTS_MS[index]);
        if (index > 0) assert(test.diagnostic.startTime >= entry.cases[index - 1].diagnostic!.startTime,
          'Canonical standings cases must retain their source order.');
      }
    }
    if (context.profile === STORAGE_MEASUREMENT_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), STORAGE_MEASUREMENT_FULL_NAMES);
      assert.equal(entry.suites.length, 1); const suite = entry.suites[0];
      assert.equal(suite.name, STORAGE_MEASUREMENT_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll','afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1);
    }
    if (context.profile === READER_PERFORMANCE_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), READER_PERFORMANCE_FULL_NAMES,
        'CP27 reader performance cases must retain their source order.');
      assert.equal(entry.suites.length, 1); const suite = entry.suites[0];
      assert.equal(suite.name, READER_PERFORMANCE_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'CP27 hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'CP27 reader performance cases must execute in chronological source order.');
      }
    }
    if (context.profile === BATCH_CALIBRATION_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), BATCH_CALIBRATION_FULL_NAMES);
      assert.equal(entry.suites.length, 1); const suite = entry.suites[0];
      assert.equal(suite.name, BATCH_CALIBRATION_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1);
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        // Vitest 4 records startTime with Date.now(), but duration with performance.now().
        // Their sum is not a wall-clock finish; actual case spans prove nonoverlap below.
        assert(previous && current && current.startTime >= previous.startTime,
          'CP26 calibration cases must execute in chronological source order.');
      }
    }
    if (context.profile === RUNNER_CYCLES_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), RUNNER_CYCLES_FULL_NAMES,
        'CP25 runner cycles cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'CP25 runner cycles requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, RUNNER_CYCLES_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'CP25 runner cycles hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'CP25 runner cycles cases must execute in chronological source order.');
      }
    }
    if (context.profile === BACKEND_CONTROLS_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), BACKEND_CONTROLS_FULL_NAMES,
        'CP24 backend controls cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'CP24 backend controls requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, BACKEND_CONTROLS_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'CP24 backend controls hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'CP24 backend controls cases must execute in chronological source order.');
      }
    }
    if (context.profile === COMPETING_WORKERS_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), COMPETING_WORKERS_FULL_NAMES,
        'CP23 competing workers cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'CP23 competing workers requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, COMPETING_WORKERS_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'CP23 competing workers hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'CP23 competing workers cases must execute in chronological source order.');
      }
    }
    if (context.profile === PROCESS_RECOVERY_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), PROCESS_RECOVERY_FULL_NAMES,
        'CP22 process recovery cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'CP22 process recovery requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, PROCESS_RECOVERY_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'CP22 process recovery hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'CP22 process recovery cases must execute in chronological source order.');
      }
    }
    if (context.profile === FRESH_INSTALL_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), FRESH_INSTALL_FULL_NAMES,
        'CP21 fresh installation cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'CP21 fresh installation requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, FRESH_INSTALL_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'CP21 fresh installation hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'CP21 fresh installation cases must execute in chronological source order.');
      }
    }
    if (context.profile === WITHIN_SEASON_HISTORY_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), WITHIN_SEASON_HISTORY_FULL_NAMES,
        'CP20 within season history cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'CP20 within season history requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, WITHIN_SEASON_HISTORY_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'CP20 within season history hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'CP20 within season history cases must execute in chronological source order.');
      }
    }
    if (context.profile === DRAFT_INTAKE_RECOVERY_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), DRAFT_INTAKE_RECOVERY_FULL_NAMES,
        'CP19 draft draft-intake-recovery cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'CP19 draft draft-intake-recovery requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, DRAFT_INTAKE_RECOVERY_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'CP19 draft draft-intake-recovery hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'CP19 draft draft-intake-recovery cases must execute in chronological source order.');
      }
    }
    if (context.profile === TRADED_PICKS_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), TRADED_PICKS_FULL_NAMES,
        'Traded picks cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Traded picks requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, TRADED_PICKS_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Traded picks hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Traded picks cases must execute in chronological source order.');
      }
    }
    if (context.profile === DRAFT_SELECTIONS_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), DRAFT_SELECTIONS_FULL_NAMES,
        'Draft selections cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Draft selections requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, DRAFT_SELECTIONS_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Draft selections hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Draft selections cases must execute in chronological source order.');
      }
    }
    if (context.profile === DRAFT_METADATA_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), DRAFT_METADATA_FULL_NAMES,
        'Draft metadata cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Draft metadata requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, DRAFT_METADATA_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Draft metadata hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Draft metadata cases must execute in chronological source order.');
      }
    }
    if (context.profile === TRANSACTION_HISTORY_INTAKE_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), TRANSACTION_HISTORY_INTAKE_FULL_NAMES,
        'Transaction history cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Transaction history requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, TRANSACTION_HISTORY_INTAKE_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Transaction history hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Transaction history cases must execute in chronological source order.');
      }
    }
    if (context.profile === TRANSACTION_HISTORY_REFRESH_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), TRANSACTION_HISTORY_REFRESH_FULL_NAMES,
        'Transaction history cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Transaction history requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, TRANSACTION_HISTORY_REFRESH_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Transaction history hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Transaction history cases must execute in chronological source order.');
      }
    }
    if (context.profile === TRANSACTION_HISTORY_RECOVERY_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), TRANSACTION_HISTORY_RECOVERY_FULL_NAMES,
        'Transaction history cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Transaction history requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, TRANSACTION_HISTORY_RECOVERY_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Transaction history hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Transaction history cases must execute in chronological source order.');
      }
    }
    if (context.profile === TRANSACTION_PERIOD_INTAKE_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), TRANSACTION_PERIOD_INTAKE_FULL_NAMES,
        'Transaction period intake cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Transaction period intake requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, TRANSACTION_PERIOD_INTAKE_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Transaction period intake hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Transaction period intake cases must execute in chronological source order.');
      }
    }
    if (context.profile === WEEKLY_REPORTS_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), WEEKLY_REPORTS_FULL_NAMES,
        'Weekly reports cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Weekly reports requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, WEEKLY_REPORTS_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Weekly reports hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Weekly reports cases must execute in chronological source order.');
      }
    }
    if (context.profile === OFFICIAL_RESULTS_EVIDENCE_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), OFFICIAL_RESULTS_EVIDENCE_FULL_NAMES,
        'Official results evidence cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Official results evidence requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, OFFICIAL_RESULTS_EVIDENCE_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Official results evidence hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Official results evidence cases must execute in chronological source order.');
      }
    }
    if (context.profile === BRACKET_INTAKE_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), BRACKET_INTAKE_FULL_NAMES,
        'Bracket intake cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Bracket intake requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, BRACKET_INTAKE_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Bracket intake hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Bracket intake cases must execute in chronological source order.');
      }
    }
    if (context.profile === TYPED_BRACKETS_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), TYPED_BRACKETS_FULL_NAMES,
        'Typed brackets cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Typed brackets requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, TYPED_BRACKETS_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Typed brackets hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Typed brackets cases must execute in chronological source order.');
      }
    }
    if (context.profile === EXACT_MATCHUP_VALUES_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), EXACT_MATCHUP_VALUES_FULL_NAMES,
        'Exact matchup values cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Exact matchup values requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, EXACT_MATCHUP_VALUES_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Exact matchup values hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Exact matchup values cases must execute in chronological source order.');
      }
    }
    if (context.profile === PERIOD_SETTINGS_CONTEXT_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), PERIOD_SETTINGS_CONTEXT_FULL_NAMES,
        'Period settings context cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Period settings context requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, PERIOD_SETTINGS_CONTEXT_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Period settings context hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Period settings context cases must execute in chronological source order.');
      }
    }
    if (context.profile === PERIOD_INVENTORY_PROFILE) {
      assert.deepEqual(entry.cases.map(test => test.name), PERIOD_INVENTORY_FULL_NAMES,
        'Period inventory cases must retain their source order.');
      assert.equal(entry.suites.length, 1, 'Period inventory requires its one shared suite.');
      const suite = entry.suites[0];
      assert.equal(suite.name, PERIOD_INVENTORY_SUITE); assert.equal(suite.mode, 'run');
      sameInventory(report.hooks.map(hook => hook.key), ['beforeAll', 'afterAll'].map(name => suite.id + ':' + name));
      for (const hook of report.hooks) assert.equal(hook.starts, 1, 'Period inventory hooks must execute exactly once.');
      for (let index = 1; index < entry.cases.length; index++) {
        const previous = entry.cases[index - 1].diagnostic, current = entry.cases[index].diagnostic;
        assert(previous && current && current.startTime >= previous.startTime,
          'Period inventory cases must execute in chronological source order.');
      }
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
/** Compare the already validated case spans from the same parent process, without rounding. */
export function assertBatchCalibrationCaseOrder(cases: import('./batch-calibration-evidence').BatchCalibrationEvidence['cases']): void {
  for (let index = 1; index < cases.length; index++) {
    const previous = cases[index - 1].span, current = cases[index].span;
    assert(previous && current && current.monotonicStartMs >= previous.monotonicEndMs,
      'CP26 calibration case spans must not overlap on their shared monotonic clock.');
  }
}
/** Only after independently verified child-tree closure; a late timeout marker always wins. */
export async function validateQualificationArtifacts(binding: QualificationBinding): Promise<{ profile: QualificationProfile; collected: number; executed: number; passed: number; skipped: number; filtered: number; reportDigest: string; companionDigest?: string }> {
  try { await lstat(join(binding.directory, QUALIFICATION_FILES.failure)); throw new Error('Sticky qualification failure.'); }
  catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error; }
  const raw = await readBounded(binding.directory, QUALIFICATION_FILES.report);
  const report = JSON.parse(raw) as QualificationReport;
  validateQualificationReport(binding.context, report);
  const ack = JSON.parse(await readBounded(binding.directory, QUALIFICATION_FILES.cleanup));
  exactKeys(ack, ['kind', 'contextDigest', 'reportDigest', 'globalDatabaseCleanup']);
  assert.deepEqual(ack, { kind: 'integration-qualification-cleanup-v1', contextDigest: qualificationDigest(binding.context),
    reportDigest: qualificationSourceDigest(raw), globalDatabaseCleanup: 'complete' });
  let companionDigest: string | undefined;
  if (binding.context.profile === CANONICAL_STANDINGS_PROFILE) {
    const companion = await import('./canonical-standings-profile');
    const rawEvidence = await readBounded(binding.directory, companion.CANONICAL_STANDINGS_EVIDENCE_FILE);
    companion.assertCanonicalStandingsEvidence(JSON.parse(rawEvidence), qualificationDigest(binding.context));
    companionDigest = qualificationSourceDigest(rawEvidence);
  }
  if(fleetProfile(binding.context.profile)){const name=binding.context.profile===FLEET_LIVE_PROFILE?'cp26-fleet-live-evidence.json':binding.context.profile===FLEET_OWNERSHIP_PROFILE?'cp26-fleet-ownership-evidence.json':binding.context.profile===FLEET_DAILY_PROFILE?'cp26-fleet-daily-evidence.json':binding.context.profile===FLEET_HEALTHY_PROFILE?'cp26-fleet-healthy-evidence.json':'cp26-fleet-recovery-evidence.json';const rawEvidence=await readBounded(binding.directory,name);const validators=await import('./freshness-capacity-profile');await (binding.context.profile===FLEET_LIVE_PROFILE?validators.validateFleetLiveCompanion:binding.context.profile===FLEET_OWNERSHIP_PROFILE?validators.validateFleetOwnershipCompanion:validators.validateFleetCompanion)(JSON.parse(rawEvidence),binding);companionDigest=qualificationSourceDigest(rawEvidence);}
  if (binding.context.profile === STORAGE_MEASUREMENT_PROFILE) {
    const rawEvidence = await readBounded(binding.directory, 'cp28-storage-evidence.json');
    const companion = await import('./reader-performance');
    await companion.assertCompleteStorageMeasurementEvidence(JSON.parse(rawEvidence), binding);
    companionDigest = qualificationSourceDigest(rawEvidence);
  }
  if (binding.context.profile === READER_PERFORMANCE_PROFILE) {
    const rawEvidence = await readBounded(binding.directory, 'reader-performance-evidence.json');
    const companion = await import('./reader-performance');
    companion.assertCompleteReaderPerformanceEvidence(JSON.parse(rawEvidence), binding);
    companionDigest = qualificationSourceDigest(rawEvidence);
  }
  if (binding.context.profile === BATCH_CALIBRATION_PROFILE) {
    const rawEvidence = await readBounded(binding.directory, 'batch-calibration-evidence.json');
    const companion = await import('./batch-calibration-evidence');
    const evidence = JSON.parse(rawEvidence) as import('./batch-calibration-evidence').BatchCalibrationEvidence;
    companion.assertCompleteBatchCalibrationEvidence(evidence, binding);
    assertBatchCalibrationCaseOrder(evidence.cases);
    companionDigest = qualificationSourceDigest(rawEvidence);
  }
  if (binding.context.profile === RUNNER_CYCLES_PROFILE) {
    const rawEvidence = await readBounded(binding.directory, 'runner-cycles-evidence.json');
    const companion = await import('./runner-cycles-evidence');
    companion.assertCompleteRunnerCyclesEvidence(JSON.parse(rawEvidence), binding);
    companionDigest = qualificationSourceDigest(rawEvidence);
  }
  if (binding.context.profile === BACKEND_CONTROLS_PROFILE) {
    const rawEvidence = await readBounded(binding.directory, 'backend-controls-evidence.json');
    const companion = await import('./backend-controls-evidence');
    const evidence = JSON.parse(rawEvidence) as import('./backend-controls-evidence').ControlsEvidence;
    companion.assertCompleteBackendControlsEvidence(evidence, binding);
    companionDigest = qualificationSourceDigest(rawEvidence);
  }
  const cases = report.modules.flatMap(module => module.cases);
  return { profile: binding.context.profile, collected: cases.length, executed: cases.filter(test => test.diagnostic !== null).length,
    passed: cases.filter(test => test.state === 'passed').length, skipped: cases.filter(test => test.state === 'skipped').length, filtered: cases.filter(test => test.state === 'skipped').length,
    reportDigest: qualificationSourceDigest(raw), ...(companionDigest ? { companionDigest } : {}) };
}

/** The distinct live suffix never matches default full discovery. Only a validated bound profile opts in. */
export function qualificationIncludes(environment: Record<string, string | undefined> = process.env): string[] {
  const profile = qualificationBinding(environment)?.context.profile;
  if (profile === CANONICAL_STANDINGS_PROFILE) return [CANONICAL_STANDINGS_MODULE];
  if(profile&&fleetProfile(profile))return[fleetProfile(profile)!.module];
  if (profile === STORAGE_MEASUREMENT_PROFILE) return [STORAGE_MEASUREMENT_MODULE];
  if (profile === READER_PERFORMANCE_PROFILE) return [READER_PERFORMANCE_MODULE];
  if (profile === BATCH_CALIBRATION_PROFILE) return [BATCH_CALIBRATION_MODULE];
  if (profile === RUNNER_CYCLES_PROFILE) return [RUNNER_CYCLES_MODULE];
  if (profile === BACKEND_CONTROLS_PROFILE) return [BACKEND_CONTROLS_MODULE];
  if (profile === COMPETING_WORKERS_PROFILE) return [COMPETING_WORKERS_MODULE];
  if (profile === PROCESS_RECOVERY_PROFILE) return [PROCESS_RECOVERY_MODULE];
  if (profile === FRESH_INSTALL_PROFILE) return [FRESH_INSTALL_MODULE];
  if (profile === WITHIN_SEASON_HISTORY_PROFILE) return [WITHIN_SEASON_HISTORY_MODULE];
  if (profile === DRAFT_INTAKE_PROFILE) return [DRAFT_INTAKE_MODULE];
  if (profile === DRAFT_REFRESH_PROFILE) return [DRAFT_REFRESH_MODULE];
  if (profile === DRAFT_INTAKE_RECOVERY_PROFILE) return [DRAFT_INTAKE_RECOVERY_MODULE];
  if (profile === TRADED_PICKS_PROFILE) return [TRADED_PICKS_MODULE];
  if (profile === DRAFT_SELECTIONS_PROFILE) return [DRAFT_SELECTIONS_MODULE];
  if (profile === DRAFT_METADATA_PROFILE) return [DRAFT_METADATA_MODULE];
  if (profile === TRANSACTION_HISTORY_INTAKE_PROFILE) return [TRANSACTION_HISTORY_INTAKE_MODULE];
  if (profile === TRANSACTION_HISTORY_REFRESH_PROFILE) return [TRANSACTION_HISTORY_REFRESH_MODULE];
  if (profile === TRANSACTION_HISTORY_RECOVERY_PROFILE) return [TRANSACTION_HISTORY_RECOVERY_MODULE];
  if (profile === TRANSACTION_PERIOD_INTAKE_PROFILE) return [TRANSACTION_PERIOD_INTAKE_MODULE];
  if (profile === OFFICIAL_RESULTS_PLAYED_PROFILE) return [OFFICIAL_RESULTS_MODULE];
  return profile === WEEKLY_REPORTS_PROFILE ? [WEEKLY_REPORTS_MODULE] : profile === OFFICIAL_RESULTS_EVIDENCE_PROFILE ? [OFFICIAL_RESULTS_EVIDENCE_MODULE] : profile === OFFICIAL_RESULTS_PROFILE ? [OFFICIAL_RESULTS_MODULE] : profile === BRACKET_INTAKE_PROFILE ? [BRACKET_INTAKE_MODULE] : profile === TYPED_BRACKETS_PROFILE ? [TYPED_BRACKETS_MODULE] : profile === EXACT_MATCHUP_VALUES_PROFILE ? [EXACT_MATCHUP_VALUES_MODULE] : profile === PERIOD_SETTINGS_CONTEXT_PROFILE ? [PERIOD_SETTINGS_CONTEXT_MODULE] : profile === PERIOD_INVENTORY_PROFILE ? [PERIOD_INVENTORY_MODULE] : profile === TEAM_MANAGER_FACTS_PROFILE ? [TEAM_MANAGER_FACTS_MODULE] : profile === ROSTER_PLAYER_LINKS_PROFILE ? [ROSTER_PLAYER_LINKS_MODULE] : profile === LIVE_PLAYER_DIRECTORY_PROFILE ? [LIVE_PLAYER_DIRECTORY_MODULE] : profile === PLAYER_DIRECTORY_PROFILE ? [PLAYER_DIRECTORY_MODULE]
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
