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
}

export interface ToolExecutionPolicy {
  supportsPause: boolean;
  supportsRetry: boolean;
  maxAttempts: number;
  compensationActions: string[];
}

export interface ToolDescriptor {
  // Explicit opt-in for bounded cold-start execution; never a performance sample.
  allowColdStart?: boolean;
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
  taskType?: "foreground_realtime" | "user_initiated" | "background_batch";
  deviceProfile?: Record<string, unknown>;
  networkProfile?: Record<string, unknown>;
  taskId: string;
  toolId: string;
  inputRef: string;
  outputType?: string;
  constraints?: TaskConstraints;
  dependencies?: string[];
  checkpointPolicy?: CheckpointPolicy;
  fallbackPolicy?: FallbackPolicy;
  // One observed route per candidate executor. No signed URL or credential is carried here.
  cloudRoutes?: CloudRouteObservation[];
}

export interface CloudRouteObservation {
  executorId: string;
  inputResidence: "device" | "zeabur_volume" | "cos" | "external_api";
  outputDestination?: "device" | "zeabur_volume" | "cos" | "external_api";
  accessMode: "inline_transfer" | "signed_object_url" | "co_located";
  transferAuthorized: boolean;
  inputBytes: number;
  outputBytes: number;
  roundTripMs: number;
  uploadMbps: number;
  downloadMbps: number;
  storageReadMs: number;
  storageWriteMs?: number;
  queueMs: number;
  estimatedFeeMinorUnits?: number;
  accessExpiresAt?: string;
  observedAt: string;
  source: "measured" | "declared";
}

export interface TaskGraph {
  clientTaskId?: string;
  graphId: string;
  goal: string;
  nodes: TaskIntent[];
  createdAt?: string;
  planner?: string;
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
  observedAt: string;
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
  latencyScope?: "execution_only" | "end_to_end" | "unknown";
  cloudExecutionP95Ms?: number | null;
}

export interface CloudExecutionFeedback {
  inputBytes: number;
  outputBytes: number;
  uploadMs: number;
  storageReadMs: number;
  storageWriteMs?: number;
  queueMs: number;
  executionMs: number;
  downloadMs: number;
  feeMinorUnits?: number;
  providerStatus?: string;
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
  latencyScope?: "execution_only" | "end_to_end";
  cloud?: CloudExecutionFeedback;
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
  estimatedEndToEndMs?: number;
  cloudOverheadMs?: number;
  estimatedFeeMinorUnits?: number;
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
  status: "planned" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out" | "blocked";
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  estimatedEndToEndMs?: number;
  cloudOverheadMs?: number;
  estimatedFeeMinorUnits?: number;
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
  }>;
  performanceSamples: PerformanceSample[];
  missingRequirements: MissingRequirement[];
  activeRun: RuntimeRun | null;
  recentRuns: RuntimeRun[];
  capturedAt: string;
}

export type RuntimeRunStatus = "planning" | "ready" | "running" | "blocked" | "completed" | "failed" | "cancelled" | "timed_out";

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
  clientTelemetry?: { taskId: string; observedAt: string; timing: Record<string, number | null> };
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
}
