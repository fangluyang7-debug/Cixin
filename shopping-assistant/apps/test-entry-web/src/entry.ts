import { siteContent } from './content/site';
import './entry.css';

type ApiEnvelope<T> = {
  success: boolean;
  data: T | null;
  error?: { code?: string; message?: string } | null;
};

type HealthPayload = {
  status?: string;
  service?: string;
  timestamp?: string;
};

type ProductPoolStats = {
  totalProducts?: number;
  searchableProducts?: number;
  embeddingCount?: number;
  embeddingCoverage?: {
    visualProducts?: number;
    visualRate?: number;
  };
};

const app = document.querySelector<HTMLElement>('#app');

if (!app) {
  throw new Error('App root not found.');
}

const apiBase = siteContent.apiBase.trim().replace(/\/$/, '');

app.innerHTML = `
  <div class="entry-page">
    <header class="site-header">
      <a class="brand" href="#top" aria-label="SoleAI 首页">
        <span class="brand-mark">S</span>
        <span>SoleAI</span>
      </a>
      <nav class="site-nav" aria-label="测试入口导航">
        <a href="#experience">体验路径</a>
        <a href="#screens">界面截图</a>
        <a href="/catalog.html">真实商品池</a>
        <a href="/debug.html">Web 测试</a>
        <a href="/runtime.html">调度盘</a>
      </nav>
    </header>

    <main>
      <section class="hero" id="top">
        <div class="hero-copy">
          <p class="service-line" id="heroStatus">正在检查线上服务</p>
          <h1>${escapeHtml(siteContent.productName)}</h1>
          <p class="hero-lede">
            拍照找同款，用自然语言继续收敛预算、平台和库存条件，把多平台商品池里的候选结果排成一份可决策清单。
          </p>
          <div class="hero-actions">
            <a class="primary-action" href="/debug.html">打开图片搜索测试</a>
            <a class="secondary-action" href="/catalog.html">查看真实商品池</a>
          </div>
        </div>
        <div class="hero-meta" aria-label="上线信息">
          <span>API: ${escapeHtml(apiBase)}</span>
          <span>Runtime: local or explicitly configured host</span>
        </div>
      </section>

      <section class="proof-strip" aria-label="当前线上数据">
        <article>
          <span id="healthLabel">后端服务</span>
          <strong id="healthValue">检查中</strong>
        </article>
        <article>
          <span>真实商品池</span>
          <strong id="totalProducts">读取中</strong>
        </article>
        <article>
          <span>可检索商品</span>
          <strong id="searchableProducts">读取中</strong>
        </article>
        <article>
          <span>向量记录</span>
          <strong id="embeddingCount">读取中</strong>
        </article>
      </section>

      <section class="experience" id="experience">
        <div class="section-heading">
          <h2>测试客户端和 Runtime 走同一条链路</h2>
          <p>Android 客户端验证购物插件，Web 页面提供商品池查看和图片搜索测试入口。</p>
        </div>
        <div class="steps">
          ${renderStep('01', '启动 Android 测试客户端', '客户端由本地 Flutter 工具构建和安装，设备能力以实际探测为准。')}
          ${renderStep('02', '上传或拍摄鞋图', 'App 会把图片送入主体框选、轻量标签和视觉检索链路。')}
          ${renderStep('03', '查看候选并继续说要求', '例如“500 元以内”“只看有货”“不要某个平台”。')}
          ${renderStep('04', '打开商品页或加入购物车', '候选结果保留平台、价格、匹配摘要和外部购买入口。')}
        </div>
      </section>

      <section class="screens" id="screens">
        <div class="section-heading">
          <h2>核心体验截图</h2>
          <p>这些截图来自 Flutter Android 测试客户端，用于核对购物插件的交互链路。</p>
        </div>
        <div class="screen-grid">
          ${renderScreen('/images/soleai-home.jpg', 'SoleAI 首页', '直接拍鞋找同款，也可以用一句话输入预算、品牌或场景。')}
          ${renderScreen('/images/soleai-result-profile.jpg', '识别标签可修改', '系统把视觉识别结果转成可读标签，用户可以按需要调整。')}
          ${renderScreen('/images/soleai-result-grid.jpg', '同款优先排序', '候选列表混合淘宝、唯品会等来源，优先展示匹配度和价格。')}
          ${renderScreen('/images/soleai-detail-price.png', '价格和购买入口', '详情页保留商品来源、价格历史与外部商品页跳转。')}
        </div>
      </section>

      <section class="system-section">
        <div class="system-copy">
          <h2>不是截图壳，背后接的是同一套线上服务</h2>
          <p>
            移动端、Web 商品池展示和诊断入口都可以连接同一个 NestJS API。Runtime 工具注册、任务图、
            资源调度和购物业务保持独立，缺少外部资源时页面只展示阻断原因。
          </p>
          <div class="system-actions">
            <a href="/catalog.html">打开只读商品池</a>
            <a href="/debug.html">打开 Web 上传测试</a>
            <a href="/product-pool.html">运维中心</a>
            <a href="/runtime.html">调度盘</a>
          </div>
        </div>
        <figure class="pipeline-figure">
          <img src="/images/soleai-pipeline-processing.png" alt="智能比价助手图片处理与候选召回流程图" />
        </figure>
      </section>

      <section class="handoff" id="install">
        <div>
          <h2>运行检查</h2>
          <p>页面会根据当前 API 地址检查服务状态。没有配置 API、模型或商品资源时，不会把测试数据显示成线上结果。</p>
        </div>
        <div class="handoff-actions">
          <a class="primary-action dark" href="/debug.html">打开图片搜索测试</a>
            <a class="secondary-action dark" href="${escapeAttribute(`${apiBase}/api/v1/health`)}" target="_blank" rel="noreferrer">检查 API</a>
        </div>
      </section>
    </main>
  </div>
`;

void refreshRuntimeStatus();

function renderStep(index: string, title: string, body: string) {
  return `
    <article class="step">
      <span>${escapeHtml(index)}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(body)}</p>
    </article>
  `;
}

function renderScreen(src: string, title: string, body: string) {
  return `
    <figure class="screen-card">
      <img src="${escapeAttribute(src)}" alt="${escapeAttribute(title)}" />
      <figcaption>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(body)}</span>
      </figcaption>
    </figure>
  `;
}

async function refreshRuntimeStatus() {
  const heroStatus = requireElement('heroStatus');
  const healthValue = requireElement('healthValue');
  const totalProducts = requireElement('totalProducts');
  const searchableProducts = requireElement('searchableProducts');
  const embeddingCount = requireElement('embeddingCount');

  try {
    const health = await fetchJson<HealthPayload>('/api/v1/health', 10000);
    const healthText = health.status ?? 'online';
    heroStatus.textContent = `线上 API ${healthText}`;
    heroStatus.classList.add('is-online');
    healthValue.textContent = healthText;
  } catch {
    heroStatus.textContent = '线上 API 已配置，实时检查较慢';
    heroStatus.classList.add('is-slow');
    healthValue.textContent = '已配置';
  }

  try {
    const stats = await fetchJson<ProductPoolStats>('/api/v1/product-pool/stats', 8500);
    totalProducts.textContent = formatNumber(stats.totalProducts);
    searchableProducts.textContent = formatNumber(stats.searchableProducts);
    embeddingCount.textContent = formatNumber(stats.embeddingCount);
  } catch {
    totalProducts.textContent = '-';
    searchableProducts.textContent = '-';
    embeddingCount.textContent = '-';
  }
}

async function fetchJson<T>(path: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBase}${path}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const payload = (await response.json()) as ApiEnvelope<T> | T;
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }
    if (isEnvelope<T>(payload)) {
      if (!payload.success || payload.data === null) {
        throw new Error(payload.error?.message ?? payload.error?.code ?? 'API_ERROR');
      }
      return payload.data;
    }
    return payload;
  } finally {
    window.clearTimeout(timeout);
  }
}

function isEnvelope<T>(value: ApiEnvelope<T> | T): value is ApiEnvelope<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    'data' in value
  );
}

function formatNumber(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('zh-CN').format(value);
}

function requireElement(id: string) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Element not found: ${id}`);
  return element;
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
