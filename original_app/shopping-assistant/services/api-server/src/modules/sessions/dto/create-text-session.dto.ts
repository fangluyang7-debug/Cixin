export class CreateTextSessionDto {
  message: string;
  keywords?: string[];
  filters?: Record<string, unknown>;
  entrySource?: 'android_app' | 'judge_demo' | 'unknown';
  categoryHint?: string;
}
