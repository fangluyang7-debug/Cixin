import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BackendType, MetricObservation, ResourceForecast, RuntimePlatformId, RuntimeState } from "./runtime.contracts";

type NumericMetric = "temperatureCelsius" | "freeMemoryMb" | "cpuUtilizationPercent" | "batteryPercent";
type Point = { at: number; value: number; source: string };
const metrics: NumericMetric[] = ["temperatureCelsius", "freeMemoryMb", "cpuUtilizationPercent", "batteryPercent"];

@Injectable()
export class ResourcePredictorService {
  private readonly history = new Map<string, Point[]>();
  constructor(private readonly config: ConfigService) {}

  number(key: string, fallback: number) {
    const value = this.config.get<number>(`runtime.${key}`);
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  }

  observe(state: RuntimeState, now = Date.now()) {
    for (const key of metrics) {
      const metric = state[key];
      const value = this.read(metric, now);
      if (value === null) continue;
      const at = Date.parse(metric.observedAt);
      const id = `${state.platformId}:${key}`;
      let points = this.history.get(id) ?? [];
      const previous = points.at(-1);
      if (previous && at <= previous.at) continue;
      if (previous && previous.source !== metric.source) points = [];
      points = points.filter(point => now - point.at <= this.number("predictionWindowMs", 30000));
      this.history.set(id, [...points, { at, value, source: metric.source }].slice(-60));
    }
  }

  read(metric: MetricObservation<number> | undefined, now = Date.now()): number | null {
    if (!metric?.available || typeof metric.value !== "number" || !Number.isFinite(metric.value)) return null;
    if (!this.isFresh(metric.observedAt, now)) return null;
    return metric.value;
  }

  readBoolean(metric: MetricObservation<boolean> | undefined, now = Date.now()): boolean | null {
    if (!metric?.available || typeof metric.value !== "boolean" || !this.isFresh(metric.observedAt, now)) return null;
    return metric.value;
  }

  assess(state: RuntimeState, input: {
    memoryMb: number; durationMs: number; cpu: boolean; phase?: "admission" | "running";
    backend?: BackendType; energyMah?: number | null; interruptible?: boolean;
    latencyBudgetMs?: number; local?: boolean;
  }, now = Date.now()): ResourceForecast {
    this.observe(state, now);
    const horizonMs = Math.min(this.number("predictionHorizonMs", 5000), Math.max(100, input.durationMs));
    const result: ResourceForecast = {
      method: "bounded_linear_trend_v1", horizonMs, risk: "nominal", action: "run_with_monitoring",
      reasons: [], advice: [], unknownMetrics: [], trendUnavailableMetrics: [], values: {},
    };
    for (const key of metrics) {
      const current = this.read(state[key], now);
      const points = this.points(state.platformId, key, state[key].source, now);
      const forecast = current === null ? null : extrapolate(points, current, horizonMs, key === "freeMemoryMb" || key === "batteryPercent");
      result.values[key] = { current, predicted: forecast?.value ?? null, samples: points.length, margin: forecast?.margin ?? 0 };
      if (current === null) result.unknownMetrics.push(key);
      else if (forecast === null) result.trendUnavailableMetrics!.push(key);
      if (forecast && key !== "temperatureCelsius") {
        result.values[key].predicted = Math.max(0, key === "freeMemoryMb" ? forecast.value : Math.min(100, forecast.value));
      }
    }
    const adverse = (key: NumericMetric, lower: boolean) => {
      const value = result.values[key];
      if (value.current === null) return null;
      return lower ? Math.min(value.current, value.predicted ?? value.current) : Math.max(value.current, value.predicted ?? value.current);
    };
    const critical: string[] = [];
    const warnings: string[] = [];
    const optional = (key: keyof RuntimeState) => {
      const value = this.read(state[key] as MetricObservation<number> | undefined, now);
      result.values[key] = { current: value, predicted: null, samples: value === null ? 0 : 1, margin: 0 };
      if (value === null) result.unknownMetrics.push(key);
      return value;
    };
    if (input.local !== false) {
      const memory = adverse("freeMemoryMb", true);
      // While running, free memory already includes current allocations. Do not reserve them twice.
      const required = this.number("memoryReserveMb", 128) + (input.phase === "running" ? 0 : input.memoryMb);
      if (memory === null) critical.push("PREDICTION_MEMORY_UNAVAILABLE");
      else if (memory < required) critical.push("PREDICTED_MEMORY_REDLINE");
      else if (memory < required + this.number("memoryReserveMb", 128)) warnings.push("MEMORY_HEADROOM_WARNING");
      const temperature = adverse("temperatureCelsius", false);
      if (temperature !== null && temperature >= this.number("criticalTemperatureCelsius", 85)) critical.push("PREDICTED_THERMAL_REDLINE");
      else if (temperature !== null && temperature >= this.number("highTemperatureCelsius", 75)) warnings.push("TEMPERATURE_WARNING");
      const cpu = adverse("cpuUtilizationPercent", false);
      if (input.cpu && cpu !== null && cpu >= this.number("warningUtilizationPercent", 85)) warnings.push("CPU_PRESSURE_WARNING");
      let utilization = cpu;
      if (input.backend === "gpu" || input.backend === "npu") {
        utilization = optional(input.backend === "gpu" ? "gpuUtilizationPercent" : "npuUtilizationPercent");
        if (utilization !== null && utilization >= this.number("warningUtilizationPercent", 85)) warnings.push("ACCELERATOR_PRESSURE_WARNING");
        const free = optional(input.backend === "gpu" ? "gpuMemoryFreeMb" : "npuMemoryFreeMb");
        if (free !== null && free < (input.phase === "running" ? 0 : input.memoryMb)) critical.push("ACCELERATOR_MEMORY_REDLINE");
      }
      const battery = adverse("batteryPercent", true);
      const externalPower = this.readBoolean(state.externalPower, now);
      if (externalPower === null) result.unknownMetrics.push("externalPower");
      if (battery !== null && externalPower !== true) {
        if (battery <= this.number("criticalBatteryPercent", 5) &&
            (input.interruptible === false || (input.energyMah ?? 0) >= this.number("highTaskEnergyMah", 5))) critical.push("PREDICTED_BATTERY_REDLINE");
        else if (battery <= this.number("lowBatteryPercent", 20)) warnings.push("BATTERY_WARNING");
      }
      if (this.readBoolean(state.thermalThrottle, now) === true) {
        if ((utilization ?? 0) >= 90 && input.durationMs >= this.number("sustainedLoadMs", 2000)) critical.push("SUSTAINED_THERMAL_THROTTLING");
        else warnings.push("THERMAL_THROTTLING_WARNING");
      }
    }
    const queue = optional("queueDepth");
    const wait = optional("queueWaitMs");
    const activeTasks = optional("activeTaskCount");
    if ((queue ?? 0) >= this.number("maxLocalQueueDepth", 32) || (activeTasks ?? 0) >= 8) warnings.push("QUEUE_PRESSURE_WARNING");
    if (input.phase !== "running" && wait !== null && wait > 0 && input.latencyBudgetMs !== undefined && wait + input.durationMs > input.latencyBudgetMs) {
      critical.push("QUEUE_DEADLINE_REDLINE");
    }
    const jitter = optional("networkJitterMs");
    const loss = optional("packetLossPercent");
    if ((jitter ?? 0) > 20 || (loss ?? 0) > 1) warnings.push("NETWORK_INSTABILITY_WARNING");
    result.reasons = [...critical, ...warnings];
    if (critical.length) {
      result.risk = "critical";
      result.action = input.phase === "running" ? "stop_and_rollback" : "reject";
    } else if (warnings.length) {
      result.risk = "warning";
      result.action = "run_conservatively";
    } else if (metrics.some(key => result.unknownMetrics.includes(key))) {
      result.risk = "unknown";
    }
    result.advice = adviceFor(result.reasons);
    if (result.unknownMetrics.length) result.advice.push("部分指标缺少新鲜观测或趋势样本；补齐探针后才能评估对应风险。");
    if (warnings.length && critical.length === 0) result.advice.push("允许运行；限制本应用并发，允许降级时优先已验证的轻量模型，并持续监控。");
    return result;
  }

  private points(platformId: RuntimePlatformId, key: NumericMetric, source: string, now: number) {
    return (this.history.get(`${platformId}:${key}`) ?? []).filter(point =>
      point.source === source && now - point.at <= this.number("predictionWindowMs", 30000));
  }

  private isFresh(observedAt: string, now: number) {
    const age = now - Date.parse(observedAt);
    return Number.isFinite(age) && age >= -1000 && age <= this.number("predictionMetricTtlMs", 10000);
  }
}

function extrapolate(points: Point[], current: number, horizonMs: number, lower: boolean) {
  if (points.length < 3 || points.at(-1)!.at - points[0].at < 1000) return null;
  const origin = points[0].at;
  const xs = points.map(point => (point.at - origin) / 1000);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = points.reduce((a, b) => a + b.value, 0) / points.length;
  const denominator = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  if (!denominator) return null;
  const slope = points.reduce((sum, p, i) => sum + (xs[i] - mx) * (p.value - my), 0) / denominator;
  const residual = Math.max(...points.map((p, i) => Math.abs(p.value - (my + slope * (xs[i] - mx)))));
  // Residual margin is a conservative heuristic, not a calibrated probability interval.
  return { value: current + slope * horizonMs / 1000 + (lower ? -residual : residual), margin: residual };
}

export function adviceFor(reasons: string[]): string[] {
  const advice = new Set<string>();
  for (const reason of reasons) {
    if (/MEMORY/.test(reason)) advice.add("减少批量大小或释放本应用可重建缓存；其他应用占用需由用户处理。");
    if (/THERMAL|TEMPERATURE/.test(reason)) advice.add("暂停本应用高负载任务并等待降温，检查开发板散热。");
    if (/CPU|QUEUE/.test(reason)) advice.add("减少本应用并发或暂停后台任务，再重试。");
    if (/NETWORK/.test(reason)) advice.add("检查网络连接；允许本地执行时优先比较本地候选，必要时放宽时限。");
    if (/BATTERY/.test(reason)) advice.add("接通电源或降低任务规模，待电量恢复后重试。");
    if (/LATENCY|DEADLINE/.test(reason)) advice.add("缩小任务范围、允许已验证的轻量模型，或放宽响应预算。");
    if (/UNAVAILABLE|MISSING|STALE/.test(reason)) advice.add("补齐新鲜设备观测、模型探测及实测性能样本。");
  }
  return [...advice];
}
