import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  PerformanceSample,
  TelemetryRecord,
} from "./runtime.contracts";

@Injectable()
export class PerformanceRegistryService {
  private readonly records = new Map<string, TelemetryRecord[]>();
  private readonly minimumSamples: number;

  constructor(private readonly config: ConfigService) {
    this.minimumSamples = Math.max(
      1,
      Math.floor(config.get<number>("runtime.minimumPerformanceSamples") ?? 3),
    );
  }

  record(record: TelemetryRecord) {
    validateTelemetry(record);
    const key = sampleKey(record.toolId, record.executorId, record.modelId);
    const current = this.records.get(key) ?? [];
    current.push(record);
    this.records.set(key, current);
    return this.get(record.toolId, record.executorId, record.modelId);
  }

  get(
    toolId: string,
    executorId: string,
    modelId?: string,
  ): PerformanceSample | null {
    const records = this.records.get(sampleKey(toolId, executorId, modelId));
    if (!records || records.length === 0) return null;
    return aggregate(records);
  }

  list(): PerformanceSample[] {
    return [...this.records.values()]
      .map((records) => aggregate(records))
      .sort((left, right) => {
        const toolOrder = left.toolId.localeCompare(right.toolId);
        return toolOrder !== 0
          ? toolOrder
          : left.executorId.localeCompare(right.executorId);
      });
  }

  getMinimumSamples() {
    return this.minimumSamples;
  }
}

export function sampleKey(toolId: string, executorId: string, modelId?: string) {
  return [toolId, executorId, modelId ?? "<unspecified-model>"].join("|");
}

function aggregate(records: TelemetryRecord[]): PerformanceSample {
  const latencies = records
    .map((record) => record.latencyMs)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const memories = records
    .map((record) => record.memoryPeakMb)
    .filter((value) => Number.isFinite(value));
  const energies = records
    .map((record) => record.energyMah)
    .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  const qualities = records
    .map((record) => record.quality)
    .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  const failures = records.filter((record) => !record.success).length;
  const noFallback = records.filter((record) => !record.fallbackOccurred).length;
  const latest = records.reduce((current, record) =>
    record.finishedAt > current ? record.finishedAt : current,
    records[0].finishedAt,
  );

  return {
    toolId: records[0].toolId,
    executorId: records[0].executorId,
    modelId: records[0].modelId,
    sampleCount: records.length,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    memoryPeakMb: memories.length > 0 ? Math.max(...memories) : null,
    energyMah: average(energies),
    quality: average(qualities),
    failureRate: failures / records.length,
    noFallbackRate: noFallback / records.length,
    measuredAt: latest,
    source: "runtime-telemetry",
  };
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return null;
  const index = Math.min(
    values.length - 1,
    Math.ceil(values.length * percentileValue) - 1,
  );
  return values[index];
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function validateTelemetry(record: TelemetryRecord) {
  if (!record.taskId || !record.toolId || !record.executorId) {
    throw new Error("TELEMETRY_IDENTIFIERS_REQUIRED");
  }
  const numericValues = [record.latencyMs, record.memoryPeakMb];
  if (numericValues.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("TELEMETRY_RESOURCE_METRICS_INVALID");
  }
  for (const value of [record.energyMah, record.quality]) {
    if (value !== null && value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error("TELEMETRY_OPTIONAL_METRIC_INVALID");
    }
  }
}
