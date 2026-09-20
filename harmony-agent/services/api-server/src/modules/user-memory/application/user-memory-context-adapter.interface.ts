import { UserProfileBlock } from '@prisma/client';
import type { UserMemoryContext } from './user-memory-context.service';

export const USER_MEMORY_CONTEXT_ADAPTER = Symbol('USER_MEMORY_CONTEXT_ADAPTER');

export interface UserMemoryContextAdapter {
  toContext(input: {
    userId: string;
    category: string;
    blocks: UserProfileBlock[];
  }): UserMemoryContext;
}
