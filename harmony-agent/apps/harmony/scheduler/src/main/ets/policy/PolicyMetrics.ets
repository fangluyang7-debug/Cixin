import { FeedbackKind, FeedbackOption, PolicyMetricsGroup, SchedulerLogEntry, TaskStatus } from '../api/SchedulerTypes';

export function policyMetrics(logs: SchedulerLogEntry[]): PolicyMetricsGroup[] {
  const groups: Map<string, SchedulerLogEntry[]> = new Map<string, SchedulerLogEntry[]>();
  logs.forEach((log: SchedulerLogEntry) => {
    const audit = log.executionPlan.policyAudit;
    if (audit === undefined || log.finishedAt === null) { return; }
    const key: string = `${audit.version}:${audit.contractId}:${log.taskType}:${audit.stateBucket}:${audit.inputSizeBucket}:${audit.actualProfileId}:${audit.cohort}:${log.telemetry?.mixedExecution === true}`;
    const values = groups.get(key) ?? []; values.push(log); groups.set(key, values);
  });
  return Array.from(groups.values()).map((values: SchedulerLogEntry[]): PolicyMetricsGroup => {
    const first = values[0]; const audit = first.executionPlan.policyAudit!; const n: number = values.length;
    const sorted = values.map((log: SchedulerLogEntry) => log.telemetry?.endToEndDurationMs ?? log.totalDurationMs ?? 0)
      .sort((a: number, b: number) => a - b);
    const mixed: boolean = first.telemetry?.mixedExecution === true;
    return { policyVersion: mixed ? 'MIXED' : audit.version, profileId: mixed ? 'MIXED' : audit.actualProfileId, capability: first.capability,
      mixedExecution: mixed,
      contractId: audit.contractId, inputSizeBucket: audit.inputSizeBucket,
      speedFeedbackCount: values.filter((log: SchedulerLogEntry) => log.telemetry?.userFeedback?.kind === FeedbackKind.RESPONSE_TIME).length,
      qualityFeedbackCount: values.filter((log: SchedulerLogEntry) => log.telemetry?.userFeedback?.kind === FeedbackKind.RESULT_UTILITY).length,
      taskType: first.taskType, stateBucket: mixed ? 'MIXED' : audit.stateBucket, cohort: mixed ? 'MIXED' : audit.cohort, count: n,
      p50Ms: sorted[Math.ceil(n * 0.5) - 1], p95Ms: sorted[Math.ceil(n * 0.95) - 1],
      averageQueueMs: values.reduce((sum: number, log: SchedulerLogEntry) => sum + (log.queueDurationMs ?? 0), 0) / n,
      averageExecutionMs: values.reduce((sum: number, log: SchedulerLogEntry) => sum + (log.executionDurationMs ?? 0), 0) / n,
      successRate: values.filter((log: SchedulerLogEntry) => log.status === TaskStatus.SUCCEEDED).length / n,
      failureRate: values.filter((log: SchedulerLogEntry) => log.status === TaskStatus.FAILED).length / n,
      timeoutRate: values.filter((log: SchedulerLogEntry) => log.status === TaskStatus.TIMED_OUT).length / n,
      cancellationRate: values.filter((log: SchedulerLogEntry) => log.status === TaskStatus.CANCELLED).length / n,
      consumedCount: values.filter((log: SchedulerLogEntry) => log.telemetry?.resultConsumed === true).length,
      feedbackCount: values.filter((log: SchedulerLogEntry) => log.telemetry?.userFeedback !== undefined).length,
      negativeFeedbackCount: values.filter((log: SchedulerLogEntry) => [FeedbackOption.SLOW, FeedbackOption.NO_RESULT,
        FeedbackOption.INACCURATE, FeedbackOption.IRRELEVANT, FeedbackOption.TOO_HOT].indexOf(log.telemetry?.userFeedback?.option!) >= 0).length,
      fallbackCount: values.filter((log: SchedulerLogEntry) => log.executionPlan.policyAudit?.fallbackReason !== undefined).length };
  });
}
