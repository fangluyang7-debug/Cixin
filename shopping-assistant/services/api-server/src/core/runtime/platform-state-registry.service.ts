import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ExecutorDescriptor,
  PlatformHeartbeat,
  PlatformHeartbeatStatus,
  PlatformProfile,
  RuntimePlatformId,
  RuntimeState,
} from "./runtime.contracts";

export interface PlatformStateReport {
  state: RuntimeState;
  profile?: PlatformProfile;
  executors?: ExecutorDescriptor[];
  reportedAt: string;
  receivedAt: string;
  source: string;
}

@Injectable()
export class PlatformStateRegistryService {
  private readonly reports = new Map<RuntimePlatformId, PlatformStateReport>();

  constructor(private readonly config: ConfigService) {}

  upsert(heartbeat: PlatformHeartbeat) {
    const report: PlatformStateReport = {
      state: heartbeat.state,
      profile: heartbeat.profile,
      executors: heartbeat.executors,
      reportedAt: heartbeat.reportedAt,
      receivedAt: new Date().toISOString(),
      source: heartbeat.source ?? "platform-heartbeat",
    };
    this.reports.set(heartbeat.platformId, report);
    return report;
  }

  get(platformId: RuntimePlatformId) {
    return this.reports.get(platformId) ?? null;
  }

  merge(
    platformId: RuntimePlatformId,
    base: { state: RuntimeState; profile: PlatformProfile; executors: ExecutorDescriptor[] },
  ) {
    const report = this.get(platformId);
    if (!report) return { ...base, heartbeat: null };
    const maxAgeMs = this.config.get<number>("runtime.platformReportTtlMs") ?? 10000;
    const receivedAt = Date.parse(report.receivedAt);
    const ageMs = Number.isFinite(receivedAt) ? Math.max(0, Date.now() - receivedAt) : maxAgeMs + 1;
    const fresh = ageMs <= maxAgeMs;
    const heartbeat: PlatformHeartbeatStatus = {
      fresh,
      reportedAt: report.reportedAt,
      receivedAt: report.receivedAt,
      source: report.source,
      ageMs,
      expiresInMs: Math.max(0, maxAgeMs - ageMs),
      executorIds: (report.executors ?? []).map((executor) => executor.executorId),
    };
    if (!fresh) return { ...base, heartbeat };
    const executors = report.executors ?? base.executors;
    const profile = report.profile
      ? { ...base.profile, ...report.profile, platformId, backends: executors }
      : { ...base.profile, backends: executors };
    return {
      state: mergeState(base.state, report.state),
      profile,
      executors,
      heartbeat,
    };
  }

  list() {
    return [...this.reports.entries()].map(([platformId, report]) => ({
      platformId,
      ...report,
    }));
  }
}

function mergeState(base: RuntimeState, reported: RuntimeState): RuntimeState {
  return {
    ...base,
    ...reported,
    platformId: base.platformId,
    observedAt: reported.observedAt || base.observedAt,
  };
}
