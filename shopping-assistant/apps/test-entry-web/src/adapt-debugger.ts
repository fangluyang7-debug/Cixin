import './adapt-debugger.css';

type ImageRole = 'query' | 'product_main' | 'product_style';
type Tone = 'neutral' | 'good' | 'warn' | 'bad';

interface DebugPreprocessResponse {
  strategy: string;
  usedOriginalImage: boolean;
  confidence: number;
  bboxPx: number[] | null;
  bboxNorm: number[] | null;
  imageWidth: number;
  imageHeight: number;
  croppedImageBase64: string;
  contentType: string;
  metadata: Record<string, unknown>;
}

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: { code?: string; message?: string } | null;
}

interface BatchSourceItem {
  id: string;
  index: number;
  title: string;
  imageUrl: string;
  platform: string | null;
  productUrl: string | null;
}

interface BatchResultItem {
  source: BatchSourceItem;
  status: 'pending' | 'processing' | 'done' | 'error';
  result?: DebugPreprocessResponse;
  error?: string;
  elapsedMs?: number;
}

interface DebugControls {
  apiBase: HTMLInputElement;
  token: HTMLInputElement;
  file: HTMLInputElement;
  imageUrl: HTMLInputElement;
  role: HTMLSelectElement;
  classes: HTMLInputElement;
  confidence: HTMLInputElement;
  confidenceValue: HTMLElement;
  padding: HTMLInputElement;
  paddingValue: HTMLElement;
  padColor: HTMLInputElement;
  manualX1: HTMLInputElement;
  manualY1: HTMLInputElement;
  manualX2: HTMLInputElement;
  manualY2: HTMLInputElement;
  useDetectedBoxButton: HTMLButtonElement;
  clearManualBoxButton: HTMLButtonElement;
  runButton: HTMLButtonElement;
  status: HTMLElement;
  original: HTMLImageElement;
  originalEmpty: HTMLElement;
  crop: HTMLImageElement;
  cropEmpty: HTMLElement;
  overlay: HTMLElement;
  metrics: HTMLElement;
  metadata: HTMLElement;
  batchJson: HTMLInputElement;
  batchLimit: HTMLInputElement;
  batchConcurrency: HTMLInputElement;
  batchPageSize: HTMLInputElement;
  batchStartButton: HTMLButtonElement;
  batchStopButton: HTMLButtonElement;
  batchSummary: HTMLElement;
  batchPager: HTMLElement;
  batchGallery: HTMLElement;
}

const tokenStorageKey = 'shopping-assistant-adapt-debugger-token';
const standardDetectionClasses = [
  'shoe',
  'sneaker',
  'boot',
  'sandal',
  'camera',
  'headphones',
  'earphones',
  'earbuds',
  'headset',
  'watch',
  'smartwatch',
  'cell phone',
  'mobile phone',
  'smartphone',
  'laptop',
  'computer',
  'tablet',
  'keyboard',
  'computer keyboard',
  'computer mouse',
  'mouse',
  'electronics',
  'digital device',
  'clothing',
  'shirt',
  't-shirt',
  'pants',
  'jacket',
  'coat',
  'dress',
  'uniform',
  'food',
  'snack',
  'drink',
  'beverage',
  'bottle',
  'can',
  'box',
  'package',
  'product',
  'object',
  'container',
];
const tightDetectionClasses = standardDetectionClasses.filter(
  (item) => !['product', 'object', 'container'].includes(item),
);
const apparelDetectionClasses = [
  'clothing',
  'jacket',
  'coat',
  'shirt',
  't-shirt',
  'pants',
  'dress',
  'uniform',
];
const defaultDetectionClasses = tightDetectionClasses.join(',');
const defaultOutputSize = 480;
const defaultJpegQuality = 88;

export function renderAdaptDebugger(root: HTMLElement) {
  root.className = 'adapt-debugger-page';
  root.innerHTML = `
    <main class="adapt-debugger">
      <aside class="adapt-debugger__controls">
        <div class="adapt-debugger__brand">
          <span>Adapt Debugger</span>
          <strong>商品图裁剪预览</strong>
        </div>

        <label>
          API 地址
          <input id="adapt-api-base" value="${escapeHtml(defaultApiBase())}" autocomplete="off">
        </label>

        <label>
          维护口令
          <input id="adapt-token" type="password" placeholder="MAINTENANCE_API_TOKEN">
        </label>

        <label>
          上传图片
          <input id="adapt-file" type="file" accept="image/*">
        </label>

        <label>
          图片 URL
          <input id="adapt-image-url" placeholder="https://...">
        </label>

        <div class="adapt-debugger__row">
          <label>
            图片角色
            <select id="adapt-role">
              <option value="product_main" selected>商品主图</option>
              <option value="product_style">款式图</option>
              <option value="query">用户查询图</option>
            </select>
          </label>
        </div>

        <label>
          检测类别
          <input id="adapt-classes" value="${defaultDetectionClasses}">
        </label>

        <label>
          置信度阈值 <output id="adapt-confidence-value">0.08</output>
          <input id="adapt-confidence" type="range" min="0" max="0.5" step="0.01" value="0.08">
        </label>

        <label>
          裁剪外扩 <output id="adapt-padding-value">0.12</output>
          <input id="adapt-padding" type="range" min="0" max="0.6" step="0.01" value="0.12">
        </label>

        <label>
          补边颜色
          <input id="adapt-pad-color" type="color" value="#f5f5f5">
        </label>

        <div class="adapt-debugger__manual">
          <div class="adapt-debugger__manual-title">手动裁剪框</div>
          <div class="adapt-debugger__manual-grid">
            <label>x1<input id="adapt-manual-x1" inputmode="decimal" placeholder="0.00"></label>
            <label>y1<input id="adapt-manual-y1" inputmode="decimal" placeholder="0.00"></label>
            <label>x2<input id="adapt-manual-x2" inputmode="decimal" placeholder="1.00"></label>
            <label>y2<input id="adapt-manual-y2" inputmode="decimal" placeholder="1.00"></label>
          </div>
          <div class="adapt-debugger__button-row adapt-debugger__button-row--secondary">
            <button id="adapt-use-detected-box" type="button">套用当前框</button>
            <button id="adapt-clear-manual-box" type="button">清空</button>
          </div>
        </div>

        <button id="adapt-run" type="button">
          <span aria-hidden="true">▶</span>
          运行裁剪
        </button>

        <div id="adapt-status" class="adapt-debugger__status">等待图片</div>

        <div class="adapt-debugger__divider"></div>

        <div class="adapt-debugger__brand adapt-debugger__brand--small">
          <span>Batch Review</span>
          <strong>JSON 批量筛查</strong>
        </div>

        <label>
          商品 JSON
          <input id="adapt-batch-json" type="file" accept=".json,application/json">
        </label>

        <div class="adapt-debugger__row">
          <label>
            最多处理
            <input id="adapt-batch-limit" type="number" min="1" max="1000" value="1000">
          </label>
          <label>
            并发数
            <input id="adapt-batch-concurrency" type="number" min="1" max="6" value="2">
          </label>
        </div>

        <label>
          每页显示
          <input id="adapt-batch-page-size" type="number" min="4" max="80" value="24">
        </label>

        <div class="adapt-debugger__button-row">
          <button id="adapt-batch-start" type="button">
            <span aria-hidden="true">▶</span>
            开始批量
          </button>
          <button id="adapt-batch-stop" type="button" disabled>停止</button>
        </div>

        <div id="adapt-batch-summary" class="adapt-debugger__status">等待 JSON</div>
      </aside>

      <section class="adapt-debugger__workspace">
        <div class="adapt-debugger__toolbar">
          <div>
            <h1>裁剪标准化结果</h1>
            <p>先批量扫图，发现裁偏后送到单图调试，改类别、阈值、外扩或手动框后重跑。</p>
          </div>
        </div>

        <div id="adapt-metrics" class="adapt-debugger__metrics"></div>

        <div class="adapt-debugger__visuals">
          <article class="adapt-debugger__panel">
            <header>
              <h2>原图与检测框</h2>
            </header>
            <div class="adapt-debugger__image-stage">
              <img id="adapt-original" alt="原图预览" hidden>
              <div id="adapt-overlay" class="adapt-debugger__bbox" hidden></div>
              <div id="adapt-original-empty" class="adapt-debugger__empty">选择图片后显示原图</div>
            </div>
          </article>

          <article class="adapt-debugger__panel">
            <header>
              <h2>裁剪标准化图</h2>
            </header>
            <div class="adapt-debugger__image-stage adapt-debugger__image-stage--crop">
              <img id="adapt-crop" alt="裁剪后的标准化图" hidden>
              <div id="adapt-crop-empty" class="adapt-debugger__empty">运行后显示裁剪结果</div>
            </div>
          </article>
        </div>

        <section class="adapt-debugger__panel adapt-debugger__panel--metadata">
          <header>
            <h2>返回元数据</h2>
          </header>
          <pre id="adapt-metadata">{}</pre>
        </section>

        <section class="adapt-debugger__panel adapt-debugger__panel--batch">
          <header class="adapt-debugger__batch-header">
            <div>
              <h2>批量裁剪结果</h2>
              <p>每张卡片显示原图、裁剪图、bbox、置信度和回退状态。</p>
            </div>
            <div id="adapt-batch-pager" class="adapt-debugger__pager"></div>
          </header>
          <div id="adapt-batch-gallery" class="adapt-debugger__batch-gallery">
            <div class="adapt-debugger__empty">选择 JSON 后开始批量筛查</div>
          </div>
        </section>
      </section>
    </main>
  `;

  const controls = bindControls(root);
  wireControls(controls);
}

function bindControls(root: HTMLElement): DebugControls {
  return {
    apiBase: find<HTMLInputElement>(root, '#adapt-api-base'),
    token: find<HTMLInputElement>(root, '#adapt-token'),
    file: find<HTMLInputElement>(root, '#adapt-file'),
    imageUrl: find<HTMLInputElement>(root, '#adapt-image-url'),
    role: find<HTMLSelectElement>(root, '#adapt-role'),
    classes: find<HTMLInputElement>(root, '#adapt-classes'),
    confidence: find<HTMLInputElement>(root, '#adapt-confidence'),
    confidenceValue: find<HTMLElement>(root, '#adapt-confidence-value'),
    padding: find<HTMLInputElement>(root, '#adapt-padding'),
    paddingValue: find<HTMLElement>(root, '#adapt-padding-value'),
    padColor: find<HTMLInputElement>(root, '#adapt-pad-color'),
    manualX1: find<HTMLInputElement>(root, '#adapt-manual-x1'),
    manualY1: find<HTMLInputElement>(root, '#adapt-manual-y1'),
    manualX2: find<HTMLInputElement>(root, '#adapt-manual-x2'),
    manualY2: find<HTMLInputElement>(root, '#adapt-manual-y2'),
    useDetectedBoxButton: find<HTMLButtonElement>(root, '#adapt-use-detected-box'),
    clearManualBoxButton: find<HTMLButtonElement>(root, '#adapt-clear-manual-box'),
    runButton: find<HTMLButtonElement>(root, '#adapt-run'),
    status: find<HTMLElement>(root, '#adapt-status'),
    original: find<HTMLImageElement>(root, '#adapt-original'),
    originalEmpty: find<HTMLElement>(root, '#adapt-original-empty'),
    crop: find<HTMLImageElement>(root, '#adapt-crop'),
    cropEmpty: find<HTMLElement>(root, '#adapt-crop-empty'),
    overlay: find<HTMLElement>(root, '#adapt-overlay'),
    metrics: find<HTMLElement>(root, '#adapt-metrics'),
    metadata: find<HTMLElement>(root, '#adapt-metadata'),
    batchJson: find<HTMLInputElement>(root, '#adapt-batch-json'),
    batchLimit: find<HTMLInputElement>(root, '#adapt-batch-limit'),
    batchConcurrency: find<HTMLInputElement>(root, '#adapt-batch-concurrency'),
    batchPageSize: find<HTMLInputElement>(root, '#adapt-batch-page-size'),
    batchStartButton: find<HTMLButtonElement>(root, '#adapt-batch-start'),
    batchStopButton: find<HTMLButtonElement>(root, '#adapt-batch-stop'),
    batchSummary: find<HTMLElement>(root, '#adapt-batch-summary'),
    batchPager: find<HTMLElement>(root, '#adapt-batch-pager'),
    batchGallery: find<HTMLElement>(root, '#adapt-batch-gallery'),
  };
}

function wireControls(controls: DebugControls) {
  let uploadedImageDataUrl: string | null = null;
  let lastResult: DebugPreprocessResponse | null = null;
  let batchItems: BatchResultItem[] = [];
  let batchPage = 1;
  let batchStopRequested = false;

  controls.token.value = localStorage.getItem(tokenStorageKey) ?? '';
  controls.token.addEventListener('input', () => {
    localStorage.setItem(tokenStorageKey, controls.token.value.trim());
  });

  const syncSliderLabels = () => {
    controls.confidenceValue.textContent = Number(controls.confidence.value).toFixed(2);
    controls.paddingValue.textContent = Number(controls.padding.value).toFixed(2);
  };
  controls.confidence.addEventListener('input', syncSliderLabels);
  controls.padding.addEventListener('input', syncSliderLabels);
  syncSliderLabels();

  controls.file.addEventListener('change', async () => {
    const file = controls.file.files?.[0] ?? null;
    uploadedImageDataUrl = file ? await readFileAsDataUrl(file) : null;
    lastResult = null;
    clearResult(controls);
    if (uploadedImageDataUrl) {
      showOriginal(controls, uploadedImageDataUrl);
      controls.imageUrl.value = '';
      setStatus(controls, '图片已载入', 'neutral');
    } else {
      clearOriginal(controls);
      setStatus(controls, '等待图片', 'neutral');
    }
  });

  controls.runButton.addEventListener('click', async () => {
    await runPreview(controls, uploadedImageDataUrl).then((result) => {
      lastResult = result;
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(controls, `出错：${message}`, 'bad');
    });
  });

  controls.useDetectedBoxButton.addEventListener('click', () => {
    if (!lastResult?.bboxNorm) {
      setStatus(controls, '还没有可套用的检测框', 'warn');
      return;
    }
    setManualBox(controls, lastResult.bboxNorm);
    setStatus(controls, '已套用当前检测框，可以微调后重跑', 'good');
  });

  controls.clearManualBoxButton.addEventListener('click', () => {
    clearManualBox(controls);
    setStatus(controls, '已清空手动框，将继续使用自动检测', 'neutral');
  });

  controls.batchJson.addEventListener('change', async () => {
    const file = controls.batchJson.files?.[0] ?? null;
    if (!file) {
      batchItems = [];
      batchPage = 1;
      renderBatch(controls, batchItems, batchPage);
      setBatchSummary(controls, '等待 JSON', 'neutral');
      return;
    }
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const limit = positiveInteger(controls.batchLimit.value, 80, 1, 1000);
      batchItems = extractBatchSourceItems(payload)
        .slice(0, limit)
        .map((source) => ({ source, status: 'pending' as const }));
      batchPage = 1;
      renderBatch(controls, batchItems, batchPage);
      setBatchSummary(controls, `已读取 ${batchItems.length} 张图片 URL`, 'good');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBatchSummary(controls, `JSON 读取失败：${message}`, 'bad');
    }
  });

  controls.batchStartButton.addEventListener('click', async () => {
    batchStopRequested = false;
    const file = controls.batchJson.files?.[0] ?? null;
    if (!file && batchItems.length === 0) {
      setBatchSummary(controls, '请先选择商品 JSON', 'bad');
      return;
    }
    if (file) {
      const payload = JSON.parse(await file.text()) as unknown;
      const limit = positiveInteger(controls.batchLimit.value, 80, 1, 1000);
      batchItems = extractBatchSourceItems(payload)
        .slice(0, limit)
        .map((source) => ({ source, status: 'pending' as const }));
    }
    batchItems = batchItems.map((item) => ({ source: item.source, status: 'pending' as const }));
    batchPage = 1;
    renderBatch(controls, batchItems, batchPage);
    await runBatch(controls, batchItems, () => batchStopRequested).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setBatchSummary(controls, `批量任务失败：${message}`, 'bad');
    });
  });

  controls.batchStopButton.addEventListener('click', () => {
    batchStopRequested = true;
    controls.batchStopButton.disabled = true;
    setBatchSummary(controls, '正在停止，已发出的请求会跑完', 'warn');
  });

  controls.batchPager.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const action = target.dataset.pageAction;
    const totalPages = totalBatchPages(controls, batchItems);
    if (action === 'prev') batchPage = Math.max(1, batchPage - 1);
    if (action === 'next') batchPage = Math.min(totalPages, batchPage + 1);
    renderBatch(controls, batchItems, batchPage);
  });

  controls.batchGallery.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('[data-open-single="true"]');
    if (!button) return;
    const imageUrl = button.dataset.imageUrl ?? '';
    if (!imageUrl) return;
    uploadedImageDataUrl = null;
    lastResult = null;
    controls.file.value = '';
    controls.imageUrl.value = imageUrl;
    clearManualBox(controls);
    clearResult(controls);
    showOriginal(controls, imageUrl);
    setStatus(controls, '已送入单图调试，可调整参数后运行', 'good');
    controls.runButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  controls.batchPageSize.addEventListener('change', () => {
    batchPage = 1;
    renderBatch(controls, batchItems, batchPage);
  });
}

async function runPreview(
  controls: DebugControls,
  uploadedImageDataUrl: string | null,
): Promise<DebugPreprocessResponse> {
  const imageUrl = controls.imageUrl.value.trim();
  if (!uploadedImageDataUrl && !imageUrl) {
    throw new Error('请先上传图片或填写图片 URL');
  }

  controls.runButton.disabled = true;
  try {
    setStatus(controls, '正在裁剪...', 'neutral');
    clearResult(controls);

    const result = await postDebugRequest(controls, uploadedImageDataUrl, imageUrl);
    renderResult(controls, result, uploadedImageDataUrl ?? imageUrl);
    setStatus(
      controls,
      result.usedOriginalImage ? '已回退原图' : '裁剪完成',
      result.usedOriginalImage ? 'warn' : 'good',
    );
    return result;
  } finally {
    controls.runButton.disabled = false;
  }
}

async function postDebugRequest(
  controls: DebugControls,
  uploadedImageDataUrl: string | null,
  imageUrl: string,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = controls.token.value.trim();
  if (token) headers['x-maintenance-token'] = token;

  const response = await fetch(`${normalizeApiBase(controls.apiBase.value)}/api/v1/product-pool/debug/image-preprocess`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      imageBase64: uploadedImageDataUrl || undefined,
      imageUrl: uploadedImageDataUrl ? undefined : imageUrl,
      role: controls.role.value as ImageRole,
      tags: {
        source: 'adapt-debugger',
        role: controls.role.value,
      },
      debugOptions: {
        detectionClasses: controls.classes.value,
        detectionConf: Number(controls.confidence.value),
        cropPadding: Number(controls.padding.value),
        squarePadColor: hexToRgb(controls.padColor.value),
        manualBboxNorm: readManualBox(controls) ?? undefined,
        outputSize: defaultOutputSize,
        jpegQuality: defaultJpegQuality,
      },
    }),
  });

  const payload = await readApiResponse<DebugPreprocessResponse>(response);
  if (!payload.data) {
    throw new Error('调试接口没有返回裁剪结果');
  }
  return payload.data;
}

async function readApiResponse<T>(response: Response): Promise<ApiEnvelope<T>> {
  const text = await response.text();
  let payload: ApiEnvelope<T>;
  try {
    payload = text ? JSON.parse(text) as ApiEnvelope<T> : {};
  } catch {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
  }
  if (!response.ok || payload.success === false) {
    const message = payload.error?.message || payload.error?.code || response.statusText;
    throw new Error(message);
  }
  return payload;
}

async function runBatch(
  controls: DebugControls,
  items: BatchResultItem[],
  shouldStop: () => boolean,
) {
  if (items.length === 0) {
    setBatchSummary(controls, 'JSON 里没有找到可用图片 URL', 'bad');
    return;
  }

  controls.batchStartButton.disabled = true;
  controls.batchStopButton.disabled = false;
  const concurrency = positiveInteger(controls.batchConcurrency.value, 2, 1, 6);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length && !shouldStop()) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      item.status = 'processing';
      renderBatch(controls, items);
      const startedAt = Date.now();
      try {
        item.result = await postDebugRequest(controls, null, item.source.imageUrl);
        item.status = 'done';
        item.elapsedMs = Date.now() - startedAt;
      } catch (error) {
        item.status = 'error';
        item.error = error instanceof Error ? error.message : String(error);
        item.elapsedMs = Date.now() - startedAt;
      }
      renderBatch(controls, items);
      setBatchSummary(controls, batchProgressText(items), batchTone(items));
    }
  };

  setBatchSummary(controls, `开始处理 ${items.length} 张图片，并发 ${concurrency}`, 'neutral');
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  controls.batchStartButton.disabled = false;
  controls.batchStopButton.disabled = true;
  setBatchSummary(
    controls,
    [
      shouldStop() ? `已停止。${batchProgressText(items)}` : `完成。${batchProgressText(items)}`,
      batchFailureHint(items),
    ].filter(Boolean).join('。'),
    batchTone(items),
  );
}

function extractBatchSourceItems(payload: unknown): BatchSourceItem[] {
  const records = resolveProductRecords(payload);
  const seen = new Set<string>();
  const items: BatchSourceItem[] = [];

  records.forEach((record, index) => {
    const imageUrl = findImageUrl(record);
    if (!imageUrl || seen.has(imageUrl)) return;
    seen.add(imageUrl);
    const productUrl = readFirstStringDeep(record, ['productUrl', 'url', 'detailUrl', 'itemUrl', 'searchUrl']);
    items.push({
      id: readFirstStringDeep(record, ['id', 'externalId', 'productId', 'skuId']) ?? `json_item_${index + 1}`,
      index: index + 1,
      title: readFirstStringDeep(record, ['title', 'name', 'productName', 'goodsName']) ?? `商品 ${index + 1}`,
      imageUrl,
      platform: readFirstStringDeep(record, ['platform', 'sourcePlatform', 'site']) ?? null,
      productUrl: productUrl ?? null,
    });
  });

  return items;
}

function resolveProductRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  const directKeys = ['items', 'products', 'data', 'records', 'list'];
  for (const key of directKeys) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
    if (isRecord(value)) {
      const nested = resolveProductRecords(value);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function findImageUrl(record: Record<string, unknown>) {
  const direct = readFirstStringDeep(record, [
    'imageUrl',
    'coverImageUrl',
    'mainImageUrl',
    'sourceImageUrl',
    'image',
    'picUrl',
    'imgUrl',
  ]);
  if (direct && looksLikeImageUrl(direct)) return direct;

  return findStringInUnknown(record, looksLikeImageUrl);
}

function readFirstStringDeep(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isRecord(item)) {
          const found: string | null = readFirstStringDeep(item, keys);
          if (found) return found;
        }
      }
    } else if (isRecord(value)) {
      const found: string | null = readFirstStringDeep(value, keys);
      if (found) return found;
    }
  }
  return null;
}

function findStringInUnknown(value: unknown, predicate: (value: string) => boolean): string | null {
  if (typeof value === 'string') return predicate(value.trim()) ? value.trim() : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringInUnknown(item, predicate);
      if (found) return found;
    }
    return null;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      const found = findStringInUnknown(item, predicate);
      if (found) return found;
    }
  }
  return null;
}

function looksLikeImageUrl(value: string) {
  if (!/^https?:\/\//i.test(value)) return false;
  return (
    /\.(jpg|jpeg|png|webp|gif)(_|!|\?|#|$)/i.test(value) ||
    /img|image|pic|uimg|alicdn|suning|vipstatic/i.test(value)
  );
}

function renderBatch(controls: DebugControls, items: BatchResultItem[], page?: number) {
  const currentPage = page ?? currentRenderedPage(controls);
  const pageSize = positiveInteger(controls.batchPageSize.value, 24, 4, 80);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(totalPages, Math.max(1, currentPage));
  controls.batchGallery.dataset.page = String(safePage);

  renderBatchPager(controls, safePage, totalPages, items.length);
  if (items.length === 0) {
    controls.batchGallery.innerHTML = '<div class="adapt-debugger__empty">选择 JSON 后开始批量筛查</div>';
    return;
  }

  const start = (safePage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  controls.batchGallery.innerHTML = pageItems.map(renderBatchCard).join('');
}

function renderBatchCard(item: BatchResultItem) {
  const result = item.result;
  const cropSrc = result
    ? `data:${result.contentType || 'image/jpeg'};base64,${result.croppedImageBase64}`
    : '';
  const statusTone = item.status === 'error'
    ? 'bad'
    : result?.usedOriginalImage
      ? 'warn'
      : item.status === 'done'
        ? 'good'
        : 'neutral';
  const statusText = item.status === 'done'
    ? result?.usedOriginalImage
      ? '回退原图'
      : '已裁剪'
    : item.status === 'processing'
      ? '处理中'
      : item.status === 'error'
        ? '失败'
        : '等待';

  return `
    <article class="adapt-debugger__batch-card" data-tone="${statusTone}">
      <div class="adapt-debugger__batch-images">
        <figure>
          <img src="${escapeHtml(item.source.imageUrl)}" loading="lazy" alt="">
          <figcaption>原图</figcaption>
        </figure>
        <figure>
          ${cropSrc ? `<img src="${cropSrc}" loading="lazy" alt="">` : '<div class="adapt-debugger__batch-placeholder">等待裁剪</div>'}
          <figcaption>裁剪图</figcaption>
        </figure>
      </div>
      <div class="adapt-debugger__batch-body">
        <div class="adapt-debugger__batch-title">#${item.source.index} ${escapeHtml(item.source.title)}</div>
        <div class="adapt-debugger__batch-tags">
          ${batchTag(statusText, statusTone)}
          ${batchTag(`conf ${result ? result.confidence.toFixed(3) : '-'}`)}
          ${batchTag(result?.bboxNorm ? 'bbox yes' : 'bbox no', result?.bboxNorm ? 'good' : 'warn')}
          ${batchTag(`${item.elapsedMs ?? '-'} ms`)}
        </div>
        <div class="adapt-debugger__batch-meta">
          ${escapeHtml(item.source.platform ?? '-')} · ${escapeHtml(result ? `${result.imageWidth}x${result.imageHeight}` : '-')}
        </div>
        ${item.error ? `<div class="adapt-debugger__batch-error">${escapeHtml(item.error)}</div>` : ''}
        <div class="adapt-debugger__batch-links">
          <button type="button" class="adapt-debugger__link-button" data-open-single="true" data-image-url="${escapeHtml(item.source.imageUrl)}">单图调试</button>
          <a href="${escapeHtml(item.source.imageUrl)}" target="_blank" rel="noreferrer">打开图片</a>
          ${item.source.productUrl ? `<a href="${escapeHtml(item.source.productUrl)}" target="_blank" rel="noreferrer">商品页</a>` : ''}
        </div>
      </div>
    </article>
  `;
}

function renderBatchPager(
  controls: DebugControls,
  page: number,
  totalPages: number,
  totalItems: number,
) {
  controls.batchPager.innerHTML = totalItems === 0
    ? ''
    : `
      <button type="button" data-page-action="prev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <span>${page} / ${totalPages}</span>
      <button type="button" data-page-action="next" ${page >= totalPages ? 'disabled' : ''}>下一页</button>
    `;
}

function batchTag(value: string, tone = 'neutral') {
  return `<span class="adapt-debugger__batch-tag" data-tone="${escapeHtml(tone)}">${escapeHtml(value)}</span>`;
}

function setBatchSummary(controls: DebugControls, message: string, tone: Tone) {
  controls.batchSummary.textContent = message;
  controls.batchSummary.dataset.tone = tone;
}

function batchProgressText(items: BatchResultItem[]) {
  const done = items.filter((item) => item.status === 'done').length;
  const errors = items.filter((item) => item.status === 'error').length;
  const fallback = items.filter((item) => item.result?.usedOriginalImage).length;
  const detected = items.filter((item) => item.result && !item.result.usedOriginalImage).length;
  return `完成 ${done}/${items.length}，检测成功 ${detected}，回退原图 ${fallback}，失败 ${errors}`;
}

function batchFailureHint(items: BatchResultItem[]) {
  const messages = new Map<string, number>();
  for (const item of items) {
    if (item.status !== 'error' || !item.error) continue;
    const normalized = item.error.replace(/\s+/g, ' ').trim();
    messages.set(normalized, (messages.get(normalized) ?? 0) + 1);
  }
  if (messages.size === 0) return '';
  const summary = [...messages.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([message, count]) => `${message} x${count}`)
    .join('；');
  return `失败原因：${summary}`;
}

function batchTone(items: BatchResultItem[]): Tone {
  const errors = items.some((item) => item.status === 'error');
  if (errors) return 'warn';
  const pending = items.some((item) => item.status === 'pending' || item.status === 'processing');
  return pending ? 'neutral' : 'good';
}

function totalBatchPages(controls: DebugControls, items: BatchResultItem[]) {
  const pageSize = positiveInteger(controls.batchPageSize.value, 24, 4, 80);
  return Math.max(1, Math.ceil(items.length / pageSize));
}

function currentRenderedPage(controls: DebugControls) {
  return positiveInteger(controls.batchGallery.dataset.page ?? '1', 1, 1, 100000);
}

function renderResult(
  controls: DebugControls,
  result: DebugPreprocessResponse,
  originalSource: string,
) {
  showOriginal(controls, originalSource);
  controls.crop.src = `data:${result.contentType || 'image/jpeg'};base64,${result.croppedImageBase64}`;
  controls.crop.hidden = false;
  controls.cropEmpty.hidden = true;

  renderOverlay(controls, result.bboxNorm);
  controls.metrics.innerHTML = [
    metric('策略', result.strategy),
    metric('置信度', result.confidence.toFixed(3), result.usedOriginalImage ? 'warn' : 'good'),
    metric('原图尺寸', `${result.imageWidth} x ${result.imageHeight}`),
    metric('回退原图', result.usedOriginalImage ? '是' : '否', result.usedOriginalImage ? 'warn' : 'good'),
  ].join('');

  controls.metadata.textContent = JSON.stringify(
    {
      strategy: result.strategy,
      usedOriginalImage: result.usedOriginalImage,
      confidence: result.confidence,
      bboxPx: result.bboxPx,
      bboxNorm: result.bboxNorm,
      imageWidth: result.imageWidth,
      imageHeight: result.imageHeight,
      metadata: result.metadata,
    },
    null,
    2,
  );
}

function renderOverlay(controls: DebugControls, bboxNorm: number[] | null) {
  if (!bboxNorm || bboxNorm.length !== 4) {
    controls.overlay.hidden = true;
    return;
  }
  if (!controls.original.complete) {
    controls.original.addEventListener('load', () => renderOverlay(controls, bboxNorm), { once: true });
    return;
  }

  const stage = controls.original.closest<HTMLElement>('.adapt-debugger__image-stage');
  if (!stage) {
    controls.overlay.hidden = true;
    return;
  }
  const imageRect = controls.original.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  if (imageRect.width <= 0 || imageRect.height <= 0) {
    controls.overlay.hidden = true;
    return;
  }

  const [x1, y1, x2, y2] = bboxNorm;
  controls.overlay.style.left = `${imageRect.left - stageRect.left + clamp01(x1) * imageRect.width}px`;
  controls.overlay.style.top = `${imageRect.top - stageRect.top + clamp01(y1) * imageRect.height}px`;
  controls.overlay.style.width = `${Math.max(0, clamp01(x2) - clamp01(x1)) * imageRect.width}px`;
  controls.overlay.style.height = `${Math.max(0, clamp01(y2) - clamp01(y1)) * imageRect.height}px`;
  controls.overlay.hidden = false;
}

function clearResult(controls: DebugControls) {
  controls.crop.hidden = true;
  controls.crop.removeAttribute('src');
  controls.cropEmpty.hidden = false;
  controls.overlay.hidden = true;
  controls.metrics.innerHTML = '';
  controls.metadata.textContent = '{}';
}

function showOriginal(controls: DebugControls, source: string) {
  controls.original.src = source;
  controls.original.hidden = false;
  controls.originalEmpty.hidden = true;
}

function clearOriginal(controls: DebugControls) {
  controls.original.hidden = true;
  controls.original.removeAttribute('src');
  controls.originalEmpty.hidden = false;
  controls.overlay.hidden = true;
}

function setStatus(controls: DebugControls, message: string, tone: Tone) {
  controls.status.textContent = message;
  controls.status.dataset.tone = tone;
}

function metric(label: string, value: string, tone = 'neutral') {
  return `
    <div class="adapt-debugger__metric" data-tone="${escapeHtml(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function readManualBox(controls: DebugControls) {
  const raw = [
    controls.manualX1.value.trim(),
    controls.manualY1.value.trim(),
    controls.manualX2.value.trim(),
    controls.manualY2.value.trim(),
  ];
  if (raw.every((value) => value.length === 0)) return null;
  if (raw.some((value) => value.length === 0)) {
    throw new Error('手动框需要完整填写 x1、y1、x2、y2');
  }
  const values = raw.map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('手动框只能填写 0 到 1 之间的小数');
  }
  return values.map(clamp01);
}

function setManualBox(controls: DebugControls, bboxNorm: number[]) {
  const values = bboxNorm.slice(0, 4).map((value) => clamp01(value).toFixed(4));
  controls.manualX1.value = values[0] ?? '';
  controls.manualY1.value = values[1] ?? '';
  controls.manualX2.value = values[2] ?? '';
  controls.manualY2.value = values[3] ?? '';
}

function clearManualBox(controls: DebugControls) {
  controls.manualX1.value = '';
  controls.manualY1.value = '';
  controls.manualX2.value = '';
  controls.manualY2.value = '';
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function find<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function defaultApiBase() {
  return import.meta.env.PUBLIC_API_BASE_URL || 'http://127.0.0.1:3000';
}

function normalizeApiBase(value: string) {
  return (value.trim() || defaultApiBase()).replace(/\/+$/, '');
}

function hexToRgb(value: string) {
  const normalized = value.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return [245, 245, 245];
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const replacements: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return replacements[char] ?? char;
  });
}
