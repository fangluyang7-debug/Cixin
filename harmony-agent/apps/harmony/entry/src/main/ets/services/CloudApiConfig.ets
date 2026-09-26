import { http } from '@kit.NetworkKit';
import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
interface CloudLoginBody { email: string; password: string; }
interface CloudAuthData { accessToken: string; }
interface CloudAuthEnvelope { success: boolean; data?: CloudAuthData; }

// Public API origin only. COS and model credentials never belong in the App.
export class CloudApiConfig {
  private static baseUrl: string = '';
  private static accessToken: string = '';
  public static setAccessToken(token: string): void { CloudApiConfig.accessToken = token; }
  public static isAuthenticated(): boolean { return CloudApiConfig.accessToken.length > 0; }
  public static logout(): void { CloudApiConfig.accessToken = ''; }
  public static async authenticate(email: string, password: string, register: boolean = false): Promise<void> {
    const origin = CloudApiConfig.getBaseUrl();
    const client = http.createHttp();
    try {
      const input: CloudLoginBody = { email: email.trim(), password };
      const response = await client.request(origin + '/api/v1/auth/' + (register ? 'register' : 'login'), {
        method: http.RequestMethod.POST, header: { 'Content-Type': 'application/json' },
        extraData: JSON.stringify(input), connectTimeout: 10000, readTimeout: 15000
      });
      if (response.responseCode < 200 || response.responseCode >= 300 || typeof response.result !== 'string') { throw new Error('CLOUD_AUTH_FAILED'); }
      const body = JSON.parse(response.result) as CloudAuthEnvelope;
      if (!body.success || !body.data || !body.data.accessToken || origin !== CloudApiConfig.getBaseUrl()) { throw new Error('CLOUD_AUTH_FAILED'); }
      CloudApiConfig.setAccessToken(body.data.accessToken);
    } finally { client.destroy(); }
  }
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
    if (CloudApiConfig.baseUrl !== normalized) { CloudApiConfig.logout(); }
    CloudApiConfig.baseUrl = normalized;
  }
}
