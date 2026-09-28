# 独立 CPU worker v1

这是可独立启动的 Node.js CPU 进程，只有两项真实能力：`image.crop.v1`（Sharp 裁剪）和 `vector.normalize.v1`（分块向量范数）。不含聊天、视觉识别或 Embedding 模型，不声称获得了手机硬件能力。

## 启动

在 harmony-agent 根目录安装现有依赖并使用 Node.js 22+。将以下内容写入被忽略的 `.env.worker.local`，token 使用独立随机字符串，至少 32 字符：

```dotenv
WORKER_TOKEN=在本机填写随机密钥
WORKER_DEVICE_ID=cpu-worker
WORKER_PORT=3020
WORKER_HOST=127.0.0.1
WORKER_DATA_DIR=artifacts/device-worker
```

```powershell
node --env-file=.env.worker.local services/device-worker/server.mjs
npm run worker:test
```

默认只监听本机。跨机接入使用可信 TLS 入口，云端适配器只接受 HTTPS 或 loopback HTTP。不要把 token 写入项目、截图或日志。访问均需 Bearer token 和 `x-owner-id`；后者是可信协调者校验后传递的用户身份，不接受终端绕过协调者获得 worker token。

## 控制与数据

- GET `/v1/descriptor`：真实能力、进程 instanceId、可用槽/内存、TTL。
- POST `/v1/artifacts`：二进制上传，`x-schema-id` 为 shopping.image 或 shopping.normalization-input；8 MiB 上限。
- POST `/v1/artifacts/resolve`：owner + 完整 ArtifactRef 校验和字节 SHA-256 验证。
- POST `/v1/leases`：attemptId、memoryBytes、remainingBudgetMs，目标原子准入。
- POST `/v1/execute`：leaseId、fencingToken、capability、input、parameters、可选 checkpoint，以及 networkAllowed/隐私授权。
- POST `/v1/query`、`cancel`、`release`：均使用 leaseId。回执持久化后才对外返回。

默认一个计算槽、256 MiB 申报内存预算，计算在线程内进行。取消/过期先撤销 fence；不响应停止的线程仍占槽，只有线程退出及发布完成才算物理结算。release 不删除去重回执。重启后未完成记录标记 WORKER_RESTARTED，不能自动假设执行完成；已有完成输出可查。实例不提供多进程共享目录的共识或锁，**一个数据目录只能运行一个 worker**。

文件先写临时文件并 rename；二进制写完才发布 manifest。归一化块写完，再发布 checkpoint，最后才确认 cursor。恢复验证实际输入 hash、索引/模型/维度和完整块边界；同数量换内容拒绝。实际存储采用 512 MiB 保守配额，去重回执最多 10000 个；达到上限拒绝新任务，需要先停止、对账和归档，不能静默淘汰未确认回执。

## 接入与灰度

API 环境 `RUNTIME_DEVICES_JSON` 示例（不含密钥）：

```json
[{"deviceId":"cpu-worker","endpoint":"https://worker.example.test","tokenEnv":"CPU_WORKER_TOKEN","enabled":true,"qualityVerified":false,"cropPriorMs":500}]
```

token 在单独环境变量设置。设备增删只改配置；撤销后在途轮询请求取消并保留目标未结算占用。适配器验证能力与协议，未掌握方向带宽时不推断可派发。`DeviceDispatchService.calibrate` 供受信集成测试/运维调用，是真实计算，不提交业务状态。也可调用 POST `/api/v1/runtime/devices/:deviceId/calibrate`，multipart `file` 上传代表性图片；必须同时有用户 JWT 与维护 token。接口比较真实裁剪 hash，不自动打开质量门禁，至少 3 次匹配规模的成功校准才形成传输样本，样本仍受 TTL 限制。没有公开匿名校准接口。

PLACEMENT_POLICY_JSON 与本地策略模式相互独立。OBSERVE/SHADOW 不申请优化路径租约。CANARY/ACTIVE 还需未过期 policyVersion、allowlist、流量组、样本数、质量/非劣检查、失败率及 kill switch 全部门禁，并且存在真实传输与剩余阶段样本。缺数据保持云基线。`maximumRecoveryAttempts` 必须显式大于 0 才能在恢复开关开启时做一次合法云端重算。

## 测试边界

`worker:test` 使用独立 HTTP 子进程、实际 Sharp 图片与实际 CPU 向量计算；验证双来源竞争、owner、重复派发、非协作取消占槽、迟到输出、同数量索引换版、块恢复、裁剪 hash 一致和重启回执。它是同一台电脑上的进程测试，**不是两台物理设备性能实验**。
