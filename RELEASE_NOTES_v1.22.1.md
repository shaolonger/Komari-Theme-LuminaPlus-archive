# Aster v1.22.1

v1.22.1 修复 Performance V2 后首页卡片 Ping “暂无趋势”和折线消失的回归；
这是 bug 修复，不是为了性能故意删除功能。

## Ping 卡片

- 消费 Komari v1.4.2 的一小时多点 Ping overview series，恢复真实延迟折线。
- 任务是否分配由 assignment metadata 判断，不再因某轮 stats 为空误报“暂无趋势”。
- 同一聚合桶同时存在有效延迟与丢包时保留延迟点并显示丢包断点/标记。
- latest、max 和 loss 使用精确统计，必要时从 series 安全降级。

## 请求性能

- 实时 delta 长轮询固定使用独立 HTTP 通道，不再阻塞单例 WebSocket 上的 Ping
  overview 和其他短 RPC。
- 30/300/1000 节点仍保持每轮一次 overview 请求，视口外图表暂停策略不变。

## 验收

289 项单元测试、TypeScript、ESLint、RPC contract、bundle、heap soak 和浏览器
30/300/1000 节点 scale gate 通过；scale gate 强制要求真实折线且空趋势为零。
