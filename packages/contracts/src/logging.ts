import { z } from "zod";

export const StatusEnum = z.enum(["success", "skipped", "error"]);
export const ReasonEnum = z.enum(["ok", "rate_capped", "not_enabled"]);

export const LogEvent = z.object({
  ts: z.string(),
  name: z.string(),
  status: StatusEnum,
  reason: ReasonEnum.optional(),
  details: z.record(z.any()).optional(),
});

export type LogEvent = z.infer<typeof LogEvent>;
export type Status = z.infer<typeof StatusEnum>;
export type Reason = z.infer<typeof ReasonEnum>;
