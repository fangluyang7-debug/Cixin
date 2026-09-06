# Scripts

脚本用于本地测试、商品池数据校验和已配置 API 的手工联调。

## 约束

- 所有 API 地址都通过参数或环境变量提供，脚本不绑定某个云平台。
- 商品导入必须带有可验证的来源 URL；缺少 URL 时直接失败。
- 未配置真实模型、对象存储或授权电商 API 时，不使用 mock/fixture 伪装成功。
- 批量导入脚本只在操作者明确传入已配置的 API 地址和维护令牌后运行。

## 常用命令

```powershell
.\scripts\api-smoke-day1.ps1 -BaseUrl http://localhost:3000
node scripts/import-product-pool.mjs --file <verified-product-payload.json> --base-url http://localhost:3000 --dry-run
```

Runtime 资源缺口和真实硬件接入要求见 [`../docs/runtime-resource-gaps.md`](../docs/runtime-resource-gaps.md)。
