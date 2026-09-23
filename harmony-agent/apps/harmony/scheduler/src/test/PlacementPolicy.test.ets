import { describe, expect, it } from '@ohos/hypium';
import {
  Backend, GlobalPlacementPolicy, MemoryPressure, ModelTier, PlacementDeviceProfile,
  PlacementLinkProfile, PlacementMode, PlacementSource, PrivacyPolicy,
  ResolvedTaskProfile, TaskContext, TaskTemplate, TaskType, InferenceLocation,
  Interruptibility, DuplicatePolicy, resolveTaskProfile, ThermalLevel
} from '../../Index';

const NOW: number = 100000;

function task(): ResolvedTaskProfile {
  return { capability: 'encode', modelVersion: 'v1', taskSignature: 'encode:v1:2', deadlineMs: 500,
    userWaiting: true, qualityFloor: ModelTier.HIGH_ACCURACY, privacyPolicy: PrivacyPolicy.REMOTE_ALLOWED,
    networkAllowed: true, inputSanitized: false, requiredBackend: Backend.CPU,
    minimumMemoryMb: 50, inputBytes: 1000, outputBytes: 1000 };
}

function device(id: string, local: boolean, compute: number): PlacementDeviceProfile {
  return { deviceId: id, local: local, source: local ? PlacementSource.REAL : PlacementSource.MOCK,
    trusted: true, online: true, receivedAtMs: NOW, heartbeatAgeMs: 0,
    thermalAgeMs: 0, memoryAgeMs: 0, cpuAgeMs: 0,
    thermalLevel: ThermalLevel.NORMAL, memoryPressure: MemoryPressure.NORMAL,
    availableMemoryMb: 1000, cpuUsage: 20, availableBackends: [Backend.CPU],
    modelVersions: ['v1'], loadedModelVersions: ['v1'], queueWaitMs: 0,
    computeMs: compute, coldLoadMs: 100 };
}

function link(): PlacementLinkProfile {
  return { fromDeviceId: 'local', toDeviceId: 'tablet', receivedAtMs: NOW,
    sampleAgeMs: 0, rttMs: 10, bytesPerSecond: 1000000, protocolMs: 2 };
}

export default function placementPolicyTests(): void {
  describe('PlacementPolicy', () => {
    it('keeps actual execution local even when remote shadow is faster', () => {
      const result = new GlobalPlacementPolicy().evaluate(task(), 'local',
        [device('local', true, 200), device('tablet', false, 30)], [link()], PlacementMode.SHADOW, NOW);
      expect(result.actualDeviceId).assertEqual('local');
      expect(result.suggestedDeviceId).assertEqual('tablet');
      expect(result.dispatchAllowed).assertFalse();
    });

    it('excludes remote when privacy or network permission forbids it', () => {
      const request = task(); request.privacyPolicy = PrivacyPolicy.LOCAL_ONLY;
      const result = new GlobalPlacementPolicy().evaluate(request, 'local',
        [device('local', true, 200), device('tablet', false, 30)], [link()], PlacementMode.SHADOW, NOW);
      expect(result.suggestedDeviceId).assertEqual('local');
      expect(result.rejectedDeviceIds.indexOf('tablet') >= 0).assertTrue();
    });

    it('excludes expired remote memory despite a fresh heartbeat', () => {
      const remote = device('tablet', false, 30); remote.memoryAgeMs = 3001;
      const result = new GlobalPlacementPolicy().evaluate(task(), 'local',
        [device('local', true, 200), remote], [link()], PlacementMode.SHADOW, NOW);
      expect(result.suggestedDeviceId).assertEqual('local');
    });

    it('accounts for transfer and cold model load', () => {
      const remote = device('tablet', false, 30); remote.loadedModelVersions = []; remote.coldLoadMs = 200;
      const result = new GlobalPlacementPolicy().evaluate(task(), 'local',
        [device('local', true, 100), remote], [link()], PlacementMode.SHADOW, NOW);
      expect(result.suggestedDeviceId).assertEqual('local');
      expect(result.estimates.find((item) => item.deviceId === 'tablet')!.modelLoadMs).assertEqual(200);
    });

    it('keeps declared privacy even with favorable user context', () => {
      const declaration: TaskTemplate = { capability: 'encode', taskType: TaskType.USER_INITIATED,
        inferenceLocation: InferenceLocation.LOCAL_DEVICE, qualityLevels: [],
        interruptibility: Interruptibility.NON_INTERRUPTIBLE, duplicatePolicy: DuplicatePolicy.KEEP_ALL,
        privacyPolicy: PrivacyPolicy.LOCAL_ONLY, resourceHints: { modelVersion: 'v1' }, timeoutMs: 500 };
      const context: TaskContext = { userVisible: true, userWaiting: true,
        accuracyFloor: ModelTier.LIGHTWEIGHT, networkAllowed: true, inputTokens: 8 };
      const resolved = resolveTaskProfile(declaration, context);
      expect(resolved.privacyPolicy).assertEqual(PrivacyPolicy.LOCAL_ONLY);
      expect(resolved.taskSignature).assertEqual('encode:v1:3');
    });
  });
}
