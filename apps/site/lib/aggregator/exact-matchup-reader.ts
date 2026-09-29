import 'server-only';

/** Internal feature composition enters persistence through the administration facade. */
export { createExactMatchupCompatibilityReader } from '../league-administration/store';
export type { ExactMatchupCompatibilityReadInput } from '../league-administration/store';
