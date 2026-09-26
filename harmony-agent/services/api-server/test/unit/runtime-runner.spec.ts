import { RuntimeRunnerService } from '../../src/core/runtime/runtime-runner.service';
import { ExecutorRegistryService } from '../../src/core/runtime/executor-registry.service';
import { RuntimeRunService } from '../../src/core/runtime/runtime-run.service';
import { RuntimeEventBusService } from '../../src/core/runtime/runtime-event-bus.service';
import { ExecutionPlan, TaskGraph } from '../../src/core/runtime/runtime.contracts';
import { ResourceAwareSchedulerService } from '../../src/core/runtime/scheduler.service';
import { TelemetryService } from '../../src/core/runtime/telemetry.service';

function fixture(work: (id: string, signal: AbortSignal) => Promise<unknown>, timeout = 1000) {
  const graph: TaskGraph = { graphId: 'g', goal: 'test', nodes: [
    { taskId: 'a', toolId: 'work', inputRef: 'request', constraints: { maxLatencyMs: timeout } },
    { taskId: 'b', toolId: 'work', inputRef: 'task:a', dependencies: ['a'] },
  ] };
  const plan: ExecutionPlan = { graphId: 'g', status: 'ready', executionOrder: ['a', 'b'],
    parallelGroups: [['a'], ['b']], evaluations: {}, missingRequirements: [], generatedAt: new Date().toISOString(),
    assignments: graph.nodes.map(node => ({ taskId: node.taskId, toolId: 'work', executorId: 'worker',
      placement: 'cloud', backend: 'cloud_api', status: 'planned', reasons: [], plannedAt: new Date().toISOString(),
      score: { latencyScore: 0, energyScore: 0, qualityScore: 0, reliabilityScore: 0, totalScore: 0 },
      weights: { latency: 1, energy: 0, quality: 0, reliability: 0 } })) };
  const runs = new RuntimeRunService({} as ResourceAwareSchedulerService, new RuntimeEventBusService());
  const run = runs.createPlanned(graph, plan);
  const registry = new ExecutorRegistryService();
  registry.register({ executorId: 'worker', toolIds: ['work'], execute: ctx => work(ctx.task.taskId, ctx.signal) });
  const telemetry = { record: jest.fn() } as unknown as TelemetryService;
  const runner = new RuntimeRunnerService(runs, registry, telemetry);
  return { runner, run, plan, telemetry };
}

describe('Runtime runner', () => {
  it('executes in dependency order and records real samples', async () => {
    const calls: string[] = [];
    const { runner, run, telemetry } = fixture(async id => { calls.push(id); return id; });
    expect(await runner.execute(run.runId, {})).toBe('b');
    expect(calls).toEqual(['a', 'b']); expect(run.status).toBe('completed');
    expect(run.executionPlan?.assignments.map(item => item.status)).toEqual(['succeeded', 'succeeded']);
    expect(telemetry.record).toHaveBeenCalledTimes(2);
    await expect(runner.execute(run.runId, {})).rejects.toThrow('RUNTIME_ALREADY_EXECUTED');
  });
  it('blocks successors on failure without leaking provider errors', async () => {
    const calls: string[] = [];
    const { runner, run } = fixture(async id => { calls.push(id); throw new Error('secret signed url'); });
    await expect(runner.execute(run.runId, {})).rejects.toThrow();
    expect(calls).toEqual(['a']);
    expect(run.executionPlan?.assignments.map(item => item.status)).toEqual(['failed', 'blocked']);
    expect(JSON.stringify(run)).not.toContain('secret signed url');
  });
  it('aborts timeout and ignores late completion', async () => {
    let resolve!: (value: string) => void; let signal!: AbortSignal;
    const { runner, run } = fixture(async (_, current) => { signal = current; return new Promise(r => { resolve = r; }); }, 5);
    await expect(runner.execute(run.runId, {})).rejects.toThrow();
    expect(signal.aborted).toBe(true); expect(run.status).toBe('timed_out');
    resolve('late'); await Promise.resolve(); expect(run.status).toBe('timed_out');
  });
  it('cancels an active run', async () => {
    const { runner, run } = fixture(async () => new Promise(() => {}));
    const result = runner.execute(run.runId, {});
    expect(runner.cancel(run.runId)).toBe(true); await expect(result).rejects.toThrow();
    expect(run.status).toBe('cancelled');
    expect(run.executionPlan?.assignments.map(item => item.status)).toEqual(['cancelled', 'cancelled']);
  });
  it('validates all dependencies before side effects', async () => {
    const work = jest.fn(); const { runner, run, plan } = fixture(work);
    plan.executionOrder = ['b', 'a'];
    await expect(runner.execute(run.runId, {})).rejects.toThrow(); expect(work).not.toHaveBeenCalled();
  });
  it('does not execute blocked plans', async () => {
    const work = jest.fn(); const { runner, run, plan } = fixture(work);
    run.status = 'blocked'; plan.status = 'blocked';
    await expect(runner.execute(run.runId, {})).rejects.toThrow(); expect(work).not.toHaveBeenCalled();
  });
});
