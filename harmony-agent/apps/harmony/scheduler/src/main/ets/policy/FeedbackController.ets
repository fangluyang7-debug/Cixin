import {
  FeedbackKind, FeedbackOption, FeedbackRequest, SchedulerLogEntry, TaskStatus, TaskType,
  UserFeedback, FeedbackAvailability
} from '../api/SchedulerTypes';

interface FeedbackQuota {
  day: number;
  count: number;
  lastAskedAt: number;
  types: string[];
}

interface FeedbackCandidate {
  kind: FeedbackKind;
  reason: string;
  priority: number;
}

export class FeedbackController {
  private enabled: boolean = false;
  private quota: FeedbackQuota = { day: -1, count: 0, lastAskedAt: 0, types: [] };
  private readonly answered: Set<string> = new Set<string>();

  public setEnabled(enabled: boolean): void { this.enabled = enabled; }
  public isEnabled(): boolean { return this.enabled; }

  public inspect(log: SchedulerLogEntry, now: number = Date.now()): FeedbackAvailability {
    if (!this.enabled) { return { eligible: false, reason: 'CONSENT_REQUIRED' }; }
    if (log.status !== TaskStatus.SUCCEEDED) { return { eligible: false, reason: 'TASK_NOT_SUCCESSFUL' }; }
    if (log.taskType === TaskType.FOREGROUND_REALTIME || log.taskType === TaskType.BACKGROUND_BATCH) {
      return { eligible: false, reason: 'TASK_TYPE_EXCLUDED' };
    }
    if (log.telemetry?.userFeedback !== undefined) { return { eligible: false, reason: 'ALREADY_ANSWERED' }; }
    if (log.telemetry?.resultDisplayed !== true) { return { eligible: false, reason: 'RESULT_NOT_DISPLAYED' }; }
    if (log.executionPlan.executionProfile === undefined) { return { eligible: false, reason: 'PROFILE_REQUIRED' }; }
    const existing = log.telemetry.feedbackRequest;
    if (existing !== undefined) { return { eligible: existing.expiresAtMs > now, reason: existing.expiresAtMs > now ? 'READY' : 'INVITATION_EXPIRED' }; }
    if (this.selectQuestion(log) === null) { return { eligible: false, reason: 'NO_QUESTION_NEEDED' }; }
    const day = Math.floor(now / 86400000);
    const sameDay = this.quota.day === day;
    const tomorrow = (day + 1) * 86400000;
    const intervalEnd = this.quota.lastAskedAt + 30 * 60000;
    const nextDay = Math.max(tomorrow, intervalEnd);
    const typeKey = `${log.taskType}:${log.capability.replace(/^client-\d+:/, '')}`;
    if (sameDay && this.quota.count >= 2) { return { eligible: false, reason: 'DAILY_LIMIT', nextAllowedAtMs: nextDay }; }
    if (sameDay && this.quota.types.indexOf(typeKey) >= 0) {
      return { eligible: false, reason: 'CAPABILITY_DAILY_LIMIT', nextAllowedAtMs: nextDay };
    }
    if (now < intervalEnd) { return { eligible: false, reason: 'INTERVAL_LIMIT', nextAllowedAtMs: intervalEnd }; }
    return { eligible: true, reason: 'READY' };
  }

  public request(log: SchedulerLogEntry, now: number = Date.now()): FeedbackRequest | null {
    if (!this.inspect(log, now).eligible) { return null; }
    const existing = log.telemetry!.feedbackRequest;
    if (existing !== undefined) { return existing.expiresAtMs > now ? this.clone(existing) : null; }
    const day: number = Math.floor(now / 86400000);
    if (this.quota.day !== day) { this.quota = { day: day, count: 0, lastAskedAt: this.quota.lastAskedAt, types: [] }; }
    const typeKey: string = `${log.taskType}:${log.capability.replace(/^client-\d+:/, '')}`;
    if (this.quota.count >= 2 || now - this.quota.lastAskedAt < 30 * 60000 || this.quota.types.indexOf(typeKey) >= 0) { return null; }
    // Ask only for the highest-priority experience signal that the runtime cannot infer.
    const candidate = this.selectQuestion(log);
    if (candidate === null) { return null; }
    const request: FeedbackRequest = { taskRunId: log.taskId, kind: candidate.kind, suggestedAfter: 'RESULT_DISPLAYED',
      options: this.optionsFor(candidate.kind), expiresAtMs: now + 120000,
      selectionReason: candidate.reason, priority: candidate.priority };
    this.quota.count++; this.quota.lastAskedAt = now; this.quota.types.push(typeKey);
    log.telemetry!.feedbackRequest = request;
    return this.clone(request);
  }

  public accept(log: SchedulerLogEntry, feedback: UserFeedback, now: number = Date.now()): boolean {
    const request = log.telemetry?.feedbackRequest;
    if (!this.enabled || request === undefined || request.expiresAtMs <= now || this.answered.has(log.taskId) ||
      feedback.taskRunId !== log.taskId || feedback.kind !== request.kind || request.options.indexOf(feedback.option) < 0) { return false; }
    this.answered.add(log.taskId);
    if (this.answered.size > 500) { this.answered.delete(Array.from(this.answered.values())[0]); }
    log.telemetry!.userFeedback = { taskRunId: log.taskId, kind: feedback.kind, option: feedback.option };
    return true;
  }

  public exportState(): string { return JSON.stringify(this.quota); }
  public restoreState(raw: string): boolean {
    try {
      if (raw.length > 4096) { return false; }
      const quota = JSON.parse(raw) as FeedbackQuota;
      if (!Number.isInteger(quota.day) || !Number.isInteger(quota.count) || quota.count < 0 || quota.count > 2 ||
        !Number.isFinite(quota.lastAskedAt) || !Array.isArray(quota.types) || quota.types.length > 2 ||
        quota.types.some((type: string) => typeof type !== 'string' || type.length > 256)) { return false; }
      this.quota = quota; return true;
    } catch (_) { return false; }
  }
  private selectQuestion(log: SchedulerLogEntry): FeedbackCandidate | null {
    const telemetry = log.telemetry!;
    const app = telemetry.appExperience;
    const appSlow = app?.responseReadyMs !== undefined && telemetry.softDeadlineMs !== undefined &&
      app.responseReadyMs > telemetry.softDeadlineMs;
    if (telemetry.softDeadlineMissed === true || appSlow) {
      return { kind: FeedbackKind.RESPONSE_TIME, reason: 'SLOW_RESPONSE_ACCEPTABILITY_UNKNOWN', priority: 80 };
    }
    // Consuming a result suppresses an unnecessary question, but is not a positive training label.
    if (app?.resultQualityUncertain === true && app.resultUseful === undefined && telemetry.resultConsumed !== true) {
      return { kind: FeedbackKind.RESULT_UTILITY, reason: 'APP_REPORTED_QUALITY_UNCERTAINTY', priority: 40 };
    }
    return null;
  }
  private optionsFor(kind: FeedbackKind): FeedbackOption[] {
    if (kind === FeedbackKind.RESPONSE_TIME) {
      return [FeedbackOption.FAST, FeedbackOption.ACCEPTABLE, FeedbackOption.SLOW, FeedbackOption.NO_RESULT];
    }
    return [FeedbackOption.USEFUL, FeedbackOption.INACCURATE, FeedbackOption.IRRELEVANT];
  }
  private clone(request: FeedbackRequest): FeedbackRequest { return JSON.parse(JSON.stringify(request)) as FeedbackRequest; }
}
