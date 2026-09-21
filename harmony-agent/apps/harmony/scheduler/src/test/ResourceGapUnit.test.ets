import { memoryKilobytesToMb } from '../main/ets/state/ResourceUnits';
import { describe, expect, it } from '@ohos/hypium';
import { DeviceStateController, DeviceStateSource, MemoryPressure, ThermalLevel, TaskQueue,
  QueueItem, TaskPriority, TaskType } from '../../Index';

export default function resourceGapTests(): void {
  describe('ResourceGapContracts', () => {
    it('convertsLowAvailableMemoryUsingSdkUnitsRatherThanMagnitudeGuessing', 0, () => {
      expect(memoryKilobytesToMb(32768)).assertEqual(32);
      expect(memoryKilobytesToMb(8 * 1024 * 1024)).assertEqual(8192);
      expect(memoryKilobytesToMb(191.9 * 1024)).assertEqual(191);
    });
    it('keepsInvalidMemoryUnknown', 0, () => {
      expect(memoryKilobytesToMb(-1) === null).assertTrue();
      expect(memoryKilobytesToMb(NaN) === null).assertTrue();
    });
    it('expiresEachFieldWithoutRefreshingOldSensorsFromQueueUpdates', 0, () => {
      const state = new DeviceStateController();
      state.applyRealState({ batteryPercent: 60, thermalLevel: ThermalLevel.HOT,
        systemCpuUsage: 30, memoryPressure: MemoryPressure.NORMAL, availableMemoryMb: 2048 }, 1000);
      state.applyRealState({ queueDepth: 4, systemCpuUsage: 10 }, 32001);
      const snapshot = state.getSnapshot(32001);
      expect(snapshot.batteryPercent === null).assertTrue();
      expect(snapshot.thermalLevel).assertEqual(ThermalLevel.UNKNOWN);
      expect(snapshot.availableMemoryMb === null).assertTrue();
      expect(snapshot.systemCpuUsage).assertEqual(10);
      expect(snapshot.sampledAt!['batteryPercent']).assertEqual(1000);
    });
    it('keepsExplicitDebugOverlayWhileUnderlyingRealSampleExpires', 0, () => {
      const state = new DeviceStateController();
      state.applyRealState({ batteryPercent: 80 }, 1000);
      state.applyDebugState({ batteryPercent: 5 }, 1001);
      expect(state.getSnapshot(50000).batteryPercent).assertEqual(5);
      expect(state.getSnapshot(50000).source).assertEqual(DeviceStateSource.MIXED);
      state.clearDebugState(50000);
      expect(state.getSnapshot(50000).batteryPercent === null).assertTrue();
    });
    it('doesNotExposeMutableSampleTimestamps', 0, () => {
      const state = new DeviceStateController();
      state.applyRealState({ batteryPercent: 80 }, 1000);
      state.getSnapshot(1001).sampledAt!['batteryPercent'] = 50000;
      expect(state.getSnapshot(50000).batteryPercent === null).assertTrue();
    });
    it('grantsOverdueBackgroundWorkAFreeSlotDespiteHigherUtility', 0, () => {
      let now: number = 0;
      const queue = new TaskQueue<QueueItem>((): number => now);
      queue.enqueue({ taskId: 'background', taskType: TaskType.BACKGROUND_BATCH,
        priority: TaskPriority.LOW, paused: false, pausable: true, utilityScore: 0 });
      now = 30001;
      queue.enqueue({ taskId: 'foreground', taskType: TaskType.FOREGROUND_REALTIME,
        priority: TaskPriority.CRITICAL, paused: false, pausable: false, utilityScore: 120 });
      expect(queue.dequeue()!.taskId).assertEqual('background');
      expect(queue.dequeue()!.taskId).assertEqual('foreground');
    });
    it('keepsExpiredRealFieldsUnknownUnderPartialDebugOverlay', 0, () => {
      const state = new DeviceStateController();
      state.applyRealState({ batteryPercent: 80, thermalLevel: ThermalLevel.NORMAL,
        memoryPressure: MemoryPressure.NORMAL, availableMemoryMb: 2048 }, 1000);
      state.applyDebugState({ batteryPercent: 5 }, 1001);
      const snapshot = state.getSnapshot(40000);
      expect(snapshot.batteryPercent).assertEqual(5);
      expect(snapshot.thermalLevel).assertEqual(ThermalLevel.UNKNOWN);
      expect(snapshot.memoryPressure).assertEqual(MemoryPressure.UNKNOWN);
      expect(snapshot.availableMemoryMb === null).assertTrue();
      expect(snapshot.observations!.find((item) => item.field === 'thermal')!.observedAtMs).assertEqual(1000);
    });
    it('returnsDetachedRealAndDebugObservationMetadata', 0, () => {
      const state = new DeviceStateController();
      state.applyRealState({ thermalLevel: ThermalLevel.NORMAL }, 1000);
      state.applyDebugState({ batteryPercent: 5 }, 1001);
      const snapshot = state.getSnapshot(1002);
      snapshot.observations!.forEach((item) => { item.observedAtMs = 99999; });
      const next = state.getSnapshot(1003);
      expect(next.observations!.find((item) => item.field === 'thermal')!.observedAtMs).assertEqual(1000);
      expect(next.observations!.find((item) => item.field === 'battery')!.observedAtMs).assertEqual(1001);
    });
    it('fairnessNeverOverridesProtectionPause', 0, () => {
      let now: number = 0;
      const queue = new TaskQueue<QueueItem>((): number => now);
      queue.enqueue({ taskId: 'protected', taskType: TaskType.BACKGROUND_BATCH,
        priority: TaskPriority.LOW, paused: true, pausable: true });
      now = 60000;
      queue.enqueue({ taskId: 'foreground', taskType: TaskType.USER_INITIATED,
        priority: TaskPriority.HIGH, paused: false, pausable: false });
      expect(queue.dequeue()!.taskId).assertEqual('foreground');
      expect(queue.dequeue() === null).assertTrue();
    });
  });
}
