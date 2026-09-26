import { Injectable } from '@nestjs/common';
import { ExecutionAssignment, TaskIntent } from './runtime.contracts';

export interface RuntimeExecutionContext {
  runId: string;
  task: TaskIntent;
  assignment: ExecutionAssignment;
  input: unknown;
  outputs: ReadonlyMap<string, unknown>;
  signal: AbortSignal;
}

export interface RuntimeExecutor {
  executorId: string;
  toolIds: string[];
  // Settlement acknowledges local execution has ended. Await child work or register
  // it with RuntimeWorkScope.track; never detach untracked side effects.
  execute(context: RuntimeExecutionContext): Promise<unknown>;
}

@Injectable()
export class ExecutorRegistryService {
  private readonly executors = new Map<string, RuntimeExecutor>();

  register(executor: RuntimeExecutor) {
    for (const toolId of executor.toolIds) {
      const key = `${executor.executorId}:${toolId}`;
      if (this.executors.has(key)) throw new Error('RUNTIME_EXECUTOR_ALREADY_REGISTERED');
      this.executors.set(key, executor);
    }
  }

  require(executorId: string, toolId: string) {
    const executor = this.executors.get(`${executorId}:${toolId}`);
    if (!executor) throw new Error('RUNTIME_EXECUTOR_NOT_REGISTERED');
    return executor;
  }
}
