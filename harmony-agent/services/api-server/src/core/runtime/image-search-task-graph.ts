import { shoppingTask } from './shopping-task-graph';
import { TaskGraph } from './runtime.contracts';

export const IMAGE_SEARCH_STAGES = ['receive', 'asset', 'quality-check', 'crop', 'category',
  'product-profile', 'embedding', 'vector-search', 'price-stock', 'rank', 'answer', 'result'] as const;
export const IMAGE_STAGE_TOOLS = IMAGE_SEARCH_STAGES.map(stage => `shopping.stage.${stage}`);

export function buildImageSearchTaskGraph(assetId: string): TaskGraph {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(assetId)) throw new Error('INVALID_ASSET_REFERENCE');
  return { graphId: `image-search-${assetId}`, goal: '云端图片商品检索', planner: 'shopping-runtime',
    createdAt: new Date().toISOString(), nodes: IMAGE_SEARCH_STAGES.map((stage, index) => ({
      ...shoppingTask(stage, `shopping.stage.${stage}`, index === 0 ? `asset:${assetId}` : `task:${IMAGE_SEARCH_STAGES[index - 1]}`,
        index === 0 ? [] : [IMAGE_SEARCH_STAGES[index - 1]]),
      outputType: stage === 'result' ? 'ShoppingResult' : `ShoppingStage:${stage}`,
      constraints: { locality: 'cloud_only', privacy: 'internal', maxLatencyMs: 60000, deadlineMs: 150000, minimumQuality: 0 },
    })) };
}

export const buildImageSessionTaskGraph = buildImageSearchTaskGraph;
