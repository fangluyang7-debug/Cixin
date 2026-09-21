export interface ExperimentTrial {
  mode: string;
  background: boolean;
  repetition: number;
  queryId: string;
  startedAt: number;
  durationMs: number;
  status: string;
  workflowId: string;
  backgroundWorkflowId: string | null;
  constrainedPolicyVersion: string;
  constrainedPolicyMode: string;
  productIds?: string[];
  backgroundDurationMs: number | null;
  backgroundStatus: string;
  backgroundRows: number;
  samplePhase: string;
}

// Explicit export fields keep workload inputs out of the diagnostic format.
export function exportTrialRecords(trials: ExperimentTrial[], includeQualityIds: boolean = false): ExperimentTrial[] {
  return trials.map((trial: ExperimentTrial): ExperimentTrial => ({
    mode: trial.mode, background: trial.background, repetition: trial.repetition, queryId: trial.queryId,
    startedAt: trial.startedAt, durationMs: trial.durationMs, status: trial.status, workflowId: trial.workflowId,
    backgroundWorkflowId: trial.backgroundWorkflowId, constrainedPolicyVersion: trial.constrainedPolicyVersion,
    constrainedPolicyMode: trial.constrainedPolicyMode,
    productIds: includeQualityIds ? trial.productIds?.slice() : undefined,
    backgroundDurationMs: trial.backgroundDurationMs, backgroundStatus: trial.backgroundStatus,
    backgroundRows: trial.backgroundRows, samplePhase: trial.samplePhase
  }));
}
