import { FeedbackCalibration, FeedbackKind } from '../api/SchedulerTypes';

export interface CalibrationSample {
  profileId: string;
  feedbackKind?: FeedbackKind;
  negative?: boolean;
}

// Keep dimensions separate and bounded. A fast answer never licenses quality loss.
export function calibrateFeedback(samples: CalibrationSample[], profileId: string,
  minimum: number, window: number): FeedbackCalibration {
  const profile = samples.filter((item: CalibrationSample) => item.profileId === profileId && item.negative !== undefined);
  const speed = profile.filter((item: CalibrationSample) => item.feedbackKind === FeedbackKind.RESPONSE_TIME).slice(-window);
  const quality = profile.filter((item: CalibrationSample) => item.feedbackKind === FeedbackKind.RESULT_UTILITY).slice(-window);
  const comfort = profile.filter((item: CalibrationSample) => item.feedbackKind === FeedbackKind.DEVICE_COMFORT).slice(-window);
  const recent = profile.slice(-window);
  return { speedSamples: speed.length, qualitySamples: quality.length, profileSamples: recent.length,
    latencyWeight: 5 + adjustment(speed, minimum, 5), qualityWeight: 3 + adjustment(quality, minimum, 6),
    profilePenalty: Math.max(adjustment(speed, minimum, 3), adjustment(quality, minimum, 3), adjustment(comfort, minimum, 3)) };
}

function adjustment(samples: CalibrationSample[], minimum: number, maximum: number): number {
  if (samples.length < minimum) { return 0; }
  return Math.min(maximum, samples.filter((item: CalibrationSample) => item.negative === true).length / samples.length * maximum);
}
