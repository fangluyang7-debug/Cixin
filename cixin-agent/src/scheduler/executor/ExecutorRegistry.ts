import { ExecutionPlan, WorkloadExecutor } from '../api/SchedulerTypes';

export class ExecutorRegistry {
  private executors: WorkloadExecutor<Object, Object>[] = [];

  public register<TInput, TOutput>(executor: WorkloadExecutor<TInput, TOutput>): void {
    this.executors.push(executor as WorkloadExecutor<Object, Object>);
  }

  public find<TInput, TOutput>(capability: string, plan: ExecutionPlan): WorkloadExecutor<TInput, TOutput> | null {
    for (let index: number = this.executors.length - 1; index >= 0; index--) {
      const executor: WorkloadExecutor<Object, Object> = this.executors[index];
      if (executor.capability === capability &&
        executor.inferenceLocation === plan.inferenceLocation &&
        executor.supports(plan)) {
        return executor as WorkloadExecutor<TInput, TOutput>;
      }
    }
    return null;
  }

  public async unregisterInstance<TInput, TOutput>(executor: WorkloadExecutor<TInput, TOutput>): Promise<boolean> {
    const target: WorkloadExecutor<Object, Object> = executor as WorkloadExecutor<Object, Object>;
    const index: number = this.executors.indexOf(target);
    if (index < 0) {
      return false;
    }
    this.executors.splice(index, 1);
    await target.dispose();
    return true;
  }

  public async unregister(capability: string): Promise<number> {
    const retained: WorkloadExecutor<Object, Object>[] = [];
    const removed: WorkloadExecutor<Object, Object>[] = [];
    this.executors.forEach((executor: WorkloadExecutor<Object, Object>) => {
      if (executor.capability === capability) {
        removed.push(executor);
      } else {
        retained.push(executor);
      }
    });
    this.executors = retained;
    for (let index: number = 0; index < removed.length; index++) {
      await removed[index].dispose();
    }
    return removed.length;
  }

  public async disposeAll(): Promise<void> {
    const executors: WorkloadExecutor<Object, Object>[] = this.executors.slice();
    this.executors = [];
    for (let index: number = 0; index < executors.length; index++) {
      await executors[index].dispose();
    }
  }

  public getSize(): number {
    return this.executors.length;
  }
}
