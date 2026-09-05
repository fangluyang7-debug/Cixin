import { Injectable } from '@nestjs/common';
import { UserProfileBlock } from '@prisma/client';
import { fromJson } from '../../../common/utils/json';
import { UserMemoryContext } from './user-memory-context.service';
import { UserMemoryContextAdapter } from './user-memory-context-adapter.interface';

@Injectable()
export class StandardUserMemoryContextAdapterService implements UserMemoryContextAdapter {
  toContext(input: {
    userId: string;
    category: string;
    blocks: UserProfileBlock[];
  }): UserMemoryContext {
    const normalizedBlocks = input.blocks.map((block) => ({
      blockId: block.id,
      blockType: block.blockType,
      scope: block.scope,
      payload: fromJson<Record<string, unknown>>(block.payloadJson, {}),
      sensitivity: block.sensitivity,
      schemaVersion: block.schemaVersion,
    }));

    return {
      userId: input.userId,
      category: input.category,
      blocks: normalizedBlocks,
      derived: this.deriveContext(normalizedBlocks),
    };
  }

  private deriveContext(
    blocks: UserMemoryContext['blocks'],
  ): UserMemoryContext['derived'] {
    const preferredPlatforms = new Set<string>();
    const excludedPlatforms = new Set<string>();
    const preferredColors = new Set<string>();
    const favoriteBrands = new Set<string>();
    const trustedStores = new Set<string>();
    let shoeSize: string | null = null;
    let maxDeliveryDays: number | null = null;
    let responseStyle: string | null = null;
    let explicitShoppingGender: 'male' | 'female' | null = null;
    let preferredGenderForProducts: 'male' | 'female' | null = null;
    let profileGender: 'male' | 'female' | null = null;

    for (const block of blocks) {
      const payload = block.payload;
      this.toStringArray(payload.preferredPlatforms).forEach((item) => preferredPlatforms.add(item));
      this.toStringArray(payload.excludedPlatforms).forEach((item) => excludedPlatforms.add(item));
      this.toStringArray(payload.preferredColors).forEach((item) => preferredColors.add(item));
      this.toStringArray(payload.favoriteBrands).forEach((item) => favoriteBrands.add(item));
      this.toStringArray(payload.trustedStores).forEach((item) => trustedStores.add(item));
      if (!shoeSize) shoeSize = this.toNonEmptyString(payload.shoeSize);
      if (typeof payload.maxDeliveryDays === 'number') maxDeliveryDays = payload.maxDeliveryDays;
      if (!responseStyle && typeof payload.responseStyle === 'string') responseStyle = payload.responseStyle;
      if (!explicitShoppingGender) {
        explicitShoppingGender = this.normalizeGender(payload.shoppingGender);
      }
      if (!preferredGenderForProducts) {
        preferredGenderForProducts = this.normalizeGender(payload.preferredGenderForProducts);
      }
      if (!profileGender) {
        profileGender = this.normalizeGender(payload.gender);
      }
    }

    return {
      preferredPlatforms: [...preferredPlatforms],
      excludedPlatforms: [...excludedPlatforms],
      shoeSize,
      preferredColors: [...preferredColors],
      favoriteBrands: [...favoriteBrands],
      trustedStores: [...trustedStores],
      maxDeliveryDays,
      responseStyle,
      shoppingGender: explicitShoppingGender ?? preferredGenderForProducts ?? profileGender,
    };
  }

  private toStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }

  private toNonEmptyString(value: unknown) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  }

  private normalizeGender(value: unknown): 'male' | 'female' | null {
    const text = this.toNonEmptyString(value)?.toLowerCase();
    if (!text) return null;
    if (/女|female|women|woman|girl/.test(text)) return 'female';
    if (/男|male|men|man|boy/.test(text)) return 'male';
    return null;
  }
}
