import { spawn } from 'node:child_process';
import { createReadStream, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { ProcessWorkerConfig, ToolImplementation } from '../contracts/fleet';
import { ToolDescriptor } from '../contracts/cixin';
import { Backend, CancellationSignal, ExecutorResult, InferenceLocation, TaskTemplate } from '../scheduler/api/SchedulerTypes';
import { byteLength, finite, invariant } from '../runtime/util';

interface WorkerManifest {
  protocolVersion: 1;
  descriptor: ToolDescriptor;
  template: TaskTemplate;
  model: { path: string; sha256: string };
  runtime: { name: string; version: string };
}
interface WorkerProbe {
  protocolVersion: 1;
  available: boolean;
  backend: Backend;
  modelSha256: string;
  runtimeVersion: string;
}

// The executable is administrator configuration. Tasks cannot supply commands or paths.
// A fresh process owns each inference, so kill/close is an actual cancellation boundary.
function invoke(config: ProcessWorkerConfig, payload: unknown, timeoutMs: number, signal?: CancellationSignal): Promise<unknown> {
  return new Promise((resolveResult, reject) => {
    if (signal?.isCancellationRequested) { reject(new Error('TASK_CANCELLED')); return; }
    const child = spawn(config.command, config.args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let size = 0; let failure: Error | undefined;
    const stop = (reason: string) => { failure ??= new Error(reason); child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop('WORKER_TIMEOUT'), timeoutMs);
    const unsubscribe = signal?.onCancelled(() => stop('TASK_CANCELLED'));
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) stop('WORKER_OUTPUT_TOO_LARGE'); else output += chunk.toString('utf8');
    });
    // Drain stderr, but do not put model inputs or provider secrets in task logs.
    child.stderr.resume();
    child.stdin.on('error', () => { /* close/error below settles the execution. */ });
    child.on('error', error => { failure = error; });
    child.on('close', code => {
      clearTimeout(timer); unsubscribe?.();
      if (failure) { reject(failure); return; }
      if (code !== 0) { reject(new Error(`WORKER_EXIT_${code}`)); return; }
      try { resolveResult(JSON.parse(output)); } catch { reject(new Error('INVALID_WORKER_JSON')); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export function processWorkerTool(config: ProcessWorkerConfig): ToolImplementation {
  const manifest = JSON.parse(readFileSync(config.manifestPath, 'utf8')) as WorkerManifest;
  invariant(manifest.protocolVersion === 1 && manifest.model && /^[a-f0-9]{64}$/.test(manifest.model.sha256) &&
    manifest.runtime?.version && manifest.template?.manifest?.profiles.length === 1, 'INVALID_WORKER_MANIFEST');
  const profile = manifest.template.manifest.profiles[0];
  invariant(manifest.template.inferenceLocation === InferenceLocation.LOCAL_DEVICE &&
    [Backend.CPU, Backend.GPU, Backend.NPU].includes(profile.backend), 'UNSUPPORTED_WORKER_BACKEND');
  const modelPath = resolve(dirname(config.manifestPath), manifest.model.path);
  let verifiedStamp = '';
  let cachedProbe: { at: number; value: { available: boolean; reason?: string } } | undefined;
  const base = { protocolVersion: 1, modelPath, modelSha256: manifest.model.sha256,
    runtime: manifest.runtime, backend: profile.backend };
  const probe = async (): Promise<{ available: boolean; reason?: string }> => {
    try {
      const info = await stat(modelPath);
      const stamp = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
      if (stamp !== verifiedStamp) {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(modelPath)) hash.update(chunk);
        invariant(hash.digest('hex') === manifest.model.sha256, 'MODEL_DIGEST_MISMATCH');
        verifiedStamp = stamp; cachedProbe = undefined;
      }
      if (cachedProbe && Date.now() - cachedProbe.at < 1000) return cachedProbe.value;
      const result = await invoke(config, { ...base, operation: 'probe' }, 3000) as WorkerProbe;
      invariant(result.protocolVersion === 1 && result.available === true && result.backend === profile.backend &&
        result.modelSha256 === manifest.model.sha256 && result.runtimeVersion === manifest.runtime.version, 'WORKER_PROBE_MISMATCH');
      const value = { available: true }; cachedProbe = { at: Date.now(), value }; return value;
    } catch { return { available: false, reason: 'MODEL_OR_RUNTIME_PROBE_FAILED' }; }
  };
  return {
    descriptor: manifest.descriptor, template: manifest.template,
    modelDigest: manifest.model.sha256, runtimeVersion: `${manifest.runtime.name}:${manifest.runtime.version}`, probe,
    executor: {
      capability: manifest.descriptor.toolId, inferenceLocation: InferenceLocation.LOCAL_DEVICE,
      supports: plan => plan.executionProfile?.id === profile.id && plan.executionProfile.backend === profile.backend &&
        plan.executionProfile.workerCount === profile.workerCount,
      async execute(input, plan, signal) {
        const reply = await invoke(config, { ...base, operation: 'execute', input,
          profile: plan.executionProfile }, manifest.template.timeoutMs, signal) as {
            protocolVersion: number; modelSha256: string; runtimeVersion: string; quality: number;
            result: ExecutorResult<unknown>;
          };
        invariant(reply.protocolVersion === 1 && reply.modelSha256 === manifest.model.sha256 &&
          reply.runtimeVersion === manifest.runtime.version && reply.result && byteLength(reply.result.output) <= 512 * 1024,
        'WORKER_RECEIPT_MISMATCH');
        invariant(finite(reply.quality, 0, 1) && reply.quality >= (manifest.descriptor.quality.minimumScore ?? 0), 'WORKER_QUALITY_REJECTED');
        invariant(reply.result.telemetry?.actualBackend === profile.backend && reply.result.telemetry?.executionPath !== 'serial_fallback',
          'WORKER_BACKEND_FALLBACK_REJECTED');
        return reply.result;
      },
      async dispose() {},
    },
  };
}
