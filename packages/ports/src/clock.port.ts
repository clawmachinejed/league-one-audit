export interface ClockPort {
  nowISO(): string;
  tz(): string;
  within(startISO: string, endISO: string): boolean;
}
