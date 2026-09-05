export const PLATFORM_FILTER_VALUES = [
  "taobao",
  "tmall",
  "jd",
  "vipshop",
  "suning",
  "dewu",
  "pdd",
  "douyin",
  "xianyu",
  "manual",
] as const;

export type PlatformFilterValue = (typeof PLATFORM_FILTER_VALUES)[number];

const PLATFORM_VALUE_SET = new Set<string>(PLATFORM_FILTER_VALUES);

const PLATFORM_ALIASES: Array<[PlatformFilterValue, RegExp]> = [
  ["taobao", /淘宝|淘保|掏宝|tao\s*bao|taobao|\btb\b/i],
  ["tmall", /天猫|添猫|tmall|t\s*mall|\btm\b/i],
  ["jd", /京东|京冬|jing\s*dong|jingdong|\bjd\b/i],
  ["vipshop", /唯品会|唯品|vip\s*shop|vipshop/i],
  ["suning", /苏宁|苏宁易购|suning/i],
  ["dewu", /得物|得务|毒\s*(?:app)?|de\s*wu|dewu/i],
  ["pdd", /拼多多|拼夕夕|拼多|p\s*dd|pdd|pin\s*duo\s*duo/i],
  ["douyin", /抖音|抖荫|dou\s*yin|douyin|\bdy\b|tik\s*tok|tiktok/i],
  ["xianyu", /闲鱼|咸鱼|鲜鱼|先鱼|xian\s*yu|xianyu/i],
  ["manual", /manual|本地|手动/i],
];

const SECOND_HAND_EXCLUSION_PATTERN =
  /(?:不要|不看|别要|别看|排除|去掉|剔除|过滤掉|屏蔽|不想要|不接受|拒绝|exclude|remove|without|avoid|no\s+).{0,8}(?:二手|旧货|闲置|转卖|used|pre[-\s]?owned|second[-\s]?hand)|(?:二手|旧货|闲置|转卖|used|pre[-\s]?owned|second[-\s]?hand).{0,8}(?:不要|不看|别要|别看|排除|去掉|剔除|过滤掉|屏蔽|不想要|不接受|拒绝|exclude|remove|without|avoid)|(?:只要|只看|仅看|必须|想要|prefer|only).{0,8}(?:全新|新品|一手)|(?:全新|新品|一手).{0,8}(?:即可|就行|优先|only|preferred)/i;

const PLATFORM_LABELS: Record<PlatformFilterValue, string> = {
  taobao: "淘宝",
  tmall: "天猫",
  jd: "京东",
  vipshop: "唯品会",
  suning: "苏宁",
  dewu: "得物",
  pdd: "拼多多",
  douyin: "抖音",
  xianyu: "闲鱼",
  manual: "手动",
};

export function normalizePlatformKey(value: unknown): PlatformFilterValue | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  if (PLATFORM_VALUE_SET.has(normalized)) {
    return normalized as PlatformFilterValue;
  }
  for (const [platform, pattern] of PLATFORM_ALIASES) {
    if (pattern.test(trimmed)) return platform;
  }
  return null;
}

export function platformComparisonKey(value: unknown): string | null {
  const platform = normalizePlatformKey(value);
  if (platform) return platform;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().toLowerCase()
    : null;
}

export function normalizePlatformFilterValues(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => normalizePlatformKey(item))
        .filter((item): item is PlatformFilterValue => item !== null),
    ),
  ];
}

export function extractMentionedPlatforms(message: string) {
  const platforms: PlatformFilterValue[] = [];
  for (const [platform, pattern] of PLATFORM_ALIASES) {
    if (platform === "manual") continue;
    if (pattern.test(message) && !platforms.includes(platform)) {
      platforms.push(platform);
    }
  }
  return platforms;
}

export function isPlatformExclusionMessage(message: string) {
  return /不看|别看|不要|别要|排除|去掉|剔除|过滤掉|屏蔽|exclude|remove|without|not\s+(?:show|see|include)|no\s+/i.test(
    message,
  );
}

export function isSecondHandPlatformExclusionMessage(message: string) {
  return SECOND_HAND_EXCLUSION_PATTERN.test(message);
}

export function extractPlatformFilterPatch(message: string) {
  const platforms = extractMentionedPlatforms(message);
  const excludePlatforms = isPlatformExclusionMessage(message)
    ? [...platforms]
    : [];
  const includePlatforms = isPlatformExclusionMessage(message)
    ? []
    : [...platforms];

  if (isSecondHandPlatformExclusionMessage(message)) {
    excludePlatforms.push("xianyu");
  }

  const platformsExclude = [...new Set(excludePlatforms)];
  const platformsInclude = [...new Set(includePlatforms)].filter(
    (platform) => !platformsExclude.includes(platform),
  );

  const patch: {
    platformsInclude?: PlatformFilterValue[];
    platformsExclude?: PlatformFilterValue[];
  } = {};
  if (platformsInclude.length > 0) patch.platformsInclude = platformsInclude;
  if (platformsExclude.length > 0) patch.platformsExclude = platformsExclude;
  return patch;
}

export function displayPlatformLabel(value: unknown) {
  const platform = normalizePlatformKey(value);
  if (platform) return PLATFORM_LABELS[platform];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "平台";
}
