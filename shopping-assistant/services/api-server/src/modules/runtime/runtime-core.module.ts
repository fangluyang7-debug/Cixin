import { DynamicModule, Module, Provider } from "@nestjs/common";
import { AGENT_PLANNER, AgentRuntimeService } from "../../core/runtime/agent-runtime.service";
import { CloudPlatformAdapterService } from "../../core/runtime/cloud-platform-adapter.service";
import { GuardedExecutionService } from "../../core/runtime/guarded-execution.service";
import { HostPlatformAdapterService } from "../../core/runtime/host-platform-adapter.service";
import { LOCAL_TASK_TEMPLATES, LocalTaskPlannerService, LocalTaskTemplate } from "../../core/runtime/local-task-planner.service";
import { PerformanceRegistryService } from "../../core/runtime/performance-registry.service";
import { PlatformDiscoveryService } from "../../core/runtime/platform-discovery.service";
import { PlatformStateRegistryService } from "../../core/runtime/platform-state-registry.service";
import { ResourcePredictorService } from "../../core/runtime/resource-predictor.service";
import { RuntimeEventBusService } from "../../core/runtime/runtime-event-bus.service";
import { RuntimeRunService } from "../../core/runtime/runtime-run.service";
import { RuntimeSnapshotService } from "../../core/runtime/runtime-snapshot.service";
import { ResourceAwareSchedulerService } from "../../core/runtime/scheduler.service";
import { TelemetryService } from "../../core/runtime/telemetry.service";
import { ToolRegistryService } from "../../core/runtime/tool-registry.service";
import { CixP1PlatformAdapterService, HarmonyPlatformAdapterService } from "../../core/runtime/unavailable-platform-adapters.service";

const coreProviders: Provider[] = [
  ToolRegistryService, PerformanceRegistryService, TelemetryService,
  HostPlatformAdapterService, HarmonyPlatformAdapterService, CixP1PlatformAdapterService,
  CloudPlatformAdapterService, PlatformStateRegistryService, PlatformDiscoveryService,
  ResourcePredictorService, ResourceAwareSchedulerService, RuntimeEventBusService,
  RuntimeRunService, RuntimeSnapshotService, GuardedExecutionService,
  LocalTaskPlannerService, AgentRuntimeService,
];

const coreExports = [
  ToolRegistryService, PerformanceRegistryService, TelemetryService,
  PlatformDiscoveryService, ResourcePredictorService, ResourceAwareSchedulerService,
  RuntimeEventBusService, RuntimeRunService, RuntimeSnapshotService,
  GuardedExecutionService, PlatformStateRegistryService, LocalTaskPlannerService,
  AgentRuntimeService,
];

export interface RuntimeCoreOptions {
  decisionProvider?: Provider;
  operations?: readonly LocalTaskTemplate[];
  /** Must provide RUNTIME_PLATFORM_ADAPTERS with a PlatformAdapter[] value. */
  platformAdapters?: Provider;
  /** Must provide AGENT_PLANNER. Omit to use the registered local templates. */
  planner?: Provider;
}

@Module({})
export class RuntimeCoreModule {
  static register(options: RuntimeCoreOptions = {}): DynamicModule {
    return {
      module: RuntimeCoreModule,
      providers: [
        ...coreProviders,
        { provide: LOCAL_TASK_TEMPLATES, useValue: options.operations ?? [] },
        ...(options.platformAdapters ? [options.platformAdapters] : []),
        ...(options.decisionProvider ? [options.decisionProvider] : []),
        options.planner ?? { provide: AGENT_PLANNER, useExisting: LocalTaskPlannerService },
      ],
      exports: coreExports,
    };
  }
}
