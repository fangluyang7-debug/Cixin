import { http } from '@kit.NetworkKit';
import { CloudApiConfig } from '../services/CloudApiConfig';

interface Reply<T> { success: boolean; data?: T; }
interface Pairing { code: string; expiresAt: string; }
interface Claimed { deviceId: string; ownerUserId: string; }
interface Device { id: string; status: string; }
interface Revoked { deviceId: string; status: string; }
interface Job { jobId: string; state: string; fence: number; computedMs: number | null; resultHash: string | null; }
interface LeasedJob { jobId: string; rows: number[][]; fence: number; }
interface Lease { job: LeasedJob | null; stopJobId: string | null; fence: number; }

@Entry
@Component
struct CloudPhoneDispatchPage {
  @State code: string = '';
  @State deviceId: string = '';
  @State jobId: string = '';
  @State status: string = '云端合成计算验收；不会处理购物数据';
  @State role: string = '未选择';
  @State workerRunning: boolean = false;
  @State slowMode: boolean = false;
  private timer: number = -1;
  private busy: boolean = false;

  aboutToDisappear(): void { this.stop(); }
  onPageHide(): void { this.stop(); }

  private async call<T>(method: http.RequestMethod, path: string, payload: string = '{}'): Promise<T> {
    await CloudApiConfig.ensureGuest();
    const client = http.createHttp();
    try {
      const response = await client.request(CloudApiConfig.getBaseUrl() + '/api/v1/runtime/phone-dispatch' + path, {
        method: method, header: CloudApiConfig.requestHeaders(), extraData: payload,
        connectTimeout: 10000, readTimeout: 15000
      });
      if (response.responseCode < 200 || response.responseCode >= 300 || typeof response.result !== 'string') {
        throw new Error('HTTP ' + response.responseCode);
      }
      const envelope = JSON.parse(response.result) as Reply<T>;
      if (!envelope.success || envelope.data === undefined) { throw new Error('API_REJECTED'); }
      return envelope.data;
    } finally { client.destroy(); }
  }

  private async createPairing(): Promise<void> {
    this.role = '发起端 A';
    try {
      const pairing = await this.call<Pairing>(http.RequestMethod.POST, '/pairings');
      this.code = pairing.code;
      this.status = '将下方配对码输入 B 手机；10 分钟有效';
    } catch (error) { this.status = '创建配对失败：' + (error as Error).message; }
  }

  private async claim(): Promise<void> {
    this.role = '执行端 B';
    try {
      const claimed = await this.call<Claimed>(http.RequestMethod.POST, '/pairings/claim',
        JSON.stringify({ code: this.code.trim() }));
      this.deviceId = claimed.deviceId;
      this.status = '配对成功；点击 B 开始接取';
    } catch (error) { this.status = '配对失败：' + (error as Error).message; }
  }

  private async refreshDevices(): Promise<void> {
    try {
      const devices = await this.call<Device[]>(http.RequestMethod.GET, '/devices');
      this.deviceId = devices.length > 0 ? devices[0].id : '';
      this.status = this.deviceId.length > 0 ? '已找到 B 手机，可派发' : '暂无已配对执行端';
    } catch (error) { this.status = '查询设备失败：' + (error as Error).message; }
  }

  private async submit(): Promise<void> {
    try {
      const job = await this.call<Job>(http.RequestMethod.POST, '/jobs',
        JSON.stringify({ deviceId: this.deviceId }));
      this.jobId = job.jobId;
      this.status = '任务已持久化；等待 B 接取';
    } catch (error) { this.status = '派发失败：' + (error as Error).message; }
  }

  private async revokeDevice(): Promise<void> {
    try {
      const revoked = await this.call<Revoked>(http.RequestMethod.POST,
        '/devices/' + encodeURIComponent(this.deviceId) + '/revoke');
      this.status = '设备已撤销：' + revoked.status;
    } catch (error) { this.status = '撤销设备失败：' + (error as Error).message; }
  }

  private async refreshJob(): Promise<void> {
    try {
      const job = await this.call<Job>(http.RequestMethod.GET, '/jobs/' + encodeURIComponent(this.jobId));
      this.status = '云端任务：' + job.state + (job.computedMs === null ? '' : '，B 计算 ' + job.computedMs + ' ms');
    } catch (error) { this.status = '查询失败：' + (error as Error).message; }
  }

  private async cancelJob(): Promise<void> {
    try {
      const job = await this.call<Job>(http.RequestMethod.POST, '/jobs/' + encodeURIComponent(this.jobId) + '/cancel');
      this.status = '撤销后状态：' + job.state + '；LEASED 须等待 B 停止回执';
    } catch (error) { this.status = '撤销失败：' + (error as Error).message; }
  }

  private startWorker(): void {
    if (this.deviceId.length === 0) { this.status = '请先在 B 手机配对'; return; }
    this.role = '执行端 B'; this.workerRunning = true; this.status = 'B 正在轮询云端任务';
    this.stopTimer();
    this.timer = setInterval(() => { this.workOnce().catch(() => {}); }, 1200);
  }

  private async workOnce(): Promise<void> {
    if (this.busy || !this.workerRunning) { return; }
    this.busy = true;
    try {
      const root = '/devices/' + encodeURIComponent(this.deviceId);
      const lease = await this.call<Lease>(http.RequestMethod.POST, root + '/lease');
      if (lease.stopJobId !== null) {
        await this.call<Job>(http.RequestMethod.POST, root + '/jobs/' + encodeURIComponent(lease.stopJobId) + '/stop-ack',
          JSON.stringify({ fence: lease.fence }));
        this.status = 'B 已确认停止：' + lease.stopJobId;
      } else if (lease.job !== null) {
        const job = lease.job;
        this.jobId = job.jobId;
        this.status = 'B 已接取：' + job.jobId;
        if (this.slowMode) {
          const waitUntil = Date.now() + 8000;
          while (Date.now() < waitUntil) {
            await new Promise<void>((resolve: () => void) => { setTimeout(resolve, 500); });
            const check = await this.call<Lease>(http.RequestMethod.POST, root + '/lease');
            if (check.stopJobId === job.jobId) {
              await this.call<Job>(http.RequestMethod.POST,
                root + '/jobs/' + encodeURIComponent(job.jobId) + '/stop-ack',
                JSON.stringify({ fence: job.fence }));
              this.status = 'B 已停止执行并回执：' + job.jobId;
              return;
            }
          }
        }
        const started = Date.now();
        const norms: number[] = [];
        for (const row of job.rows) { norms.push(Math.hypot(...row)); }
        const result = await this.call<Job>(http.RequestMethod.POST,
          root + '/jobs/' + encodeURIComponent(job.jobId) + '/result',
          JSON.stringify({ fence: job.fence, norms: norms, computedMs: Date.now() - started }));
        this.status = 'B 回执：' + result.state + '；512 条向量';
      }
    } catch (error) { this.status = 'B 轮询/执行失败：' + (error as Error).message; }
    finally { this.busy = false; }
  }

  private stopTimer(): void { if (this.timer !== -1) { clearInterval(this.timer); this.timer = -1; } }
  private stop(): void { this.workerRunning = false; this.stopTimer(); }

  build() {
    Scroll() {
      Column({ space: 14 }) {
        Text('云端双机派发验收').fontSize(23).fontWeight(FontWeight.Bold).width('100%')
        Text('仅用合成向量测试配对、派发、回执和取消。两台手机均需联网并配置相同的 HTTPS API。')
          .fontSize(13).fontColor('#66736D').width('100%')
        Button('A：生成配对码').onClick(() => { this.createPairing().catch(() => {}); }).width('100%')
        TextInput({ text: this.code, placeholder: 'A 显示的配对码；在 B 输入' })
          .onChange((value: string) => { this.code = value; }).width('100%')
        Button('B：领取配对').onClick(() => { this.claim().catch(() => {}); }).width('100%')
        Button('A：刷新已配对设备').onClick(() => { this.refreshDevices().catch(() => {}); }).width('100%')
        Button('A：撤销已配对设备').onClick(() => { this.revokeDevice().catch(() => {}); })
          .enabled(this.deviceId.length > 0).width('100%')
        Button('A：派发 512×8 向量任务').onClick(() => { this.submit().catch(() => {}); })
          .enabled(this.deviceId.length > 0).width('100%')
        Button('B：开始接取').onClick(() => this.startWorker())
          .enabled(this.deviceId.length > 0 && !this.workerRunning).width('100%')
        Button(this.slowMode ? 'B：关闭 8 秒延迟' : 'B：开启 8 秒延迟（取消测试）')
          .onClick(() => { this.slowMode = !this.slowMode; }).width('100%')
        Button('B：停止接取').onClick(() => this.stop())
          .enabled(this.workerRunning).width('100%')
        Button('A：刷新任务').onClick(() => { this.refreshJob().catch(() => {}); })
          .enabled(this.jobId.length > 0).width('100%')
        Button('A：取消任务').onClick(() => { this.cancelJob().catch(() => {}); })
          .enabled(this.jobId.length > 0).width('100%')
        Text('角色：' + this.role).fontSize(13).width('100%')
        Text(this.status).fontSize(14).fontColor('#134E42').width('100%')
        if (this.deviceId.length > 0) { Text('设备：' + this.deviceId).fontSize(11).width('100%') }
        if (this.jobId.length > 0) { Text('任务：' + this.jobId).fontSize(11).width('100%') }
      }.width('100%').padding(20)
    }.width('100%').height('100%').backgroundColor('#F8FAF9')
  }
}
