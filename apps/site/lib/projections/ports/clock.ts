export type ClockPort = Readonly<{
  now: () => Date;
  /** Monotonic-enough runtime measurement used only for operational durations. */
  monotonicNow: () => number;
}>;
