import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  EmbeddingInput,
  EmbeddingProvider,
  EmbeddingResult,
  ImageEmbeddingInput,
  TextEmbeddingInput,
} from './embedding-provider.interface';

@Injectable()
export class HashEmbeddingProviderService implements EmbeddingProvider {
  constructor(private readonly config: ConfigService) {}

  async embed(input: EmbeddingInput): Promise<EmbeddingResult> {
    const dimension = this.resolveDimension();
    const vector = new Array<number>(dimension).fill(0);
    const tokens = this.tokenize([
      input.text,
      input.imageUrl ?? '',
      input.imageBase64 ? this.hashImageInput(input.imageBase64) : '',
      JSON.stringify(input.tags ?? {}),
    ].join(' '));

    for (const token of tokens) {
      const hash = createHash('sha256').update(token).digest();
      const index = hash.readUInt32BE(0) % dimension;
      const sign = hash[4] % 2 === 0 ? 1 : -1;
      vector[index] += sign * (1 + Math.min(token.length, 16) / 16);
    }

    const normalized = this.normalize(vector);
    return {
      provider: this.config.get<string>('embedding.provider') ?? 'hash',
      modelName: this.config.get<string>('embedding.modelName') ?? 'hash-provider',
      dimension,
      vector: normalized,
      vectorHash: createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),
    };
  }

  async embedImage(input: ImageEmbeddingInput): Promise<EmbeddingResult> {
    return this.embed({
      text: input.textHint ?? '',
      imageUrl: input.imageUrl,
      imageBase64: input.imageBase64,
      imageContentType: input.imageContentType,
      tags: input.tags,
    });
  }

  async embedText(input: TextEmbeddingInput): Promise<EmbeddingResult> {
    return this.embed({
      text: input.text,
      tags: input.tags,
    });
  }

  private resolveDimension() {
    const configured = this.config.get<number>('embedding.dimension');
    if (!configured || !Number.isFinite(configured) || configured <= 0) {
      throw new Error('HASH_EMBEDDING_DIMENSION_NOT_CONFIGURED');
    }
    return configured;
  }

  private tokenize(text: string) {
    const normalized = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (!normalized) return ['shoe'];
    return normalized.split(/\s+/).filter(Boolean);
  }

  private hashImageInput(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private normalize(vector: number[]) {
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (magnitude === 0) return vector;
    return vector.map((value) => Number((value / magnitude).toFixed(8)));
  }
}
