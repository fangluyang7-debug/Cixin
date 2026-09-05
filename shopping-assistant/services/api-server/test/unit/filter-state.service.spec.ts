import { ConversationTurnParseResult } from '../../src/adapters/model/model-adapter.interface';
import { FilterStateService } from '../../src/modules/conversation/application/filter-state.service';

function parsed(
  patch: Record<string, unknown>,
  remove: string[] = [],
): ConversationTurnParseResult {
  return {
    intent: 'refine_filter',
    filterPatch: patch,
    filterRemove: remove,
    shouldResetPreviousFilters: false,
    assistantMessage: '已更新筛选。',
    confidence: 1,
    raw: {},
  };
}

describe('FilterStateService', () => {
  const service = new FilterStateService();
  const meta = {
    promptVersion: 'test',
    schemaVersion: 'test',
    outputSchemaVersion: 'test',
  };

  it('preserves unrelated filters when one condition changes', () => {
    const current = service.normalizeState({
      priceMax: '800',
      platformsInclude: ['jd'],
      stockOnly: true,
      brand: 'Nike',
    });

    const result = service.merge(current, parsed({ priceMax: '500' }), meta);

    expect(result.effectiveFilter).toMatchObject({
      priceMax: '500',
      platformsInclude: ['jd'],
      stockOnly: true,
      brand: 'Nike',
    });
  });

  it('removes a filter without resetting the remaining state', () => {
    const current = service.normalizeState({
      priceMax: '500',
      platformsInclude: ['taobao'],
      stockOnly: true,
    });

    const result = service.merge(current, parsed({}, ['stockOnly']), meta);

    expect(result.effectiveFilter.stockOnly).toBe(false);
    expect(result.effectiveFilter.priceMax).toBe('500');
    expect(result.effectiveFilter.platformsInclude).toEqual(['taobao']);
  });

  it('drops unsupported fields instead of persisting them', () => {
    const result = service.merge(
      service.defaultState(),
      parsed({ unknownFilter: 'unsafe', priceMax: '600' }),
      meta,
    );

    expect(result.droppedFields).toEqual(['unknownFilter']);
    expect(result.effectiveFilter.priceMax).toBe('600');
    expect(result.effectiveFilter).not.toHaveProperty('unknownFilter');
  });

  it('keeps the pipeline mode immutable to natural-language patches', () => {
    const current = service.normalizeState({ searchPipelineMode: 'light_tag_ann_fusion' });
    const result = service.merge(
      current,
      parsed({ searchPipelineMode: 'current_ann_then_refine', priceMax: '500' }),
      meta,
    );
    expect(result.effectiveFilter.searchPipelineMode).toBe('light_tag_ann_fusion');
    expect(result.droppedFields).toContain('searchPipelineMode');
  });

  it('normalizes legacy scalar filters to v2 arrays', () => {
    const state = service.normalizeState({ brand: 'Nike', color: 'black', size: '42' });
    expect(state.brandsInclude).toEqual(['Nike']);
    expect(state.colorsInclude).toEqual(['black']);
    expect(state.sizesInclude).toEqual(['42']);
  });

  it('supports include/exclude arrays and produces a real diff', () => {
    const result = service.merge(
      service.defaultState(),
      parsed({
        brandsInclude: ['Nike', 'Adidas'],
        brandsExclude: ['Puma'],
        colorsInclude: ['black', 'white'],
      }),
      meta,
    );
    expect(result.effectiveFilter.brandsInclude).toEqual(['Nike', 'Adidas']);
    expect(result.effectiveFilter.brandsExclude).toEqual(['Puma']);
    expect(result.filterDiff.added).toMatchObject({
      brandsInclude: ['Nike', 'Adidas'],
      brandsExclude: ['Puma'],
    });
  });

  it('rejects contradictory price ranges without changing state', () => {
    const current = service.normalizeState({ priceMax: '800' });
    const result = service.merge(current, parsed({ priceMin: '1000', priceMax: '500' }), meta);
    expect(result.effectiveFilter.priceMax).toBe('800');
    expect(result.effectiveFilter.priceMin).toBeNull();
    expect(result.rejectedOperations[0].code).toBe('PRICE_RANGE_CONFLICT');
    expect(result.filterDiff.unchanged).toEqual(['filterState']);
  });

  it('rejects shoe sizes on non-shoe categories', () => {
    const result = service.merge(
      service.defaultState(),
      parsed({ categoryScope: 'phone', sizesInclude: ['42'], sizeSystem: 'EU' }),
      meta,
    );
    expect(result.rejectedOperations[0].code).toBe('SIZE_NOT_APPLICABLE_TO_CATEGORY');
    expect(result.effectiveFilter.categoryScope).toBeNull();
  });

  it('keeps soft preferences separate from hard filters', () => {
    const result = service.merge(
      service.defaultState(),
      parsed({ preferences: { freeShipping: true, priceDirection: 'lower' } }),
      meta,
    );
    expect(result.effectiveFilter.freeShippingOnly).toBe(false);
    expect(result.effectiveFilter.preferences).toMatchObject({
      freeShipping: true,
      priceDirection: 'lower',
    });
  });
});
