import { BadRequestException, Injectable } from '@nestjs/common';
import { createId } from '../../../common/utils/id';
import { fromJson } from '../../../common/utils/json';
import {
  UserMemoryPayloadAdapter,
  UserProfileBlockInput,
  UserProfileIndexData,
} from './user-memory-payload-adapter.interface';

const BLOCK_TYPES = new Set([
  'identity_basic',
  'body_measurements',
  'size_profile',
  'shopping_preferences',
  'platform_preferences',
  'brand_store_preferences',
  'category_preferences',
  'delivery_preferences',
  'interaction_preferences',
]);

@Injectable()
export class StandardUserMemoryPayloadAdapterService implements UserMemoryPayloadAdapter {
  parsePayload(payloadJson: string): Record<string, unknown> {
    return fromJson<Record<string, unknown>>(payloadJson, {});
  }

  validateBlockInput(input: UserProfileBlockInput): void {
    if (!input || typeof input !== 'object') throw new BadRequestException('USER_PROFILE_BLOCK_BODY_REQUIRED');
    if (!BLOCK_TYPES.has(input.blockType)) throw new BadRequestException('USER_PROFILE_BLOCK_TYPE_UNSUPPORTED');
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
      throw new BadRequestException('USER_PROFILE_BLOCK_PAYLOAD_REQUIRED');
    }
    if (input.sensitivity && !['low', 'medium', 'high'].includes(input.sensitivity)) {
      throw new BadRequestException('USER_PROFILE_SENSITIVITY_INVALID');
    }
  }

  inferSensitivity(blockType: string): string {
    return blockType === 'body_measurements' || blockType === 'size_profile' ? 'high' : 'low';
  }

  extractIndexes(input: {
    userId: string;
    blockId: string;
    blockType: string;
    scope: string;
    payload: Record<string, unknown>;
  }): UserProfileIndexData[] {
    const indexes: UserProfileIndexData[] = [];
    const add = (key: string, value: unknown) => {
      if (
        (typeof value === 'string' && value.length > 0) ||
        (typeof value === 'number' && Number.isFinite(value)) ||
        typeof value === 'boolean'
      ) {
        indexes.push({
          id: createId('profile_idx'),
          userId: input.userId,
          blockId: input.blockId,
          key,
          value: String(value),
          scope: input.scope,
          blockType: input.blockType,
        });
      }
    };
    const addArray = (key: string, value: unknown) => {
      if (!Array.isArray(value)) return;
      value.forEach((item) => add(key, item));
    };

    addArray('preferredPlatform', input.payload.preferredPlatforms);
    addArray('excludedPlatform', input.payload.excludedPlatforms);
    addArray('favoriteBrand', input.payload.favoriteBrands);
    addArray('dislikedBrand', input.payload.dislikedBrands);
    addArray('trustedStore', input.payload.trustedStores);
    addArray('blockedStore', input.payload.blockedStores);
    addArray('preferredColor', input.payload.preferredColors);
    addArray('preferredStyle', input.payload.preferredStyles);
    add('shoeSize', input.payload.shoeSize);
    add('heightCm', input.payload.heightCm);
    add('weightKg', input.payload.weightKg);
    add('chestCm', input.payload.chestCm);
    add('waistCm', input.payload.waistCm);
    add('hipCm', input.payload.hipCm);
    add('footLength', input.payload.footLength);
    add('footWidth', input.payload.footWidth);
    add('city', input.payload.city);
    add('maxDeliveryDays', input.payload.maxDeliveryDays);
    add('responseStyle', input.payload.responseStyle);
    return indexes;
  }
}
