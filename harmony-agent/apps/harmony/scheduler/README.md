# HarmonyOS Semantic Scheduler

Reusable HAR for application-owned AI workloads. The package does not include shopping data, model weights or a cloud service.

Applications register `TaskTemplate` and `WorkloadExecutor` implementations once, submit `TaskContext` through `SchedulerClient`, and report user events through `TaskSignal`. `SchedulerService` supplies the runtime; each client scopes its executors to prevent capability collisions.

See [the integration guide](../../../docs/08-AI任务语义调度SDK-接入与实现.md) for contracts, checkpoint behavior, privacy constraints and current limitations. The low-level Service API remains available for existing integrations.

From the `harmony-agent` root, run `./scripts/test-semantic-scheduler.ps1 -DevEcoHome '<DevEco Studio path>'`. This checks Hypium assertions as well as the Hvigor process result.

Local leaf templates can opt into a `TaskCapabilityManifest` of atomic `ExecutionProfile` configurations. The default is OBSERVE; SHADOW records alternatives without executing them. CANARY and ACTIVE require explicit validation gates, bounded experiments and local circuit breakers. The HAR supplies structured feedback requests; the host owns consent, UI, executors and optional private persistence. There is no policy network client or bundled scheduling model.

See [the constrained-loop implementation and limits](../../../docs/09-HarmonyOS受约束策略闭环实施方案.md#13-v1-实施调整与边界2026-09-21) and [acceptance evidence](../../../docs/testing/05-constrained-policy-acceptance.md).

The local algorithm now uses a bounded per-profile cost model, workflow remaining-work estimates, and a measured marginal-speed bonus. Its optional second execution slot requires `SchedulerConfig.maxConcurrentLocalTasks = 2`, a CPU worker budget, and `TaskTemplate.concurrentSafe = true` on **every** overlapping executor. The default remains one slot; the shopping example does not claim concurrent safety. Overlapping executions do not train solo latency estimates. The interference guard needs confirmed solo and overlap samples before it can restrict a pair.

Host-side checks: `npm run scheduler:typecheck`, `npm run algorithm:test`, `npm run concurrency:test`, and `npm run placement:test`. These do not replace the DevEco HAP/HAR build and Hypium suite; see [implementation status and device handoff](../../../docs/15-分层调度首阶段实现与验证.md).
