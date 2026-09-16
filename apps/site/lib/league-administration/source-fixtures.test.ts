import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeAdministrationObservation } from './normalize';
import type { AdministrationEnvelope, JsonValue } from './contracts';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../test-support/fixtures/${name}`, import.meta.url), 'utf8'));
const configurations = fixture('dynasty-league-settings.json');

describe('retained sanitized production-shaped administration evidence', () => {
  for (const [key, league] of Object.entries(configurations.leagues) as [string, Record<string, JsonValue>][]) {
    it(`retains the observed ${key} settings and source scoring distinctions`, () => {
      const envelope: AdministrationEnvelope = {
        schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
        scope: { provider: 'sleeper', leagueKey: key, externalLeagueId: String(league.league_id), season: Number(league.season) },
        family: 'league', week: null, completeness: 'complete', payload: league,
        provenance: { origin: 'bootstrap', requestStartedAt: null, requestCompletedAt: null,
          sourceObservedAt: configurations.provenance.captured_at, checkedAt: configurations.provenance.captured_at },
      };
      const normalized = normalizeAdministrationObservation(envelope);
      expect(normalized.status, JSON.stringify(normalized.diagnostics)).toBe('accepted');
      expect(normalized.envelope.payload).toEqual(league);
      if (normalized.value?.family !== 'league') throw new Error('Configuration was not retained.');
      expect(normalized.value.components.find(component => component.name === 'scoring')?.value.scoring_settings).toEqual(league.scoring_settings);
      expect(normalized.value.components.find(component => component.name === 'roster')?.value.roster_positions).toEqual(league.roster_positions);
      if (key !== 'dynasty') {
        // These September12 documents prove source shape; they do not claim
        // complete game statistics, current standings or known historic rules.
        for (const family of ['rosters', 'matchups'] as const) {
          const payload = fixture(`all-player-foundation/${key}-${family === 'rosters' ? 'rosters' : 'matchups-1'}.json`);
          const observed = normalizeAdministrationObservation({ ...envelope, family, week: family === 'matchups' ? 1 : null, payload },
            { expectedRosterCount: Number(league.total_rosters) });
          expect(observed.status, JSON.stringify(observed.diagnostics)).toBe('accepted');
          expect(observed.envelope.payload).toEqual(payload);
        }
      }
    });
  }
});
