import { Backend, ExecutionProfile, ModelTier, TaskCapabilityManifest, ThreadCount } from 'scheduler';

function profile(id: string, tier: ModelTier, workers: ThreadCount, dimension?: number): ExecutionProfile {
  return { id: id, qualityLevelId: tier, modelTier: tier, backend: Backend.CPU, workerCount: workers,
    candidateCount: dimension === undefined ? undefined : 2700, retrievalDimensions: dimension,
    allowWarmup: false, supportsForeground: true, supportsBackground: true, estimatedQualityLevel: tier,
    safeUnderPressure: workers === 1, qualityValidated: tier === ModelTier.HIGH_ACCURACY, lowRisk: false };
}

export function encoderManifest(): TaskCapabilityManifest {
  return { profiles: [profile('ENCODE_DEFAULT', ModelTier.HIGH_ACCURACY, 2),
    profile('ENCODE_SAFE', ModelTier.HIGH_ACCURACY, 1)], defaultProfileId: 'ENCODE_DEFAULT',
    fallbackProfileId: 'ENCODE_SAFE', profileTransitions: [
      { from: 'ENCODE_DEFAULT', to: 'ENCODE_SAFE' }, { from: 'ENCODE_SAFE', to: 'ENCODE_DEFAULT' }] };
}

export function searchManifest(): TaskCapabilityManifest {
  // Same complete candidate set. Truncated dimensions await recall/quality evaluation.
  return { profiles: [profile('SEARCH_HIGH', ModelTier.HIGH_ACCURACY, 2, 256),
    profile('SEARCH_SAFE', ModelTier.HIGH_ACCURACY, 1, 256),
    profile('SEARCH_BALANCED', ModelTier.BALANCED, 2, 64),
    profile('SEARCH_FAST', ModelTier.LIGHTWEIGHT, 1, 16)],
    defaultProfileId: 'SEARCH_HIGH', fallbackProfileId: 'SEARCH_SAFE', profileTransitions: [
      { from: 'SEARCH_HIGH', to: 'SEARCH_BALANCED' }, { from: 'SEARCH_BALANCED', to: 'SEARCH_HIGH' },
      { from: 'SEARCH_BALANCED', to: 'SEARCH_FAST' }, { from: 'SEARCH_FAST', to: 'SEARCH_BALANCED' },
      { from: 'SEARCH_HIGH', to: 'SEARCH_SAFE' }, { from: 'SEARCH_SAFE', to: 'SEARCH_HIGH' }] };
}

export function warmupManifest(): TaskCapabilityManifest {
  const profiles: ExecutionProfile[] = [128, 32].map((size: number): ExecutionProfile => ({
    id: `WARMUP_${size}`, qualityLevelId: 'full-norm-cache-128-row-chunks', modelTier: ModelTier.LIGHTWEIGHT,
    backend: Backend.CPU, workerCount: 1, batchSize: size, allowWarmup: false,
    supportsForeground: true, supportsBackground: true, estimatedQualityLevel: ModelTier.LIGHTWEIGHT,
    safeUnderPressure: true, qualityValidated: true, lowRisk: true
  }));
  return { profiles: profiles, defaultProfileId: 'WARMUP_128', fallbackProfileId: 'WARMUP_32',
    profileTransitions: [{ from: 'WARMUP_128', to: 'WARMUP_32' }, { from: 'WARMUP_32', to: 'WARMUP_128' }] };
}
