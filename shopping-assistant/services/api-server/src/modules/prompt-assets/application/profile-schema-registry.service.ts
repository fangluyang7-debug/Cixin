import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeProductCategory } from '../../../common/catalog/product-categories';

export interface ProfileSchemaResource {
  version: string;
  category: string;
  schema: Record<string, unknown>;
}

@Injectable()
export class ProfileSchemaRegistryService {
  private readonly cache = new Map<string, ProfileSchemaResource>();

  getProfileSchema(category = 'general'): ProfileSchemaResource {
    const normalizedCategory = normalizeProductCategory(category);
    const schemaCategory = normalizedCategory === 'shoe' ? 'shoe' : 'general';
    const cached = this.cache.get(schemaCategory);
    if (cached) return cached;

    const schema = this.readJsonFile(`product-profile/${schemaCategory}.profile.schema.json`);
    const version =
      typeof schema.version === 'string'
        ? schema.version
        : `${schemaCategory}-profile-v1`;
    const resource = {
      version,
      category: schemaCategory,
      schema,
    };
    this.cache.set(schemaCategory, resource);
    return resource;
  }

  private readJsonFile(relativePath: string) {
    const parsed = JSON.parse(readFileSync(this.resolvePromptPath(relativePath), 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new InternalServerErrorException('PROFILE_SCHEMA_JSON_OBJECT_REQUIRED');
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
      throw new InternalServerErrorException(`PROFILE_SCHEMA_RESOURCE_NOT_FOUND:${relativePath}`);
    }
    return hit;
  }
}
