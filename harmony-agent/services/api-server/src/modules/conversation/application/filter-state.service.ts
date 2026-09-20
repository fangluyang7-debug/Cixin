import { Injectable } from '@nestjs/common';
import { FilterSnapshot } from '@prisma/client';
import {
  ConversationRejectedOperation,
  ConversationTurnParseResult,
} from '../../../adapters/model/model-adapter.interface';
import {
  PRODUCT_SEARCH_PIPELINE_MODES,
  ProductSearchPipelineMode,
} from '../../../adapters/search-provider/search-provider.interface';
import { normalizeProductCategoryOrNull } from '../../../common/catalog/product-categories';
import {
  CONVERSATION_FILTER_FIELDS,
  CONVERSATION_SORT_RULES,
} from '../../../common/shopping/conversation-filter-definition';
import {
  normalizePlatformFilterValues,
  normalizePlatformKey,
} from '../../../common/platforms/platform-normalization';
import { fromJson, toJsonString } from '../../../common/utils/json';

export interface FilterPreferences {
  freeShipping: boolean;
  shopTypes: string[];
  priceDirection: 'lower' | 'higher' | null;
  brands: string[];
  colors: string[];
  platforms: string[];
}

export interface EffectiveFilterState {
  [key: string]: unknown;
  priceMin: string | null;
  priceMax: string | null;
  priceTarget: string | null;
  priceTolerance: string | null;
  platformsInclude: string[];
  platformsExclude: string[];
  excludedProductIds: string[];
  excludedCandidateItemIds: string[];
  sortRule: string;
  stockOnly: boolean;
  freeShippingOnly: boolean;
  urgentDeliveryPreferred: boolean;
  timeConstraintDays: number | null;
  shopType: string | null;
  color: string | null;
  brand: string | null;
  size: string | null;
  brandsInclude: string[];
  brandsExclude: string[];
  colorsInclude: string[];
  colorsExclude: string[];
  sizesInclude: string[];
  sizeSystem: 'EU' | 'US' | 'UK' | 'CN' | null;
  sizeMin: string | null;
  sizeMax: string | null;
  preferences: FilterPreferences;
  categoryScope: string | null;
  searchPipelineMode: ProductSearchPipelineMode;
}

export interface FilterMergeMeta {
  promptVersion: string;
  schemaVersion: string;
  outputSchemaVersion: string;
}

export interface FilterStateDiff {
  added: Record<string, unknown>;
  changed: Record<string, { before: unknown; after: unknown }>;
  removed: Record<string, unknown>;
  unchanged: string[];
  rejected: ConversationRejectedOperation[];
}

export interface FilterMergeResult {
  effectiveFilter: EffectiveFilterState;
  rawJson: Record<string, unknown>;
  droppedFields: string[];
  filterDiff: FilterStateDiff;
  rejectedOperations: ConversationRejectedOperation[];
  filterSources: Record<string, string>;
}

const ALLOWED_PATCH_FIELDS = new Set<string>([
  ...CONVERSATION_FILTER_FIELDS,
  'color',
  'brand',
  'size',
  'platform',
]);
const SORT_RULE_VALUES = new Set<string>(CONVERSATION_SORT_RULES);

@Injectable()
export class FilterStateService {
  defaultState(): EffectiveFilterState {
    return {
      priceMin: null,
      priceMax: null,
      priceTarget: null,
      priceTolerance: null,
      platformsInclude: [],
      platformsExclude: [],
      excludedProductIds: [],
      excludedCandidateItemIds: [],
      sortRule: 'relevance_desc',
      stockOnly: false,
      freeShippingOnly: false,
      urgentDeliveryPreferred: false,
      timeConstraintDays: null,
      shopType: null,
      color: null,
      brand: null,
      size: null,
      brandsInclude: [],
      brandsExclude: [],
      colorsInclude: [],
      colorsExclude: [],
      sizesInclude: [],
      sizeSystem: null,
      sizeMin: null,
      sizeMax: null,
      preferences: this.defaultPreferences(),
      categoryScope: null,
      searchPipelineMode: 'current_ann_then_refine',
    };
  }

  fromSnapshot(snapshot: FilterSnapshot | null | undefined): EffectiveFilterState {
    if (!snapshot) return this.defaultState();
    const raw = fromJson<Record<string, unknown>>(snapshot.rawJson, {});
    return this.normalizeState({
      ...this.defaultState(),
      priceMin: snapshot.priceMin,
      priceMax: snapshot.priceMax,
      timeConstraintDays: snapshot.timeConstraintDays,
      urgentDeliveryPreferred: snapshot.urgentDeliveryPreferred,
      stockOnly: snapshot.stockOnly,
      shopType: snapshot.shopType,
      color: snapshot.color,
      brand: snapshot.brand,
      platformsInclude: snapshot.platform ? [snapshot.platform] : [],
      sortRule: snapshot.sortRule,
      ...raw,
    });
  }

  merge(
    current: EffectiveFilterState,
    parseResult: ConversationTurnParseResult,
    meta: FilterMergeMeta,
  ): FilterMergeResult {
    const before = this.normalizeState(current);
    const state = parseResult.shouldResetPreviousFilters
      ? this.defaultState()
      : this.normalizeState(before);
    state.searchPipelineMode = before.searchPipelineMode;
    const droppedFields: string[] = [];

    for (const field of parseResult.filterRemove ?? []) this.removeField(state, field);
    for (const [field, value] of Object.entries(parseResult.filterPatch ?? {})) {
      if (!ALLOWED_PATCH_FIELDS.has(field)) {
        droppedFields.push(field);
        continue;
      }
      this.applyField(state, field, value, droppedFields);
    }

    state.platformsInclude = state.platformsInclude.filter(
      (platform) => !state.platformsExclude.includes(platform),
    );
    state.brandsInclude = state.brandsInclude.filter(
      (brand) => !this.includesInsensitive(state.brandsExclude, brand),
    );
    state.colorsInclude = state.colorsInclude.filter(
      (color) => !this.includesInsensitive(state.colorsExclude, color),
    );

    const candidateFilter = this.normalizeState(state);
    const rejectedOperations = [
      ...(parseResult.rejectedOperations ?? []),
      ...this.validateState(candidateFilter),
    ];
    const effectiveFilter = rejectedOperations.length > 0 ? before : candidateFilter;
    const filterDiff = this.buildDiff(before, effectiveFilter, rejectedOperations);
    const filterSources = this.buildFilterSources(effectiveFilter, filterDiff);
    const rawJson = {
      ...effectiveFilter,
      conversationIntent: parseResult.intent,
      shouldResetPreviousFilters: parseResult.shouldResetPreviousFilters,
      filterPatch: parseResult.filterPatch,
      filterRemove: parseResult.filterRemove,
      semanticOperations: parseResult.semanticOperations ?? [],
      candidateRefs: parseResult.candidateRefs ?? [],
      profilePatch: parseResult.profilePatch ?? {},
      profileRemove: parseResult.profileRemove ?? [],
      droppedFields,
      rejectedOperations,
      filterDiff,
      filterSources,
      promptVersion: meta.promptVersion,
      schemaVersion: meta.schemaVersion,
      outputSchemaVersion: meta.outputSchemaVersion,
      parseConfidence: parseResult.confidence,
      parseRaw: parseResult.raw,
    };
    return {
      effectiveFilter,
      droppedFields,
      filterDiff,
      rejectedOperations,
      filterSources,
      rawJson,
    };
  }

  toSnapshotData(input: {
    sessionId: string;
    turnIndex: number;
    effectiveFilter: EffectiveFilterState;
    rawJson: Record<string, unknown>;
  }) {
    const state = this.normalizeState(input.effectiveFilter);
    return {
      sessionId: input.sessionId,
      turnIndex: input.turnIndex,
      priceMin: state.priceMin,
      priceMax: state.priceMax,
      timeConstraintDays: state.timeConstraintDays,
      urgentDeliveryPreferred: state.urgentDeliveryPreferred,
      stockOnly: state.stockOnly,
      shopType: state.shopType,
      color: state.colorsInclude.length === 1 ? state.colorsInclude[0] : null,
      brand: state.brandsInclude.length === 1 ? state.brandsInclude[0] : null,
      platform: state.platformsInclude.length === 1 ? state.platformsInclude[0] : null,
      sortRule: state.sortRule,
      rawJson: toJsonString(input.rawJson),
    };
  }

  normalizeState(value: Record<string, unknown>): EffectiveFilterState {
    const defaults = this.defaultState();
    const platformsInclude = this.toPlatformArray(value.platformsInclude);
    const platformsExclude = this.toPlatformArray(value.platformsExclude);
    const legacyPlatform = this.toPlatform(value.platform);
    if (legacyPlatform && platformsInclude.length === 0) platformsInclude.push(legacyPlatform);

    const brandsInclude = this.toUniqueStringArray(value.brandsInclude);
    const colorsInclude = this.toUniqueStringArray(value.colorsInclude);
    const sizesInclude = this.toUniqueStringArray(value.sizesInclude);
    const legacyBrand = this.toNullableString(value.brand);
    const legacyColor = this.toNullableString(value.color);
    const legacySize = this.toNullableString(value.size);
    if (brandsInclude.length === 0 && legacyBrand) brandsInclude.push(legacyBrand);
    if (colorsInclude.length === 0 && legacyColor) colorsInclude.push(legacyColor);
    if (sizesInclude.length === 0 && legacySize) sizesInclude.push(legacySize);

    return {
      priceMin: this.toNullableString(value.priceMin),
      priceMax: this.toNullableString(value.priceMax),
      priceTarget: this.toNullableString(value.priceTarget),
      priceTolerance: this.toNullableString(value.priceTolerance),
      platformsInclude: [...new Set(platformsInclude)],
      platformsExclude: [...new Set(platformsExclude)],
      excludedProductIds: this.toUniqueStringArray(value.excludedProductIds),
      excludedCandidateItemIds: this.toUniqueStringArray(value.excludedCandidateItemIds),
      sortRule: this.toSortRule(value.sortRule) ?? defaults.sortRule,
      stockOnly: value.stockOnly === true,
      freeShippingOnly: value.freeShippingOnly === true,
      urgentDeliveryPreferred: value.urgentDeliveryPreferred === true,
      timeConstraintDays: this.toNullableInteger(value.timeConstraintDays),
      shopType: this.toNullableString(value.shopType),
      color: colorsInclude.length === 1 ? colorsInclude[0] : null,
      brand: brandsInclude.length === 1 ? brandsInclude[0] : null,
      size: sizesInclude.length === 1 ? sizesInclude[0] : null,
      brandsInclude,
      brandsExclude: this.toUniqueStringArray(value.brandsExclude),
      colorsInclude,
      colorsExclude: this.toUniqueStringArray(value.colorsExclude),
      sizesInclude,
      sizeSystem: this.toSizeSystem(value.sizeSystem),
      sizeMin: this.toNullableString(value.sizeMin),
      sizeMax: this.toNullableString(value.sizeMax),
      preferences: this.normalizePreferences(value.preferences),
      categoryScope: normalizeProductCategoryOrNull(value.categoryScope),
      searchPipelineMode:
        this.toSearchPipelineMode(value.searchPipelineMode) ?? defaults.searchPipelineMode,
    };
  }

  private removeField(state: EffectiveFilterState, field: string) {
    if (field === 'platform') {
      state.platformsInclude = [];
      state.platformsExclude = [];
      return;
    }
    if (field === 'brand') {
      state.brand = null;
      state.brandsInclude = [];
      state.brandsExclude = [];
      return;
    }
    if (field === 'color') {
      state.color = null;
      state.colorsInclude = [];
      state.colorsExclude = [];
      return;
    }
    if (field === 'size') {
      state.size = null;
      state.sizesInclude = [];
      state.sizeSystem = null;
      state.sizeMin = null;
      state.sizeMax = null;
      return;
    }
    if (field === 'sortRule') {
      state.sortRule = this.defaultState().sortRule;
      return;
    }
    if (['stockOnly', 'freeShippingOnly', 'urgentDeliveryPreferred'].includes(field)) {
      state[field] = false;
      return;
    }
    if (
      [
        'platformsInclude',
        'platformsExclude',
        'excludedProductIds',
        'excludedCandidateItemIds',
        'brandsInclude',
        'brandsExclude',
        'colorsInclude',
        'colorsExclude',
        'sizesInclude',
      ].includes(field)
    ) {
      state[field] = [];
      return;
    }
    if (field === 'preferences') {
      state.preferences = this.defaultPreferences();
      return;
    }
    if (field in state && field !== 'searchPipelineMode') state[field] = null;
  }

  private applyField(
    state: EffectiveFilterState,
    field: string,
    value: unknown,
    droppedFields: string[],
  ) {
    if (field === 'platform') {
      const platform = this.toPlatform(value);
      if (!platform) return void droppedFields.push(field);
      state.platformsInclude = [platform];
      state.platformsExclude = state.platformsExclude.filter((item) => item !== platform);
      return;
    }
    if (field === 'platformsInclude' || field === 'platformsExclude') {
      state[field] = this.toPlatformArray(value);
      return;
    }
    if (
      ['excludedProductIds', 'excludedCandidateItemIds', 'brandsInclude', 'brandsExclude', 'colorsInclude', 'colorsExclude', 'sizesInclude'].includes(field)
    ) {
      state[field] = this.toUniqueStringArray(value);
      return;
    }
    if (field === 'brand' || field === 'color' || field === 'size') {
      const scalar = this.toNullableString(value);
      state[field] = scalar;
      const arrayField = field === 'brand' ? 'brandsInclude' : field === 'color' ? 'colorsInclude' : 'sizesInclude';
      state[arrayField] = scalar ? [scalar] : [];
      return;
    }
    if (field === 'sortRule') {
      const sortRule = this.toSortRule(value);
      if (!sortRule) return void droppedFields.push(field);
      state.sortRule = sortRule;
      return;
    }
    if (field === 'categoryScope') {
      const category = normalizeProductCategoryOrNull(value);
      if (!category) return void droppedFields.push(field);
      state.categoryScope = category;
      return;
    }
    if (['stockOnly', 'freeShippingOnly', 'urgentDeliveryPreferred'].includes(field)) {
      state[field] = value === true;
      return;
    }
    if (field === 'timeConstraintDays') {
      state.timeConstraintDays = this.toNullableInteger(value);
      return;
    }
    if (field === 'sizeSystem') {
      const sizeSystem = this.toSizeSystem(value);
      if (!sizeSystem) return void droppedFields.push(field);
      state.sizeSystem = sizeSystem;
      return;
    }
    if (field === 'preferences') {
      state.preferences = this.normalizePreferences(value);
      return;
    }
    if (
      ['priceMin', 'priceMax', 'priceTarget', 'priceTolerance', 'sizeMin', 'sizeMax', 'shopType'].includes(field)
    ) {
      state[field] = this.toNullableString(value);
    }
  }

  private validateState(state: EffectiveFilterState): ConversationRejectedOperation[] {
    const rejected: ConversationRejectedOperation[] = [];
    const values = [
      ['priceMin', state.priceMin],
      ['priceMax', state.priceMax],
      ['priceTarget', state.priceTarget],
      ['priceTolerance', state.priceTolerance],
    ] as const;
    for (const [field, value] of values) {
      if (value !== null && this.toFiniteNonNegativeNumber(value) === null) {
        rejected.push({
          field,
          code: 'PRICE_VALUE_INVALID',
          message: `${field} 必须是非负有限数字。`,
          value,
        });
      }
    }
    const min = this.toFiniteNonNegativeNumber(state.priceMin);
    const max = this.toFiniteNonNegativeNumber(state.priceMax);
    if (min !== null && max !== null && min > max) {
      rejected.push({
        field: 'priceRange',
        code: 'PRICE_RANGE_CONFLICT',
        message: '最低价不能高于最高价。',
        value: { priceMin: min, priceMax: max },
      });
    }
    if (state.sizeSystem === 'EU' || (state.sizeSystem === null && (!state.categoryScope || state.categoryScope === 'shoe'))) {
      for (const size of state.sizesInclude) {
        const parsed = Number(size);
        if (!Number.isFinite(parsed) || parsed < 20 || parsed > 60 || !Number.isInteger(parsed * 2)) {
          rejected.push({
            field: 'sizesInclude',
            code: 'SIZE_VALUE_INVALID',
            message: 'EU 鞋码必须在 20 到 60 之间，且最多精确到半码。',
            value: size,
          });
        }
      }
    }
    if (state.categoryScope && state.categoryScope !== 'shoe' && state.sizesInclude.length > 0) {
      rejected.push({
        field: 'sizesInclude',
        code: 'SIZE_NOT_APPLICABLE_TO_CATEGORY',
        message: '当前类目不能使用鞋码筛选。',
        value: state.categoryScope,
      });
    }
    return rejected;
  }

  private buildDiff(
    before: EffectiveFilterState,
    after: EffectiveFilterState,
    rejected: ConversationRejectedOperation[],
  ): FilterStateDiff {
    const added: Record<string, unknown> = {};
    const changed: Record<string, { before: unknown; after: unknown }> = {};
    const removed: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (key === 'searchPipelineMode') continue;
      const left = before[key];
      const right = after[key];
      if (JSON.stringify(left) === JSON.stringify(right)) continue;
      if (this.isEmptyValue(left) && !this.isEmptyValue(right)) added[key] = right;
      else if (!this.isEmptyValue(left) && this.isEmptyValue(right)) removed[key] = left;
      else changed[key] = { before: left, after: right };
    }
    const unchanged =
      Object.keys(added).length + Object.keys(changed).length + Object.keys(removed).length === 0
        ? ['filterState']
        : [];
    return { added, changed, removed, unchanged, rejected };
  }

  private buildFilterSources(state: EffectiveFilterState, diff: FilterStateDiff) {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(state)) {
      if (!this.isEmptyValue(value)) result[key] = 'existing';
    }
    for (const key of [...Object.keys(diff.added), ...Object.keys(diff.changed)]) {
      result[key] = 'current_turn';
    }
    return result;
  }

  private defaultPreferences(): FilterPreferences {
    return {
      freeShipping: false,
      shopTypes: [],
      priceDirection: null,
      brands: [],
      colors: [],
      platforms: [],
    };
  }

  private normalizePreferences(value: unknown): FilterPreferences {
    const defaults = this.defaultPreferences();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
    const raw = value as Record<string, unknown>;
    return {
      freeShipping: raw.freeShipping === true,
      shopTypes: this.toUniqueStringArray(raw.shopTypes),
      priceDirection:
        raw.priceDirection === 'lower' || raw.priceDirection === 'higher'
          ? raw.priceDirection
          : null,
      brands: this.toUniqueStringArray(raw.brands),
      colors: this.toUniqueStringArray(raw.colors),
      platforms: this.toUniqueStringArray(raw.platforms),
    };
  }

  private toNullableString(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => this.toNullableString(item))
      .filter((item): item is string => item !== null);
  }

  private toUniqueStringArray(value: unknown) {
    return [...new Set(this.toStringArray(value))];
  }

  private toPlatformArray(value: unknown) {
    return normalizePlatformFilterValues(value);
  }

  private toPlatform(value: unknown) {
    return normalizePlatformKey(value);
  }

  private toSortRule(value: unknown) {
    const sortRule = this.toNullableString(value);
    return sortRule && SORT_RULE_VALUES.has(sortRule) ? sortRule : null;
  }

  private toSearchPipelineMode(value: unknown): ProductSearchPipelineMode | null {
    const mode = this.toNullableString(value);
    return mode && PRODUCT_SEARCH_PIPELINE_MODES.includes(mode as ProductSearchPipelineMode)
      ? (mode as ProductSearchPipelineMode)
      : null;
  }

  private toNullableInteger(value: unknown) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isInteger(parsed) ? parsed : null;
    }
    return null;
  }

  private toSizeSystem(value: unknown): EffectiveFilterState['sizeSystem'] {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toUpperCase();
    return ['EU', 'US', 'UK', 'CN'].includes(normalized)
      ? (normalized as EffectiveFilterState['sizeSystem'])
      : null;
  }

  private toFiniteNonNegativeNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  private isEmptyValue(value: unknown): boolean {
    if (value === null || value === undefined || value === false || value === '') return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') {
      return Object.values(value as Record<string, unknown>).every((item) => this.isEmptyValue(item));
    }
    return false;
  }

  private includesInsensitive(values: string[], target: string) {
    const normalized = target.trim().toLowerCase();
    return values.some((value) => value.trim().toLowerCase() === normalized);
  }
}
