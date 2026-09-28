# 智调鸿枢可运行环境

本环境包不含作品说明文档，也不含任何真实 API Key、签名私钥或签名口令。

## 1. 最快体验

1. 使用兼容 HarmonyOS 6.0.2(22) 的 Phone 设备。
2. 安装 `01-演示程序/entry-default-signed.hap`。
3. 启动应用，体验图片识别、文字检索、后台索引与调度显示。

该 HAP 已通过签名完整性校验，签名类型为 Debug。证书有效期截至
2026-08-09 23:11:35，并受调试 Profile 设备范围约束。若设备拒绝安装，
请使用下面的源码运行方式重新签名。

## 2. 源码运行

1. 使用 DevEco Studio 打开 `02-源码/shopping-assistant/apps`。
2. 等待 OHPM 与 Hvigor 同步完成。
3. 在 `File > Project Structure > Project > Signing Configs` 中启用
   HarmonyOS 自动调试签名。
4. 选择 Phone 模拟器或真机，运行 `entry` 模块。

源码快照中的 `apps/build-profile.json5` 未携带提交方签名材料，评测方可使用
自己的 DevEco Managed Profile 完成签名。

## 3. 可选云端模型

云端模型不是端侧调度、本地检索和本地 Embedding 的运行前提。需要验证云端
回答时：

1. 进入 `02-源码/shopping-assistant`。
2. 将 `.env.example` 复制为 `.env`。
3. 填写评测方自己的兼容模型地址、模型名称和 API Key。
4. 执行 `npm run model-search:proxy`。

Phone 模拟器通过 `http://10.0.2.2:3010` 访问宿主机代理。当前预构建 HAP
面向该模拟器地址；真机验证云端代理时，应在源码中将代理地址调整为同一局域网
内的电脑 IP 后重新构建。

## 4. 目录说明

- `01-演示程序`：已签名 HAP、调度中间件 HAR及签名说明。
- `02-源码`：脱敏源码、`.env.example` 和本地云模型代理。
- `03-构建与测试`：运行说明、构建脚本和既有测试证据。

