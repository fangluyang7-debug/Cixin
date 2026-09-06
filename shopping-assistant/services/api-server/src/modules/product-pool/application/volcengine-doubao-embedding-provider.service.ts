import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  EmbeddingInput,
  EmbeddingProvider,
  EmbeddingResult,
  ImageEmbeddingInput,
  TextEmbeddingInput,
} from './embedding-provider.interface';

type EmbeddingContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

@Injectable()
export class VolcengineDoubaoEmbeddingProviderService implements EmbeddingProvider {
  constructor(private readonly config: ConfigService) {}

  async embed(input: EmbeddingInput): Promise<EmbeddingResult> {
    if (input.imageUrl || input.imageBase64) {
      return this.embedImage({
        imageUrl: input.imageUrl,
        imageBase64: input.imageBase64,
        imageContentType: input.imageContentType,
        textHint: input.text,
        tags: input.tags,
      });
    }

    return this.embedText({
      text: input.text ?? JSON.stringify(input.tags ?? {}),
      tags: input.tags,
    });
  }

  async embedImage(input: ImageEmbeddingInput): Promise<EmbeddingResult> {
    const content: EmbeddingContent[] = [];
    if (input.textHint && input.textHint.trim().length > 0) {
      content.push({ type: 'text', text: input.textHint.trim() });
    }
    const imageUrl = this.resolveImageUrl(input);
    content.push({ type: 'image_url', image_url: { url: imageUrl } });
    return this.callEmbedding(content, input.tags);
  }

  async embedText(input: TextEmbeddingInput): Promise<EmbeddingResult> {
    return this.callEmbedding([{ type: 'text', text: input.text }], input.tags);
  }

  private async callEmbedding(input: EmbeddingContent[], _tags?: Record<string, unknown>) {
    const baseUrl = this.config.get<string>('embedding.baseUrl');
    const apiKey = this.config.get<string>('embedding.apiKey');
    const modelName = this.config.get<string>('embedding.modelName');
    const dimension = this.config.get<number>('embedding.dimension');
    if (!baseUrl || !apiKey || !modelName) {
      throw new InternalServerErrorException('EMBEDDING_PROVIDER_NOT_CONFIGURED');
    }

    const endpoint = this.buildEmbeddingEndpoint(baseUrl);
    const body: Record<string, unknown> = { model: modelName, input };
    if (dimension !== undefined) body.dimensions = dimension;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new InternalServerErrorException(
        `EMBEDDING_PROVIDER_REQUEST_FAILED_${response.status}: ${this.truncateErrorBody(body)}`,
      );
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const vector = this.extractVector(payload);
    const vectorHash = createHash('sha256').update(JSON.stringify(vector)).digest('hex');

    return {
      provider: this.config.get<string>('embedding.provider') ?? 'volcengine_doubao_vision',
      modelName,
      dimension: vector.length,
      vector,
      vectorHash,
    };
  }

  private buildEmbeddingEndpoint(baseUrl: string) {
    const normalized = baseUrl
      .replace(/\/api\/coding\/v3\/?$/g, '/api/v3')
      .replace(/\/+$/g, '');
    if (normalized.endsWith('/embeddings/multimodal')) return normalized;
    if (normalized.endsWith('/embeddings')) return `${normalized}/multimodal`;
    return `${normalized}/embeddings/multimodal`;
  }

  private resolveImageUrl(input: ImageEmbeddingInput) {
    if (input.imageBase64?.trim()) {
      const contentType = input.imageContentType?.trim() || 'image/jpeg';
      const base64 = input.imageBase64.includes(',')
        ? input.imageBase64.split(',', 2)[1]
        : input.imageBase64;
      return `data:${contentType};base64,${base64}`;
    }
    if (input.imageUrl?.trim()) return input.imageUrl.trim();
    throw new InternalServerErrorException('EMBEDDING_IMAGE_INPUT_REQUIRED');
  }

  private extractVector(payload: Record<string, unknown>) {
    const data = payload.data;
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0] as Record<string, unknown>;
      const embedding = first.embedding;
      if (Array.isArray(embedding)) return this.normalizeVector(embedding);
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const embedding = (data as Record<string, unknown>).embedding;
      if (Array.isArray(embedding)) return this.normalizeVector(embedding);
    }

    const embedding = payload.embedding;
    if (Array.isArray(embedding)) return this.normalizeVector(embedding);

    throw new InternalServerErrorException('EMBEDDING_PROVIDER_INVALID_RESPONSE');
  }

  private normalizeVector(value: unknown[]) {
    const vector = value
      .map((item) => (typeof item === 'number' ? item : Number(item)))
      .filter((item) => Number.isFinite(item));
    if (vector.length === 0) {
      throw new InternalServerErrorException('EMBEDDING_PROVIDER_EMPTY_VECTOR');
    }
    return vector;
  }

  private truncateErrorBody(value: string) {
    const compact = value.replace(/\s+/g, ' ').trim();
    return compact.length > 500 ? `${compact.slice(0, 500)}...` : compact;
  }
}
