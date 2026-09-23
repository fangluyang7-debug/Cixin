import * as os from 'node:os';
import { readFile } from 'node:fs/promises';
import { BoardAdapter, BoardIdentity, RuntimeConfig } from '../contracts/fleet';
import { AppVisibility, Backend, MemoryPressure, RealDeviceStatePatch, ThermalLevel } from '../scheduler/api/SchedulerTypes';
import { digest, finite, invariant } from '../runtime/util';

async function read(path: string): Promise<string | null> {
  try { return (await readFile(path, 'utf8')).replace(/\0/g, '').trim(); } catch { return null; }
}
export class LinuxBoardAdapter implements BoardAdapter {
  private previousCpu: { idle: number; total: number } | undefined;
  private constructor(public readonly identity: BoardIdentity, private readonly thermal?: RuntimeConfig['thermal']) {}

  static async create(config: RuntimeConfig): Promise<LinuxBoardAdapter> {
    if (config.family === 'cix') invariant(os.platform() === 'linux' && os.arch() === 'arm64',
      'CIX_REQUIRES_LINUX_ARM64: use family=host for development');
    const detectedModel = await read('/proc/device-tree/model') ?? await read('/sys/class/dmi/id/product_name');
    const model = config.boardModel ?? detectedModel ?? 'unknown-host';
    invariant(config.family !== 'cix' || model.length > 0 && model !== 'unknown-host', 'BOARD_MODEL_REQUIRED');
    const identity: BoardIdentity = {
      deviceId: config.deviceId, family: config.family, model, os: os.platform(), arch: os.arch(),
      kernel: os.release(), runtime: process.version,
      environmentKey: digest({ model, kernel: os.release(), arch: os.arch(), runtime: process.version }),
    };
    return new LinuxBoardAdapter(identity, config.thermal);
  }

  async sample(): Promise<RealDeviceStatePatch> {
    const totals = os.cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle,
      total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
    const firstSample = this.previousCpu === undefined;
    const delta = this.previousCpu ? totals.total - this.previousCpu.total : 0;
    const usage = delta > 0 && this.previousCpu ? Math.max(0, Math.min(100,
      100 * (1 - (totals.idle - this.previousCpu.idle) / delta))) : null;
    if (firstSample || delta > 0) this.previousCpu = totals;
    const meminfo = os.platform() === 'linux' ? await read('/proc/meminfo') : null;
    const availableKb = meminfo?.match(/^MemAvailable:\s+(\d+)\s+kB/m)?.[1];
    const available = availableKb ? Number(availableKb) / 1024 : os.freemem() / 1024 ** 2;
    const total = os.totalmem() / 1024 ** 2;
    let thermalLevel = ThermalLevel.UNKNOWN;
    if (this.thermal) {
      const raw = await read(this.thermal.path);
      const celsius = raw === null ? NaN : Number(raw) / 1000;
      if (finite(celsius, -40, 200)) thermalLevel = celsius >= this.thermal.criticalC ? ThermalLevel.CRITICAL :
        celsius >= this.thermal.hotC ? ThermalLevel.HOT : celsius >= this.thermal.warmC ? ThermalLevel.WARM : ThermalLevel.NORMAL;
    }
    return {
      // Mains-powered boards have no inferred phone battery percentage.
      batteryApplicable: false, batteryPercent: null, isCharging: null, thermalLevel,
      ...(firstSample || delta > 0 ? { systemCpuUsage: usage } : {}), appCpuUsage: null,
      totalMemoryMb: total, freeMemoryMb: os.freemem() / 1024 ** 2, availableMemoryMb: available,
      memoryPressure: available < 192 || available / total < 0.04 ? MemoryPressure.CRITICAL :
        available < 512 || available / total < 0.12 ? MemoryPressure.HIGH : MemoryPressure.NORMAL,
      appVisibility: AppVisibility.FOREGROUND, availableBackends: [Backend.CPU],
    };
  }
}
