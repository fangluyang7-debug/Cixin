import { PLATFORM_FILTER_VALUES } from '../platforms/platform-normalization';

export const CONVERSATION_FILTER_OUTPUT_VERSION =
  'conversation-filter-output-v2';

export const CONVERSATION_FILTER_FIELDS = [
  'priceMin',
  'priceMax',
  'priceTarget',
  'priceTolerance',
  'platformsInclude',
  'platformsExclude',
  'brandsInclude',
  'brandsExclude',
  'colorsInclude',
  'colorsExclude',
  'sizesInclude',
  'sizeSystem',
  'sizeMin',
  'sizeMax',
  'excludedProductIds',
  'excludedCandidateItemIds',
  'sortRule',
  'stockOnly',
  'freeShippingOnly',
  'urgentDeliveryPreferred',
  'timeConstraintDays',
  'shopType',
  'categoryScope',
  'preferences',
] as const;

export const CONVERSATION_FILTER_REMOVE_FIELDS = [
  ...CONVERSATION_FILTER_FIELDS,
  'platform',
  'brand',
  'color',
  'size',
] as const;

export const CONVERSATION_SORT_RULES = [
  'price_asc',
  'price_desc',
  'relevance_desc',
  'rating_desc',
  'delivery_asc',
] as const;

export function buildConversationFilterOutputSchema(): Record<string, unknown> {
  const nullableScalar = { type: ['string', 'number', 'null'] };
  const stringArray = { type: 'array', items: { type: 'string' } };
  return {
    version: CONVERSATION_FILTER_OUTPUT_VERSION,
    type: 'object',
    required: [
      'intent',
      'filterPatch',
      'filterRemove',
      'shouldResetPreviousFilters',
      'assistantMessage',
      'confidence',
    ],
    properties: {
      intent: {
        type: 'string',
        enum: [
          'refine_filter',
          'reset_filter',
          'ask_clarification',
          'compare_candidates',
          'explain_result',
          'shopping_advice',
          'general_chat',
        ],
      },
      filterPatch: {
        type: 'object',
        additionalProperties: false,
        properties: {
          priceMin: nullableScalar,
          priceMax: nullableScalar,
          priceTarget: nullableScalar,
          priceTolerance: nullableScalar,
          platformsInclude: {
            type: 'array',
            items: { type: 'string', enum: PLATFORM_FILTER_VALUES },
          },
          platformsExclude: {
            type: 'array',
            items: { type: 'string', enum: PLATFORM_FILTER_VALUES },
          },
          brandsInclude: stringArray,
          brandsExclude: stringArray,
          colorsInclude: stringArray,
          colorsExclude: stringArray,
          sizesInclude: stringArray,
          sizeSystem: { type: ['string', 'null'], enum: ['EU', 'US', 'UK', 'CN', null] },
          sizeMin: nullableScalar,
          sizeMax: nullableScalar,
          excludedProductIds: stringArray,
          excludedCandidateItemIds: stringArray,
          sortRule: { type: 'string', enum: CONVERSATION_SORT_RULES },
          stockOnly: { type: 'boolean' },
          freeShippingOnly: { type: 'boolean' },
          urgentDeliveryPreferred: { type: 'boolean' },
          timeConstraintDays: { type: ['integer', 'null'] },
          shopType: { type: ['string', 'null'] },
          categoryScope: { type: ['string', 'null'] },
          preferences: {
            type: 'object',
            additionalProperties: false,
            properties: {
              freeShipping: { type: 'boolean' },
              shopTypes: stringArray,
              priceDirection: { type: ['string', 'null'], enum: ['lower', 'higher', null] },
              brands: stringArray,
              colors: stringArray,
              platforms: stringArray,
            },
          },
        },
      },
      filterRemove: {
        type: 'array',
        items: { type: 'string', enum: CONVERSATION_FILTER_REMOVE_FIELDS },
      },
      shouldResetPreviousFilters: { type: 'boolean' },
      assistantMessage: { type: 'string' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
  };
}
