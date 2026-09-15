import { ConfigService } from "@nestjs/config";
import { ResourcePredictorService } from "../../src/core/runtime/resource-predictor.service";
import { RuntimeState } from "../../src/core/runtime/runtime.contracts";

const start = Date.parse("2026-09-15T00:00:00.000Z");
function state(at: number, temperature: number, freeMemory = 2048): RuntimeState {
  const metric = (value: number) => ({ value, available: true, source: "board", observedAt: new Date(at).toISOString() });
  return {
    platformId: "cix_p1", cpuUtilizationPercent: metric(40), temperatureCelsius: metric(temperature),
    freeMemoryMb: metric(freeMemory), batteryPercent: metric(70),
    gpuUtilizationPercent: metric(0), npuUtilizationPercent: metric(0),
    networkLatencyMs: metric(2), networkThroughputMbps: metric(100), diskFreeMb: metric(500),
    activeTaskCount: metric(1), observedAt: new Date(at).toISOString(),
  };
}

describe("resource predictor", () => {
  it("stops a rising temperature before the measured temperature reaches the redline", () => {
    const predictor = new ResourcePredictorService(new ConfigService());
    for (const [i, temp] of [76, 78, 80].entries()) predictor.observe(state(start + i * 1000, temp), start + i * 1000);
    const forecast = predictor.assess(state(start + 2000, 80), { memoryMb: 200, durationMs: 3000, cpu: true, phase: "running" }, start + 2000);
    expect(forecast.action).toBe("stop_and_rollback");
    expect(forecast.reasons).toContain("PREDICTED_THERMAL_REDLINE");
    expect(forecast.values.temperatureCelsius.predicted).toBeGreaterThan(85);
  });

  it("blocks when memory headroom cannot cover the task and reserve", () => {
    const forecast = new ResourcePredictorService(new ConfigService()).assess(
      state(start, 40, 200), { memoryMb: 100, durationMs: 1000, cpu: true }, start);
    expect(forecast.action).toBe("reject");
    expect(forecast.reasons).toContain("PREDICTED_MEMORY_REDLINE");
  });

  it("does not treat old measurements as safe zeros", () => {
    const forecast = new ResourcePredictorService(new ConfigService()).assess(
      state(start, 40), { memoryMb: 100, durationMs: 1000, cpu: true }, start + 20000);
    expect(forecast.reasons).toContain("PREDICTION_MEMORY_UNAVAILABLE");
    expect(forecast.unknownMetrics).toContain("temperatureCelsius");
  });
});

describe("permissive risk acceptance matrix", () => {
  it("never advises running when warnings coexist with a critical redline", () => {
    const current = state(start, 90);
    current.cpuUtilizationPercent.value = 96;
    const forecast = new ResourcePredictorService(new ConfigService()).assess(current, { memoryMb: 100, durationMs: 1000, cpu: true }, start);
    expect(forecast.risk).toBe("critical");
    expect(forecast.reasons).toContain("CPU_PRESSURE_WARNING");
    expect(forecast.advice.join(" ")).not.toContain("允许运行");
  });
  const cases = [
    { name: "normal", expected: "nominal", temperature: 45, cpu: 30 },
    { name: "ordinary high load", expected: "warning", temperature: 65, cpu: 96 },
    { name: "mild warming", expected: "warning", temperature: 77, cpu: 50 },
    { name: "critical heat", expected: "critical", temperature: 86, cpu: 40 },
    { name: "memory headroom", expected: "warning", memory: 280 },
    { name: "memory exhaustion", expected: "critical", memory: 200 },
    { name: "low battery short interruptible task", expected: "warning", battery: 3 },
    { name: "low battery costly task", expected: "critical", battery: 3, energy: 8 },
    { name: "low battery external power", expected: "nominal", battery: 3, energy: 8, power: true },
    { name: "network jitter", expected: "warning", jitter: 40 },
    { name: "queue without deadline", expected: "warning", queue: 40, wait: 1000 },
    { name: "queue deadline breach", expected: "critical", queue: 40, wait: 1000, deadline: 1500 },
    { name: "throttle short task", expected: "warning", throttle: true, cpu: 96 },
    { name: "throttle sustained task", expected: "critical", throttle: true, cpu: 96, duration: 4000 },
    { name: "unknown optional CPU", expected: "unknown", unknownCpu: true },
  ];
  it.each(cases)("$name -> $expected", scenario => {
    const config = new ConfigService();
    const predictor = new ResourcePredictorService(config);
    const current = state(start, scenario.temperature ?? 45, scenario.memory ?? 2048);
    current.cpuUtilizationPercent.value = scenario.cpu ?? 30;
    if (scenario.unknownCpu) current.cpuUtilizationPercent.available = false;
    current.batteryPercent.value = scenario.battery ?? 70;
    const metric = <T>(value: T) => ({ value, available: true, source: "test", observedAt: new Date(start).toISOString() });
    current.externalPower = metric(scenario.power ?? false);
    current.thermalThrottle = metric(scenario.throttle ?? false);
    current.queueDepth = metric(scenario.queue ?? 0);
    current.queueWaitMs = metric(scenario.wait ?? 0);
    current.networkJitterMs = metric(scenario.jitter ?? 0);
    const forecast = predictor.assess(current, {
      memoryMb: 100, durationMs: scenario.duration ?? 1000, cpu: true, energyMah: scenario.energy ?? 0.1,
      interruptible: true, latencyBudgetMs: scenario.deadline,
    }, start);
    expect(forecast.risk).toBe(scenario.expected);
    expect(forecast.action).toBe(scenario.expected === "critical" ? "reject" : scenario.expected === "warning" ? "run_conservatively" : "run_with_monitoring");
  });

  it("does not count active allocations twice", () => {
    const predictor = new ResourcePredictorService(new ConfigService());
    const current = state(start, 45, 400);
    expect(predictor.assess(current, { memoryMb: 500, durationMs: 1000, cpu: true, phase: "running" }, start).action).not.toBe("stop_and_rollback");
  });

  it("honors fresh accelerator memory evidence without inventing an absent probe", () => {
    const predictor = new ResourcePredictorService(new ConfigService());
    const current = state(start, 45);
    const input = { memoryMb: 500, durationMs: 1000, cpu: false, backend: "npu" as const };
    expect(predictor.assess(current, input, start).action).not.toBe("reject");
    current.npuMemoryFreeMb = { ...current.freeMemoryMb, value: 300 };
    expect(predictor.assess(current, input, start).reasons).toContain("ACCELERATOR_MEMORY_REDLINE");
  });
});
