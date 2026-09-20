import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

@Injectable()
export class UserProfileSchemaRegistryService {
  private readonly cache = new Map<string, Record<string, unknown>>();

  getSchemaVersion(input: { blockType: string; scope?: string }) {
    const schema = this.getSchema(input);
    return typeof schema.version === 'string' ? schema.version : 'user-profile-v1';
  }

  getSchema(input: { blockType: string; scope?: string }) {
    const resource = this.resolveSchemaResource(input);
    const cached = this.cache.get(resource);
    if (cached) return cached;
    const parsed = JSON.parse(readFileSync(this.resolvePromptPath(resource), 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new InternalServerErrorException('USER_PROFILE_SCHEMA_INVALID');
    }
    const schema = parsed as Record<string, unknown>;
    this.cache.set(resource, schema);
    return schema;
  }

  private resolveSchemaResource(input: { blockType: string; scope?: string }) {
    if (input.blockType === 'category_preferences' && input.scope === 'shoe') {
      return 'user-memory/shoe.preference.schema.json';
    }
    if (input.blockType === 'body_measurements' || input.blockType === 'size_profile') {
      return 'user-memory/measurement.schema.json';
    }
    return 'user-memory/global.profile.schema.json';
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
    if (!hit) throw new InternalServerErrorException(`USER_PROFILE_SCHEMA_NOT_FOUND:${relativePath}`);
    return hit;
  }
}
