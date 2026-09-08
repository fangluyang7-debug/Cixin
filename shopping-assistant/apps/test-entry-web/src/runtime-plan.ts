export const RUNTIME_ACTIVE_RUN_KEY = 'runtime-active-run-id';
export const RUNTIME_MONITOR_WINDOW_NAME = 'runtime-monitor';

export const IMAGE_SEARCH_PLAN_GRAPH = {
  graphId: 'image-search-demo',
  goal: '使用上传图片检索商品',
  planner: 'shopping-debug-entry',
  nodes: [
    {
      taskId: 'quality-check',
      toolId: 'image.quality_check',
      inputRef: 'uploaded-image',
      fallbackPolicy: {
        enabled: true,
        actions: ['请求用户重新上传图片'],
        maxAttempts: 2,
        replanAtStageBoundary: true,
      },
    },
    {
      taskId: 'crop',
      toolId: 'image.crop',
      inputRef: 'uploaded-image',
      dependencies: ['quality-check'],
      fallbackPolicy: {
        enabled: true,
        actions: ['使用原图继续处理'],
        maxAttempts: 2,
        replanAtStageBoundary: true,
      },
    },
    {
      taskId: 'embedding',
      toolId: 'image.embedding',
      inputRef: 'task:crop',
      dependencies: ['crop'],
      fallbackPolicy: {
        enabled: true,
        actions: ['降低输入分辨率'],
        maxAttempts: 2,
        replanAtStageBoundary: true,
      },
    },
    {
      taskId: 'vector-search',
      toolId: 'catalog.vector_search',
      inputRef: 'task:embedding',
      dependencies: ['embedding'],
      fallbackPolicy: {
        enabled: true,
        actions: ['切换到结构化标签召回'],
        maxAttempts: 2,
        replanAtStageBoundary: true,
      },
    },
  ],
};

export function rememberRuntimeRunId(runId: string | null | undefined) {
  if (!runId) return;
  localStorage.setItem(RUNTIME_ACTIVE_RUN_KEY, runId);
}

export function readRuntimeRunId() {
  return localStorage.getItem(RUNTIME_ACTIVE_RUN_KEY);
}

export function openRuntimeMonitorWindow() {
  const url = new URL('/runtime.html', window.location.origin);
  url.searchParams.set('window', '1');
  const features = 'popup=yes,width=1320,height=860,left=72,top=48,resizable=yes,scrollbars=yes';
  const popup = window.open(url.toString(), RUNTIME_MONITOR_WINDOW_NAME, features);
  popup?.focus();
  return popup;
}
