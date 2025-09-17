import { describe, it, expect } from "vitest";
import { computeWeeklyAwards } from "../src/awards";
import { seedSchedule, seedBenchStats } from "@l1/contracts";

describe("awards", () => {
  it("computes bench of week", () => {
    const res = computeWeeklyAwards(1, seedSchedule, seedBenchStats);
    expect(res.bench_of_week).toBeGreaterThan(0);
  });
});
