import { ToolDescriptor, TaskConstraints, TaskGraph } from './cixin';
import { DeviceState, ExecutionPlan, TaskContext, TaskResult, TaskTemplate,
  WorkloadExecutor, RealDeviceStatePatch } from '../scheduler/api/SchedulerTypes';

export type Mode = 'LOCAL_ONLY' | 'SHADOW' | 'ACTIVE';
export interface BoardIdentity {
  deviceId: string;
  family: 'cix' | 'host';
  model: string;
  os: string;
  arch: string;
  kernel: string;
  runtime: string;
  environmentKey: string;
}
export interface BoardAdapter {
  identity: BoardIdentity;
  sample(): Promise<RealDeviceStatePatch>;
}
export interface ToolImplementation {
  descriptor: ToolDescriptor;
  template: TaskTemplate;
  executor: WorkloadExecutor<unknown, unknown>;
  modelDigest: string;
  runtimeVersion: string;
  probe(): Promise<{ available: boolean; reason?: string }>;
}
export interface FleetConstraints extends TaskConstraints {
  allowRemote?: boolean;
  allowedDeviceIds?: string[];
  inputSanitized?: boolean;
}
export interface TaskSubmission {
  toolId: string;
  input: unknown;
  constraints?: FleetConstraints;
}
// Quotes carry requirements and sizes, never application inputs.
export interface QuoteRequest {
  toolId: string;
  contractDigest: string;
  modelDigest: string;
  constraints: FleetConstraints;
  inputBytes: number;
  remainingMs: number;
}
export interface Quote {
  deviceId: string;
  bootId: string;
  environmentKey: string;
  toolId: string;
  accepted: boolean;
  reasons: string[];
  plan?: ExecutionPlan;
  state: DeviceState;
  queueMs: number;
  computeMs: number;
  sampleCount: number;
  receivedAtMs?: number;
}
export interface AttemptRequest extends QuoteRequest {
  originDeviceId: string;
  epoch: string;
  attemptId: string;
  targetDeviceId: string;
  bootId: string;
  input: unknown;
}
export interface AttemptRecord {
  key: string;
  requestDigest: string;
  originDeviceId: string;
  bootId: string;
  status: 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled' | 'rejected' | 'unknown';
  result?: TaskResult<unknown>;
  reason?: string;
  createdAt: number;
  updatedAt: number;
}
export interface PeerConfig {
  deviceId: string;
  url: string;
  tokenEnv: string;
  // Conservative operator-measured lower bound; no assumed LAN throughput.
  bytesPerSecond: number;
}
export interface RuntimeConfig {
  deviceId: string;
  family: 'cix' | 'host';
  boardModel?: string;
  host: string;
  port: number;
  tokenEnv: string;
  dataDir: string;
  mode: Mode;
  minRemoteSamples: number;
  maxConcurrentLocalTasks: 1 | 2;
  cpuWorkerBudget: number;
  maxPendingTasks: number;
  peers: PeerConfig[];
  workers?: ProcessWorkerConfig[];
  thermal?: { path: string; warmC: number; hotC: number; criticalC: number };
}
export interface ProcessWorkerConfig {
  manifestPath: string;
  command: string;
  args: string[];
}
export interface Candidate {
  deviceId: string;
  accepted: boolean;
  reasons: string[];
  quote?: Quote;
  transferMs: number;
  totalMs: number;
  uncertaintyMs: number;
}
export interface FleetDecision {
  mode: Mode;
  status: 'ready' | 'blocked';
  selectedDeviceId: string | null;
  suggestedDeviceId: string | null;
  candidates: Candidate[];
}
export interface RunRecord {
  runId: string;
  taskGraph?: TaskGraph;
  status: 'planning' | 'running' | 'completed' | 'blocked' | 'failed' | 'unknown';
  decision?: FleetDecision;
  attemptKey?: string;
  targetDeviceId?: string;
  result?: AttemptRecord;
  nodes?: Record<string, RunRecord>;
  reason?: string;
  createdAt: number;
  updatedAt: number;
}
export interface ToolInfo {
  descriptor: ToolDescriptor;
  contractDigest: string;
  modelDigest: string;
  runtimeVersion: string;
}
export interface NodeSnapshot {
  protocolVersion: 1;
  bootId: string;
  identity: BoardIdentity;
  state: DeviceState;
  tools: ToolInfo[];
  missingCapabilities: string[];
}
export interface BoundTask { context: TaskContext; template: TaskTemplate; input: unknown }
