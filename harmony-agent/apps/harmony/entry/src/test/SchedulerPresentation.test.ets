import { afterEach, beforeEach, describe, expect, it } from '@ohos/hypium';
import { DeviceState, ModelTier, PolicyMode, SchedulerConfig, SchedulerLogCallback, SchedulerService, StateCallback, Unsubscribe } from 'scheduler';
import { SearchPreference, searchContext } from '../main/ets/services/SearchPreferences';
import { feedbackAvailabilityText } from '../main/ets/services/FeedbackPresentation';
import { readSchedulerSnapshot, SchedulerLiveFeed, SchedulerLiveSnapshot, SchedulerLiveSource } from '../main/ets/services/SchedulerLiveFeed';

function testConfig(): SchedulerConfig {
  return { defaultPolicyMode: PolicyMode.ADAPTIVE, enableDebugInjection: false, metricsWindowSize: 100,
    upgradeStableDurationMs: 0, minimumTierHoldMs: 0, executors: [] };
}

class ObservedSource extends SchedulerService implements SchedulerLiveSource {
  public subscriptions: number = 0;
  public failRead: boolean = false;
  public getDeviceState(): DeviceState {
    if (this.failRead) { throw new Error('state unavailable'); }
    return super.getDeviceState();
  }
  public registerStateCallback(callback: StateCallback): Unsubscribe {
    const detach = super.registerStateCallback(callback); this.subscriptions++;
    return () => { detach(); this.subscriptions--; };
  }
  public registerLogCallback(callback: SchedulerLogCallback): Unsubscribe {
    const detach = super.registerLogCallback(callback); this.subscriptions++;
    return () => { detach(); this.subscriptions--; };
  }
}

export default function schedulerPresentationTests(): void {
  describe('SchedulerPresentation', () => {
    let source: ObservedSource;
    let feed: SchedulerLiveFeed;
    beforeEach(() => { source = new ObservedSource(); feed = new SchedulerLiveFeed(source); });
    afterEach(async () => { source.failRead = false; feed.stop(); await source.shutdown(); });

    it('preferenceChangesContextWithoutGrantingNetworkOrExperimentPermission', 0, () => {
      const balanced = searchContext(5, 2700, SearchPreference.BALANCED);
      const speed = searchContext(5, 2700, SearchPreference.SPEED);
      const quality = searchContext(5, 2700, SearchPreference.QUALITY);
      expect(balanced.targetLatencyMs).assertEqual(500); expect(speed.targetLatencyMs).assertEqual(300);
      expect(quality.targetLatencyMs).assertEqual(800);
      expect(quality.accuracyFloor).assertEqual(ModelTier.HIGH_ACCURACY);
      expect(quality.highQuality).assertTrue(); expect(speed.networkAllowed).assertFalse();
      expect(speed.deadlineMs).assertEqual(3000); expect(speed.softDeadlineMs).assertEqual(1500);
      expect(speed.candidateCount).assertEqual(2700); expect(speed.userWaiting).assertTrue();
      expect(JSON.stringify(speed).indexOf('preferredProfileId') < 0).assertTrue();
      expect(searchContext(5, 2700, SearchPreference.SPEED, true).accuracyFloor).assertEqual(ModelTier.HIGH_ACCURACY);
    });

    it('feedbackPresentationExplainsConsentQuotaAndExpiry', 0, () => {
      expect(feedbackAvailabilityText({ eligible: false, reason: 'CONSENT_REQUIRED' }).indexOf('授权') >= 0).assertTrue();
      expect(feedbackAvailabilityText({ eligible: false, reason: 'CAPABILITY_DAILY_LIMIT' }).indexOf('今日') >= 0).assertTrue();
      expect(feedbackAvailabilityText({ eligible: false, reason: 'INVITATION_EXPIRED' }).indexOf('过期') >= 0).assertTrue();
      expect(feedbackAvailabilityText({ eligible: false, reason: 'ALREADY_ANSWERED' }).indexOf('回答') >= 0).assertTrue();
    });

    it('feedbackPresentationExplainsWhyKnownSignalsDoNotNeedQuestions', 0, () => {
      expect(feedbackAvailabilityText({ eligible: false, reason: 'NO_QUESTION_NEEDED' }).indexOf('不提问') >= 0).assertTrue();
    });

    it('uninitializedFeedDoesNotInventDeviceMeasurements', 0, () => {
      const snapshot = readSchedulerSnapshot(source, 1);
      expect(snapshot.connected).assertFalse(); expect(snapshot.state === null).assertTrue();
      expect(snapshot.metrics === null).assertTrue(); expect(snapshot.activeTasks.length).assertEqual(0);
    });

    it('snapshotReadsActualStatePreservesUnknownsAndIsDetached', 0, async () => {
      await source.initialize(testConfig());
      source.updateRealDeviceState({ batteryPercent: 63, availableMemoryMb: 789, systemCpuUsage: null });
      const snapshot = readSchedulerSnapshot(source, 7);
      expect(snapshot.connected).assertTrue(); expect(snapshot.sequence).assertEqual(7);
      expect(snapshot.state!.batteryPercent).assertEqual(63);
      expect(snapshot.state!.availableMemoryMb).assertEqual(789);
      expect(snapshot.state!.systemCpuUsage === null).assertTrue();
      snapshot.state!.batteryPercent = 0;
      expect(source.getDeviceState().batteryPercent).assertEqual(63);
      expect(snapshot.metrics!.taskCount).assertEqual(0);
    });

    it('readFailureIsDisconnectedInsteadOfShowingOldValuesAsLive', 0, async () => {
      await source.initialize(testConfig()); source.failRead = true;
      const snapshot = readSchedulerSnapshot(source, 2);
      expect(snapshot.connected).assertFalse(); expect(snapshot.state === null).assertTrue();
    });

    it('feedSubscribesOnceUpdatesFromStateAndDetachesOnClose', 0, async () => {
      await source.initialize(testConfig());
      let latest: SchedulerLiveSnapshot = readSchedulerSnapshot(source, 0); let count = 0;
      const listener = (snapshot: SchedulerLiveSnapshot): void => { latest = snapshot; count++; };
      feed.start(listener); feed.start(listener);
      expect(source.subscriptions).assertEqual(2);
      source.updateRealDeviceState({ batteryPercent: 42 });
      await new Promise<void>((resolve) => setTimeout(resolve, 160));
      expect(latest.state!.batteryPercent).assertEqual(42); expect(count >= 3).assertTrue();
      feed.stop(); expect(source.subscriptions).assertEqual(0);
      const stoppedCount = count;
      source.updateRealDeviceState({ batteryPercent: 41 });
      await new Promise<void>((resolve) => setTimeout(resolve, 160));
      expect(count).assertEqual(stoppedCount);
    });

    it('feedRecoversWhenOpenedBeforeSchedulerInitialization', 0, async () => {
      let latest = readSchedulerSnapshot(source, 0);
      feed.start((snapshot: SchedulerLiveSnapshot) => { latest = snapshot; });
      expect(latest.connected).assertFalse();
      await source.initialize(testConfig());
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
      expect(latest.connected).assertTrue(); expect(source.subscriptions).assertEqual(2);
    });
  });
}
