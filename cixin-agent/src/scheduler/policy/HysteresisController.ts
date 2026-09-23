import {
  Backend,
  InferenceLocation,
  LocalExecutionPlan,
  ModelTier,
  ThreadCount
} from '../api/SchedulerTypes';
import { SchedulerReasonCode } from './SchedulerReasonCode';

interface HysteresisState {
  currentTier: ModelTier | null;
  lastTransitionAt: number;
  pendingUpgradeTier: ModelTier | null;
  pendingUpgradeSince: number;
}

interface ProfileHold {
  id: string;
  version: string;
  changedAt: number;
}

export class HysteresisController {
  private readonly profileHolds: Map<string, ProfileHold> = new Map<string, ProfileHold>();

  public currentProfile(key: string, version: string, baseline: string): string {
    const state = this.profileHolds.get(key);
    return state !== undefined && state.version === version ? state.id : baseline;
  }

  public profileCooling(key: string, version: string, now: number, cooldownMs: number): boolean {
    const state = this.profileHolds.get(key);
    return state !== undefined && (state.version !== version || now - state.changedAt < cooldownMs);
  }

  public commitProfile(key: string, version: string, id: string, now: number): void {
    const state = this.profileHolds.get(key);
    if (state !== undefined && state.version === version && state.id === id) { return; }
    if (this.profileHolds.size >= 256 && state === undefined) {
      this.profileHolds.delete(Array.from(this.profileHolds.keys())[0]);
    }
    this.profileHolds.set(key, { id: id, version: version, changedAt: now });
  }
  private readonly upgradeStableDurationMs: number;
  private readonly minimumTierHoldMs: number;
  private readonly states: Map<string, HysteresisState> = new Map<string, HysteresisState>();

  constructor(upgradeStableDurationMs: number, minimumTierHoldMs: number) {
    this.upgradeStableDurationMs = upgradeStableDurationMs;
    this.minimumTierHoldMs = minimumTierHoldMs;
  }

  public apply(candidate: LocalExecutionPlan, nowMs: number = Date.now(), key: string = 'default'): LocalExecutionPlan {
    const state: HysteresisState = this.getState(key);
    if (state.currentTier === null) {
      state.currentTier = candidate.modelTier;
      state.lastTransitionAt = nowMs;
      this.clearPendingUpgrade(state);
      return this.copyWithTier(candidate, candidate.modelTier, SchedulerReasonCode.HYSTERESIS_INITIAL_TIER);
    }
    const currentTier: ModelTier = state.currentTier;

    const candidateRank: number = this.getTierRank(candidate.modelTier);
    const currentRank: number = this.getTierRank(currentTier);

    if (candidateRank < currentRank) {
      state.currentTier = candidate.modelTier;
      state.lastTransitionAt = nowMs;
      this.clearPendingUpgrade(state);
      return this.copyWithTier(
        candidate,
        candidate.modelTier,
        SchedulerReasonCode.HYSTERESIS_DEGRADE_IMMEDIATE
      );
    }

    if (candidateRank === currentRank) {
      this.clearPendingUpgrade(state);
      return candidate;
    }

    if (state.pendingUpgradeTier !== candidate.modelTier || nowMs < state.pendingUpgradeSince) {
      state.pendingUpgradeTier = candidate.modelTier;
      state.pendingUpgradeSince = nowMs;
    }

    const holdSatisfied: boolean = nowMs - state.lastTransitionAt >= this.minimumTierHoldMs;
    const stableSatisfied: boolean = nowMs - state.pendingUpgradeSince >= this.upgradeStableDurationMs;
    if (!holdSatisfied) {
      return this.copyWithTier(candidate, currentTier, SchedulerReasonCode.HYSTERESIS_MINIMUM_HOLD);
    }
    if (!stableSatisfied) {
      return this.copyWithTier(candidate, currentTier, SchedulerReasonCode.HYSTERESIS_UPGRADE_WAIT);
    }

    const nextTier: ModelTier = this.getNextHigherTier(currentTier);
    state.currentTier = nextTier;
    state.lastTransitionAt = nowMs;
    this.clearPendingUpgrade(state);
    return this.copyWithTier(candidate, nextTier, SchedulerReasonCode.HYSTERESIS_STEP_UP);
  }

  public getCurrentTier(key: string = 'default'): ModelTier | null {
    return this.getState(key).currentTier;
  }

  public reset(key?: string): void {
    if (key === undefined) {
      this.states.clear();
      return;
    }
    this.states.delete(key);
  }

  private getState(key: string): HysteresisState {
    const existing: HysteresisState | undefined = this.states.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created: HysteresisState = {
      currentTier: null,
      lastTransitionAt: 0,
      pendingUpgradeTier: null,
      pendingUpgradeSince: 0
    };
    this.states.set(key, created);
    return created;
  }

  private clearPendingUpgrade(state: HysteresisState): void {
    state.pendingUpgradeTier = null;
    state.pendingUpgradeSince = 0;
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
