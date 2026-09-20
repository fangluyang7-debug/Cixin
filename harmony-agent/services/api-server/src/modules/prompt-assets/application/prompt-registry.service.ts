import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeProductCategory } from '../../../common/catalog/product-categories';
import {
  buildConversationFilterOutputSchema,
  CONVERSATION_FILTER_OUTPUT_VERSION,
} from '../../../common/shopping/conversation-filter-definition';

export interface ConversationPromptResource {
  version: string;
  systemPrompt: string;
}

export interface JsonSchemaResource {
  version: string;
  schema: Record<string, unknown>;
}

@Injectable()
export class PromptRegistryService {
  private readonly cache = new Map<string, ConversationPromptResource | JsonSchemaResource>();

  getConversationPrompt(category = 'general'): ConversationPromptResource {
    const normalizedCategory = normalizeProductCategory(category);
    const promptCategory = normalizedCategory === 'shoe' ? 'shoe' : 'general';
    const key = `conversation:${promptCategory}`;
    const cached = this.cache.get(key);
    if (cached) return cached as ConversationPromptResource;

    const systemPrompt = this.readPromptFile(`conversation/${promptCategory}.system.md`);
    const version = this.extractMarkdownVersion(
      systemPrompt,
      `conversation-${promptCategory}-system-v1`,
    );
    const resource = { version, systemPrompt };
    this.cache.set(key, resource);
    return resource;
  }

  getFilterOutputSchema(): JsonSchemaResource {
    const key = 'conversation:filter-output-schema';
    const cached = this.cache.get(key);
    if (cached) return cached as JsonSchemaResource;

    const schema = buildConversationFilterOutputSchema();
    const version = CONVERSATION_FILTER_OUTPUT_VERSION;
    const resource = { version, schema };
    this.cache.set(key, resource);
    return resource;
  }

  private readPromptFile(relativePath: string) {
    return readFileSync(this.resolvePromptPath(relativePath), 'utf8');
  }

  private readJsonFile(relativePath: string) {
    const parsed = JSON.parse(this.readPromptFile(relativePath)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new InternalServerErrorException('PROMPT_JSON_OBJECT_REQUIRED');
    }
    return parsed as Record<string, unknown>;
  }

  private resolvePromptPath(relativePath: string) {
    const candidates = [
      join(process.cwd(), 'services', 'api-server', 'dist', 'prompts', relativePath),
      join(process.cwd(), 'services', 'api-server', 'src', 'prompts', relativePath),
      join(process.cwd(), 'dist', 'prompts', relativePath),
      join(process.cwd(), 'src', 'prompts', relativePath),
      join(__dirname, '..', '..', '..', '..', 'prompts', relativePath),
      join(__dirname, '..', '..', '..', 'prompts', relativePath),
      join(__dirname, '..', '..', '..', '..', 'src', 'prompts', relativePath),
    ];
    const hit = candidates.find((candidate) => existsSync(candidate));
    if (!hit) {
      throw new InternalServerErrorException(`PROMPT_RESOURCE_NOT_FOUND:${relativePath}`);
    }
    return hit;
  }

  private extractMarkdownVersion(content: string, fallback: string) {
    const match = content.match(/^version:\s*(.+)$/m);
    return match?.[1]?.trim() || fallback;
  }
}
