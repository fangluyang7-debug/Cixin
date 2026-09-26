import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';

// Public API origin only. COS and model credentials never belong in the App.
export class CloudApiConfig {
  private static baseUrl: string = '';
  private static accessToken: string = '';
  public static setAccessToken(token: string): void { CloudApiConfig.accessToken = token; }
  public static requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (CloudApiConfig.accessToken.length > 0) { headers['Authorization'] = 'Bearer ' + CloudApiConfig.accessToken; }
    return headers;
  }
  public static getBaseUrl(): string {
    if (CloudApiConfig.baseUrl.length === 0) { throw new Error('CLOUD_API_NOT_CONFIGURED'); }
    return CloudApiConfig.baseUrl;
  }
  public static async load(context: common.Context): Promise<void> {
    const store = await preferences.getPreferences(context, { name: 'cloud_api_v1' });
    const value = await store.get('baseUrl', '');
    if (typeof value === 'string' && value.length > 0) { CloudApiConfig.set(value); }
  }
  public static async save(context: common.Context, value: string): Promise<void> {
    CloudApiConfig.set(value);
    const store = await preferences.getPreferences(context, { name: 'cloud_api_v1' });
    await store.put('baseUrl', CloudApiConfig.baseUrl);
    await store.flush();
  }
  private static set(value: string): void {
    const normalized = value.trim().replace(/\/$/, '');
    if (!/^https:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(normalized)) { throw new Error('CLOUD_HTTPS_ORIGIN_REQUIRED'); }
    CloudApiConfig.baseUrl = normalized;
  }
}
