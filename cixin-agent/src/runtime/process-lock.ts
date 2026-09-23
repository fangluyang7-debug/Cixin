import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { invariant } from './util';

// Local filesystem only. A second process must not independently admit the same attempt IDs.
export function acquireProcessLock(path: string): () => void {
  let handle: number;
  try { handle = openSync(path, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const pid = Number(readFileSync(path, 'utf8'));
    invariant(Number.isSafeInteger(pid) && pid > 0, 'INVALID_RUNTIME_LOCK_CHECK_OWNER_MANUALLY');
    let alive = true;
    try { process.kill(pid, 0); } catch (probeError) {
      if ((probeError as NodeJS.ErrnoException).code === 'ESRCH') alive = false; else throw probeError;
    }
    invariant(!alive, 'DATA_DIRECTORY_ALREADY_IN_USE');
    unlinkSync(path);
    handle = openSync(path, 'wx', 0o600);
  }
  writeFileSync(handle, String(process.pid));
  return () => { closeSync(handle); unlinkSync(path); };
}
