import {
  ExecutorDescriptor,
  ModelProbeRequest,
  ModelProbeResult,
  PlatformProfile,
  RuntimeState,
} from "./runtime.contracts";

export const PLATFORM_ADAPTER = Symbol("PLATFORM_ADAPTER");

export interface PlatformAdapter {
  readonly platformId: PlatformProfile["platformId"];
  getStaticProfile(): Promise<PlatformProfile>;
  getRuntimeState(): Promise<RuntimeState>;
  discoverExecutors(): Promise<ExecutorDescriptor[]>;
  probeModel(
    executor: ExecutorDescriptor,
    request: ModelProbeRequest,
  ): Promise<ModelProbeResult>;
}
