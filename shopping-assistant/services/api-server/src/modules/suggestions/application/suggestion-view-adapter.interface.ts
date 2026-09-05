import { CandidateItem } from "@prisma/client";

export const SUGGESTION_VIEW_ADAPTER = Symbol("SUGGESTION_VIEW_ADAPTER");

export type SmartSuggestionCardType =
  | "filter"
  | "sort"
  | "inspect"
  | "recommend"
  | "question";

export type SmartSuggestionActionType =
  | "submit_turn"
  | "open_candidate_detail"
  | "open_price_history"
  | "open_trend_outfit"
  | "open_filter_sheet";

export interface SmartSuggestionCard {
  cardId: string;
  type: SmartSuggestionCardType;
  title: string;
  subtitle?: string;
  reason: string;
  confidence: number;
  priority: number;
  action: {
    type: SmartSuggestionActionType;
    message?: string;
    candidateItemId?: string;
    filterPatch?: Record<string, unknown>;
    field?: "color" | "brand" | "size";
  };
  preview?: {
    remainingCount?: number;
    affectedFields?: string[];
  };
}

export interface SuggestionViewAdapter {
  buildSuggestionsView(input: {
    items: CandidateItem[];
    degraded: boolean;
    activeFilter?: Record<string, unknown>;
  }): Record<string, unknown>;
}
