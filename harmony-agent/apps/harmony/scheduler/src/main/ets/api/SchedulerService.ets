import {
  CancellationSignal,
  DebugStatePatch,
  DataResidencyPolicy,
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
import { HysteresisController } from '../policy/HysteresisController';
import { SchedulerPolicy } from '../policy/SchedulerPolicy';
import { DeviceStateController } from '../state/DeviceStateController';
import { CancellationController } from '../executor/CancellationController';
import { ExecutorRegistry } from '../executor/ExecutorRegistry';
import { QueueItem, TaskQueue } from '../queue/TaskQueue';

const DEFAULT_METRICS_WINDOW_SIZE: number = 100;
const MAX_LOG_HISTORY_SIZE: number = 500;

type InternalExecute = (plan: ExecutionPlan, signal: CancellationSignal) => Promise<ExecutorResult<Object>>;
type InternalSupports = (plan: ExecutionPlan) => boolean;
type InternalComplete = (result: TaskResult<Object>) => void;
type CancelCallback = () => Promise<boolean>;
type StatusCallback = () => TaskStatus;

interface InternalTask extends QueueItem {
  capability: string;
  profile: TaskProfile;
  plan: ExecutionPlan;
  execute: InternalExecute;
  supports: InternalSupports;
  manuallyPaused: boolean;
  priorityOverride: TaskPriority | null;
  stopReason: SchedulerErrorCode | null;
  stopRequestedAt: number | null;
  cancellation: CancellationController;
  status: TaskStatus;
  queuedAt: number;
  startedAt: number | null;
  complete: InternalComplete;
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

export class SchedulerService {
  private static instance: SchedulerService | null = null;

  private initialized: boolean = false;
  private policyMode: PolicyMode = PolicyMode.ADAPTIVE;
  private config: SchedulerConfig | null = null;
  private policy: SchedulerPolicy | null = null;
  private hysteresis: HysteresisController | null = null;
  private stateController: DeviceStateController | null = null;
  private executorRegistry: ExecutorRegistry | null = null;
  private taskQueue: TaskQueue<InternalTask> | null = null;
  private tasks: Map<string, InternalTask> = new Map<string, InternalTask>();
  private runningTask: InternalTask | null = null;
  private processorPromise: Promise<void> | null = null;
  private schedulerPaused: boolean = false;
  private nextTaskSequence: number = 0;
  private stateCallbacks: StateCallback[] = [];
  private logCallbacks: SchedulerLogCallback[] = [];
  private logHistory: SchedulerLogEntry[] = [];
  private policySwitchCount: number = 0;

  private constructor() {
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
    this.logHistory = [];
    this.policySwitchCount = 0;
    this.initialized = true;
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
    this.refreshQueuedTasks();
    this.scheduleDrain();
    this.notifyStateCallbacks();
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
    const stateSnapshot: DeviceState = state === undefined ? this.getDeviceState() : state;
    const candidate: ExecutionPlan = this.policy.evaluate(profile, stateSnapshot, this.policyMode);
    if (candidate.inferenceLocation === InferenceLocation.REMOTE_CLOUD) {
      return candidate;
    }
    return this.hysteresis.apply(candidate as LocalExecutionPlan);
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
    if (plan.queueAction === QueueAction.REJECT) {
      throw new SchedulerError(
        SchedulerErrorCode.THERMAL_PROTECTION,
        `Task ${taskId} was rejected by the current safety policy.`
      );
    }

    const executor: WorkloadExecutor<TInput, TOutput> | null =
      this.requireExecutorRegistry().find<TInput, TOutput>(request.capability, plan);
    if (executor === null) {
      throw new SchedulerError(
        SchedulerErrorCode.CAPABILITY_UNAVAILABLE,
        `No executor supports capability ${request.capability} and the selected execution plan.`
      );
    }

    const deferred: TaskDeferred<TOutput> = new TaskDeferred<TOutput>();
    const execute: InternalExecute = async (
      currentPlan: ExecutionPlan,
      signal: CancellationSignal
    ): Promise<ExecutorResult<Object>> => {
      if (executor.warmup !== undefined) {
        await executor.warmup(currentPlan);
      }
      if (signal.isCancellationRequested) {
        throw new SchedulerError(SchedulerErrorCode.TASK_CANCELLED, 'Stopped during warmup.');
      }
      const executorResult: ExecutorResult<TOutput> = await executor.execute(request.input, currentPlan, signal);
      return { output: executorResult.output as Object };
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
      supports: (currentPlan: ExecutionPlan): boolean => executor.supports(currentPlan),
      manuallyPaused: false,
      priorityOverride: null,
      stopReason: null,
      stopRequestedAt: null,
      cancellation: new CancellationController(),
      status: TaskStatus.QUEUED,
      queuedAt: queuedAt,
      startedAt: null,
      complete: complete
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
    this.requireTaskQueue().enqueue(task);
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
      task.cancellation.cancel();
      this.finishTask(task, TaskStatus.CANCELLED, null, SchedulerErrorCode.TASK_CANCELLED);
      this.updateQueueDepth();
      return true;
    }

    if (task.status === TaskStatus.RUNNING) {
      return this.requestStop(task, SchedulerErrorCode.TASK_CANCELLED);
    }
    return false;
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
    task.priorityOverride = priority;
  }

  public async pauseBackgroundTasks(reason?: string): Promise<number> {
    this.requireInitialized();
    if (reason !== undefined && reason.length > 0) {
      // The reason will be attached to scheduler logs in the observability task.
    }
    const count: number = this.requireTaskQueue().pauseBackgroundTasks();
    this.requireTaskQueue().getItems().forEach((task: InternalTask) => {
      if (task.taskType === TaskType.BACKGROUND_BATCH && task.pausable) {
        task.manuallyPaused = true;
      }
    });
    return count;
  }

  public async resumeBackgroundTasks(): Promise<number> {
    this.requireInitialized();
    const queue: TaskQueue<InternalTask> = this.requireTaskQueue();
    const items: InternalTask[] = queue.getItems();
    let resumedCount: number = 0;
    for (let index: number = 0; index < items.length; index++) {
      const task: InternalTask = items[index];
      if (task.taskType !== TaskType.BACKGROUND_BATCH || !task.paused) {
        continue;
      }
      task.manuallyPaused = false;
      if (this.refreshQueuedTask(task) && !task.paused) {
        resumedCount++;
      }
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
      this.refreshQueuedTasks();
      this.scheduleDrain();
      this.notifyStateCallbacks();
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
      this.refreshQueuedTasks();
      this.scheduleDrain();
      this.notifyStateCallbacks();
    }
  }

  public async clearDebugState(): Promise<void> {
    this.requireInitialized();
    if (this.requireStateController().clearDebugState()) {
      this.refreshQueuedTasks();
      this.scheduleDrain();
      this.notifyStateCallbacks();
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
      taskCount: terminalLogs.length,
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
    return this.logHistory.slice(Math.max(0, this.logHistory.length - normalizedLimit));
  }

  public async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }
    this.initialized = false;

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
    this.stateCallbacks = [];
    this.logCallbacks = [];
    this.logHistory = [];
    this.policySwitchCount = 0;
  }

  private refreshQueuedTask(task: InternalTask): boolean {
    const plan: ExecutionPlan = this.evaluate(task.profile);
    if (task.priorityOverride !== null) {
      plan.priority = task.priorityOverride;
    }
    task.plan = plan;
    task.priority = plan.priority;
    if (plan.queueAction === QueueAction.REJECT || !task.supports(plan)) {
      this.requireTaskQueue().remove(task.taskId);
      this.finishTask(task, TaskStatus.FAILED, null,
        plan.queueAction === QueueAction.REJECT ? SchedulerErrorCode.THERMAL_PROTECTION :
          SchedulerErrorCode.CAPABILITY_UNAVAILABLE);
      return false;
    }
    task.paused = task.manuallyPaused || plan.queueAction === QueueAction.PAUSE;
    return true;
  }

  private refreshQueuedTasks(): void {
    if (!this.initialized || this.taskQueue === null) {
      return;
    }
    const items: InternalTask[] = this.taskQueue.getItems();
    items.forEach((task: InternalTask) => this.refreshQueuedTask(task));
    this.updateQueueDepth();
  }

  private requestStop(task: InternalTask, reason: SchedulerErrorCode): boolean {
    if (task.stopReason !== null) {
      return false;
    }
    task.stopReason = reason;
    task.stopRequestedAt = Date.now();
    task.status = TaskStatus.STOP_REQUESTED;
    this.appendLogEntry({
      taskId: task.taskId,
      taskType: task.taskType,
      capability: task.capability,
      deviceState: this.requireStateController().getSnapshot(),
      executionPlan: task.plan,
      status: TaskStatus.STOP_REQUESTED,
      queuedAt: task.queuedAt,
      startedAt: task.startedAt,
      finishedAt: null,
      queueDurationMs: task.startedAt === null ? null : task.startedAt - task.queuedAt,
      executionDurationMs: null,
      totalDurationMs: null,
      errorCode: reason,
      stopRequestedAt: task.stopRequestedAt
    });
    task.cancellation.cancel();
    return true;
  }

  private finishStoppedTask(task: InternalTask): void {
    const timedOut: boolean = task.stopReason === SchedulerErrorCode.TASK_TIMEOUT;
    this.finishTask(task, timedOut ? TaskStatus.TIMED_OUT : TaskStatus.CANCELLED,
      null, timedOut ? SchedulerErrorCode.TASK_TIMEOUT : SchedulerErrorCode.TASK_CANCELLED);
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

  private async drainQueue(): Promise<void> {
    while (this.initialized && !this.schedulerPaused && this.taskQueue !== null) {
      // Ported admission-before-side-effects from Cixin 0f50f8c GuardedExecutionService.
      this.refreshQueuedTasks();
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
    task.startedAt = Date.now();
    this.appendLogEntry({
      taskId: task.taskId,
      taskType: task.taskType,
      capability: task.capability,
      deviceState: this.getDeviceState(),
      executionPlan: task.plan,
      status: TaskStatus.RUNNING,
      queuedAt: task.queuedAt,
      startedAt: task.startedAt,
      finishedAt: null,
      queueDurationMs: task.startedAt - task.queuedAt,
      executionDurationMs: null,
      totalDurationMs: null
    });
    const timeoutId: number = setTimeout(() => {
      this.requestStop(task, SchedulerErrorCode.TASK_TIMEOUT);
    }, task.profile.timeoutMs);

    try {
      // Keep the slot until the executor settles, even when it cannot abort.
      // Adapted from the collaborator's stop -> await Handler -> release protocol.
      const executorResult: ExecutorResult<Object> = await task.execute(task.plan, task.cancellation.signal);
      clearTimeout(timeoutId);
      if (Date.now() - (task.startedAt as number) >= task.profile.timeoutMs && task.stopReason === null) {
        this.requestStop(task, SchedulerErrorCode.TASK_TIMEOUT);
      }
      if (task.stopReason !== null) {
        this.finishStoppedTask(task);
        return;
      }
      this.finishTask(task, TaskStatus.SUCCEEDED, executorResult.output);
    } catch (error) {
      clearTimeout(timeoutId);
      const schedulerError: SchedulerError | null = error instanceof SchedulerError ? error : null;
      if (task.stopReason !== null) {
        this.finishStoppedTask(task);
      } else if (schedulerError !== null && schedulerError.code === SchedulerErrorCode.TASK_TIMEOUT) {
        this.finishTask(task, TaskStatus.TIMED_OUT, null, SchedulerErrorCode.TASK_TIMEOUT);
      } else if (task.cancellation.signal.isCancellationRequested ||
        (schedulerError !== null && schedulerError.code === SchedulerErrorCode.TASK_CANCELLED)) {
        this.finishTask(task, TaskStatus.CANCELLED, null, SchedulerErrorCode.TASK_CANCELLED);
      } else {
        const errorCode: string = schedulerError === null ?
          SchedulerErrorCode.INTERNAL_ERROR : schedulerError.code;
        this.finishTask(task, TaskStatus.FAILED, null, errorCode);
      }
    }
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
    const queueDurationMs: number = task.startedAt === null ?
      finishedAt - task.queuedAt : task.startedAt - task.queuedAt;
    const executionDurationMs: number = task.startedAt === null ? 0 : finishedAt - task.startedAt;
    task.status = status;
    const result: TaskResult<Object> = {
      taskId: task.taskId,
      status: status,
      output: output,
      executionPlan: task.plan,
      queueDurationMs: queueDurationMs,
      executionDurationMs: executionDurationMs,
      totalDurationMs: finishedAt - task.queuedAt,
      errorCode: errorCode,
      stopRequestedAt: task.stopRequestedAt === null ? undefined : task.stopRequestedAt
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
      errorCode: errorCode,
      stopRequestedAt: task.stopRequestedAt === null ? undefined : task.stopRequestedAt
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
    this.logHistory.push(entry);
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
      if (request.privacyContext !== undefined &&
        (request.privacyContext.residencyPolicy === DataResidencyPolicy.LOCAL_ONLY ||
          !request.privacyContext.cloudConsent)) {
        throw new SchedulerError(
          SchedulerErrorCode.PRIVACY_POLICY_VIOLATION,
          `Remote execution blocked by privacy policy: ${request.privacyContext.reason}`
        );
      }
      if (request.privacyContext === undefined) {
        throw new SchedulerError(SchedulerErrorCode.PRIVACY_POLICY_VIOLATION,
          'Remote tasks must declare an explicit privacy context and cloud consent.');
      }
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
      privacyContext: request.privacyContext
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
