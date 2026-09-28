// Scheduling wire v1. Keep in parity with core/runtime/scheduling-protocol.ts.
// No business payloads, credentials, filesystem paths or provider URLs here.
export interface ArtifactRef {
  artifactId: string;
  contentVersion: number;
  contentHash: string;
  schemaId: string;
  schemaVersion: number;
}
export interface ArtifactLocation {
  deviceId: string;
  resolver: 'object_store' | 'device_cache' | 'database';
  locatorId: string;
}
export interface ArtifactManifest {
  protocolVersion: 1;
  ref: ArtifactRef;
  kind: string;
  state: 'STAGING' | 'COMMITTED' | 'EXPIRED' | 'DELETED';
  sizeBytes: number | null;
  hashAlgorithm: 'sha256';
  mediaType: string;
  ownerId: string;
  privacy: 'LOCAL_ONLY' | 'AUTHORIZED_REMOTE';
  locations: ArtifactLocation[];
  dependencies: ArtifactRef[];
  createdAt: number;
  expiresAt: number | null;
}
export interface CheckpointFormat {
  format: string;
  version: number;
  restoreCapability: string;
  portability: 'LOGICAL' | 'PORTABLE' | 'DEVICE_SPECIFIC' | 'PROCESS_LOCAL';
}
export interface ModelCompatibility {
  modelId: string;
  modelVersion: string;
  embeddingKind: 'visual' | 'multimodal' | 'text';
  dimension: number;
  dtype: string;
  normalization: string;
  preprocessVersion: string;
  indexSpaceId: string;
}
export interface TaskContractV1 {
  protocolVersion: 1;
  contractId: string;
  version: number;
  capability: string;
  inputSchemas: string[];
  outputSchemas: string[];
  restartable: boolean;
  preemptionBoundary: 'NONE' | 'BATCH' | 'STAGE';
  checkpointFormats: CheckpointFormat[];
  sideEffectPolicy: 'PURE' | 'IDEMPOTENT_WRITE' | 'TRANSACTIONAL' | 'NO_REPLAY';
  maxAttempts: number;
  model?: ModelCompatibility;
}
export interface BudgetV1 {
  totalBudgetMs: number;
  remainingBudgetMs: number;
  expiresAt: number;
}
export interface TaskInstanceV1 {
  protocolVersion: 1;
  traceId: string;
  workflowId: string;
  nodeId: string;
  taskId: string;
  attemptId: string;
  coordinatorId: string;
  contractId: string;
  contractVersion: number;
  requestRevision: number;
  budget: BudgetV1;
  inputs: ArtifactRef[];
  networkAllowed: boolean;
  privacy: 'LOCAL_ONLY' | 'AUTHORIZED_REMOTE';
}
export function protocolId(value: string): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
}
export function validArtifactRef(ref: ArtifactRef): boolean {
  return ref !== null && typeof ref === 'object' && protocolId(ref.artifactId) &&
    Number.isSafeInteger(ref.contentVersion) && ref.contentVersion > 0 && protocolId(ref.schemaId) &&
    Number.isSafeInteger(ref.schemaVersion) && ref.schemaVersion === 1 &&
    typeof ref.contentHash === 'string' && /^[a-f0-9]{64}$/.test(ref.contentHash);
}
export function validArtifact(manifest: ArtifactManifest): boolean {
  if (manifest === null || typeof manifest !== 'object' || manifest.protocolVersion !== 1 ||
    !validArtifactRef(manifest.ref) || !protocolId(manifest.kind) || !protocolId(manifest.ownerId) ||
    ['STAGING', 'COMMITTED', 'EXPIRED', 'DELETED'].indexOf(manifest.state) < 0 ||
    ['LOCAL_ONLY', 'AUTHORIZED_REMOTE'].indexOf(manifest.privacy) < 0 || manifest.hashAlgorithm !== 'sha256' ||
    typeof manifest.mediaType !== 'string' || manifest.mediaType.length > 128 ||
    !Number.isFinite(manifest.createdAt) || manifest.createdAt < 0 ||
    (manifest.expiresAt !== null && (!Number.isFinite(manifest.expiresAt) || manifest.expiresAt <= manifest.createdAt)) ||
    !Array.isArray(manifest.locations) || !Array.isArray(manifest.dependencies) ||
    manifest.locations.length > 16 || manifest.dependencies.length > 256) { return false; }
  if (manifest.state === 'COMMITTED' && (manifest.sizeBytes === null || manifest.locations.length === 0)) { return false; }
  if (manifest.sizeBytes !== null && (!Number.isSafeInteger(manifest.sizeBytes) || manifest.sizeBytes < 0)) { return false; }
  return manifest.dependencies.every((ref: ArtifactRef) => validArtifactRef(ref)) &&
    manifest.locations.every((location: ArtifactLocation) => location !== null &&
      protocolId(location.deviceId) && protocolId(location.locatorId) &&
      ['object_store', 'device_cache', 'database'].indexOf(location.resolver) >= 0);
}
export function validTaskInstance(task: TaskInstanceV1): boolean {
  if (task === null || typeof task !== 'object' || task.protocolVersion !== 1 ||
    ![task.traceId, task.workflowId, task.nodeId, task.taskId, task.attemptId, task.coordinatorId, task.contractId]
      .every((value: string) => protocolId(value)) || task.contractVersion !== 1 ||
    !Number.isSafeInteger(task.requestRevision) || task.requestRevision < 0 ||
    typeof task.networkAllowed !== 'boolean' || ['LOCAL_ONLY', 'AUTHORIZED_REMOTE'].indexOf(task.privacy) < 0 ||
    !Array.isArray(task.inputs) || task.inputs.length > 256 || task.budget === null || typeof task.budget !== 'object') { return false; }
  const budget = task.budget;
  return Number.isFinite(budget.totalBudgetMs) && budget.totalBudgetMs > 0 &&
    Number.isFinite(budget.remainingBudgetMs) && budget.remainingBudgetMs > 0 &&
    budget.remainingBudgetMs <= budget.totalBudgetMs && Number.isFinite(budget.expiresAt) && budget.expiresAt > 0 &&
    task.inputs.every((ref: ArtifactRef) => validArtifactRef(ref));
}
export function compatibleModel(required: ModelCompatibility, actual: ModelCompatibility): boolean {
  return required.modelId === actual.modelId && required.modelVersion === actual.modelVersion &&
    required.embeddingKind === actual.embeddingKind && required.dimension > 0 && required.dimension === actual.dimension &&
    required.dtype === actual.dtype && required.normalization === actual.normalization &&
    required.preprocessVersion === actual.preprocessVersion && required.indexSpaceId === actual.indexSpaceId;
}
