# Aster v1.22.0

v1.22.0 是与 Komari v1.4.0 配套的规模化性能版本，重点消除实时面板、Ping 概览和 Compare 页面中的请求与渲染放大。

## 数据流

- 消费 `komari.rpc.v2.3` 生成类型与能力发现；不支持的可选能力不会被静默调用。
- 首页状态改为 snapshot + sequence delta 长轮询，可在断线后续传并在序列缺口时重同步，不再每两秒拉取全量状态。
- 全部可见节点的 Ping 概览合并为一次集合请求；Compare 的全部负载指标与 Ping 历史分别只需一次集合请求。
- 只有明确的 WebSocket/HTTP 传输错误允许兼容 REST 回退；权限、参数、方法和 schema 错误直接呈现，避免重复请求。

## 浏览器性能

- 卡片使用浏览器原生 `content-visibility` 虚拟化；共享 IntersectionObserver 让离屏 Canvas 停绘，DPR 上限为 2。
- 超过 4000 个样本的多指标分析通过 transferable `Float64Array` 在 Worker 中执行，结果复用主线程点数组。
- Fleet 3D 继续保持路由级懒加载，后台或离屏时暂停；根据节点规模、内存和 reduced-motion 自动降低 DPR、粒子与帧率，并消除逐帧 O(N²) 查找。
- Compare/Fleet CSS 独立路由加载，首屏只携带 Latin Inter 字体；Home JS/CSS/字体/图标均有 Brotli 预算门禁。

## 验收结果

- 39 个测试文件、288 个测试、TypeScript、ESLint、RPC contract、bundle 和 Worker 门禁全部通过。
- Home 初始 JS Brotli 162,592 bytes（预算 163,840），CSS 22,403 bytes（预算 25,600），字体 48,256 bytes，图标 13,572 bytes。
- 真实 Chrome 中 30/300/1000 节点约 415/457/527 ms 完成卡片构建；每轮只有一个节点列表与一个 Ping 概览请求。
- 1800 次加速实时更新后，浏览器 GC 后堆增长约 0.83 MiB，卡片与流量环形缓冲保持固定上界。
