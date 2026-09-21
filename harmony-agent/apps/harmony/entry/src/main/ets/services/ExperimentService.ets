import { common } from '@kit.AbilityKit';
import deviceInfo from '@ohos.deviceInfo';
import picker from '@ohos.file.picker';
import fs from '@ohos.file.fs';
import { ConstrainedPolicyConfig, PolicyMode, SchedulerLogEntry, SchedulerService, WorkflowHandle, Unsubscribe } from 'scheduler';
import { Product } from '../models/Product';
import { DataInitService } from './DataInitService';
import { NeuralEmbeddingIndex } from './NeuralEmbeddingIndex';
import { ShoppingTaskService } from './ShoppingTaskService';
import { ExperimentTrial, exportTrialRecords } from './ExperimentRecords';

// A separate bounded capture survives the SDK's rolling audit window.
export class ExperimentService {
  private static instance: ExperimentService | null = null;
  private activeSearch: WorkflowHandle<Product[]> | null = null;
  private activeBackground: WorkflowHandle<number> | null = null;
  private unsubscribe: Unsubscribe | null = null;
  private events: SchedulerLogEntry[] = [];
  private trials: ExperimentTrial[] = [];
  private droppedEvents: number = 0;
  private cancelled: boolean = false;
  private running: boolean = false;
  private id: string = '';
  private finishedAt: number = 0;
  private error: string = '';
  private order: string[] = [];
  private constrainedPolicyAtStart: ConstrainedPolicyConfig | null = null;

  public static getInstance(): ExperimentService {
    if (ExperimentService.instance === null) { ExperimentService.instance = new ExperimentService(); }
    return ExperimentService.instance;
  }
  public isRunning(): boolean { return this.running; }

  public async cancel(): Promise<void> {
    this.cancelled = true;
    if (this.activeSearch !== null) { await this.activeSearch.cancel(); }
    if (this.activeBackground !== null) { await this.activeBackground.cancel(); }
  }

  public async run(): Promise<number> {
    if (this.running) { throw new Error('实验正在进行'); }
    const scheduler = SchedulerService.getInstance();
    const shopping = ShoppingTaskService.getInstance();
    if (scheduler.isPaused()) { throw new Error('请先恢复全局调度'); }
    const metrics = scheduler.getMetricsSnapshot();
    if (metrics.runningCount > 0 || metrics.queuedCount > 0) { throw new Error('请等待现有任务结束或取消暂停任务后再开始实验'); }
    const previous = scheduler.getPolicyMode();
    this.constrainedPolicyAtStart = scheduler.getConstrainedPolicy();
    this.running = true; this.cancelled = false; this.events = []; this.trials = [];
    this.droppedEvents = 0; this.finishedAt = 0; this.error = ''; this.order = [];
    this.id = `phone-${Date.now()}`;
    this.unsubscribe = scheduler.registerLogCallback((entry: SchedulerLogEntry) => {
      if (this.events.length < 20000) {
        this.events.push(JSON.parse(JSON.stringify(entry)) as SchedulerLogEntry);
      } else { this.droppedEvents++; }
    });
    try {
      await DataInitService.waitUntilReady();
      const modes: PolicyMode[] = [PolicyMode.FIXED_PERFORMANCE, PolicyMode.FIXED_POWER_SAVING, PolicyMode.ADAPTIVE];
      const queries: string[] = ['运动鞋', '耐克500元以内', '华为'];
      const queryIds: string[] = ['shoes', 'nike_under_500', 'huawei'];
      // Rotate order across repetitions; log order so thermal/order effects remain visible.
      for (let repetition: number = 0; repetition < 3 && !this.cancelled; repetition++) {
        for (let offset: number = 0; offset < 3 && !this.cancelled; offset++) {
          const mode = modes[(offset + repetition) % modes.length];
          await scheduler.setPolicyMode(mode);
          for (let group: number = 0; group < 2 && !this.cancelled; group++) {
            const background: boolean = (group + repetition) % 2 === 1;
            this.order.push(`${repetition}:${mode}:${background}`);
            for (let q: number = 0; q < queries.length && !this.cancelled; q++) {
              const policy = scheduler.getConstrainedPolicy();
              const started: number = Date.now();
              this.activeBackground = background ? shopping.warmup() : null;
              let backgroundEnd: number | null = null;
              const backgroundPromise = this.activeBackground === null ? null : this.activeBackground.result.then((result) => {
                backgroundEnd = Date.now(); return result;
              });
              this.activeSearch = shopping.search(queries[q]);
              const result = await this.activeSearch.result;
              const searchEnd: number = Date.now();
              // Bound experiment duration under thermal pause; cancellation still waits for actual settlement.
              const pending = this.activeBackground;
              const watchdog: number = setTimeout(() => { if (pending !== null) { pending.cancel(); } }, 10000);
              let backgroundStatus: string = 'not_requested';
              let rows: number = 0;
              try {
                if (backgroundPromise !== null) {
                  const completed = await backgroundPromise;
                  backgroundStatus = completed.status; rows = completed.output ?? 0;
                }
              } finally { clearTimeout(watchdog); }
              this.trials.push({ mode: mode, background: background, repetition: repetition,
                queryId: queryIds[q], startedAt: started, durationMs: searchEnd - started,
                status: result.status, workflowId: result.workflowId,
                backgroundWorkflowId: this.activeBackground?.workflowId ?? null,
                constrainedPolicyVersion: policy.version, constrainedPolicyMode: policy.mode,
                productIds: (result.output ?? []).map((product: Product) => product.externalId),
                backgroundDurationMs: backgroundEnd === null ? null : backgroundEnd - started,
                backgroundStatus: backgroundStatus, backgroundRows: rows,
                samplePhase: this.trials.length === 0 ? 'first_in_session_not_cold_proof' : 'subsequent_in_session' });
              this.activeSearch = null; this.activeBackground = null;
            }
          }
        }
      }
    } catch (error) {
      this.error = `${error}`;
      await this.cancel();
      // Keep capture active until all work settles, including exceptional setup paths.
      try { if (this.activeSearch !== null) { await this.activeSearch.result; } } catch (ignored) {}
      try { if (this.activeBackground !== null) { await this.activeBackground.result; } } catch (ignored) {}
      throw new Error(this.error);
    } finally {
      this.unsubscribe?.(); this.unsubscribe = null;
      this.finishedAt = Date.now(); this.running = false;
      if (scheduler.isInitialized()) { await scheduler.setPolicyMode(previous); }
    }
    return this.trials.length;
  }

  public exportJson(includeQualityIds: boolean = false): string {
    if (this.running || this.id.length === 0) { throw new Error('请先运行并结束实验'); }
    return JSON.stringify({ schemaVersion: 2, experimentId: this.id, finishedAt: this.finishedAt,
      comparisonScope: 'LEGACY_MODE_OBSERVATION_WITH_CONSTRAINED_PROFILES',
      constrainedPolicyAtStart: this.constrainedPolicyAtStart,
      qualityEvaluationIncluded: includeQualityIds,
      deviceModel: deviceInfo.productModel, systemVersion: deviceInfo.osFullName,
      model: NeuralEmbeddingIndex.getInstance().getModelInfo(), cancelled: this.cancelled,
      error: this.error, droppedEvents: this.droppedEvents, modeOrder: this.order,
      measurementNotes: 'Legacy PolicyMode does not select manifest profiles. Compare actual policy/profile audit groups, not mode labels alone. Thread telemetry is configured runtime threads/partitions; power is not measured.',
      trials: exportTrialRecords(this.trials, includeQualityIds), events: this.events }, null, 2);
  }

  public async save(context: common.Context, includeQualityIds: boolean = false): Promise<string> {
    const text: string = this.exportJson(includeQualityIds);
    const options = new picker.DocumentSaveOptions();
    options.newFileNames = [`${this.id}.json`];
    const uris: string[] = await new picker.DocumentViewPicker(context).save(options);
    if (uris.length === 0) { return '已取消保存'; }
    const file = fs.openSync(uris[0], fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
    try { fs.writeSync(file.fd, text); } finally { fs.closeSync(file); }
    return '实验 JSON 已保存';
  }
}
