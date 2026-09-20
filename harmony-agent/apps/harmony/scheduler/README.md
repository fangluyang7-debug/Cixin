# HarmonyOS Semantic Scheduler

Reusable HAR for application-owned AI workloads. The package does not include shopping data, model weights or a cloud service.

Applications register `TaskTemplate` and `WorkloadExecutor` implementations once, submit `TaskContext` through `SchedulerClient`, and report user events through `TaskSignal`. `SchedulerService` supplies the runtime; each client scopes its executors to prevent capability collisions.

See [the integration guide](../../../docs/08-AI任务语义调度SDK-接入与实现.md) for contracts, checkpoint behavior, privacy constraints and current limitations. The low-level Service API remains available for existing integrations.

From the `harmony-agent` root, run `./scripts/test-semantic-scheduler.ps1 -DevEcoHome '<DevEco Studio path>'`. This checks Hypium assertions as well as the Hvigor process result.
