export enum PolicyMode {
  ADAPTIVE = 'ADAPTIVE',
  FIXED_PERFORMANCE = 'FIXED_PERFORMANCE',
  FIXED_POWER_SAVING = 'FIXED_POWER_SAVING'
}

export enum TaskType {
  FOREGROUND_REALTIME = 'FOREGROUND_REALTIME',
  USER_INITIATED = 'USER_INITIATED',
  BACKGROUND_BATCH = 'BACKGROUND_BATCH'
}

export enum InferenceLocation {
  LOCAL_DEVICE = 'LOCAL_DEVICE',
  REMOTE_CLOUD = 'REMOTE_CLOUD'
}


export enum DataSensitivity {
  PUBLIC = 'PUBLIC',
  PERSONAL = 'PERSONAL',
  SENSITIVE = 'SENSITIVE'
}

export enum DataResidencyPolicy {
  CLOUD_ALLOWED = 'CLOUD_ALLOWED',
  LOCAL_ONLY = 'LOCAL_ONLY'
}
export enum AccuracyPreference {
  QUALITY_FIRST = 'QUALITY_FIRST',
  BALANCED = 'BALANCED',
  SPEED_FIRST = 'SPEED_FIRST'
}

export enum ModelTier {
  HIGH_ACCURACY = 'HIGH_ACCURACY',
  BALANCED = 'BALANCED',
  LIGHTWEIGHT = 'LIGHTWEIGHT'
}

export enum ThermalLevel {
  UNKNOWN = 'UNKNOWN',
  NORMAL = 'NORMAL',
  WARM = 'WARM',
  HOT = 'HOT',
  CRITICAL = 'CRITICAL'
}

export enum AppVisibility {
  FOREGROUND = 'FOREGROUND',
  BACKGROUND = 'BACKGROUND'
}

export enum Backend {
  CPU = 'CPU',
  GPU = 'GPU',
  NPU = 'NPU',
  NNRT = 'NNRT'
}

export enum TaskPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export enum QueueAction {
  IMMEDIATE = 'IMMEDIATE',
  ENQUEUE = 'ENQUEUE',
  THROTTLE = 'THROTTLE',
  PAUSE = 'PAUSE',
  REJECT = 'REJECT'
}

export enum TaskStatus {
  CREATED = 'CREATED',
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  STOP_REQUESTED = 'STOP_REQUESTED',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  TIMED_OUT = 'TIMED_OUT',
  CANCELLED = 'CANCELLED'
}

export enum DeviceStateSource {
  REAL = 'REAL',
  INJECTED = 'INJECTED',
  MIXED = 'MIXED'
}

export type ThreadCount = 1 | 2 | 4;
export type CancellationCallback = () => void;

export interface BaseExecutorConfig {
  capability: string;
  inferenceLocation: InferenceLocation;
}

export interface LocalExecutorConfig extends BaseExecutorConfig {
  inferenceLocation: InferenceLocation.LOCAL_DEVICE;
  backend: Backend;
  supportedModelTiers: ModelTier[];
  supportedThreadCounts: ThreadCount[];
}

export interface RemoteExecutorConfig extends BaseExecutorConfig {
  inferenceLocation: InferenceLocation.REMOTE_CLOUD;
  provider: string;
  maxConcurrency: number;
}

export type ExecutorConfig = LocalExecutorConfig | RemoteExecutorConfig;

export interface RemoteExecutionOptions {
  provider: string;
  maxRetries: number;
  maxConcurrency: number;
  allowLocalFallback: boolean;
}

export interface SchedulerConfig {
  defaultPolicyMode: PolicyMode;
  enableDebugInjection: boolean;
  metricsWindowSize: number;
  upgradeStableDurationMs: number;
  minimumTierHoldMs: number;
  executors: ExecutorConfig[];
}
export interface PrivacyContext {
  sensitivity: DataSensitivity;
  residencyPolicy: DataResidencyPolicy;
  cloudConsent: boolean;
  reason: string;
}


export interface TaskRequest<TInput> {
  taskId?: string;
  taskType: TaskType;
  inferenceLocation: InferenceLocation;
  capability: string;
  input: TInput;
  accuracyPreference: AccuracyPreference;
  latencyBudgetMs?: number;
  allowDegrade: boolean;
  allowPause: boolean;
  timeoutMs: number;
  privacyContext?: PrivacyContext;
  remoteOptions?: RemoteExecutionOptions;
  metadata?: Record<string, string>;
}

export interface TaskProfile {
  taskType: TaskType;
  inferenceLocation: InferenceLocation;
  capability: string;
  accuracyPreference: AccuracyPreference;
  latencyBudgetMs: number | null;
  allowDegrade: boolean;
  allowPause: boolean;
  timeoutMs: number;
  privacyContext?: PrivacyContext;
  remoteOptions?: RemoteExecutionOptions;
}

export interface TaskResult<TOutput> {
  taskId: string;
  status: TaskStatus;
  output: TOutput | null;
  executionPlan: ExecutionPlan;
  queueDurationMs: number;
  executionDurationMs: number;
  totalDurationMs: number;
  errorCode?: string;
  stopRequestedAt?: number;
}

export interface TaskHandle<TOutput> {
  taskId: string;
  result: Promise<TaskResult<TOutput>>;
  cancel(): Promise<boolean>;
  getStatus(): TaskStatus;
}

export interface BaseExecutionPlan {
  inferenceLocation: InferenceLocation;
  priority: TaskPriority;
  queueAction: QueueAction;
  reasonCodes: string[];
  policyVersion: string;
}

export interface LocalExecutionPlan extends BaseExecutionPlan {
  inferenceLocation: InferenceLocation.LOCAL_DEVICE;
  modelTier: ModelTier;
  threadCount: ThreadCount;
  backend: Backend;
}

export interface RemoteExecutionPlan extends BaseExecutionPlan {
  inferenceLocation: InferenceLocation.REMOTE_CLOUD;
  provider: string;
  timeoutMs: number;
  maxRetries: number;
  maxConcurrency: number;
  allowLocalFallback: boolean;
}

export type ExecutionPlan = LocalExecutionPlan | RemoteExecutionPlan;

export interface CancellationSignal {
  readonly isCancellationRequested: boolean;
  onCancelled(callback: CancellationCallback): Unsubscribe;
}

export interface ExecutorResult<TOutput> {
  output: TOutput;
}

export interface WorkloadExecutor<TInput, TOutput> {
  capability: string;
  inferenceLocation: InferenceLocation;
  supports(plan: ExecutionPlan): boolean;
  warmup?(plan: ExecutionPlan): Promise<void>;
  execute(input: TInput, plan: ExecutionPlan, signal: CancellationSignal): Promise<ExecutorResult<TOutput>>;
  dispose(): Promise<void>;
}

export interface DeviceState {
  batteryPercent: number | null;
  isCharging: boolean | null;
  thermalLevel: ThermalLevel;
  appVisibility: AppVisibility;
  recentLatencyMs: number | null;
  queueDepth: number;
  availableBackends: Backend[];
  source: DeviceStateSource;
  capturedAt: number;
}

export interface RealDeviceStatePatch {
  batteryPercent?: number | null;
  isCharging?: boolean | null;
  thermalLevel?: ThermalLevel;
  appVisibility?: AppVisibility;
  recentLatencyMs?: number | null;
  queueDepth?: number;
  availableBackends?: Backend[];
}

export interface DebugStatePatch {
  batteryPercent?: number | null;
  isCharging?: boolean | null;
  thermalLevel?: ThermalLevel;
  appVisibility?: AppVisibility;
  recentLatencyMs?: number | null;
  queueDepth?: number;
  availableBackends?: Backend[];
}

export interface SchedulerLogEntry {
  taskId: string;
  taskType: TaskType;
  capability: string;
  deviceState: DeviceState;
  executionPlan: ExecutionPlan;
  status: TaskStatus;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  queueDurationMs: number | null;
  executionDurationMs: number | null;
  totalDurationMs: number | null;
  errorCode?: string;
  stopRequestedAt?: number;
}

export interface MetricsSnapshot {
  taskCount: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  averageQueueDurationMs: number;
  degradeCount: number;
  failureCount: number;
  cancellationCount: number;
  policySwitchCount: number;
  capturedAt: number;
}

export type Unsubscribe = () => void;
export type StateCallback = (state: DeviceState, mode: PolicyMode) => void;
export type SchedulerLogCallback = (entry: SchedulerLogEntry) => void;
export type TaskExecutor<TInput, TOutput> =
  (input: TInput, plan: ExecutionPlan, signal: CancellationSignal) => Promise<TOutput>;
