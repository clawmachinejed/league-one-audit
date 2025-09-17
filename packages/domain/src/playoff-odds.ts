// packages/domain/src/playoff-odds.ts
import { createHash } from "node:crypto";
import type { OddsInput, OddsResult } from "@l1/contracts";

/**
 * xorshift128+ PRNG seeded with sha256(`${season}-${current_week}`).
 * Deterministic across runs for the same inputs.
 */
export function playoffOdds(input: OddsInput): OddsResult[] {
  const seedStr = `${input.season}-${input.current_week}`;
  const seed = sha256ToUint32Array(seedStr);
  const rng = xorshift128plus(seed);

  const weights = input.standings.map((s) => 1 + s.wins - s.losses / 10);
  const weightSum = weights.reduce((a, b) => a + b, 0);

  return input.standings.map((row, i) => {
    let score = 0;
    for (let k = 0; k < 4; k++) score += rng();
    const normalized = (score % 1) * (weights[i] / weightSum);
    return {
      team_id: row.team.id,
      playoff_odds: clamp01(0.2 + normalized),
    };
  });
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function sha256ToUint32Array(s: string): [number, number, number, number] {
  const h = createHash("sha256").update(s).digest();
  const arr: number[] = [];
  for (let i = 0; i < 16; i += 4) {
    arr.push(h.readUInt32BE(i));
  }
  return [arr[0], arr[1], arr[2], arr[3]];
}

function xorshift128plus(seed: [number, number, number, number]) {
  let [s0, s1, s2, s3] = seed.map((n) => n >>> 0);
  function next(): number {
    let t = (s1 << 9) >>> 0;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    const hi = s0 >>> 5;
    const lo = s1 >>> 6;
    return (hi * 67108864 + lo) / 9007199254740992;
  }
  return next;
}

function rotl(n: number, k: number) {
  return ((n << k) | (n >>> (32 - k))) >>> 0;
}
