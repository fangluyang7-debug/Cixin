import { TrendOutfitBaseProductInput } from '../application/trend-outfit.types';

export interface TrendOutfitRequestDto {
  sessionId?: string;
  baseProduct?: TrendOutfitBaseProductInput;
  candidateItemId?: string;
  limit?: number;
  debug?: boolean;
}
