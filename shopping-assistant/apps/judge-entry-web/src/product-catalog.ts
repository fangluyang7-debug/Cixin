import { ProductPoolApi } from './product-pool/api';
import type {
  ProductDetail,
  ProductListItem,
  ProductPoolStats,
} from './product-pool/types';
import './product-catalog.css';

interface CatalogState {
  apiBase: string;
  keyword: string;
  platform: string;
  category: string;
  hasEmbedding: string;
  limit: number;
  offset: number;
  total: number;
  loading: boolean;
  stats: ProductPoolStats | null;
  items: ProductListItem[];
}

const DEFAULT_API_BASE =
  localStorage.getItem('catalog-api-base') ??
  import.meta.env.PUBLIC_API_BASE_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  'https://apiserver.zeabur.app';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('App root not found.');

const state: CatalogState = {
  apiBase: DEFAULT_API_BASE,
  keyword: '',
  platform: '',
  category: '',
  hasEmbedding: 'true',
  limit: 24,
  offset: 0,
  total: 0,
  loading: false,
  stats: null,
  items: [],
};

const api = new ProductPoolApi(() => state.apiBase, () => '');

app.innerHTML = `
  <main class="catalog-shell">
    <section class="catalog-hero">
      <div>
        <p class="eyebrow">Real Product Pool</p>
        <h1>真实商品池展示</h1>
        <p>
          面向评委展示已入库的真实商品数据，包含商品图片、平台、店铺、价格、商品 URL、
          品类标签和 embedding 状态。该页面只读取公开展示接口，不包含上传、删除或重建等运维操作。
        </p>
        <div class="hero-actions">
          <a class="link-button" href="/">评委入口</a>
          <a class="link-button" href="/debug.html">图片搜索测试</a>
          <a class="link-button" href="/product-pool.html">运维中心</a>
        </div>
      </div>
      <div class="api-panel">
        <label>
          <span>API 地址</span>
          <input id="apiBase" value="${escapeHtml(state.apiBase)}" spellcheck="false" />
        </label>
        <div class="api-hint">默认连接云端接口。评委演示时可直接刷新数据，不需要维护 token。</div>
        <button class="primary-button" id="refreshButton" type="button">刷新商品池</button>
      </div>
    </section>

    <section class="catalog-main">
      <div class="stats-grid" id="statsGrid"></div>

      <section class="filter-panel">
        <div class="filters">
          <label>
            <span>关键词</span>
            <input id="keywordInput" placeholder="标题、品牌、店铺、URL 关键词" />
          </label>
          <label>
            <span>平台</span>
            <select id="platformSelect"></select>
          </label>
          <label>
            <span>品类</span>
            <select id="categorySelect"></select>
          </label>
          <label>
            <span>Embedding</span>
            <select id="embeddingSelect">
              <option value="true">只看可检索商品</option>
              <option value="">全部商品</option>
              <option value="false">未生成 embedding</option>
            </select>
          </label>
          <label>
            <span>每页</span>
            <select id="limitSelect">
              <option value="24">24</option>
              <option value="48">48</option>
              <option value="96">96</option>
            </select>
          </label>
        </div>
        <div class="filter-actions">
          <button class="primary-button" id="searchButton" type="button">应用筛选</button>
          <button class="ghost-button" id="resetButton" type="button">重置</button>
          <span class="status-text" id="statusText">准备加载</span>
        </div>
      </section>

      <section class="distribution-grid">
        <article class="chart-panel">
          <h2>平台分布</h2>
          <div class="bar-list" id="platformBars"></div>
        </article>
        <article class="chart-panel">
          <h2>品类分布</h2>
          <div class="bar-list" id="categoryBars"></div>
        </article>
      </section>

      <section class="list-header">
        <h2 id="listTitle">商品列表</h2>
        <div class="pager">
          <button id="prevButton" type="button">上一页</button>
          <span id="pageText">第 1 页</span>
          <button id="nextButton" type="button">下一页</button>
        </div>
      </section>

      <section class="product-grid" id="productGrid"></section>
    </section>

    <aside class="detail-panel" id="detailPanel" aria-live="polite"></aside>
  </main>
`;

const refs = {
  apiBase: requireElement<HTMLInputElement>('apiBase'),
  refreshButton: requireElement<HTMLButtonElement>('refreshButton'),
  keywordInput: requireElement<HTMLInputElement>('keywordInput'),
  platformSelect: requireElement<HTMLSelectElement>('platformSelect'),
  categorySelect: requireElement<HTMLSelectElement>('categorySelect'),
  embeddingSelect: requireElement<HTMLSelectElement>('embeddingSelect'),
  limitSelect: requireElement<HTMLSelectElement>('limitSelect'),
  searchButton: requireElement<HTMLButtonElement>('searchButton'),
  resetButton: requireElement<HTMLButtonElement>('resetButton'),
  statusText: requireElement<HTMLElement>('statusText'),
  statsGrid: requireElement<HTMLElement>('statsGrid'),
  platformBars: requireElement<HTMLElement>('platformBars'),
  categoryBars: requireElement<HTMLElement>('categoryBars'),
  listTitle: requireElement<HTMLElement>('listTitle'),
  productGrid: requireElement<HTMLElement>('productGrid'),
  prevButton: requireElement<HTMLButtonElement>('prevButton'),
  nextButton: requireElement<HTMLButtonElement>('nextButton'),
  pageText: requireElement<HTMLElement>('pageText'),
  detailPanel: requireElement<HTMLElement>('detailPanel'),
};

refs.refreshButton.addEventListener('click', () => {
  state.apiBase = refs.apiBase.value.trim();
  localStorage.setItem('catalog-api-base', state.apiBase);
  state.offset = 0;
  void loadCatalog();
});

refs.searchButton.addEventListener('click', () => {
  applyFiltersFromInputs();
  state.offset = 0;
  void loadProducts();
});

refs.resetButton.addEventListener('click', () => {
  refs.keywordInput.value = '';
  refs.platformSelect.value = '';
  refs.categorySelect.value = '';
  refs.embeddingSelect.value = 'true';
  refs.limitSelect.value = '24';
  applyFiltersFromInputs();
  state.offset = 0;
  void loadProducts();
});

refs.keywordInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    applyFiltersFromInputs();
    state.offset = 0;
    void loadProducts();
  }
});

refs.prevButton.addEventListener('click', () => {
  state.offset = Math.max(0, state.offset - state.limit);
  void loadProducts();
});

refs.nextButton.addEventListener('click', () => {
  if (state.offset + state.limit >= state.total) return;
  state.offset += state.limit;
  void loadProducts();
});

refs.productGrid.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const detailButton = target.closest<HTMLButtonElement>('[data-detail-id]');
  if (detailButton) {
    void openDetail(detailButton.dataset.detailId ?? '');
    return;
  }

  const copyButton = target.closest<HTMLButtonElement>('[data-copy-url]');
  if (copyButton) {
    void copyText(copyButton.dataset.copyUrl ?? '');
  }
});

refs.detailPanel.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  if (target.closest('[data-close-detail]')) {
    closeDetail();
  }
});

renderFilterOptionsFallback();
renderLoadingShell();
void loadCatalog();

async function loadCatalog() {
  setLoading(true, '正在加载商品列表');
  try {
    await loadProducts(false);
  } catch (error) {
    renderError(error);
  } finally {
    setLoading(false);
  }

  refs.statusText.textContent = '正在加载统计分布';
  try {
    const stats = await withTimeout(api.stats(), 12000);
    state.stats = stats;
    renderStats(stats);
    renderFilterOptions(stats);
    renderDistributions(stats);
    refs.statusText.textContent = `已加载 ${state.items.length} 条，共 ${state.total} 条`;
  } catch (error) {
    refs.statusText.textContent = `商品已显示，统计加载较慢：${error instanceof Error ? error.message : '超时'}`;
    renderStatsFallback();
  }
}

async function loadProducts(toggleLoading = true) {
  if (toggleLoading) setLoading(true, '正在加载商品列表');
  try {
    const params = new URLSearchParams();
    params.set('limit', String(state.limit));
    params.set('offset', String(state.offset));
    if (state.keyword) params.set('keyword', state.keyword);
    if (state.platform) params.set('platform', state.platform);
    if (state.category) params.set('category', state.category);
    if (state.hasEmbedding) params.set('hasEmbedding', state.hasEmbedding);

    const result = await api.products(params);
    state.total = result.total;
    state.items = result.items;
    renderProducts(result.items);
    renderPagination();
    refs.statusText.textContent = `已加载 ${result.items.length} 条，共 ${result.total} 条`;
  } catch (error) {
    renderError(error);
  } finally {
    if (toggleLoading) setLoading(false);
  }
}

async function openDetail(productId: string) {
  if (!productId) return;
  refs.detailPanel.classList.add('is-open');
  refs.detailPanel.innerHTML = `
    <div class="detail-header">
      <h2>商品详情</h2>
      <button type="button" data-close-detail>×</button>
    </div>
    ${emptyState('正在加载详情')}
  `;

  try {
    const detail = await api.product(productId);
    refs.detailPanel.innerHTML = renderDetail(detail);
  } catch (error) {
    refs.detailPanel.innerHTML = `
      <div class="detail-header">
        <h2>商品详情</h2>
        <button type="button" data-close-detail>×</button>
      </div>
      ${emptyState(error instanceof Error ? error.message : '详情加载失败')}
    `;
  }
}

function closeDetail() {
  refs.detailPanel.classList.remove('is-open');
  refs.detailPanel.innerHTML = '';
}

function applyFiltersFromInputs() {
  state.keyword = refs.keywordInput.value.trim();
  state.platform = refs.platformSelect.value;
  state.category = refs.categorySelect.value;
  state.hasEmbedding = refs.embeddingSelect.value;
  state.limit = Number(refs.limitSelect.value) || 24;
}

function renderStats(stats: ProductPoolStats) {
  refs.statsGrid.innerHTML = [
    statCard('商品总数', formatNumber(stats.totalProducts), '已入库真实商品'),
    statCard('可检索商品', formatNumber(stats.searchableProducts), '可进入 ANN 召回'),
    statCard('Embedding 总数', formatNumber(stats.embeddingCount), '向量库检索基础'),
    statCard(
      '图片向量商品',
      formatNumber(stats.embeddingCoverage.visualProducts),
      `覆盖率 ${formatPercent(stats.embeddingCoverage.visualRate)}`,
    ),
  ].join('');
}

function renderFilterOptions(stats: ProductPoolStats) {
  const platforms = stats.platformGroups ?? [];
  refs.platformSelect.innerHTML = [
    '<option value="">全部平台</option>',
    ...platforms.map(
      (item) =>
        `<option value="${escapeHtml(item.platform)}">${escapeHtml(platformLabel(item.platform))} (${item.count})</option>`,
    ),
  ].join('');
  refs.platformSelect.value = state.platform;

  refs.categorySelect.innerHTML = [
    '<option value="">全部品类</option>',
    ...stats.categoryGroups.slice(0, 80).map((item) => {
      const value = item.category ?? item.normalizedCategory;
      const label = item.category ?? item.normalizedCategory;
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)} (${item.count})</option>`;
    }),
  ].join('');
  refs.categorySelect.value = state.category;
}

function renderFilterOptionsFallback() {
  refs.platformSelect.innerHTML = [
    '<option value="">全部平台</option>',
    '<option value="jd">京东 · jd</option>',
    '<option value="taobao">淘宝 · taobao</option>',
    '<option value="tmall">天猫 · tmall</option>',
    '<option value="suning">苏宁 · suning</option>',
    '<option value="vipshop">唯品会 · vipshop</option>',
    '<option value="xianyu">闲鱼 · xianyu</option>',
  ].join('');
  refs.categorySelect.innerHTML = [
    '<option value="">全部品类</option>',
    '<option value="shoe">鞋类 · shoe</option>',
    '<option value="digital_other">数码/家电 · digital_other</option>',
    '<option value="clothing">服饰 · clothing</option>',
    '<option value="home_appliance">家电 · home_appliance</option>',
  ].join('');
}

function renderDistributions(stats: ProductPoolStats) {
  refs.platformBars.innerHTML = renderBars(
    (stats.platformGroups ?? []).map((item) => ({
      label: platformLabel(item.platform),
      count: item.count,
    })),
  );
  refs.categoryBars.innerHTML = renderBars(
    stats.categoryGroups.slice(0, 10).map((item) => ({
      label: item.category ?? item.normalizedCategory,
      count: item.count,
    })),
  );
}

function renderBars(items: Array<{ label: string; count: number }>) {
  if (items.length === 0) return emptyState('暂无分布数据');
  const max = Math.max(...items.map((item) => item.count), 1);
  return items
    .map(
      (item) => `
        <div class="bar-row">
          <span title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
          <div class="bar-track"><i style="width:${Math.max(3, Math.round((item.count / max) * 100))}%"></i></div>
          <span>${formatNumber(item.count)}</span>
        </div>
      `,
    )
    .join('');
}

function renderProducts(items: ProductListItem[]) {
  refs.listTitle.textContent = `商品列表 · ${formatNumber(state.total)} 条`;
  refs.productGrid.innerHTML =
    items.map(renderProductCard).join('') || emptyState('没有符合当前筛选条件的商品');
}

function renderProductCard(item: ProductListItem) {
  const shop = item.shopName || item.shopType || '店铺信息待补充';
  const price = formatPrice(item.price);
  const category = item.category || item.modelLine || '未分类';
  return `
    <article class="product-card">
      <a class="product-image" href="${escapeAttribute(item.imageUrl || item.productUrl)}" target="_blank" rel="noreferrer">
        ${
          item.imageUrl
            ? `<img src="${escapeAttribute(item.imageUrl)}" alt="${escapeAttribute(item.title)}" loading="lazy" />`
            : '<div class="image-empty">暂无图片</div>'
        }
      </a>
      <div class="product-body">
        <div class="meta-line">
          <span class="badge">${escapeHtml(platformLabel(item.platform))}</span>
          <span class="badge">${escapeHtml(category)}</span>
          <span class="badge ${item.embeddingReady ? 'good' : 'warn'}">
            ${item.embeddingReady ? `向量 ${item.counts.embeddings}` : '未向量化'}
          </span>
        </div>
        <h3 class="product-title">${escapeHtml(item.title)}</h3>
        <p>店铺：${escapeHtml(shop)}</p>
        <p>价格：${escapeHtml(price)} · 库存：${escapeHtml(item.stockStatus || '-')}</p>
        <p>品牌：${escapeHtml(item.brand || '-')} · 标签：${escapeHtml(item.tagStatus)}</p>
        <div class="url-line" title="${escapeAttribute(item.productUrl)}">${escapeHtml(item.productUrl)}</div>
        <div class="card-actions">
          <a href="${escapeAttribute(item.productUrl)}" target="_blank" rel="noreferrer">商品页</a>
          <button type="button" data-copy-url="${escapeAttribute(item.productUrl)}">复制 URL</button>
          <button type="button" data-detail-id="${escapeAttribute(item.productId)}">详情</button>
        </div>
      </div>
    </article>
  `;
}

function renderDetail(detail: ProductDetail) {
  const embeddings = detail.embeddings ?? [];
  return `
    <div class="detail-header">
      <h2>商品详情</h2>
      <button type="button" data-close-detail>×</button>
    </div>
    <div class="detail-image">
      ${
        detail.imageUrl
          ? `<img src="${escapeAttribute(detail.imageUrl)}" alt="${escapeAttribute(detail.title)}" />`
          : '<div class="image-empty">暂无图片</div>'
      }
    </div>
    <table class="detail-table">
      <tbody>
        ${detailRow('标题', detail.title)}
        ${detailRow('平台', platformLabel(detail.platform))}
        ${detailRow('店铺', detail.shopName || detail.shopType || '-')}
        ${detailRow('价格', formatPrice(detail.price))}
        ${detailRow('商品 URL', detail.productUrl)}
        ${detailRow('商品 ID', detail.productId)}
        ${detailRow('外部 ID', detail.externalId || '-')}
        ${detailRow('品类/品牌', `${detail.category || '-'} / ${detail.brand || '-'}`)}
        ${detailRow('导入批次', detail.importBatch?.batchSource || detail.importBatchId || '-')}
        ${detailRow('更新时间', formatDate(detail.updatedAt))}
      </tbody>
    </table>
    <section>
      <h2>Embedding 记录</h2>
      <div class="embedding-list">
        ${
          embeddings
            .map(
              (item) => `
                <div class="embedding-item">
                  <strong>${escapeHtml(item.embeddingKind)}</strong>
                  · ${escapeHtml(item.provider)}
                  · ${escapeHtml(item.dimension)} 维
                  · ${escapeHtml(item.imageRole)}
                  <br />
                  ${escapeHtml(item.modelName || '-')} · ${escapeHtml(formatDate(item.createdAt))}
                </div>
              `,
            )
            .join('') || emptyState('暂无 embedding 记录')
        }
      </div>
    </section>
  `;
}

function renderPagination() {
  const currentPage = Math.floor(state.offset / state.limit) + 1;
  const totalPages = Math.max(1, Math.ceil(state.total / state.limit));
  refs.pageText.textContent = `第 ${currentPage} / ${totalPages} 页`;
  refs.prevButton.disabled = state.offset <= 0 || state.loading;
  refs.nextButton.disabled = state.offset + state.limit >= state.total || state.loading;
}

function renderLoadingShell() {
  renderStatsFallback();
  refs.platformBars.innerHTML = emptyState('等待加载');
  refs.categoryBars.innerHTML = emptyState('等待加载');
  refs.productGrid.innerHTML = emptyState('等待加载商品');
}

function renderStatsFallback() {
  refs.statsGrid.innerHTML = [
    statCard('商品总数', state.total ? formatNumber(state.total) : '-', '来自当前列表接口'),
    statCard('当前页商品', formatNumber(state.items.length), '本页已加载数量'),
    statCard('Embedding 状态', state.hasEmbedding === 'true' ? '可检索' : '全部', '当前筛选条件'),
    statCard('接口状态', state.items.length > 0 ? '正常' : '-', '公开只读接口'),
  ].join('');
}

function renderError(error: unknown) {
  const message = error instanceof Error ? error.message : '加载失败';
  refs.statusText.textContent = message;
  refs.productGrid.innerHTML = emptyState(message);
}

function setLoading(loading: boolean, message?: string) {
  state.loading = loading;
  refs.refreshButton.disabled = loading;
  refs.searchButton.disabled = loading;
  refs.prevButton.disabled = loading || state.offset <= 0;
  refs.nextButton.disabled = loading || state.offset + state.limit >= state.total;
  if (message) refs.statusText.textContent = message;
}

function statCard(label: string, value: string, note: string) {
  return `
    <article class="stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </article>
  `;
}

function detailRow(label: string, value: string) {
  return `
    <tr>
      <th>${escapeHtml(label)}</th>
      <td>${escapeHtml(value)}</td>
    </tr>
  `;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    refs.statusText.textContent = '已复制商品 URL';
  } catch {
    refs.statusText.textContent = '复制失败，可以直接打开商品页';
  }
}

function emptyState(text: string) {
  return `<div class="empty-state">${escapeHtml(text)}</div>`;
}

function formatPrice(price: ProductListItem['price']) {
  if (!price?.amount) return '-';
  return `${price.currency || 'CNY'} ${price.amount}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatPercent(value: number | undefined) {
  if (value === undefined || value === null || !Number.isFinite(value)) return '-';
  return `${Math.round(value * 100)}%`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`统计接口超过 ${Math.round(timeoutMs / 1000)} 秒未返回`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

function platformLabel(platform: string) {
  const labels: Record<string, string> = {
    jd: '京东',
    taobao: '淘宝',
    tmall: '天猫',
    suning: '苏宁',
    vipshop: '唯品会',
    xianyu: '闲鱼',
    manual: '手动导入',
  };
  return labels[platform] ? `${labels[platform]} · ${platform}` : platform || '-';
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Element not found: ${id}`);
  return element as T;
}

function escapeAttribute(value: unknown) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
