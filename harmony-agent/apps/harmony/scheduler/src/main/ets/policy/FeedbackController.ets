import {
  FeedbackKind, FeedbackOption, FeedbackRequest, SchedulerLogEntry, TaskStatus, TaskType, UserFeedback
} from '../api/SchedulerTypes';

interface FeedbackQuota {
  day: number;
  count: number;
  lastAskedAt: number;
  types: string[];
}

export class FeedbackController {
  private enabled: boolean = false;
  private quota: FeedbackQuota = { day: -1, count: 0, lastAskedAt: 0, types: [] };
  private readonly answered: Set<string> = new Set<string>();

  public setEnabled(enabled: boolean): void { this.enabled = enabled; }
  public isEnabled(): boolean { return this.enabled; }

  public request(log: SchedulerLogEntry, now: number = Date.now()): FeedbackRequest | null {
    if (!this.enabled || log.status !== TaskStatus.SUCCEEDED || log.taskType === TaskType.FOREGROUND_REALTIME ||
      log.taskType === TaskType.BACKGROUND_BATCH || log.telemetry?.resultDisplayed !== true ||
      log.telemetry.userFeedback !== undefined || log.executionPlan.executionProfile === undefined) { return null; }
    const existing = log.telemetry.feedbackRequest;
    if (existing !== undefined) { return existing.expiresAtMs > now ? this.clone(existing) : null; }
    const day: number = Math.floor(now / 86400000);
    if (this.quota.day !== day) { this.quota = { day: day, count: 0, lastAskedAt: this.quota.lastAskedAt, types: [] }; }
    const typeKey: string = `${log.taskType}:${log.capability.replace(/^client-\d+:/, '')}`;
    if (this.quota.count >= 2 || now - this.quota.lastAskedAt < 30 * 60000 || this.quota.types.indexOf(typeKey) >= 0) { return null; }
    // Alternate dimensions; one answer never represents every aspect of experience.
    const kind: FeedbackKind = day % 2 === 0 || log.telemetry.softDeadlineMissed === true ?
      FeedbackKind.RESPONSE_TIME : FeedbackKind.RESULT_UTILITY;
    const request: FeedbackRequest = { taskRunId: log.taskId, kind: kind, suggestedAfter: 'RESULT_DISPLAYED',
      options: kind === FeedbackKind.RESPONSE_TIME ?
        [FeedbackOption.FAST, FeedbackOption.ACCEPTABLE, FeedbackOption.SLOW, FeedbackOption.NO_RESULT] :
        [FeedbackOption.USEFUL, FeedbackOption.INACCURATE, FeedbackOption.IRRELEVANT], expiresAtMs: now + 120000 };
    this.quota.count++; this.quota.lastAskedAt = now; this.quota.types.push(typeKey);
    log.telemetry.feedbackRequest = request;
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
  private clone(request: FeedbackRequest): FeedbackRequest { return JSON.parse(JSON.stringify(request)) as FeedbackRequest; }
}
