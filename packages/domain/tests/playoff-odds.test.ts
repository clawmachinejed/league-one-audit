import { describe, it, expect } from "vitest";
import { playoffOdds } from "../src/playoff-odds";
import { seedStandings, seedSchedule } from "@l1/contracts";

describe("playoffOdds determinism", () => {
  it("produces identical arrays for same seed", () => {
    const input = {
      season: 2024,
      current_week: 3,
      standings: seedStandings,
      schedule: seedSchedule,
    };
    const a = playoffOdds(input);
    const b = playoffOdds(input);
    expect(a).toEqual(b);
  });
});
