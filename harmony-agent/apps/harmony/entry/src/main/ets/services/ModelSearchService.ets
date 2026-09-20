import { http } from '@kit.NetworkKit';
import hilog from '@ohos.hilog';

const MODEL_SEARCH_PROXY_URL: string = 'http://10.0.2.2:3010';
const MODEL_SEARCH_TIMEOUT_MS: number = 1800;

interface ModelSearchRequestPayload {
  query: string;
  limit: number;
}

interface ModelSearchProxyResponse {
  ok: boolean;
  source: string;
  provider: string;
  query: string;
  normalizedKeyword: string;
  keywords: string[];
  intent: string;
  answerHint: string;
  limit: number;
  error?: string;
}

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

export class ModelSearchService {
  private static instance: ModelSearchService | null = null;

  public static getInstance(): ModelSearchService {
    if (ModelSearchService.instance === null) {
      ModelSearchService.instance = new ModelSearchService();
    }
    return ModelSearchService.instance;
  }

  public async resolveTextQuery(query: string, limit: number): Promise<ModelSearchResult> {
    const trimmedQuery: string = query.trim();
    if (trimmedQuery.length === 0) {
      return this.createFallbackResult(query, '');
    }

    const requestPayload: ModelSearchRequestPayload = {
      query: trimmedQuery,
      limit: limit
    };
    const requestHeader: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    const requestOptions: http.HttpRequestOptions = {
      method: http.RequestMethod.POST,
      header: requestHeader,
      extraData: JSON.stringify(requestPayload),
      connectTimeout: MODEL_SEARCH_TIMEOUT_MS,
      readTimeout: MODEL_SEARCH_TIMEOUT_MS
    };
    const urlsToTry: string[] = ['http://10.0.2.2:3010', 'http://127.0.0.1:3010'];
    for (let i = 0; i < urlsToTry.length; i++) {
      const baseUrlStr = urlsToTry[i];
      const request: http.HttpRequest = http.createHttp();
      try {
        const response: http.HttpResponse = await request.request(
          `${baseUrlStr}/api/model-search/text`,
          requestOptions
        );
        if (response.responseCode >= 200 && response.responseCode < 300) {
          const responseText: string = String(response.result);
          const proxyResponse: ModelSearchProxyResponse = JSON.parse(responseText) as ModelSearchProxyResponse;
          if (proxyResponse.ok && proxyResponse.normalizedKeyword.trim().length > 0) {
            request.destroy();
            return {
              ok: true,
              source: proxyResponse.source,
              provider: proxyResponse.provider,
              query: proxyResponse.query,
              normalizedKeyword: proxyResponse.normalizedKeyword.trim(),
              keywords: proxyResponse.keywords,
              intent: proxyResponse.intent,
              answerHint: proxyResponse.answerHint
            };
          }
        }
      } catch (error) {
        hilog.warn(0x0000, 'ModelSearchService', `Model search proxy at ${baseUrlStr} unavailable: ${JSON.stringify(error)}`);
      } finally {
        request.destroy();
      }
    }
    return this.createFallbackResult(query, 'proxy_unavailable');
  }

  private createFallbackResult(query: string, reason: string): ModelSearchResult {
    const normalizedKeyword: string = this.normalizeLocalSearchKeyword(query);
    const keywords: string[] = normalizedKeyword.length > 0 ? [normalizedKeyword] : [];
    return {
      ok: true,
      source: 'local_fallback',
      provider: 'local_rule',
      query: query,
      normalizedKeyword: normalizedKeyword,
      keywords: keywords,
      intent: 'text_search',
      answerHint: reason
    };
  }

  private normalizeLocalSearchKeyword(keyword: string): string {
    const rawKeyword: string = keyword.trim();
    const lowerKeyword: string = rawKeyword.toLowerCase();
    if (lowerKeyword.indexOf('电脑') >= 0 || lowerKeyword.indexOf('笔记本') >= 0 ||
      lowerKeyword.indexOf('laptop') >= 0 || lowerKeyword.indexOf('computer') >= 0) {
      return '电脑';
    }
    if (lowerKeyword.indexOf('耐克') >= 0 || lowerKeyword.indexOf('nike') >= 0) {
      return '耐克';
    }
    if (lowerKeyword.indexOf('通勤') >= 0 && (lowerKeyword.indexOf('男') >= 0 || lowerKeyword.indexOf('鞋') >= 0)) {
      return '男鞋';
    }
    if (lowerKeyword.indexOf('运动') >= 0 || lowerKeyword.indexOf('跑步') >= 0) {
      return '运动鞋';
    }
    if (lowerKeyword.indexOf('鞋') >= 0) {
      return '鞋';
    }
    return rawKeyword;
  }
}
