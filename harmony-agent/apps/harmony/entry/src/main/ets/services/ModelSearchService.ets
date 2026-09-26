export interface ModelSearchResult {
  ok: boolean;
  source: string;
  provider: string;
  query: string;
  normalizedKeyword: string;
  keywords: string[];
  intent: string;
  answerHint: string;
}

/** @deprecated Query preparation belongs to the scheduled Zeabur workflow. */
export class ModelSearchService {
  private static readonly instance: ModelSearchService = new ModelSearchService();
  public static getInstance(): ModelSearchService { return ModelSearchService.instance; }
  public async resolveTextQuery(query: string, limit: number): Promise<ModelSearchResult> {
    throw new Error('SCHEDULED_CLOUD_TASK_REQUIRED');
  }
}
