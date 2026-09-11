# Aster Performance V3 Todo

状态：全部完成。

## L3-0 契约与正确性

- [x] **L3-001** 同步 `komari.rpc.v2.4` 与 `ping.overview=2`
- [x] **L3-002** 校验 overview series 时间、延迟和丢包元数据
- [x] **L3-003** 由 assignment metadata 判定任务分配，不依赖 stats 是否存在
- [x] **L3-004** 从一小时多点 series 恢复卡片折线
- [x] **L3-005** 同桶有效延迟与丢包同时显示，避免吞掉部分丢包
- [x] **L3-006** stats 缺失时从 series 安全恢复 latest/max

## L3-1 请求与资源隔离

- [x] **L3-101** realtime delta 长轮询改走独立 HTTP 通道
- [x] **L3-102** 保留普通短 RPC 的 WebSocket 复用
- [x] **L3-103** AbortSignal、超时和刷新去重保持有界
- [x] **L3-104** 30/300/1000 节点仍为单次 Ping overview 请求

## L3-2 回归与发布

- [x] **L3-201** 单元测试真实多点、部分丢包和无 stats 已分配任务
- [x] **L3-202** 测试 HTTP long-poll 不占用 WebSocket RPC slot
- [x] **L3-203** browser gate 强制真实趋势线且禁止空趋势
- [x] **L3-204** 通过 289 项测试、typecheck、lint、contract、bundle、heap 与 scale gate
- [x] **L3-205** 版本、提交、推送、tag 与 GitHub Release
