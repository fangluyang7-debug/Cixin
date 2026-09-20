# 鸿蒙手机原生工程

2026-09-20：已迁入旧初赛项目的 entry、scheduler HAR、轻量 Embedding 模型和配套商品样例。复制时包含来源工作区的有效未提交修改；96 个文件逐一校验 SHA-256。清单见 `../../native-migration-manifest.json`。

## 开发与验证

在 DevEco Studio 中打开本目录。当前配置为 HarmonyOS 6.0.2(22)、Phone。仓库不含签名密钥，默认生成未签名 HAP，手机安装需另行配置本地签名。

从 `harmony-agent` 运行：

```powershell
./scripts/native-check.ps1 -StudioHome '你的 DevEco Studio 安装目录' -Task all
```

脚本使用安装目录内的工具链；临时环境变量会恢复。依赖、缓存、测试输出与构建产物不入库。

- `entry`：示例 App、本地商品与模型调用。
- `scheduler`：业务无关的调度接口、策略、队列、执行器、系统状态适配及测试。
- `entry/src/main/resources/rawfile`：旧项目样例及约 5.8MB 模型，不是实时商品数据。

核心路径离线运行，不要求 NestJS、Python 或生成式语言模型。原示例的可选远程增强和图片占位尚不作为手机版本已完成能力。

范围见 [开发基线](../../docs/02-作品说明与开发基线-鸿蒙手机资源感知调度中间件.md)，当前验证情况见 [阶段记录](../../docs/03-分阶段开发与验证记录.md)。
