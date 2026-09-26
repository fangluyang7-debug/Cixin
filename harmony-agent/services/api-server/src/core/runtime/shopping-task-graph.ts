import { createId } from '../../common/utils/id';
import { TaskGraph, TaskIntent } from './runtime.contracts';

export function shoppingTask(taskId: string, toolId: string, inputRef: string, dependencies: string[] = []): TaskIntent {
  return { taskId, toolId, inputRef, outputType: 'ShoppingResult', dependencies,
    taskType: 'user_initiated', constraints: { locality: 'cloud_only', privacy: 'internal',
      deadlineMs: 120000, maxLatencyMs: 120000, minimumQuality: 0 },
    fallbackPolicy: { enabled: false, actions: [], maxAttempts: 1, replanAtStageBoundary: false },
    cloudRoutes: [{ executorId: 'zeabur-shopping-workflow', inputResidence: 'zeabur_volume',
      outputDestination: 'zeabur_volume', accessMode: 'co_located', transferAuthorized: true,
      inputBytes: 0, outputBytes: 0, roundTripMs: 0, uploadMbps: 0, downloadMbps: 0,
      storageReadMs: 0, storageWriteMs: 0, queueMs: 0, observedAt: new Date().toISOString(), source: 'in_process' }],
  };
}

// These are atomic business workflow assignments. Internal business steps are not
// presented as separately dispatched tasks until they have independent executors.
export function buildShoppingWorkflowGraph(toolId: string, inputRef: string): TaskGraph {
  const id = createId('task');
  return { graphId: createId('graph'), goal: toolId, planner: 'shopping-runtime',
    createdAt: new Date().toISOString(), nodes: [shoppingTask(id, toolId, inputRef)] };
}

export const buildTextSessionTaskGraph = (inputRef: string) => buildShoppingWorkflowGraph('shopping.text', inputRef);

export const buildCandidateRefreshTaskGraph = (sessionId: string) => buildShoppingWorkflowGraph('shopping.refine', `session:${sessionId}`);

export const buildPriceQueryTaskGraph = (sessionId: string) => buildShoppingWorkflowGraph('shopping.prices', `session:${sessionId}`);
export const buildAnswerTaskGraph = (sessionId: string) => buildShoppingWorkflowGraph('shopping.answer', `session:${sessionId}`);
