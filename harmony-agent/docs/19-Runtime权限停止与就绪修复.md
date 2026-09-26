# Runtime 权限、停止确认与业务就绪修复

基于 `codex/cixin-multi-device-runtime` 的 `ac980e9`。本轮保留最新网络画像改动，并保留工作区原有 Cixin 初赛材料。

## 权限边界

- Runtime 控制器要求用户 JWT。运行创建时由服务端写入 ownerUserId；列表、详情、取消、客户端遥测、snapshot 和 SSE 均按用户隔离。未知运行与他人运行统一 404。
- plan、agent/plan、replan、telemetry、verify 同时要求用户 JWT 和 x-maintenance-token。维护令牌不赋予跨用户运行访问权。普通手机只提交受限的客户端遥测，不得写入服务端性能样本。
- 购物和图片上传要求登录。所有 sessionId、candidateItemId 路径通过全局资源归属检查，包含旧版会话、候选、对话接口。购物入口还检查传入 sessionId、assetId 的归属。
- ImageAsset 增加可空 ownerUserId，启动补丁增量添加字段。旧的无归属数据保持无归属、不能由任意登录用户接管；需要重新上传，或另外设计经过审核的数据迁移。
- 鸿蒙设置页提供注册、登录、退出；密码不持久化，JWT 仅驻留内存，重启需重新登录；改变服务域名会清除 JWT。已有请求统一携带 Bearer Token。
- runtime/probe 的有界网络探测和基础健康接口仍公开，不包含用户运行数据。

## 取消与超时的准确语义

`status` 表示请求结果（cancelled/timed_out 等），`executionState` 独立表示 running、stop_requested、stop_unconfirmed、settled。

取消接口返回 HTTP 202 及 cancellationRequested、executionState、stopRequestedAt；只表示已接收停止请求，不表示后台已经停止。信号发出后不再运行后续阶段，实际执行 Promise 尚未结束时保留活动记录。5 秒后仍未结束标记 stop_unconfirmed，继续追踪，不能通过重规划重新启动该运行。

只有原执行器 Promise 和所追踪子操作结束后才清理活动记录、设置 executionSettledAt、写入该阶段真实 finishedAt 和耗时。迟到成功不会覆盖已取消/超时的结果；未确认停止的运行不被最近 20 条历史淘汰。

Prisma 模型操作在执行前后检查运行信号，停止后拒绝新查询/写入。已提交的数据库操作不承诺回滚；已有操作等待结束。交互事务继承检查。显式后台画像任务也纳入工作范围追踪。

边界：settled 只确认本服务所管理的执行器及已登记操作结束，不证明第三方提供商已停止计算或计费。不响应取消且永不结束的执行器会保留 stop_unconfirmed，仍需运维处理。运行历史仍为进程内数据，本轮未实现跨重启审计或分布式任务恢复。

## 按能力判定就绪

- `/api/v1/health`：进程存活。
- `/api/v1/health/infrastructure`：数据库、COS 实际探测。
- `/api/v1/health/capabilities`：每个购物操作及图片阶段的依赖状态。数据库健康时，已有会话、价格视图、已保存答案读取不再被视觉或聊天模型故障阻断。
- `/api/v1/health/readiness`：完整依赖及商品索引检查。暂缓模型模式下仍不宣称完整购物就绪。

商品索引按 visual、multimodal 分别验证。检查商品非空、配置的 provider/modelName/dimension、实际向量长度、有限数值、非零向量及商品覆盖率。图片检索与文本检索分别使用对应索引；ANN 查询也按模型名过滤，并跳过非法或错误维度向量。

当前采取保守规则：对应索引需覆盖全部商品。结果缓存 60 秒、分页扫描每批 500 条，单次限制 10 万条及批间 8 秒预算，超限返回未就绪。单条数据库请求仍依赖数据库自身返回；大规模商品池后续应改为导入时生成持久校验清单。本轮不生成向量、不接入真实模型，也不以占位数据通过检索验收。

## 验证与联调

新增 HTTP 测试使用真实 Nest 路由、JWT 签名验证与 Guard，覆盖匿名/伪造令牌、跨用户详情/取消/遥测、列表和 snapshot 隔离、维护权限、旧会话路径。SSE 覆盖回放与实时过滤。

执行器测试覆盖迟到完成、停止未确认、历史淘汰压力和禁止后续阶段。使用独立临时 SQLite 验证 Prisma 委托正常读写、停止后写入与事务被拒绝，以及后台子操作纳入停止确认。

验收脚本访问 Runtime 接口时，从本地环境变量 `CLOUD_ACCEPTANCE_ACCESS_TOKEN` 读取该用户 JWT；不要把令牌作为命令行参数或提交到仓库。执行命令：

```sh
npm run api:acceptance -- --base-url https://cixin.zeabur.app --infrastructure-only
```

这仍只是基础设施阶段验收；真实模型效果与协作人手机签名、安装、操作验证尚待进行。

## 本轮验证结果

- API 构建通过；23 组、205 项单元及 HTTP 隔离测试通过。
- 完整 AppModule HTTP 契约测试 7 项通过，包含真实注册登录、鉴权、暂缓模型阻断及数据库持久数据读取。
- 验收脚本 6 项测试通过；云 HTTP 与登录、令牌携带、切换域名清除身份测试通过。
- 数据库全新初始化、重复启动保留数据与图片归属、26 个模型字段检查通过。
- DevEco HAP/HAR 构建通过；调度 SDK 170 项、App 26 项原生测试全部通过，无失败和忽略项。HAP 仍未签名，真机在协作人处，未声称完成真机验收。
