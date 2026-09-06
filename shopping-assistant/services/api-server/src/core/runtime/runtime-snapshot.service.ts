import { Injectable } from "@nestjs/common";
import { MissingRequirement, RuntimeSnapshot } from "./runtime.contracts";
import { PerformanceRegistryService } from "./performance-registry.service";
import { PlatformDiscoveryService } from "./platform-discovery.service";
import { ToolRegistryService } from "./tool-registry.service";

@Injectable()
export class RuntimeSnapshotService {
  constructor(
    private readonly tools: ToolRegistryService,
    private readonly platforms: PlatformDiscoveryService,
    private readonly performance: PerformanceRegistryService,
  ) {}

  async getSnapshot(): Promise<RuntimeSnapshot> {
    const platformSnapshots = await this.platforms.discover();
    const missingRequirements: MissingRequirement[] = [];
    for (const snapshot of platformSnapshots) {
      for (const capability of snapshot.profile.missingCapabilities) {
        missingRequirements.push({
          code: capability,
          message: `平台 ${snapshot.profile.platformId} 未提供能力：${capability}。`,
        });
      }
      for (const executor of snapshot.executors) {
        if (!executor.available && executor.availabilityReason) {
          missingRequirements.push({
            code: executor.availabilityReason,
            message: `执行器 ${executor.executorId} 不可用。`,
          });
        }
      }
    }
    return {
      tools: this.tools.list(),
      platforms: platformSnapshots.map((snapshot) => ({
        profile: snapshot.profile,
        state: snapshot.state,
        executors: snapshot.executors,
      })),
      performanceSamples: this.performance.list(),
      missingRequirements: uniqueRequirements(missingRequirements),
      capturedAt: new Date().toISOString(),
    };
  }
}

function uniqueRequirements(requirements: MissingRequirement[]) {
  const seen = new Set<string>();
  return requirements.filter((requirement) => {
    const key = `${requirement.code}:${requirement.taskId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
