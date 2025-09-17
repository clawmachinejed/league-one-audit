import type { LoggerPort } from "@l1/ports";
import { LogEvent } from "@l1/contracts";
export function createConsoleLogger(): LoggerPort {
  return {
    emit(event: LogEvent) {
      console.log(
        JSON.stringify({
          ts: event.ts,
          name: event.name,
          status: event.status,
          reason: event.reason ?? "ok",
          details: event.details ?? {},
        }),
      );
    },
  };
}
