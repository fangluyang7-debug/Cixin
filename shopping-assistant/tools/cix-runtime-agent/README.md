# CIX Runtime Agent

这个代理运行在 CIX/Linux 开发板上，将真实采样推送到 Agentic Runtime。它只依赖 Python 3 标准库。

2026-09-15：新增独立本地工作进程守护 `local_safety_guard.py`，不是将所有应用交给代理管理。现有心跳进程不会自动启动或终止任何推理任务。

默认可采集 `/proc`、`/sys` 暴露的 CPU 总/每核利用率、CPU 频率、内存、SoC 温度、风扇、网卡 TX/RX、磁盘读写、磁盘空间和 uptime。板卡 SDK 才能提供的 NPU/GPU、功耗、队列、模型和视频流水线指标不会被猜测。

## 运行

先检查本机能采到什么，不发送网络请求：

```bash
python3 cix_runtime_agent.py --dry-run
```

持续向电脑上的 API 上报：

```bash
export RUNTIME_API_BASE_URL=http://<电脑局域网地址>:3000
export RUNTIME_AGENT_TOKEN=<与服务端相同的共享令牌>
python3 cix_runtime_agent.py
```

代理默认每 3 秒上报一次，服务端默认 10 秒过期。令牌仅在服务端配置了 `RUNTIME_PLATFORM_HEARTBEAT_TOKEN` 时必需。

## 接入 NPU/GPU 厂商探针

将真实 SDK 采样器的最新结果原子写入一个 JSON 文件，再设置：

```bash
export CIX_RUNTIME_METRICS_FILE=/run/cix/runtime-metrics.json
export CIX_RUNTIME_PROFILE_FILE=/etc/cix/runtime-profile.json
```

指标文件格式：

```json
{
  "state": {
    "npuUtilizationPercent": 72.4,
    "npuFrequencyMhz": 1150,
    "npuLatencyMs": 37.5,
    "queueDepth": 2,
    "queueWaitMs": 1.8,
    "powerWatts": 19.95,
    "thermalThrottle": false,
    "currentModel": "ViT-B FP16"
  }
}
```

示例数值只说明字段格式，不能直接用于部署。`profile.example.json` 中的 NPU 执行器默认 `available=false`；必须完成真实模型探测并填入 `supportedModels` 后才能改为可用。服务端仍要求该工具/执行器积累足够的真实 Telemetry 性能样本才会参与最终选择。

## 本地硬保护接入

执行器适配器调用 `run_guarded_worker(argv, on_stopped, cancelled=...)` 启动自己的工作进程，必须运行于 Linux。argv 是参数数组，不使用 shell，不允许传入其他进程 PID。工作进程及其子进程不能自行脱离受管会话。

默认采样周期 100 ms，温度阈值 85°C，最小可用内存 128 MB，可按板卡规格传入参数。温度探针缺失标为未知；内存不可证明时拒绝/停止，避免无依据地继续分配。CPU 普通高负载不属于本地硬红线。

先发送 SIGTERM，默认等待最多 1 秒，再 SIGKILL 清理该进程组并回收；完成后才调用 on_stopped。回调中以 Runtime Handler 的 runId/executionId/executorId 和当前 UTC 时间，向 `POST /api/v1/runtime/protection` 上报 `workerStopped=true`、TERMINAL_THERMAL_REDLINE 或 TERMINAL_MEMORY_REDLINE。缺令牌时接口拒绝；必须携带 x-runtime-agent-token。内存探针不可用也归入内存安全停止原因，并非声称实测内存耗尽。

on_stopped 抛错时返回值保留 protection_reason/report_error，执行器负责记录并重试，不会恢复被停止的进程。cancelled 回调由执行器绑定用户取消信号；用户取消不需要伪装成资源红线上报。capture/restore、失败测量、HTTP 上报及重试仍由执行器实现，当前组件没有自动接入购物 Handler。

此路径独立于三秒心跳及网络上报，不提供硬实时保证。不可中断内核等待、驱动故障、断电和脱离会话的进程不在恢复保证范围。Windows 上测试采用模拟进程和探针，不等同 CIX 板端验收。

验证：`python -m unittest discover -s tools/cix-runtime-agent -p 'test_*.py' -v`（在项目根目录执行）。
