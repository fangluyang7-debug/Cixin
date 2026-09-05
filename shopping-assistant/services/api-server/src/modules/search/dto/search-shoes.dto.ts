export interface SearchShoesDto {
  keywords?: string[];
  filters?: Record<string, unknown>;
  categoryHint?: string;
}
