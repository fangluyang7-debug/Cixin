import { TaskContext, WorkflowNode } from '../api/SchedulerTypes';

export interface WorkflowCostPlan {
  nodeId: string;
  criticalPathMs: number;
  serialRemainingMs: number;
}

// ordered must be topological. The current client runs nodes serially, so serialRemainingMs
// is the safe scheduling estimate; criticalPathMs is retained for later parallel DAG execution.
export function planWorkflowCosts(ordered: WorkflowNode[], estimatedMs: Record<string, number>): WorkflowCostPlan[] {
  const plans: WorkflowCostPlan[] = [];
  let serial: number = 0;
  for (let i: number = ordered.length - 1; i >= 0; i--) {
    const node: WorkflowNode = ordered[i];
    const cost: number = Math.max(1, estimatedMs[node.id] ?? 1);
    const children: WorkflowNode[] = ordered.filter((item: WorkflowNode) => item.dependsOn.indexOf(node.id) >= 0);
    let downstream: number = 0;
    children.forEach((child: WorkflowNode) => {
      const childPlan = plans.find((item: WorkflowCostPlan) => item.nodeId === child.id);
      downstream = Math.max(downstream, childPlan?.criticalPathMs ?? 0);
    });
    serial += cost;
    plans.push({ nodeId: node.id, criticalPathMs: cost + downstream, serialRemainingMs: serial });
  }
  return plans.reverse();
}

export function workflowUrgencyBonus(deadlineMs: number | undefined, elapsedMs: number,
  predictedNodeMs: number, remainingMs: number | undefined): number {
  if (deadlineMs === undefined || !Number.isFinite(deadlineMs)) { return 0; }
  const remainingBudget: number = Math.max(1, deadlineMs - elapsedMs);
  const needed: number = Math.max(1, predictedNodeMs, remainingMs ?? 0);
  return Math.min(20, needed / remainingBudget * 20);
}

export function estimatedWorkflowCompletion(context: TaskContext, predictedNodeMs: number): number {
  if (context.workflowRemainingSerialMs === undefined || context.workflowCurrentNodeEstimateMs === undefined) {
    return predictedNodeMs;
  }
  return predictedNodeMs + Math.max(0, context.workflowRemainingSerialMs - context.workflowCurrentNodeEstimateMs);
}
