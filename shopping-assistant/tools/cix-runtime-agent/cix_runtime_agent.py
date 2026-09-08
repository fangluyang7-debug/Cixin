#!/usr/bin/env python3
"""Publish measured CIX/Linux board state to the Agentic Runtime.

Only Python's standard library is required. Generic Linux probes are collected
from /proc and /sys. Vendor-specific CIX/NPU probes can atomically publish a
JSON file which is merged into the heartbeat without inventing missing values.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


STATE_KEYS = {
    "cpuUtilizationPercent",
    "cpuFrequencyMhz",
    "cpuCoreUtilizationPercent",
    "cpuClusterFrequencyMhz",
    "cpuClusterUtilizationPercent",
    "gpuUtilizationPercent",
    "npuUtilizationPercent",
    "temperatureCelsius",
    "freeMemoryMb",
    "networkLatencyMs",
    "networkThroughputMbps",
    "networkTxMbps",
    "networkRxMbps",
    "networkJitterMs",
    "packetLossPercent",
    "batteryPercent",
    "diskFreeMb",
    "activeTaskCount",
    "gpuMemoryUsedMb",
    "npuMemoryUsedMb",
    "gpuFrequencyMhz",
    "npuFrequencyMhz",
    "powerWatts",
    "fanRpm",
    "ioReadMbps",
    "ioWriteMbps",
    "iops",
    "queueDepth",
    "queueWaitMs",
    "memoryBandwidthMbps",
    "dmaPoolUsedMb",
    "uptimeSeconds",
    "npuLatencyMs",
    "databaseLatencyMs",
    "pipelineFps",
    "droppedFrames",
    "thermalThrottle",
    "currentModel",
}


def read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        return None


def read_json(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        print(f"cix-runtime-agent: cannot read {path}: {error}", file=sys.stderr)
        return {}


def cpu_times() -> list[tuple[int, int]]:
    text = read_text(Path("/proc/stat"))
    if not text:
        return []
    result: list[tuple[int, int]] = []
    for line in text.splitlines():
        name, *raw = line.split()
        if name != "cpu" and not (name.startswith("cpu") and name[3:].isdigit()):
            continue
        values = [int(item) for item in raw[:8]]
        total = sum(values)
        idle = (values[3] if len(values) > 3 else 0) + (values[4] if len(values) > 4 else 0)
        result.append((total, idle))
    return result


def cpu_percent(before: tuple[int, int], after: tuple[int, int]) -> float | None:
    total = after[0] - before[0]
    idle = after[1] - before[1]
    if total <= 0:
        return None
    return round(max(0.0, min(100.0, (total - idle) * 100.0 / total)), 2)


def memory_info() -> tuple[float | None, float | None]:
    text = read_text(Path("/proc/meminfo"))
    if not text:
        return None, None
    values: dict[str, float] = {}
    for line in text.splitlines():
        key, _, raw = line.partition(":")
        token = raw.strip().split()[0] if raw.strip() else ""
        if token.isdigit():
            values[key] = int(token) / 1024.0
    return values.get("MemAvailable"), values.get("MemTotal")


def cpu_frequency_mhz() -> float | None:
    values: list[float] = []
    for path in Path("/sys/devices/system/cpu").glob("cpu[0-9]*/cpufreq/scaling_cur_freq"):
        raw = read_text(path)
        if raw:
            try:
                values.append(float(raw) / 1000.0)
            except ValueError:
                pass
    return round(sum(values) / len(values), 1) if values else None


def soc_temperature_celsius() -> float | None:
    preferred: list[float] = []
    fallback: list[float] = []
    for zone in Path("/sys/class/thermal").glob("thermal_zone*"):
        raw = read_text(zone / "temp")
        if not raw:
            continue
        try:
            value = float(raw)
            value = value / 1000.0 if value > 500 else value
        except ValueError:
            continue
        fallback.append(value)
        zone_type = (read_text(zone / "type") or "").lower()
        if any(token in zone_type for token in ("soc", "cpu", "package", "cluster")):
            preferred.append(value)
    values = preferred or fallback
    return round(max(values), 1) if values else None


def fan_rpm() -> float | None:
    for path in Path("/sys/class/hwmon").glob("hwmon*/fan*_input"):
        raw = read_text(path)
        if raw:
            try:
                return float(raw)
            except ValueError:
                pass
    return None


def uptime_seconds() -> float | None:
    raw = read_text(Path("/proc/uptime"))
    try:
        return round(float(raw.split()[0]), 1) if raw else None
    except (ValueError, IndexError):
        return None


def network_bytes() -> tuple[int, int]:
    rx_total = 0
    tx_total = 0
    root = Path("/sys/class/net")
    for interface in root.iterdir() if root.exists() else []:
        if interface.name == "lo" or read_text(interface / "operstate") != "up":
            continue
        try:
            rx_total += int(read_text(interface / "statistics/rx_bytes") or "0")
            tx_total += int(read_text(interface / "statistics/tx_bytes") or "0")
        except ValueError:
            pass
    return rx_total, tx_total


def block_bytes() -> tuple[int, int]:
    text = read_text(Path("/proc/diskstats"))
    block_root = Path("/sys/block")
    devices = {item.name for item in block_root.iterdir()} if block_root.exists() else set()
    read_sectors = 0
    write_sectors = 0
    for line in text.splitlines() if text else []:
        parts = line.split()
        if len(parts) < 10 or parts[2] not in devices or parts[2].startswith(("loop", "ram")):
            continue
        try:
            read_sectors += int(parts[5])
            write_sectors += int(parts[9])
        except ValueError:
            pass
    return read_sectors * 512, write_sectors * 512


def rate_mbps(before: int, after: int, elapsed: float) -> float:
    return round(max(0, after - before) * 8.0 / elapsed / 1_000_000.0, 3)


def rate_megabytes(before: int, after: int, elapsed: float) -> float:
    return round(max(0, after - before) / elapsed / 1_000_000.0, 3)


def compact(mapping: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in mapping.items() if value is not None}


class CixRuntimeAgent:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.last_api_latency_ms: float | None = None

    def collect(self) -> dict[str, Any]:
        cpu_before = cpu_times()
        net_before = network_bytes()
        disk_before = block_bytes()
        started = time.monotonic()
        time.sleep(self.args.sample_seconds)
        elapsed = max(0.001, time.monotonic() - started)
        cpu_after = cpu_times()
        net_after = network_bytes()
        disk_after = block_bytes()
        free_memory_mb, total_memory_mb = memory_info()

        aggregate_cpu = None
        core_cpu: list[float] | None = None
        if len(cpu_before) == len(cpu_after) and cpu_after:
            aggregate_cpu = cpu_percent(cpu_before[0], cpu_after[0])
            core_values = [cpu_percent(left, right) for left, right in zip(cpu_before[1:], cpu_after[1:])]
            if core_values and all(value is not None for value in core_values):
                core_cpu = [float(value) for value in core_values if value is not None]

        state = compact(
            {
                "cpuUtilizationPercent": aggregate_cpu,
                "cpuCoreUtilizationPercent": core_cpu,
                "cpuFrequencyMhz": cpu_frequency_mhz(),
                "temperatureCelsius": soc_temperature_celsius(),
                "freeMemoryMb": round(free_memory_mb, 1) if free_memory_mb is not None else None,
                "networkLatencyMs": self.last_api_latency_ms,
                "networkTxMbps": rate_mbps(net_before[1], net_after[1], elapsed),
                "networkRxMbps": rate_mbps(net_before[0], net_after[0], elapsed),
                "networkThroughputMbps": rate_mbps(sum(net_before), sum(net_after), elapsed),
                "diskFreeMb": round(shutil.disk_usage("/").free / 1024 / 1024, 1) if os.name == "posix" else None,
                "ioReadMbps": rate_megabytes(disk_before[0], disk_after[0], elapsed),
                "ioWriteMbps": rate_megabytes(disk_before[1], disk_after[1], elapsed),
                "fanRpm": fan_rpm(),
                "uptimeSeconds": uptime_seconds(),
            }
        )
        vendor = read_json(self.args.metrics_file)
        vendor_state = vendor.get("state", vendor)
        if isinstance(vendor_state, dict):
            state.update({key: value for key, value in vendor_state.items() if key in STATE_KEYS and value is not None})

        now = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int(time.time_ns() / 1_000_000) % 1000:03d}Z"
        state["observedAt"] = now
        profile, executors = self.profile(total_memory_mb, now)
        return {
            "reportedAt": now,
            "source": self.args.source,
            "profile": profile,
            "executors": executors,
            "state": state,
        }

    def profile(self, total_memory_mb: float | None, observed_at: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        linux_probes_available = Path("/proc/stat").exists() and Path("/proc/meminfo").exists()
        cpu_executor = {
            "executorId": "cix-p1-cpu",
            "backend": "cpu",
            "placement": "local",
            "available": linux_probes_available,
            "availabilityReason": None if linux_probes_available else "LINUX_PROCFS_NOT_AVAILABLE",
            "supportedComputeClasses": ["general_cpu"],
            "supportedModels": [],
            "totalMemoryMb": round(total_memory_mb) if total_memory_mb is not None else None,
            "source": self.args.source,
            "capabilities": ["general_cpu"],
        }
        configured = read_json(self.args.profile_file)
        configured_profile = configured.get("profile", configured)
        configured_executors = configured.get("executors", [])
        executors = [cpu_executor]
        if isinstance(configured_executors, list):
            executors.extend(item for item in configured_executors if isinstance(item, dict))
        profile = {
            "platformId": "cix_p1",
            "available": linux_probes_available,
            "os": platform.platform(),
            "arch": platform.machine() or None,
            "runtimeVersion": f"python-{platform.python_version()}",
            "cpuLogicalCores": os.cpu_count(),
            "totalMemoryMb": round(total_memory_mb) if total_memory_mb is not None else None,
            "backends": executors,
            "missingCapabilities": [] if linux_probes_available else ["LINUX_PROCFS_NOT_AVAILABLE"],
            "source": self.args.source,
            "observedAt": observed_at,
        }
        if isinstance(configured_profile, dict):
            for key in ("os", "arch", "runtimeVersion", "cpuLogicalCores", "totalMemoryMb", "missingCapabilities", "source"):
                if key in configured_profile:
                    profile[key] = configured_profile[key]
        return profile, executors

    def publish(self, payload: dict[str, Any]) -> None:
        if self.args.dry_run:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            return
        url = self.args.api_base.rstrip("/") + "/api/v1/runtime/platforms/cix_p1/heartbeat"
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.args.token:
            headers["x-runtime-agent-token"] = self.args.token
        request = urllib.request.Request(
            url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        started = time.monotonic()
        with urllib.request.urlopen(request, timeout=self.args.timeout_seconds) as response:
            response.read()
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"heartbeat returned HTTP {response.status}")
        self.last_api_latency_ms = round((time.monotonic() - started) * 1000.0, 2)

    def run(self) -> None:
        while True:
            try:
                self.publish(self.collect())
            except (OSError, RuntimeError, urllib.error.URLError, ValueError) as error:
                print(f"cix-runtime-agent: heartbeat failed: {error}", file=sys.stderr)
            if self.args.once or self.args.dry_run:
                return
            time.sleep(max(0.1, self.args.interval_seconds - self.args.sample_seconds))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="CIX/Linux Agentic Runtime heartbeat collector")
    parser.add_argument("--api-base", default=os.getenv("RUNTIME_API_BASE_URL", "http://127.0.0.1:3000"))
    parser.add_argument("--token", default=os.getenv("RUNTIME_AGENT_TOKEN", ""))
    parser.add_argument("--source", default=os.getenv("CIX_RUNTIME_SOURCE", "cix-runtime-agent/1.0"))
    parser.add_argument("--interval-seconds", type=float, default=float(os.getenv("CIX_RUNTIME_INTERVAL_SECONDS", "3")))
    parser.add_argument("--sample-seconds", type=float, default=float(os.getenv("CIX_RUNTIME_SAMPLE_SECONDS", "0.25")))
    parser.add_argument("--timeout-seconds", type=float, default=float(os.getenv("CIX_RUNTIME_TIMEOUT_SECONDS", "3")))
    parser.add_argument("--profile-file", default=os.getenv("CIX_RUNTIME_PROFILE_FILE"))
    parser.add_argument("--metrics-file", default=os.getenv("CIX_RUNTIME_METRICS_FILE"))
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    CixRuntimeAgent(parse_args()).run()
