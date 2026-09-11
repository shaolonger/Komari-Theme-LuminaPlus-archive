# Aster Performance V3：单请求真实 Ping 趋势

状态：完成，已发布 v1.22.1

本轮修复 Performance V2 集合查询上线后首页卡片出现“暂无趋势”和折线消失的
回归。问题不是故意牺牲功能换性能，而是 v1.22.0 只消费 `getPingOverview` 的
单点统计值：它把 `latest` 伪装成一个 sample，无法绘制折线；没有统计行时又把
已分配任务误判为未分配。V3 扩展后端集合契约并恢复真实时间序列，同时保持一轮
只有一个 overview 请求。

## 1. 数据契约

主题使用 `komari.rpc.v2.4` 与 `ping.overview=2`。响应包括：

- 最近一小时每节点/任务的 `stats`；
- 每个 150 秒桶的 `time`、有效平均延迟、sample count、loss count 和 loss rate；
- 不包含 Ping target，继续遵循公开页面的数据最小化规则。

Zod schema 和生成 TypeScript contract 同步校验。`series` 提供默认空对象，因此
旧服务端不会导致页面崩溃；升级到 v1.4.2 后自动获得完整折线。

## 2. 卡片趋势构建

任务分配状态来自主题设置中的 assignment metadata，而不是“是否恰好查到 stats”。
因此任务刚创建、短时无样本或某轮查询为空时，卡片仍知道该任务已分配，不会错误
切换为未分配。

每个 overview bucket 转成有时间戳的真实 sample。有效延迟进入折线；同一桶存在
丢包时，在其后加入 loss sentinel，使 sparkline 显示断点/丢包标记，同时保留该桶
有效样本的平均延迟。`lastValue` 优先使用精确 stats latest，缺失时回退到最后一个
有效 series point；`max` 同时考虑精确极值和可见点。

多任务卡片继续使用现有 primary/aggregate 策略，输入从单点改为真实多点序列，
不改变用户的任务绑定配置。

## 3. 长轮询隔离

`common:getRealtimeDelta` 最长等待约 25 秒。把这个长轮询放在单例 WebSocket RPC
通道中会占用串行 request slot，导致 Ping overview 和其他短 RPC 排队。V3 强制
delta long-poll 使用独立 HTTP 请求；普通 RPC 仍优先复用 WebSocket，彼此不再
发生 head-of-line blocking。

HTTP 请求继续使用 AbortSignal 和 30 秒超时；组件卸载或下一轮刷新可取消请求，
不会累积 timer、promise 或连接。

## 4. 大规模页面预算

- 30、300、1000 节点均只允许一次 `common:getPingOverview`。
- 视口外 canvas 继续暂停，卡片使用 content-visibility。
- browser gate 必须检测到真实 `.ping-task-sparkline-line`，并要求
  `.ping-task-sparkline-empty` 为零，防止“卡片存在但趋势悄悄退化”。
- 1000 节点 fixture 返回每节点 24 个点，覆盖 2000 条趋势线，不使用空 stats
  或单点 mock 掩盖问题。
- bundle、heap soak、请求 fan-out、render deadline、TypeScript、ESLint 和全部
  Vitest 均作为发布门禁。

## 5. 实测发布门禁

本机两轮 browser scale fixture 结果：30 节点约 408–459 ms、300 节点约
472–478 ms、1000 节点约 1076–1106 ms；对应趋势线 60/600/2000，空趋势均为
0，每轮 overview 请求为 1。1800 次实时 delta soak 后 heap 增长约 0.85–1.10
MiB。该结果用于防回归，不替代用户
服务器、浏览器和主题配置下的现场测量。
