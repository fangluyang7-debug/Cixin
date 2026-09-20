import { TurnsService } from '../../src/modules/turns/application/turns.service';

describe('conversation category switching', () => {
  it('uses the selected final category and clears product-specific state', () => {
    const service = Object.create(TurnsService.prototype) as Record<string, any>;
    const filter: Record<string, unknown> = {
      categoryScope: 'phone',
      brandsInclude: ['Nike'],
      colorsInclude: ['black'],
      sizesInclude: ['42'],
      sizeSystem: 'EU',
    };
    const baseProfile = {
      category: 'shoe',
      brand: 'Nike',
      modelLine: null,
      colorFamily: 'black',
      colorway: null,
      shoeType: 'running',
      size: '42',
      color: 'black',
      styleTags: [],
      sceneTags: [],
      keywords: ['跑鞋'],
      confidence: 0.9,
      raw: {},
    };

    service.applyCategoryChangeToFilter(
      filter,
      '鞋不看了，换手机',
      baseProfile,
    );
    const profile = service.buildTurnSearchProfile(
      baseProfile,
      '鞋不看了，换手机',
      filter,
      {
        intent: 'refine_filter',
        filterPatch: { categoryScope: 'phone' },
        filterRemove: [],
        shouldResetPreviousFilters: false,
        assistantMessage: '',
        confidence: 1,
        raw: {},
      },
    );

    expect(filter).toEqual(
      expect.objectContaining({
        categoryScope: 'phone',
        brandsInclude: [],
        colorsInclude: [],
        sizesInclude: [],
        sizeSystem: null,
      }),
    );
    expect(profile).toEqual(
      expect.objectContaining({
        category: 'phone',
        brand: null,
        color: null,
        size: null,
        shoeType: null,
      }),
    );
  });
});
