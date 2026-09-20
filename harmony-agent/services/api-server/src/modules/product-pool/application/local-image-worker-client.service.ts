import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LocalImageWorkerClientService {
  constructor(private readonly config: ConfigService) {}

  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const baseUrl = this.baseUrl();
    const timeoutMs = this.config.get<number>('embedding.localWorkerTimeoutMs') ?? 60000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/g, '')}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new InternalServerErrorException(`LOCAL_IMAGE_WORKER_REQUEST_FAILED_${response.status}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      throw new InternalServerErrorException('LOCAL_IMAGE_WORKER_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  }

  async health() {
    const baseUrl = this.baseUrl();
    const timeoutMs = Math.min(this.config.get<number>('embedding.localWorkerTimeoutMs') ?? 60000, 5000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/g, '')}/v1/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`status:${response.status}`);
      return (await response.json()) as Record<string, unknown>;
    } catch {
      throw new InternalServerErrorException('LOCAL_IMAGE_WORKER_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  }

  private baseUrl() {
    const baseUrl = this.config.get<string>('embedding.localWorkerBaseUrl')?.trim();
    if (!baseUrl) {
      throw new InternalServerErrorException('LOCAL_IMAGE_WORKER_BASE_URL_REQUIRED');
    }
    return baseUrl.replace(/\/+$/g, '');
  }
}
