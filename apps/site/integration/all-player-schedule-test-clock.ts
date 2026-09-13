import { ownerQuery } from './neon-integration-harness';

/** Only global setup calls this, after the isolated harness has independently
 * verified its authorization, identity, sentinel, TLS, role and denylist gates.
 * Actual migration/catalog capture does not call it. Lease and deadline clocks
 * remain real, so their race tests cannot pass because time was frozen. */
export async function installAllPlayerScheduleTestClock(): Promise<void> {
  await ownerQuery(`CREATE OR REPLACE FUNCTION public.all_player_request_clock()
    RETURNS timestamptz LANGUAGE sql VOLATILE
    SET search_path = pg_catalog, public, pg_temp AS $$
      SELECT (date_trunc('day', clock_timestamp() AT TIME ZONE 'America/New_York')
        + interval '12 hours 30 minutes') AT TIME ZONE 'America/New_York'
    $$`);
}
