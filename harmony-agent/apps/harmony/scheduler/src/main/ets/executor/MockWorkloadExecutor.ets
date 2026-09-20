import {
  CancellationSignal,
  ExecutionPlan,
  ExecutorResult,
  InferenceLocation,
  LocalExecutionPlan,
  ModelTier,
  WorkloadExecutor,
  ThreadCount,
  Unsubscribe
} from '../api/SchedulerTypes';
import { SchedulerError, SchedulerErrorCode } from '../api/SchedulerError';

export interface MockWorkloadInput {
  durationMs: number;
  value: string;
  shouldFail?: boolean;
}

export interface MockWorkloadOutput {
  value: string;
  modelTier: ModelTier;
  threadCount: ThreadCount;
}

export class MockWorkloadExecutor implements WorkloadExecutor<MockWorkloadInput, MockWorkloadOutput> {
  public readonly capability: string;
  public readonly inferenceLocation: InferenceLocation = InferenceLocation.LOCAL_DEVICE;

  constructor(capability: string = 'mock_workload') {
    this.capability = capability;
  }

  public supports(plan: ExecutionPlan): boolean {
    // This executor remains backend-agnostic, but it must never accept a
    // remote plan because its output exposes local model/thread metadata.
    return plan.inferenceLocation === InferenceLocation.LOCAL_DEVICE;
  }

  public async execute(
    input: MockWorkloadInput,
    plan: ExecutionPlan,
    signal: CancellationSignal
  ): Promise<ExecutorResult<MockWorkloadOutput>> {
    if (!Number.isFinite(input.durationMs) || input.durationMs < 0) {
      throw new SchedulerError(SchedulerErrorCode.INVALID_TASK, 'Mock durationMs must be non-negative.');
    }
    if (signal.isCancellationRequested) {
      throw new SchedulerError(SchedulerErrorCode.TASK_CANCELLED, 'Mock workload was cancelled before execution.');
    }

    const localPlan: LocalExecutionPlan = plan as LocalExecutionPlan;
    return new Promise<ExecutorResult<MockWorkloadOutput>>((resolve, reject) => {
      let settled: boolean = false;
      const timerId: number = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        unsubscribe();
        if (input.shouldFail === true) {
          reject(new SchedulerError(SchedulerErrorCode.INTERNAL_ERROR, 'Mock workload failed by request.'));
          return;
        }
        resolve({
          output: {
            value: input.value,
            modelTier: localPlan.modelTier,
            threadCount: localPlan.threadCount
          }
        });
      }, input.durationMs);

      const unsubscribe: Unsubscribe = signal.onCancelled((): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timerId);
        reject(new SchedulerError(SchedulerErrorCode.TASK_CANCELLED, 'Mock workload was cancelled.'));
      });
    });
  }

  public async dispose(): Promise<void> {
  }
}
