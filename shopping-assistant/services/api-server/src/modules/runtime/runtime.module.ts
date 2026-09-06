import { Injectable, Module, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AgentRuntimeService } from "../../core/runtime/agent-runtime.service";
import { CloudPlatformAdapterService } from "../../core/runtime/cloud-platform-adapter.service";
import { CixP1PlatformAdapterService, HarmonyPlatformAdapterService } from "../../core/runtime/unavailable-platform-adapters.service";
import { HostPlatformAdapterService } from "../../core/runtime/host-platform-adapter.service";
import { PerformanceRegistryService } from "../../core/runtime/performance-registry.service";
import { PlatformDiscoveryService } from "../../core/runtime/platform-discovery.service";
import { ResourceAwareSchedulerService } from "../../core/runtime/scheduler.service";
import { RuntimeSnapshotService } from "../../core/runtime/runtime-snapshot.service";
import { TelemetryService } from "../../core/runtime/telemetry.service";
import { ToolRegistryService } from "../../core/runtime/tool-registry.service";
import { createShoppingPlugin } from "../../core/runtime/shopping-plugin";
import { RuntimeController } from "./controllers/runtime.controller";

@Injectable()
class ShoppingPluginRegistration implements OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    private readonly registry: ToolRegistryService,
  ) {}

  onModuleInit() {
    this.registry.registerPlugin(createShoppingPlugin(this.config));
  }
}

@Module({
  controllers: [RuntimeController],
  providers: [
    ToolRegistryService,
    PerformanceRegistryService,
    TelemetryService,
    HostPlatformAdapterService,
    HarmonyPlatformAdapterService,
    CixP1PlatformAdapterService,
    CloudPlatformAdapterService,
    PlatformDiscoveryService,
    ResourceAwareSchedulerService,
    RuntimeSnapshotService,
    AgentRuntimeService,
    ShoppingPluginRegistration,
  ],
  exports: [
    ToolRegistryService,
    PerformanceRegistryService,
    TelemetryService,
    ResourceAwareSchedulerService,
    AgentRuntimeService,
  ],
})
export class RuntimeModule {}
