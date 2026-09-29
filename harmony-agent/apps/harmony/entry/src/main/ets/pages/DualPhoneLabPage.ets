import { http } from '@kit.NetworkKit';

interface LabJob {
  jobId: string;
  rows: number[][];
  inputHash: string;
  fence: number;
  deadlineAt: number;
}
interface LeaseEnvelope { job: LabJob | null; }
interface JobEnvelope {
  jobId: string;
  state: string;
  workerId: string | null;
  computeMs: number | null;
  inputHash: string;
  resultHash: string | null;
  error: string | null;
}
interface SubmitEnvelope { jobId: string; state: string; inputHash: string; }

// HDC reserves ports globally: A uses 8767, B uses 8766, both mapped to PC 8766.

@Entry
@Component
struct DualPhoneLabPage {
  @State code: string = '';
  @State status: string = '连接两台手机并启动电脑端联调服务';
  @State role: string = '未选择';
  @State jobId: string = '';
  @State running: boolean = false;
  @State result: string = '';
  private pollTimer: number = -1;
  private busy: boolean = false;

  aboutToDisappear(): void { this.running = false; this.stopPolling(); }
  onPageHide(): void { this.running = false; this.stopPolling(); }

  private async request<T>(method: http.RequestMethod, path: string, data: string = ''): Promise<T> {
    const client = http.createHttp();
    try {
      const port = this.role === '发起端 A' ? '8767' : '8766';
      const response = await client.request('http://127.0.0.1:' + port + path, {
        method: method,
        header: { 'Authorization': 'Bearer ' + this.code.trim(), 'Content-Type': 'application/json' },
        extraData: data,
        connectTimeout: 3000,
        readTimeout: 5000
      });
      if (response.responseCode < 200 || response.responseCode >= 300) {
        throw new Error('HTTP ' + response.responseCode);
      }
      return JSON.parse(response.result as string) as T;
    } finally { client.destroy(); }
  }

  private inputRows(): number[][] {
    const rows: number[][] = [];
    for (let i = 0; i < 512; i++) {
      const row: number[] = [];
      for (let j = 0; j < 8; j++) {
        row.push(((i * 37 + j * 19) % 997 - 498) / 10);
      }
      rows.push(row);
    }
    return rows;
  }

  private async submit(): Promise<void> {
    if (this.code.trim().length < 12 || this.running) {
      this.status = '请填写电脑端显示的配对码'; return;
    }
    this.role = '发起端 A'; this.running = true; this.result = '';
    try {
      const created = await this.request<SubmitEnvelope>(http.RequestMethod.POST, '/jobs',
        JSON.stringify({ rows: this.inputRows() }));
      this.jobId = created.jobId;
      this.status = '已派发，等待 B 接取任务';
      this.pollTimer = setInterval(() => { this.refresh().catch(() => {}); }, 1000);
    } catch (error) { this.status = '派发失败：' + (error as Error).message; this.running = false; }
  }

  private async refresh(): Promise<void> {
    if (this.jobId.length === 0 || this.busy) { return; }
    this.busy = true;
    try {
      const job = await this.request<JobEnvelope>(http.RequestMethod.GET, '/jobs/' + this.jobId);
      if (job.state === 'COMPLETED') {
        this.result = 'B 已实际完成 512 条、每条 8 维的向量范数计算；计算耗时 ' +
          job.computeMs + ' ms。输入/输出摘要见电脑端验收记录。';
        this.status = '双机任务完成，结果已校验'; this.running = false; this.stopPolling();
      } else if (job.state === 'FAILED' || job.state === 'EXPIRED' || job.state === 'CANCELLED') {
        this.status = '任务未完成：' + job.state + ' / ' + job.error; this.running = false; this.stopPolling();
      } else {
        this.status = job.state === 'LEASED' ? 'B 已接取任务，等待执行回执' : '等待 B 接取任务';
      }
    } catch (error) { this.status = '查询暂时失败：' + (error as Error).message; }
    finally { this.busy = false; }
  }

  private async cancel(): Promise<void> {
    if (this.jobId.length === 0) { return; }
    this.stopPolling(); this.status = '正在请求撤销';
    try {
      await this.request<JobEnvelope>(http.RequestMethod.POST, '/cancel',
        JSON.stringify({ jobId: this.jobId }));
      this.status = '已请求撤销；迟到回执将被拒绝'; this.running = false; this.stopPolling();
    } catch (error) {
      this.status = '撤销失败：' + (error as Error).message;
      this.pollTimer = setInterval(() => { this.refresh().catch(() => {}); }, 1000);
    }
  }

  private startWorker(): void {
    if (this.code.trim().length < 12) { this.status = '请填写电脑端显示的配对码'; return; }
    this.role = '执行端 B'; this.running = true; this.status = '等待任务，保持本页在前台';
    this.stopPolling();
    this.pollTimer = setInterval(() => { this.workOnce().catch(() => {}); }, 800);
  }

  private async workOnce(): Promise<void> {
    if (this.busy || !this.running || this.role !== '执行端 B') { return; }
    this.busy = true;
    try {
      const lease = await this.request<LeaseEnvelope>(http.RequestMethod.POST, '/lease',
        JSON.stringify({ workerId: 'phone-B' }));
      if (lease.job !== null) {
        const job = lease.job;
        this.jobId = job.jobId;
        this.status = 'B 已接取任务，正在本机计算';
        const start = Date.now();
        const norms: number[] = [];
        for (const row of job.rows) {
          norms.push(Math.hypot(...row));
        }
        const computeMs = Date.now() - start;
        const receipt = await this.request<JobEnvelope>(http.RequestMethod.POST, '/result',
          JSON.stringify({ jobId: job.jobId, workerId: 'phone-B', fence: job.fence,
            norms: norms, computeMs: computeMs }));
        this.result = receipt.state === 'COMPLETED' ? '本机计算与协调器复核一致；' +
          norms.length + ' 条向量，' + computeMs + ' ms。' : '结果未通过复核';
        this.status = receipt.state === 'COMPLETED' ? '已回传并完成物理结算' : '回执失败';
      }
    } catch (error) { this.status = 'B 连接/执行失败：' + (error as Error).message; }
    finally { this.busy = false; }
  }

  private stopPolling(): void {
    if (this.pollTimer !== -1) { clearInterval(this.pollTimer); this.pollTimer = -1; }
  }
  private stopWorker(): void {
    this.running = false; this.stopPolling(); this.status = 'B 已停止接取新任务';
  }

  build() {
    Column({ space: 16 }) {
      Text('双机派发联调').fontSize(24).fontWeight(FontWeight.Bold).width('100%')
      Text('仅使用合成向量和 USB 调试隧道；不会发送商品、图片或对话内容。')
        .fontSize(13).fontColor('#666666').width('100%')
      TextInput({ text: this.code, placeholder: '电脑端显示的配对码' })
        .type(InputType.Password).onChange((value: string) => { this.code = value; })
        .width('100%')
      Row({ space: 8 }) {
        Button('A：派发任务').onClick(() => { this.submit().catch(() => {}); })
          .enabled(!this.running).layoutWeight(1)
        Button('B：开始接取').onClick(() => this.startWorker())
          .enabled(!this.running).layoutWeight(1)
      }.width('100%')
      Row({ space: 8 }) {
        Button('取消任务').onClick(() => { this.cancel().catch(() => {}); })
          .enabled(this.jobId.length > 0 && this.role === '发起端 A' && this.running).layoutWeight(1)
        Button('停止接取').onClick(() => this.stopWorker())
          .enabled(this.role === '执行端 B' && this.running).layoutWeight(1)
      }.width('100%')
      Text('当前角色：' + this.role).fontSize(15).width('100%')
      Text(this.status).fontSize(15).fontColor('#134E42').width('100%')
      if (this.jobId.length > 0) {
        Text('任务 ID：' + this.jobId).fontSize(11).fontColor('#777777').width('100%')
      }
      if (this.result.length > 0) {
        Text(this.result).fontSize(14).fontColor('#333333').width('100%')
      }
    }.width('100%').height('100%').padding(20).backgroundColor('#F8FAF9')
  }
}
