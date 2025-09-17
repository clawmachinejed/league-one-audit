import { LogEvent } from "@l1/contracts";
export interface LoggerPort {
  emit(event: LogEvent): void;
}
