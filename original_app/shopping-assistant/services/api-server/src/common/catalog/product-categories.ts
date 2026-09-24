export interface ProductCategoryDefinition {
  key: string;
  group: string;
  labelZh: string;
  labelEn: string;
  aliases: readonly string[];
  classifierHints: readonly string[];
  detectionClasses: readonly string[];
  keywords: readonly string[];
}

export const DEFAULT_PRODUCT_CATEGORY = 'general';

export const PRODUCT_CATEGORY_DEFINITIONS = [
  {
    key: 'shoe',
    group: 'footwear',
    labelZh: '鞋',
    labelEn: 'Shoes',
    aliases: [
      'shoe',
      'shoes',
      'sneaker',
      'sneakers',
      'boot',
      'boots',
      'sandal',
      'running_shoes',
      'basketball_shoes',
      'lifestyle_shoes',
      'training_shoes',
      'skate_shoes',
      'football_shoes',
      'unknown_shoes',
      '鞋',
      '鞋子',
      '运动鞋',
      '跑鞋',
      '篮球鞋',
      '板鞋',
      '休闲鞋',
    ],
    classifierHints: ['shoe', 'sneaker', 'boot', 'sandal', '鞋', '运动鞋', '跑鞋'],
    detectionClasses: ['shoe', 'sneaker', 'boot', 'sandal'],
    keywords: ['shoe', 'sneaker', '鞋'],
  },
  {
    key: 'camera',
    group: 'digital',
    labelZh: '相机',
    labelEn: 'Camera',
    aliases: ['camera', 'digital_camera', 'dslr', 'mirrorless', '相机', '数码相机', '单反', '微单'],
    classifierHints: ['camera', 'digital camera', 'DSLR', 'mirrorless camera', '相机', '数码相机'],
    detectionClasses: ['camera'],
    keywords: ['camera', '相机'],
  },
  {
    key: 'apparel',
    group: 'apparel',
    labelZh: '服饰',
    labelEn: 'Apparel',
    aliases: [
      'apparel',
      'clothing',
      'clothes',
      'garment',
      'shirt',
      'tshirt',
      't-shirt',
      'pants',
      'jacket',
      'coat',
      'dress',
      'workwear',
      'uniform',
      '服饰',
      '服装',
      '衣服',
      '上衣',
      '裤子',
      '外套',
      '工装',
    ],
    classifierHints: ['apparel', 'clothing', 'shirt', 'pants', 'jacket', 'coat', 'dress', 'workwear', '服饰', '服装'],
    detectionClasses: ['clothing', 'shirt', 't-shirt', 'pants', 'jacket', 'coat', 'dress', 'uniform'],
    keywords: ['apparel', 'clothing', 'garment', '服饰', '服装'],
  },
  {
    key: 'food',
    group: 'grocery',
    labelZh: '食品',
    labelEn: 'Food',
    aliases: [
      'food',
      'grocery',
      'snack',
      'snacks',
      'drink',
      'beverage',
      'tea',
      'coffee',
      'milk',
      'fruit',
      'vegetable',
      'fresh_food',
      '食品',
      '食物',
      '零食',
      '饮料',
      '生鲜',
      '水果',
    ],
    classifierHints: ['food', 'grocery', 'snack', 'drink', 'beverage', 'fresh food', '食品', '零食', '饮料'],
    detectionClasses: ['food', 'snack', 'drink', 'beverage', 'bottle', 'can', 'box', 'package'],
    keywords: ['food', 'grocery', 'snack', '食品', '零食'],
  },
  {
    key: 'home_appliance',
    group: 'home',
    labelZh: '\u5bb6\u7535',
    labelEn: 'Home appliance',
    aliases: [
      'home_appliance',
      'home_appliances',
      'appliance',
      'appliances',
      'household_appliance',
      'fridge',
      'refrigerator',
      'washer',
      'washing_machine',
      'air_conditioner',
      'television',
      'tv',
      'microwave',
      'vacuum',
      '\u5bb6\u7535',
      '\u7535\u5668',
      '\u51b0\u7bb1',
      '\u6d17\u8863\u673a',
      '\u7a7a\u8c03',
      '\u7535\u89c6',
      '\u70ed\u6c34\u5668',
      '\u5438\u5c18\u5668',
    ],
    classifierHints: [
      'home appliance',
      'household appliance',
      'fridge',
      'washing machine',
      'air conditioner',
      'television',
      '\u5bb6\u7535',
      '\u7535\u5668',
    ],
    detectionClasses: [
      'appliance',
      'refrigerator',
      'washing machine',
      'air conditioner',
      'television',
      'microwave',
      'vacuum cleaner',
    ],
    keywords: ['home appliance', 'appliance', '\u5bb6\u7535', '\u7535\u5668'],
  },
  {
    key: 'headphones',
    group: 'digital',
    labelZh: '耳机',
    labelEn: 'Headphones',
    aliases: ['headphones', 'headphone', 'earphones', 'earphone', 'earbuds', 'headset', '耳机', '耳麦', '蓝牙耳机'],
    classifierHints: ['headphones', 'earphones', 'earbuds', 'headset', '耳机', '蓝牙耳机'],
    detectionClasses: ['headphones', 'earphones', 'earbuds', 'headset'],
    keywords: ['headphones', 'earphones', '耳机'],
  },
  {
    key: 'smartwatch',
    group: 'digital',
    labelZh: '数码手表',
    labelEn: 'Smartwatch',
    aliases: ['smartwatch', 'smart_watch', 'digital_watch', 'watch', '智能手表', '数码手表', '电子手表', '手表'],
    classifierHints: ['smartwatch', 'digital watch', 'smart watch', '智能手表', '数码手表'],
    detectionClasses: ['watch', 'smartwatch'],
    keywords: ['smartwatch', 'watch', '智能手表'],
  },
  {
    key: 'phone',
    group: 'digital',
    labelZh: '手机',
    labelEn: 'Phone',
    aliases: ['phone', 'smartphone', 'mobile_phone', 'cellphone', 'iphone', 'android_phone', '手机', '智能手机'],
    classifierHints: ['phone', 'smartphone', 'mobile phone', 'iPhone', '手机', '智能手机'],
    detectionClasses: ['cell phone', 'mobile phone', 'smartphone'],
    keywords: ['phone', 'smartphone', '手机'],
  },
  {
    key: 'computer',
    group: 'digital',
    labelZh: '电脑',
    labelEn: 'Computer',
    aliases: ['computer', 'laptop', 'notebook', 'desktop', 'pc', '电脑', '笔记本', '笔记本电脑', '游戏本', '本子', '台式机'],
    classifierHints: ['computer', 'laptop', 'notebook computer', 'desktop PC', '电脑', '笔记本电脑'],
    detectionClasses: ['laptop', 'computer', 'keyboard monitor'],
    keywords: ['computer', 'laptop', '电脑'],
  },
  {
    key: 'tablet',
    group: 'digital',
    labelZh: '平板',
    labelEn: 'Tablet',
    aliases: ['tablet', 'tablet_computer', 'ipad', 'pad', '平板', '平板电脑'],
    classifierHints: ['tablet', 'tablet computer', 'iPad', '平板', '平板电脑'],
    detectionClasses: ['tablet', 'tablet computer'],
    keywords: ['tablet', 'ipad', '平板'],
  },
  {
    key: 'keyboard',
    group: 'digital',
    labelZh: '键盘',
    labelEn: 'Keyboard',
    aliases: ['keyboard', 'mechanical_keyboard', '键盘', '机械键盘'],
    classifierHints: ['keyboard', 'mechanical keyboard', '键盘', '机械键盘'],
    detectionClasses: ['keyboard', 'computer keyboard'],
    keywords: ['keyboard', '键盘'],
  },
  {
    key: 'mouse',
    group: 'digital',
    labelZh: '鼠标',
    labelEn: 'Mouse',
    aliases: ['mouse', 'computer_mouse', 'wireless_mouse', '鼠标', '无线鼠标'],
    classifierHints: ['computer mouse', 'wireless mouse', 'mouse', '鼠标'],
    detectionClasses: ['computer mouse', 'mouse'],
    keywords: ['mouse', '鼠标'],
  },
  {
    key: 'digital_other',
    group: 'digital',
    labelZh: '其他数码产品',
    labelEn: 'Other digital product',
    aliases: ['digital_other', 'other_digital', 'electronics', 'digital_product', '数码产品', '其他数码产品', '其他电子产品'],
    classifierHints: ['other digital product', 'electronics', 'digital accessory', '其他数码产品'],
    detectionClasses: ['electronics', 'digital device'],
    keywords: ['electronics', 'digital product', '数码产品'],
  },
  {
    key: 'general',
    group: 'general',
    labelZh: '综合商品',
    labelEn: 'General merchandise',
    aliases: [
      'general',
      'general_merchandise',
      'misc',
      'miscellaneous',
      'other',
      'household',
      'home_goods',
      'daily_goods',
      'commodity',
      '综合商品',
      '通用商品',
      '日用品',
      '百货',
      '其他',
    ],
    classifierHints: ['general merchandise', 'household goods', 'daily goods', 'other product', '综合商品', '日用品', '百货'],
    detectionClasses: ['product', 'object', 'package', 'box', 'bottle', 'container'],
    keywords: ['general merchandise', 'product', 'daily goods', '综合商品', '百货'],
  },
] as const satisfies readonly ProductCategoryDefinition[];

export type ProductCategoryKey =
  (typeof PRODUCT_CATEGORY_DEFINITIONS)[number]['key'];

const CATEGORY_BY_KEY = new Map(
  PRODUCT_CATEGORY_DEFINITIONS.map((category) => [category.key, category]),
);

const CATEGORY_ALIAS_LOOKUP = new Map<string, ProductCategoryKey>();
for (const category of PRODUCT_CATEGORY_DEFINITIONS) {
  CATEGORY_ALIAS_LOOKUP.set(normalizeCategoryToken(category.key), category.key);
  for (const alias of category.aliases) {
    CATEGORY_ALIAS_LOOKUP.set(normalizeCategoryToken(alias), category.key);
  }
}

export function getProductCategoryDefinition(
  category: unknown,
): ProductCategoryDefinition {
  return (
    CATEGORY_BY_KEY.get(normalizeProductCategory(category)) ??
    CATEGORY_BY_KEY.get(DEFAULT_PRODUCT_CATEGORY)!
  );
}

export function normalizeProductCategory(
  value: unknown,
  fallback: unknown = DEFAULT_PRODUCT_CATEGORY,
): ProductCategoryKey {
  return (
    normalizeProductCategoryOrNull(value) ??
    normalizeProductCategoryOrNull(fallback) ??
    DEFAULT_PRODUCT_CATEGORY
  );
}

export function normalizeProductCategoryOrNull(
  value: unknown,
): ProductCategoryKey | null {
  const token = normalizeCategoryToken(value);
  if (!token) return null;

  const exact = CATEGORY_ALIAS_LOOKUP.get(token);
  if (exact) return exact;

  for (const [alias, category] of CATEGORY_ALIAS_LOOKUP.entries()) {
    if (
      (alias.length >= 2 || isSingleCjkCategoryAlias(alias)) &&
      token.includes(alias)
    ) {
      return category;
    }
  }
  return null;
}

export function productCategoryMatches(
  value: unknown,
  expectedCategory: unknown,
) {
  const normalizedValue = normalizeProductCategoryOrNull(value);
  const normalizedExpected = normalizeProductCategoryOrNull(expectedCategory);
  return Boolean(
    normalizedValue &&
      normalizedExpected &&
      normalizedValue === normalizedExpected,
  );
}

export function productCategoryKeywords(category: unknown): string[] {
  return [...getProductCategoryDefinition(category).keywords];
}

export function productCategoryClassifierCatalog() {
  return PRODUCT_CATEGORY_DEFINITIONS.map((category) => ({
    key: category.key,
    group: category.group,
    labelZh: category.labelZh,
    labelEn: category.labelEn,
    hints: category.classifierHints,
  }));
}

export function productCategoryDetectionClasses() {
  return [
    ...new Set(
      PRODUCT_CATEGORY_DEFINITIONS.flatMap((category) => category.detectionClasses),
    ),
  ];
}

function normalizeCategoryToken(value: unknown) {
  return typeof value === 'string'
    ? value
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, '')
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '')
    : '';
}

function isSingleCjkCategoryAlias(token: string) {
  return token.length === 1 && /[\u3400-\u9fff]/u.test(token);
}
