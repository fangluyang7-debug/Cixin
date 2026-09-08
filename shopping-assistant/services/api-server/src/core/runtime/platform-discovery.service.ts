import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ExecutorDescriptor,
  PlatformHeartbeatStatus,
  PlatformProfile,
  RuntimeState,
} from "./runtime.contracts";
import { PlatformAdapter } from "./platform-adapter.interface";
import { CixP1PlatformAdapterService, HarmonyPlatformAdapterService } from "./unavailable-platform-adapters.service";
import { CloudPlatformAdapterService } from "./cloud-platform-adapter.service";
import { HostPlatformAdapterService } from "./host-platform-adapter.service";
import { PlatformStateRegistryService } from "./platform-state-registry.service";

export interface PlatformSnapshot {
  adapter: PlatformAdapter;
  profile: PlatformProfile;
  state: RuntimeState;
  executors: ExecutorDescriptor[];
  heartbeat: PlatformHeartbeatStatus | null;
}

@Injectable()
export class PlatformDiscoveryService {
  constructor(
    private readonly config: ConfigService,
    private readonly host: HostPlatformAdapterService,
    private readonly harmonyos: HarmonyPlatformAdapterService,
    private readonly cixP1: CixP1PlatformAdapterService,
    private readonly cloud: CloudPlatformAdapterService,
    private readonly stateRegistry: PlatformStateRegistryService,
  ) {}

  async discover(): Promise<PlatformSnapshot[]> {
    const adapters = this.activeAdapters();
    return Promise.all(
      adapters.map(async (adapter) => {
        const [profile, state, executors] = await Promise.all([
          adapter.getStaticProfile(),
          adapter.getRuntimeState(),
          adapter.discoverExecutors(),
        ]);
        const merged = this.stateRegistry.merge(adapter.platformId, {
          state,
          profile: { ...profile, backends: executors },
          executors,
        });
        return {
          adapter,
          profile: merged.profile,
          state: merged.state,
          executors: merged.executors,
          heartbeat: merged.heartbeat,
        };
      }),
    );
  }

  private activeAdapters(): PlatformAdapter[] {
    const configured =
      this.config.get<string>("runtime.platformAdapter")?.trim().toLowerCase() ??
      "auto";
    if (configured === "host") return [this.host];
    if (configured === "harmonyos") return [this.harmonyos];
    if (configured === "cix_p1") return [this.cixP1];
    if (configured === "cloud") return [this.cloud];
    if (configured === "all") {
      return [this.host, this.harmonyos, this.cixP1, this.cloud];
    }
    // Keep the board slots visible in the monitor even before a device connects.
    // Their adapters return explicit unavailable states until a heartbeat arrives.
    return [this.host, this.harmonyos, this.cixP1, this.cloud];
  }
}
