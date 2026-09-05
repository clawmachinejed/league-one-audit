import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeLocalBuildMarker } from './browser-target.ts';

const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runId = process.env.L1_BROWSER_RUN_ID;
const source = process.env.L1_BROWSER_SOURCE;
if (!runId || !source) throw new Error('The local browser build requires a Playwright run and source identity.');
writeLocalBuildMarker({ mode: 'local', siteDir, runId, source: JSON.parse(source), baseURL: '' });
