import {
  Backend,
  InferenceLocation,
  LocalExecutionPlan,
  ModelTier,
  ThreadCount
} from '../api/SchedulerTypes';
import { SchedulerReasonCode } from './SchedulerReasonCode';

export class HysteresisController {
  private readonly upgradeStableDurationMs: number;
  private readonly minimumTierHoldMs: number;
  private currentTier: ModelTier | null = null;
  private lastTransitionAt: number = 0;
  private pendingUpgradeTier: ModelTier | null = null;
  private pendingUpgradeSince: number = 0;

  constructor(upgradeStableDurationMs: number, minimumTierHoldMs: number) {
    this.upgradeStableDurationMs = upgradeStableDurationMs;
    this.minimumTierHoldMs = minimumTierHoldMs;
  }

  public apply(candidate: LocalExecutionPlan, nowMs: number = Date.now()): LocalExecutionPlan {
    if (this.currentTier === null) {
      this.currentTier = candidate.modelTier;
      this.lastTransitionAt = nowMs;
      this.clearPendingUpgrade();
      return this.copyWithTier(candidate, candidate.modelTier, SchedulerReasonCode.HYSTERESIS_INITIAL_TIER);
    }

    const candidateRank: number = this.getTierRank(candidate.modelTier);
    const currentRank: number = this.getTierRank(this.currentTier);

    if (candidateRank < currentRank) {
      this.currentTier = candidate.modelTier;
      this.lastTransitionAt = nowMs;
      this.clearPendingUpgrade();
      return this.copyWithTier(
        candidate,
        candidate.modelTier,
        SchedulerReasonCode.HYSTERESIS_DEGRADE_IMMEDIATE
      );
    }

    if (candidateRank === currentRank) {
      this.clearPendingUpgrade();
      return candidate;
    }

    if (this.pendingUpgradeTier !== candidate.modelTier || nowMs < this.pendingUpgradeSince) {
      this.pendingUpgradeTier = candidate.modelTier;
      this.pendingUpgradeSince = nowMs;
    }

    const holdSatisfied: boolean = nowMs - this.lastTransitionAt >= this.minimumTierHoldMs;
    const stableSatisfied: boolean = nowMs - this.pendingUpgradeSince >= this.upgradeStableDurationMs;
    if (!holdSatisfied) {
      return this.copyWithTier(candidate, this.currentTier, SchedulerReasonCode.HYSTERESIS_MINIMUM_HOLD);
    }
    if (!stableSatisfied) {
      return this.copyWithTier(candidate, this.currentTier, SchedulerReasonCode.HYSTERESIS_UPGRADE_WAIT);
    }

    const nextTier: ModelTier = this.getNextHigherTier(this.currentTier);
    this.currentTier = nextTier;
    this.lastTransitionAt = nowMs;
    this.clearPendingUpgrade();
    return this.copyWithTier(candidate, nextTier, SchedulerReasonCode.HYSTERESIS_STEP_UP);
  }

  public getCurrentTier(): ModelTier | null {
    return this.currentTier;
  }

  public reset(): void {
    this.currentTier = null;
    this.lastTransitionAt = 0;
    this.clearPendingUpgrade();
  }

  private clearPendingUpgrade(): void {
    this.pendingUpgradeTier = null;
    this.pendingUpgradeSince = 0;
  }

  private copyWithTier(
    candidate: LocalExecutionPlan,
    tier: ModelTier,
    hysteresisReason: SchedulerReasonCode
  ): LocalExecutionPlan {
    const reasons: string[] = candidate.reasonCodes.filter((reasonCode: string) =>
      reasonCode !== SchedulerReasonCode.NPU_BACKEND_SELECTED &&
        reasonCode !== SchedulerReasonCode.GPU_BACKEND_SELECTED &&
        reasonCode !== SchedulerReasonCode.NNRT_BACKEND_SELECTED &&
        reasonCode !== SchedulerReasonCode.CPU_BACKEND_FALLBACK
    );
    reasons.push(hysteresisReason);
    const backend: Backend = tier === ModelTier.LIGHTWEIGHT ? Backend.CPU : candidate.backend;
    if (backend === Backend.CPU && candidate.backend !== Backend.CPU) {
      reasons.push(SchedulerReasonCode.CPU_BACKEND_FALLBACK);
    } else if (backend === Backend.NPU) {
      reasons.push(SchedulerReasonCode.NPU_BACKEND_SELECTED);
    } else if (backend === Backend.GPU) {
      reasons.push(SchedulerReasonCode.GPU_BACKEND_SELECTED);
    } else if (backend === Backend.NNRT) {
      reasons.push(SchedulerReasonCode.NNRT_BACKEND_SELECTED);
    }
    return {
      inferenceLocation: InferenceLocation.LOCAL_DEVICE,
      modelTier: tier,
      threadCount: this.resolveThreadCount(tier),
      backend: backend,
      priority: candidate.priority,
      queueAction: candidate.queueAction,
      reasonCodes: reasons,
      policyVersion: candidate.policyVersion
    };
  }

  private resolveThreadCount(tier: ModelTier): ThreadCount {
    if (tier === ModelTier.HIGH_ACCURACY) {
      return 4;
    }
    if (tier === ModelTier.BALANCED) {
      return 2;
    }
    return 1;
  }

  private getTierRank(tier: ModelTier): number {
    if (tier === ModelTier.HIGH_ACCURACY) {
      return 2;
    }
    if (tier === ModelTier.BALANCED) {
      return 1;
    }
    return 0;
  }

  private getNextHigherTier(tier: ModelTier): ModelTier {
    if (tier === ModelTier.LIGHTWEIGHT) {
      return ModelTier.BALANCED;
    }
    return ModelTier.HIGH_ACCURACY;
  }
}
