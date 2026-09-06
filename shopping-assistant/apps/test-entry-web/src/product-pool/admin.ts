import './admin.css';
import { ProductPoolApi } from './api';
import type {
  BatchDetail,
  BatchQuality,
  BatchSummary,
  JsonRecord,
  ProductDetail,
  ProductListItem,
  ProductPoolStats,
  RollbackPreview,
} from './types';

type ActiveView = 'batches' | 'products';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('App root not found.');

const defaultApiBase =
  localStorage.getItem('ops-api-base') ??
  import.meta.env.VITE_API_BASE_URL ??
  'http://127.0.0.1:3000';
const defaultToken = localStorage.getItem('ops-maintenance-token') ?? '';
const defaultCloudMode = isCloudApiBase(defaultApiBase);

const state = {
  activeView: (defaultCloudMode ? 'products' : 'batches') as ActiveView,
  stats: null as ProductPoolStats | null,
  batches: [] as BatchSummary[],
  batchTotal: 0,
  batchOffset: 0,
  batchLimit: 20,
  selectedBatch: null as BatchDetail | null,
  selectedBatchQuality: null as BatchQuality | null,
  products: [] as ProductListItem[],
  productTotal: 0,
  productOffset: 0,
  productLimit: defaultCloudMode ? 5 : 30,
  selectedProduct: null as ProductDetail | null,
  selectedProductIds: new Set<string>(),
  loading: new Set<string>(),
};

app.innerHTML = `
  <div class="ops-app">
    <header class="ops-header">
      <button class="mobile-menu" type="button" data-action="toggle-sidebar" aria-label="打开导航">${icon('menu')}</button>
      <a class="brand" href="/product-pool.html">
        <span class="brand-mark">${icon('database')}</span>
        <span>商品池运维中心</span>
      </a>
      <div class="header-config">
        <label><span>API 环境</span><input id="apiBase" value="${escapeHtml(defaultApiBase)}" spellcheck="false" /></label>
         <label class="token-field"><span>维护 Token</span><input id="maintenanceToken" type="password" value="${escapeHtml(defaultToken)}" placeholder="未配置时禁止维护请求" /></label>
        <span class="token-state" id="tokenState"></span>
        <button class="button button-quiet" type="button" data-action="refresh">${icon('refresh')} 刷新</button>
      </div>
    </header>

    <aside class="sidebar" id="sidebar">
      <nav>
        <p class="nav-label">商品池</p>
        <button class="nav-item is-active" type="button" data-view="batches">${icon('upload')}<span>导入与批次</span></button>
        <button class="nav-item" type="button" data-view="products">${icon('package')}<span>商品管理</span></button>
        <button class="nav-item" type="button" data-action="open-rebuild">${icon('layers')}<span>Embedding 管理</span></button>
        <a class="nav-item" href="/">${icon('search')}<span>图片搜索诊断</span></a>
      </nav>
      <div class="sidebar-note">
        <strong>生产导入规则</strong>
        <p>仅导入已清洗、去重并验链的 verified JSON。</p>
        <a href="/product-pool.html">当前运维入口</a>
      </div>
    </aside>

    <main class="ops-main">
      <section class="page-intro">
        <div>
          <h1>商品池概览</h1>
          <p>监控导入质量、可检索状态和向量覆盖，处理失败批次与异常商品。</p>
        </div>
        <div class="intro-actions">
          <button class="button button-secondary" type="button" data-action="open-rebuild">${icon('layers')} 重建 Embedding</button>
          <button class="button button-primary" type="button" data-action="open-import">${icon('upload')} 导入商品 JSON</button>
        </div>
      </section>

      <section class="metric-strip" id="metricStrip">${metricSkeleton()}</section>
      <section class="distribution-panel" id="distributionPanel"></section>

      <section class="workspace-panel">
        <div class="section-tabs">
          <button class="section-tab is-active" type="button" data-view="batches">导入批次</button>
          <button class="section-tab" type="button" data-view="products">商品列表</button>
        </div>

        <section id="batchView">
          <form class="toolbar" id="batchFilters">
            <label class="search-field">${icon('search')}<input name="batchSource" placeholder="搜索批次来源" /></label>
            <label><span>状态</span><select name="status">
              <option value="">全部状态</option><option value="queued">排队中</option>
              <option value="processing">处理中</option><option value="completed">成功</option>
              <option value="completed_with_errors">部分失败</option><option value="failed">失败</option>
              <option value="rolled_back">已回滚</option>
            </select></label>
            <button class="button button-quiet" type="submit">筛选</button>
            <button class="button button-text" type="button" data-action="reset-batch-filters">重置</button>
          </form>
          <div class="table-wrap"><table>
            <thead><tr>
              <th>批次来源</th><th>状态</th><th>处理进度</th><th>新增 / 更新</th>
              <th>失败</th><th>Embedding 覆盖</th><th>创建时间</th><th class="align-right">操作</th>
            </tr></thead>
            <tbody id="batchRows"></tbody>
          </table></div>
          <div class="pagination" id="batchPagination"></div>
        </section>

        <section id="productView" hidden>
          <form class="toolbar toolbar-products" id="productFilters">
            <label class="search-field">${icon('search')}<input name="keyword" placeholder="商品 ID / 标题 / 店铺 / URL" /></label>
            <label><span>平台</span><select name="platform"><option value="">全部平台</option>${options(['taobao', 'tmall', 'jd', 'vipshop', 'suning', 'dewu', 'pdd', 'douyin', 'xianyu', 'manual'])}</select></label>
            <label><span>品类</span><select name="category"><option value="">全部品类</option>${options(['shoe', 'camera', 'headphones', 'smartwatch', 'phone', 'computer', 'tablet', 'keyboard', 'mouse', 'digital_other'])}</select></label>
            <label><span>Embedding</span><select name="hasEmbedding"><option value="">全部</option><option value="true">已有</option><option value="false">缺失</option></select></label>
            <button class="button button-quiet" type="submit">筛选</button>
            <button class="button button-text" type="button" data-action="reset-product-filters">重置</button>
            <button class="button button-danger-soft selection-action" id="deleteSelected" type="button" data-action="delete-selected" disabled>删除所选</button>
          </form>
          <div class="table-wrap"><table>
            <thead><tr>
              <th class="check-cell"><input id="selectAllProducts" type="checkbox" aria-label="全选商品" /></th>
              <th>商品</th><th>平台 / 店铺</th><th>品类 / 品牌</th><th>价格</th>
              <th>状态</th><th>Embedding</th><th>更新时间</th><th class="align-right">操作</th>
            </tr></thead>
            <tbody id="productRows"></tbody>
          </table></div>
          <div class="pagination" id="productPagination"></div>
        </section>
      </section>
    </main>

    <aside class="inspector" id="inspector" aria-live="polite"></aside>
    <div class="modal-root" id="modalRoot"></div>
    <div class="toast-root" id="toastRoot"></div>
  </div>
`;

const apiBaseInput = element<HTMLInputElement>('apiBase');
const tokenInput = element<HTMLInputElement>('maintenanceToken');
const api = new ProductPoolApi(
  () => apiBaseInput.value,
  () => tokenInput.value,
);

apiBaseInput.addEventListener('change', saveConnection);
tokenInput.addEventListener('change', saveConnection);
tokenInput.addEventListener('input', renderTokenState);

document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-action], [data-view], [data-page], [data-batch-id], [data-product-id]',
  );
  if (!target) return;
  if (target.dataset.view) {
    switchView(target.dataset.view as ActiveView);
    return;
  }
  if (target.dataset.action) {
    void handleAction(target.dataset.action, target);
    return;
  }
  if (target.dataset.batchId) {
    void inspectBatch(target.dataset.batchId);
    return;
  }
  if (target.dataset.productId) {
    void inspectProduct(target.dataset.productId);
    return;
  }
  if (target.dataset.page && target.dataset.scope) {
    changePage(target.dataset.scope, Number(target.dataset.page));
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  event.preventDefault();
  if (form.id === 'batchFilters') {
    state.batchOffset = 0;
    void loadBatches();
  } else if (form.id === 'productFilters') {
    state.productOffset = 0;
    void loadProducts();
  } else if (form.id === 'importForm') {
    void submitImport(form);
  } else if (form.id === 'rebuildForm') {
    void submitRebuild(form);
  } else if (form.id === 'productEditForm') {
    void submitProductEdit(form);
  }
});

document.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  if (target.dataset.productCheck) {
    const productId = target.dataset.productCheck;
    if (target.checked) state.selectedProductIds.add(productId);
    else state.selectedProductIds.delete(productId);
    renderSelection();
  } else if (target.id === 'selectAllProducts') {
    state.selectedProductIds.clear();
    if (target.checked) {
      state.products.forEach((product) =>
        state.selectedProductIds.add(product.productId),
      );
    }
    renderProducts();
  }
});

renderTokenState();
switchView(state.activeView);
void refreshAll();

const pollTimer = window.setInterval(() => {
  if (
    state.batches.some((batch) =>
      ['queued', 'processing'].includes(batch.status),
    )
  ) {
    void loadBatches(false);
  }
}, 3500);
window.addEventListener('beforeunload', () => window.clearInterval(pollTimer));

async function refreshAll() {
  saveConnection();
  if (isCloudMode()) {
    await loadProducts(false);
    state.stats = null;
    renderStatsFallback('云端演示模式默认跳过重统计接口，避免大库统计拖慢首屏。');
    setConnectionHealthy(state.productTotal > 0);
    if (state.productTotal > 0) {
      toast(`已加载云端商品池，共 ${number(state.productTotal)} 条商品。`);
    }
    return;
  }
  const statsPromise = withTimeout(api.stats(), 8000, '云端概览统计响应超时');
  await Promise.all([loadBatches(false), loadProducts(false)]);
  try {
    const stats = await statsPromise;
    state.stats = stats;
    renderStats();
    setConnectionHealthy(true);
  } catch (error) {
    state.stats = null;
    renderStatsFallback(errorMessage(error));
    setConnectionHealthy(state.productTotal > 0);
    toast(
      state.productTotal > 0
        ? `概览统计暂不可用，商品列表已加载 ${number(state.productTotal)} 条。`
        : errorMessage(error),
      state.productTotal > 0 ? 'success' : 'error',
    );
  }
}

async function loadBatches(showErrors = true) {
  state.loading.add('batches');
  try {
    const values = new FormData(element<HTMLFormElement>('batchFilters'));
    const params = new URLSearchParams({
      limit: String(state.batchLimit),
      offset: String(state.batchOffset),
    });
    copyParams(values, params, ['batchSource', 'status']);
    const result = await api.batches(params);
    state.batches = result.items;
    state.batchTotal = result.total;
    renderBatches();
  } catch (error) {
    tableError('batchRows', errorMessage(error), 8);
    if (showErrors) toast(errorMessage(error), 'error');
  } finally {
    state.loading.delete('batches');
  }
}

async function loadProducts(showErrors = true) {
  state.loading.add('products');
  try {
    const values = new FormData(element<HTMLFormElement>('productFilters'));
    const params = new URLSearchParams({
      limit: String(state.productLimit),
      offset: String(state.productOffset),
    });
    copyParams(values, params, [
      'keyword',
      'platform',
      'category',
      'hasEmbedding',
    ]);
    let result = await withTimeout(
      api.products(params),
      isCloudMode() ? 8000 : 20000,
      '商品列表响应超时',
    );
    if (isCloudMode() && result.items.length === 0 && state.productLimit > 1) {
      params.set('limit', '1');
      result = await withTimeout(api.products(params), 8000, '商品列表响应超时');
    }
    state.products = result.items;
    state.productTotal = result.total;
    state.selectedProductIds.clear();
    renderProducts();
  } catch (error) {
    if (isCloudMode() && state.productLimit > 1) {
      try {
        const fallbackParams = new URLSearchParams({
          limit: '1',
          offset: String(state.productOffset),
        });
        const result = await withTimeout(
          api.products(fallbackParams),
          8000,
          '商品列表响应超时',
        );
        state.products = result.items;
        state.productTotal = result.total;
        state.productLimit = 1;
        state.selectedProductIds.clear();
        renderProducts();
        toast(`云端商品池较慢，已切换为轻量展示，共 ${number(result.total)} 条商品。`);
        return;
      } catch {
        // Fall through to the normal error state.
      }
    }
    tableError('productRows', errorMessage(error), 9);
    if (showErrors) toast(errorMessage(error), 'error');
  } finally {
    state.loading.delete('products');
  }
}

async function inspectBatch(batchId: string) {
  openInspector(inspectorLoading('批次详情'));
  try {
    const [detail, quality] = await Promise.all([
      api.batch(batchId),
      api.batchQuality(batchId),
    ]);
    state.selectedBatch = detail;
    state.selectedBatchQuality = quality;
    renderBatchInspector(detail, quality);
    renderBatches();
  } catch (error) {
    openInspector(inspectorError(errorMessage(error)));
  }
}

async function inspectProduct(productId: string) {
  openInspector(inspectorLoading('商品详情'));
  try {
    const product = await api.product(productId);
    state.selectedProduct = product;
    renderProductInspector(product);
  } catch (error) {
    openInspector(inspectorError(errorMessage(error)));
  }
}

async function handleAction(action: string, target: HTMLElement) {
  const id = target.dataset.id;
  switch (action) {
    case 'refresh':
      await refreshAll();
      break;
    case 'toggle-sidebar':
      element('sidebar').classList.toggle('is-open');
      break;
    case 'close-inspector':
      closeInspector();
      break;
    case 'close-modal':
      closeModal();
      break;
    case 'open-import':
      openImportModal();
      break;
    case 'open-rebuild':
      openRebuildModal();
      break;
    case 'reset-batch-filters':
      element<HTMLFormElement>('batchFilters').reset();
      state.batchOffset = 0;
      await loadBatches();
      break;
    case 'reset-product-filters':
      element<HTMLFormElement>('productFilters').reset();
      state.productOffset = 0;
      await loadProducts();
      break;
    case 'retry-batch':
      if (id) await retryBatch(id);
      break;
    case 'rollback-batch':
      if (id) await prepareRollback(id);
      break;
    case 'confirm-rollback':
      if (id) await executeRollback(id);
      break;
    case 'delete-batch':
      if (id) await prepareDeleteBatch(id);
      break;
    case 'confirm-delete-batch':
      if (id) await executeDeleteBatch(id);
      break;
    case 'delete-selected':
      await prepareDeleteProducts();
      break;
    case 'confirm-delete-products':
      await executeDeleteProducts();
      break;
  }
}

async function retryBatch(batchId: string) {
  try {
    await api.retryBatch(batchId);
    toast('批次已重新进入队列。');
    await loadBatches(false);
    await inspectBatch(batchId);
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

async function prepareRollback(batchId: string) {
  try {
    const preview = await api.rollbackBatch(batchId, true);
    openModal(`
      <div class="modal-card modal-danger">
        ${modalHeader('确认回滚批次')}
        <div class="modal-body">
          ${warningBlock('回滚会删除本批新增商品，并恢复本批更新前的数据。', '系统会拒绝覆盖已被后续批次再次修改的商品。')}
          ${rollbackPreviewHtml(preview)}
        </div>
        ${modalActions(`<button class="button button-danger" type="button" data-action="confirm-rollback" data-id="${escapeHtml(batchId)}" ${preview.conflictCount > 0 ? 'disabled' : ''}>确认回滚</button>`)}
      </div>
    `);
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

async function executeRollback(batchId: string) {
  setModalBusy(true);
  try {
    await api.rollbackBatch(batchId, false);
    closeModal();
    closeInspector();
    toast('批次已回滚。');
    await refreshAll();
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    setModalBusy(false);
  }
}

async function prepareDeleteBatch(batchId: string) {
  try {
    const preview = await api.deleteBatch(batchId, true);
    openModal(`
      <div class="modal-card modal-danger">
        ${modalHeader('确认删除批次')}
        <div class="modal-body">
          ${warningBlock('删除批次不可撤销。', '相关商品、向量和审核记录将一并删除。需要保留旧商品时请优先使用回滚。')}
          <pre class="json-preview">${escapeHtml(JSON.stringify(preview, null, 2))}</pre>
        </div>
        ${modalActions(`<button class="button button-danger" type="button" data-action="confirm-delete-batch" data-id="${escapeHtml(batchId)}">永久删除</button>`)}
      </div>
    `);
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

async function executeDeleteBatch(batchId: string) {
  setModalBusy(true);
  try {
    await api.deleteBatch(batchId, false);
    closeModal();
    closeInspector();
    toast('批次及关联数据已删除。');
    await refreshAll();
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    setModalBusy(false);
  }
}

async function prepareDeleteProducts() {
  const ids = [...state.selectedProductIds];
  if (ids.length === 0) return;
  try {
    const preview = await api.deleteProducts(ids, true);
    openModal(`
      <div class="modal-card modal-danger">
        ${modalHeader(`删除 ${ids.length} 个商品`)}
        <div class="modal-body">
          ${warningBlock('商品、Embedding 和审核记录会同时删除。', '此操作不可撤销。')}
          <pre class="json-preview">${escapeHtml(JSON.stringify(preview, null, 2))}</pre>
        </div>
        ${modalActions('<button class="button button-danger" type="button" data-action="confirm-delete-products">确认删除</button>')}
      </div>
    `);
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

async function executeDeleteProducts() {
  setModalBusy(true);
  try {
    await api.deleteProducts([...state.selectedProductIds], false);
    closeModal();
    toast('所选商品已删除。');
    await refreshAll();
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    setModalBusy(false);
  }
}

async function submitImport(form: HTMLFormElement) {
  const file = (
    form.elements.namedItem('file') as HTMLInputElement
  ).files?.[0];
  if (!file) {
    toast('请选择 JSON 文件。', 'error');
    return;
  }
  setModalBusy(true);
  try {
    const payload = JSON.parse(await file.text()) as unknown;
    const result = await api.importProducts(payload);
    closeModal();
    toast(`已提交 ${result.totalCount} 条商品，批次进入队列。`);
    switchView('batches');
    state.batchOffset = 0;
    await refreshAll();
    await inspectBatch(result.batchId);
  } catch (error) {
    toast(
      error instanceof SyntaxError ? 'JSON 文件格式无效。' : errorMessage(error),
      'error',
    );
  } finally {
    setModalBusy(false);
  }
}

async function submitRebuild(form: HTMLFormElement) {
  const values = new FormData(form);
  const limitValue = Number(values.get('limit'));
  setModalBusy(true);
  try {
    const result = await api.rebuildEmbeddings({
      embeddingKind: String(values.get('embeddingKind') ?? ''),
      limit:
        Number.isInteger(limitValue) && limitValue > 0
          ? limitValue
          : undefined,
    });
    closeModal();
    toast('Embedding 重建完成。');
    openModal(`
      <div class="modal-card">
        ${modalHeader('Embedding 重建结果')}
        <div class="modal-body"><pre class="json-preview">${escapeHtml(JSON.stringify(result, null, 2))}</pre></div>
        <div class="modal-actions"><button class="button button-primary" type="button" data-action="close-modal">完成</button></div>
      </div>
    `);
    await refreshAll();
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    setModalBusy(false);
  }
}

async function submitProductEdit(form: HTMLFormElement) {
  const productId = form.dataset.productId;
  if (!productId) return;
  const values = new FormData(form);
  const payload: JsonRecord = {};
  [
    'title',
    'priceAmount',
    'stockStatus',
    'shopName',
    'shopType',
    'productUrl',
    'tagStatus',
    'brand',
    'category',
    'modelLine',
    'colorFamily',
  ].forEach((key) => {
    const value = String(values.get(key) ?? '').trim();
    if (value) payload[key] = value;
  });
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) submit.disabled = true;
  try {
    const product = await api.updateProduct(productId, payload);
    state.selectedProduct = product;
    renderProductInspector(product);
    toast('商品信息已更新。');
    await loadProducts(false);
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    if (submit) submit.disabled = false;
  }
}

function renderStats() {
  const stats = state.stats;
  if (!stats) return;
  const visualRate =
    stats.embeddingCoverage.visualRate ??
    ratio(stats.embeddingCoverage.visualProducts, stats.totalProducts);
  const multimodalRate =
    stats.embeddingCoverage.multimodalRate ??
    ratio(stats.embeddingCoverage.multimodalProducts, stats.totalProducts);
  element('metricStrip').innerHTML = [
    metricCard('商品总量', number(stats.totalProducts), '当前商品池记录'),
    metricCard(
      '可检索商品',
      number(stats.searchableProducts),
      `${percent(ratio(stats.searchableProducts, stats.totalProducts))} 已通过标签审核`,
    ),
    metricCard(
      'Visual 覆盖',
      percent(visualRate),
      `${number(stats.embeddingCoverage.visualProducts)} 个商品`,
    ),
    metricCard(
      'Multimodal 覆盖',
      percent(multimodalRate),
      `${number(stats.embeddingCoverage.multimodalProducts)} 个商品`,
    ),
  ].join('');

  const groups = stats.categoryGroups.filter((group) => group.count > 0);
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  element('distributionPanel').innerHTML = `
    <div class="distribution-head">
      <div><h2>品类分布</h2><span>按商品记录统计</span></div>
      <strong>${groups.length} 个品类</strong>
    </div>
    ${
      groups.length
        ? `<div class="distribution-bar">${groups
            .map(
              (group, index) =>
                `<span style="width:${Math.max(1, (group.count / total) * 100)}%;--segment:${index}"></span>`,
            )
            .join('')}</div>
           <div class="distribution-legend">${groups
             .slice(0, 8)
             .map(
               (group, index) =>
                 `<span><i style="--segment:${index}"></i>${escapeHtml(group.normalizedCategory)} <b>${number(group.count)}</b></span>`,
             )
             .join('')}</div>`
        : emptyBlock('暂无品类数据')
    }
  `;
}

function renderStatsFallback(reason: string) {
  element('metricStrip').innerHTML = [
    metricCard(
      '商品总量',
      state.productTotal > 0 ? number(state.productTotal) : '--',
      state.productTotal > 0 ? '来自商品列表接口' : '等待商品列表加载',
    ),
    metricCard('概览统计', '暂不可用', reason),
    metricCard('Visual 覆盖', '--', '云端统计接口恢复后显示'),
    metricCard('Multimodal 覆盖', '--', '云端统计接口恢复后显示'),
  ].join('');
  element('distributionPanel').innerHTML = emptyBlock(
    '云端概览统计暂不可用，可继续在商品列表中查看和筛选云端商品。',
  );
}

function renderBatches() {
  const target = element('batchRows');
  if (state.loading.has('batches') && state.batches.length === 0) {
    target.innerHTML = tableSkeleton(8, 6);
    return;
  }
  target.innerHTML =
    state.batches
      .map((batch) => {
        const progress = ratio(
          batch.processedCount ?? batch.succeededCount + batch.failedCount,
          batch.totalCount,
        );
        return `
          <tr class="${state.selectedBatch?.batchId === batch.batchId ? 'is-selected' : ''}" data-batch-id="${escapeHtml(batch.batchId)}">
            <td><div class="primary-cell"><strong>${escapeHtml(batch.batchSource)}</strong><span class="mono">${escapeHtml(shortId(batch.batchId))}</span></div></td>
            <td>${statusBadge(batch.status)}</td>
            <td>${progressCell(progress, `${batch.succeededCount + batch.failedCount}/${batch.totalCount}`)}</td>
            <td><strong>${number(batch.createdCount ?? 0)}</strong> / ${number(batch.updatedCount ?? 0)}</td>
            <td class="${batch.failedCount > 0 ? 'text-danger' : ''}">${number(batch.failedCount)}</td>
            <td>${progressCell(batch.embeddingCoverage, percent(batch.embeddingCoverage))}</td>
            <td>${dateText(batch.createdAt)}</td>
            <td class="align-right"><div class="row-actions">
              <button class="icon-button" type="button" data-batch-id="${escapeHtml(batch.batchId)}" title="查看详情">${icon('eye')}</button>
              <button class="icon-button" type="button" data-action="retry-batch" data-id="${escapeHtml(batch.batchId)}" title="重试" ${['queued', 'processing'].includes(batch.status) ? 'disabled' : ''}>${icon('refresh')}</button>
              <button class="icon-button" type="button" data-action="rollback-batch" data-id="${escapeHtml(batch.batchId)}" title="回滚" ${batch.canRollback ? '' : 'disabled'}>${icon('rollback')}</button>
            </div></td>
          </tr>`;
      })
      .join('') ||
    `<tr><td colspan="8">${emptyBlock('暂无导入批次')}</td></tr>`;
  renderPagination(
    'batchPagination',
    'batches',
    state.batchTotal,
    state.batchOffset,
    state.batchLimit,
  );
}

function renderProducts() {
  const target = element('productRows');
  if (state.loading.has('products') && state.products.length === 0) {
    target.innerHTML = tableSkeleton(9, 8);
    return;
  }
  target.innerHTML =
    state.products
      .map(
        (product) => `
          <tr>
            <td class="check-cell"><input type="checkbox" data-product-check="${escapeHtml(product.productId)}" ${state.selectedProductIds.has(product.productId) ? 'checked' : ''} aria-label="选择 ${escapeHtml(product.title)}" /></td>
            <td><div class="product-cell">
              ${product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" alt="" loading="lazy" />` : `<span class="product-placeholder">${icon('package')}</span>`}
              <div><strong>${escapeHtml(product.title)}</strong><span class="mono">${escapeHtml(product.externalId ?? shortId(product.productId))}</span></div>
            </div></td>
            <td><strong>${escapeHtml(product.platform)}</strong><br /><span class="muted">${escapeHtml(product.shopName ?? '-')}</span></td>
            <td>${escapeHtml(product.category ?? '-')}<br /><span class="muted">${escapeHtml(product.brand ?? '-')}</span></td>
            <td><strong>${escapeHtml(product.price.amount)}</strong> <span class="muted">${escapeHtml(product.price.currency)}</span></td>
            <td>${statusBadge(product.tagStatus)}</td>
            <td>${product.embeddingReady ? `<span class="ready-mark">${icon('check')} ${product.counts.embeddings}</span>` : '<span class="missing-mark">缺失</span>'}</td>
            <td>${dateText(product.updatedAt)}</td>
            <td class="align-right"><button class="icon-button" type="button" data-product-id="${escapeHtml(product.productId)}" title="查看与编辑">${icon('eye')}</button></td>
          </tr>`,
      )
      .join('') ||
    `<tr><td colspan="9">${emptyBlock('暂无匹配商品')}</td></tr>`;
  renderPagination(
    'productPagination',
    'products',
    state.productTotal,
    state.productOffset,
    state.productLimit,
  );
  renderSelection();
}

function renderBatchInspector(detail: BatchDetail, quality: BatchQuality) {
  openInspector(`
    <div class="inspector-header">
      <div><span class="inspector-label">批次详情</span><h2>${escapeHtml(detail.batchSource)}</h2><p class="mono">${escapeHtml(detail.batchId)}</p></div>
      <button class="icon-button" type="button" data-action="close-inspector" aria-label="关闭">${icon('close')}</button>
    </div>
    <div class="inspector-body">
      <section class="quality-hero">
        <div class="quality-score quality-${quality.qualityGrade.toLowerCase()}"><span>质量得分</span><strong>${(quality.qualityScore * 100).toFixed(1)}</strong><small>/ 100 · ${escapeHtml(quality.qualityGrade)}</small></div>
        <div class="quality-meta">${statusBadge(detail.status)}<span>${number(detail.succeededCount)} 成功</span><span>${number(detail.failedCount)} 失败</span></div>
      </section>
      <section class="inspector-section">
        <div class="inspector-section-title"><h3>质量维度</h3><span>${quality.attentionRequired ? '需要关注' : '状态良好'}</span></div>
        <div class="dimension-list">${Object.entries(quality.dimensions)
          .map(
            ([key, value]) => `
              <div class="dimension-row">
                <div><strong>${escapeHtml(dimensionLabel(key))}</strong><span>${value.ready}/${value.total}</span></div>
                ${progressCell(value.rate, percent(value.rate))}
              </div>`,
          )
          .join('')}</div>
      </section>
      <section class="inspector-section">
        <div class="inspector-section-title"><h3>失败原因 Top N</h3><span>${quality.failureReasons.length} 类</span></div>
        ${
          quality.failureReasons.length
            ? `<div class="reason-list">${quality.failureReasons.map((item) => `<div><span title="${escapeHtml(item.reason)}">${escapeHtml(item.reason)}</span><strong>${item.count}</strong></div>`).join('')}</div>`
            : emptyBlock('没有记录到失败原因')
        }
      </section>
      <section class="inspector-section">
        <div class="inspector-section-title"><h3>审核状态</h3><span>${detail.auditStatusCounts.length} 类</span></div>
        <div class="audit-list">${detail.auditStatusCounts.map((item) => `<span>${escapeHtml(item.status)} <strong>${item.count}</strong></span>`).join('') || '<span>暂无审核记录</span>'}</div>
      </section>
      <section class="inspector-section">
        <div class="inspector-section-title"><h3>批次商品</h3><span>${detail.products.length} 条预览</span></div>
        <div class="mini-product-list">${detail.products
          .slice(0, 12)
          .map(
            (product) =>
              `<button type="button" data-product-id="${escapeHtml(product.productId)}"><span>${escapeHtml(product.title)}</span><small>${escapeHtml(product.platform)} · ${escapeHtml(product.price.amount)}</small></button>`,
          )
          .join('') || emptyBlock('本批次当前没有关联商品')}</div>
      </section>
    </div>
    <div class="inspector-actions">
      <button class="button button-warning" type="button" data-action="rollback-batch" data-id="${escapeHtml(detail.batchId)}" ${detail.canRollback ? '' : 'disabled'}>${icon('rollback')} 回滚批次</button>
      <button class="button button-secondary" type="button" data-action="retry-batch" data-id="${escapeHtml(detail.batchId)}" ${['queued', 'processing'].includes(detail.status) ? 'disabled' : ''}>${icon('refresh')} 重试失败</button>
      <button class="button button-danger-soft" type="button" data-action="delete-batch" data-id="${escapeHtml(detail.batchId)}">${icon('trash')} 删除批次</button>
    </div>
  `);
}

function renderProductInspector(product: ProductDetail) {
  openInspector(`
    <div class="inspector-header">
      <div><span class="inspector-label">商品详情</span><h2>${escapeHtml(product.title)}</h2><p class="mono">${escapeHtml(product.productId)}</p></div>
      <button class="icon-button" type="button" data-action="close-inspector" aria-label="关闭">${icon('close')}</button>
    </div>
    <div class="inspector-body">
      <div class="product-detail-hero">
        ${product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.title)}" />` : `<div class="detail-placeholder">${icon('package')}</div>`}
        <div>${statusBadge(product.tagStatus)}<strong>${escapeHtml(product.price.currency)} ${escapeHtml(product.price.amount)}</strong><a href="${escapeHtml(product.productUrl)}" target="_blank" rel="noreferrer">打开商品详情 ${icon('external')}</a></div>
      </div>
      <form class="edit-form" id="productEditForm" data-product-id="${escapeHtml(product.productId)}">
        ${formField('标题', 'title', product.title, 'wide')}
        ${formField('价格', 'priceAmount', product.price.amount)}
        ${selectField('库存', 'stockStatus', product.stockStatus, ['in_stock', 'out_of_stock', 'unknown'])}
        ${formField('店铺', 'shopName', product.shopName ?? '')}
        ${formField('店铺类型', 'shopType', product.shopType ?? '')}
        ${selectField('标签状态', 'tagStatus', product.tagStatus, ['verified', 'review_needed', 'pending', 'rejected'])}
        ${formField('品类', 'category', product.category ?? '')}
        ${formField('品牌', 'brand', product.brand ?? '')}
        ${formField('型号', 'modelLine', product.modelLine ?? '')}
        ${formField('颜色', 'colorFamily', product.colorFamily ?? '')}
        ${formField('商品 URL', 'productUrl', product.productUrl, 'wide')}
        <button class="button button-primary wide" type="submit">保存修改</button>
      </form>
      <section class="inspector-section">
        <div class="inspector-section-title"><h3>Embedding</h3><span>${product.embeddings?.length ?? 0} 条</span></div>
        <div class="embedding-list">${(product.embeddings ?? [])
          .map(
            (embedding) =>
              `<div><strong>${escapeHtml(embedding.embeddingKind)} · ${escapeHtml(embedding.imageRole)}</strong><span>${escapeHtml(embedding.provider)} / ${embedding.dimension}d</span><small>${dateText(embedding.createdAt)}</small></div>`,
          )
          .join('') || emptyBlock('暂无 Embedding')}</div>
      </section>
      <section class="inspector-section">
        <div class="inspector-section-title"><h3>最近审核</h3><span>${product.tagAudits?.length ?? 0} 条</span></div>
        <div class="audit-timeline">${(product.tagAudits ?? [])
          .slice(0, 8)
          .map(
            (audit) =>
              `<div><i></i><span><strong>${escapeHtml(audit.status)}</strong><small>${dateText(audit.createdAt)}</small></span></div>`,
          )
          .join('') || emptyBlock('暂无审核记录')}</div>
      </section>
    </div>
  `);
}

function switchView(view: ActiveView) {
  state.activeView = view;
  element('batchView').hidden = view !== 'batches';
  element('productView').hidden = view !== 'products';
  document.querySelectorAll<HTMLElement>('[data-view]').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.view === view);
  });
  element('sidebar').classList.remove('is-open');
}

function changePage(scope: string, page: number) {
  if (!Number.isInteger(page) || page < 1) return;
  if (scope === 'batches') {
    state.batchOffset = (page - 1) * state.batchLimit;
    void loadBatches();
  } else {
    state.productOffset = (page - 1) * state.productLimit;
    void loadProducts();
  }
}

function renderPagination(
  id: string,
  scope: string,
  total: number,
  offset: number,
  limit: number,
) {
  const current = Math.floor(offset / limit) + 1;
  const count = Math.max(1, Math.ceil(total / limit));
  element(id).innerHTML = `
    <span>共 ${number(total)} 条</span>
    <div>
      <button type="button" data-page="${current - 1}" data-scope="${scope}" ${current <= 1 ? 'disabled' : ''}>${icon('left')}</button>
      ${paginationPages(current, count)
        .map((item) =>
          item === '...'
            ? '<span>…</span>'
            : `<button type="button" data-page="${item}" data-scope="${scope}" class="${item === current ? 'is-active' : ''}">${item}</button>`,
        )
        .join('')}
      <button type="button" data-page="${current + 1}" data-scope="${scope}" ${current >= count ? 'disabled' : ''}>${icon('right')}</button>
    </div>`;
}

function renderSelection() {
  const button = element<HTMLButtonElement>('deleteSelected');
  button.disabled = state.selectedProductIds.size === 0;
  button.textContent = state.selectedProductIds.size
    ? `删除所选 (${state.selectedProductIds.size})`
    : '删除所选';
  const selectAll = element<HTMLInputElement>('selectAllProducts');
  selectAll.checked =
    state.products.length > 0 &&
    state.products.every((product) =>
      state.selectedProductIds.has(product.productId),
    );
  selectAll.indeterminate =
    state.selectedProductIds.size > 0 && !selectAll.checked;
}

function openImportModal() {
  openModal(`
    <form class="modal-card" id="importForm">
      ${modalHeader('导入商品 JSON')}
      <div class="modal-body">
        <label class="drop-field">${icon('upload')}<strong>选择 verified JSON 文件</strong><span>支持标准 items 格式或 taobao_product_pool.v2 products 格式</span><input name="file" type="file" accept="application/json,.json" required /></label>
        <div class="info-block"><strong>导入前检查</strong><span>已完成字段标准化、平台详情链接验证、图片链接验证和去重。</span><span>建议单批 30-100 条，控制在线 Embedding 成本与失败范围。</span></div>
      </div>
      <div class="modal-actions"><button class="button button-quiet" type="button" data-action="close-modal">取消</button><button class="button button-primary" type="submit">提交异步导入</button></div>
    </form>`);
}

function openRebuildModal() {
  openModal(`
    <form class="modal-card" id="rebuildForm">
      ${modalHeader('重建商品 Embedding')}
      <div class="modal-body">
        <div class="warning-block warning-amber">${icon('warning')}<div><strong>此操作会先删除目标商品对应类型的旧向量。</strong><p>生产环境建议先用较小 limit 验证 provider、模型与维度配置。</p></div></div>
        <div class="modal-form-grid">
          <label><span>Embedding 类型</span><select name="embeddingKind"><option value="visual">visual</option><option value="multimodal">multimodal</option></select></label>
          <label><span>商品上限</span><input name="limit" type="number" min="1" max="10000" value="30" /></label>
        </div>
      </div>
      <div class="modal-actions"><button class="button button-quiet" type="button" data-action="close-modal">取消</button><button class="button button-primary" type="submit">开始重建</button></div>
    </form>`);
}

function openInspector(html: string) {
  const inspector = element('inspector');
  inspector.innerHTML = html;
  inspector.classList.add('is-open');
}

function closeInspector() {
  element('inspector').classList.remove('is-open');
  state.selectedBatch = null;
  state.selectedBatchQuality = null;
  state.selectedProduct = null;
  renderBatches();
}

function openModal(html: string) {
  const root = element('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" data-action="close-modal"></div>${html}`;
  root.classList.add('is-open');
}

function closeModal() {
  const root = element('modalRoot');
  root.classList.remove('is-open');
  root.innerHTML = '';
}

function setModalBusy(busy: boolean) {
  element('modalRoot')
    .querySelectorAll<HTMLButtonElement>('button')
    .forEach((button) => {
      button.disabled = busy;
    });
}

function saveConnection() {
  localStorage.setItem('ops-api-base', apiBaseInput.value.trim());
  localStorage.setItem('ops-maintenance-token', tokenInput.value);
  renderTokenState();
}

function isCloudMode() {
  return isCloudApiBase(apiBaseInput.value);
}

function isCloudApiBase(value: string) {
  try {
    const url = new URL(value);
    return !['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function renderTokenState() {
  const target = element('tokenState');
  const ready = tokenInput.value.trim().length > 0;
  target.className = `token-state ${ready ? 'is-ready' : ''}`;
  target.innerHTML = `<i></i>${ready ? '已配置' : '未配置'}`;
}

function setConnectionHealthy(healthy: boolean) {
  element('tokenState').classList.toggle('is-error', !healthy);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  let timer = 0;
  const timeout = new Promise<T>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timer);
  });
}

function toast(message: string, tone: 'success' | 'error' = 'success') {
  const item = document.createElement('div');
  item.className = `toast toast-${tone}`;
  item.innerHTML = `${icon(tone === 'success' ? 'check' : 'warning')}<span>${escapeHtml(message)}</span>`;
  element('toastRoot').append(item);
  window.setTimeout(() => item.classList.add('is-visible'), 10);
  window.setTimeout(() => {
    item.classList.remove('is-visible');
    window.setTimeout(() => item.remove(), 200);
  }, 3600);
}

function metricCard(label: string, value: string, detail: string) {
  return `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function metricSkeleton() {
  return Array.from(
    { length: 4 },
    () =>
      '<article class="metric-card skeleton-card"><i></i><b></b><em></em></article>',
  ).join('');
}

function tableSkeleton(columns: number, rows: number) {
  return Array.from(
    { length: rows },
    () =>
      `<tr class="skeleton-row">${Array.from({ length: columns }, () => '<td><i></i></td>').join('')}</tr>`,
  ).join('');
}

function tableError(id: string, message: string, columns: number) {
  element(id).innerHTML = `<tr><td colspan="${columns}">${emptyBlock(message)}</td></tr>`;
}

function progressCell(value: number, label: string) {
  return `<div class="progress-cell"><span>${escapeHtml(label)}</span><i><b style="width:${Math.max(0, Math.min(100, value * 100))}%"></b></i></div>`;
}

function statusBadge(status: string) {
  return `<span class="status-badge status-${statusTone(status)}"><i></i>${escapeHtml(statusLabel(status))}</span>`;
}

function statusTone(status: string) {
  if (['completed', 'verified', 'in_stock'].includes(status)) return 'success';
  if (['processing'].includes(status)) return 'info';
  if (['completed_with_errors', 'review_needed'].includes(status))
    return 'warning';
  if (['failed', 'rejected', 'out_of_stock'].includes(status)) return 'danger';
  if (status === 'rolled_back') return 'muted';
  return 'neutral';
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: '排队中',
    processing: '处理中',
    completed: '成功',
    completed_with_errors: '部分失败',
    failed: '失败',
    rolled_back: '已回滚',
    verified: '可检索',
    review_needed: '待复核',
    pending: '待处理',
    rejected: '已拒绝',
  };
  return labels[status] ?? status;
}

function rollbackPreviewHtml(preview: RollbackPreview) {
  return `
    <dl class="preview-grid">
      <div><dt>影响商品</dt><dd>${preview.affectedProductCount}</dd></div>
      <div><dt>新增记录</dt><dd>${preview.createdChangeCount}</dd></div>
      <div><dt>更新记录</dt><dd>${preview.updatedChangeCount}</dd></div>
      <div><dt>冲突</dt><dd class="${preview.conflictCount > 0 ? 'text-danger' : ''}">${preview.conflictCount}</dd></div>
    </dl>
    ${
      preview.conflicts.length
        ? `<div class="conflict-list">${preview.conflicts.map((conflict) => `<div><span>${escapeHtml(conflict.productId)}</span><strong>${escapeHtml(conflict.reason)}</strong></div>`).join('')}</div>`
        : ''
    }`;
}

function modalHeader(title: string) {
  return `<div class="modal-header"><h2>${escapeHtml(title)}</h2><button class="icon-button" type="button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div>`;
}

function modalActions(primary: string) {
  return `<div class="modal-actions"><button class="button button-quiet" type="button" data-action="close-modal">取消</button>${primary}</div>`;
}

function warningBlock(title: string, detail: string) {
  return `<div class="warning-block">${icon('warning')}<div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div></div>`;
}

function formField(
  label: string,
  name: string,
  value: string,
  className = '',
) {
  return `<label class="${className}"><span>${escapeHtml(label)}</span><input name="${escapeHtml(name)}" value="${escapeHtml(value)}" /></label>`;
}

function selectField(
  label: string,
  name: string,
  value: string,
  values: string[],
) {
  return `<label><span>${escapeHtml(label)}</span><select name="${escapeHtml(name)}">${values.map((item) => `<option value="${escapeHtml(item)}" ${item === value ? 'selected' : ''}>${escapeHtml(statusLabel(item))}</option>`).join('')}</select></label>`;
}

function inspectorLoading(title: string) {
  return `<div class="inspector-header"><div><span class="inspector-label">${escapeHtml(title)}</span><h2>正在加载</h2></div><button class="icon-button" type="button" data-action="close-inspector">${icon('close')}</button></div><div class="inspector-loading">${metricSkeleton()}</div>`;
}

function inspectorError(message: string) {
  return `<div class="inspector-header"><div><span class="inspector-label">加载失败</span><h2>无法读取详情</h2></div><button class="icon-button" type="button" data-action="close-inspector">${icon('close')}</button></div><div class="inspector-body">${emptyBlock(message)}</div>`;
}

function emptyBlock(message: string) {
  return `<div class="empty-block">${icon('inbox')}<span>${escapeHtml(message)}</span></div>`;
}

function dimensionLabel(key: string) {
  const labels: Record<string, string> = {
    importSuccess: '导入成功率',
    searchable: '可检索率',
    imageReady: '图片可用率',
    productUrlReady: '商品链接完整率',
    visualEmbedding: 'Visual 覆盖率',
    multimodalEmbedding: 'Multimodal 覆盖率',
  };
  return labels[key] ?? key;
}

function paginationPages(
  current: number,
  total: number,
): Array<number | '...'> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages: Array<number | '...'> = [1];
  if (current > 4) pages.push('...');
  for (
    let page = Math.max(2, current - 1);
    page <= Math.min(total - 1, current + 1);
    page += 1
  ) {
    pages.push(page);
  }
  if (current < total - 3) pages.push('...');
  pages.push(total);
  return pages;
}

function copyParams(
  values: FormData,
  params: URLSearchParams,
  names: string[],
) {
  names.forEach((name) => {
    const value = String(values.get(name) ?? '').trim();
    if (value) params.set(name, value);
  });
}

function options(values: string[]) {
  return values
    .map((value) => `<option value="${value}">${value}</option>`)
    .join('');
}

function ratio(value: number, total: number) {
  return total > 0 ? value / total : 0;
}

function percent(value: number) {
  return `${(Math.max(0, value) * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
}

function number(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function dateText(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function shortId(value: string) {
  return value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败';
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Element not found: ${id}`);
  return found as T;
}

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function icon(name: string) {
  const paths: Record<string, string> = {
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    database:
      '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    upload:
      '<path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 15v4h16v-4"/>',
    package:
      '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.7 7.5 4.2 7.5-4.2M12 12v9"/>',
    layers:
      '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    refresh:
      '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.5-2L20 12M4 12l2.4 5a7 7 0 0 0 11.5-2"/>',
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
    rollback:
      '<path d="M9 7H4v-5"/><path d="M4 7c2.2-3 5-4.5 8.3-4 4.4.6 7.6 4.6 7 9-.5 4.6-4.7 8-9.3 7.5A8 8 0 0 1 4 15"/>',
    trash:
      '<path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/>',
    warning:
      '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v4m0 3h.01"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    external:
      '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6H5V6h6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    inbox:
      '<path d="M4 5h16v14H4z"/><path d="M4 14h4l2 3h4l2-3h4"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? paths.package}</svg>`;
}
