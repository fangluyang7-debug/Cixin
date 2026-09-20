import { Injectable } from '@nestjs/common';
import { extractMentionedPlatforms } from '../../../common/platforms/platform-normalization';
import { UserMemoryService } from './user-memory.service';

interface CreateProposalsFromTurnInput {
  userId: string;
  sessionId: string;
  turnIndex: number;
  message: string;
}

interface MemoryProposalDraft {
  blockType: string;
  scope?: string;
  payload: Record<string, unknown>;
  reason: string;
  sensitivity?: 'low' | 'medium' | 'high';
  confidence?: number;
}

const BRAND_ALIASES: Array<[string, RegExp]> = [
  ['Nike', /nike|耐克/i],
  ['Adidas', /adidas|阿迪/i],
  ['Puma', /puma|彪马/i],
  ['Anta', /anta|安踏/i],
  ['Li-Ning', /li[- ]?ning|李宁/i],
  ['New Balance', /new balance|nb|新百伦/i],
  ['ASICS', /asics|亚瑟士/i],
];

const COLOR_ALIASES: Array<[string, RegExp]> = [
  ['black', /黑色|黑白|black/i],
  ['white', /白色|黑白|white/i],
  ['gray', /灰色|grey|gray/i],
  ['blue', /蓝色|blue/i],
  ['red', /红色|red/i],
  ['green', /绿色|green/i],
];

@Injectable()
export class UserMemoryExtractionService {
  constructor(private readonly userMemory: UserMemoryService) {}

  async createProposalsFromTurn(input: CreateProposalsFromTurnInput) {
    const drafts = this.extractDrafts(input.message);
    const created = [];
    for (const draft of drafts) {
      const proposal = await this.userMemory.createProposal({
        userId: input.userId,
        sessionId: input.sessionId,
        turnIndex: input.turnIndex,
        blockType: draft.blockType,
        scope: draft.scope,
        payload: draft.payload,
        sourceText: input.message,
        reason: draft.reason,
        confidence: draft.confidence,
        sensitivity: draft.sensitivity,
      });
      if (proposal) created.push(proposal);
    }
    return created;
  }

  private extractDrafts(message: string): MemoryProposalDraft[] {
    const drafts: MemoryProposalDraft[] = [];
    const sizeProfile = this.extractSizeProfile(message);
    if (Object.keys(sizeProfile).length > 0) {
      drafts.push({
        blockType: 'size_profile',
        scope: 'shoe',
        payload: sizeProfile,
        reason: '用户明确提到鞋码或品牌尺码信息',
        sensitivity: 'high',
        confidence: 0.86,
      });
    }

    const bodyMeasurements = this.extractBodyMeasurements(message);
    if (Object.keys(bodyMeasurements).length > 0) {
      drafts.push({
        blockType: 'body_measurements',
        scope: 'global',
        payload: bodyMeasurements,
        reason: '用户明确提到身体尺寸信息',
        sensitivity: 'high',
        confidence: 0.88,
      });
    }

    const platformPreference = this.extractPlatformPreferences(message);
    if (Object.keys(platformPreference).length > 0) {
      drafts.push({
        blockType: 'platform_preferences',
        scope: 'global',
        payload: platformPreference,
        reason: '用户明确表达平台偏好或排斥平台',
        sensitivity: 'low',
        confidence: 0.84,
      });
    }

    const brandPreference = this.extractBrandPreferences(message);
    if (Object.keys(brandPreference).length > 0) {
      drafts.push({
        blockType: 'brand_store_preferences',
        scope: 'global',
        payload: brandPreference,
        reason: '用户明确表达品牌或店铺偏好',
        sensitivity: 'low',
        confidence: 0.8,
      });
    }

    const shoePreference = this.extractShoePreferences(message);
    if (Object.keys(shoePreference).length > 0) {
      drafts.push({
        blockType: 'category_preferences',
        scope: 'shoe',
        payload: shoePreference,
        reason: '用户明确表达鞋类颜色或风格偏好',
        sensitivity: 'low',
        confidence: 0.78,
      });
    }

    const deliveryPreference = this.extractDeliveryPreferences(message);
    if (Object.keys(deliveryPreference).length > 0) {
      drafts.push({
        blockType: 'delivery_preferences',
        scope: 'global',
        payload: deliveryPreference,
        reason: '用户明确表达配送时效或城市偏好',
        sensitivity: 'medium',
        confidence: 0.78,
      });
    }

    const interactionPreference = this.extractInteractionPreferences(message);
    if (Object.keys(interactionPreference).length > 0) {
      drafts.push({
        blockType: 'interaction_preferences',
        scope: 'global',
        payload: interactionPreference,
        reason: '用户明确表达交互输出偏好',
        sensitivity: 'low',
        confidence: 0.78,
      });
    }

    return drafts;
  }

  private extractSizeProfile(message: string) {
    const payload: Record<string, unknown> = {};
    const shoeSizeMatch = message.match(/(?:鞋码|码数|穿|穿着|平时穿|shoe size|size|wear)\s*(?:欧码|EU|is|:)?\s*(\d{2}(?:\.5)?)/i);
    if (shoeSizeMatch) payload.shoeSize = shoeSizeMatch[1];
    const footLengthMatch = message.match(/脚长\s*(\d{2,3}(?:\.\d+)?)\s*(?:mm|毫米|cm|厘米)?/i);
    if (footLengthMatch) payload.footLength = footLengthMatch[1];
    const footWidthMatch = message.match(/脚宽\s*(\d{1,3}(?:\.\d+)?)\s*(?:mm|毫米|cm|厘米)?/i);
    if (footWidthMatch) payload.footWidth = footWidthMatch[1];

    const mentionedBrands = this.matchAliases(message, BRAND_ALIASES);
    if (mentionedBrands.length > 0 && payload.shoeSize) {
      payload.brandSizes = mentionedBrands.map((brand) => ({
        brand,
        category: 'shoe',
        size: payload.shoeSize,
      }));
    }
    return payload;
  }

  private extractBodyMeasurements(message: string) {
    const payload: Record<string, unknown> = {};
    this.assignNumber(payload, 'heightCm', message, /身高\s*(\d{2,3}(?:\.\d+)?)\s*(?:cm|厘米)?/i);
    this.assignNumber(payload, 'weightKg', message, /体重\s*(\d{2,3}(?:\.\d+)?)\s*(?:kg|公斤|斤)?/i);
    this.assignNumber(payload, 'chestCm', message, /(?:胸围|胸)\s*(\d{2,3}(?:\.\d+)?)\s*(?:cm|厘米)?/i);
    this.assignNumber(payload, 'waistCm', message, /(?:腰围|腰)\s*(\d{2,3}(?:\.\d+)?)\s*(?:cm|厘米)?/i);
    this.assignNumber(payload, 'hipCm', message, /(?:臀围|臀)\s*(\d{2,3}(?:\.\d+)?)\s*(?:cm|厘米)?/i);
    this.assignNumber(payload, 'shoulderWidthCm', message, /肩宽\s*(\d{2,3}(?:\.\d+)?)\s*(?:cm|厘米)?/i);
    this.assignNumber(payload, 'pantsLengthCm', message, /裤长\s*(\d{2,3}(?:\.\d+)?)\s*(?:cm|厘米)?/i);
    return payload;
  }

  private extractPlatformPreferences(message: string) {
    const platforms = extractMentionedPlatforms(message);
    if (platforms.length === 0) return {};
    if (/不要|不看|排除|拉黑|别给我|不想看|以后别|no |not |exclude|block/i.test(message)) {
      return { excludedPlatforms: platforms };
    }
    if (/喜欢|优先|常用|默认|经常|只看|偏好|prefer|favorite|usually|always/i.test(message)) {
      return { preferredPlatforms: platforms };
    }
    return {};
  }

  private extractBrandPreferences(message: string) {
    const brands = this.matchAliases(message, BRAND_ALIASES);
    if (brands.length === 0) return {};
    if (/不要|不看|排除|拉黑|不喜欢|以后别|no |not |exclude|block|dislike/i.test(message)) {
      return { dislikedBrands: brands };
    }
    if (/喜欢|优先|常买|常穿|信任|默认|偏好|prefer|favorite|usually|trust/i.test(message)) {
      return { favoriteBrands: brands };
    }
    return {};
  }

  private extractShoePreferences(message: string) {
    const payload: Record<string, unknown> = {};
    const colors = this.matchAliases(message, COLOR_ALIASES);
    if (colors.length > 0 && /喜欢|偏好|优先|常买|想要|以后/i.test(message)) {
      payload.preferredColors = colors;
    }
    const styles: string[] = [];
    if (/跑鞋|running/i.test(message)) styles.push('running');
    if (/篮球鞋|basketball/i.test(message)) styles.push('basketball');
    if (/板鞋|skate/i.test(message)) styles.push('skate');
    if (/通勤|日常|休闲/i.test(message)) styles.push('casual');
    if (styles.length > 0 && /喜欢|偏好|优先|常买|想要|以后/i.test(message)) {
      payload.preferredStyles = [...new Set(styles)];
    }
    return payload;
  }

  private extractDeliveryPreferences(message: string) {
    const payload: Record<string, unknown> = {};
    const cityMatch = message.match(/(?:常用城市|收货城市|我在|送到)\s*([\u4e00-\u9fa5]{2,8})/);
    if (cityMatch) payload.city = cityMatch[1];
    const daysMatch = message.match(/(?:最好|希望|需要|接受)?\s*(\d{1,2})\s*天(?:内|以内|到货|送达)/);
    if (daysMatch) payload.maxDeliveryDays = Number(daysMatch[1]);
    if (Object.keys(payload).length > 0) payload.addressGranularity = 'city_or_region_only';
    return payload;
  }

  private extractInteractionPreferences(message: string) {
    if (/以后|默认|每次/.test(message) && /简单|简短|直接结论|少解释/.test(message)) {
      return { responseStyle: 'concise' };
    }
    if (/以后|默认|每次/.test(message) && /详细|解释清楚|多解释/.test(message)) {
      return { responseStyle: 'detailed' };
    }
    if (/每次.*确认|记忆.*确认|别自动记/.test(message)) {
      return { memoryConfirmationMode: 'always_confirm' };
    }
    return {};
  }

  private matchAliases(message: string, aliases: Array<[string, RegExp]>) {
    return [...new Set(aliases.filter(([, pattern]) => pattern.test(message)).map(([value]) => value))];
  }

  private assignNumber(
    payload: Record<string, unknown>,
    key: string,
    message: string,
    pattern: RegExp,
  ) {
    const match = message.match(pattern);
    if (match) payload[key] = Number(match[1]);
  }
}
