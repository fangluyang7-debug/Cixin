import { ExecutionProfile, ResourcePrediction } from '../api/SchedulerTypes';

// Incremental speed is rewarded only after both profiles have actual samples.
// The bounded bonus cannot bypass the policy's hard constraints or rollout gates.
export function marginalAccelerationBonus(baseline: ExecutionProfile, baselineCost: ResourcePrediction,
  alternative: ExecutionProfile, alternativeCost: ResourcePrediction,
  targetLatencyMs: number | undefined): number {
  if (!alternative.qualityValidated || baselineCost.sampleCount < 5 || alternativeCost.sampleCount < 5 ||
    alternative.id === baseline.id) { return 0; }
  const savedMs: number = baselineCost.latencyMs - alternativeCost.latencyMs;
  const switchCostMs: number = 2;
  if (savedMs <= switchCostMs) { return 0; }
  const additionalWorkers: number = Math.max(1, alternative.workerCount - baseline.workerCount);
  const responseScale: number = Math.max(1, targetLatencyMs ?? baselineCost.latencyMs);
  return Math.min(10, (savedMs - switchCostMs) / responseScale * 20 / additionalWorkers);
}
