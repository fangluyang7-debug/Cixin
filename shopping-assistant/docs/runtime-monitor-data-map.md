# Runtime 调度监控数据映射

本表定义 `runtime.html` 哪些内容来自真实接口、哪些参与调度、哪些只能在板端增加探针后才能显示。原则是：没有证据的动态状态显示 `N/A`，不能用设计稿中的示例数字替代。

## 已接入的动态数据

| 数据组 | 心跳字段或 Runtime 来源 | 页面用途 | 调度用途 |
| --- | --- | --- | --- |
| 心跳健康 | `heartbeat.fresh/ageMs/source` | 在线、过期、数据源、心跳年龄 | 过期后状态自动退出，不继续使用 |
| CPU | `cpuUtilizationPercent`、`cpuFrequencyMhz`、每核/每簇数组 | 总负载、频率、12 核矩阵、三簇状态 | CPU 达到上限时拒绝 CPU 候选 |
| 温控 | `temperatureCelsius`、`thermalThrottle`、`fanRpm` | 温度、风扇、降频状态 | 高温改变能耗权重；临界温度/热降频阻断本地候选 |
| NPU/GPU | 利用率、频率、显存/权重内存、`npuLatencyMs`、`currentModel` | NPU/GPU 仪表和模型状态 | 通过真实 executor 能力、模型探测、性能样本参与选择 |
| 内存 | `freeMemoryMb`、`dmaPoolUsedMb`、`memoryBandwidthMbps` | 已用内存、DMA 池、带宽 | 空闲内存不足时阻断本地候选 |
| 存储 | `ioReadMbps`、`ioWriteMbps`、`iops`、`diskFreeMb` | NVMe 吞吐/IOPS | 存储类 executor 能力和性能样本参与选择 |
| 网络/端云 | RTT、吞吐、TX/RX、抖动、丢包、数据库延迟 | 端云健康和链路速率 | 云端延迟预算包含网络 RTT；抖动/丢包改变延迟权重 |
| 队列 | `activeTaskCount`、`queueDepth`、`queueWaitMs` | 队列深度和等待 | 队列过深时阻断本地候选 |
| 视频流水线 | `pipelineFps`、`droppedFrames` | FPS 和丢帧 | 当前仅显示；尚未定义为通用调度硬约束 |
| Agentic 运行 | `activeRun.executionPlan/telemetry/verifications/replanEvents`、SSE | 真实任务分配、执行器、耗时、阻断与重规划日志 | 是调度器本身的运行记录 |

## 静态能力，不应伪装成动态监测

板卡型号、SoC 型号、峰值 TOPS、核心数量、最大内存、接口数量属于产品/适配器 `profile`。它们可以用于能力筛选，但不会随每次心跳抖动，也不能据此推断“当前在线”“链路已连接”或“正在推理”。

## 当前没有可靠探针，页面保持 N/A

| 设计稿信息 | 缺少的板端证据 |
| --- | --- |
| PCIe `x4 Gen4 ACTIVE` | 当前协商代际、Lane 数、链路速率、重训练/错误计数 |
| LAN1/LAN2 UP、实际每口速率 | 每个网口 carrier、协商速率、RX/TX、错误和丢包计数 |
| MIPI-CSI/HDMI/DP/UART/RS485/GPIO 在线 | 各接口驱动状态、活动通道、错误/中断计数 |
| Zero-copy、DMA 映射成功 | DMA/ION/共享缓冲区实际路径、拷贝次数和失败计数 |
| TLS 1.3/QUIC 已启用 | 当前会话协议、握手结果、证书校验和重连统计 |
| Vulkan/OpenCL/光追已激活 | 驱动探测结果、API 版本和当前上下文状态 |
| 精确 TOPS/W、NPU 算子队列内容 | 芯片计数器、算子级 trace、功耗域采样与校准方法 |
| PostgreSQL/pgvector 已同步、批次号 | 数据库健康探针、事务提交确认、复制/同步游标 |
| CPU affinity/RT-FIFO/PREEMPT_RT 已生效 | 调度策略、线程 PID/TID、亲和掩码和内核配置探针 |

这些项目后续应由开发板采集代理新增结构化字段，再由 Runtime 明确校验和映射；在此之前控制台不会用静态文案宣称它们处于健康或活动状态。
