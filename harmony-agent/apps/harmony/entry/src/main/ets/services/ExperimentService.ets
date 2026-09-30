import { common } from '@kit.AbilityKit';
import deviceInfo from '@ohos.deviceInfo';
import picker from '@ohos.file.picker';
import fs from '@ohos.file.fs';
import { ConstrainedPolicyConfig, PolicyMode, SchedulerLogEntry, SchedulerService, TaskStatus, WorkflowHandle, Unsubscribe } from 'scheduler';
import { Product } from '../models/Product';
import { DataInitService } from './DataInitService';
import { NeuralEmbeddingIndex, VectorSearchTelemetry } from './NeuralEmbeddingIndex';
import { OfflineDiagnosticService } from './OfflineDiagnosticService';
import { ExperimentTrial, exportTrialRecords } from './ExperimentRecords';

interface DirectComparisonTrial {
  repetition: number;
  queryId: string;
  order: string;
  directWorkers: number;
  directDimensions: number;
  directDurationMs: number;
  scheduledDurationMs: number;
  scheduledQueueMs: number | null;
  scheduledExecutionMs: number | null;
  directStatus: string;
  scheduledStatus: string;
  scheduledProfileId: string;
  directProductIds: string[];
  scheduledProductIds: string[];
}

// A separate bounded capture survives the SDK's rolling audit window.
export class ExperimentService {
  private static instance: ExperimentService | null = null;
  private activeSearch: WorkflowHandle<Product[]> | null = null;
  private activeBackground: WorkflowHandle<number> | null = null;
  private unsubscribe: Unsubscribe | null = null;
  private events: SchedulerLogEntry[] = [];
  private trials: ExperimentTrial[] = [];
  private directComparisons: DirectComparisonTrial[] = [];
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
  public wasCancelled(): boolean { return this.cancelled; }

  public async cancel(): Promise<void> {
    this.cancelled = true;
    if (this.activeSearch !== null) { await this.activeSearch.cancel(); }
    if (this.activeBackground !== null) { await this.activeBackground.cancel(); }
  }

  public async run(context: common.Context): Promise<number> {
    if (this.running) { throw new Error('实验正在进行'); }
    const scheduler = SchedulerService.getInstance();
    const diagnostic = OfflineDiagnosticService.getInstance();
    if (scheduler.isPaused()) { throw new Error('请先恢复全局调度'); }
    const metrics = scheduler.getMetricsSnapshot();
    if (metrics.runningCount > 0 || metrics.queuedCount > 0) { throw new Error('请等待现有任务结束或取消暂停任务后再开始实验'); }
    const previous = scheduler.getPolicyMode();
    this.constrainedPolicyAtStart = scheduler.getConstrainedPolicy();
    this.running = true; this.cancelled = false; this.events = []; this.trials = []; this.directComparisons = [];
    this.droppedEvents = 0; this.finishedAt = 0; this.error = ''; this.order = [];
    this.id = `phone-${Date.now()}`;
    this.unsubscribe = scheduler.registerLogCallback((entry: SchedulerLogEntry) => {
      if (this.events.length < 20000) {
        this.events.push(JSON.parse(JSON.stringify(entry)) as SchedulerLogEntry);
      } else { this.droppedEvents++; }
    });
    try {
      await DataInitService.checkAndInitData(context);
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
              this.activeBackground = background ? diagnostic.warmup() : null;
              let backgroundEnd: number | null = null;
              const backgroundPromise = this.activeBackground === null ? null : this.activeBackground.result.then((result) => {
                backgroundEnd = Date.now(); return result;
              });
              this.activeSearch = diagnostic.search(queries[q]);
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
              if (!this.cancelled && (result.status !== TaskStatus.SUCCEEDED ||
                (background && backgroundStatus !== TaskStatus.SUCCEEDED))) {
                throw new Error(`DIAGNOSTIC_TASK_FAILED:search=${result.status}:${result.reasonCode ?? 'unknown'},background=${backgroundStatus}`);
              }
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

  // Same packaged index and query set, but the direct arm bypasses SchedulerService.
  // Alternating the order reduces warm-cache and thermal order bias; this is not a power benchmark.
  public async runDirectComparison(context: common.Context): Promise<number> {
    if (this.running) { throw new Error('实验正在进行'); }
    const scheduler = SchedulerService.getInstance();
    const diagnostic = OfflineDiagnosticService.getInstance();
    const metrics = scheduler.getMetricsSnapshot();
    if (scheduler.isPaused() || metrics.runningCount > 0 || metrics.queuedCount > 0) {
      throw new Error('请先恢复调度并等待现有任务结束');
    }
    this.running = true; this.cancelled = false; this.directComparisons = [];
    if (this.id.length === 0) { this.id = `phone-${Date.now()}`; }
    const queries: string[] = ['运动鞋', '耐克500元以内', '华为'];
    const queryIds: string[] = ['shoes', 'nike_under_500', 'huawei'];
    try {
      await DataInitService.checkAndInitData(context);
      for (let repetition: number = 0; repetition < 6 && !this.cancelled; repetition++) {
        for (let q: number = 0; q < queries.length && !this.cancelled; q++) {
          const directFirst: boolean = (repetition + q) % 2 === 0;
          let directDurationMs: number = 0;
          let scheduledDurationMs: number = 0;
          let directStatus: string = 'not_run';
          let scheduledStatus: string = 'not_run';
          let scheduledProfileId: string = '';
          let scheduledQueueMs: number | null = null;
          let scheduledExecutionMs: number | null = null;
          let directProducts: Product[] = [];
          let scheduledProducts: Product[] = [];
          for (let arm: number = 0; arm < 2; arm++) {
            if (this.cancelled) { break; }
            const direct: boolean = arm === 0 ? directFirst : !directFirst;
            const started: number = Date.now();
            if (direct) {
              try {
                directProducts = await this.runDirectSearch(queries[q]);
                directStatus = 'SUCCEEDED';
              } catch (error) { directStatus = `FAILED:${error}`; }
              directDurationMs = Date.now() - started;
            } else {
              try {
                this.activeSearch = diagnostic.search(queries[q]);
                const result = await this.activeSearch.result;
                scheduledStatus = result.status;
                scheduledProducts = result.output ?? [];
                const last = result.nodes.length > 0 ? result.nodes[result.nodes.length - 1] : null;
                scheduledProfileId = last?.executionPlan.executionProfile?.id ?? '';
                scheduledQueueMs = last?.queueDurationMs ?? null;
                scheduledExecutionMs = last?.executionDurationMs ?? null;
              } catch (error) { scheduledStatus = `FAILED:${error}`; }
              finally { this.activeSearch = null; }
              scheduledDurationMs = Date.now() - started;
            }
          }
          this.directComparisons.push({ repetition: repetition, queryId: queryIds[q],
            order: directFirst ? 'direct_then_scheduled' : 'scheduled_then_direct',
            directWorkers: 1, directDimensions: 256,
            directDurationMs: directDurationMs, scheduledDurationMs: scheduledDurationMs,
            scheduledQueueMs: scheduledQueueMs, scheduledExecutionMs: scheduledExecutionMs,
            directStatus: directStatus, scheduledStatus: scheduledStatus,
            scheduledProfileId: scheduledProfileId,
            directProductIds: directProducts.map((item: Product) => item.externalId),
            scheduledProductIds: scheduledProducts.map((item: Product) => item.externalId) });
        }
      }
    } finally { this.finishedAt = Date.now(); this.running = false; }
    const path: string = `${context.filesDir}/scheduler-comparison.json`;
    const file = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
    try { fs.writeSync(file.fd, this.exportJson(true)); } finally { fs.closeSync(file); }
    return this.directComparisons.length;
  }

  private async runDirectSearch(query: string): Promise<Product[]> {
    const index = NeuralEmbeddingIndex.getInstance();
    // SEARCH_SAFE is the actual steady-state profile on the acceptance device.
    // Keep the no-scheduler arm on the same one-worker, 256-dimension workload.
    const vector = await index.encodeQuery(query, 1);
    const measured: VectorSearchTelemetry = { executionPath: '', configuredPartitions: 0, scannedCount: 0 };
    const results = await index.searchVector(vector, 256, 1, 6, false, query, measured);
    return results.map((item) => item.product);
  }

  public directComparisonSummary(): string {
    const valid = this.directComparisons.filter((item: DirectComparisonTrial) =>
      item.directStatus === 'SUCCEEDED' && item.scheduledStatus === TaskStatus.SUCCEEDED);
    if (valid.length === 0) { return `直调对照 ${this.directComparisons.length} 对，无双端成功样本`; }
    const comparableTrials = valid.filter((item: DirectComparisonTrial) => item.scheduledProfileId === 'SEARCH_SAFE');
    const matching: number = valid.filter((item: DirectComparisonTrial) =>
      JSON.stringify(item.directProductIds.slice().sort()) === JSON.stringify(item.scheduledProductIds.slice().sort())).length;
    const profiles: string[] = Array.from(new Set(valid.map((item: DirectComparisonTrial) => item.scheduledProfileId)));
    if (comparableTrials.length === 0) {
      return `直调/调度 ${valid.length}/${this.directComparisons.length} 对；同配置 0 对，不比较耗时；配置 ${profiles.join(',')}；结果一致 ${matching} 对。`;
    }
    const direct = comparableTrials.map((item: DirectComparisonTrial) => item.directDurationMs).sort((a: number, b: number) => a - b);
    const scheduled = comparableTrials.map((item: DirectComparisonTrial) => item.scheduledDurationMs).sort((a: number, b: number) => a - b);
    const median: number = Math.floor(comparableTrials.length / 2);
    const p95: number = Math.ceil(comparableTrials.length * 0.95) - 1;
    const queue = comparableTrials.filter((item: DirectComparisonTrial) => item.scheduledQueueMs !== null)
      .map((item: DirectComparisonTrial) => item.scheduledQueueMs as number).sort((a: number, b: number) => a - b);
    const execution = comparableTrials.filter((item: DirectComparisonTrial) => item.scheduledExecutionMs !== null)
      .map((item: DirectComparisonTrial) => item.scheduledExecutionMs as number).sort((a: number, b: number) => a - b);
    const queueMedian: string = queue.length > 0 ? `${queue[Math.floor(queue.length / 2)]}` : '缺失';
    const executionMedian: string = execution.length > 0 ? `${execution[Math.floor(execution.length / 2)]}` : '缺失';
    return `直调/调度 ${valid.length}/${this.directComparisons.length} 对；同配置 ${comparableTrials.length} 对；P50 ${direct[median]}/${scheduled[median]} ms；P95 ${direct[p95]}/${scheduled[p95]} ms；排队/执行 P50 ${queueMedian}/${executionMedian} ms；配置 ${profiles.join(',')}；结果一致 ${matching} 对。`;
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
      trials: exportTrialRecords(this.trials, includeQualityIds), directComparisons: this.directComparisons,
      events: this.events }, null, 2);
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
