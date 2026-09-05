import { Injectable } from '@nestjs/common';
import { CacheStore } from '../interfaces/cache-store.interface';

type Entry = {
  value: unknown;
  expiresAt: number | null;
};

@Injectable()
export class InMemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, Entry>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number) {
    this.entries.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async delete(key: string) {
    this.entries.delete(key);
  }
}
