# DevEco Studio 模拟机运行与构建操作指南

> **适用工程**：鸿蒙手机 AI 任务资源感知调度中间件  
> **目标系统**：HarmonyOS 6.0.2 / API 22 (Phone)  
> **工程目录**：`harmony-agent/apps/harmony`

---

## 一、 核心须知与工程定位

当前仓库属于多端协同的综合工程（Monorepo），包含调度中间件、端侧业务、评测脚本及设计文档。

在 DevEco Studio 中打开项目时，**切勿打开最外层的 `Cixin` 根目录**，必须打开具体的原生鸿蒙工程目录：

* **正确打开路径**：
  ```text
  E:\learning_resource\Harmony_Creation\HarmonyOS\Cixin\Cixin\harmony-agent\apps\harmony
  ```
* **模块组成**：
  * `scheduler`：**调度件核心模块（HAR 共享包）**。包含系统状态感知适配器（`HarmonyDeviceStateAdapter`）、优先级队列、TaskPool 线程管控、动态降级防震荡策略。
  * `entry`：**AI 业务示例应用（HAP 主程序）**。包含离线商品数据（2700条）、5.8MB MindSpore Lite 模型、搜索页面以及专供演示的“调度控制台”。两者直接通过本地源码级依赖协同打包。

---

## 二、 模拟机试跑详细步骤

### 第一步：在 DevEco Studio 中导入工程
1. 打开 DevEco Studio。
2. 点击欢迎页的 **Open**（或顶部菜单 **File -> Open...**）。
3. 浏览并选中 `harmony-agent/apps/harmony` 文件夹，点击 **OK**。
4. 如提示信任项目（Trust Project），点击 **Trust Project**。

### 第二步：同步项目依赖（Sync）
1. 打开工程后，DevEco 会自动触发项目同步与 `ohpm install`。
2. 观察窗口底部状态栏和右上角的 **Sync Now** 提示。
3. 若未自动同步，可手动点击顶部菜单 **File -> Sync and Refresh Project**，直到右下角提示 `Sync finished`。

### 第三步：签名配置处理（⚠️ 模拟机必须跳过）
* **核心原则**：**本地模拟机运行完全不需要配置签名**，DevEco 模拟机默认放行 Debug 未签名（Unsigned）HAP。
* **操作要点**：
  * 如果弹出了 **Project Structure -> Signing Configs** 窗口：
  * **不要勾选** `Automatically generate signature`，**不要直接点 OK**；
  * **直接点击右下角的【Cancel】（取消）退出该窗口**，保持项目签名配置为空即可。

### 第四步：启动本地模拟机（Local Emulator）
1. 点击顶部菜单栏：**Tools -> Device Manager**（或右上角设备管理小图标）。
2. 在弹出窗口中切换至 **Local Emulator**（本地模拟机）标签页：
   * **若已有 Phone 模拟机**：点击设备右侧的绿色三角 ▶️ 启动。
   * **若尚未创建**：
     1. 点击 **New Emulator**。
     2. 设备类型选择 **Phone**，点击 **Next**。
     3. 系统镜像（System Image）选择 **HarmonyOS-6.0.2 / API 22**（如未下载则点击下载按钮）。
     4. 点击 **Finish** 完成创建，并点击 ▶️ 启动模拟机。
3. 等待模拟机完全开机并显示手机桌面。

### 第五步：一键构建并运行（Run entry）
1. 查看 DevEco Studio 顶部主工具栏：
   * **Run Module**：确认下拉框选中 **`entry`**。
   * **Target Device**：确认下拉框已选中刚刚启动的 **Phone 模拟机**。
2. 点击绿色的运行按钮 ▶️（**Run 'entry'**，快捷键 `Shift + F10`），或点击调试图标 🐞。
3. 构建引擎（Hvigor）将自动编译 `scheduler` HAR，并打包 `entry` HAP，全自动安装并拉起应用。

---

## 三、 首次运行与功能体验指南

应用在模拟机启动成功后，推荐体验以下两条核心路径：

### 1. 本地模型自检与商品语义搜索
* **首次初始化**：应用首屏会自动从 `rawfile` 读取 2700 条商品语料并加载约 5.8MB 的本地 Embedding 模型，进行全维度精度自检，请留出几秒钟等待初始化完成。
* **语义搜索体验**：在搜索栏输入复合语义查询，如：
  * `"运动鞋"`
  * `"耐克500元以内"`
  * `"华为1000到2000元"`
* 系统将调用端侧离线向量检索完成毫秒级匹配。

### 2. 调度控制台与协同演示（答辩亮点）
* 进入应用内的 **调度控制面板（`SchedulerPanelPage`）**：
  * **查看实时体征**：直观展示当前系统的电量、发热档位（Thermal Level）、TaskPool 线程并发数和计算档位。
  * **调试状态注入（Debug Injection）**：点击面板上的注入开关（如模拟发热 Level 4、模拟电量低于 10%），观察调度件如何瞬间做出协同响应：
    * 动态将计算线程从 4 线程压低至 1 线程；
    * 向量比对从 256 维降级至 16 维低开销模式；
    * 自动挂起后台缓存重建任务，优先保障前台 UI 流畅。

### 3. 电脑端实时调度监控

1. 在 `harmony-agent` 仓库根目录运行 `npm run monitor:dev`，从终端复制服务地址与随机配对码。电脑上访问 `http://localhost:8765` 并输入配对码。
2. 用 `ipconfig` 查电脑当前 Wi-Fi 网卡的 IPv4 地址。确认手机和电脑连接同一个可信局域网；手机模拟器是否能路由至该网段取决于模拟器网络配置。
3. 手机 App 进入“我的 -> 电脑实时监控”，填写 `http://电脑IPv4:8765` 和终端配对码，然后打开“向电脑推送实时遥测”。
4. 网页显示设备资源、活动任务和最近调度事件；App 进入后台会暂停推送，回到前台自动重连。关闭服务即清除电脑端暂存的快照。

监控只发送调度/资源字段，不含搜索原文、图片和商品列表。服务通过本地 HTTP 在局域网传输，只应在可信私有网络内使用，不要把端口暴露到互联网；演示结束后关闭推送并停止服务。

---

## 四、 后续真机实测与连接指引

| 对比项 | 当前 HarmonyOS 4.2 手机 | 目标 HarmonyOS NEXT / 7 纯血手机 |
| :--- | :--- | :--- |
| **底层架构** | API 9，保留 Android 兼容层 | API 22+，纯血鸿蒙新架构 |
| **调试通道** | ADB 协议（DevEco 无法直接识别） | 原生 HDC 协议（DevEco 秒级连接） |
| **应用兼容** | 无法安装 API 22 的纯血 HAP | 原生向下兼容，直接安装运行 |

### 后续真机调试步骤：
1. 使用支持 **HarmonyOS NEXT / 7** 的测试真机（如升级了纯血公测版的 Pura 70 / Mate 60 等）。
2. 在手机中开启【开发者选项】并打开【USB 调试】。
3. 用数据线连接电脑，在手机弹窗中勾选“始终允许此计算机调试”。
4. 打开 DevEco 顶部 **File -> Project Structure -> Project -> Signing Configs**。
5. 勾选 **Automatically generate signature**（确保已登录华为开发者账号），DevEco 会自动读取真机 UDID 生成调试签名，点击 **OK** 后即可一键部署真机。

---

## 五、 常用排错与独立检测

* **命令行一键编译检测**：
  在不打开 IDE 的情况下，可在终端直接执行工程自带的验证脚本：
  ```powershell
  cd harmony-agent
  powershell -ExecutionPolicy Bypass -File .\scripts\native-check.ps1 -StudioHome "E:\DevEco\DevEco Studio" -Task build
  ```
* **模拟机黑屏或卡顿**：
  请检查电脑 BIOS 中的硬件虚拟化（VT-x / AMD-V）是否开启，并在 Device Manager 中为模拟机分配至少 4GB 内存。
