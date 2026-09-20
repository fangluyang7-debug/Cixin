import { Backend, InferenceLocation, LocalExecutionPlan, ModelTier, ThreadCount } from 'scheduler';
import { Product } from '../models/Product';
import { EmbeddingModelInfo, EmbeddingSearchResult } from '../models/EmbeddingModel';
import { NeuralEmbeddingIndex } from './NeuralEmbeddingIndex';
import hilog from '@ohos.hilog';

export interface AiInferenceResult {
  topProducts: Product[];
  vectorDimension: number;
  inferenceDurationMs: number;
  accuracyScore: number;
  modelName: string;
  sourceInfo: string;
  passCount: number;
  recommendDegrade: boolean;
  activeThreads: number;
  activeBackend: Backend;
}

export interface ChatIntentResult {
  intent: string;
  extractedBrand: string;
  extractedCategory: string;
  maxBudget: number | null;
  extractedKeywords: string[];
  generatedAnswer: string;
  confidenceScore: number;
  modelName: string;
  actualInferenceLocation: InferenceLocation;
  fallbackReason: string;
  inferenceDurationMs: number;
  topProducts: Product[];
}

export interface ScoredCandidate {
  product: Product;
  score: number;
}

/**
 * Local text intent parsing and product Embedding retrieval.
 *
 * This implementation does not claim to run an LLM. Intent fields are parsed
 * with deterministic rules, while retrieval uses a real MindSpore Lite neural encoder and
 * real TaskPool CPU partitions over all 2700 product vectors.
 */
export class LocalAiModelEngine {
  private static instance: LocalAiModelEngine | null = null;

  private constructor() {
  }

  public static getInstance(): LocalAiModelEngine {
    if (LocalAiModelEngine.instance === null) {
      LocalAiModelEngine.instance = new LocalAiModelEngine();
    }
    return LocalAiModelEngine.instance;
  }

  public async resolveChatIntentAndAnswer(
    prompt: string,
    plan?: LocalExecutionPlan
  ): Promise<ChatIntentResult> {
    const startTime: number = Date.now();
    const lowerPrompt: string = prompt.toLowerCase();
    const dimension: number = this.resolveDimension(plan);
    const threadCount: ThreadCount = plan === undefined ? 1 : plan.threadCount;

    let brand: string = '';
    if (lowerPrompt.indexOf('耐克') >= 0 || lowerPrompt.indexOf('nike') >= 0) {
      brand = '耐克';
    } else if (lowerPrompt.indexOf('阿迪') >= 0 || lowerPrompt.indexOf('adidas') >= 0) {
      brand = '阿迪达斯';
    } else if (lowerPrompt.indexOf('华为') >= 0) {
      brand = '华为';
    } else if (lowerPrompt.indexOf('苹果') >= 0 || lowerPrompt.indexOf('macbook') >= 0) {
      brand = '苹果';
    } else if (lowerPrompt.indexOf('联想') >= 0) {
      brand = '联想';
    }

    let category: string = '';
    if (lowerPrompt.indexOf('跑步') >= 0 || lowerPrompt.indexOf('跑鞋') >= 0) {
      category = '跑步鞋';
    } else if (lowerPrompt.indexOf('运动鞋') >= 0) {
      category = '运动鞋';
    } else if (lowerPrompt.indexOf('电脑') >= 0 || lowerPrompt.indexOf('笔记本') >= 0) {
      category = '电脑';
    } else if (lowerPrompt.indexOf('男鞋') >= 0) {
      category = '男鞋';
    } else if (lowerPrompt.indexOf('鞋') >= 0) {
      category = '鞋';
    }

    let maxBudget: number | null = null;
    const budgetMatch: RegExpMatchArray | null = lowerPrompt.match(/(\d+)\s*(元|块|预算)/);
    if (budgetMatch !== null && budgetMatch.length > 1) {
      maxBudget = parseInt(budgetMatch[1], 10);
    }

    const searchResults: EmbeddingSearchResult[] =
      await NeuralEmbeddingIndex.getInstance().search(prompt, dimension, threadCount, 6);
    const rankedProducts: Product[] = [];
    for (let index: number = 0; index < searchResults.length; index++) {
      rankedProducts.push(searchResults[index].product);
    }

    const brandText: string = brand.length > 0 ? `品牌【${brand}】` : '品牌不限';
    const categoryText: string = category.length > 0 ? `品类【${category}】` : '相似商品';
    const budgetText: string = maxBudget === null ? '预算不限' : `预算【${maxBudget}元以内】`;
    const generatedAnswer: string =
      `本地规则已解析：${brandText} · ${categoryText} · ${budgetText}；` +
      `端侧 MindSpore Lite ${dimension} 维神经 Embedding 从 2700 条本地商品向量中返回 ${rankedProducts.length} 条候选。`;

    const extractedKeywords: string[] = [];
    if (brand.length > 0) {
      extractedKeywords.push(brand);
    }
    if (category.length > 0) {
      extractedKeywords.push(category);
    }
    let confidenceScore: number = 60;
    if (brand.length > 0) {
      confidenceScore += 10;
    }
    if (category.length > 0) {
      confidenceScore += 15;
    }
    if (maxBudget !== null) {
      confidenceScore += 10;
    }

    return {
      intent: category.length > 0 ? `search_${category}` : 'general_search',
      extractedBrand: brand,
      extractedCategory: category,
      maxBudget: maxBudget,
      extractedKeywords: extractedKeywords,
      generatedAnswer: generatedAnswer,
      confidenceScore: Math.min(90, confidenceScore),
      modelName: 'RuleIntentParser + soleai-neural-char-v1',
      inferenceDurationMs: Date.now() - startTime,
      actualInferenceLocation: InferenceLocation.LOCAL_DEVICE,
      fallbackReason: '',
      topProducts: rankedProducts
    };
  }

  public async runVectorInference(
    query: string,
    _candidates: Product[],
    plan?: LocalExecutionPlan
  ): Promise<AiInferenceResult> {
    const startTime: number = Date.now();
    const dimension: number = this.resolveDimension(plan);
    const threadCount: ThreadCount = plan === undefined ? 1 : plan.threadCount;
    const searchResults: EmbeddingSearchResult[] =
      await NeuralEmbeddingIndex.getInstance().search(query, dimension, threadCount, 20);
    const products: Product[] = [];
    for (let index: number = 0; index < searchResults.length; index++) {
      products.push(searchResults[index].product);
    }
    const durationMs: number = Date.now() - startTime;
    const topCosine: number = searchResults.length === 0 ? 0 : searchResults[0].score;
    const modelInfo: EmbeddingModelInfo | null =
      NeuralEmbeddingIndex.getInstance().getModelInfo();
    const modelVersion: string = modelInfo === null ? 'unknown' : modelInfo.modelVersion;

    hilog.info(
      0x0000,
      'LocalAiModelEngine',
      `Local vector search: model=${modelVersion}, products=2700, dim=${dimension}, partitions=${threadCount}, duration=${durationMs}ms`
    );

    return {
      topProducts: products,
      vectorDimension: dimension,
      inferenceDurationMs: durationMs,
      accuracyScore: Math.round(Math.max(0, topCosine) * 1000) / 10,
      modelName: `SoleAI MindSpore Lite Neural Embedding (${modelVersion})`,
      sourceInfo:
        `端侧 MindSpore Lite 神经 Embedding（2700条神经模型预生成向量 · ${dimension}维 · ` +
        `TaskPool ${threadCount}分区 · CPU）`,
      passCount: 1,
      recommendDegrade: durationMs > 180,
      activeThreads: threadCount,
      activeBackend: Backend.CPU
    };
  }

  private resolveDimension(plan?: LocalExecutionPlan): number {
    if (plan === undefined || plan.modelTier === ModelTier.HIGH_ACCURACY) {
      return 256;
    }
    if (plan.modelTier === ModelTier.BALANCED) {
      return 64;
    }
    return 16;
  }
}
