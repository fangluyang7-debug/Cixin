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

export enum MemoryPressure {
  UNKNOWN = 'UNKNOWN',
  NORMAL = 'NORMAL',
  MODERATE = 'MODERATE',
  HIGH = 'HIGH',
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
  remoteOptions?: RemoteExecutionOptions;
  metadata?: Record<string, string>;
  template?: TaskTemplate;
  context?: TaskContext;
  submittedAt?: number;
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
  remoteOptions?: RemoteExecutionOptions;
  template?: TaskTemplate;
  context?: TaskContext;
  submittedAt?: number;
  metadata?: Record<string, string>;
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
  utilityScore?: number;
  prediction?: ResourcePrediction;
  qualityLevelId?: string;
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
  completed?: boolean;
  checkpoint?: TaskCheckpoint;
  telemetry?: ExecutorTelemetry;
}

export interface WorkloadExecutor<TInput, TOutput> {
  capability: string;
  inferenceLocation: InferenceLocation;
  supports(plan: ExecutionPlan): boolean;
  warmup?(plan: ExecutionPlan): Promise<void>;
  execute(input: TInput, plan: ExecutionPlan, signal: CancellationSignal,
    checkpoint?: TaskCheckpoint): Promise<ExecutorResult<TOutput>>;
  dispose(): Promise<void>;
}

export interface DeviceState {
  batteryPercent: number | null;
  isCharging: boolean | null;
  thermalLevel: ThermalLevel;
  appVisibility: AppVisibility;
  recentLatencyMs: number | null;
  queueDepth: number;
  systemCpuUsage: number | null;
  appCpuUsage: number | null;
  memoryPressure: MemoryPressure;
  totalMemoryMb: number | null;
  freeMemoryMb: number | null;
  availableMemoryMb: number | null;
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
  systemCpuUsage?: number | null;
  appCpuUsage?: number | null;
  memoryPressure?: MemoryPressure;
  totalMemoryMb?: number | null;
  freeMemoryMb?: number | null;
  availableMemoryMb?: number | null;
  availableBackends?: Backend[];
}

export interface DebugStatePatch {
  batteryPercent?: number | null;
  isCharging?: boolean | null;
  thermalLevel?: ThermalLevel;
  appVisibility?: AppVisibility;
  recentLatencyMs?: number | null;
  queueDepth?: number;
  systemCpuUsage?: number | null;
  appCpuUsage?: number | null;
  memoryPressure?: MemoryPressure;
  totalMemoryMb?: number | null;
  freeMemoryMb?: number | null;
  availableMemoryMb?: number | null;
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
  telemetry?: TaskTelemetry;
}

export interface MetricsSnapshot {
  evaluationCount: number;
  taskCount: number;
  runningCount: number;
  queuedCount: number;
  pausedCount: number;
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
export type TaskExecutor<TInput, TOutput> = (input: TInput, plan: ExecutionPlan) => Promise<TOutput>;

export enum Interruptibility {
  NON_INTERRUPTIBLE = 'NON_INTERRUPTIBLE',
  CANCEL_RESTART = 'CANCEL_RESTART',
  CHECKPOINT = 'CHECKPOINT'
}

export enum DuplicatePolicy {
  KEEP_ALL = 'KEEP_ALL',
  KEEP_LATEST = 'KEEP_LATEST',
  MERGE_EQUIVALENT = 'MERGE_EQUIVALENT'
}

export enum PrivacyPolicy {
  LOCAL_ONLY = 'LOCAL_ONLY',
  SANITIZED_REMOTE = 'SANITIZED_REMOTE',
  REMOTE_ALLOWED = 'REMOTE_ALLOWED'
}

export enum DependencyFailurePolicy {
  CANCEL_WORKFLOW = 'CANCEL_WORKFLOW',
  SKIP_DEPENDENTS = 'SKIP_DEPENDENTS'
}

export interface ResourceHints {
  modelVersion: string;
  modelSizeMb?: number;
  expectedMemoryMb?: number;
  baselineInputTokens?: number;
  baselineCandidateCount?: number;
  baselineInputElements?: number;
  complexity?: number;
}

export interface QualityLevel {
  id: string;
  modelTier: ModelTier;
  estimatedLatencyMs: number;
  estimatedMemoryMb?: number;
  relativeEnergyCost?: number;
  supportedBackends: Backend[];
  supportedThreadCounts: ThreadCount[];
}

export interface WorkflowNode {
  id: string;
  templateId: string;
  dependsOn: string[];
  failurePolicy: DependencyFailurePolicy;
}

export interface TaskTemplate {
  capability: string;
  taskType: TaskType;
  inferenceLocation: InferenceLocation;
  qualityLevels: QualityLevel[];
  interruptibility: Interruptibility;
  duplicatePolicy: DuplicatePolicy;
  privacyPolicy: PrivacyPolicy;
  resourceHints: ResourceHints;
  timeoutMs: number;
  workflow?: WorkflowNode[];
  outputNodeId?: string;
  remoteOptions?: RemoteExecutionOptions;
}

export interface TaskContext {
  deadlineMs?: number;
  freshnessMs?: number;
  userVisible: boolean;
  userWaiting: boolean;
  accuracyFloor: ModelTier;
  businessImportance?: number;
  inputShape?: number[];
  inputTokens?: number;
  candidateCount?: number;
  batchSize?: number;
  requestReplaced?: boolean;
  workflowId?: string;
  parentTaskId?: string;
  dependencyTaskIds?: string[];
  deduplicationKey?: string;
  networkAllowed?: boolean;
  inputSanitized?: boolean;
  highQuality?: boolean;
}

export enum TaskSignalType {
  PAGE_LEFT = 'PAGE_LEFT',
  INPUT_REPLACED = 'INPUT_REPLACED',
  CANCEL = 'CANCEL',
  RESULT_DISPLAYED = 'RESULT_DISPLAYED',
  RESULT_CONSUMED = 'RESULT_CONSUMED',
  RESULT_IGNORED = 'RESULT_IGNORED',
  WAITING_CHANGED = 'WAITING_CHANGED',
  QUALITY_REQUIRED = 'QUALITY_REQUIRED'
}

export interface TaskSignal {
  type: TaskSignalType;
  value?: boolean;
}

export interface TaskCheckpoint {
  cursor: number;
  data?: Object;
}

export interface ExecutorTelemetry {
  modelVersion?: string;
  modelSizeMb?: number;
  actualBackend?: Backend;
  actualThreads?: number;
  peakMemoryMb?: number;
  inputTokens?: number;
  inputShape?: number[];
  batchSize?: number;
  candidateCount?: number;
}

export interface ResourcePrediction {
  latencyMs: number;
  memoryMb: number | null;
  relativeEnergyCost: number;
  thermalRisk: number;
  deadlineMissRisk: number;
  confidence: number;
  sampleCount: number;
  source: string;
}

export interface TaskTelemetry {
  prediction?: ResourcePrediction;
  actual?: ExecutorTelemetry;
  predictionErrorMs?: number;
  sliceDurationMs?: number;
  checkpointCount: number;
  workflowId?: string;
  deadlineMissed: boolean;
  resultConsumed?: boolean;
  signal?: TaskSignalType;
}

export interface WorkflowInput<TInput> {
  input: TInput;
  outputs: Record<string, Object>;
}

export interface WorkflowResult<TOutput> {
  workflowId: string;
  status: TaskStatus;
  output: TOutput | null;
  nodes: TaskResult<Object>[];
  skippedNodeIds: string[];
  reasonCode?: string;
}

export interface WorkflowHandle<TOutput> {
  workflowId: string;
  result: Promise<WorkflowResult<TOutput>>;
  cancel(): Promise<boolean>;
  signal(signal: TaskSignal): Promise<void>;
}
