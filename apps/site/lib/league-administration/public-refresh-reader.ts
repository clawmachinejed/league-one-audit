import 'server-only';
import type { Database } from '../database';
import type { LeagueAdministrationStore } from './store-contracts';
import { refreshOrdinal, refreshUuid } from './public-refresh-contracts';
import { readPublicSleeperIntake } from './public-intake-reader';
import { normalizeStoredPublicPeriods, type PublicIntakeReadOptions } from './public-intake-contracts';

function timestamp(value: unknown): string {
  const time = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) throw new Error('Invalid stored refresh timestamp.');
  return new Date(time).toISOString();
}
function ordinal(value: unknown, minimum = 1): number {
  const parsed = typeof value === 'string' && /^(0|[1-9][0-9]*)$/u.test(value) ? Number(value) : value;
  if (!refreshOrdinal(parsed, minimum)) throw new Error('Invalid stored refresh ordinal.');
  return parsed;
}

/** Explicit backend read only. Scheduling/admission timestamps are never resource freshness. */
export async function readPublicDataRefresh(client: Database, administration: LeagueAdministrationStore, targetId: string,
  options: PublicIntakeReadOptions = {}) {
  if (!refreshUuid(targetId)) throw new Error('Invalid public refresh identity.');
  if (!client.enabled) return { status: 'disabled' } as const;
  const rows = await client.query(`/* public-data-refresh:read */
    SELECT target.id,target.provider,target.source_manager_account_id,account.external_manager_id,
      target.configuration_revision,target.current_cycle,target.next_due_at,target.last_served_at,
      target.selection_failure_count,target.selection_failed_at,target.selection_next_eligible_at,
      configuration.identity_request_id,configuration.seasons,configuration.cadence_seconds,
      configuration.expires_at,configuration.paused,configuration.configured_at,
      to_jsonb(configuration)->'exact_periods' AS selected_exact_periods,
      to_jsonb(configuration)->'period_inventory' AS selected_period_inventory,
      to_jsonb(cycle_configuration)->'period_inventory' AS cycle_period_inventory,
      to_jsonb(cycle_configuration)->'exact_periods' AS cycle_exact_periods,cycle_configuration.seasons AS cycle_seasons,
      cycle.configuration_revision AS cycle_configuration_revision,cycle.intake_id,cycle.created_at AS cycle_created_at,cycle.due_at,
      outcome.disposition,outcome.recorded_at AS outcome_recorded_at,outcome.next_due_at AS outcome_next_due_at
    FROM public.public_data_refresh_targets target
    JOIN public.league_source_manager_accounts account ON account.id=target.source_manager_account_id AND account.provider=target.provider
    JOIN public.public_data_refresh_configurations configuration ON configuration.target_id=target.id AND configuration.revision=target.configuration_revision
    LEFT JOIN public.public_data_refresh_cycles cycle ON cycle.target_id=target.id AND cycle.cycle=target.current_cycle
    LEFT JOIN public.public_data_refresh_configurations cycle_configuration
      ON cycle_configuration.target_id=cycle.target_id AND cycle_configuration.revision=cycle.configuration_revision
    LEFT JOIN public.public_data_refresh_cycle_outcomes outcome ON outcome.target_id=cycle.target_id AND outcome.cycle=cycle.cycle
    WHERE target.id=$1::uuid`, [targetId]);
  if (rows.length === 0) return { status: 'missing' } as const;
  if (rows.length !== 1) throw new Error('Ambiguous stored refresh target.');
  const row = rows[0];
  if (row.id !== targetId.toLowerCase() || row.provider !== 'sleeper' || !refreshUuid(row.source_manager_account_id)
    || !refreshUuid(row.identity_request_id) || typeof row.external_manager_id !== 'string'
    || !/^[1-9][0-9]{0,31}$/u.test(row.external_manager_id) || typeof row.paused !== 'boolean'
    || !Array.isArray(row.seasons) || row.seasons.length < 1 || row.seasons.length > 3
    || row.seasons.some(season => !Number.isInteger(season) || season < 1920 || season > 2200)
    || new Set(row.seasons).size !== row.seasons.length) throw new Error('Invalid stored refresh configuration.');
  const { exactPeriods, periodInventory } = normalizeStoredPublicPeriods(row.selected_exact_periods, row.seasons as number[], row.selected_period_inventory);
  const revision = ordinal(row.configuration_revision);
  const cadence = ordinal(row.cadence_seconds);
  const failureCount = ordinal(row.selection_failure_count, 0);
  if (cadence < 60 || cadence > 604_800 || failureCount > 7) throw new Error('Invalid stored refresh bounds.');
  let cycle = null;
  if (row.current_cycle !== null) {
    const cycleRevision = ordinal(row.cycle_configuration_revision);
    if (cycleRevision > revision || !refreshUuid(row.intake_id)) throw new Error('Invalid stored refresh cycle binding.');
    let outcome = null;
    if (row.disposition !== null) {
      if (!['complete', 'partial', 'unavailable'].includes(String(row.disposition))) throw new Error('Invalid stored refresh outcome.');
      outcome = { disposition: row.disposition as 'complete' | 'partial' | 'unavailable',
        recordedAt: timestamp(row.outcome_recorded_at), nextDueAt: timestamp(row.outcome_next_due_at) };
    }
    const { exactPeriods: cyclePeriods, periodInventory: cycleInventory } = normalizeStoredPublicPeriods(row.cycle_exact_periods,
      Array.isArray(row.cycle_seasons) ? row.cycle_seasons : [], row.cycle_period_inventory);
    cycle = { ...(cycleInventory ? { periodInventory: cycleInventory } : {}), ...(cyclePeriods.length ? { exactPeriods: cyclePeriods } : {}), number: ordinal(row.current_cycle), configurationRevision: cycleRevision, requestId: row.intake_id,
      createdAt: timestamp(row.cycle_created_at), dueAt: timestamp(row.due_at), outcome };
  }
  const target = { id: row.id, provider: 'sleeper' as const, sourceManagerAccountId: row.source_manager_account_id,
    externalManagerId: row.external_manager_id, identityRequestId: row.identity_request_id, configurationRevision: revision,
    seasons: row.seasons as number[], ...(periodInventory ? { periodInventory } : {}), ...(exactPeriods.length ? { exactPeriods } : {}), cadenceSeconds: cadence, expiresAt: timestamp(row.expires_at),
    paused: row.paused, configuredAt: timestamp(row.configured_at) };
  const schedule = { nextDueAt: timestamp(row.next_due_at), lastServedAt: row.last_served_at === null ? null : timestamp(row.last_served_at),
    selectionFailureCount: failureCount, selectionFailedAt: row.selection_failed_at === null ? null : timestamp(row.selection_failed_at),
    selectionNextEligibleAt: timestamp(row.selection_next_eligible_at) };
  // The immutable cycle request identifies its own stored resource receipts. A
  // later config revision never rewrites that collection scope or its evidence.
  const intake = cycle ? await readPublicSleeperIntake(client, administration, cycle.requestId, options) : null;
  if (cycle && intake && intake.status !== 'missing'
    && (JSON.stringify(cycle.exactPeriods ?? []) !== JSON.stringify(intake.request.exactPeriods ?? [])
      || cycle.periodInventory !== intake.request.periodInventory)) {
    throw new Error('Stored refresh cycle period scope differs from its request.');
  }
  return { status: 'available', target, schedule, cycle, intake,
    freshness: 'Scheduling and admission do not assert fresh content; use each stored intake resource acceptance and capture timestamp.' } as const;
}
