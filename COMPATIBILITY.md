# Komari 后端兼容性说明

Aster 保留现有页面、卡片、筛选、比较和主题管理功能，同时支持两类后端：

| 后端 | 识别方式 | 验证基线 |
| --- | --- | --- |
| 官方 [Komari](https://github.com/komari-monitor/komari) | 官方 RPC 方法集合 | 最新发布 Komari 1.4.3、[komari-agent](https://github.com/komari-monitor/komari-agent) 1.2.60；并审计到 2026-09-08 的官方 `main` 快照 |
| 既有二次修改版 | `rpc.discover` 返回 `komari.rpc.v2.4` | 原有 fork RPC v2.4 合约 |

这里的版本是验证基线，不是前端的硬编码开关。主题根据实际可调用的 RPC 方法选择数据适配路径，因此上游后续版本只要保持下述方法表面即可继续使用；若缺少必需方法，主题会明确报出不兼容，而不会把通信或权限问题误判为另一种后端。

主题只与 Komari 服务端通信，不直接调用 agent API；Agent 的兼容性经官方服务端的 report/status/metric 输出间接获得，而不是在主题中复刻 Agent 协议。

### 当前上游快照

除发布版本基线外，仓库还锁定并检查了本次审计时的官方 `main` 提交：Komari 服务端
`b11ffd3aa7cca03502a75eb64ecbe827d6831d3a`，以及 komari-agent
`f7c16a94ba7dd3ce57fbe86c6131d995f645d8d8`。发布 CI 会以这两个精确提交检验节点状态投影、指标/Ping RPC、HTTP 兼容入口、主题静态资源回退和 agent v2 上报表面；它们的 SHA 同时记录在
[`contracts/backend-profiles/official-komari-v1.4.3.json`](contracts/backend-profiles/official-komari-v1.4.3.json)。

这不是把主题锁死在某一个提交。运行时仍按 RPC 能力自动识别；精确 SHA 的作用是让“兼容最新版”的审计可复现，并在后续主动升级审计基线时发现上游表面的变化。

## 自动识别与数据适配

初始化时，主题会按以下顺序识别后端：

1. 调用 `rpc.discover`。仅当返回的合约精确为 `komari.rpc.v2.4` 时，使用既有 fork 适配路径。
2. 只有在 `rpc.discover` 明确返回“方法不存在”时，才调用官方的 `rpc.methods`（带 `internal: true`）。
3. 官方路径要求至少存在 `common:getNodesLatestStatus`、`public:getPublicPingTasks`、`public:queryMetrics` 和 `public:getPingMetricStats`。

网络故障、认证失败、权限不足和响应结构异常不会触发静默回退。这能避免把真实故障掩盖成空卡片或错误数据。

页面层不需要根据后端分支：适配层会把两种协议转换为现有的节点、负载、流量、Ping 和比较数据模型。普通节点、公共配置及主题设置仍通过现有的 HTTP API 读取或保存；官方主题设置接口继续使用 `/api/admin/theme/settings`。

## 实时状态与离线节点

既有 fork 提供可续接的 `common:getRealtimeDelta` 长轮询。官方 Komari 提供的是 `common:getNodesLatestStatus` 当前状态映射，而不是同一套 delta 流。

为保持卡片行为一致，官方状态会被归一化为完整快照，并由全局数据存储每 15 秒轮询一次。页面中的每张卡片不会各自发起状态请求。官方状态的 `online` 标志和保留的最近一份上报会一起写入主题状态，因此离线卡片会保持离线视觉状态，同时仍可展示最近的关键指标。

## 历史指标、流量与比较

官方路径使用 `public:queryMetrics` 批量查询选中节点的指标序列，并映射到主题现有的负载/比较模型：CPU、内存、交换分区、负载、磁盘、上下行速率、累计流量、进程数和 TCP/UDP 连接数。

多节点比较通过 `entity_ids` 一次批量取数，不为每一张卡片重复请求。上游指标序列没有单独携带容量分母时，主题会使用当前节点元数据中的内存、交换分区和磁盘总量来保持百分比坐标轴可用。这个分母是当前节点信息，而不是历史时刻的容量快照。

## Ping、丢包与趋势图

官方路径将 `ping.latency_ms` 与 `ping.loss` 指标合并，并保留桶的样本数和丢包数。因此合并、比较和小卡片趋势图按样本权重计算丢包率，不会把不同密度的聚合桶当作等权样本。

首页 Ping 概览固定使用最近一小时，并以 24 个视觉桶展示。任务列表、延迟/丢包指标和统计请求共享同一组起止时间，避免统计数值与趋势图来自不同时间段。

官方的公共 Ping 任务接口有意不向前端公开目标地址。使用官方后端时，主题会保留任务名称，但将目标字段显示为空；这不是主题丢失了任务配置。既有 fork 若返回目标地址，则仍按原有行为展示。

## 主题元数据与功能保留

官方 Client 模型没有 fork 中的“厂商”和“用途/业务角色”字段。主题利用已有的“VPS 多维标签”设置补齐这些显示元数据：

- 对每台节点的“厂商”和“用途”维度，首个非空配置值可作为补充值；
- 仅当后端原生字段为空时才补齐，后端返回的原生值始终优先；
- 补齐结果同时用于首页筛选和列表展示，避免筛选条件与列表排序出现不一致。

这项覆盖只存在于主题前端的显示与筛选模型中，不会改写 Komari 后端保存的 Client 数据。官方后端未提供的 agent 能力字段维持“未知”语义，不会被误标记为不支持。

## 迁移预期

1. 将主题部署到官方 Komari 后，不需要在主题中选择服务器版本；首次数据请求会自动识别可用后端。
2. 保留原有主题设置。若之前依赖 fork 专有的厂商或业务角色字段，请在主题管理的“VPS 多维标签”中为对应节点填写“厂商”和“用途”，以获得一致的筛选和展示效果。
3. 请确认官方 Komari 的公共指标/Ping 数据可用；登录后，主题会继续按已有权限读取管理端节点信息和保存主题设置。
4. 从既有 fork 回退时无需迁移主题数据。只要 `rpc.discover` 仍提供 `komari.rpc.v2.4` 合约，主题会恢复 fork 路径。

## 验证命令

在仓库根目录安装依赖后，可按需要运行：

```bash
npm test
npm run typecheck
npm run lint
npm run test:contract
npm run test:performance
npm run test:browser-scale
```

若要在本地复验与官方当前 `main` 的源代码表面，请将两个精确提交检出到本地，并运行：

```bash
KOMARI_UPSTREAM_DIR=/path/to/komari \
KOMARI_AGENT_UPSTREAM_DIR=/path/to/komari-agent \
npm run test:upstream-contract
```

发布前使用完整门禁：

```bash
npm run test:release-gates
```

该门禁会串行执行单元测试、类型检查、静态检查、RPC 合约检查、性能检查、构建预算和浏览器规模检查。发布 CI 还会额外检出上文锁定的官方上游快照，执行 `test:upstream-contract`。

项目的 `npm run release` 会先执行同一套发布门禁，再进行打包。
