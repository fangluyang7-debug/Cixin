# CIX Runtime Agent

这个代理运行在 CIX/Linux 开发板上，将真实采样推送到 Agentic Runtime。它只依赖 Python 3 标准库。

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
