import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { http } from '@kit.NetworkKit';
import { ActiveTaskSnapshot, ConstrainedPolicyConfig, DeviceState, MetricsSnapshot, SchedulerLogCallback,
  SchedulerLogEntry, SchedulerService, StateCallback, Unsubscribe } from 'scheduler';
import { readSchedulerSnapshot, SchedulerLiveSource } from './SchedulerLiveFeed';

export interface SchedulerMonitorSettings {
  endpoint: string;
  pairingCode: string;
  enabled: boolean;
}

const SETTINGS_NAME = 'scheduler_desktop_monitor_v1';

class MonitorLiveSource implements SchedulerLiveSource {
  private readonly scheduler: SchedulerService;

  constructor(scheduler: SchedulerService) { this.scheduler = scheduler; }
  isInitialized(): boolean { return this.scheduler.isInitialized(); }
  getDeviceState(): DeviceState { return this.scheduler.getDeviceState(); }
  getMetricsSnapshot(): MetricsSnapshot { return this.scheduler.getMetricsSnapshot(); }
  getActiveTasks(): ActiveTaskSnapshot[] { return this.scheduler.getActiveTasks(); }
  getRecentLogs(limit: number): SchedulerLogEntry[] { return this.scheduler.getRecentLogs(limit); }
  getConstrainedPolicy(): ConstrainedPolicyConfig { return this.scheduler.getConstrainedPolicy(); }
  isFeedbackEnabled(): boolean { return this.scheduler.isFeedbackEnabled(); }
  registerStateCallback(callback: StateCallback): Unsubscribe { return this.scheduler.registerStateCallback(callback); }
  registerLogCallback(callback: SchedulerLogCallback): Unsubscribe { return this.scheduler.registerLogCallback(callback); }
}

export class SchedulerMonitorPublisher {
  private static readonly instance: SchedulerMonitorPublisher = new SchedulerMonitorPublisher();
  private readonly scheduler: SchedulerService = SchedulerService.getInstance();
  private readonly liveSource: SchedulerLiveSource;
  private endpoint: string = '';
  private pairingCode: string = '';
  private timer: number = -1;
  private sequence: number = 0;
  private inFlight: boolean = false;
  private foreground: boolean = true;
  private failures: number = 0;
  private retryAt: number = 0;
  private status: string = '监控推送未启动';
  private listener: ((status: string) => void) | null = null;

  private constructor() { this.liveSource = new MonitorLiveSource(this.scheduler); }

  public static getInstance(): SchedulerMonitorPublisher { return SchedulerMonitorPublisher.instance; }

  public static isValidEndpoint(endpoint: string): boolean {
    const match = /^http:\/\/([a-zA-Z0-9.-]+):(\d{1,5})$/.exec(endpoint.trim());
    if (match === null || match[1].length > 253) { return false; }
    const port = Number(match[2]);
    return Number.isInteger(port) && port >= 1 && port <= 65535;
  }

  public static isValidPairingCode(code: string): boolean {
    return /^[a-zA-Z0-9_-]{12,64}$/.test(code.trim());
  }

  public static async loadSettings(context: common.Context): Promise<SchedulerMonitorSettings> {
    const store = await preferences.getPreferences(context, { name: SETTINGS_NAME });
    const endpoint = await store.get('endpoint', '');
    const pairingCode = await store.get('pairingCode', '');
    const enabled = await store.get('enabled', false);
    return { endpoint: typeof endpoint === 'string' ? endpoint : '',
      pairingCode: typeof pairingCode === 'string' ? pairingCode : '', enabled: enabled === true };
  }

  public static async saveSettings(context: common.Context, settings: SchedulerMonitorSettings): Promise<void> {
    const store = await preferences.getPreferences(context, { name: SETTINGS_NAME });
    await store.put('endpoint', settings.endpoint.trim());
    await store.put('pairingCode', settings.pairingCode.trim());
    await store.put('enabled', settings.enabled);
    await store.flush();
  }

  public setStatusListener(listener: ((status: string) => void) | null): void {
    this.listener = listener;
    if (listener !== null) { listener(this.status); }
  }

  public start(endpoint: string, pairingCode: string): void {
    const target = endpoint.trim().replace(/\/$/, '');
    const code = pairingCode.trim();
    if (!SchedulerMonitorPublisher.isValidEndpoint(target) || !SchedulerMonitorPublisher.isValidPairingCode(code)) {
      this.updateStatus('电脑地址或配对码格式无效');
      return;
    }
    if (this.timer >= 0 && target === this.endpoint && code === this.pairingCode) { return; }
    this.stopTimer();
    this.endpoint = target;
    this.pairingCode = code;
    this.failures = 0;
    this.retryAt = 0;
    if (this.foreground) {
      this.updateStatus('正在连接电脑监控服务');
      this.timer = setInterval(() => this.publish(), 750);
      this.publish();
    }
  }

  public stop(): void {
    this.stopTimer();
    this.endpoint = '';
    this.pairingCode = '';
    this.inFlight = false;
    this.updateStatus('监控推送未启动');
  }

  public setForeground(foreground: boolean): void {
    if (this.foreground === foreground) { return; }
    this.foreground = foreground;
    if (!foreground) {
      this.stopTimer();
      this.updateStatus('应用在后台，监控推送已暂停');
    } else if (this.endpoint !== '' && this.pairingCode !== '') {
      this.start(this.endpoint, this.pairingCode);
    }
  }

  private stopTimer(): void {
    clearInterval(this.timer);
    this.timer = -1;
  }

  private async publish(): Promise<void> {
    if (!this.foreground || this.inFlight || this.endpoint === '' || Date.now() < this.retryAt) { return; }
    if (!this.scheduler.isInitialized()) { this.updateStatus('等待调度器初始化'); return; }
    const snapshot = readSchedulerSnapshot(this.liveSource, ++this.sequence);
    if (!snapshot.connected) { this.updateStatus('正在读取调度状态'); return; }
    this.inFlight = true;
    const request = http.createHttp();
    try {
      const response = await request.request(`${this.endpoint}/api/snapshot`, {
        method: http.RequestMethod.POST,
        header: { 'content-type': 'application/json', authorization: `Bearer ${this.pairingCode}` },
        extraData: JSON.stringify(snapshot),
        connectTimeout: 1500,
        readTimeout: 1500,
        expectDataType: http.HttpDataType.STRING
      });
      if (response.responseCode < 200 || response.responseCode >= 300) {
        throw new Error(`电脑监控服务返回 HTTP ${response.responseCode}`);
      }
      this.failures = 0;
      this.retryAt = 0;
      this.updateStatus('正在向电脑发送实时遥测');
    } catch (error) {
      this.failures = Math.min(this.failures + 1, 4);
      this.retryAt = Date.now() + Math.min(8000, 750 * Math.pow(2, this.failures - 1));
      this.updateStatus(error instanceof Error ? `电脑监控连接失败，稍后重试：${error.message}` : '电脑监控连接失败，稍后重试');
    } finally {
      this.inFlight = false;
      request.destroy();
    }
  }

  private updateStatus(status: string): void {
    if (this.status === status) { return; }
    this.status = status;
    if (this.listener !== null) { this.listener(status); }
  }
}
