import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ExecutorDescriptor,
  PlatformProfile,
  RuntimeState,
} from "./runtime.contracts";
import { PlatformAdapter } from "./platform-adapter.interface";
import { CixP1PlatformAdapterService, HarmonyPlatformAdapterService } from "./unavailable-platform-adapters.service";
import { CloudPlatformAdapterService } from "./cloud-platform-adapter.service";
import { HostPlatformAdapterService } from "./host-platform-adapter.service";

export interface PlatformSnapshot {
  adapter: PlatformAdapter;
  profile: PlatformProfile;
  state: RuntimeState;
  executors: ExecutorDescriptor[];
}

@Injectable()
export class PlatformDiscoveryService {
  constructor(
    private readonly config: ConfigService,
    private readonly host: HostPlatformAdapterService,
    private readonly harmonyos: HarmonyPlatformAdapterService,
    private readonly cixP1: CixP1PlatformAdapterService,
    private readonly cloud: CloudPlatformAdapterService,
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
        return {
          adapter,
          profile: { ...profile, backends: executors },
          state,
          executors,
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
    return [this.host, this.cloud];
  }
}
