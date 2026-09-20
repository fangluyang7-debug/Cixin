import type {
  TrendOutfitExtractionInput,
  TrendOutfitExtractionResult,
} from '../../modules/trend-outfit/application/trend-outfit.types';

export const MODEL_ADAPTER = Symbol('MODEL_ADAPTER');

export interface ProductProfileResult {
  category: string;
  brand?: string | null;
  modelLine?: string | null;
  colorFamily?: string | null;
  colorway?: string | null;
  shoeType?: string | null;
  size?: string | null;
  color?: string | null;
  styleTags: string[];
  sceneTags: string[];
  keywords: string[];
  confidence: number;
  raw: Record<string, unknown>;
}

export interface IdentifyShoeInput {
  assetId?: string;
  imageUrl?: string | null;
  categoryHint?: string | null;
}

export interface ProductCategoryResult {
  category: string;
  confidence: number;
  raw: Record<string, unknown>;
}

export interface ProductTagResult {
  category: string;
  brand?: string | null;
  modelLine?: string | null;
  colorFamily?: string | null;
  colorway?: string | null;
  shoeType?: string | null;
  keywords: string[];
  confidence: number;
  raw: Record<string, unknown>;
}

export interface ProductTagInput {
  title: string;
  platform?: string;
  brandHint?: string | null;
  categoryHint?: string | null;
  imageUrl?: string | null;
  rawPayload?: Record<string, unknown>;
}

export interface CandidateVisualVerificationInput {
  queryProfile: ProductProfileResult;
  queryImageUrl?: string | null;
  candidate: {
    title: string;
    brand?: string | null;
    modelLine?: string | null;
    colorFamily?: string | null;
    colorway?: string | null;
    imageUrl?: string | null;
  };
}

export interface CandidateVisualVerificationResult {
  sameProduct: boolean | null;
  sameColorway: boolean | null;
  confidence: number;
  verificationStatus: 'verified' | 'not_verified' | 'failed' | 'timeout';
  verificationSource: 'model' | 'product_id' | 'ann_only' | 'tag_only';
  raw: Record<string, unknown>;
}

export type ConversationIntent =
  | 'refine_filter'
  | 'reset_filter'
  | 'ask_clarification'
  | 'compare_candidates'
  | 'explain_result'
  | 'shopping_advice'
  | 'general_chat';

export interface ConversationContextMessage {
  turnIndex: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ConversationSummaryContext {
  summaryText: string;
  summaryJson: Record<string, unknown>;
  coveredTurnIndex: number;
  createdAt: string;
}

export interface ConversationCandidateSummaryItem {
  candidateItemId: string;
  productId?: string | null;
  title: string;
  platformName: string;
  amount: string;
  currency: string;
  stockStatus: string;
  matchSummary: Record<string, unknown>;
}

export interface ConversationTurnParseInput {
  sessionId: string;
  turnIndex: number;
  latestUserMessage: string;
  productProfile: ProductProfileResult | null;
  effectiveFilter: Record<string, unknown>;
  userMemoryContext?: Record<string, unknown> | null;
  conversationSummary: ConversationSummaryContext | null;
  recentMessages: ConversationContextMessage[];
  candidateSummary: ConversationCandidateSummaryItem[];
  prompt: {
    version: string;
    systemPrompt: string;
  };
  outputSchema: {
    version: string;
    schema: Record<string, unknown>;
  };
  profileSchema: {
    version: string;
    schema: Record<string, unknown>;
  };
}

export interface ConversationTurnParseResult {
  intent: ConversationIntent;
  filterPatch: Record<string, unknown>;
  filterRemove: string[];
  shouldResetPreviousFilters: boolean;
  assistantMessage: string;
  confidence: number;
  raw: Record<string, unknown>;
  semanticOperations?: ConversationSemanticOperationV2[];
  candidateRefs?: ConversationCandidateReference[];
  profilePatch?: Record<string, unknown>;
  profileRemove?: string[];
  rejectedOperations?: ConversationRejectedOperation[];
}

export type ConversationSemanticOperationKind =
  | 'set'
  | 'remove'
  | 'include'
  | 'exclude'
  | 'delta'
  | 'prefer'
  | 'avoid'
  | 'reset'
  | 'reference';

export interface ConversationSemanticOperationV2 {
  kind: ConversationSemanticOperationKind;
  field: string;
  value?: unknown;
  values?: unknown[];
  span?: { start: number; end: number; text: string };
  polarity?: 'positive' | 'negative' | 'cancel';
  confidence: number;
  source: 'deterministic' | 'model' | 'request';
}

export interface ConversationCandidateReference {
  candidateItemId: string;
  productId?: string | null;
  ordinal: number;
  title: string;
}

export interface ConversationRejectedOperation {
  field: string;
  code: string;
  message: string;
  value?: unknown;
}

export interface ModelAdapter {
  identifyShoe(input: IdentifyShoeInput): Promise<ProductProfileResult>;
  classifyProductCategory(input: {
    imageUrl: string;
    categoryHint?: string | null;
  }): Promise<ProductCategoryResult>;
  parseRefineMessage(input: { message: string }): Promise<Record<string, unknown>>;
  parseConversationTurn(input: ConversationTurnParseInput): Promise<ConversationTurnParseResult>;
  extractTrendOutfit(
    input: TrendOutfitExtractionInput,
  ): Promise<TrendOutfitExtractionResult>;
  tagProduct(input: ProductTagInput): Promise<ProductTagResult>;
  verifyCandidateVisualMatch(
    input: CandidateVisualVerificationInput,
  ): Promise<CandidateVisualVerificationResult>;
}
