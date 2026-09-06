export class CreateTextSessionDto {
  message: string;
  keywords?: string[];
  filters?: Record<string, unknown>;
  entrySource?: 'android_app' | 'test_app' | 'unknown';
  categoryHint?: string;
}
