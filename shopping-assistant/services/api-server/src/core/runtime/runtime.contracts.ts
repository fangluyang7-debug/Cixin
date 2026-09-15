export type ExecutionLocation =
  | "auto"
  | "local_only"
  | "cloud_only"
  | "local_preferred"
  | "cloud_preferred";

export type PrivacyLevel = "public" | "internal" | "sensitive" | "high";

export type ComputeClass =
  | "general_cpu"
  | "neural_inference"
  | "network"
  | "storage";

export type BackendType =
  | "cpu"
  | "gpu"
  | "npu"
  | "cloud_api"
  | "network"
  | "storage";

export type RuntimePlatformId = "host" | "harmonyos" | "cix_p1" | "cloud";

export type UserPreference = "speed" | "quality" | "energy" | "privacy";

export interface ObjectiveWeights {
  latency: number;
  quality: number;
  energy: number;
  reliability: number;
}

export interface ToolQualityRequirements {
  requiresConfidence?: boolean;
  minimumConfidence?: number;
  minimumScore?: number;
  metrics?: string[];
}

export interface ToolConstraints {
  privacy: PrivacyLevel;
  locality: ExecutionLocation;
  allowLocal: boolean;
  allowCloud: boolean;
  maxLatencyMs?: number;
  estimatedDataBytes?: number;
  energyBudgetMah?: number;
  costBudgetMinorUnits?: number;
}

export interface ToolResourceHints {
  computeClass: ComputeClass;
  estimatedMemoryMb: number;
  modelId?: string;
  supportedInputSizes?: string[];
  /** Registered alternatives must preserve the tool's input/output contract. */
  modelVariants?: Array<{ modelId: string; tier: "light" | "full"; estimatedMemoryMb: number }>;
}

export interface ToolExecutionPolicy {
  supportsPause: boolean;
  supportsRetry: boolean;
  maxAttempts: number;
  compensationActions: string[];
}

export interface ToolDescriptor {
  toolId: string;
  version: string;
  description: string;
  inputType: string;
  outputType: string;
  preconditions: string[];
  postconditions: string[];
  quality: ToolQualityRequirements;
  constraints: ToolConstraints;
  resourceHints: ToolResourceHints;
  execution: ToolExecutionPolicy;
  defaultWeights: ObjectiveWeights;
}

export interface ToolPlugin {
  pluginId: string;
  version: string;
  tools: ToolDescriptor[];
}

export interface TaskConstraints {
  deadlineMs?: number;
  maxLatencyMs?: number;
  privacy?: PrivacyLevel;
  locality?: ExecutionLocation;
  minimumQuality?: number;
  energyBudgetMah?: number;
  costBudgetMinorUnits?: number;
  preference?: UserPreference;
  weights?: Partial<ObjectiveWeights>;
  priority?: "background" | "normal" | "interactive" | "urgent";
  allowDegrade?: boolean;
}

export interface CheckpointPolicy {
  enabled: boolean;
  intervalItems?: number;
  stopOnResourcePressure: boolean;
}

export interface FallbackPolicy {
  enabled: boolean;
  actions: string[];
  maxAttempts: number;
  replanAtStageBoundary: boolean;
}

export interface TaskIntent {
  taskId: string;
  toolId: string;
  inputRef: string;
  outputType?: string;
  constraints?: TaskConstraints;
  dependencies?: string[];
  checkpointPolicy?: CheckpointPolicy;
  fallbackPolicy?: FallbackPolicy;
}

export interface TaskGraph {
  graphId: string;
  goal: string;
  nodes: TaskIntent[];
  createdAt?: string;
  planner?: string;
  demand?: TaskDemand;
}

export interface TaskDemand {
  /** Domain operation name. The generic scheduler does not interpret this value. */
  operation: string;
  realtime: "interactive" | "deferred";
  complexity: "simple" | "complex";
  deadlineMs: number;
  priority: NonNullable<TaskConstraints["priority"]>;
  source: "explicit_operation" | "local_template_rules" | "local_provider" | "external_planner";
  reasons: string[];
  plannerVersion: string;
  trainedModel: boolean;
  decisionConfidence?: number;
}

export interface ResourceForecast {
  method: "bounded_linear_trend_v1";
  horizonMs: number;
  risk: "nominal" | "warning" | "unknown" | "critical";
  action: "run_with_monitoring" | "run_conservatively" | "reject" | "stop_and_rollback";
  reasons: string[];
  advice: string[];
  unknownMetrics: string[];
  trendUnavailableMetrics?: string[];
  values: Record<string, { current: number | null; predicted: number | null; samples: number; margin: number }>;
}

export interface MetricObservation<T> {
  value: T | null;
  available: boolean;
  source: string;
  observedAt: string;
  reason?: string;
}

export interface ExecutorDescriptor {
  executorId: string;
  backend: BackendType;
  placement: "local" | "cloud";
  available: boolean;
  availabilityReason?: string;
  supportedComputeClasses: ComputeClass[];
  supportedModels: string[];
  totalMemoryMb: number | null;
  source: string;
  capabilities: string[];
}

export interface PlatformProfile {
  platformId: RuntimePlatformId;
  available: boolean;
  os: string | null;
  arch: string | null;
  runtimeVersion: string | null;
  cpuLogicalCores: number | null;
  totalMemoryMb: number | null;
  backends: ExecutorDescriptor[];
  missingCapabilities: string[];
  source: string;
  observedAt: string;
}

export interface RuntimeState {
  platformId: RuntimePlatformId;
  cpuUtilizationPercent: MetricObservation<number>;
  gpuUtilizationPercent: MetricObservation<number>;
  npuUtilizationPercent: MetricObservation<number>;
  temperatureCelsius: MetricObservation<number>;
  freeMemoryMb: MetricObservation<number>;
  networkLatencyMs: MetricObservation<number>;
  networkThroughputMbps: MetricObservation<number>;
  batteryPercent: MetricObservation<number>;
  diskFreeMb: MetricObservation<number>;
  activeTaskCount: MetricObservation<number>;
  /** Optional board-specific probes. A missing probe remains unavailable. */
  cpuFrequencyMhz?: MetricObservation<number>;
  cpuCoreUtilizationPercent?: MetricObservation<number[]>;
  cpuClusterFrequencyMhz?: MetricObservation<number[]>;
  cpuClusterUtilizationPercent?: MetricObservation<number[]>;
  gpuMemoryUsedMb?: MetricObservation<number>;
  gpuMemoryFreeMb?: MetricObservation<number>;
  npuMemoryUsedMb?: MetricObservation<number>;
  npuMemoryFreeMb?: MetricObservation<number>;
  dmaPoolFreeMb?: MetricObservation<number>;
  externalPower?: MetricObservation<boolean>;
  gpuFrequencyMhz?: MetricObservation<number>;
  npuFrequencyMhz?: MetricObservation<number>;
  networkJitterMs?: MetricObservation<number>;
  packetLossPercent?: MetricObservation<number>;
  powerWatts?: MetricObservation<number>;
  fanRpm?: MetricObservation<number>;
  ioReadMbps?: MetricObservation<number>;
  ioWriteMbps?: MetricObservation<number>;
  networkTxMbps?: MetricObservation<number>;
  networkRxMbps?: MetricObservation<number>;
  iops?: MetricObservation<number>;
  queueDepth?: MetricObservation<number>;
  queueWaitMs?: MetricObservation<number>;
  memoryBandwidthMbps?: MetricObservation<number>;
  dmaPoolUsedMb?: MetricObservation<number>;
  uptimeSeconds?: MetricObservation<number>;
  npuLatencyMs?: MetricObservation<number>;
  databaseLatencyMs?: MetricObservation<number>;
  pipelineFps?: MetricObservation<number>;
  droppedFrames?: MetricObservation<number>;
  thermalThrottle?: MetricObservation<boolean>;
  currentModel?: MetricObservation<string>;
  observedAt: string;
}

export interface PlatformHeartbeat {
  platformId: RuntimePlatformId;
  state: RuntimeState;
  profile?: PlatformProfile;
  executors?: ExecutorDescriptor[];
  reportedAt: string;
  source?: string;
}

export interface PlatformHeartbeatStatus {
  fresh: boolean;
  reportedAt: string;
  receivedAt: string;
  source: string;
  ageMs: number;
  expiresInMs: number;
  executorIds: string[];
}

export interface ModelProbeRequest {
  modelId?: string;
  computeClass: ComputeClass;
  inputType: string;
}

export interface ModelProbeResult {
  supported: boolean;
  executorId: string;
  modelId?: string;
  evidence: string;
  reason?: string;
  checkedAt: string;
}

export interface PerformanceSample {
  toolId: string;
  executorId: string;
  modelId?: string;
  sampleCount: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  memoryPeakMb: number | null;
  energyMah: number | null;
  quality: number | null;
  failureRate: number | null;
  noFallbackRate: number | null;
  measuredAt: string;
  source: string;
}

export interface TelemetryRecord {
  executionId: string;
  taskId: string;
  toolId: string;
  executorId: string;
  modelId?: string;
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
  memoryPeakMb: number;
  energyMah?: number | null;
  quality?: number | null;
  fallbackOccurred: boolean;
  success: boolean;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}

export interface ScoreBreakdown {
  latencyScore: number;
  qualityScore: number;
  energyScore: number;
  reliabilityScore: number;
  totalScore: number;
}

export interface CandidateEvaluation {
  executorId: string;
  placement: "local" | "cloud";
  backend: BackendType;
  accepted: boolean;
  reasons: string[];
  sample: PerformanceSample | null;
  score: ScoreBreakdown | null;
  modelId?: string;
  modelTier?: "light" | "full";
  estimatedLatencyMs?: number | null;
  estimatedMemoryMb?: number;
  forecast?: ResourceForecast;
}

export interface MissingRequirement {
  taskId?: string;
  code: string;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface ExecutionAssignment {
  taskId: string;
  toolId: string;
  executorId: string;
  placement: "local" | "cloud";
  backend: BackendType;
  modelId?: string;
  score: ScoreBreakdown;
  weights: ObjectiveWeights;
  reasons: string[];
  plannedAt: string;
  status: "planned";
  modelTier?: "light" | "full";
  estimatedLatencyMs?: number | null;
  estimatedMemoryMb?: number;
  estimatedEnergyMah?: number | null;
  forecast?: ResourceForecast;
}

export interface ExecutionPlan {
  graphId: string;
  status: "ready" | "blocked";
  executionOrder: string[];
  parallelGroups: string[][];
  assignments: ExecutionAssignment[];
  missingRequirements: MissingRequirement[];
  evaluations: Record<string, CandidateEvaluation[]>;
  generatedAt: string;
  estimatedCriticalPathMs?: number | null;
  advice?: string[];
  recommendedMaxConcurrency?: number;
}

export interface VerificationResult {
  passed: boolean;
  reasons: string[];
  recommendedActions: string[];
}

export interface RuntimeSnapshot {
  tools: ToolDescriptor[];
  platforms: Array<{
    profile: PlatformProfile;
    state: RuntimeState;
    executors: ExecutorDescriptor[];
    heartbeat: PlatformHeartbeatStatus | null;
  }>;
  performanceSamples: PerformanceSample[];
  missingRequirements: MissingRequirement[];
  activeRun: RuntimeRun | null;
  recentRuns: RuntimeRun[];
  capturedAt: string;
}

export type RuntimeRunStatus = "planning" | "ready" | "blocked" | "completed" | "failed"
  | "running" | "stopping" | "rolled_back" | "rollback_failed" | "cancelled";

export interface RuntimeVerificationEvent {
  taskId: string;
  toolId: string;
  passed: boolean;
  reasons: string[];
  recommendedActions: string[];
  recordedAt: string;
}

export interface RuntimeReplanEvent {
  reason: string;
  telemetryCount: number;
  recordedAt: string;
}

export interface RuntimeOperationStep {
  key: string;
  label: string;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  status: "ok" | "error" | "skipped";
  error?: string;
}

export interface RuntimeRun {
  runId: string;
  goal: string;
  taskGraph: TaskGraph | null;
  executionPlan: ExecutionPlan | null;
  telemetry: TelemetryRecord[];
  operationTimeline: RuntimeOperationStep[];
  verifications: RuntimeVerificationEvent[];
  replanEvents: RuntimeReplanEvent[];
  status: RuntimeRunStatus;
  outcome?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  protection?: {
    reason: string;
    advice: string[];
    checkpointTaskId?: string;
    rollback: "not_needed" | "pending" | "succeeded" | "unsupported" | "failed";
  };
  outputs?: Record<string, unknown>;
  checkpoints?: RuntimeCheckpoint[];
}

export interface RuntimeCheckpoint {
  checkpointId: string;
  executionId: string;
  taskId: string;
  executorId: string;
  status: "captured" | "committed" | "restored" | "restore_failed";
  capturedAt: string;
  updatedAt: string;
}

export interface TerminalProtectionEvent {
  runId: string;
  executionId: string;
  executorId: string;
  reason: "TERMINAL_THERMAL_REDLINE" | "TERMINAL_MEMORY_REDLINE" | "TERMINAL_EXECUTOR_LOST";
  observedAt: string;
  /** Terminal acknowledges stopping its own worker, not restoring the checkpoint. */
  workerStopped: true;
}
