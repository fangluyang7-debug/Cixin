import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { normalizeProductCategory } from '../../../common/catalog/product-categories';
import {
  USER_MEMORY_CONTEXT_ADAPTER,
  UserMemoryContextAdapter,
} from './user-memory-context-adapter.interface';
import { normalizePlatformKey } from '../../../common/platforms/platform-normalization';

export interface UserMemoryContext {
  userId: string;
  category: string;
  blocks: Array<{
    blockId: string;
    blockType: string;
    scope: string;
    payload: Record<string, unknown>;
    sensitivity: string;
    schemaVersion: string;
  }>;
  derived: {
    preferredPlatforms: string[];
    excludedPlatforms: string[];
    shoeSize: string | null;
    preferredColors: string[];
    favoriteBrands: string[];
    trustedStores: string[];
    maxDeliveryDays: number | null;
    responseStyle: string | null;
    shoppingGender: 'male' | 'female' | null;
  };
}

@Injectable()
export class UserMemoryContextService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(USER_MEMORY_CONTEXT_ADAPTER)
    private readonly contextAdapter: UserMemoryContextAdapter,
  ) {}

  async getContext(userId: string, category = 'global'): Promise<UserMemoryContext> {
    const blocks = await this.prisma.userProfileBlock.findMany({
      where: {
        userId,
        status: 'active',
        OR: [{ scope: 'global' }, { scope: category }],
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    return this.contextAdapter.toContext({ userId, category, blocks });
  }

  async getDefaultFilter(userId: string, category = 'shoe') {
    const normalizedCategory = normalizeProductCategory(category, 'general');
    const context = await this.getContext(userId, category);
    const filter: Record<string, unknown> = {
      platformsExclude: context.derived.excludedPlatforms.map((platform) =>
        this.normalizePlatform(platform),
      ),
    };
    const preferredPlatforms = context.derived.preferredPlatforms
      .map((platform) => this.normalizePlatform(platform))
      .filter((platform) => platform.length > 0);
    if (preferredPlatforms.length > 0) {
      filter.platformsInclude = [...new Set(preferredPlatforms)];
    }
    if (context.derived.preferredColors.length === 1) {
      filter.color = context.derived.preferredColors[0];
    }
    if (normalizedCategory === 'shoe' && context.derived.shoeSize) {
      filter.size = context.derived.shoeSize;
    }
    return filter;
  }

  private normalizePlatform(platform: string) {
    return normalizePlatformKey(platform) ?? platform.trim().toLowerCase();
  }

}
