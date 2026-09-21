import {
  ConstrainedPolicyConfig, ConstrainedPolicyMode, ExecutionProfile, InferenceLocation,
  ModelTier, TaskTemplate
} from '../api/SchedulerTypes';
import { SchedulerError, SchedulerErrorCode } from '../api/SchedulerError';

function invalid(message: string): void {
  throw new SchedulerError(SchedulerErrorCode.INVALID_CONFIG, message);
}

function positiveInteger(value: number | undefined): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value > 0);
}

export function validateManifest(template: TaskTemplate): void {
  const manifest = template.manifest;
  if (manifest === undefined) { return; }
  if (template.workflow !== undefined || template.inferenceLocation !== InferenceLocation.LOCAL_DEVICE) {
    invalid('V1 execution profiles belong to local leaf templates.');
  }
  if (!Array.isArray(manifest.profiles) || manifest.profiles.length < 1 || manifest.profiles.length > 16 ||
    !Array.isArray(manifest.profileTransitions) || manifest.profileTransitions.length > 64) {
    invalid('A manifest needs 1..16 profiles and at most 64 transitions.');
  }
  const ids: string[] = [];
  const tiers: ModelTier[] = [ModelTier.LIGHTWEIGHT, ModelTier.BALANCED, ModelTier.HIGH_ACCURACY];
  manifest.profiles.forEach((profile: ExecutionProfile) => {
    const level = template.qualityLevels.find((item) => item.id === profile.qualityLevelId);
    if (typeof profile.id !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(profile.id) ||
      ids.indexOf(profile.id) >= 0 || level === undefined || level.modelTier !== profile.modelTier ||
      tiers.indexOf(profile.estimatedQualityLevel) < 0 ||
      level.supportedBackends.indexOf(profile.backend) < 0 ||
      level.supportedThreadCounts.indexOf(profile.workerCount) < 0 ||
      !positiveInteger(profile.candidateCount) || !positiveInteger(profile.retrievalDimensions) ||
      !positiveInteger(profile.batchSize)) { invalid('Unsupported or duplicate execution profile.'); }
    if ([profile.allowWarmup, profile.supportsForeground, profile.supportsBackground,
      profile.safeUnderPressure, profile.qualityValidated, profile.lowRisk].some((value: boolean) => typeof value !== 'boolean') ||
      (!profile.supportsForeground && !profile.supportsBackground)) { invalid('Profile flags must be explicit.'); }
    ids.push(profile.id);
  });
  if (ids.indexOf(manifest.defaultProfileId) < 0 || ids.indexOf(manifest.fallbackProfileId) < 0) {
    invalid('Default and fallback profiles must exist.');
  }
  const edges: string[] = [];
  manifest.profileTransitions.forEach((edge) => {
    const key: string = `${edge.from}:${edge.to}`;
    if (edge.from === edge.to || ids.indexOf(edge.from) < 0 || ids.indexOf(edge.to) < 0 || edges.indexOf(key) >= 0) {
      invalid('Invalid profile transition.');
    }
    edges.push(key);
  });
}

export function defaultConstrainedPolicy(): ConstrainedPolicyConfig {
  return { version: 'local-observe-v1', mode: ConstrainedPolicyMode.OBSERVE,
    expiresAtMs: Number.MAX_SAFE_INTEGER, rolloutPercent: 0, minimumSampleCount: 10,
    cooldownMs: 30000, observationWindowSize: 50, consecutiveFailureLimit: 3, rules: [] };
}

export function validatePolicy(config: ConstrainedPolicyConfig): void {
  if (typeof config.version !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(config.version) ||
    [ConstrainedPolicyMode.OBSERVE, ConstrainedPolicyMode.SHADOW, ConstrainedPolicyMode.CANARY,
      ConstrainedPolicyMode.ACTIVE].indexOf(config.mode) < 0 ||
    !Number.isSafeInteger(config.expiresAtMs) || config.expiresAtMs <= 0 ||
    !Number.isFinite(config.rolloutPercent) || config.rolloutPercent < 0 || config.rolloutPercent > 100 ||
    !Number.isSafeInteger(config.minimumSampleCount) || config.minimumSampleCount < 2 ||
    !Number.isFinite(config.cooldownMs) || config.cooldownMs < 0 ||
    !Number.isSafeInteger(config.observationWindowSize) || config.observationWindowSize < config.minimumSampleCount ||
    config.observationWindowSize > 500 || !Number.isSafeInteger(config.consecutiveFailureLimit) ||
    config.consecutiveFailureLimit < 1 || config.consecutiveFailureLimit > 10 || !Array.isArray(config.rules) || config.rules.length > 64) {
    invalid('Invalid constrained policy settings.');
  }
  const capabilities: string[] = [];
  config.rules.forEach((rule) => {
    if (typeof rule.capability !== 'string' || rule.capability.length < 1 || rule.capability.length > 128 ||
      capabilities.indexOf(rule.capability) >= 0 || !Array.isArray(rule.allowedProfileIds) ||
      rule.allowedProfileIds.length < 1 || rule.allowedProfileIds.length > 16 ||
      rule.allowedProfileIds.some((id: string) => typeof id !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(id)) ||
      rule.allowedProfileIds.indexOf(rule.preferredProfileId) < 0) { invalid('Invalid capability policy rule.'); }
    capabilities.push(rule.capability);
  });
  if (config.mode === ConstrainedPolicyMode.CANARY || config.mode === ConstrainedPolicyMode.ACTIVE) {
    const limits = config.thresholds;
    if (limits === undefined || !Number.isFinite(limits.latencyRatio) || limits.latencyRatio < 1 ||
      [limits.failureRateDelta, limits.negativeFeedbackRateDelta, limits.cancellationRateDelta].some(
        (value: number) => !Number.isFinite(value) || value < 0 || value > 1) ||
      !positiveInteger(config.experimentStartedAtMs) || config.experimentStartedAtMs === undefined ||
      !positiveInteger(config.maximumExperimentDurationMs) || config.maximumExperimentDurationMs === undefined ||
      config.maximumExperimentDurationMs > 30 * 86400000) {
      invalid('Trials require explicit measured thresholds, start time and bounded duration.');
    }
    if (config.mode === ConstrainedPolicyMode.ACTIVE && config.activeValidated !== true) {
      invalid('ACTIVE requires host approval of completed validation.');
    }
  }
}

export function stablePolicyBucket(key: string): number {
  let hash: number = 2166136261;
  for (let i: number = 0; i < key.length; i++) { hash = Math.imul(hash ^ key.charCodeAt(i), 16777619); }
  return (hash >>> 0) % 10000;
}
