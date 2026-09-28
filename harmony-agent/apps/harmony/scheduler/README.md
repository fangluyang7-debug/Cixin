# HarmonyOS Semantic Scheduler

Reusable HAR for application-owned AI workloads. The package does not include shopping data, model weights or a cloud service.

Applications register `TaskTemplate` and `WorkloadExecutor` implementations once, submit `TaskContext` through `SchedulerClient`, and report user events through `TaskSignal`. `SchedulerService` supplies the runtime; each client scopes its executors to prevent capability collisions.

See [the integration guide](../../../docs/08-AI任务语义调度SDK-接入与实现.md) for contracts, checkpoint behavior, privacy constraints and current limitations. The low-level Service API remains available for existing integrations.

From the `harmony-agent` root, run `./scripts/test-semantic-scheduler.ps1 -DevEcoHome '<DevEco Studio path>'`. This checks Hypium assertions as well as the Hvigor process result.

Local leaf templates can opt into a `TaskCapabilityManifest` of atomic `ExecutionProfile` configurations. The default is OBSERVE; SHADOW records alternatives without executing them. CANARY and ACTIVE require explicit validation gates, bounded experiments and local circuit breakers. The HAR supplies structured feedback requests; the host owns consent, UI, executors and optional private persistence. There is no policy network client or bundled scheduling model.

See [the constrained-loop implementation and limits](../../../docs/09-HarmonyOS受约束策略闭环实施方案.md#13-v1-实施调整与边界2026-09-21) and [acceptance evidence](../../../docs/testing/05-constrained-policy-acceptance.md).

The local algorithm now uses a bounded per-profile cost model, workflow remaining-work estimates, and a measured marginal-speed bonus. Its optional second execution slot requires `SchedulerConfig.maxConcurrentLocalTasks = 2`, a CPU worker budget, and `TaskTemplate.concurrentSafe = true` on **every** overlapping executor. The default remains one slot; the shopping example does not claim concurrent safety. Overlapping executions do not train solo latency estimates. The interference guard needs confirmed solo and overlap samples before it can restrict a pair.

Host-side checks: `npm run scheduler:typecheck`, `npm run algorithm:test`, `npm run concurrency:test`, and `npm run placement:test`. These do not replace the DevEco HAP/HAR build and Hypium suite; see [implementation status and device handoff](../../../docs/15-分层调度首阶段实现与验证.md).


## 架构协议 v1（2026-09-29）

`SchedulingProtocol.ets` 与服务端同版本：TaskContract/TaskInstance 只包含调度元数据和 ArtifactRef，不携带图片、凭证或商品列表。购物业务 payload 位于 entry/models/ShoppingPayloads.ets，由 contracts/shopping/v1 生成，不作为 HAR 的购物依赖。

App 调用者优先使用 ShoppingTaskService 的完整结果接口，保留 session/stateVersion/requestRevision；旧 Product[] 接口只是投影。准备、上传和执行共享剩余预算。Artifact schema、worker 接入、模式门禁、测试及未验收事项参见仓库 docs/architecture-change-acceptance.md 和 services/device-worker/README.md。

本地策略与跨设备 placement 灰度独立。本地默认并发没有提高；batchSize 作为分块参数不重复扩大业务算量，成本样本按模型/执行配置/规模/环境隔离。方向干扰观察分别记录，并检查对新任务和已运行任务两侧影响。
