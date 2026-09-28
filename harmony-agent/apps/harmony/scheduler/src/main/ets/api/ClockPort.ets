export interface ClockPort {
  now(): number;
  wallNow(): number;
}
// Compatibility for hosts without a monotonic adapter; never label this as monotonic.
export class WallClock implements ClockPort {
  public now(): number { return Date.now(); }
  public wallNow(): number { return Date.now(); }
}
