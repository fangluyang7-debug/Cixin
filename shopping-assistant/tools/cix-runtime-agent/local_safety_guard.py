"""Linux-only hard guard for a worker explicitly launched by an executor adapter.

The guard runs on the terminal, independently of heartbeat HTTP requests.
It never accepts a PID supplied by telemetry and never kills unrelated apps.
"""

from __future__ import annotations

import math
import os
import signal
import subprocess
import time
from dataclasses import dataclass
from typing import Callable, Sequence

from cix_runtime_agent import memory_info, soc_temperature_celsius


@dataclass(frozen=True)
class SafetySample:
    temperature_celsius: float | None
    free_memory_mb: float | None


@dataclass(frozen=True)
class WorkerOutcome:
    returncode: int
    protection_reason: str | None = None
    report_error: str | None = None


def read_safety_sample() -> SafetySample:
    free, _ = memory_info()
    return SafetySample(soc_temperature_celsius(), free)


def redline(sample: SafetySample, critical_temperature: float = 85, reserve_mb: float = 128) -> str | None:
    temperature = sample.temperature_celsius
    memory = sample.free_memory_mb
    if temperature is not None and math.isfinite(temperature) and temperature >= critical_temperature:
        return "TERMINAL_THERMAL_REDLINE"
    if memory is None or not math.isfinite(memory) or memory < reserve_mb:
        return "TERMINAL_MEMORY_REDLINE"
    return None


def _stop_owned_group(worker: subprocess.Popen, grace_seconds: float) -> None:
    # start_new_session=True creates a process group owned by this invocation.
    try:
        os.killpg(worker.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        worker.wait(timeout=grace_seconds)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(worker.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    worker.wait()


def run_guarded_worker(
    command: Sequence[str],
    on_stopped: Callable[[str], None],
    sample: Callable[[], SafetySample] = read_safety_sample,
    cancelled: Callable[[], bool] = lambda: False,
    interval_seconds: float = 0.1,
    grace_seconds: float = 1.0,
    critical_temperature: float = 85,
    reserve_mb: float = 128,
) -> WorkerOutcome:
    """Stop and reap the owned group before notifying Runtime or returning.

    The embedding executor must provide capture/restore and stable Runtime IDs.
    Do not use this wrapper for workers that daemonize or escape their session.
    Output inherits the caller's streams; no unbounded PIPE buffering is used.
    """
    if os.name != "posix":
        raise RuntimeError("LOCAL_GUARD_REQUIRES_LINUX_PROCESS_GROUPS")
    if not command or isinstance(command, (str, bytes)):
        raise ValueError("WORKER_COMMAND_MUST_BE_ARGV")
    for value in (interval_seconds, grace_seconds, critical_temperature, reserve_mb):
        if not math.isfinite(value) or value <= 0:
            raise ValueError("LOCAL_GUARD_CONFIG_INVALID")
    if interval_seconds > 1:
        raise ValueError("LOCAL_GUARD_INTERVAL_TOO_LONG")
    if cancelled():
        return WorkerOutcome(-1, "USER_CANCELLED")
    initial = redline(sample(), critical_temperature, reserve_mb)
    if initial:
        return _notify(-1, initial, on_stopped)
    worker = subprocess.Popen(list(command), start_new_session=True, shell=False)
    try:
        while worker.poll() is None:
            if cancelled():
                _stop_owned_group(worker, grace_seconds)
                return WorkerOutcome(worker.returncode, "USER_CANCELLED")
            reason = redline(sample(), critical_temperature, reserve_mb)
            if reason:
                _stop_owned_group(worker, grace_seconds)
                return _notify(worker.returncode, reason, on_stopped)
            time.sleep(interval_seconds)
        _stop_owned_group(worker, grace_seconds)
        return WorkerOutcome(worker.returncode)
    finally:
        if worker.poll() is None:
            _stop_owned_group(worker, grace_seconds)


def _notify(returncode: int, reason: str, callback: Callable[[str], None]) -> WorkerOutcome:
    try:
        callback(reason)
        return WorkerOutcome(returncode, reason)
    except Exception as error:
        # Reporting failure cannot undo a local stop. The adapter retains/retries the event.
        return WorkerOutcome(returncode, reason, str(error))
