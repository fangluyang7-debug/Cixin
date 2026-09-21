import { ActiveTaskSnapshot, DeviceState, MetricsSnapshot, SchedulerService, SchedulerLogEntry,
  ConstrainedPolicyConfig, Unsubscribe, StateCallback, SchedulerLogCallback } from 'scheduler';

export interface SchedulerLiveSource {
  isInitialized(): boolean;
  getDeviceState(): DeviceState;
  getMetricsSnapshot(): MetricsSnapshot;
  getActiveTasks(): ActiveTaskSnapshot[];
  getRecentLogs(limit: number): SchedulerLogEntry[];
  getConstrainedPolicy(): ConstrainedPolicyConfig;
  isFeedbackEnabled(): boolean;
  registerStateCallback(callback: StateCallback): Unsubscribe;
  registerLogCallback(callback: SchedulerLogCallback): Unsubscribe;
}

export interface SchedulerLiveSnapshot {
  schemaVersion: number;
  sequence: number;
  capturedAt: number;
  connected: boolean;
  state: DeviceState | null;
  metrics: MetricsSnapshot | null;
  activeTasks: ActiveTaskSnapshot[];
  events: SchedulerLogEntry[];
  policyMode: string;
  policyVersion: string;
  feedbackEnabled: boolean;
}

function unavailableSnapshot(sequence: number): SchedulerLiveSnapshot {
  return { schemaVersion: 1, sequence: sequence, capturedAt: Date.now(), connected: false, state: null,
    metrics: null, activeTasks: [], events: [], policyMode: 'UNAVAILABLE', policyVersion: '', feedbackEnabled: false };
}

export function readSchedulerSnapshot(source: SchedulerLiveSource, sequence: number): SchedulerLiveSnapshot {
  try {
    if (!source.isInitialized()) { return unavailableSnapshot(sequence); }
    const config = source.getConstrainedPolicy();
    const snapshot: SchedulerLiveSnapshot = { schemaVersion: 1, sequence: sequence, capturedAt: Date.now(), connected: true,
      state: source.getDeviceState(), metrics: source.getMetricsSnapshot(), activeTasks: source.getActiveTasks(),
      events: source.getRecentLogs(24).slice().reverse(), policyMode: config.mode, policyVersion: config.version,
      feedbackEnabled: source.isFeedbackEnabled() };
    return JSON.parse(JSON.stringify(snapshot)) as SchedulerLiveSnapshot;
  } catch (_) { return unavailableSnapshot(sequence); }
}

// Read-only adapter. Opening/closing or freezing its UI never signals a task.
export class SchedulerLiveFeed {
  private readonly source: SchedulerLiveSource;
  private timer: number = -1;
  private tick: number = -1;
  private stateUnsubscribe: Unsubscribe | null = null;
  private logUnsubscribe: Unsubscribe | null = null;
  private listener: ((snapshot: SchedulerLiveSnapshot) => void) | null = null;
  private sequence: number = 0;
  constructor(source: SchedulerLiveSource = SchedulerService.getInstance()) { this.source = source; }
  public start(listener: (snapshot: SchedulerLiveSnapshot) => void): void {
    this.stop(); this.listener = listener; this.refresh();
    this.timer = setInterval(() => this.refresh(), 500);
  }
  public stop(): void {
    clearInterval(this.timer); clearTimeout(this.tick); this.timer = -1; this.tick = -1;
    this.detach(); this.listener = null;
  }
  private detach(): void {
    if (this.stateUnsubscribe !== null) { this.stateUnsubscribe(); this.stateUnsubscribe = null; }
    if (this.logUnsubscribe !== null) { this.logUnsubscribe(); this.logUnsubscribe = null; }
  }
  private schedule(): void {
    if (this.tick >= 0 || this.listener === null) { return; }
    this.tick = setTimeout(() => { this.tick = -1; this.refresh(); }, 100);
  }
  private refresh(): void {
    if (this.listener === null) { return; }
    try {
      if (!this.source.isInitialized()) { this.detach(); }
      else if (this.stateUnsubscribe === null) {
        this.stateUnsubscribe = this.source.registerStateCallback(() => this.schedule());
        this.logUnsubscribe = this.source.registerLogCallback(() => this.schedule());
      }
    } catch (_) {
      this.detach();
    }
    try { this.listener(readSchedulerSnapshot(this.source, ++this.sequence)); }
    catch (_) { /* Rendering observers must not interrupt scheduling. */ }
  }
}
