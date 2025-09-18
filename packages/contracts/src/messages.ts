// packages/contracts/src/messages.ts
export const messages = {
  // Sleeper unreachable / transient fetch failures
  scoresUnavailable: "Scores temporarily unavailable — retrying…",

  // League misconfiguration or private league
  leagueMisconfig: "League configuration issue — check SLEEPER_LEAGUE_ID.",

  // current_week missing (early season or Sleeper lag)
  weekUnavailable:
    "Week not available yet — standings and history are up-to-date.",

  // Owner/user missing in Sleeper payloads
  ownerUnavailable: "(Owner unavailable)",

  // Analytics compute failures (ELO/Spice/Awards/Odds)
  analyticsFailure: "Couldn’t compute this section right now.",
} as const;

export type MessageKey = keyof typeof messages;
