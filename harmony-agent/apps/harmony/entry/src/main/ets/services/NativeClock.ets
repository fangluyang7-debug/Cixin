import { systemDateTime } from '@kit.BasicServicesKit';
import { ClockPort } from 'scheduler';
export class NativeClock implements ClockPort {
  public now(): number { return systemDateTime.getUptime(systemDateTime.TimeType.STARTUP); }
  public wallNow(): number { return Date.now(); }
}
