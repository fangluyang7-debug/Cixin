import {
  analyzeShoppingLanguage,
  normalizeUserShoppingText,
} from '../../src/common/shopping/shopping-language-analyzer';

describe('shopping language analyzer', () => {
  it.each([
    ['不买了', 'conversation'],
    ['我不是要买鞋，只是问问怎么保养', 'conversation'],
    ['别给我推荐鞋', 'conversation'],
    ["I don't want shoes", 'conversation'],
    ['推荐一下', 'clarification'],
    ['鞋', 'clarification'],
    ['买啥都行', 'clarification'],
    ['500以下', 'clarification'],
    ['只看京东', 'clarification'],
    ['预算不限', 'clarification'],
    ['想整个通勤用的头戴式耳机', 'search'],
    ['AirPods Pro 二代哪里便宜', 'search'],
    ['我想买一双耐克跑鞋', 'search'],
  ] as const)('routes %s to %s', (input, route) => {
    expect(analyzeShoppingLanguage(input).route).toBe(route);
  });

  it('normalizes full-width and zero-width characters', () => {
    expect(normalizeUserShoppingText('  Ｊ\u200bＤ　')).toBe('JD');
    expect(analyzeShoppingLanguage('只看京\u200b东').filterPatch).toEqual({
      platformsInclude: ['jd'],
    });
  });

  it.each([
    ['奈克跑斜', 'shoe'],
    ['耐克谢', 'shoe'],
    ['手鸡', 'phone'],
    ['耳鸡', 'headphones'],
    ['wo xiang mai nai ke xie', 'shoe'],
  ])('corrects %s to category %s', (input, category) => {
    const result = analyzeShoppingLanguage(input);
    expect(result.categoryMentions).toContain(category);
  });

  it('keeps platform negation scoped to each clause', () => {
    expect(analyzeShoppingLanguage('京东可以，淘宝不要').filterPatch).toEqual({
      platformsInclude: ['jd'],
      platformsExclude: ['taobao'],
    });
  });

  it('handles emoji clause boundaries and controlled traditional/typo aliases', () => {
    expect(analyzeShoppingLanguage('不看淘宝🙂只看京東').filterPatch).toEqual({
      platformsInclude: ['jd'],
      platformsExclude: ['taobao'],
    });
    expect(analyzeShoppingLanguage('不看咸渔').filterPatch.platformsExclude).toEqual([
      'xianyu',
    ]);
  });

  it('clears platform scope and rejects a self-contradictory platform request', () => {
    expect(analyzeShoppingLanguage('平台无所谓').filterRemove).toEqual(
      expect.arrayContaining(['platformsInclude', 'platformsExclude']),
    );
    expect(
      analyzeShoppingLanguage('只看京东，但又不要京东').rejectedOperations[0].code,
    ).toBe('PLATFORM_SCOPE_CONFLICT');
  });

  it('supports multi-value and exclusion filters', () => {
    expect(analyzeShoppingLanguage('耐克或者阿迪都可以').filterPatch.brandsInclude).toEqual([
      'Nike',
      'Adidas',
    ]);
    expect(analyzeShoppingLanguage('黑色或者白色都可以').filterPatch.colorsInclude).toEqual([
      'white',
      'black',
    ]);
    expect(analyzeShoppingLanguage('除了黑色').filterPatch.colorsExclude).toEqual(['black']);
  });

  it('clears filter and recognized profile tags explicitly', () => {
    const brand = analyzeShoppingLanguage('品牌不限');
    expect(brand.filterRemove).toEqual(
      expect.arrayContaining(['brand', 'brandsInclude', 'brandsExclude']),
    );
    expect(brand.profileRemove).toContain('brand');
    const color = analyzeShoppingLanguage('颜色随便');
    expect(color.profileRemove).toContain('color');
  });

  const priceCases = Array.from({ length: 10 }, (_, index) => (index + 1) * 100).flatMap(
    (value) => [
      [`${value}元以内`, String(value)],
      [`预算${value}`, String(value)],
      [`不超过${value}`, String(value)],
      [`${value}以下`, String(value)],
      [`最高${value}`, String(value)],
    ] as Array<[string, string]>,
  );

  it.each(priceCases)('parses price ceiling %s', (input, expected) => {
    expect(analyzeShoppingLanguage(input).filterPatch.priceMax).toBe(expected);
  });

  it.each([
    ['300到500', '300', '500'],
    ['300-500', '300', '500'],
    ['1,500元以内', undefined, '1500'],
    ['五百以内', undefined, '500'],
    ['至少500但不超过1000', '500', '1000'],
    ['不要500以上的', undefined, '500'],
    ['预算不是500，是800', undefined, '800'],
    ['五百块钱一下', undefined, '500'],
  ])('parses complex price %s', (input, min, max) => {
    const patch = analyzeShoppingLanguage(input).filterPatch;
    expect(patch.priceMin).toBe(min);
    expect(patch.priceMax).toBe(max);
  });

  it('applies relative price changes from current state', () => {
    expect(
      analyzeShoppingLanguage('预算加200', {
        effectiveFilter: { priceMax: '500' },
        candidateSummary: [],
        productProfile: null,
      }).filterPatch.priceMax,
    ).toBe('700');
  });

  it('rejects relative price without a baseline', () => {
    expect(analyzeShoppingLanguage('预算加200').rejectedOperations[0].code).toBe(
      'PRICE_DELTA_BASE_REQUIRED',
    );
  });

  it.each([
    ['42码', ['42']],
    ['42.5码', ['42.5']],
    ['EU42', ['42']],
    ['39到40码', ['39', '39.5', '40']],
    ['四十二码', ['42']],
  ])('parses size %s', (input, sizes) => {
    expect(analyzeShoppingLanguage(input).filterPatch.sizesInclude).toEqual(sizes);
  });

  it('does not treat price ranges as shoe-size ranges', () => {
    const result = analyzeShoppingLanguage('300到500元');
    expect(result.filterPatch).toEqual({ priceMin: '300', priceMax: '500' });
    expect(result.rejectedOperations).toEqual([]);
  });

  it('normalizes digits separated by speech-to-text spaces', () => {
    expect(analyzeShoppingLanguage('5 0 0元以下').filterPatch.priceMax).toBe('500');
  });

  it('marks previous-filter restoration separately from full reset', () => {
    const result = analyzeShoppingLanguage('撤销刚才的筛选');
    expect(result.shouldRestorePreviousFilter).toBe(true);
    expect(result.shouldResetPreviousFilters).toBe(false);
  });

  it('applies relative shoe size', () => {
    expect(
      analyzeShoppingLanguage('换大一码', {
        effectiveFilter: { sizesInclude: ['42'], sizeSystem: 'EU', categoryScope: 'shoe' },
        candidateSummary: [],
        productProfile: null,
      }).filterPatch.sizesInclude,
    ).toEqual(['43']);
  });

  it('requires clarification for multiple categories', () => {
    const result = analyzeShoppingLanguage('电脑和手机都想看');
    expect(result.route).toBe('clarification');
    expect(result.rejectedOperations[0].code).toBe(
      'MULTI_CATEGORY_REQUIRES_CLARIFICATION',
    );
  });

  it('uses the final positive category during a switch', () => {
    expect(analyzeShoppingLanguage('鞋不看了，换手机').filterPatch.categoryScope).toBe('phone');
  });

  it('resolves candidate references without falling back to the first item', () => {
    const result = analyzeShoppingLanguage('第二个怎么样', {
      effectiveFilter: {},
      productProfile: null,
      candidateSummary: [
        { candidateItemId: 'c1', productId: 'p1', title: '第一项', platformName: '京东', amount: '100', currency: 'CNY', stockStatus: 'in_stock', matchSummary: {} },
        { candidateItemId: 'c2', productId: 'p2', title: '第二项', platformName: '淘宝', amount: '200', currency: 'CNY', stockStatus: 'in_stock', matchSummary: {} },
      ],
    });
    expect(result.candidateRefs).toEqual([
      expect.objectContaining({ candidateItemId: 'c2', ordinal: 2, title: '第二项' }),
    ]);
  });

  it('separates soft preferences from hard filters', () => {
    const soft = analyzeShoppingLanguage('包邮优先，不是必须').filterPatch;
    expect(soft.freeShippingOnly).toBeUndefined();
    expect(soft.preferences).toEqual(expect.objectContaining({ freeShipping: true }));
    expect(analyzeShoppingLanguage('必须包邮').filterPatch.freeShippingOnly).toBe(true);
  });

  it('handles stock and shipping double-negation deterministically', () => {
    expect(analyzeShoppingLanguage('不要没货的').filterPatch.stockOnly).toBe(true);
    expect(analyzeShoppingLanguage('不要邮费').filterPatch.freeShippingOnly).toBe(true);
    expect(analyzeShoppingLanguage('不要求有货').filterRemove).toContain('stockOnly');
  });

  it('does not treat new-arrival sorting as a second-hand platform exclusion', () => {
    expect(analyzeShoppingLanguage('新品优先').filterPatch.platformsExclude).toBeUndefined();
    expect(analyzeShoppingLanguage('只要全新的').filterPatch.platformsExclude).toEqual([
      'xianyu',
    ]);
  });
});
