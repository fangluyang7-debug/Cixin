import { CancellationController } from '../executor/CancellationController';
import { ExecutionTelemetry } from './RemoteRouteProfile';
import {
  AccuracyPreference, CancellationSignal, DependencyFailurePolicy, DuplicatePolicy, ExecutionPlan,
  DeviceState, ExecutorResult, InferenceLocation, Interruptibility, ModelTier, PrivacyPolicy, TaskCheckpoint,
  TaskContext, TaskHandle, TaskRequest, TaskResult, TaskSignal, TaskSignalType, TaskStatus,
  TaskTemplate, WorkflowHandle, WorkflowInput, WorkflowNode, WorkflowResult, WorkloadExecutor
} from './SchedulerTypes';
import { FeedbackRequest, FeedbackReceipt, UserFeedback, FeedbackAvailability } from './SchedulerTypes';
import { validateManifest } from '../policy/ProfileContract';
import { planWorkflowCosts, WorkflowCostPlan } from '../policy/WorkflowPlanner';
import { SchedulerError, SchedulerErrorCode } from './SchedulerError';

export interface SchedulerRuntime {
  getDeviceState?(): DeviceState;
  registerExecutor<TInput, TOutput>(executor: WorkloadExecutor<TInput, TOutput>): void;
  unregisterExecutor(capability: string): Promise<number>;
  submitTask<TInput, TOutput>(request: TaskRequest<TInput>): Promise<TaskHandle<TOutput>>;
  signalTask(taskId: string, signal: TaskSignal): Promise<void>;
  exportAudit(): string;
  getFeedbackRequest?(taskId: string): FeedbackRequest | null;
  submitFeedback?(feedback: UserFeedback): FeedbackReceipt;
  getFeedbackAvailability?(taskId: string): FeedbackAvailability;
}

interface ActiveWorkflow {
  preparation: CancellationController;
  id: string;
  key: string;
  context: TaskContext;
  submittedAt: number;
  cancelled: boolean;
  finished: boolean;
  reason?: string;
  taskIds: string[];
  outputTaskId: string;
  handle: WorkflowHandle<Object>;
}

class ClientWorkflowHandle<TOutput> implements WorkflowHandle<TOutput> {
  public readonly workflowId: string;
  public readonly result: Promise<WorkflowResult<TOutput>>;
  private readonly cancelCallback: () => Promise<boolean>;
  private readonly signalCallback: (signal: TaskSignal) => Promise<void>;
  constructor(id: string, result: Promise<WorkflowResult<TOutput>>, cancel: () => Promise<boolean>,
    signal: (signal: TaskSignal) => Promise<void>) {
    this.workflowId = id;
    this.result = result;
    this.cancelCallback = cancel;
    this.signalCallback = signal;
  }
  public cancel(): Promise<boolean> { return this.cancelCallback(); }
  public signal(signal: TaskSignal): Promise<void> { return this.signalCallback(signal); }
}

class ScopedExecutor<TInput, TOutput> implements WorkloadExecutor<TInput, TOutput> {
  public readonly capability: string;
  public readonly inferenceLocation: InferenceLocation;
  private readonly delegate: WorkloadExecutor<TInput, TOutput>;

  constructor(scope: string, delegate: WorkloadExecutor<TInput, TOutput>) {
    this.capability = scope + delegate.capability;
    this.inferenceLocation = delegate.inferenceLocation;
    this.delegate = delegate;
  }

  public supports(plan: ExecutionPlan): boolean { return this.delegate.supports(plan); }
  public async warmup(plan: ExecutionPlan): Promise<void> {
    if (this.delegate.warmup !== undefined) { await this.delegate.warmup(plan); }
  }
  public execute(input: TInput, plan: ExecutionPlan, signal: CancellationSignal,
    checkpoint?: TaskCheckpoint, onProgress?: (event: ExecutionTelemetry) => void): Promise<ExecutorResult<TOutput>> {
    return this.delegate.execute(input, plan, signal, checkpoint, onProgress);
  }
  public dispose(): Promise<void> { return this.delegate.dispose(); }
}

// Only contracts and executor ports cross this boundary; business input is never inspected.
export class SchedulerClient {
  private static nextClient: number = 0;
  private readonly scope: string = `client-${SchedulerClient.nextClient++}:`;
  private readonly runtime: SchedulerRuntime;
  private readonly templates: Map<string, TaskTemplate> = new Map<string, TaskTemplate>();
  private readonly workflows: Map<string, ActiveWorkflow> = new Map<string, ActiveWorkflow>();
  private readonly executorCapabilities: string[] = [];
  private readonly preparers: Map<string, WorkloadExecutor<Object, Object>> = new Map<string, WorkloadExecutor<Object, Object>>();
  private nextWorkflow: number = 0;
  private disposed: boolean = false;

  constructor(runtime: SchedulerRuntime) { this.runtime = runtime; }

  public registerTemplate(template: TaskTemplate): void {
    this.assertOpen();
    const snapshot: TaskTemplate = JSON.parse(JSON.stringify(template)) as TaskTemplate;
    this.validateTemplate(snapshot);
    if (this.templates.has(snapshot.capability)) { this.invalid('Template is already registered.'); }
    this.templates.set(snapshot.capability, snapshot);
  }

  public registerExecutor<TInput, TOutput>(executor: WorkloadExecutor<TInput, TOutput>): void {
    this.assertOpen();
    const template: TaskTemplate = this.requireTemplate(executor.capability);
    if (template.workflow !== undefined || template.inferenceLocation !== executor.inferenceLocation) {
      this.invalid('Executor must match a leaf template and its execution location.');
    }
    this.preparers.set(executor.capability, executor as WorkloadExecutor<Object, Object>);
    this.runtime.registerExecutor(new ScopedExecutor<TInput, TOutput>(this.scope, executor));
    if (this.executorCapabilities.indexOf(executor.capability) < 0) {
      this.executorCapabilities.push(executor.capability);
    }
  }

  public submit<TInput, TOutput>(capability: string, input: TInput,
    context: TaskContext): WorkflowHandle<TOutput> {
    this.assertOpen();
    const template: TaskTemplate = this.requireTemplate(capability);
    this.validateContext(context);
    const snapshot: TaskContext = JSON.parse(JSON.stringify(context)) as TaskContext;
    const key: string = `${capability}:${snapshot.deduplicationKey ?? ''}`;
    const previous: ActiveWorkflow[] = Array.from(this.workflows.values()).filter((item: ActiveWorkflow) =>
      item.key === key && !item.finished && !item.cancelled);
    for (let i: number = 0; i < previous.length; i++) {
      const current: ActiveWorkflow = previous[i];
      if (template.duplicatePolicy === DuplicatePolicy.MERGE_EQUIVALENT &&
        snapshot.deduplicationKey !== undefined && this.equivalentContext(current.context, snapshot)) {
        return current.handle as WorkflowHandle<TOutput>;
      }
      if (template.duplicatePolicy === DuplicatePolicy.KEEP_LATEST) {
        this.applySignal(current, { type: TaskSignalType.INPUT_REPLACED });
      }
    }
    const id: string = `${this.scope}workflow-${this.nextWorkflow++}`;
    snapshot.workflowId = id;
    let complete: (result: WorkflowResult<TOutput>) => void = (_result: WorkflowResult<TOutput>): void => {};
    const result: Promise<WorkflowResult<TOutput>> = new Promise<WorkflowResult<TOutput>>((resolve) => { complete = resolve; });
    const handle: WorkflowHandle<TOutput> = new ClientWorkflowHandle<TOutput>(id, result,
      async (): Promise<boolean> => {
        const run: ActiveWorkflow | undefined = this.workflows.get(id);
        if (run === undefined || run.finished || run.cancelled) { return false; }
        await this.applySignal(run, { type: TaskSignalType.CANCEL });
        return true;
      },
      async (signal: TaskSignal): Promise<void> => {
        const run: ActiveWorkflow | undefined = this.workflows.get(id);
        if (run !== undefined) { await this.applySignal(run, signal); }
      }
    );
    const run: ActiveWorkflow = {
      preparation: new CancellationController(), id: id, key: key, context: snapshot, submittedAt: Date.now(), cancelled: false,
      finished: false, taskIds: [], outputTaskId: `${id}:${template.outputNodeId ?? 'task'}`,
      handle: handle as WorkflowHandle<Object>
    };
    this.workflows.set(id, run);
    this.execute<TInput, TOutput>(run, template, input).then((value: WorkflowResult<TOutput>) => {
      run.finished = true;
      complete(value);
      this.trimHistory();
    }).catch(() => {
      run.finished = true;
      complete({ workflowId: id, status: TaskStatus.FAILED, output: null, nodes: [],
        skippedNodeIds: [], reasonCode: SchedulerErrorCode.INTERNAL_ERROR });
      this.trimHistory();
    });
    return handle;
  }

  public exportAudit(): string { return this.runtime.exportAudit(); }

  public getFeedbackRequest(workflowId: string): FeedbackRequest | null {
    const run = this.workflows.get(workflowId);
    if (run === undefined || !run.finished || run.cancelled || this.runtime.getFeedbackRequest === undefined) { return null; }
    return this.runtime.getFeedbackRequest(run.outputTaskId);
  }

  public submitFeedback(workflowId: string, feedback: UserFeedback): FeedbackReceipt {
    this.assertOpen();
    const run = this.workflows.get(workflowId);
    if (run === undefined || !run.finished || run.cancelled || run.outputTaskId !== feedback.taskRunId ||
      this.runtime.submitFeedback === undefined) {
      return { accepted: false, taskRunId: feedback.taskRunId, effect: 'REJECTED', reason: 'WORKFLOW_NOT_ELIGIBLE' };
    }
    return this.runtime.submitFeedback(feedback);
  }

  public getFeedbackAvailability(workflowId: string): FeedbackAvailability {
    this.assertOpen();
    const run = this.workflows.get(workflowId);
    if (run === undefined || !run.finished || run.cancelled) { return { eligible: false, reason: 'WORKFLOW_NOT_READY' }; }
    if (this.runtime.getFeedbackAvailability === undefined) { return { eligible: false, reason: 'RUNTIME_UNSUPPORTED' }; }
    return this.runtime.getFeedbackAvailability(run.outputTaskId);
  }

  public async dispose(): Promise<void> {
    if (this.disposed) { return; }
    this.disposed = true;
    const runs: ActiveWorkflow[] = Array.from(this.workflows.values());
    for (let i: number = 0; i < runs.length; i++) {
      if (!runs[i].finished) { await this.applySignal(runs[i], { type: TaskSignalType.CANCEL }); }
      await runs[i].handle.result;
    }
    for (let i: number = 0; i < this.executorCapabilities.length; i++) {
      await this.runtime.unregisterExecutor(this.scope + this.executorCapabilities[i]);
    }
    this.workflows.clear();
    this.templates.clear();
  }

  private async execute<TInput, TOutput>(run: ActiveWorkflow, template: TaskTemplate,
    input: TInput): Promise<WorkflowResult<TOutput>> {
    const nodes: WorkflowNode[] = template.workflow ?? [{ id: 'task', templateId: template.capability,
      dependsOn: [], failurePolicy: DependencyFailurePolicy.CANCEL_WORKFLOW }];
    const ordered: WorkflowNode[] = this.orderNodes(nodes);
    const estimatedMs: Record<string, number> = {};
    ordered.forEach((node: WorkflowNode) => {
      const leaf: TaskTemplate = this.requireTemplate(node.templateId);
      const defaultProfile = leaf.manifest?.profiles.find((item) => item.id === leaf.manifest!.defaultProfileId);
      const level = leaf.qualityLevels.find((item) => item.id === defaultProfile?.qualityLevelId) ??
        leaf.qualityLevels.find((item) => item.modelTier ===
          (run.context.highQuality ? ModelTier.HIGH_ACCURACY : run.context.accuracyFloor)) ?? leaf.qualityLevels[0];
      estimatedMs[node.id] = level.estimatedLatencyMs;
    });
    const workflowCosts: WorkflowCostPlan[] = planWorkflowCosts(ordered, estimatedMs);
    const results: TaskResult<Object>[] = [];
    const outputs: Record<string, Object> = {};
    const skipped: string[] = [];
    const successful: string[] = [];
    let failure: string | undefined = undefined;
    for (let i: number = 0; i < ordered.length; i++) {
      const node: WorkflowNode = ordered[i];
      const elapsed: number = Date.now() - run.submittedAt;
      if (run.context.requestReplaced || elapsed >= (run.context.freshnessMs ?? Infinity) ||
        elapsed >= (run.context.deadlineMs ?? Infinity)) {
        run.cancelled = true;
        run.reason = run.context.requestReplaced ? 'INPUT_REPLACED' :
          elapsed >= (run.context.freshnessMs ?? Infinity) ? 'RESULT_EXPIRED' : 'DEADLINE_EXCEEDED';
      }
      if (run.cancelled || failure !== undefined ||
        node.dependsOn.some((dependency: string) => successful.indexOf(dependency) < 0)) {
        skipped.push(node.id);
        continue;
      }
      const leaf: TaskTemplate = JSON.parse(JSON.stringify(this.requireTemplate(node.templateId))) as TaskTemplate;
      if (template.privacyPolicy === PrivacyPolicy.LOCAL_ONLY) { leaf.privacyPolicy = PrivacyPolicy.LOCAL_ONLY; }
      if (template.privacyPolicy === PrivacyPolicy.SANITIZED_REMOTE && leaf.privacyPolicy === PrivacyPolicy.REMOTE_ALLOWED) {
        leaf.privacyPolicy = PrivacyPolicy.SANITIZED_REMOTE;
      }
      const nodeContext: TaskContext = JSON.parse(JSON.stringify(run.context)) as TaskContext;
      const remaining = workflowCosts.find((item: WorkflowCostPlan) => item.nodeId === node.id);
      nodeContext.workflowCriticalPathMs = remaining?.criticalPathMs;
      nodeContext.workflowRemainingSerialMs = remaining?.serialRemainingMs;
      nodeContext.workflowCurrentNodeEstimateMs = estimatedMs[node.id];
      nodeContext.parentTaskId = run.id;
      nodeContext.dependencyTaskIds = node.dependsOn.map((dependency: string) => `${run.id}:${dependency}`);
      const taskId: string = `${run.id}:${node.id}`;
      const dependencyOutputs: Record<string, Object> = {};
      node.dependsOn.forEach((dependency: string) => { dependencyOutputs[dependency] = outputs[dependency]; });
      const workflowInput: WorkflowInput<TInput> = { input: input, outputs: dependencyOutputs };
      const request: TaskRequest<Object> = {
        taskId: taskId, capability: this.scope + leaf.capability, taskType: leaf.taskType,
        inferenceLocation: leaf.inferenceLocation,
        input: template.workflow === undefined ? input as Object : workflowInput,
        accuracyPreference: nodeContext.highQuality ? AccuracyPreference.QUALITY_FIRST : AccuracyPreference.BALANCED,
        latencyBudgetMs: nodeContext.deadlineMs, allowDegrade: !nodeContext.highQuality,
        allowPause: leaf.interruptibility === Interruptibility.CHECKPOINT,
        timeoutMs: leaf.timeoutMs, template: leaf, context: nodeContext, submittedAt: run.submittedAt,
        remoteOptions: leaf.remoteOptions
      };
      try {
        const preparer = this.preparers.get(leaf.capability);
        if (preparer?.prepare !== undefined) {
          await preparer.prepare(request.input, nodeContext, run.preparation.signal);
          if (run.cancelled) { skipped.push(node.id); continue; }
        }
        run.taskIds.push(taskId);
        const handle: TaskHandle<Object> = await this.runtime.submitTask<Object, Object>(request);
        if (run.cancelled) { await this.runtime.signalTask(taskId, { type: TaskSignalType.CANCEL }); }
        const result: TaskResult<Object> = await handle.result;
        results.push(result);
        if (result.status === TaskStatus.SUCCEEDED && result.output !== null) {
          outputs[node.id] = result.output;
          successful.push(node.id);
        } else if (node.failurePolicy === DependencyFailurePolicy.CANCEL_WORKFLOW) {
          failure = result.errorCode ?? 'DEPENDENCY_FAILED';
        }
      } catch (error) {
        if (node.failurePolicy === DependencyFailurePolicy.CANCEL_WORKFLOW) {
          failure = error instanceof SchedulerError ? error.code :
            error instanceof Error && /^[A-Z][A-Z0-9_]{1,100}$/.test(error.message) ? error.message : SchedulerErrorCode.INTERNAL_ERROR;
        }
        skipped.push(node.id);
      }
    }
    const outputNode: string = template.outputNodeId ?? 'task';
    const stale: boolean = Date.now() - run.submittedAt >= (run.context.freshnessMs ?? Infinity) ||
      Date.now() - run.submittedAt >= (run.context.deadlineMs ?? Infinity);
    const status: TaskStatus = run.cancelled || stale ? TaskStatus.CANCELLED :
      failure !== undefined || successful.indexOf(outputNode) < 0 ? TaskStatus.FAILED : TaskStatus.SUCCEEDED;
    return {
      workflowId: run.id, status: status,
      output: status === TaskStatus.SUCCEEDED ? outputs[outputNode] as TOutput : null,
      nodes: results, skippedNodeIds: skipped,
      reasonCode: run.reason ?? (stale ? 'RESULT_EXPIRED' : failure)
    };
  }

  private async applySignal(run: ActiveWorkflow, signal: TaskSignal): Promise<void> {
    if (signal.type === TaskSignalType.USER_FEEDBACK) {
      if (signal.feedback?.taskRunId === run.outputTaskId) {
        await this.runtime.signalTask(run.outputTaskId, signal);
      }
      return;
    }
    if (signal.type === TaskSignalType.CANCEL || signal.type === TaskSignalType.PAGE_LEFT ||
      signal.type === TaskSignalType.INPUT_REPLACED) {
      run.cancelled = true;
      run.preparation.cancel();
      run.reason = signal.type;
    }
    if (signal.type === TaskSignalType.WAITING_CHANGED) { run.context.userWaiting = signal.value === true; }
    if (signal.type === TaskSignalType.QUALITY_REQUIRED) { run.context.highQuality = signal.value !== false; }
    for (let i: number = 0; i < run.taskIds.length; i++) {
      if (signal.type === TaskSignalType.RESULT_DISPLAYED && run.taskIds[i] !== run.outputTaskId) { continue; }
      await this.runtime.signalTask(run.taskIds[i], signal);
    }
  }

  private orderNodes(nodes: WorkflowNode[]): WorkflowNode[] {
    const ordered: WorkflowNode[] = [];
    const visited: string[] = [];
    while (ordered.length < nodes.length) {
      const next: WorkflowNode | undefined = nodes.find((node: WorkflowNode) => visited.indexOf(node.id) < 0 &&
        node.dependsOn.every((dependency: string) => visited.indexOf(dependency) >= 0));
      if (next === undefined) { this.invalid('Workflow contains a cycle or missing dependency.'); }
      ordered.push(next!);
      visited.push(next!.id);
    }
    return ordered;
  }

  private validateTemplate(template: TaskTemplate): void {
    if (template.concurrentSafe !== undefined && typeof template.concurrentSafe !== 'boolean') {
      this.invalid('Concurrent safety declaration must be a boolean.');
    }
    if (template.capability.trim().length === 0 || template.resourceHints.modelVersion.trim().length === 0 ||
      template.qualityLevels.length === 0) { this.invalid('Template requires capability, model version and quality levels.'); }
    this.positive(template.timeoutMs, 'timeoutMs');
    if ([PrivacyPolicy.LOCAL_ONLY, PrivacyPolicy.SANITIZED_REMOTE, PrivacyPolicy.REMOTE_ALLOWED].indexOf(template.privacyPolicy) < 0 ||
      [Interruptibility.NON_INTERRUPTIBLE, Interruptibility.CANCEL_RESTART, Interruptibility.CHECKPOINT].indexOf(template.interruptibility) < 0 ||
      [DuplicatePolicy.KEEP_ALL, DuplicatePolicy.KEEP_LATEST, DuplicatePolicy.MERGE_EQUIVALENT].indexOf(template.duplicatePolicy) < 0) {
      this.invalid('Unknown privacy, interruption or duplicate policy.');
    }
    const ids: string[] = [];
    template.qualityLevels.forEach((level) => {
      if (level.id.length === 0 || ids.indexOf(level.id) >= 0 || level.supportedBackends.length === 0 ||
        level.supportedThreadCounts.length === 0 || level.supportedThreadCounts.some((count) => [1, 2, 4].indexOf(count) < 0)) {
        this.invalid('Quality levels require unique IDs and supported execution settings.');
      }
      ids.push(level.id);
      if ([ModelTier.HIGH_ACCURACY, ModelTier.BALANCED, ModelTier.LIGHTWEIGHT].indexOf(level.modelTier) < 0) {
        this.invalid('Unknown quality tier.');
      }
      this.positive(level.estimatedLatencyMs, 'estimatedLatencyMs');
      this.positive(level.estimatedMemoryMb, 'estimatedMemoryMb');
      this.positive(level.relativeEnergyCost, 'relativeEnergyCost');
    });
    this.positive(template.resourceHints.baselineInputTokens, 'baselineInputTokens');
    this.positive(template.resourceHints.baselineCandidateCount, 'baselineCandidateCount');
    this.positive(template.resourceHints.baselineInputElements, 'baselineInputElements');
    this.positive(template.resourceHints.expectedMemoryMb, 'expectedMemoryMb');
    this.positive(template.resourceHints.modelSizeMb, 'modelSizeMb');
    if (template.inferenceLocation === InferenceLocation.REMOTE_CLOUD &&
      (template.remoteOptions === undefined || template.remoteOptions.provider.length === 0)) {
      this.invalid('Remote template requires an explicit provider.');
    }
    if (template.remoteOptions !== undefined && (!Number.isInteger(template.remoteOptions.maxRetries) ||
      template.remoteOptions.maxRetries < 0 || template.remoteOptions.maxRetries > 3 ||
      !Number.isInteger(template.remoteOptions.maxConcurrency) || template.remoteOptions.maxConcurrency < 1)) {
      this.invalid('Invalid remote retries or concurrency.');
    }
    if (template.workflow !== undefined) {
      const nodeIds: string[] = [];
      if (template.workflow.length === 0) { this.invalid('Workflow must have nodes.'); }
      template.workflow.forEach((node: WorkflowNode) => {
        if (node.id.length === 0 || nodeIds.indexOf(node.id) >= 0) { this.invalid('Workflow node IDs must be unique.'); }
        nodeIds.push(node.id);
        if ([DependencyFailurePolicy.CANCEL_WORKFLOW, DependencyFailurePolicy.SKIP_DEPENDENTS].indexOf(node.failurePolicy) < 0) {
          this.invalid('Unknown dependency failure policy.');
        }
        if (this.requireTemplate(node.templateId).workflow !== undefined) { this.invalid('Nested workflows are not supported.'); }
      });
      if (nodeIds.indexOf(template.outputNodeId ?? '') < 0) { this.invalid('Workflow needs a valid outputNodeId.'); }
      this.orderNodes(template.workflow);
    }
    validateManifest(template);
  }

  private validateContext(context: TaskContext): void {
    if (typeof context.userVisible !== 'boolean' || typeof context.userWaiting !== 'boolean') {
      this.invalid('Visibility and waiting state must be explicit booleans.');
    }
    this.positive(context.deadlineMs, 'deadlineMs');
    this.positive(context.targetLatencyMs, 'targetLatencyMs');
    this.positive(context.softDeadlineMs, 'softDeadlineMs');
    if ((context.targetLatencyMs ?? 0) > (context.softDeadlineMs ?? context.deadlineMs ?? Infinity) ||
      (context.softDeadlineMs ?? 0) > (context.deadlineMs ?? Infinity)) {
      this.invalid('Experience targets must not exceed the hard deadline.');
    }
    this.positive(context.freshnessMs, 'freshnessMs');
    this.positive(context.inputTokens, 'inputTokens');
    this.positive(context.candidateCount, 'candidateCount');
    this.positive(context.batchSize, 'batchSize');
    (context.inputShape ?? []).forEach((dimension: number) => this.positive(dimension, 'inputShape'));
    if ((context.inputShape ?? []).some((dimension: number) => !Number.isInteger(dimension)) ||
      !Number.isSafeInteger((context.inputShape ?? [1]).reduce((a: number, b: number) => a * b, 1))) {
      this.invalid('Input dimensions must be integers with a safe element count.');
    }
    if ([ModelTier.HIGH_ACCURACY, ModelTier.BALANCED, ModelTier.LIGHTWEIGHT].indexOf(context.accuracyFloor) < 0 ||
      (context.businessImportance !== undefined && (!Number.isFinite(context.businessImportance) ||
        context.businessImportance < 0 || context.businessImportance > 1))) { this.invalid('Invalid quality floor or importance.'); }
  }

  private equivalentContext(left: TaskContext, right: TaskContext): boolean {
    return left.deadlineMs === right.deadlineMs && left.freshnessMs === right.freshnessMs &&
      left.targetLatencyMs === right.targetLatencyMs && left.softDeadlineMs === right.softDeadlineMs &&
      left.userVisible === right.userVisible && left.userWaiting === right.userWaiting &&
      left.accuracyFloor === right.accuracyFloor && left.highQuality === right.highQuality &&
      left.businessImportance === right.businessImportance && left.inputTokens === right.inputTokens &&
      left.candidateCount === right.candidateCount && left.batchSize === right.batchSize &&
      left.networkAllowed === right.networkAllowed && left.inputSanitized === right.inputSanitized &&
      left.requestReplaced === right.requestReplaced && left.parentTaskId === right.parentTaskId &&
      JSON.stringify(left.inputShape) === JSON.stringify(right.inputShape) &&
      JSON.stringify(left.dependencyTaskIds) === JSON.stringify(right.dependencyTaskIds);
  }

  private positive(value: number | undefined, field: string): void {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0 || value > 2147483647)) {
      this.invalid(`${field} must be finite, positive and fit a timer.`);
    }
  }
  private requireTemplate(capability: string): TaskTemplate {
    const template: TaskTemplate | undefined = this.templates.get(capability);
    if (template === undefined) { this.invalid(`Unknown template: ${capability}`); }
    return template!;
  }
  private invalid(message: string): never { throw new SchedulerError(SchedulerErrorCode.INVALID_TASK, message); }
  private assertOpen(): void { if (this.disposed) { this.invalid('Client has been disposed.'); } }
  private trimHistory(): void {
    const finished: ActiveWorkflow[] = Array.from(this.workflows.values()).filter((run: ActiveWorkflow) => run.finished);
    for (let i: number = 0; i < finished.length - 100; i++) { this.workflows.delete(finished[i].id); }
  }
}
