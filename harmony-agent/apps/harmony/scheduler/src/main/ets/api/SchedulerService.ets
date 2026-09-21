import {
  CancellationSignal,
  DebugStatePatch,
  DeviceState,
  ExecutionPlan,
  ExecutorResult,
  InferenceLocation,
  LocalExecutionPlan,
  MetricsSnapshot,
  ModelTier,
  PolicyMode,
  QueueAction,
  RealDeviceStatePatch,
  SchedulerConfig,
  SchedulerLogCallback,
  SchedulerLogEntry,
  StateCallback,
  TaskExecutor,
  TaskHandle,
  TaskPriority,
  TaskProfile,
  TaskRequest,
  TaskResult,
  TaskStatus,
  TaskType,
  Unsubscribe,
  WorkloadExecutor
} from './SchedulerTypes';
import { SchedulerError, SchedulerErrorCode } from './SchedulerError';
import { ExecutorTelemetry, Interruptibility, MemoryPressure, TaskCheckpoint, TaskSignal, TaskSignalType, TaskTelemetry, ThermalLevel } from './SchedulerTypes';
import { qualityRank, SemanticPolicy } from '../policy/SemanticPolicy';
import { SchedulerRuntime } from './SchedulerClient';
import { HysteresisController } from '../policy/HysteresisController';
import { SchedulerPolicy } from '../policy/SchedulerPolicy';
import { DeviceStateController } from '../state/DeviceStateController';
import { CancellationController } from '../executor/CancellationController';
import { ExecutorRegistry } from '../executor/ExecutorRegistry';
import { QueueItem, TaskQueue } from '../queue/TaskQueue';

const DEFAULT_METRICS_WINDOW_SIZE: number = 100;
const MAX_LOG_HISTORY_SIZE: number = 500;

type InternalExecute = (plan: ExecutionPlan, signal: CancellationSignal,
  checkpoint?: TaskCheckpoint) => Promise<ExecutorResult<Object>>;
type InternalComplete = (result: TaskResult<Object>) => void;
type CancelCallback = () => Promise<boolean>;
type StatusCallback = () => TaskStatus;

interface InternalTask extends QueueItem {
  capability: string;
  profile: TaskProfile;
  plan: ExecutionPlan;
  execute: InternalExecute;
  supports: (plan: ExecutionPlan) => boolean;
  cancellation: CancellationController;
  status: TaskStatus;
  queuedAt: number;
  startedAt: number | null;
  complete: InternalComplete;
  manualPaused: boolean;
  checkpoint?: TaskCheckpoint;
  checkpointCount: number;
  activeDurationMs: number;
  queueDurationMs: number;
  lastEnqueuedAt: number;
  expiryTimer: number;
  stopReason?: string;
  stopRequestedAt?: number;
  actual?: ExecutorTelemetry;
  executionState?: DeviceState;
  manualPriority?: TaskPriority;
  lastSliceDurationMs: number;
}

class TaskDeferred<TOutput> {
  public readonly promise: Promise<TaskResult<TOutput>>;
  private resolver: ((result: TaskResult<TOutput>) => void) | null = null;

  constructor() {
    this.promise = new Promise<TaskResult<TOutput>>((resolve) => {
      this.resolver = resolve;
    });
  }

  public complete(result: TaskResult<TOutput>): void {
    if (this.resolver === null) {
      return;
    }
    const resolve: (result: TaskResult<TOutput>) => void = this.resolver;
    this.resolver = null;
    resolve(result);
  }
}

class SchedulerTaskHandle<TOutput> implements TaskHandle<TOutput> {
  public readonly taskId: string;
  public readonly result: Promise<TaskResult<TOutput>>;
  private readonly cancelCallback: CancelCallback;
  private readonly statusCallback: StatusCallback;

  constructor(
    taskId: string,
    result: Promise<TaskResult<TOutput>>,
    cancelCallback: CancelCallback,
    statusCallback: StatusCallback
  ) {
    this.taskId = taskId;
    this.result = result;
    this.cancelCallback = cancelCallback;
    this.statusCallback = statusCallback;
  }

  public cancel(): Promise<boolean> {
    return this.cancelCallback();
  }

  public getStatus(): TaskStatus {
    return this.statusCallback();
  }
}

class FunctionWorkloadExecutor<TInput, TOutput> implements WorkloadExecutor<TInput, TOutput> {
  public readonly capability: string;
  public readonly inferenceLocation: InferenceLocation;
  private readonly callback: TaskExecutor<TInput, TOutput>;

  constructor(
    capability: string,
    inferenceLocation: InferenceLocation,
    callback: TaskExecutor<TInput, TOutput>
  ) {
    this.capability = capability;
    this.inferenceLocation = inferenceLocation;
    this.callback = callback;
  }

  public supports(plan: ExecutionPlan): boolean {
    return plan.inferenceLocation === this.inferenceLocation;
  }

  public async execute(
    input: TInput,
    plan: ExecutionPlan,
    signal: CancellationSignal
  ): Promise<ExecutorResult<TOutput>> {
    if (signal.isCancellationRequested) {
      throw new SchedulerError(SchedulerErrorCode.TASK_CANCELLED, 'Task was cancelled before execution.');
    }
    const output: TOutput = await this.callback(input, plan, signal);
    if (signal.isCancellationRequested) {
      throw new SchedulerError(SchedulerErrorCode.TASK_CANCELLED, 'Task result was discarded after cancellation.');
    }
    return { output: output };
  }

  public async dispose(): Promise<void> {
  }
}

export class SchedulerService implements SchedulerRuntime {
  private static instance: SchedulerService | null = null;

  private initialized: boolean = false;
  private freshnessTimer: number = -1;
  private policyMode: PolicyMode = PolicyMode.ADAPTIVE;
  private config: SchedulerConfig | null = null;
  private policy: SchedulerPolicy | null = null;
  private semanticPolicy: SemanticPolicy = new SemanticPolicy();
  private hysteresis: HysteresisController | null = null;
  private stateController: DeviceStateController | null = null;
  private executorRegistry: ExecutorRegistry | null = null;
  private taskQueue: TaskQueue<InternalTask> | null = null;
  private tasks: Map<string, InternalTask> = new Map<string, InternalTask>();
  private runningTask: InternalTask | null = null;
  private processorPromise: Promise<void> | null = null;
  private schedulerPaused: boolean = false;
  private nextTaskSequence: number = 0;
  private evaluationCount: number = 0;
  private stateCallbacks: StateCallback[] = [];
  private logCallbacks: SchedulerLogCallback[] = [];
  private logHistory: SchedulerLogEntry[] = [];
  private policySwitchCount: number = 0;

  public constructor() {
  }

  public static getInstance(): SchedulerService {
    if (SchedulerService.instance === null) {
      SchedulerService.instance = new SchedulerService();
    }
    return SchedulerService.instance;
  }

  public async initialize(config: SchedulerConfig): Promise<void> {
    if (this.initialized) {
      throw new SchedulerError(
        SchedulerErrorCode.ALREADY_INITIALIZED,
        'Scheduler must be shut down before it is initialized again.'
      );
    }

    this.validateConfig(config);
    this.config = config;
    this.policyMode = config.defaultPolicyMode;
    this.policy = new SchedulerPolicy();
    this.semanticPolicy = new SemanticPolicy();
    this.hysteresis = new HysteresisController(
      config.upgradeStableDurationMs,
      config.minimumTierHoldMs
    );
    this.stateController = new DeviceStateController();
    this.executorRegistry = new ExecutorRegistry();
    this.taskQueue = new TaskQueue<InternalTask>();
    this.tasks = new Map<string, InternalTask>();
    this.runningTask = null;
    this.processorPromise = null;
    this.schedulerPaused = false;
    this.nextTaskSequence = 0;
    this.evaluationCount = 0;
    this.logHistory = [];
    this.policySwitchCount = 0;
    this.initialized = true;
    this.freshnessTimer = setInterval(() => { if (this.initialized) { this.updateRealDeviceState({}); } }, 1000);
    this.notifyStateCallbacks();
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public getPolicyMode(): PolicyMode {
    this.requireInitialized();
    return this.policyMode;
  }

  public getCurrentPolicy(): PolicyMode {
    return this.getPolicyMode();
  }

  public isPaused(): boolean {
    this.requireInitialized();
    return this.schedulerPaused;
  }

  public async setPolicyMode(mode: PolicyMode): Promise<void> {
    this.requireInitialized();
    if (this.policyMode === mode) {
      return;
    }
    this.policyMode = mode;
    this.policySwitchCount++;
    if (this.hysteresis !== null) {
      this.hysteresis.reset();
    }
    this.refreshQueuedPlans();
    this.notifyStateCallbacks();
    this.scheduleDrain();
  }

  public async pause(): Promise<void> {
    this.requireInitialized();
    if (this.schedulerPaused) {
      return;
    }
    this.schedulerPaused = true;
    this.notifyStateCallbacks();
  }

  public async resume(): Promise<void> {
    this.requireInitialized();
    if (!this.schedulerPaused) {
      return;
    }
    this.schedulerPaused = false;
    this.notifyStateCallbacks();
    this.scheduleDrain();
  }

  public evaluate(profile: TaskProfile, state?: DeviceState): ExecutionPlan {
    this.requireInitialized();
    if (this.policy === null || this.hysteresis === null) {
      throw new SchedulerError(
        SchedulerErrorCode.INTERNAL_ERROR,
        'Scheduler policy components are unavailable.'
      );
    }
    this.evaluationCount++;
    const stateSnapshot: DeviceState = state === undefined ? this.getDeviceState() : state;
    if (profile.template !== undefined && profile.context !== undefined) {
      const candidate = this.semanticPolicy.evaluate(profile, stateSnapshot, this.policyMode);
      if (candidate.inferenceLocation !== InferenceLocation.LOCAL_DEVICE || this.policyMode !== PolicyMode.ADAPTIVE ||
        candidate.queueAction === QueueAction.REJECT || candidate.queueAction === QueueAction.PAUSE) { return candidate; }
      const key: string = `semantic:${profile.capability}`;
      const held = this.hysteresis.apply(candidate as LocalExecutionPlan, Date.now(), key);
      if (held.modelTier === (candidate as LocalExecutionPlan).modelTier) { return candidate; }
      // Re-evaluate declared levels instead of inventing thread counts or violating the quality floor.
      const stable = this.semanticPolicy.evaluate(profile, stateSnapshot, this.policyMode, held.modelTier);
      if (stable.queueAction === QueueAction.REJECT) { this.hysteresis.reset(key); return candidate; }
      stable.reasonCodes.push('SEMANTIC_UPGRADE_STABILITY_WAIT');
      return stable;
    }
    const candidate: ExecutionPlan = this.policy.evaluate(profile, stateSnapshot, this.policyMode);
    candidate.reasonCodes.push('SEMANTICS_UNSPECIFIED');
    if (candidate.inferenceLocation === InferenceLocation.REMOTE_CLOUD) {
      return candidate;
    }
    if (this.policyMode !== PolicyMode.ADAPTIVE) {
      return candidate;
    }
    if (!this.shouldApplyHysteresis(profile)) {
      return candidate;
    }
    return this.hysteresis.apply(candidate as LocalExecutionPlan, Date.now(), this.createHysteresisKey(profile));
  }

  public async schedule<TInput, TOutput>(
    request: TaskRequest<TInput>,
    executor: TaskExecutor<TInput, TOutput>
  ): Promise<TaskResult<TOutput>> {
    return this.runTask(request, executor);
  }

  public async runTask<TInput, TOutput>(
    request: TaskRequest<TInput>,
    executor: TaskExecutor<TInput, TOutput>
  ): Promise<TaskResult<TOutput>> {
    this.requireInitialized();
    const adapter: FunctionWorkloadExecutor<TInput, TOutput> =
      new FunctionWorkloadExecutor<TInput, TOutput>(
        request.capability,
        request.inferenceLocation,
        executor
      );
    this.requireExecutorRegistry().register(adapter);
    try {
      const handle: TaskHandle<TOutput> = await this.submitTask<TInput, TOutput>(request);
      return await handle.result;
    } finally {
      if (this.executorRegistry !== null) {
        await this.executorRegistry.unregisterInstance(adapter);
      }
    }
  }

  public registerExecutor<TInput, TOutput>(executor: WorkloadExecutor<TInput, TOutput>): void {
    this.requireInitialized();
    if (executor.capability.trim().length === 0) {
      throw new SchedulerError(SchedulerErrorCode.INVALID_CONFIG, 'Executor capability must not be empty.');
    }
    this.requireExecutorRegistry().register(executor);
  }

  public async unregisterExecutor(capability: string): Promise<number> {
    this.requireInitialized();
    const active: InternalTask | undefined = Array.from(this.tasks.values()).find(
      (task: InternalTask) => task.capability === capability
    );
    if (active !== undefined) {
      throw new SchedulerError(
        SchedulerErrorCode.INVALID_TASK,
        `Cannot unregister executor while capability ${capability} has unfinished tasks.`
      );
    }
    return this.requireExecutorRegistry().unregister(capability);
  }

  public async submitTask<TInput, TOutput>(request: TaskRequest<TInput>): Promise<TaskHandle<TOutput>> {
    this.requireInitialized();
    this.validateTaskRequest(request);

    const taskId: string = this.resolveTaskId(request.taskId);
    if (this.tasks.has(taskId)) {
      throw new SchedulerError(SchedulerErrorCode.INVALID_TASK, `Task ID ${taskId} is already active.`);
    }

    const profile: TaskProfile = this.createTaskProfile(request);
    const deviceState: DeviceState = this.getDeviceState();
    const plan: ExecutionPlan = this.evaluate(profile, deviceState);
    const queuedAt: number = Date.now();
    if (plan.queueAction === QueueAction.REJECT && request.template === undefined) {
      throw new SchedulerError(
        SchedulerErrorCode.THERMAL_PROTECTION,
        `Task ${taskId} was rejected by the current safety policy.`
      );
    }

    const executor: WorkloadExecutor<TInput, TOutput> | null =
      this.requireExecutorRegistry().find<TInput, TOutput>(request.capability, plan);
    if (executor === null && plan.queueAction !== QueueAction.REJECT && plan.queueAction !== QueueAction.PAUSE) {
      throw new SchedulerError(
        SchedulerErrorCode.CAPABILITY_UNAVAILABLE,
        `No executor supports capability ${request.capability} and the selected execution plan.`
      );
    }

    const deferred: TaskDeferred<TOutput> = new TaskDeferred<TOutput>();
    const execute: InternalExecute = async (currentPlan: ExecutionPlan, signal: CancellationSignal,
      checkpoint?: TaskCheckpoint): Promise<ExecutorResult<Object>> => {
      const currentExecutor: WorkloadExecutor<TInput, TOutput> | null = executor ??
        this.requireExecutorRegistry().find<TInput, TOutput>(request.capability, currentPlan);
      if (currentExecutor === null || !currentExecutor.supports(currentPlan)) {
        throw new SchedulerError(SchedulerErrorCode.CAPABILITY_UNAVAILABLE, 'Executor does not support refreshed plan.');
      }
      if (checkpoint === undefined && currentExecutor.warmup !== undefined) {
        await currentExecutor.warmup(currentPlan);
      }
      if (signal.isCancellationRequested) {
        throw new SchedulerError(SchedulerErrorCode.TASK_CANCELLED, 'Task stopped during warmup.');
      }
      const executorResult: ExecutorResult<TOutput> = await currentExecutor.execute(request.input, currentPlan, signal, checkpoint);
      return { output: executorResult.output as Object, completed: executorResult.completed,
        checkpoint: executorResult.checkpoint, telemetry: executorResult.telemetry };
    };
    const complete: InternalComplete = (internalResult: TaskResult<Object>): void => {
      const typedResult: TaskResult<TOutput> = {
        taskId: internalResult.taskId,
        status: internalResult.status,
        output: internalResult.output as TOutput | null,
        executionPlan: internalResult.executionPlan,
        queueDurationMs: internalResult.queueDurationMs,
        executionDurationMs: internalResult.executionDurationMs,
        totalDurationMs: internalResult.totalDurationMs,
        errorCode: internalResult.errorCode,
        stopRequestedAt: internalResult.stopRequestedAt
      };
      deferred.complete(typedResult);
    };

    const task: InternalTask = {
      taskId: taskId,
      taskType: request.taskType,
      priority: plan.priority,
      paused: plan.queueAction === QueueAction.PAUSE,
      pausable: request.allowPause,
      capability: request.capability,
      profile: profile,
      plan: plan,
      execute: execute,
      supports: (currentPlan: ExecutionPlan): boolean => {
        const candidate = executor ?? this.requireExecutorRegistry().find<TInput, TOutput>(request.capability, currentPlan);
        return candidate !== null && candidate.supports(currentPlan);
      },
      cancellation: new CancellationController(),
      status: TaskStatus.QUEUED,
      queuedAt: queuedAt,
      startedAt: null,
      complete: complete,
      manualPaused: false,
      checkpointCount: 0,
      activeDurationMs: 0,
      queueDurationMs: 0,
      lastEnqueuedAt: queuedAt,
      expiryTimer: -1,
      lastSliceDurationMs: 0,
      utilityScore: plan.utilityScore
    };
    this.tasks.set(taskId, task);
    this.appendLogEntry({
      taskId: taskId,
      taskType: profile.taskType,
      capability: profile.capability,
      deviceState: deviceState,
      executionPlan: plan,
      status: TaskStatus.CREATED,
      queuedAt: queuedAt,
      startedAt: null,
      finishedAt: null,
      queueDurationMs: null,
      executionDurationMs: null,
      totalDurationMs: null
    });
    if (plan.queueAction === QueueAction.REJECT) {
      this.finishTask(task, TaskStatus.FAILED, null, task.profile.template === undefined ?
          SchedulerErrorCode.THERMAL_PROTECTION : SchedulerErrorCode.POLICY_REJECTED);
    } else {
      this.requireTaskQueue().enqueue(task);
      this.armExpiry(task);
    }
    this.updateQueueDepth();
    this.scheduleDrain();

    return new SchedulerTaskHandle<TOutput>(
      taskId,
      deferred.promise,
      (): Promise<boolean> => this.cancelTask(taskId),
      (): TaskStatus => task.status
    );
  }

  public async cancelTask(taskId: string): Promise<boolean> {
    return this.stopTask(taskId, SchedulerErrorCode.TASK_CANCELLED);
  }

  private async stopTask(taskId: string, reason: string): Promise<boolean> {
    this.requireInitialized();
    const task: InternalTask | undefined = this.tasks.get(taskId);
    if (task === undefined) {
      return false;
    }

    if (task.status === TaskStatus.QUEUED) {
      const removed: InternalTask | null = this.requireTaskQueue().remove(taskId);
      if (removed === null) {
        return false;
      }
      task.stopReason = reason;
      task.cancellation.cancel();
      this.finishTask(task, TaskStatus.CANCELLED, null, reason);
      this.updateQueueDepth();
      return true;
    }

    if (task.status === TaskStatus.RUNNING) {
      return this.requestStop(task, reason);
    }
    return false;
  }

  private requestStop(task: InternalTask, reason: string): boolean {
    if (task.status !== TaskStatus.RUNNING) { return false; }
    task.stopReason = task.stopReason ?? reason;
    task.stopRequestedAt = Date.now();
    task.status = TaskStatus.STOP_REQUESTED;
    this.appendLogEntry({
      taskId: task.taskId, taskType: task.taskType, capability: task.capability,
      deviceState: this.requireStateController().getSnapshot(), executionPlan: task.plan,
      status: TaskStatus.STOP_REQUESTED, queuedAt: task.queuedAt, startedAt: task.startedAt,
      finishedAt: null, queueDurationMs: task.queueDurationMs, executionDurationMs: null,
      totalDurationMs: null, errorCode: task.stopReason, stopRequestedAt: task.stopRequestedAt
    });
    return task.cancellation.cancel();
  }

  public getTaskStatus(taskId: string): TaskStatus | null {
    this.requireInitialized();
    const activeTask: InternalTask | undefined = this.tasks.get(taskId);
    if (activeTask !== undefined) {
      return activeTask.status;
    }
    for (let index: number = this.logHistory.length - 1; index >= 0; index--) {
      const entry: SchedulerLogEntry = this.logHistory[index];
      if (entry.taskId === taskId) {
        return entry.status;
      }
    }
    return null;
  }

  public async signalTask(taskId: string, signal: TaskSignal): Promise<void> {
    this.requireInitialized();
    const task: InternalTask | undefined = this.tasks.get(taskId);
    if (signal.type === TaskSignalType.CANCEL || signal.type === TaskSignalType.PAGE_LEFT ||
      signal.type === TaskSignalType.INPUT_REPLACED) {
      await this.stopTask(taskId, signal.type);
      return;
    }
    if (task !== undefined && task.profile.context !== undefined) {
      if (signal.type === TaskSignalType.WAITING_CHANGED) { task.profile.context.userWaiting = signal.value === true; }
      if (signal.type === TaskSignalType.QUALITY_REQUIRED) { task.profile.context.highQuality = signal.value !== false; }
      this.scheduleDrain();
    }
    for (let i: number = this.logHistory.length - 1; i >= 0; i--) {
      const log: SchedulerLogEntry = this.logHistory[i];
      if (log.taskId === taskId && log.telemetry !== undefined) {
        log.telemetry.signal = signal.type;
        if (signal.type === TaskSignalType.RESULT_CONSUMED || signal.type === TaskSignalType.RESULT_IGNORED) {
          this.semanticPolicy.observeConsumption(log.capability, signal.type === TaskSignalType.RESULT_CONSUMED,
            log.telemetry.resultConsumed);
        }
        if (signal.type === TaskSignalType.RESULT_CONSUMED) { log.telemetry.resultConsumed = true; }
        if (signal.type === TaskSignalType.RESULT_IGNORED) { log.telemetry.resultConsumed = false; }
        break;
      }
    }
  }

  public exportAudit(): string {
    this.requireInitialized();
    return JSON.stringify(this.logHistory);
  }

  public async setTaskPriority(taskId: string, priority: TaskPriority): Promise<void> {
    this.requireInitialized();
    const task: InternalTask | undefined = this.tasks.get(taskId);
    if (task === undefined || task.status !== TaskStatus.QUEUED) {
      throw new SchedulerError(
        SchedulerErrorCode.INVALID_TASK,
        `Only queued task ${taskId} can change priority.`
      );
    }
    if (!this.requireTaskQueue().updatePriority(taskId, priority)) {
      throw new SchedulerError(SchedulerErrorCode.INVALID_TASK, `Queued task ${taskId} was not found.`);
    }
    task.priority = priority;
    task.plan.priority = priority;
    task.manualPriority = priority;
  }

  public async pauseBackgroundTasks(reason?: string): Promise<number> {
    this.requireInitialized();
    let count: number = 0;
    this.tasks.forEach((task: InternalTask) => {
      if (task.taskType === TaskType.BACKGROUND_BATCH && task.pausable && !task.manualPaused) {
        task.manualPaused = true;
        task.paused = true;
        task.plan.reasonCodes.push(reason === undefined ? 'MANUAL_PAUSE' : `MANUAL_PAUSE:${reason}`);
        count++;
      }
    });
    return count;
  }

  public async resumeBackgroundTasks(): Promise<number> {
    this.requireInitialized();
    const queue: TaskQueue<InternalTask> = this.requireTaskQueue();
    const items: InternalTask[] = Array.from(this.tasks.values());
    let resumedCount: number = 0;
    for (let index: number = 0; index < items.length; index++) {
      const task: InternalTask = items[index];
      if (task.taskType !== TaskType.BACKGROUND_BATCH || !task.paused) {
        continue;
      }
      task.manualPaused = false;
      if (task.status === TaskStatus.RUNNING || task.status === TaskStatus.STOP_REQUESTED) {
        task.paused = false;
        resumedCount++;
        continue;
      }
      const refreshedPlan: ExecutionPlan = this.evaluate(task.profile);
      if (refreshedPlan.queueAction === QueueAction.PAUSE || refreshedPlan.queueAction === QueueAction.REJECT) {
        continue;
      }
      task.plan = refreshedPlan;
      task.priority = refreshedPlan.priority;
      task.paused = false;
      queue.updatePriority(task.taskId, task.priority);
      resumedCount++;
    }
    if (resumedCount > 0) {
      this.scheduleDrain();
    }
    return resumedCount;
  }

  public getDeviceState(): DeviceState {
    this.requireInitialized();
    return this.requireStateController().getSnapshot();
  }

  public updateRealDeviceState(patch: RealDeviceStatePatch): void {
    this.requireInitialized();
    if (this.requireStateController().applyRealState(patch)) {
      this.protectRunningTask();
      this.refreshQueuedPlans();
      this.notifyStateCallbacks();
      this.scheduleDrain();
    }
  }

  public async injectDebugState(patch: DebugStatePatch): Promise<void> {
    this.requireInitialized();
    if (this.config === null || !this.config.enableDebugInjection) {
      throw new SchedulerError(
        SchedulerErrorCode.DEBUG_INJECTION_DISABLED,
        'Debug state injection is disabled by SchedulerConfig.'
      );
    }
    if (this.requireStateController().applyDebugState(patch)) {
      this.protectRunningTask();
      this.refreshQueuedPlans();
      this.notifyStateCallbacks();
      this.scheduleDrain();
    }
  }

  public async clearDebugState(): Promise<void> {
    this.requireInitialized();
    if (this.requireStateController().clearDebugState()) {
      this.protectRunningTask();
      this.refreshQueuedPlans();
      this.notifyStateCallbacks();
      this.scheduleDrain();
    }
  }

  public registerStateCallback(callback: StateCallback): Unsubscribe {
    this.requireInitialized();
    this.stateCallbacks.push(callback);
    return (): void => {
      const index: number = this.stateCallbacks.indexOf(callback);
      if (index >= 0) {
        this.stateCallbacks.splice(index, 1);
      }
    };
  }

  public registerLogCallback(callback: SchedulerLogCallback): Unsubscribe {
    this.requireInitialized();
    this.logCallbacks.push(callback);
    return (): void => {
      const index: number = this.logCallbacks.indexOf(callback);
      if (index >= 0) {
        this.logCallbacks.splice(index, 1);
      }
    };
  }

  public getMetricsSnapshot(): MetricsSnapshot {
    this.requireInitialized();
    const terminalLogs: SchedulerLogEntry[] = this.getTerminalLogEntries();
    const latencyValues: number[] = terminalLogs
      .filter((entry: SchedulerLogEntry) => entry.totalDurationMs !== null)
      .map((entry: SchedulerLogEntry) => entry.totalDurationMs as number)
      .sort((left: number, right: number) => left - right);
    const queueValues: number[] = terminalLogs
      .filter((entry: SchedulerLogEntry) => entry.queueDurationMs !== null)
      .map((entry: SchedulerLogEntry) => entry.queueDurationMs as number);

    return {
      evaluationCount: this.evaluationCount,
      taskCount: terminalLogs.length,
      runningCount: this.runningTask === null ? 0 : 1,
      queuedCount: this.taskQueue === null ? 0 : this.taskQueue.getSize(),
      pausedCount: this.countPausedTasks(),
      averageLatencyMs: this.average(latencyValues),
      p95LatencyMs: this.percentile95(latencyValues),
      averageQueueDurationMs: this.average(queueValues),
      degradeCount: terminalLogs.filter((entry: SchedulerLogEntry) =>
        this.isDegradedPlan(entry.executionPlan)).length,
      failureCount: terminalLogs.filter((entry: SchedulerLogEntry) =>
        entry.status === TaskStatus.FAILED || entry.status === TaskStatus.TIMED_OUT).length,
      cancellationCount: terminalLogs.filter((entry: SchedulerLogEntry) =>
        entry.status === TaskStatus.CANCELLED).length,
      policySwitchCount: this.policySwitchCount,
      capturedAt: Date.now()
    };
  }

  public getRuntimeMetrics(): MetricsSnapshot {
    return this.getMetricsSnapshot();
  }

  public getRecentLogs(limit: number = 20): SchedulerLogEntry[] {
    this.requireInitialized();
    const normalizedLimit: number = Math.max(1, Math.floor(limit));
    return JSON.parse(JSON.stringify(this.logHistory.slice(Math.max(0, this.logHistory.length - normalizedLimit)))) as SchedulerLogEntry[];
  }

  public async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }
    this.initialized = false;
    clearInterval(this.freshnessTimer); this.freshnessTimer = -1;

    if (this.taskQueue !== null) {
      const queuedTasks: InternalTask[] = this.taskQueue.clear();
      queuedTasks.forEach((task: InternalTask) => {
        task.cancellation.cancel();
        this.finishTask(task, TaskStatus.CANCELLED, null, SchedulerErrorCode.TASK_CANCELLED);
      });
      this.updateQueueDepth();
    }
    if (this.runningTask !== null) {
      this.requestStop(this.runningTask, SchedulerErrorCode.TASK_CANCELLED);
    }
    if (this.processorPromise !== null) {
      await this.processorPromise;
    }
    if (this.executorRegistry !== null) {
      await this.executorRegistry.disposeAll();
    }

    this.config = null;
    this.policy = null;
    this.hysteresis = null;
    this.stateController = null;
    this.executorRegistry = null;
    this.taskQueue = null;
    this.tasks = new Map<string, InternalTask>();
    this.runningTask = null;
    this.processorPromise = null;
    this.schedulerPaused = false;
    this.policyMode = PolicyMode.ADAPTIVE;
    this.evaluationCount = 0;
    this.stateCallbacks = [];
    this.logCallbacks = [];
    this.logHistory = [];
    this.policySwitchCount = 0;
  }

  private scheduleDrain(): void {
    if (!this.initialized || this.schedulerPaused || this.processorPromise !== null) {
      return;
    }
    this.processorPromise = this.drainQueue();
    this.processorPromise.then(() => {
      this.processorPromise = null;
      if (this.initialized && !this.schedulerPaused &&
        this.taskQueue !== null && this.taskQueue.hasRunnableItems()) {
        this.scheduleDrain();
      }
    }).catch(() => {
      this.processorPromise = null;
    });
  }

  private protectRunningTask(): void {
    const task: InternalTask | null = this.runningTask;
    if (task === null || task.profile.template === undefined) { return; }
    const state: DeviceState = this.getDeviceState();
    if (state.thermalLevel === ThermalLevel.CRITICAL || state.memoryPressure === MemoryPressure.CRITICAL ||
      (state.availableMemoryMb !== null && state.availableMemoryMb < 192)) {
      this.requestStop(task, 'DEVICE_PROTECTION');
    }
  }

  private async drainQueue(): Promise<void> {
    while (this.initialized && !this.schedulerPaused && this.taskQueue !== null) {
      this.refreshQueuedPlans();
      const task: InternalTask | null = this.taskQueue.dequeue();
      if (task === null) {
        return;
      }
      this.updateQueueDepth();
      this.runningTask = task;
      await this.executeTask(task);
      this.runningTask = null;
    }
  }

  private async executeTask(task: InternalTask): Promise<void> {
    task.status = TaskStatus.RUNNING;
    const sliceStartedAt: number = Date.now();
    const activeBefore: number = task.activeDurationMs;
    task.queueDurationMs += sliceStartedAt - task.lastEnqueuedAt;
    if (task.startedAt === null) { task.startedAt = sliceStartedAt; }
    task.executionState = this.getDeviceState();
    this.appendLogEntry({
      taskId: task.taskId, taskType: task.taskType, capability: task.capability,
      deviceState: task.executionState, executionPlan: task.plan, status: TaskStatus.RUNNING,
      queuedAt: task.queuedAt, startedAt: task.startedAt, finishedAt: null,
      queueDurationMs: task.queueDurationMs, executionDurationMs: null, totalDurationMs: null
    });
    const timeoutId: number = setTimeout(() => {
      this.requestStop(task, SchedulerErrorCode.TASK_TIMEOUT);
    }, Math.max(1, task.profile.timeoutMs - task.activeDurationMs));
    try {
      // A timeout requests a stop; the slot remains occupied until the executor settles.
      const result: ExecutorResult<Object> = await task.execute(task.plan, task.cancellation.signal, task.checkpoint);
      task.lastSliceDurationMs = Date.now() - sliceStartedAt;
      task.activeDurationMs = activeBefore + task.lastSliceDurationMs;
      task.actual = result.telemetry ?? task.actual;
      const expired: string | undefined = this.expiryReason(task);
      if (expired !== undefined) { this.requestStop(task, expired); }
      if (task.activeDurationMs >= task.profile.timeoutMs) {
        this.requestStop(task, SchedulerErrorCode.TASK_TIMEOUT);
      }
      if (task.cancellation.signal.isCancellationRequested) {
        this.finishTask(task, task.stopReason === SchedulerErrorCode.TASK_TIMEOUT ? TaskStatus.TIMED_OUT : TaskStatus.CANCELLED,
          null, task.stopReason ?? SchedulerErrorCode.TASK_CANCELLED);
        return;
      }
      if (task.profile.context !== undefined && task.plan.inferenceLocation === InferenceLocation.LOCAL_DEVICE &&
        qualityRank((task.plan as LocalExecutionPlan).modelTier) <
        (task.profile.context.highQuality ? 2 : qualityRank(task.profile.context.accuracyFloor))) {
        this.finishTask(task, TaskStatus.FAILED, null, 'QUALITY_CONSTRAINT_CHANGED');
        return;
      }
      const actual: ExecutorTelemetry | undefined = result.telemetry;
      const matchesPlan: boolean = actual?.executionPath !== 'serial_fallback' && (task.plan.inferenceLocation !== InferenceLocation.LOCAL_DEVICE ||
        ((actual?.actualBackend === undefined || actual.actualBackend === (task.plan as LocalExecutionPlan).backend) &&
          (actual?.actualThreads === undefined || actual.actualThreads === (task.plan as LocalExecutionPlan).threadCount)));
      if (!matchesPlan) { task.plan.reasonCodes.push('EXECUTOR_SETTINGS_DIFFER_FROM_PLAN'); }
      if (task.executionState !== undefined && matchesPlan) {
        this.semanticPolicy.observe(task.profile, task.executionState, task.plan, task.lastSliceDurationMs);
      }
      if (result.completed === false) {
        if (task.profile.template?.interruptibility !== Interruptibility.CHECKPOINT ||
          result.checkpoint === undefined || !Number.isFinite(result.checkpoint.cursor) ||
          result.checkpoint.cursor <= (task.checkpoint?.cursor ?? -1)) {
          throw new SchedulerError(SchedulerErrorCode.INVALID_TASK, 'Yield requires a progressing checkpoint.');
        }
        task.checkpoint = result.checkpoint;
        task.checkpointCount++;
        task.status = TaskStatus.QUEUED;
        task.lastEnqueuedAt = Date.now();
        task.paused = task.manualPaused;
        this.appendLogEntry({
          taskId: task.taskId, taskType: task.taskType, capability: task.capability,
          deviceState: task.executionState!, executionPlan: task.plan, status: TaskStatus.QUEUED,
          queuedAt: task.queuedAt, startedAt: task.startedAt, finishedAt: null,
          queueDurationMs: task.queueDurationMs, executionDurationMs: task.activeDurationMs,
          totalDurationMs: Date.now() - task.queuedAt,
          telemetry: { prediction: task.plan.prediction, actual: task.actual, checkpointCount: task.checkpointCount,
            sliceDurationMs: task.lastSliceDurationMs,
            predictionErrorMs: task.plan.prediction === undefined ? undefined : task.lastSliceDurationMs - task.plan.prediction.latencyMs,
            workflowId: task.profile.context?.workflowId, deadlineMissed: false }
        });
        this.requireTaskQueue().enqueue(task);
        this.updateQueueDepth();
        return;
      }
      this.finishTask(task, TaskStatus.SUCCEEDED, result.output);
    } catch (error) {
      task.lastSliceDurationMs = Date.now() - sliceStartedAt;
      task.activeDurationMs = activeBefore + task.lastSliceDurationMs;
      const schedulerError: SchedulerError | null = error instanceof SchedulerError ? error : null;
      if (task.stopReason === SchedulerErrorCode.TASK_TIMEOUT ||
        (task.stopReason === undefined && schedulerError !== null && schedulerError.code === SchedulerErrorCode.TASK_TIMEOUT)) {
        task.cancellation.cancel();
        this.finishTask(task, TaskStatus.TIMED_OUT, null, SchedulerErrorCode.TASK_TIMEOUT);
      } else if (task.cancellation.signal.isCancellationRequested ||
        (schedulerError !== null && schedulerError.code === SchedulerErrorCode.TASK_CANCELLED)) {
        this.finishTask(task, TaskStatus.CANCELLED, null, task.stopReason ?? SchedulerErrorCode.TASK_CANCELLED);
      } else {
        this.finishTask(task, TaskStatus.FAILED, null,
          schedulerError === null ? SchedulerErrorCode.INTERNAL_ERROR : schedulerError.code);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private refreshQueuedPlans(): void {
    const queue: TaskQueue<InternalTask> = this.requireTaskQueue();
    const items: InternalTask[] = queue.getItems();
    for (let i: number = 0; i < items.length; i++) {
      const task: InternalTask = items[i];
      const expired: string | undefined = this.expiryReason(task);
      if (expired !== undefined) {
        queue.remove(task.taskId);
        this.finishTask(task, TaskStatus.CANCELLED, null, expired);
        continue;
      }
      const plan: ExecutionPlan = this.evaluate(task.profile);
      task.plan = plan;
      task.priority = task.manualPriority ?? plan.priority;
      if (task.manualPriority !== undefined) { plan.priority = task.manualPriority; }
      task.utilityScore = task.manualPriority === undefined ? plan.utilityScore : undefined;
      task.paused = task.manualPaused || plan.queueAction === QueueAction.PAUSE;
      if (plan.queueAction === QueueAction.REJECT) {
        queue.remove(task.taskId);
        this.finishTask(task, TaskStatus.FAILED, null, task.profile.template === undefined ?
          SchedulerErrorCode.THERMAL_PROTECTION : SchedulerErrorCode.POLICY_REJECTED);
      } else if (plan.queueAction !== QueueAction.PAUSE && !task.supports(plan)) {
        queue.remove(task.taskId);
        this.finishTask(task, TaskStatus.FAILED, null, SchedulerErrorCode.CAPABILITY_UNAVAILABLE);
      }
    }
    this.updateQueueDepth();
  }

  private expiryReason(task: InternalTask): string | undefined {
    const context = task.profile.context;
    if (context === undefined) { return undefined; }
    if (context.requestReplaced) { return TaskSignalType.INPUT_REPLACED; }
    const elapsed: number = Date.now() - (task.profile.submittedAt ?? task.queuedAt);
    if (context.freshnessMs !== undefined && elapsed >= context.freshnessMs) {
      return SchedulerErrorCode.RESULT_EXPIRED;
    }
    if (context.deadlineMs !== undefined && elapsed >= context.deadlineMs) {
      return SchedulerErrorCode.DEADLINE_EXCEEDED;
    }
    return undefined;
  }

  private armExpiry(task: InternalTask): void {
    const context = task.profile.context;
    if (context === undefined) { return; }
    const limit: number = Math.min(context.deadlineMs ?? Infinity, context.freshnessMs ?? Infinity);
    if (!Number.isFinite(limit)) { return; }
    const remaining: number = limit - (Date.now() - (task.profile.submittedAt ?? task.queuedAt));
    task.expiryTimer = setTimeout(() => {
      if (this.initialized && this.tasks.has(task.taskId)) {
        this.stopTask(task.taskId, this.expiryReason(task) ?? SchedulerErrorCode.RESULT_EXPIRED);
      }
    }, Math.max(1, remaining));
  }

  private finishTask(
    task: InternalTask,
    status: TaskStatus,
    output: Object | null,
    errorCode?: string
  ): void {
    if (!this.tasks.has(task.taskId)) {
      return;
    }
    const finishedAt: number = Date.now();
    clearTimeout(task.expiryTimer);
    const queueDurationMs: number = task.queueDurationMs +
      (task.status === TaskStatus.QUEUED ? finishedAt - task.lastEnqueuedAt : 0);
    const executionDurationMs: number = task.activeDurationMs;
    const telemetry: TaskTelemetry = {
      prediction: task.plan.prediction, actual: task.actual, checkpointCount: task.checkpointCount,
      sliceDurationMs: task.lastSliceDurationMs,
      predictionErrorMs: task.plan.prediction === undefined || task.startedAt === null ? undefined :
        task.lastSliceDurationMs - task.plan.prediction.latencyMs,
      workflowId: task.profile.context?.workflowId,
      deadlineMissed: task.profile.context?.deadlineMs !== undefined &&
        finishedAt - (task.profile.submittedAt ?? task.queuedAt) > task.profile.context.deadlineMs
    };
    task.status = status;
    const result: TaskResult<Object> = {
      taskId: task.taskId,
      status: status,
      output: output,
      executionPlan: task.plan,
      queueDurationMs: queueDurationMs,
      executionDurationMs: executionDurationMs,
      totalDurationMs: finishedAt - task.queuedAt,
      stopRequestedAt: task.stopRequestedAt,
      errorCode: errorCode
    };
    this.tasks.delete(task.taskId);
    this.appendLogEntry({
      taskId: task.taskId,
      taskType: task.taskType,
      capability: task.capability,
      deviceState: this.requireStateController().getSnapshot(),
      executionPlan: task.plan,
      status: status,
      queuedAt: task.queuedAt,
      startedAt: task.startedAt,
      finishedAt: finishedAt,
      queueDurationMs: queueDurationMs,
      executionDurationMs: executionDurationMs,
      totalDurationMs: finishedAt - task.queuedAt,
      stopRequestedAt: task.stopRequestedAt,
      errorCode: errorCode,
      telemetry: telemetry
    });
    if (status === TaskStatus.SUCCEEDED &&
      this.initialized &&
      task.plan.inferenceLocation === InferenceLocation.LOCAL_DEVICE) {
      this.updateRealDeviceState({ recentLatencyMs: executionDurationMs });
    }
    task.complete(result);
  }

  private updateQueueDepth(): void {
    if (this.stateController === null || this.taskQueue === null) {
      return;
    }
    if (this.stateController.applyRealState({ queueDepth: this.taskQueue.getSize() })) {
      this.notifyStateCallbacks();
    }
  }

  private appendLogEntry(entry: SchedulerLogEntry): void {
    this.logHistory.push(JSON.parse(JSON.stringify(entry)) as SchedulerLogEntry);
    if (this.logHistory.length > MAX_LOG_HISTORY_SIZE) {
      this.logHistory.shift();
    }
    this.logCallbacks.forEach((callback: SchedulerLogCallback) => {
      try {
        callback(entry);
      } catch (error) {
        // A consumer callback must never interrupt task processing.
      }
    });
  }

  private getTerminalLogEntries(): SchedulerLogEntry[] {
    const terminalLogs: SchedulerLogEntry[] = this.logHistory.filter((entry: SchedulerLogEntry) =>
      entry.status === TaskStatus.SUCCEEDED ||
        entry.status === TaskStatus.FAILED ||
        entry.status === TaskStatus.TIMED_OUT ||
        entry.status === TaskStatus.CANCELLED
    );
    const windowSize: number = this.config === null ?
      DEFAULT_METRICS_WINDOW_SIZE : this.config.metricsWindowSize;
    return terminalLogs.slice(Math.max(0, terminalLogs.length - windowSize));
  }

  private countPausedTasks(): number {
    if (this.taskQueue === null) {
      return 0;
    }
    const items: InternalTask[] = this.taskQueue.getItems();
    let count: number = 0;
    for (let index: number = 0; index < items.length; index++) {
      if (items[index].paused) {
        count++;
      }
    }
    return count;
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    const total: number = values.reduce((sum: number, value: number) => sum + value, 0);
    return Math.round(total / values.length);
  }

  private percentile95(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    const index: number = Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1);
    return values[index];
  }

  private isDegradedPlan(plan: ExecutionPlan): boolean {
    if (plan.inferenceLocation !== InferenceLocation.LOCAL_DEVICE) {
      return false;
    }
    const localPlan: LocalExecutionPlan = plan as LocalExecutionPlan;
    return localPlan.modelTier === ModelTier.LIGHTWEIGHT ||
      plan.reasonCodes.some((reasonCode: string) =>
        reasonCode.indexOf('DOWNGRADE') >= 0 ||
          reasonCode.indexOf('PROTECTION') >= 0 ||
          reasonCode.indexOf('POWER_SAVING') >= 0
      );
  }

  private validateTaskRequest<TInput>(request: TaskRequest<TInput>): void {
    if (request.capability.trim().length === 0) {
      throw new SchedulerError(SchedulerErrorCode.INVALID_TASK, 'Task capability must not be empty.');
    }
    if (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0) {
      throw new SchedulerError(SchedulerErrorCode.INVALID_TASK, 'Task timeoutMs must be greater than 0.');
    }
    if (request.latencyBudgetMs !== undefined &&
      (!Number.isFinite(request.latencyBudgetMs) || request.latencyBudgetMs < 0)) {
      throw new SchedulerError(SchedulerErrorCode.INVALID_TASK, 'Task latencyBudgetMs must be non-negative.');
    }
    if (request.inferenceLocation === InferenceLocation.LOCAL_DEVICE && request.remoteOptions !== undefined) {
      throw new SchedulerError(
        SchedulerErrorCode.INVALID_TASK,
        'Local tasks must not define remote execution options.'
      );
    }
    if (request.inferenceLocation === InferenceLocation.REMOTE_CLOUD) {
      if (request.remoteOptions === undefined || request.remoteOptions.provider.trim().length === 0) {
        throw new SchedulerError(
          SchedulerErrorCode.INVALID_TASK,
          'Remote tasks must define a non-empty provider.'
        );
      }
      if (request.remoteOptions.maxRetries < 0 || request.remoteOptions.maxRetries > 3 ||
        request.remoteOptions.maxConcurrency <= 0) {
        throw new SchedulerError(
          SchedulerErrorCode.INVALID_TASK,
          'Remote maxRetries must be 0-3 and maxConcurrency must be greater than 0.'
        );
      }
    }
  }

  private createTaskProfile<TInput>(request: TaskRequest<TInput>): TaskProfile {
    return {
      taskType: request.taskType,
      inferenceLocation: request.inferenceLocation,
      capability: request.capability,
      accuracyPreference: request.accuracyPreference,
      latencyBudgetMs: request.latencyBudgetMs === undefined ? null : request.latencyBudgetMs,
      allowDegrade: request.allowDegrade,
      allowPause: request.allowPause,
      timeoutMs: request.timeoutMs,
      remoteOptions: request.remoteOptions,
      template: request.template,
      context: request.context,
      submittedAt: request.submittedAt ?? Date.now(),
      metadata: request.metadata
    };
  }

  private resolveTaskId(requestedId?: string): string {
    if (requestedId !== undefined) {
      if (requestedId.trim().length === 0) {
        throw new SchedulerError(SchedulerErrorCode.INVALID_TASK, 'Task ID must not be empty.');
      }
      return requestedId;
    }
    return `scheduler-${Date.now()}-${this.nextTaskSequence++}`;
  }

  private createHysteresisKey(profile: TaskProfile): string {
    return `${profile.capability}:${profile.taskType}`;
  }

  private shouldApplyHysteresis(profile: TaskProfile): boolean {
    return profile.taskType === TaskType.FOREGROUND_REALTIME;
  }

  private validateConfig(config: SchedulerConfig): void {
    if (config.metricsWindowSize <= 0) {
      throw new SchedulerError(
        SchedulerErrorCode.INVALID_CONFIG,
        `metricsWindowSize must be greater than 0; recommended default is ${DEFAULT_METRICS_WINDOW_SIZE}.`
      );
    }
    if (config.upgradeStableDurationMs < 0 || config.minimumTierHoldMs < 0) {
      throw new SchedulerError(
        SchedulerErrorCode.INVALID_CONFIG,
        'Hysteresis durations must not be negative.'
      );
    }
  }

  private requireInitialized(): void {
    if (!this.initialized) {
      throw new SchedulerError(
        SchedulerErrorCode.NOT_INITIALIZED,
        'SchedulerService.initialize must be called before using the scheduler.'
      );
    }
  }

  private requireStateController(): DeviceStateController {
    if (this.stateController === null) {
      throw new SchedulerError(SchedulerErrorCode.INTERNAL_ERROR, 'Device state controller is unavailable.');
    }
    return this.stateController;
  }

  private requireExecutorRegistry(): ExecutorRegistry {
    if (this.executorRegistry === null) {
      throw new SchedulerError(SchedulerErrorCode.INTERNAL_ERROR, 'Executor registry is unavailable.');
    }
    return this.executorRegistry;
  }

  private requireTaskQueue(): TaskQueue<InternalTask> {
    if (this.taskQueue === null) {
      throw new SchedulerError(SchedulerErrorCode.INTERNAL_ERROR, 'Task queue is unavailable.');
    }
    return this.taskQueue;
  }

  private notifyStateCallbacks(): void {
    if (this.stateController === null) {
      return;
    }
    this.stateCallbacks.forEach((callback: StateCallback) => {
      try {
        callback(this.requireStateController().getSnapshot(), this.policyMode);
      } catch (error) {
        // A consumer callback must never interrupt the scheduler lifecycle.
      }
    });
  }
}
