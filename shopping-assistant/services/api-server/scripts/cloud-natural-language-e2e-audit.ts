import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  boundaryCases,
  ExpectedTurn,
  initialCases,
  turnCases,
} from "./natural-language-robustness-audit";

type JsonRecord = Record<string, unknown>;

type ApiResponse = {
  status: number;
  elapsedMs: number;
  body: JsonRecord;
  raw: string;
};

type CloudAuditResult = {
  id: string;
  layer: "initial" | "turn" | "workflow" | "state" | "boundary";
  area: string;
  input: string;
  expected: JsonRecord;
  actual: JsonRecord;
  passed: boolean;
  failures: string[];
};

type StateCase = {
  id: string;
  area: string;
  input: string;
  validate: (data: JsonRecord) => string[];
  expected: JsonRecord;
};

type WorkflowCase = {
  id: string;
  area: string;
  initial: string;
  setupTurns?: string[];
  target: string;
  expected: JsonRecord;
  validate: (actual: JsonRecord) => string[];
};

const DEFAULT_BASE_URL = "https://apiserver.zeabur.app";
const REQUEST_TIMEOUT_MS = 60_000;
const ALLOWED_PLATFORMS = new Set([
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
]);

const stateCases: StateCase[] = [
  {
    id: "S01",
    area: "非法负价格",
    input: "我想买最高-1元的鞋",
    expected: { priceMax: "non-negative numeric or null" },
    validate: (data) => validatePrice(data, "priceMax", { nonNegative: true }),
  },
  {
    id: "S02",
    area: "非法文本价格",
    input: "我想买预算便宜的鞋",
    expected: { priceMax: "numeric or null" },
    validate: (data) => validatePrice(data, "priceMax"),
  },
  {
    id: "S03",
    area: "矛盾价格范围",
    input: "我想买至少1000但不要超过500的鞋",
    expected: { priceRange: "priceMin <= priceMax or clarification" },
    validate: (data) => {
      const filter = effectiveFilter(data);
      const min = toNumberOrNull(filter.priceMin);
      const max = toNumberOrNull(filter.priceMax);
      return min !== null && max !== null && min > max
        ? [`priceMin=${min} is greater than priceMax=${max}`]
        : [];
    },
  },
  {
    id: "S04",
    area: "非法尺码",
    input: "我想买尺码随便写的鞋",
    expected: { size: "recognized size or null" },
    validate: (data) => {
      const size = effectiveFilter(data).size;
      return typeof size === "string" && size === "随便写"
        ? ["invalid free-text size was persisted"]
        : [];
    },
  },
  {
    id: "S05",
    area: "平台冲突消解",
    input: "我想买鞋，只看京东又不看京东",
    expected: { platformOverlap: false },
    validate: (data) => {
      const filter = effectiveFilter(data);
      const included = toStringArray(filter.platformsInclude);
      const excluded = new Set(toStringArray(filter.platformsExclude));
      const overlap = included.filter((item) => excluded.has(item));
      return overlap.length > 0 ? [`platform overlap: ${overlap.join(",")}`] : [];
    },
  },
  {
    id: "S06",
    area: "未知平台",
    input: "我想买Amazon上的鞋",
    expected: { platforms: "known normalized values only" },
    validate: (data) => {
      const filter = effectiveFilter(data);
      const platforms = [
        ...toStringArray(filter.platformsInclude),
        ...toStringArray(filter.platformsExclude),
      ];
      return platforms.filter((item) => !ALLOWED_PLATFORMS.has(item)).map(
        (item) => `unknown platform persisted: ${item}`,
      );
    },
  },
];

const workflowCases: WorkflowCase[] = [
  {
    id: "W01",
    area: "受控取消价格",
    initial: "我想买500元以下的耐克跑鞋",
    target: "价格不限",
    expected: { priceMax: null },
    validate: (actual) => expectEffectiveAbsent(actual, "priceMax"),
  },
  {
    id: "W02",
    area: "受控取消品牌",
    initial: "我想买耐克跑鞋",
    target: "品牌不限",
    expected: { brand: null },
    validate: (actual) => expectEffectiveAbsent(actual, "brand"),
  },
  {
    id: "W03",
    area: "受控取消颜色",
    initial: "我想买黑色跑鞋",
    target: "颜色随便",
    expected: { color: null },
    validate: (actual) => expectEffectiveAbsent(actual, "color"),
  },
  {
    id: "W04",
    area: "受控取消平台",
    initial: "我想买京东上的跑鞋",
    target: "平台无所谓",
    expected: { platformsInclude: [], platformsExclude: [] },
    validate: (actual) => [
      ...expectEffective(actual, "platformsInclude", []),
      ...expectEffective(actual, "platformsExclude", []),
    ],
  },
  {
    id: "W05",
    area: "受控取消库存",
    initial: "我想买有货的跑鞋",
    target: "不要求有货",
    expected: { stockOnly: false },
    validate: (actual) => expectEffective(actual, "stockOnly", false),
  },
  {
    id: "W06",
    area: "受控取消包邮",
    initial: "我想买包邮的跑鞋",
    target: "不用包邮",
    expected: { freeShippingOnly: false },
    validate: (actual) => expectEffective(actual, "freeShippingOnly", false),
  },
  {
    id: "W07",
    area: "受控取消店铺",
    initial: "我想买旗舰店的跑鞋",
    target: "旗舰店不是必须",
    expected: { shopType: null },
    validate: (actual) => expectEffectiveAbsent(actual, "shopType"),
  },
  {
    id: "W08",
    area: "受控取消排序",
    initial: "我想买跑鞋",
    setupTurns: ["按价格从低到高"],
    target: "别按价格排了",
    expected: { sortRule: "relevance_desc" },
    validate: (actual) => expectEffective(actual, "sortRule", "relevance_desc"),
  },
  {
    id: "W09",
    area: "受控撤销",
    initial: "我想买500元以下的跑鞋",
    setupTurns: ["改成300元以下"],
    target: "撤销刚才的筛选",
    expected: { priceMax: "500" },
    validate: (actual) => expectEffective(actual, "priceMax", "500"),
  },
  {
    id: "W10",
    area: "受控预算增量",
    initial: "我想买500元以下的跑鞋",
    target: "预算加200",
    expected: { priceMax: "700" },
    validate: (actual) => expectEffective(actual, "priceMax", "700"),
  },
  {
    id: "W11",
    area: "受控相对降价",
    initial: "我想买500元以下的跑鞋",
    target: "再便宜一点",
    expected: { priceMax: "less than 500" },
    validate: (actual) => {
      const value = toNumberOrNull(asRecord(actual.effectiveFilter).priceMax);
      return value !== null && value < 500
        ? []
        : [`effectiveFilter.priceMax: expected < 500, actual ${String(value)}`];
    },
  },
  {
    id: "W12",
    area: "受控相对尺码",
    initial: "我想买42码跑鞋",
    target: "换大一码",
    expected: { size: "43" },
    validate: (actual) => expectEffective(actual, "size", "43"),
  },
  {
    id: "W13",
    area: "受控价格纠正",
    initial: "我想买500元以下的跑鞋",
    target: "预算不是500，是800",
    expected: { priceMax: "800" },
    validate: (actual) => expectEffective(actual, "priceMax", "800"),
  },
  {
    id: "W14",
    area: "受控类目切换",
    initial: "我想买跑鞋",
    target: "鞋不看了，换手机",
    expected: { categoryScope: "phone" },
    validate: (actual) => expectEffective(actual, "categoryScope", "phone"),
  },
  {
    id: "W15",
    area: "受控平台作用域",
    initial: "我想买跑鞋",
    target: "淘宝不要，京东可以",
    expected: { platformsInclude: ["jd"], platformsExclude: ["taobao"] },
    validate: (actual) => [
      ...expectEffective(actual, "platformsInclude", ["jd"]),
      ...expectEffective(actual, "platformsExclude", ["taobao"]),
    ],
  },
  {
    id: "W16",
    area: "受控候选指代",
    initial: "我想买跑鞋",
    target: "把第三个去掉",
    expected: { excludedCandidateItemIds: "one candidate" },
    validate: (actual) => {
      const excluded = toStringArray(
        asRecord(actual.effectiveFilter).excludedCandidateItemIds,
      );
      return excluded.length > 0
        ? []
        : ["effectiveFilter.excludedCandidateItemIds: expected at least one item"];
    },
  },
];

function cliValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const baseUrl = (cliValue("--base-url") ?? DEFAULT_BASE_URL).replace(/\/$/, "");
const pipelineMode = cliValue("--mode") ?? "light_tag_ann_fusion";
if (!["current_ann_then_refine", "light_tag_ann_fusion"].includes(pipelineMode)) {
  throw new Error(`unsupported --mode: ${pipelineMode}`);
}
const deviceId = randomUUID();
const mobileEmail = `mobile-${deviceId}@shopping-assistant.local`;
const mobilePassword = randomBytes(32).toString("hex");
const outputPath = resolve(
  process.cwd(),
  cliValue("--output") ?? `../../artifacts/qa/cloud-natural-language-e2e-audit-${pipelineMode}.json`,
);
const resume = process.argv.includes("--resume");
const delayMs = Number(cliValue("--delay-ms") ?? 1500);
const rerunIds = new Set(
  (cliValue("--rerun-id") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const plannedCases =
  initialCases.length + turnCases.length + workflowCases.length +
  stateCases.length + boundaryCases.length;

let accessToken = "";

async function request(
  method: string,
  path: string,
  body?: unknown,
  authenticated = true,
): Promise<ApiResponse> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(authenticated && accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const raw = await response.text();
    return {
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      body: parseJsonObject(raw),
      raw,
    };
  } catch (error) {
    return {
      status: 0,
      elapsedMs: Date.now() - startedAt,
      body: {},
      raw: error instanceof Error ? error.message : String(error),
    };
  }
}

async function authenticateLikeMobile() {
  const loginBody = { email: mobileEmail, password: mobilePassword };
  let response = await request("POST", "/api/v1/auth/login", loginBody, false);
  if (response.status >= 200 && response.status < 300) {
    accessToken = tokenFrom(response);
    return response;
  }
  const code = errorCode(response.body);
  if (code !== "AUTH_INVALID_CREDENTIALS") {
    throw new Error(`mobile login failed: HTTP ${response.status} ${response.raw}`);
  }
  response = await request(
    "POST",
    "/api/v1/auth/register",
    { ...loginBody, displayName: `NL Audit ${deviceId.slice(0, 8)}` },
    false,
  );
  if (!(response.status >= 200 && response.status < 300)) {
    if (errorCode(response.body) !== "AUTH_EMAIL_ALREADY_REGISTERED") {
      throw new Error(`mobile registration failed: HTTP ${response.status} ${response.raw}`);
    }
    response = await request("POST", "/api/v1/auth/login", loginBody, false);
  }
  accessToken = tokenFrom(response);
  return response;
}

function tokenFrom(response: ApiResponse) {
  const token = asRecord(response.body.data).accessToken;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("cloud auth response did not include accessToken");
  }
  return token;
}

function errorCode(body: JsonRecord) {
  const error = asRecord(body.error);
  return typeof error.code === "string" ? error.code : "";
}

function dataFrom(response: ApiResponse) {
  return asRecord(response.body.data);
}

function effectiveFilter(data: JsonRecord) {
  return asRecord(data.effectiveFilter);
}

function parseJsonObject(raw: string): JsonRecord {
  if (!raw) return {};
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return { raw };
  }
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toNumberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function validatePrice(
  data: JsonRecord,
  field: "priceMin" | "priceMax",
  options: { nonNegative?: boolean } = {},
) {
  const value = effectiveFilter(data)[field];
  if (value === undefined || value === null || value === "") return [];
  const parsed = toNumberOrNull(value);
  if (parsed === null) return [`${field} is not numeric: ${String(value)}`];
  if (options.nonNegative && parsed < 0) return [`${field} is negative: ${parsed}`];
  return [];
}

function sameValue(actual: unknown, expected: unknown) {
  if (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.every((item) => typeof item === "string") &&
    expected.every((item) => typeof item === "string")
  ) {
    return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
  }
  if (
    (typeof actual === "string" || typeof actual === "number") &&
    (typeof expected === "string" || typeof expected === "number")
  ) {
    return String(actual) === String(expected);
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function isAbsent(value: unknown) {
  return value === undefined || value === null || value === "" ||
    (Array.isArray(value) && value.length === 0);
}

function expectEffective(actual: JsonRecord, key: string, expected: unknown) {
  const value = asRecord(actual.effectiveFilter)[key];
  return sameValue(value, expected)
    ? []
    : [
        `effectiveFilter.${key}: expected ${JSON.stringify(expected)}, actual ${JSON.stringify(value)}`,
      ];
}

function expectEffectiveAbsent(actual: JsonRecord, key: string) {
  const value = asRecord(actual.effectiveFilter)[key];
  return isAbsent(value)
    ? []
    : [
        `effectiveFilter.${key}: expected absent, actual ${JSON.stringify(value)}`,
      ];
}

function expectPipelineMode(actual: JsonRecord) {
  return expectEffective(actual, "searchPipelineMode", pipelineMode);
}

function apiFailures(response: ApiResponse) {
  const failures: string[] = [];
  if (response.status < 200 || response.status >= 300) {
    failures.push(`HTTP ${response.status}: ${response.raw.slice(0, 300)}`);
  } else if (response.body.success !== true) {
    failures.push(`response.success is ${String(response.body.success)}`);
  }
  return failures;
}

function checkExpectedTurn(actual: JsonRecord, expected: ExpectedTurn) {
  const failures: string[] = [];
  const patch = asRecord(actual.filterPatch);
  const remove = toStringArray(actual.filterRemove);
  if (expected.intent && actual.intent !== expected.intent) {
    failures.push(`intent: expected ${expected.intent}, actual ${String(actual.intent)}`);
  }
  for (const [key, value] of Object.entries(expected.patch ?? {})) {
    if (!sameValue(patch[key], value)) {
      failures.push(
        `filterPatch.${key}: expected ${JSON.stringify(value)}, actual ${JSON.stringify(patch[key])}`,
      );
    }
  }
  for (const key of expected.absent ?? []) {
    if (!isAbsent(patch[key])) {
      failures.push(
        `filterPatch.${key}: expected absent, actual ${JSON.stringify(patch[key])}`,
      );
    }
  }
  for (const key of expected.removeIncludes ?? []) {
    if (!remove.includes(key)) failures.push(`filterRemove: missing ${key}`);
  }
  if (
    expected.reset !== undefined &&
    actual.shouldResetPreviousFilters !== expected.reset
  ) {
    failures.push(
      `shouldResetPreviousFilters: expected ${expected.reset}, actual ${String(actual.shouldResetPreviousFilters)}`,
    );
  }
  return failures;
}

function initialActual(response: ApiResponse) {
  const data = dataFrom(response);
  const session = asRecord(data.session);
  const profile = asRecord(data.productProfile);
  const state = asRecord(data.conversationState);
  const summary = asRecord(data.candidateSummary);
  return {
    httpStatus: response.status,
    elapsedMs: response.elapsedMs,
    requestId: response.body.requestId,
    sessionId: session.sessionId,
    intent: data.intent,
    shouldStartProductSearch: state.stateChangingTurn === true,
    actionType: state.actionType,
    category: profile.category,
    effectiveFilter: effectiveFilter(data),
    candidateCount: summary.candidateCount,
    assistantMessage: data.assistantMessage,
    fallback: data.fallback,
  };
}

function turnActual(response: ApiResponse) {
  const data = dataFrom(response);
  const turn = asRecord(data.turn);
  const parsed = asRecord(turn.parsedFilter);
  const state = asRecord(data.conversationState);
  return {
    httpStatus: response.status,
    elapsedMs: response.elapsedMs,
    requestId: response.body.requestId,
    intent: parsed.intent,
    filterPatch: asRecord(parsed.filterPatch),
    filterRemove: toStringArray(parsed.filterRemove),
    shouldResetPreviousFilters: parsed.shouldResetPreviousFilters,
    confidence: parsed.confidence,
    provider: asRecord(parsed.raw).provider,
    providerReason: asRecord(parsed.raw).reason,
    effectiveFilter: effectiveFilter(data),
    stateChangingTurn: state.stateChangingTurn,
    assistantMessage: data.assistantMessage,
    fallback: data.fallback,
  };
}

async function createMobileTextSession(
  message: string,
  filters?: Record<string, unknown>,
) {
  return request("POST", "/api/v1/sessions/text", {
    message,
    entrySource: "android_app",
    filters: {
      ...(filters ?? {}),
      searchPipelineMode: pipelineMode,
    },
  });
}

async function submitMobileTurn(sessionId: string, message: string) {
  return request("POST", `/api/v1/sessions/${sessionId}/turns`, {
    message,
    filters: { searchPipelineMode: pipelineMode },
  });
}

function groupForTurn(id: string) {
  const number = Number(id.slice(1));
  if (number <= 16) return "platform";
  if (number <= 28) return "brand_color";
  if (number <= 51) return "size_price";
  if (number <= 64) return "stock_shop_sort";
  if (number <= 80) return "dialog_state";
  return "unicode_reference";
}

function resultKey(item: Pick<CloudAuditResult, "layer" | "id">) {
  return `${item.layer}:${item.id}`;
}

function loadCheckpoint() {
  if (!resume || !existsSync(outputPath)) return [];
  try {
    const saved = parseJsonObject(readFileSync(outputPath, "utf8"));
    return Array.isArray(saved.allResults)
      ? saved.allResults.filter(
          (item): item is CloudAuditResult =>
            typeof item === "object" && item !== null &&
            !rerunIds.has(String((item as JsonRecord).id ?? "")),
        )
      : [];
  } catch {
    return [];
  }
}

function buildReport(
  results: CloudAuditResult[],
  startedAt: Date,
  complete: boolean,
) {
  const failed = results.filter((item) => !item.passed);
  const cloudAnomalies = failed.filter((item) => {
    const status = item.actual.httpStatus;
    const provider = item.actual.provider;
    const reason = String(item.actual.providerReason ?? "");
    return status === 0 || (typeof status === "number" && status >= 500) ||
      (provider === "local_conversation_fallback" && /MODEL_|JSON|Unexpected end|Unterminated/iu.test(reason));
  });
  const cloudAnomalyKeys = new Set(cloudAnomalies.map(resultKey));
  const semanticResults = results.filter((item) => !cloudAnomalyKeys.has(resultKey(item)));
  const semanticFailed = semanticResults.filter((item) => !item.passed);
  const caseLatencies = results
    .map((item) => item.actual.elapsedMs)
    .filter((value): value is number => typeof value === "number" && value >= 0)
    .sort((left, right) => left - right);
  const percentile = (ratio: number) =>
    caseLatencies.length > 0
      ? caseLatencies[Math.floor((caseLatencies.length - 1) * ratio)]
      : null;
  const providerCounts = results.reduce<Record<string, number>>((counts, item) => {
    const provider = typeof item.actual.provider === "string"
      ? item.actual.provider
      : item.layer === "turn"
        ? "unknown"
        : "not_exposed";
    counts[provider] = (counts[provider] ?? 0) + 1;
    return counts;
  }, {});
  const layerSummary = Object.entries(
    results.reduce<Record<string, { total: number; passed: number; failed: number }>>(
      (summary, item) => {
        summary[item.layer] ??= { total: 0, passed: 0, failed: 0 };
        summary[item.layer].total += 1;
        summary[item.layer][item.passed ? "passed" : "failed"] += 1;
        return summary;
      },
      {},
    ),
  ).map(([layer, summary]) => ({ layer, ...summary }));
  return {
    generatedAt: new Date().toISOString(),
    baseUrl,
    searchPipelineMode: pipelineMode,
    complete,
    plannedCases,
    completedCases: results.length,
    transport: {
      clientContract: "mobile ShoppingApiClient HTTP contract",
      authentication: "mobile auto-login account",
      accountIsolation: "fresh random device identity per audit run",
      entrySource: "android_app",
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      interCaseDelayMs: delayMs,
      localBackendUsed: false,
      mocksUsed: false,
      directServiceCallsUsed: false,
      caseRequestsRetried: false,
    },
    currentRunSegmentElapsedMs: Date.now() - startedAt.getTime(),
    caseLatencyMs: {
      count: caseLatencies.length,
      average: caseLatencies.length > 0
        ? Math.round(
            caseLatencies.reduce((sum, value) => sum + value, 0) /
              caseLatencies.length,
          )
        : null,
      p50: percentile(0.5),
      p90: percentile(0.9),
      p95: percentile(0.95),
      max: caseLatencies.length > 0
        ? caseLatencies[caseLatencies.length - 1]
        : null,
      over10Seconds: caseLatencies.filter((value) => value > 10_000).length,
      over30Seconds: caseLatencies.filter((value) => value > 30_000).length,
    },
    totals: {
      cases: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      passRate: results.length > 0
        ? Number((((results.length - failed.length) / results.length) * 100).toFixed(1))
        : 0,
    },
    semanticTotals: {
      cases: semanticResults.length,
      passed: semanticResults.length - semanticFailed.length,
      failed: semanticFailed.length,
      passRate: semanticResults.length > 0
        ? Number((((semanticResults.length - semanticFailed.length) / semanticResults.length) * 100).toFixed(1))
        : 0,
    },
    cloudAnomalies: {
      count: cloudAnomalies.length,
      items: cloudAnomalies,
    },
    layerSummary,
    providerCounts,
    failures: failed,
    allResults: results,
  };
}

function saveCheckpoint(
  results: CloudAuditResult[],
  startedAt: Date,
  complete = false,
) {
  const report = buildReport(results, startedAt, complete);
  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function sleep(milliseconds: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForCloudRecovery() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const health = await request("GET", "/api/v1/health", undefined, false);
    if (apiFailures(health).length === 0) {
      console.log(`Cloud recovered (${health.elapsedMs} ms).`);
      return true;
    }
    console.log(`Waiting for cloud recovery: HTTP ${health.status}`);
  }
  return false;
}

async function afterCase(response: ApiResponse) {
  if (response.status === 0 || response.status >= 500) {
    await waitForCloudRecovery();
  }
  if (delayMs > 0) await sleep(delayMs);
}

async function seedTurnCase(
  caseId: string,
  currentFilter?: Record<string, unknown>,
) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const seed = await createMobileTextSession(
      "我想买一双耐克跑鞋",
      currentFilter,
    );
    const sessionId = String(asRecord(dataFrom(seed).session).sessionId ?? "");
    if (apiFailures(seed).length === 0 && sessionId) return sessionId;
    console.log(
      `Turn case ${caseId} seed attempt ${attempt} failed: HTTP ${seed.status}`,
    );
    await waitForCloudRecovery();
  }
  return "";
}

async function main() {
  const startedAt = new Date();
  const results: CloudAuditResult[] = loadCheckpoint();
  const completed = new Set(results.map(resultKey));
  console.log(`Cloud natural-language E2E target: ${baseUrl} (${pipelineMode})`);
  if (results.length > 0) {
    console.log(`Resuming from checkpoint: ${results.length}/${plannedCases} cases completed.`);
  }
  const health = await request("GET", "/api/v1/health", undefined, false);
  if (apiFailures(health).length > 0) {
    throw new Error(`cloud health failed: ${apiFailures(health).join("; ")}`);
  }
  const auth = await authenticateLikeMobile();
  console.log(`Cloud health OK (${health.elapsedMs} ms); mobile auth OK (${auth.elapsedMs} ms).`);

  for (let index = 0; index < initialCases.length; index += 1) {
    const test = initialCases[index];
    if (completed.has(`initial:${test.id}`)) continue;
    const response = await createMobileTextSession(test.input);
    const actual = initialActual(response);
    const failures = apiFailures(response);
    if (failures.length === 0) {
      if (actual.shouldStartProductSearch !== test.search) {
        failures.push(
          `search: expected ${test.search}, actual ${String(actual.shouldStartProductSearch)}`,
        );
      }
      if (test.category && actual.category !== test.category) {
        failures.push(
          `category: expected ${test.category}, actual ${String(actual.category)}`,
        );
      }
      const filter = asRecord(actual.effectiveFilter);
      for (const [key, value] of Object.entries(test.patch ?? {})) {
        if (!sameValue(filter[key], value)) {
          failures.push(
            `effectiveFilter.${key}: expected ${JSON.stringify(value)}, actual ${JSON.stringify(filter[key])}`,
          );
        }
      }
      for (const key of test.absent ?? []) {
        if (!isAbsent(filter[key])) {
          failures.push(
            `effectiveFilter.${key}: expected absent, actual ${JSON.stringify(filter[key])}`,
          );
        }
      }
      failures.push(...expectPipelineMode(actual));
    }
    results.push({
      id: test.id,
      layer: "initial",
      area: test.area,
      input: test.input,
      expected: {
        search: test.search,
        category: test.category,
        patch: test.patch,
        absent: test.absent,
      },
      actual,
      passed: failures.length === 0,
      failures,
    });
    completed.add(`initial:${test.id}`);
    saveCheckpoint(results, startedAt);
    console.log(`[initial ${index + 1}/${initialCases.length}] ${test.id} ${failures.length === 0 ? "PASS" : "FAIL"} (${response.elapsedMs} ms)`);
    await afterCase(response);
  }

  for (let index = 0; index < turnCases.length; index += 1) {
    const test = turnCases[index];
    if (completed.has(`turn:${test.id}`)) continue;
    const group = groupForTurn(test.id);
    const sessionId = await seedTurnCase(test.id, test.currentFilter);
    if (!sessionId) {
        const failures = [`unable to seed cloud turn group ${group} after 3 attempts`];
        results.push({
          id: test.id,
          layer: "turn",
          area: test.area,
          input: test.input,
          expected: test.expected as JsonRecord,
          actual: { httpStatus: 0, setupFailure: true, group },
          passed: false,
          failures,
        });
        completed.add(`turn:${test.id}`);
        saveCheckpoint(results, startedAt);
        console.log(`[turn ${index + 1}/${turnCases.length}] ${test.id} FAIL (seed unavailable)`);
      continue;
    }
    if (test.id === "F69" || test.id === "F78") {
      const setup = await submitMobileTurn(sessionId, "先改成500元以下");
      const setupFailures = apiFailures(setup);
      if (setupFailures.length > 0) {
        results.push({
          id: test.id,
          layer: "turn",
          area: test.area,
          input: test.input,
          expected: test.expected as JsonRecord,
          actual: { httpStatus: setup.status, setupFailure: setupFailures },
          passed: false,
          failures: setupFailures,
        });
        completed.add(`turn:${test.id}`);
        saveCheckpoint(results, startedAt);
        await afterCase(setup);
        continue;
      }
      await afterCase(setup);
    }
    const response = await submitMobileTurn(sessionId, test.input);
    const actual = turnActual(response);
    const failures = apiFailures(response);
    if (failures.length === 0) {
      failures.push(...checkExpectedTurn(actual, test.expected));
      failures.push(...expectPipelineMode(actual));
    }
    results.push({
      id: test.id,
      layer: "turn",
      area: test.area,
      input: test.input,
      expected: test.expected as JsonRecord,
      actual,
      passed: failures.length === 0,
      failures,
    });
    completed.add(`turn:${test.id}`);
    saveCheckpoint(results, startedAt);
    console.log(`[turn ${index + 1}/${turnCases.length}] ${test.id} ${failures.length === 0 ? "PASS" : "FAIL"} (${response.elapsedMs} ms, ${String(actual.provider ?? "unknown")})`);
    await afterCase(response);
  }

  for (let index = 0; index < workflowCases.length; index += 1) {
    const test = workflowCases[index];
    if (completed.has(`workflow:${test.id}`)) continue;
    const setupEvidence: JsonRecord[] = [];
    const initial = await createMobileTextSession(test.initial);
    const initialFailures = apiFailures(initial);
    const sessionId = String(asRecord(dataFrom(initial).session).sessionId ?? "");
    setupEvidence.push({
      step: "initial",
      input: test.initial,
      httpStatus: initial.status,
      elapsedMs: initial.elapsedMs,
      effectiveFilter: effectiveFilter(dataFrom(initial)),
    });
    await afterCase(initial);

    let setupFailure = initialFailures.length > 0 || !sessionId
      ? initialFailures.join("; ") || "initial sessionId missing"
      : "";
    if (!setupFailure) {
      for (const setupMessage of test.setupTurns ?? []) {
        const setupResponse = await submitMobileTurn(sessionId, setupMessage);
        setupEvidence.push({
          step: "turn",
          input: setupMessage,
          httpStatus: setupResponse.status,
          elapsedMs: setupResponse.elapsedMs,
          parsedFilter: asRecord(asRecord(dataFrom(setupResponse).turn).parsedFilter),
          effectiveFilter: effectiveFilter(dataFrom(setupResponse)),
        });
        const setupFailures = apiFailures(setupResponse);
        await afterCase(setupResponse);
        if (setupFailures.length > 0) {
          setupFailure = setupFailures.join("; ");
          break;
        }
      }
    }

    let actual: JsonRecord;
    let failures: string[];
    let targetResponse: ApiResponse | null = null;
    if (setupFailure) {
      actual = { setupFailure, setupEvidence };
      failures = [`workflow setup failed: ${setupFailure}`];
    } else {
      targetResponse = await submitMobileTurn(sessionId, test.target);
      actual = {
        ...turnActual(targetResponse),
        setupEvidence,
      };
      failures = apiFailures(targetResponse);
      if (failures.length === 0) {
        failures.push(...test.validate(actual));
        failures.push(...expectPipelineMode(actual));
      }
    }
    results.push({
      id: test.id,
      layer: "workflow",
      area: test.area,
      input: `${test.initial} -> ${(test.setupTurns ?? []).join(" -> ")}${(test.setupTurns ?? []).length > 0 ? " -> " : ""}${test.target}`,
      expected: test.expected,
      actual,
      passed: failures.length === 0,
      failures,
    });
    completed.add(`workflow:${test.id}`);
    saveCheckpoint(results, startedAt);
    console.log(`[workflow ${index + 1}/${workflowCases.length}] ${test.id} ${failures.length === 0 ? "PASS" : "FAIL"}`);
    if (targetResponse) await afterCase(targetResponse);
  }

  for (let index = 0; index < stateCases.length; index += 1) {
    const test = stateCases[index];
    if (completed.has(`state:${test.id}`)) continue;
    const response = await createMobileTextSession(test.input);
    const data = dataFrom(response);
    const actual = initialActual(response);
    const failures = apiFailures(response);
    if (failures.length === 0) {
      failures.push(...test.validate(data));
      failures.push(...expectPipelineMode(actual));
    }
    results.push({
      id: test.id,
      layer: "state",
      area: test.area,
      input: test.input,
      expected: test.expected,
      actual,
      passed: failures.length === 0,
      failures,
    });
    completed.add(`state:${test.id}`);
    saveCheckpoint(results, startedAt);
    console.log(`[state ${index + 1}/${stateCases.length}] ${test.id} ${failures.length === 0 ? "PASS" : "FAIL"} (${response.elapsedMs} ms)`);
    await afterCase(response);
  }

  for (let index = 0; index < boundaryCases.length; index += 1) {
    const test = boundaryCases[index];
    if (completed.has(`boundary:${test.id}`)) continue;
    const response = await request("POST", "/api/v1/sessions/text", test.dto);
    const accepted = response.status >= 200 && response.status < 300 &&
      response.body.success === true;
    const failures = accepted === test.shouldAccept
      ? []
      : [`accepted: expected ${test.shouldAccept}, actual ${accepted} (HTTP ${response.status})`];
    results.push({
      id: test.id,
      layer: "boundary",
      area: test.area,
      input: test.label,
      expected: { accepted: test.shouldAccept },
      actual: {
        httpStatus: response.status,
        elapsedMs: response.elapsedMs,
        requestId: response.body.requestId,
        accepted,
        error: response.body.error,
      },
      passed: failures.length === 0,
      failures,
    });
    completed.add(`boundary:${test.id}`);
    saveCheckpoint(results, startedAt);
    console.log(`[boundary ${index + 1}/${boundaryCases.length}] ${test.id} ${failures.length === 0 ? "PASS" : "FAIL"} (${response.elapsedMs} ms)`);
    await afterCase(response);
  }

  const report = saveCheckpoint(results, startedAt, results.length === plannedCases);
  const failed = results.filter((item) => !item.passed);
  console.log(
    `Cloud natural-language E2E: ${report.totals.cases} cases, ${report.totals.passed} passed, ${report.totals.failed} failed, ${report.totals.passRate}% pass rate.`,
  );
  console.log(`Report: ${outputPath}`);
  for (const item of failed.slice(0, 30)) {
    console.log(`[FAIL] ${item.id} ${item.input} | ${item.failures.join("; ")}`);
  }
  if (failed.length > 30) {
    console.log(`... ${failed.length - 30} additional failures are in the JSON report.`);
  }
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
