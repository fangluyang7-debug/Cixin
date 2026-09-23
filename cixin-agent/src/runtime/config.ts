import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { RuntimeConfig } from '../contracts/fleet';
import { finite, identifier, invariant } from './util';

export function loadConfig(path: string): RuntimeConfig {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as RuntimeConfig;
  invariant(raw && identifier(raw.deviceId) && ['cix', 'host'].includes(raw.family), 'INVALID_DEVICE_CONFIG');
  invariant(['LOCAL_ONLY', 'SHADOW', 'ACTIVE'].includes(raw.mode), 'INVALID_PLACEMENT_MODE');
  invariant(typeof raw.host === 'string' && raw.host.length > 0 && Number.isInteger(raw.port) && finite(raw.port, 1, 65535), 'INVALID_LISTEN_ADDRESS');
  invariant(identifier(raw.tokenEnv) && typeof raw.dataDir === 'string' && raw.dataDir.length > 0, 'TOKEN_ENV_AND_DATA_DIR_REQUIRED');
  invariant([1, 2].includes(raw.maxConcurrentLocalTasks) && Number.isInteger(raw.cpuWorkerBudget) && finite(raw.cpuWorkerBudget, 1, 256), 'INVALID_LOCAL_BUDGET');
  invariant(Number.isInteger(raw.minRemoteSamples) && finite(raw.minRemoteSamples, 0, 10000) &&
    Number.isInteger(raw.maxPendingTasks) && finite(raw.maxPendingTasks, 1, 1024), 'INVALID_ADMISSION_LIMIT');
  invariant(Array.isArray(raw.peers) && raw.peers.length <= 63, 'INVALID_PEERS');
  const ids = new Set([raw.deviceId]);
  for (const peer of raw.peers) {
    invariant(identifier(peer.deviceId) && !ids.has(peer.deviceId) && identifier(peer.tokenEnv) &&
      finite(peer.bytesPerSecond, 1, 100_000_000_000), 'INVALID_PEER');
    ids.add(peer.deviceId);
    const url = new URL(peer.url);
    invariant(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
      url.pathname === '/' && !url.search && !url.hash, 'INVALID_PEER_URL');
  }
  if (raw.thermal) invariant(typeof raw.thermal.path === 'string' && finite(raw.thermal.warmC, 0, 150) &&
    finite(raw.thermal.hotC, raw.thermal.warmC + 1, 160) && finite(raw.thermal.criticalC, raw.thermal.hotC + 1, 180), 'INVALID_THERMAL_THRESHOLDS');
  raw.dataDir = resolve(dirname(path), raw.dataDir);
  for (const worker of raw.workers ?? []) {
    invariant(typeof worker.command === 'string' && worker.command.length > 0 && Array.isArray(worker.args) &&
      worker.args.every(arg => typeof arg === 'string') && typeof worker.manifestPath === 'string', 'INVALID_WORKER_CONFIG');
    worker.manifestPath = resolve(dirname(path), worker.manifestPath);
  }
  return raw;
}
