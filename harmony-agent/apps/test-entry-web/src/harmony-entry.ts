import { siteContent } from './content/site';
import './harmony-entry.css';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('App root not found.');

app.innerHTML = `
  <header>
    <p class="eyebrow">HARMONY AGENT · DEVELOPMENT</p>
    <h1>鸿蒙项目开发工作区</h1>
    <p>独立维护 Runtime、购物示例和调试工具。当前为开发机／服务端原型，鸿蒙原生应用尚待接入。</p>
  </header>
  <section aria-labelledby="tools-title">
    <h2 id="tools-title">开始联调</h2>
    <nav aria-label="调试工具">
      <a href="/runtime.html"><strong>Runtime 控制台</strong><span>工具、资源状态与任务规划轨迹</span></a>
      <a href="/debug.html"><strong>购物示例调试</strong><span>图片输入、候选检索与接口联调</span></a>
      <a href="/catalog.html"><strong>商品数据浏览</strong><span>查看本项目独立数据库中的商品</span></a>
      <a href="/product-pool.html"><strong>商品池管理</strong><span>导入、检查与维护已确认来源的数据</span></a>
    </nav>
  </section>
  <section aria-labelledby="status-title">
    <h2 id="status-title">当前边界</h2>
    <p>后端地址：<code id="api-base"></code></p>
    <p>比赛与设备版本待定。HarmonyOS Adapter 仍是不可用占位实现，技能编译仍为待实现设计。</p>
    <p>云模型、对象存储和商品数据需要在本项目中独立配置；迁移未携带此芯项目的密钥或数据库。</p>
  </section>
`;
app.querySelector<HTMLElement>('#api-base')!.textContent = siteContent.apiBase;
