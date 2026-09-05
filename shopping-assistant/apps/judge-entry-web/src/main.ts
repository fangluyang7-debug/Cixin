import { renderAdaptDebugger } from './adapt-debugger';
import './styles.css';

type JsonRecord = Record<string, unknown>;

interface SubjectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: null | {
    code: string;
    message: string;
    details?: JsonRecord;
  };
}

interface TimelineItem {
  key: string;
  label: string;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  status: 'ok' | 'error' | 'skipped';
  error?: string;
}

interface DebugProduct {
  id?: string;
  title?: string;
  platform?: string;
  priceAmount?: string;
  currency?: string;
  stockStatus?: string;
  shopName?: string | null;
  productUrl?: string;
  brand?: string | null;
  category?: string | null;
  modelLine?: string | null;
  colorFamily?: string | null;
  colorway?: string | null;
  shoeType?: string | null;
  imageUrl?: string;
  normalizedTags?: unknown;
  keywords?: string[];
}

interface AnnResult {
  rank: number;
  productId: string;
  styleId?: string | null;
  imageRole?: string;
  embeddingKind?: string;
  score: number;
  rawScore: number;
  passedMinScore: boolean;
  embeddingId?: string;
  embeddingProvider?: string;
  product?: DebugProduct | null;
}

interface CandidateResult {
  rank: number;
  title: string;
  platformName: string;
  amount: string;
  currency: string;
  shopName?: string;
  shopType?: string;
  stockStatus?: string;
  coverImageUrl?: string;
  productUrl?: string;
  matchSummary?: unknown;
  normalizedAttributes?: unknown;
  recommendationReason?: string[];
  productPoolKey?: string | null;
}

interface DebugResult {
  upload?: JsonRecord;
  meta?: {
    sessionId?: string;
    assetId?: string;
    totalDurationMs?: number;
    cropReadyAtMs?: number | null;
    parameters?: JsonRecord;
    dbStats?: unknown;
  };
  images?: {
    originalImageUrl?: string | null;
    cropImageUrl?: string | null;
    localSubjectDetectionImageUrl?: string | null;
    selectedBox?: SubjectBox;
    preprocessSnapshot?: unknown;
  };
  models?: {
    category?: unknown;
    detailedProfile?: unknown;
  };
  ann?: {
    provider?: string;
    embeddingKind?: string;
    requestedTopK?: number;
    minScore?: number;
    candidatePoolSize?: number;
    returnedCount?: number;
    passedMinScoreCount?: number;
    topKAfterMinScore?: AnnResult[];
    results?: AnnResult[];
  };
  fastCandidates?: CandidateResult[];
  refinedCandidates?: CandidateResult[];
  timeline?: TimelineItem[];
}

const app = document.querySelector<HTMLElement>('#app');

if (!app) {
  throw new Error('App root not found.');
}

const path = window.location.pathname.replace(/\/+$/, '') || '/';

if (path === '/adapt-debugger') {
  renderAdaptDebugger(app);
} else {
const defaultApiBase =
  localStorage.getItem('debug-api-base') ??
  import.meta.env.PUBLIC_API_BASE_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  'https://apiserver.zeabur.app';

const categoryOptions = [
  ['shoe', 'shoe · 鞋'],
  ['camera', 'camera · 相机'],
  ['headphones', 'headphones · 耳机'],
  ['smartwatch', 'smartwatch · 数码手表'],
  ['phone', 'phone · 手机'],
  ['computer', 'computer · 电脑'],
  ['tablet', 'tablet · 平板'],
  ['keyboard', 'keyboard · 键盘'],
  ['mouse', 'mouse · 鼠标'],
  ['home_appliance', 'home_appliance · 家电'],
  ['digital_other', 'digital_other · 其他数码'],
]
  .map(([value, label]) => `<option value="${value}">${label}</option>`)
  .join('');

app.innerHTML = `
  <main class="debug-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">SoleAI Search Debug</p>
        <h1>图片搜索链路诊断台</h1>
      </div>
      <nav class="topbar-links" aria-label="debug navigation">
        <a class="ops-entry-link" href="/catalog.html">商品池展示</a>
        <a class="ops-entry-link" href="/product-pool.html">商品池运维中心</a>
      </nav>
      <label class="api-field">
        <span>API Base</span>
        <input id="apiBase" value="${escapeHtml(defaultApiBase)}" spellcheck="false" />
      </label>
    </header>

    <section class="workspace">
      <aside class="controls-panel">
        <label class="file-picker">
          <span>上传图片</span>
          <input id="fileInput" type="file" accept="image/png,image/jpeg,image/webp" />
        </label>

        <div class="preview-frame" id="previewFrame">
          <img id="previewImage" alt="query preview" />
          <div class="selection-box" id="selectionBox"></div>
          <div class="empty-preview" id="emptyPreview">等待图片</div>
        </div>

        <div class="box-grid">
          <label><span>X</span><input id="boxX" type="number" min="0" max="1" step="0.001" value="0" /></label>
          <label><span>Y</span><input id="boxY" type="number" min="0" max="1" step="0.001" value="0" /></label>
          <label><span>W</span><input id="boxWidth" type="number" min="0.01" max="1" step="0.001" value="1" /></label>
          <label><span>H</span><input id="boxHeight" type="number" min="0.01" max="1" step="0.001" value="1" /></label>
        </div>

        <div class="params-grid">
          <label><span>Top K</span><input id="topK" type="number" min="1" max="200" step="1" value="50" /></label>
          <label><span>Min Score</span><input id="minScore" type="number" min="0" max="1" step="0.01" value="0.68" /></label>
          <label><span>Result Limit</span><input id="resultLimit" type="number" min="1" max="100" step="1" value="30" /></label>
          <label><span>Category Hint</span><select id="categoryHint">${categoryOptions}</select></label>
          <label><span>Embedding Kind</span><select id="embeddingKind"><option value="visual">visual</option><option value="multimodal">multimodal</option></select></label>
        </div>

        <div class="toggle-row">
          <label><input id="runDetailed" type="checkbox" checked /> 详细标签模型</label>
          <label><input id="runRefined" type="checkbox" checked /> 深度融合复核</label>
        </div>

        <button class="run-button" id="runButton" type="button">运行真实搜索链路</button>
        <p class="status" id="statusText">未运行</p>
      </aside>

      <section class="results-panel">
        <div class="summary-grid" id="summaryGrid"></div>
        <section class="panel">
          <div class="panel-title">
            <h2>阶段耗时</h2>
            <span id="totalTime">0 ms</span>
          </div>
          <div class="timeline" id="timeline"></div>
        </section>

        <section class="media-grid">
          <article class="media-panel">
            <h2>原图</h2>
            <div class="media-slot" id="originalImageSlot"></div>
          </article>
          <article class="media-panel">
            <h2>ANN 实际输入（用户框标准图）</h2>
            <div class="media-slot" id="cropImageSlot"></div>
          </article>
          <article class="media-panel">
            <h2>本地主体检测预览（类别识别）</h2>
            <div class="media-slot" id="localDetectionImageSlot"></div>
          </article>
        </section>

        <section class="panel two-col">
          <div>
            <h2>轻量类别识别</h2>
            <pre id="categoryJson">{}</pre>
          </div>
          <div>
            <h2>详细标签识别</h2>
            <pre id="profileJson">{}</pre>
          </div>
        </section>

        <section class="panel">
          <div class="panel-title">
            <h2>ANN 原始召回</h2>
            <span id="annMeta">0 results</span>
          </div>
          <div class="product-grid" id="annGrid"></div>
        </section>

        <section class="panel">
          <div class="panel-title">
            <h2>通过 Min Score 的 Top K</h2>
            <span id="annPassedMeta">0 results</span>
          </div>
          <div class="product-grid" id="annPassedGrid"></div>
        </section>

        <section class="panel">
          <div class="panel-title">
            <h2>首屏 Fast Candidates</h2>
            <span id="fastMeta">0 results</span>
          </div>
          <div class="product-grid" id="fastGrid"></div>
        </section>

        <section class="panel">
          <div class="panel-title">
            <h2>深度融合 Candidates</h2>
            <span id="refinedMeta">0 results</span>
          </div>
          <div class="product-grid" id="refinedGrid"></div>
        </section>

        <section class="panel">
          <h2>预处理快照</h2>
          <pre id="preprocessJson">{}</pre>
        </section>

        <section class="panel">
          <h2>完整响应</h2>
          <pre id="rawJson">{}</pre>
        </section>
      </section>
    </section>
  </main>
`;

const apiBaseInput = requireElement<HTMLInputElement>('apiBase');
const fileInput = requireElement<HTMLInputElement>('fileInput');
const previewFrame = requireElement<HTMLElement>('previewFrame');
const previewImage = requireElement<HTMLImageElement>('previewImage');
const emptyPreview = requireElement<HTMLElement>('emptyPreview');
const selectionBox = requireElement<HTMLElement>('selectionBox');
const runButton = requireElement<HTMLButtonElement>('runButton');
const statusText = requireElement<HTMLElement>('statusText');

const boxInputs = {
  x: requireElement<HTMLInputElement>('boxX'),
  y: requireElement<HTMLInputElement>('boxY'),
  width: requireElement<HTMLInputElement>('boxWidth'),
  height: requireElement<HTMLInputElement>('boxHeight'),
};

let selectedFile: File | null = null;
let box: SubjectBox = { x: 0, y: 0, width: 1, height: 1 };
let dragStart: { x: number; y: number } | null = null;

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0] ?? null;
  selectedFile = file;
  if (!file) {
    previewImage.removeAttribute('src');
    previewFrame.classList.remove('has-image');
    emptyPreview.hidden = false;
    statusText.textContent = '未选择图片';
    return;
  }
  const url = URL.createObjectURL(file);
  previewImage.src = url;
  previewImage.onload = () => {
    previewFrame.classList.add('has-image');
    emptyPreview.hidden = true;
    box = { x: 0, y: 0, width: 1, height: 1 };
    syncBoxInputs();
    renderSelectionBox();
  };
  statusText.textContent = `${file.name} · ${formatBytes(file.size)}`;
});

for (const input of Object.values(boxInputs)) {
  input.addEventListener('input', () => {
    box = normalizeBox({
      x: readNumber(boxInputs.x.value, box.x),
      y: readNumber(boxInputs.y.value, box.y),
      width: readNumber(boxInputs.width.value, box.width),
      height: readNumber(boxInputs.height.value, box.height),
    });
    syncBoxInputs(false);
    renderSelectionBox();
  });
}

apiBaseInput.addEventListener('change', () => {
  localStorage.setItem('debug-api-base', apiBaseInput.value.trim());
});

previewFrame.addEventListener('pointerdown', (event) => {
  if (!selectedFile) return;
  const point = pointerToNormalized(event);
  dragStart = point;
  box = { x: point.x, y: point.y, width: 0.01, height: 0.01 };
  previewFrame.setPointerCapture(event.pointerId);
  syncBoxInputs();
  renderSelectionBox();
});

previewFrame.addEventListener('pointermove', (event) => {
  if (!dragStart) return;
  const point = pointerToNormalized(event);
  box = normalizeBox({
    x: Math.min(dragStart.x, point.x),
    y: Math.min(dragStart.y, point.y),
    width: Math.abs(point.x - dragStart.x),
    height: Math.abs(point.y - dragStart.y),
  });
  syncBoxInputs();
  renderSelectionBox();
});

previewFrame.addEventListener('pointerup', (event) => {
  if (!dragStart) return;
  previewFrame.releasePointerCapture(event.pointerId);
  dragStart = null;
  box = normalizeBox(box);
  syncBoxInputs();
  renderSelectionBox();
});

runButton.addEventListener('click', () => {
  void runDebugSearch();
});

renderEmptyResults();
renderSelectionBox();

async function runDebugSearch() {
  if (!selectedFile) {
    statusText.textContent = '请选择图片';
    return;
  }

  localStorage.setItem('debug-api-base', apiBaseInput.value.trim());
  runButton.disabled = true;
  statusText.textContent = '运行中';

  try {
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('boxX', String(box.x));
    formData.append('boxY', String(box.y));
    formData.append('boxWidth', String(box.width));
    formData.append('boxHeight', String(box.height));
    formData.append('topK', readInputValue('topK', '50'));
    formData.append('minScore', readInputValue('minScore', '0.68'));
    formData.append('resultLimit', readInputValue('resultLimit', '30'));
    formData.append('categoryHint', readInputValue('categoryHint', 'shoe'));
    formData.append('embeddingKind', readInputValue('embeddingKind', 'visual'));
    formData.append('runDetailed', String(requireElement<HTMLInputElement>('runDetailed').checked));
    formData.append('runRefined', String(requireElement<HTMLInputElement>('runRefined').checked));

    const response = await fetch(`${apiBaseInput.value.trim().replace(/\/$/, '')}/api/v1/debug/image-search`, {
      method: 'POST',
      body: formData,
    });
    const payload = (await response.json()) as ApiResponse<DebugResult>;
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error?.message ?? payload.error?.code ?? `HTTP_${response.status}`);
    }

    renderResult(payload.data);
    statusText.textContent = `完成 · ${formatMs(payload.data.meta?.totalDurationMs ?? 0)}`;
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : '运行失败';
  } finally {
    runButton.disabled = false;
  }
}

function renderResult(result: DebugResult) {
  const annResults = result.ann?.results ?? [];
  const annPassed = result.ann?.topKAfterMinScore ?? [];
  const fast = result.fastCandidates ?? [];
  const refined = result.refinedCandidates ?? [];

  requireElement<HTMLElement>('summaryGrid').innerHTML = [
    summaryItem('Session', result.meta?.sessionId ?? '-'),
    summaryItem('Total', formatMs(result.meta?.totalDurationMs ?? 0)),
    summaryItem('Crop Ready', result.meta?.cropReadyAtMs === null ? '-' : formatMs(result.meta?.cropReadyAtMs ?? 0)),
    summaryItem('Embedding', String(result.ann?.embeddingKind ?? result.meta?.parameters?.embeddingKind ?? '-')),
    summaryItem('Pool', String(result.ann?.candidatePoolSize ?? 0)),
    summaryItem('ANN Returned', String(result.ann?.returnedCount ?? annResults.length)),
    summaryItem('ANN Passed', String(result.ann?.passedMinScoreCount ?? annPassed.length)),
    summaryItem('Fast', String(fast.length)),
    summaryItem('Refined', String(refined.length)),
  ].join('');

  requireElement<HTMLElement>('totalTime').textContent = formatMs(result.meta?.totalDurationMs ?? 0);
  renderTimeline(result.timeline ?? []);

  renderImageSlot('originalImageSlot', result.images?.originalImageUrl ?? null);
  renderImageSlot('cropImageSlot', result.images?.cropImageUrl ?? null);
  renderImageSlot(
    'localDetectionImageSlot',
    result.images?.localSubjectDetectionImageUrl ?? null,
  );
  renderJson('categoryJson', result.models?.category ?? null);
  renderJson('profileJson', result.models?.detailedProfile ?? null);
  renderJson('preprocessJson', result.images?.preprocessSnapshot ?? null);
  renderJson('rawJson', result);

  requireElement<HTMLElement>('annMeta').textContent =
    `${annResults.length} results · TopK ${result.ann?.requestedTopK ?? '-'} · min ${result.ann?.minScore ?? '-'}`;
  requireElement<HTMLElement>('annMeta').textContent =
    `${annResults.length} results | ${result.ann?.embeddingKind ?? '-'} | TopK ${result.ann?.requestedTopK ?? '-'} | min ${result.ann?.minScore ?? '-'}`;
  requireElement<HTMLElement>('annPassedMeta').textContent = `${annPassed.length} results`;
  requireElement<HTMLElement>('fastMeta').textContent = `${fast.length} results`;
  requireElement<HTMLElement>('refinedMeta').textContent = `${refined.length} results`;

  requireElement<HTMLElement>('annGrid').innerHTML = annResults.map(renderAnnCard).join('') || emptyState('无 ANN 结果');
  requireElement<HTMLElement>('annPassedGrid').innerHTML =
    annPassed.map(renderAnnCard).join('') || emptyState('无通过阈值结果');
  requireElement<HTMLElement>('fastGrid').innerHTML = fast.map(renderCandidateCard).join('') || emptyState('无首屏候选');
  requireElement<HTMLElement>('refinedGrid').innerHTML =
    refined.map(renderCandidateCard).join('') || emptyState('无深度融合候选');
}

function renderTimeline(items: TimelineItem[]) {
  const maxDuration = Math.max(1, ...items.map((item) => item.durationMs));
  const html = items
    .map((item) => {
      const width = Math.max(3, Math.round((item.durationMs / maxDuration) * 100));
      return `
        <div class="timeline-row">
          <div class="timeline-label">
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(item.key)} · ${item.status}</span>
          </div>
          <div class="timeline-track">
            <span style="width:${width}%"></span>
          </div>
          <div class="timeline-time">${formatMs(item.durationMs)}</div>
        </div>
      `;
    })
    .join('');
  requireElement<HTMLElement>('timeline').innerHTML = html || emptyState('暂无耗时');
}

function renderAnnCard(item: AnnResult) {
  const product = item.product ?? {};
  const title = product.title ?? item.productId;
  const price = product.priceAmount ? `${product.currency ?? 'CNY'} ${product.priceAmount}` : '-';
  return `
    <article class="product-card">
      ${renderThumb(product.imageUrl, title)}
      <div class="product-body">
        <div class="rank-line">
          <strong>#${item.rank}</strong>
          <span class="${item.passedMinScore ? 'score score-ok' : 'score'}">${formatScore(item.score)}</span>
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(product.platform ?? '-')} · ${escapeHtml(price)}</p>
        <p>${escapeHtml(product.brand ?? '-')} · ${escapeHtml(product.modelLine ?? '-')}</p>
        <p>${escapeHtml(product.colorway ?? product.colorFamily ?? '-')}</p>
        <p>${escapeHtml(item.embeddingKind ?? '-')} | ${escapeHtml(item.imageRole ?? '-')}</p>
        <div class="mono">${escapeHtml(item.productId)}</div>
      </div>
    </article>
  `;
}

function renderCandidateCard(item: CandidateResult) {
  return `
    <article class="product-card">
      ${renderThumb(item.coverImageUrl, item.title)}
      <div class="product-body">
        <div class="rank-line">
          <strong>#${item.rank}</strong>
          <span class="score score-ok">${escapeHtml(item.stockStatus ?? 'unknown')}</span>
        </div>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.platformName)} · ${escapeHtml(item.currency)} ${escapeHtml(item.amount)}</p>
        <p>${escapeHtml(item.shopName ?? '-')} · ${escapeHtml(item.shopType ?? '-')}</p>
        <div class="mono">${escapeHtml(item.productPoolKey ?? '-')}</div>
        <details>
          <summary>match</summary>
          <pre>${escapeHtml(JSON.stringify(item.matchSummary ?? {}, null, 2))}</pre>
        </details>
      </div>
    </article>
  `;
}

function renderThumb(url: string | undefined, alt: string) {
  if (!url) return '<div class="thumb thumb-empty">无图</div>';
  return `<a class="thumb" href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" /></a>`;
}

function renderImageSlot(id: string, url: string | null) {
  const slot = requireElement<HTMLElement>(id);
  slot.innerHTML = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(url)}" alt="${id}" /></a>`
    : emptyState('暂无图片');
}

function renderJson(id: string, value: unknown) {
  requireElement<HTMLElement>(id).textContent = JSON.stringify(value ?? {}, null, 2);
}

function renderEmptyResults() {
  requireElement<HTMLElement>('summaryGrid').innerHTML = [
    summaryItem('Session', '-'),
    summaryItem('Total', '0 ms'),
    summaryItem('ANN Returned', '0'),
    summaryItem('Fast', '0'),
  ].join('');
  renderTimeline([]);
  renderImageSlot('originalImageSlot', null);
  renderImageSlot('cropImageSlot', null);
  renderImageSlot('localDetectionImageSlot', null);
}

function summaryItem(label: string, value: string) {
  return `
    <article class="summary-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `;
}

function emptyState(text: string) {
  return `<div class="empty-state">${escapeHtml(text)}</div>`;
}

function syncBoxInputs(updateValues = true) {
  if (updateValues) {
    boxInputs.x.value = toFixed(box.x);
    boxInputs.y.value = toFixed(box.y);
    boxInputs.width.value = toFixed(box.width);
    boxInputs.height.value = toFixed(box.height);
  }
}

function renderSelectionBox() {
  selectionBox.style.left = `${box.x * 100}%`;
  selectionBox.style.top = `${box.y * 100}%`;
  selectionBox.style.width = `${box.width * 100}%`;
  selectionBox.style.height = `${box.height * 100}%`;
}

function pointerToNormalized(event: PointerEvent) {
  const rect = previewImage.getBoundingClientRect();
  return {
    x: clamp01((event.clientX - rect.left) / Math.max(1, rect.width)),
    y: clamp01((event.clientY - rect.top) / Math.max(1, rect.height)),
  };
}

function normalizeBox(value: SubjectBox): SubjectBox {
  const x = clamp01(value.x);
  const y = clamp01(value.y);
  const width = Math.max(0.01, Math.min(1 - x, value.width));
  const height = Math.max(0.01, Math.min(1 - y, value.height));
  return { x, y, width, height };
}

function readInputValue(id: string, fallback: string) {
  const value = requireElement<HTMLInputElement>(id).value.trim();
  return value.length > 0 ? value : fallback;
}

function readNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMs(value: number) {
  if (!Number.isFinite(value)) return '-';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

function formatScore(value: number) {
  return Number.isFinite(value) ? value.toFixed(4) : '-';
}

function formatBytes(value: number) {
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value > 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function toFixed(value: number) {
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Element not found: ${id}`);
  return element as T;
}

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
}
