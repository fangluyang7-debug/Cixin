import { describe, expect, it } from '@ohos/hypium';
import { FeedbackKind } from '../../Index';
import { CalibrationSample, calibrateFeedback } from '../main/ets/policy/FeedbackCalibration';

export default function feedbackCalibrationTests(): void {
  describe('BoundedFeedbackCalibration', () => {
    it('singleAnswerDoesNotChangeParameters', 0, () => {
      const result = calibrateFeedback([{ profileId: 'full', feedbackKind: FeedbackKind.RESPONSE_TIME, negative: true }], 'full', 2, 10);
      expect(result.speedSamples).assertEqual(1); expect(result.latencyWeight).assertEqual(5);
      expect(result.qualityWeight).assertEqual(3); expect(result.profilePenalty).assertEqual(0);
    });
    it('slowAnswersIncreaseOnlyBoundedLatencyCost', 0, () => {
      const samples: CalibrationSample[] = [
        { profileId: 'full', feedbackKind: FeedbackKind.RESPONSE_TIME, negative: true },
        { profileId: 'full', feedbackKind: FeedbackKind.RESPONSE_TIME, negative: true }];
      const result = calibrateFeedback(samples, 'full', 2, 10);
      expect(result.latencyWeight).assertEqual(10); expect(result.qualityWeight).assertEqual(3);
      expect(result.profilePenalty).assertEqual(3);
    });
    it('qualityAnswersCannotBeCountedAsSpeedAnswers', 0, () => {
      const result = calibrateFeedback([
        { profileId: 'full', feedbackKind: FeedbackKind.RESULT_UTILITY, negative: true },
        { profileId: 'full', feedbackKind: FeedbackKind.RESULT_UTILITY, negative: true }], 'full', 2, 10);
      expect(result.qualityWeight).assertEqual(9); expect(result.latencyWeight).assertEqual(5);
      expect(result.speedSamples).assertEqual(0);
    });
    it('anotherProfileCannotSupplyLatencySamples', 0, () => {
      const result = calibrateFeedback([
        { profileId: 'other', feedbackKind: FeedbackKind.RESPONSE_TIME, negative: true },
        { profileId: 'other', feedbackKind: FeedbackKind.RESPONSE_TIME, negative: true }], 'full', 2, 10);
      expect(result.profileSamples).assertEqual(0); expect(result.latencyWeight).assertEqual(5);
    });
    it('windowDropsOldNegativesAndWeightsRecoverToBaseline', 0, () => {
      const result = calibrateFeedback([
        { profileId: 'full', feedbackKind: FeedbackKind.RESPONSE_TIME, negative: true },
        { profileId: 'full', feedbackKind: FeedbackKind.RESPONSE_TIME, negative: false },
        { profileId: 'full', feedbackKind: FeedbackKind.RESPONSE_TIME, negative: false }], 'full', 2, 2);
      expect(result.speedSamples).assertEqual(2); expect(result.latencyWeight).assertEqual(5);
      expect(result.profilePenalty).assertEqual(0);
    });
    it('unansweredTasksDoNotPretendToBePositiveFeedback', 0, () => {
      const result = calibrateFeedback([{ profileId: 'full' },
        { profileId: 'full', feedbackKind: FeedbackKind.RESULT_UTILITY, negative: true }], 'full', 2, 10);
      expect(result.profileSamples).assertEqual(1); expect(result.qualityWeight).assertEqual(3);
    });
    it('mixedDimensionsCannotBypassMinimumSampleCount', 0, () => {
      const result = calibrateFeedback([
        { profileId: 'full', feedbackKind: FeedbackKind.RESPONSE_TIME, negative: true },
        { profileId: 'full', feedbackKind: FeedbackKind.RESULT_UTILITY, negative: true }], 'full', 2, 10);
      expect(result.profileSamples).assertEqual(2); expect(result.profilePenalty).assertEqual(0);
      expect(result.qualityWeight).assertEqual(3); expect(result.latencyWeight).assertEqual(5);
    });
  });
}
