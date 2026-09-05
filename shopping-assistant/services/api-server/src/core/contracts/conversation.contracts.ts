export type ConversationRole = 'system' | 'user' | 'assistant';

export type ConversationIntent =
  | 'refine_filter'
  | 'reset_filter'
  | 'ask_clarification'
  | 'compare_candidates'
  | 'explain_result'
  | 'shopping_advice'
  | 'general_chat';

export type ConversationMessageContract = {
  sessionId: string;
  turnIndex: number;
  role: ConversationRole;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type FilterPatchContract = {
  intent: ConversationIntent;
  filterPatch: Record<string, unknown>;
  filterRemove: string[];
  shouldResetPreviousFilters: boolean;
  assistantMessage: string;
  confidence: number;
  promptVersion: string;
  schemaVersion: string;
  raw: Record<string, unknown>;
};

export type EffectiveFilterState = {
  priceMin?: string | null;
  priceMax?: string | null;
  priceTarget?: string | null;
  priceTolerance?: string | null;
  platformsInclude?: string[];
  platformsExclude?: string[];
  excludedProductIds?: string[];
  excludedCandidateItemIds?: string[];
  brandsInclude?: string[];
  brandsExclude?: string[];
  colorsInclude?: string[];
  colorsExclude?: string[];
  sizesInclude?: string[];
  sizeSystem?: 'EU' | 'US' | 'UK' | 'CN' | null;
  sizeMin?: string | null;
  sizeMax?: string | null;
  stockOnly?: boolean;
  freeShippingOnly?: boolean;
  sortRule?: string | null;
  timeConstraintDays?: number | null;
  shopType?: string | null;
  categoryScope?: string | null;
  preferences?: {
    freeShipping?: boolean;
    shopTypes?: string[];
    priceDirection?: 'lower' | 'higher' | null;
    brands?: string[];
    colors?: string[];
    platforms?: string[];
  };
  raw?: Record<string, unknown>;
};
